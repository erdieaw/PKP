import {
  BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy,
  ServiceUnavailableException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { Role, Upload } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Readable, Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { getConfig } from '../config';
import { Actor } from '../core/auth.decorators';
import { audit } from '../core/audit';
import { DbService } from '../core/db.service';
import { activePeriod, assertWritable, lockYear } from '../core/period';
import { RedisService } from '../core/redis.service';
import { requireRoles, tenantFor } from '../core/tenant';
import { DownloadDto, UploadDto } from './integrations.dto';
import { matchesMagic, MAX_UPLOAD_BYTES, UPLOAD_TTL_SECONDS, validateUpload } from './storage.validation';

@Injectable()
export class IntegrationService implements OnModuleDestroy {
  readonly config = getConfig();
  readonly internal: S3Client;

  constructor(private readonly db: DbService, private readonly redis: RedisService) {
    const options = {
      region: 'us-east-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: this.config.minioAccessKey, secretAccessKey: this.config.minioSecretKey },
      requestHandler: { connectionTimeout: 5000, socketTimeout: 120000 },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({ ...options, endpoint: this.config.minioEndpoint });
  }

  onModuleDestroy() { this.internal.destroy(); }

  private authorizeUpload(actor: Actor, upload: Upload, healthCenterId?: string) {
    const tenant = tenantFor(actor, healthCenterId);
    if (tenant !== upload.healthCenterId || (actor.role === Role.PIC && upload.userId !== actor.id)) {
      throw new NotFoundException('Upload not found');
    }
  }

  async prepareUpload(actor: Actor, body: UploadDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const healthCenterId = tenantFor(actor, body.healthCenterId);
    const filename = validateUpload(body.filename, body.mimeType, body.fileSizeBytes);
    const uploadId = randomUUID();
    const objectKey = `staging/${healthCenterId}/${body.year}/${body.month}/${uploadId}/${filename}`;
    await this.db.$transaction(async tx => {
      await lockYear(tx, body.year);
      await assertWritable(tx, healthCenterId, body.year, body.month);
      await tx.upload.create({ data: {
        id: uploadId, healthCenterId, userId: actor.id, year: body.year, month: body.month,
        filename, mimeType: body.mimeType, sizeBytes: body.fileSizeBytes, objectKey,
        status: 'PENDING', expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
      } });
      await audit(tx, actor, healthCenterId, 'UPLOAD_PENDING', { uploadId, objectKey, sizeBytes: body.fileSizeBytes });
    });
    return { uploadId, objectKey, expiresInSeconds: UPLOAD_TTL_SECONDS };
  }

  async uploadContent(actor: Actor, id: string, request: Request) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const upload = await this.db.upload.findUnique({ where: { id } });
    if (!upload) throw new NotFoundException('Upload not found');
    this.authorizeUpload(actor, upload);
    if (upload.status !== 'PENDING' || upload.expiresAt <= new Date()) throw new ConflictException('Upload is not pending or has expired');
    if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/octet-stream' || request.headers['content-encoding']) {
      throw new UnsupportedMediaTypeException('Use an unencoded application/octet-stream body');
    }
    if (!Number.isSafeInteger(upload.sizeBytes) || upload.sizeBytes < 1 || upload.sizeBytes > MAX_UPLOAD_BYTES ||
        request.headers['content-length'] !== String(upload.sizeBytes)) {
      throw new BadRequestException('Content-Length must match the prepared upload size');
    }
    await this.db.$transaction(async tx => {
      await lockYear(tx, upload.year);
      await assertWritable(tx, upload.healthCenterId, upload.year, upload.month);
    });
    // Conditional creation prevents concurrent/replayed PUTs from replacing staged evidence.
    const key = upload.objectKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort();
    request.once('aborted', abort);
    let bytes = 0;
    let validationError: BadRequestException | undefined;
    const body = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > upload.sizeBytes || bytes > MAX_UPLOAD_BYTES) {
          validationError = new BadRequestException('Uploaded body exceeds the prepared size');
          callback(validationError);
        } else callback(null, chunk);
      },
      flush(callback) {
        if (bytes !== upload.sizeBytes) {
          validationError = new BadRequestException('Uploaded body size does not match');
          callback(validationError);
        } else callback();
      },
    });
    const onRequestError = () => body.destroy(new Error('Upload connection closed'));
    request.once('error', onRequestError);
    body.once('error', abort);
    let committed = false;
    let stored = false;
    try {
      const transfer = this.internal.send(new PutObjectCommand({
        Bucket: this.config.evidenceBucket, Key: key, Body: body, ContentLength: upload.sizeBytes,
        ContentType: upload.mimeType, Metadata: { 'upload-id': id }, IfNoneMatch: '*',
      }), { abortSignal: controller.signal });
      const consumed = finished(body, { cleanup: true });
      request.pipe(body);
      await Promise.all([transfer, consumed]);
      stored = true;
      await this.db.$transaction(async tx => {
        await lockYear(tx, upload.year);
        const current = await tx.upload.findUniqueOrThrow({ where: { id } });
        if (current.status !== 'PENDING' || current.expiresAt <= new Date() || current.objectKey !== upload.objectKey) {
          throw new ConflictException('Upload changed or expired; prepare a new upload');
        }
        await assertWritable(tx, upload.healthCenterId, upload.year, upload.month);
        await audit(tx, actor, upload.healthCenterId, 'UPLOAD_CONTENT_RECEIVED', { uploadId: id, sizeBytes: bytes });
      });
      committed = true;
      return { uploadId: id, status: 'PENDING' };
    } catch (error) {
      if (validationError) throw validationError;
      if (error instanceof ConflictException) throw error;
      if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 412 ||
          (error as { name?: string })?.name === 'PreconditionFailed') {
        throw new ConflictException('Upload content already received; finalize it or prepare a new upload');
      }
      throw new ServiceUnavailableException('Upload transfer unavailable; retry the upload');
    } finally {
      clearTimeout(timer);
      controller.abort();
      request.unpipe(body);
      request.removeListener('aborted', abort);
      request.removeListener('error', onRequestError);
      body.destroy();
      // An ambiguous/failed PUT may belong to a winning concurrent request; never delete it.
      if (stored && !committed) await this.deleteQuietly(this.config.evidenceBucket, key);
    }
  }

  async finalize(actor: Actor, id: string) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const upload = await this.db.upload.findUnique({ where: { id } });
    if (!upload) throw new NotFoundException('Upload not found');
    this.authorizeUpload(actor, upload);
    // READY and ATTACHED retries never touch the object again, even after the period locks.
    if (upload.status !== 'PENDING') return upload;
    await this.db.$transaction(async tx => {
      await lockYear(tx, upload.year);
      await assertWritable(tx, upload.healthCenterId, upload.year, upload.month);
      if (upload.expiresAt <= new Date()) throw new ConflictException('Upload has expired');
    });
    const bucket = this.config.evidenceBucket;
    const finalKey = `evidence/${upload.healthCenterId}/${upload.year}/${upload.month}/${randomUUID()}/${upload.filename}`;
    let committed = false;
    try {
      const head = await this.internal.send(new HeadObjectCommand({ Bucket: bucket, Key: upload.objectKey }), { abortSignal: AbortSignal.timeout(5000) });
      if (!head.ETag) throw new BadRequestException('Object has no ETag');
      await this.internal.send(new CopyObjectCommand({
        Bucket: bucket, Key: finalKey,
        CopySource: `${bucket}/${upload.objectKey.split('/').map(encodeURIComponent).join('/')}`,
        CopySourceIfMatch: head.ETag,
      }), { abortSignal: AbortSignal.timeout(5000) });
      // Validate an immutable copy; concurrent staging transfers cannot change this key.
      const finalHead = await this.internal.send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }), { abortSignal: AbortSignal.timeout(5000) });
      if (finalHead.ContentLength !== upload.sizeBytes || finalHead.ContentType !== upload.mimeType ||
          finalHead.Metadata?.['upload-id'] !== upload.id || !finalHead.ETag) {
        throw new BadRequestException('Uploaded size, content type or upload metadata does not match');
      }
      const prefix = await this.internal.send(new GetObjectCommand({
        Bucket: bucket, Key: finalKey, Range: 'bytes=0-7', IfMatch: finalHead.ETag,
      }), { abortSignal: AbortSignal.timeout(5000) });
      if (!prefix.Body || !matchesMagic(upload.mimeType, await prefix.Body.transformToByteArray())) {
        throw new BadRequestException('File signature does not match the declared type');
      }
      const result = await this.db.$transaction(async tx => {
        await lockYear(tx, upload.year);
        const current = await tx.upload.findUniqueOrThrow({ where: { id } });
        if (current.status !== 'PENDING') return current;
        if (current.objectKey !== upload.objectKey) throw new ConflictException('Upload changed; retry finalization');
        await assertWritable(tx, upload.healthCenterId, upload.year, upload.month);
        if (current.expiresAt <= new Date()) throw new ConflictException('Upload has expired');
        const ready = await tx.upload.update({ where: { id }, data: { status: 'READY', objectKey: finalKey, etag: finalHead.ETag } });
        await audit(tx, actor, upload.healthCenterId, 'UPLOAD_READY', { uploadId: id, objectKey: finalKey });
        return ready;
      });
      committed = result.objectKey === finalKey;
      await this.deleteQuietly(bucket, upload.objectKey);
      return result;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Upload verification unavailable; retry finalization');
    } finally {
      if (!committed) await this.deleteQuietly(bucket, finalKey);
    }
  }

  private async deleteQuietly(bucket: string, key: string) {
    try { await this.internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) }); }
    catch { /* Unreferenced private objects can be cleaned up by a storage lifecycle rule. */ }
  }

  async download(actor: Actor, query: DownloadDto, response: Response) {
    if (Boolean(query.uploadId) === Boolean(query.objectKey)) throw new BadRequestException('Specify exactly one of uploadId or objectKey');
    const upload = await this.db.upload.findUnique({ where: query.uploadId ? { id: query.uploadId } : { objectKey: query.objectKey! } });
    if (!upload) throw new NotFoundException('Upload not found');
    this.authorizeUpload(actor, upload, query.healthCenterId);
    if (!['READY', 'ATTACHED'].includes(upload.status) || !upload.objectKey.startsWith(`evidence/${upload.healthCenterId}/`)) {
      throw new ConflictException('Upload is not ready');
    }
    return this.streamObject(this.config.evidenceBucket, upload.objectKey, upload.filename, upload.mimeType, response,
      { etag: upload.etag ?? undefined, size: upload.sizeBytes });
  }

  async streamObject(bucket: string, objectKey: string, filename: string, mimeType: string, response: Response,
    expected?: { etag?: string; size: number }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort();
    response.once('close', abort);
    let body: Readable | undefined;
    try {
      const object = await this.internal.send(new GetObjectCommand({
        Bucket: bucket, Key: objectKey, ...(expected?.etag ? { IfMatch: expected.etag } : {}),
      }), { abortSignal: controller.signal });
      if (object.Body instanceof Readable) body = object.Body;
      if (!body || object.ContentLength === undefined || (expected && object.ContentLength !== expected.size)) {
        throw new ServiceUnavailableException('Stored file is unavailable');
      }
      if (response.destroyed) return;
      response.set({
        'Content-Type': mimeType, 'Content-Length': String(object.ContentLength),
        'Content-Disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      });
      await pipeline(body, response, { signal: controller.signal });
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        if (!response.destroyed) response.destroy();
        return;
      }
      response.removeHeader('Content-Length');
      response.removeHeader('Content-Disposition');
      response.removeHeader('Content-Type');
      if ((error as { name?: string })?.name === 'NoSuchKey') throw new NotFoundException('File not found');
      throw new ServiceUnavailableException('File download unavailable; retry later');
    } finally {
      clearTimeout(timer);
      response.removeListener('close', abort);
      controller.abort();
      body?.destroy();
    }
  }

  async ready() {
    try {
      await Promise.all([
        this.db.$queryRaw`SELECT 1`, this.redis.client.ping(),
        ...[this.config.evidenceBucket, this.config.reportsBucket].map(Bucket => this.internal.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(3000) })),
      ]);
      return { status: 'ready' };
    } catch { throw new ServiceUnavailableException({ status: 'not_ready' }); }
  }

  async bridgeStatus(actor: Actor, requested?: string) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, requested);
    const period = await activePeriod(this.db);
    return { healthCenterId, ...period, readOnly: true, canWrite: false,
      status: period.provinceEnabled ? 'READ_ONLY' : 'DISABLED', enabled: period.provinceEnabled,
      reason: 'Province writes are unavailable; read-only integration only' };
  }

  async bridgeSync(actor: Actor, requested?: string): Promise<never> {
    const status = await this.bridgeStatus(actor, requested);
    throw new ServiceUnavailableException({ ...status, message: status.reason });
  }
}
