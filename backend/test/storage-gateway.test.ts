import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Role, type ExportJob, type Upload } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuthGuard, RolesGuard } from '../src/auth/auth.guards';
import type { AuthService } from '../src/auth/auth.service';
import type { Actor } from '../src/core/auth.decorators';
import type { DbService } from '../src/core/db.service';
import { ApiExceptionFilter, ApiResponseInterceptor } from '../src/core/http';
import type { RedisService } from '../src/core/redis.service';
import { ExportService } from '../src/integrations/export.service';
import { IntegrationsController } from '../src/integrations/integrations.controller';
import { DownloadDto, ScopeDto, UploadDto } from '../src/integrations/integrations.dto';
import { IntegrationService } from '../src/integrations/integrations.service';
import { MAX_UPLOAD_BYTES, UPLOAD_TTL_SECONDS } from '../src/integrations/storage.validation';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.JWT_SECRET ??= 'test-only-secret-with-at-least-32-characters';
process.env.MINIO_ACCESS_KEY ??= 'test-key';
process.env.MINIO_SECRET_KEY ??= 'test-secret';

const pdf = Buffer.from('%PDF-1.7\nGateway evidence\n\x00\xff\n%%EOF\n', 'binary');
const metadata = { filename: 'evidence.pdf', mimeType: 'application/pdf', fileSizeBytes: pdf.length, year: 2026, month: 1 };
type Prepared = Awaited<ReturnType<IntegrationService['prepareUpload']>>;
type Stored = { bytes: Buffer; mime: string; metadata: Record<string, string>; etag: string };
const snapshotObject = (object: Stored): Stored => ({ ...object, bytes: Buffer.from(object.bytes), metadata: { ...object.metadata } });

async function gateway(t: TestContext, realS3 = false) {
  const center = randomUUID();
  const actor = (role: Role, healthCenterId: string | null): Actor => ({ id: randomUUID(), name: 'Gateway test', role, healthCenterId, sessionId: randomUUID(), tokenVersion: 0 });
  const actors = {
    admin: actor(Role.ADMIN_PUSKESMAS, center), other: actor(Role.ADMIN_PUSKESMAS, randomUUID()),
    pic: actor(Role.PIC, center), pic2: actor(Role.PIC, center), dinkes: actor(Role.DINKES_ADMIN, null),
  };
  const uploads = new Map<string, Upload>();
  const jobs = new Map<string, ExportJob>();
  const objects = new Map<string, Stored>();
  const commands: unknown[] = [];
  const audits: string[] = [];
  const state = {
    yearLocked: false, periodLocked: false, failPut: false, failAfterPut: false, failGet: false,
    beforePut: undefined as (() => Promise<void>) | undefined,
    afterPut: undefined as (() => void) | undefined,
    download: undefined as (() => { Body: unknown; ContentLength?: number }) | undefined,
  };
  const find = (where: { id?: string; objectKey?: string }) => {
    const row = where.id ? uploads.get(where.id) : [...uploads.values()].find(row => row.objectKey === where.objectKey);
    return row ? { ...row } : null;
  };
  // Exercise the real period/audit helpers without connecting to Postgres.
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => sql.join('').includes('period_settings')
      ? [{ activeYear: 2026, revision: 0 }] : [{ year: 2026, isLocked: state.yearLocked, cutoffDay: 10 }],
    periodLock: { findFirst: async () => state.periodLocked ? { id: randomUUID() } : null },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { audits.push(data.action); } },
    upload: {
      create: async ({ data }: { data: Upload }) => { uploads.set(data.id, { ...data, etag: null, createdAt: new Date() }); return find({ id: data.id }); },
      findUnique: async ({ where }: { where: { id?: string; objectKey?: string } }) => find(where),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => { const row = find(where); assert.ok(row); return row; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Upload> }) => {
        const row = uploads.get(where.id); assert.ok(row);
        uploads.set(row.id, { ...row, ...data });
        return find(where);
      },
    },
  };
  const db = {
    ...tx, $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    exportJob: { findFirst: async ({ where }: { where: { id: string; healthCenterId: string } }) => {
      const row = jobs.get(where.id);
      return row?.healthCenterId === where.healthCenterId ? { ...row } : null;
    } },
  };
  const storage = new IntegrationService(db as unknown as DbService, {} as RedisService);
  t.after(() => storage.onModuleDestroy());
  if (!realS3) t.mock.method(storage.internal, 'send', async (command: unknown) => {
    commands.push(command);
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.IfNoneMatch, '*');
      if (state.failPut) throw new Error('Private S3 error must not leak');
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body as Readable) chunks.push(Buffer.from(chunk));
      await state.beforePut?.();
      // Check at commit, not before consuming the stream: concurrent PUTs have one winner.
      if (objects.has(command.input.Key!)) throw Object.assign(new Error('Object already exists'), {
        name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 },
      });
      objects.set(command.input.Key!, { bytes: Buffer.concat(chunks), mime: command.input.ContentType!, metadata: command.input.Metadata!, etag: `"${randomUUID()}"` });
      if (state.failAfterPut) throw new Error('Private S3 response lost after storing');
      state.afterPut?.();
      return {};
    }
    if (command instanceof DeleteObjectCommand) { objects.delete(command.input.Key!); return {}; }
    if (command instanceof CopyObjectCommand) {
      const key = command.input.CopySource!.split('/').slice(1).map(decodeURIComponent).join('/');
      const object = objects.get(key); assert.ok(object);
      assert.equal(command.input.CopySourceIfMatch, object.etag);
      objects.set(command.input.Key!, { ...object, bytes: Buffer.from(object.bytes) });
      return {};
    }
    if (command instanceof HeadObjectCommand || command instanceof GetObjectCommand) {
      if (state.failGet) throw new Error('Private S3 error must not leak');
      const object = objects.get(command.input.Key!);
      if (!object) throw Object.assign(new Error('Private missing key'), { name: 'NoSuchKey' });
      if (command instanceof HeadObjectCommand) return { ContentLength: object.bytes.length, ContentType: object.mime, Metadata: object.metadata, ETag: object.etag };
      if (command.input.IfMatch) assert.equal(command.input.IfMatch, object.etag);
      if (command.input.Range) return { Body: { transformToByteArray: async () => object.bytes.subarray(0, 8) } };
      if (state.download) return state.download();
      return { Body: Readable.from([object.bytes.subarray(0, 5), object.bytes.subarray(5)]), ContentLength: object.bytes.length };
    }
    throw new Error('Unexpected S3 command');
  });
  // Bypass only the queue-owning constructor; get/download remain the real export methods.
  const exports = Object.assign(Object.create(ExportService.prototype), { db, storage }) as ExportService;
  const exportProvider = { get: exports.get.bind(exports), download: exports.download.bind(exports) };
  // tsx does not emit decorator type metadata; match the production tsc metadata explicitly.
  Reflect.defineMetadata('design:paramtypes', [IntegrationService, ExportService], IntegrationsController);
  Reflect.defineMetadata('design:paramtypes', [Object, UploadDto], IntegrationsController.prototype, 'upload');
  Reflect.defineMetadata('design:paramtypes', [Object, DownloadDto, Object], IntegrationsController.prototype, 'download');
  for (const method of ['job', 'report']) Reflect.defineMetadata('design:paramtypes', [Object, String, ScopeDto, Object], IntegrationsController.prototype, method);
  @Module({ controllers: [IntegrationsController], providers: [
    { provide: IntegrationService, useValue: storage }, { provide: ExportService, useValue: exportProvider },
  ] })
  class GatewayModule {}
  const app = await NestFactory.create<NestExpressApplication>(GatewayModule, { logger: false, bodyParser: false, abortOnError: false });
  t.after(() => app.close());
  app.setGlobalPrefix('api/v1');
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: true, transformOptions: { enableImplicitConversion: false } }));
  const reflector = new Reflector();
  app.useGlobalGuards(new AuthGuard(reflector, {
    authenticate: async (token: string) => {
      const actor = actors[token as keyof typeof actors];
      if (!actor) throw new UnauthorizedException();
      return actor;
    },
  } as AuthService), new RolesGuard(reflector));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const http = (path: string, token?: string, init: RequestInit = {}) => fetch(`${base}${path}`, {
    ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers }, signal: AbortSignal.timeout(5000),
  });
  const json = async <T = unknown>(path: string, status: number, token = 'admin', body?: unknown): Promise<T> => {
    const response = await http(path, token, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json() as { success: boolean; statusCode: number; data: T };
    assert.equal(response.status, status, JSON.stringify(payload));
    assert.equal(payload.success, status < 400);
    assert.equal(payload.statusCode, status);
    return payload.data;
  };
  const prepare = (token = 'admin') => json<Prepared>('/storage/uploads', 201, token, metadata);
  const put = (id: string, token = 'admin', bytes = pdf, headers: Record<string, string> = {}) => http(`/storage/uploads/${id}/content`, token, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), ...headers }, body: bytes,
  });
  const ready = async (token = 'admin') => {
    const prepared = await prepare(token);
    const response = await put(prepared.uploadId, token);
    assert.equal(response.status, 200, await response.text());
    return json<Upload>(`/storage/uploads/${prepared.uploadId}/finalize`, 200, token, {});
  };
  return { actors, uploads, jobs, objects, commands, audits, state, storage, http, json, prepare, put, ready };
}

test('gateway streams prepared bytes, finalizes immutable evidence and returns binary headers', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  assert.deepEqual(Object.keys(prepared).sort(), ['expiresInSeconds', 'objectKey', 'uploadId']);
  assert.equal(prepared.expiresInSeconds, UPLOAD_TTL_SECONDS);
  assert.ok(prepared.objectKey.startsWith(`staging/${g.actors.admin.healthCenterId}/2026/1/`));
  await g.json(`/storage/download?uploadId=${prepared.uploadId}`, 409);
  const received = await g.put(prepared.uploadId);
  assert.equal(received.status, 200);
  assert.deepEqual((await received.json() as { data: unknown }).data, { uploadId: prepared.uploadId, status: 'PENDING' });
  const staged = g.uploads.get(prepared.uploadId)!;
  assert.equal(staged.objectKey, prepared.objectKey);
  assert.deepEqual(g.objects.get(staged.objectKey)?.bytes, pdf);
  const final = await g.json<Upload>(`/storage/uploads/${prepared.uploadId}/finalize`, 200, 'admin', {});
  assert.equal(final.status, 'READY');
  assert.notEqual(final.objectKey, staged.objectKey);
  assert.ok(final.objectKey.startsWith(`evidence/${g.actors.admin.healthCenterId}/`));
  assert.ok(!g.objects.has(staged.objectKey));
  const putCommand = g.commands.find(command => command instanceof PutObjectCommand) as PutObjectCommand;
  assert.equal(putCommand.input.ContentLength, pdf.length);
  assert.equal(putCommand.input.ContentType, 'application/pdf');
  assert.equal(putCommand.input.IfNoneMatch, '*');
  assert.deepEqual(putCommand.input.Metadata, { 'upload-id': prepared.uploadId });
  const response = await g.http(`/storage/download?uploadId=${final.id}`, 'admin');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-length'), String(pdf.length));
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="evidence.pdf"');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const reads = g.commands.filter(command => command instanceof GetObjectCommand);
  assert.equal(reads.at(-1)!.input.IfMatch, final.etag);
  assert.deepEqual(g.audits, ['UPLOAD_PENDING', 'UPLOAD_CONTENT_RECEIVED', 'UPLOAD_READY']);
  const count = g.commands.length;
  g.state.yearLocked = true;
  const retry = await g.json<Upload>(`/storage/uploads/${final.id}/finalize`, 200, 'admin', {});
  assert.equal(retry.objectKey, final.objectKey);
  assert.equal(g.commands.length, count);
  const replay = await g.put(final.id);
  assert.equal(replay.status, 409, await replay.text());
  assert.deepEqual(g.objects.get(final.objectKey)?.bytes, pdf);
});

test('gateway rejects a pending PUT replay without replacing or deleting the original object', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  const pending = { ...g.uploads.get(prepared.uploadId)! };
  const first = await g.put(prepared.uploadId);
  assert.equal(first.status, 200, await first.text());
  const original = snapshotObject(g.objects.get(prepared.objectKey)!);
  const audits = [...g.audits];
  const replay = await g.put(prepared.uploadId, 'admin', Buffer.alloc(pdf.length, 'X'));
  assert.equal(replay.status, 409);
  assert.equal((await replay.json() as { message: string }).message, 'Upload content already received; finalize it or prepare a new upload');
  assert.deepEqual(g.objects.get(prepared.objectKey), original);
  assert.deepEqual(g.uploads.get(prepared.uploadId), pending);
  assert.deepEqual(g.audits, audits);
  assert.equal(g.commands.filter(command => command instanceof DeleteObjectCommand).length, 0);
  const final = await g.json<Upload>(`/storage/uploads/${prepared.uploadId}/finalize`, 200, 'admin', {});
  assert.deepEqual(g.objects.get(final.objectKey)?.bytes, pdf);
});

test('gateway permits one concurrent pending PUT and preserves the winning content', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  const pending = { ...g.uploads.get(prepared.uploadId)! };
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  g.state.beforePut = async () => { if (++arrivals === 2) release(); await gate; };
  const contents = [pdf, Buffer.from(pdf)];
  contents[1]!.write('X', 10, 'ascii');
  let original: Stored | undefined;
  g.state.afterPut = () => { original = snapshotObject(g.objects.get(prepared.objectKey)!); };
  const responses = await Promise.all(contents.map(content => g.put(prepared.uploadId, 'admin', content)));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  for (const response of responses) await response.arrayBuffer();
  assert.deepEqual(g.objects.get(prepared.objectKey), original);
  assert.deepEqual(g.objects.get(prepared.objectKey)?.bytes, contents[responses.findIndex(response => response.status === 200)]);
  assert.deepEqual(g.uploads.get(prepared.uploadId), pending);
  assert.deepEqual(g.audits, ['UPLOAD_PENDING', 'UPLOAD_CONTENT_RECEIVED']);
  assert.equal(g.commands.filter(command => command instanceof DeleteObjectCommand).length, 0);
  const final = await g.json<Upload>(`/storage/uploads/${prepared.uploadId}/finalize`, 200, 'admin', {});
  assert.deepEqual(g.objects.get(final.objectKey)?.bytes, original!.bytes);
});

test('gateway preserves an ambiguously stored object and makes retries conditional', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  const pending = { ...g.uploads.get(prepared.uploadId)! };
  g.state.failAfterPut = true;
  const failed = await g.put(prepared.uploadId);
  assert.equal(failed.status, 503, await failed.text());
  const original = snapshotObject(g.objects.get(prepared.objectKey)!);
  assert.deepEqual(original.bytes, pdf);
  g.state.failAfterPut = false;
  const retry = await g.put(prepared.uploadId, 'admin', Buffer.alloc(pdf.length, 'X'));
  assert.equal(retry.status, 409, await retry.text());
  assert.deepEqual(g.objects.get(prepared.objectKey), original);
  assert.deepEqual(g.uploads.get(prepared.uploadId), pending);
  assert.deepEqual(g.audits, ['UPLOAD_PENDING']);
  assert.equal(g.commands.filter(command => command instanceof DeleteObjectCommand).length, 0);
  const final = await g.json<Upload>(`/storage/uploads/${prepared.uploadId}/finalize`, 200, 'admin', {});
  assert.deepEqual(g.objects.get(final.objectKey)?.bytes, pdf);
});

test('gateway requires bearer authentication for every file-transfer route before storage access', async t => {
  const g = await gateway(t);
  const id = randomUUID();
  for (const token of [undefined, 'invalid']) {
    for (const [path, init] of [
      [`/storage/uploads/${id}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: pdf }],
      [`/storage/download?uploadId=${id}`, {}], [`/export/jobs/${id}/content`, {}],
    ] as const) {
      const response = await g.http(path, token, init);
      assert.equal(response.status, 401, await response.text());
    }
  }
  assert.equal(g.commands.length, 0);
  assert.equal(g.uploads.size, 0);
});

test('gateway denies cross-tenant access and limits PIC transfers to their own uploads', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare('pic');
  for (const token of ['other', 'pic2']) {
    const response = await g.put(prepared.uploadId, token);
    assert.equal(response.status, 404, await response.text());
    await g.json(`/storage/uploads/${prepared.uploadId}/finalize`, 404, token, {});
    await g.json(`/storage/download?uploadId=${prepared.uploadId}`, 404, token);
  }
  assert.equal(g.commands.length, 0);
  const put = await g.put(prepared.uploadId, 'pic');
  assert.equal(put.status, 200, await put.text());
  const final = await g.json<Upload>(`/storage/uploads/${prepared.uploadId}/finalize`, 200, 'admin', {});
  for (const token of ['pic', 'admin']) {
    const response = await g.http(`/storage/download?uploadId=${final.id}`, token);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  }
  await g.json(`/storage/download?uploadId=${final.id}`, 404, 'pic2');
  await g.json(`/storage/download?uploadId=${final.id}&healthCenterId=${g.actors.other.healthCenterId}`, 403);
  await g.json(`/storage/download?uploadId=${final.id}`, 400, 'dinkes');
  const scoped = await g.http(`/storage/download?uploadId=${final.id}&healthCenterId=${g.actors.admin.healthCenterId}`, 'dinkes');
  assert.equal(scoped.status, 200);
  assert.deepEqual(Buffer.from(await scoped.arrayBuffer()), pdf);
  const denied = await g.put(final.id, 'dinkes');
  assert.equal(denied.status, 403, await denied.text());
});

test('gateway rejects invalid upload metadata and download selectors through the actual DTO pipe', async t => {
  const g = await gateway(t);
  for (const change of [
    { fileSizeBytes: 0 }, { fileSizeBytes: 1.5 }, { fileSizeBytes: MAX_UPLOAD_BYTES + 1 },
    { mimeType: 'application/octet-stream' }, { filename: 'evidence.exe' }, { month: 13 },
    { fileSizeBytes: String(pdf.length) }, { unexpected: true },
  ]) await g.json('/storage/uploads', 400, 'admin', { ...metadata, ...change });
  await g.json('/storage/uploads', 403, 'admin', { ...metadata, healthCenterId: g.actors.other.healthCenterId });
  for (const query of ['', '?uploadId=invalid', `?uploadId=${randomUUID()}&objectKey=some-key`, '?healthCenterId=invalid']) {
    await g.json(`/storage/download${query}`, 400);
  }
  assert.equal(g.uploads.size, 0);
  assert.equal(g.commands.length, 0);
});

test('gateway rejects wrong body types, encodings and Content-Length before S3 writes', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  const invalidHeaders: Record<string, string>[] = [{ 'Content-Type': 'image/png' }, { 'Content-Encoding': 'gzip' }];
  for (const headers of invalidHeaders) {
    const response = await g.put(prepared.uploadId, 'admin', pdf, headers);
    assert.equal(response.status, 415, await response.text());
  }
  const missingType = await g.http(`/storage/uploads/${prepared.uploadId}/content`, 'admin', {
    method: 'PUT', headers: { 'Content-Length': String(pdf.length) }, body: pdf,
  });
  assert.equal(missingType.status, 415, await missingType.text());
  for (const bytes of [pdf.subarray(0, pdf.length - 1), Buffer.concat([pdf, Buffer.from('X')])]) {
    const response = await g.put(prepared.uploadId, 'admin', bytes);
    assert.equal(response.status, 400, await response.text());
  }
  // A streaming fetch uses chunked framing, so no Content-Length is synthesized.
  const missingLength = await g.http(`/storage/uploads/${prepared.uploadId}/content`, 'admin', {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Readable.toWeb(Readable.from([pdf])), duplex: 'half',
  } as RequestInit);
  assert.equal(missingLength.status, 400, await missingLength.text());
  assert.equal(g.commands.length, 0);
  assert.equal(g.uploads.get(prepared.uploadId)!.objectKey, prepared.objectKey);
});

test('service counts streamed bytes independently of headers without deleting failed transfers', async t => {
  const g = await gateway(t);
  // HTTP itself enforces framing; use a Request stream to exercise the service's own byte counter.
  for (const bytes of [pdf.subarray(0, 8), Buffer.concat([pdf, Buffer.from('X')])]) {
    const prepared = await g.prepare();
    const pending = { ...g.uploads.get(prepared.uploadId)! };
    const request = Object.assign(Readable.from([bytes.subarray(0, 4), bytes.subarray(4)]), {
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(pdf.length) },
    }) as Request;
    await assert.rejects(g.storage.uploadContent(g.actors.admin, prepared.uploadId, request), { status: 400 });
    assert.equal(request.listenerCount('aborted'), 0);
    assert.equal(request.listenerCount('error'), 0);
    assert.deepEqual(g.uploads.get(prepared.uploadId), pending);
  }
  assert.equal(g.objects.size, 0);
  assert.equal(g.commands.filter(command => command instanceof DeleteObjectCommand).length, 0);
  assert.deepEqual(g.audits, ['UPLOAD_PENDING', 'UPLOAD_PENDING']);
});

test('service leaves an aborted partial upload pending without changing references or deleting objects', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  const pending = { ...g.uploads.get(prepared.uploadId)! };
  const request = Object.assign(new Readable({ read() {} }), {
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(pdf.length) },
  }) as Request;
  const failed = assert.rejects(g.storage.uploadContent(g.actors.admin, prepared.uploadId, request), { status: 503 });
  request.push(pdf.subarray(0, 8));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.commands.filter(command => command instanceof PutObjectCommand).length, 1);
  request.emit('aborted');
  request.destroy(new Error('Simulated upload disconnect'));
  await failed;
  assert.deepEqual(g.uploads.get(prepared.uploadId), pending);
  assert.equal(g.objects.size, 0);
  assert.equal(g.commands.filter(command => command instanceof DeleteObjectCommand).length, 0);
  assert.equal(request.listenerCount('aborted'), 0);
  assert.equal(request.listenerCount('error'), 0);
  assert.deepEqual(g.audits, ['UPLOAD_PENDING']);
});

test('gateway rejects expired or non-pending transfers and expires pending finalization', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  const row = g.uploads.get(prepared.uploadId)!;
  row.expiresAt = new Date(0);
  const expired = await g.put(row.id);
  assert.equal(expired.status, 409, await expired.text());
  await g.json(`/storage/uploads/${row.id}/finalize`, 409, 'admin', {});
  row.expiresAt = new Date(Date.now() + 60000);
  for (const status of ['READY', 'ATTACHED'] as const) {
    row.status = status;
    const response = await g.put(row.id);
    assert.equal(response.status, 409, await response.text());
  }
  assert.equal(g.commands.length, 0);
});

test('gateway cleans uploaded objects if expiry or a competing upload wins before commit', async t => {
  const g = await gateway(t);
  for (const race of ['expiry', 'replacement'] as const) {
    const prepared = await g.prepare();
    g.state.afterPut = () => {
      const row = g.uploads.get(prepared.uploadId)!;
      if (race === 'expiry') row.expiresAt = new Date(0);
      else row.objectKey = `${prepared.objectKey}.competing`;
    };
    const response = await g.put(prepared.uploadId);
    assert.equal(response.status, 409, await response.text());
    assert.equal(g.objects.size, 0);
    assert.equal(g.uploads.get(prepared.uploadId)!.status, 'PENDING');
    assert.ok(g.commands.at(-1) instanceof DeleteObjectCommand);
    assert.equal((g.commands.at(-1) as DeleteObjectCommand).input.Key, prepared.objectKey);
  }
  assert.ok(!g.audits.includes('UPLOAD_CONTENT_RECEIVED'));
});

test('gateway rejects locked periods and normalizes S3 transfer failures without leaking details', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  for (const lock of ['yearLocked', 'periodLocked'] as const) {
    g.state[lock] = true;
    const response = await g.put(prepared.uploadId);
    assert.equal(response.status, 409, await response.text());
    g.state[lock] = false;
  }
  assert.equal(g.commands.length, 0);
  g.state.failPut = true;
  const unavailable = await g.put(prepared.uploadId);
  assert.equal(unavailable.status, 503);
  assert.ok(!(await unavailable.text()).includes('Private S3'));
  assert.ok(g.commands.at(-1) instanceof PutObjectCommand);
  assert.equal(g.commands.filter(command => command instanceof DeleteObjectCommand).length, 0);
  assert.equal(g.uploads.get(prepared.uploadId)!.objectKey, prepared.objectKey);
});

test('gateway validates immutable copied signatures and metadata before marking evidence ready', async t => {
  const g = await gateway(t);
  for (const invalid of ['magic', 'size', 'mime', 'metadata'] as const) {
    const prepared = await g.prepare();
    const response = await g.put(prepared.uploadId);
    assert.equal(response.status, 200, await response.text());
    const row = g.uploads.get(prepared.uploadId)!;
    const object = g.objects.get(row.objectKey)!;
    if (invalid === 'magic') object.bytes = Buffer.alloc(pdf.length, 'X');
    if (invalid === 'size') object.bytes = pdf.subarray(0, 8);
    if (invalid === 'mime') object.mime = 'image/png';
    if (invalid === 'metadata') object.metadata = { 'upload-id': randomUUID() };
    await g.json(`/storage/uploads/${row.id}/finalize`, 400, 'admin', {});
    assert.equal(g.uploads.get(row.id)!.status, 'PENDING');
    assert.ok(g.objects.has(row.objectKey));
    assert.ok([...g.objects.keys()].every(key => key.startsWith('staging/')));
  }
  assert.ok(!g.audits.includes('UPLOAD_READY'));
});

test('gateway requires a fresh prepared upload to replace malformed staged content', async t => {
  const g = await gateway(t);
  const prepared = await g.prepare();
  const malformed = Buffer.alloc(pdf.length, 'X');
  const first = await g.put(prepared.uploadId, 'admin', malformed);
  assert.equal(first.status, 200, await first.text());
  await g.json(`/storage/uploads/${prepared.uploadId}/finalize`, 400, 'admin', {});
  const original = snapshotObject(g.objects.get(prepared.objectKey)!);
  const retry = await g.put(prepared.uploadId);
  assert.equal(retry.status, 409, await retry.text());
  assert.deepEqual(g.objects.get(prepared.objectKey), original);
  assert.equal(g.uploads.get(prepared.uploadId)!.status, 'PENDING');
  assert.equal(g.uploads.get(prepared.uploadId)!.objectKey, prepared.objectKey);
  const fresh = await g.ready();
  assert.notEqual(fresh.id, prepared.uploadId);
  assert.deepEqual(g.objects.get(fresh.objectKey)?.bytes, pdf);
});

test('gateway fails closed on missing or changed downloads and allows attached evidence by object key', async t => {
  const g = await gateway(t);
  const final = await g.ready();
  const row = g.uploads.get(final.id)!;
  row.status = 'ATTACHED';
  const response = await g.http(`/storage/download?objectKey=${encodeURIComponent(row.objectKey)}`, 'admin');
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  const object = g.objects.get(row.objectKey)!;
  object.bytes = pdf.subarray(0, 8);
  const mismatch = await g.http(`/storage/download?uploadId=${row.id}`, 'admin');
  assert.equal(mismatch.status, 503);
  assert.equal(mismatch.headers.get('content-disposition'), null);
  assert.equal((await mismatch.json() as { success: boolean }).success, false);
  g.objects.delete(row.objectKey);
  await g.json(`/storage/download?uploadId=${row.id}`, 404);
  g.state.failGet = true;
  await g.json(`/storage/download?uploadId=${row.id}`, 503);
  row.objectKey = `staging/${g.actors.admin.healthCenterId}/not-final`;
  await g.json(`/storage/download?uploadId=${row.id}`, 409);
});

test('gateway rejects invalid S3 bodies before headers and terminates interrupted binary responses', async t => {
  const g = await gateway(t);
  const final = await g.ready();
  const path = `/storage/download?uploadId=${final.id}`;
  g.state.download = () => ({ Body: Buffer.from(pdf), ContentLength: pdf.length });
  await g.json(path, 503);
  const missingLength = Readable.from([pdf]);
  g.state.download = () => ({ Body: missingLength });
  await g.json(path, 503);
  assert.equal(missingLength.destroyed, true);
  const interrupted = Readable.from((async function* () {
    yield pdf.subarray(0, 5);
    await new Promise(resolve => setImmediate(resolve));
    throw new Error('Private S3 stream failure');
  })());
  g.state.download = () => ({ Body: interrupted, ContentLength: pdf.length });
  // Once binary headers are sent the adapter must close, not append a JSON error envelope.
  await assert.rejects(async () => {
    const response = await g.http(path, 'admin');
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }, TypeError);
  assert.equal(interrupted.destroyed, true);
  const retry = await g.put(final.id);
  assert.equal(retry.status, 409, await retry.text());
});

test('download deadline closes a backpressured response even after S3 has finished', async t => {
  const g = await gateway(t);
  const final = await g.ready();
  const source = Readable.from([pdf]);
  g.state.download = () => ({ Body: source, ContentLength: pdf.length });
  const response = Object.assign(new Writable({
    write(_chunk, _encoding, _callback) { /* Simulate a client that never drains. */ },
  }), { set() {}, headersSent: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const download = g.storage.download(g.actors.admin, { uploadId: final.id }, response as unknown as Response);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(source.readableEnded, true);
  assert.equal(response.destroyed, false);
  t.mock.timers.tick(120000);
  await download;
  assert.equal(response.destroyed, true);
  assert.equal(source.destroyed, true);
});

test('export job exposes an authenticated relative content path, not a public URL', async t => {
  const g = await gateway(t);
  const id = randomUUID();
  const center = g.actors.admin.healthCenterId!;
  const key = `reports/${center}/${id}/sheet7.pdf`;
  const row: ExportJob = { id, healthCenterId: center, userId: g.actors.admin.id, year: 2026, quarter: 0, format: 'pdf', status: 'QUEUED', objectKey: null, error: null, createdAt: new Date(), updatedAt: new Date() };
  g.jobs.set(id, row);
  const pending = await g.json<Record<string, unknown>>(`/export/jobs/${id}`, 200);
  assert.ok(!('downloadPath' in pending));
  await g.json(`/export/jobs/${id}/content`, 404);
  row.status = 'COMPLETED'; row.objectKey = key;
  g.objects.set(key, { bytes: pdf, mime: 'application/pdf', metadata: {}, etag: '"report"' });
  const job = await g.json<{ downloadPath: string; filename: string; quarter: string }>(`/export/jobs/${id}`, 200);
  assert.equal(job.downloadPath, `/export/jobs/${id}/content?healthCenterId=${center}`);
  assert.equal(job.filename, 'sheet7-2026-ANNUAL.pdf');
  assert.equal(job.quarter, 'ANNUAL');
  assert.ok(!('downloadUrl' in job));
  for (const path of [`/export/jobs/${id}`, `/export/jobs/${id}/content`]) {
    await g.json(path, 404, 'other');
    await g.json(path, 403, 'pic');
    await g.json(`${path}?healthCenterId=${center}`, 403, 'other');
    await g.json(path, 400, 'dinkes');
  }
  for (const token of ['admin', 'dinkes']) {
    const response = await g.http(job.downloadPath, token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="${job.filename}"`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('content-length'), String(pdf.length));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  }
  row.format = 'xlsx'; row.quarter = 1;
  const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
  g.objects.set(key, { bytes: xlsx, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', metadata: {}, etag: '"xlsx"' });
  const workbook = await g.http(job.downloadPath, 'admin');
  assert.equal(workbook.status, 200);
  assert.equal(workbook.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(workbook.headers.get('content-disposition'), 'attachment; filename="sheet7-2026-1.xlsx"');
  assert.deepEqual(Buffer.from(await workbook.arrayBuffer()), xlsx);
  row.objectKey = `reports/${g.actors.other.healthCenterId}/${id}/sheet7.pdf`;
  await g.json(job.downloadPath, 404);
});

test('gateway streams and finalizes a large binary through the real MinIO SDK', {
  skip: process.env.TEST_STORAGE_S3 !== 'true', timeout: 30000,
}, async t => {
  // Only the disposable runner may opt in; no Prisma or Redis client is created.
  assert.match(process.env.TEST_DISPOSABLE_STORAGE_PROJECT ?? '', /^pkp-e2e-[0-9a-f-]{36}$/);
  assert.match(process.env.MINIO_ENDPOINT ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(process.env.EVIDENCE_BUCKET, 'evidence-e2e');
  const g = await gateway(t, true);
  const content = Buffer.concat([pdf, Buffer.alloc(1024 * 1024 + 17, 0xfe)]);
  const prepared = await g.json<Prepared>('/storage/uploads', 201, 'admin', { ...metadata, fileSizeBytes: content.length });
  const keys = new Set([prepared.objectKey]);
  try {
    const put = await g.put(prepared.uploadId, 'admin', content);
    const received = await put.json() as { data: unknown };
    assert.equal(put.status, 200, JSON.stringify(received));
    assert.deepEqual(received.data, { uploadId: prepared.uploadId, status: 'PENDING' });
    const staged = g.uploads.get(prepared.uploadId)!;
    assert.equal(staged.objectKey, prepared.objectKey);
    keys.add(staged.objectKey);
    const head = await g.storage.internal.send(new HeadObjectCommand({ Bucket: g.storage.config.evidenceBucket, Key: staged.objectKey }));
    assert.equal(head.ContentLength, content.length);
    assert.equal(head.ContentType, 'application/pdf');
    assert.equal(head.Metadata?.['upload-id'], prepared.uploadId);
    const original = await g.storage.internal.send(new GetObjectCommand({ Bucket: g.storage.config.evidenceBucket, Key: staged.objectKey }));
    assert.deepEqual(Buffer.from(await original.Body!.transformToByteArray()), content);
    const pending = { ...staged };
    const pendingReplay = await g.put(prepared.uploadId, 'admin', Buffer.alloc(content.length, 'X'));
    assert.equal(pendingReplay.status, 409, await pendingReplay.text());
    const unchanged = await g.storage.internal.send(new GetObjectCommand({ Bucket: g.storage.config.evidenceBucket, Key: staged.objectKey }));
    assert.equal(unchanged.ETag, head.ETag);
    assert.deepEqual(Buffer.from(await unchanged.Body!.transformToByteArray()), content);
    assert.deepEqual(g.uploads.get(prepared.uploadId), pending);
    const final = await g.json<Upload>(`/storage/uploads/${prepared.uploadId}/finalize`, 200, 'admin', {});
    keys.add(final.objectKey);
    assert.equal(final.status, 'READY');
    assert.ok(final.objectKey.startsWith(`evidence/${g.actors.admin.healthCenterId}/`));
    assert.notEqual(final.objectKey, staged.objectKey);
    assert.ok(final.etag);
    const path = `/storage/download?uploadId=${final.id}`;
    const download = await g.http(path, 'admin');
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-length'), String(content.length));
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="evidence.pdf"');
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);
    const replay = await g.put(final.id, 'admin', content);
    assert.equal(replay.status, 409, await replay.text());
    const anonymous = await g.http(path);
    assert.equal(anonymous.status, 401, await anonymous.text());
    await g.json(path, 404, 'other');
    assert.deepEqual(g.audits, ['UPLOAD_PENDING', 'UPLOAD_CONTENT_RECEIVED', 'UPLOAD_READY']);
  } finally {
    for (const Key of keys) await g.storage.internal.send(new DeleteObjectCommand({ Bucket: g.storage.config.evidenceBucket, Key }));
  }
});
