import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { Prisma, Role } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { IntegrationService } from '../src/integrations/integrations.service';
import { MAX_UPLOAD_BYTES } from '../src/integrations/storage.validation';
import { createApp } from '../src/main';

type Tokens = Awaited<ReturnType<AuthService['login']>>;
type UploadUrl = Awaited<ReturnType<IntegrationService['presignedUpload']>>;
type Snapshot = {
  period: { coveredMonths: number[] };
  indicators: { id: string }[];
  targets: { indicatorId: string; targetPct: string }[];
  records: { indicatorId: string; month: number; pencapaianRiil: string }[];
};
type Period = { id: string; status: string; revision: number; snapshot: Snapshot };
type Summary = { source: string; isOfficial: boolean; isComplete: boolean; totalIndikator: number; indicators: unknown[] };

// Fixtures are deliberately retained: audit history is append-only, not disposable test data.
test('real backend integration: tenant isolation, workflow, storage, exports and sessions', {
  skip: process.env.TEST_E2E !== 'true' ? 'Set TEST_E2E=true to use real Postgres, Redis and MinIO' : false,
  timeout: 240_000,
}, async t => {
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const db = app.get(DbService);
    const auth = app.get(AuthService);
    const storage = app.get(IntegrationService);
    const requests = new Map<string, number>();
    async function request<T = unknown>(method: string, path: string, expected: number, token?: string, body?: unknown): Promise<T> {
      if (token) {
        const actor = await auth.authenticate(token);
        const count = (requests.get(actor.id) ?? 0) + 1;
        requests.set(actor.id, count);
        assert.ok(count < 100, `Keep requests below the real rate limit for ${actor.id}`);
      }
      const response = await fetch(`${base}${path}`, {
        method, signal: AbortSignal.timeout(40_000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      assert.equal(response.status, expected, `${method} ${path}: ${text}`);
      const envelope = JSON.parse(text) as { success: boolean; statusCode: number; data: T };
      assert.equal(envelope.success, expected < 400, `${method} ${path}: ${text}`);
      assert.equal(envelope.statusCode, expected);
      return envelope.data;
    }
    // Revoked credentials must reach HTTP rather than the request helper's setup authentication.
    async function revoked(token: string) {
      const response = await fetch(`${base}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.status, 401, await response.text());
    }

    await request('GET', '/health/ready', 200);
    const suffix = randomUUID();
    const password = `E2e-${randomUUID()}!`;
    const passwordHash = await hash(password, { type: argon2id });
    const centerA = await db.healthCenter.create({ data: { id: randomUUID(), code: `e2e-a-${suffix}`, name: `E2E A ${suffix}`, district: 'Integration' } });
    const centerB = await db.healthCenter.create({ data: { id: randomUUID(), code: `e2e-b-${suffix}`, name: `E2E B ${suffix}`, district: 'Integration' } });
    async function user(role: Role, healthCenterId: string | null) {
      return db.user.create({ data: { id: randomUUID(), username: `e2e-${randomUUID()}`, name: `E2E ${role}`, role, healthCenterId, passwordHash } });
    }
    const dinkes = await user(Role.DINKES_ADMIN, null);
    const adminA = await user(Role.ADMIN_PUSKESMAS, centerA.id);
    const adminB = await user(Role.ADMIN_PUSKESMAS, centerB.id);
    const picA = await user(Role.PIC, centerA.id);
    const picB = await user(Role.PIC, centerB.id);
    let year: number | undefined;
    const start = randomInt(26);
    for (let offset = 0; offset < 26; offset++) {
      const candidate = 2000 + ((start + offset) % 26);
      try {
        await db.yearPeriod.create({ data: { year: candidate } });
        year = candidate;
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      }
    }
    assert.ok(year !== undefined, 'A fresh historical year in 2000-2025 is required; new 2026+ submissions are held');
    t.diagnostic(`Retained fixtures: year=${year}, tenants=${centerA.id},${centerB.id}`);

    t.diagnostic('Authentication and explicit tenant boundaries');
    await request('GET', '/auth/me', 401);
    // Exactly five public login attempts, including DTO rejection and wrong credentials.
    const a = await request<Tokens>('POST', '/auth/login', 200, undefined, { username: adminA.username, password, role: Role.ADMIN_PUSKESMAS });
    const b = await request<Tokens>('POST', '/auth/login', 200, undefined, { username: adminB.username, password });
    const d = await request<Tokens>('POST', '/auth/login', 200, undefined, { username: dinkes.username, password });
    const period = await request<{ revision: number }>('GET', '/master/active-year', 200, d.accessToken);
    await request('PUT', '/master/active-year', 200, d.accessToken, { year, provinceEnabled: false, revision: period.revision });
    await request('POST', '/auth/login', 400, undefined, { username: adminA.username, password, role: 'NOT_A_ROLE' });
    await request('POST', '/auth/login', 401, undefined, { username: adminA.username, password: 'incorrect-password' });
    await request('POST', '/auth/login', 429, undefined, { username: adminA.username, password });
    await assert.rejects(auth.login({ username: adminA.username, password, role: Role.PIC }), { status: 401 });
    const p = await auth.login({ username: picA.username, password });
    const pb = await auth.login({ username: picB.username, password });
    for (const session of [a, b, d, p, pb]) {
      assert.ok(!('passwordHash' in session.user));
      const me = await request<Record<string, unknown>>('GET', '/auth/me', 200, session.accessToken);
      assert.equal(me.id, session.user.id);
      for (const secret of ['passwordHash', 'password', 'refreshHash', 'tokenVersion', 'sessions']) assert.ok(!(secret in me), secret);
    }
    for (const path of [
      `/records/monthly?year=${year}&month=1&healthCenterId=${centerB.id}`,
      `/audit-logs?healthCenterId=${centerB.id}`,
      `/users/pics?healthCenterId=${centerB.id}`,
    ]) await request('GET', path, 403, a.accessToken);
    await request('PATCH', `/users/${picB.id}`, 403, a.accessToken, { healthCenterId: centerB.id, name: 'Forbidden' });
    await request('PATCH', `/users/${picB.id}`, 404, a.accessToken, { name: 'Forbidden' });
    await request('GET', `/records/monthly?year=${year}&month=1`, 400, d.accessToken);
    await request('GET', '/users/pics', 400, d.accessToken);
    const scopedB = await request<{ items: { id: string; healthCenterId: string }[] }>('GET', `/users/pics?healthCenterId=${centerB.id}`, 200, d.accessToken);
    assert.deepEqual(scopedB.items.map(item => item.id), [picB.id]);
    assert.ok(scopedB.items.every(item => item.healthCenterId === centerB.id));

    const catalogue = await request<{ total: number; items: { id: string }[] }>('GET', '/master/indicators', 200, a.accessToken);
    assert.equal(catalogue.total, 272);
    assert.equal(catalogue.items.length, 272);
    const ids = catalogue.items.map(item => item.id);
    const first = ids[0]!;
    const second = ids[1]!;
    const targets = ids.map(indicatorId => ({ indicatorId, targetPct: 100, totalSasaran: 120, targetSasaran: 120 }));
    for (const session of [a, b]) {
      const saved: { updated: number } = await request<{ updated: number }>('PUT', `/targets/annual/${year}/bulk`, 200, session.accessToken, { targets });
      assert.equal(saved.updated, 272);
    }
    await request('PUT', `/targets/annual/${year}/bulk`, 400, a.accessToken, { targets: [{ ...targets[0], targetSasaran: 119 }] });
    await request('PUT', `/targets/annual/${year}/bulk`, 400, a.accessToken, { targets: [{ ...targets[0], unexpected: true }] });
    await request('PUT', '/records/monthly', 400, a.accessToken, { year, month: 1, records: [{ indicatorId: first, pencapaianRiil: 0 }], unexpected: true });
    await request('PUT', '/pic-assignments/bulk', 200, a.accessToken, { year, picUserId: picA.id, indicatorIds: [first] });
    await request('PUT', '/records/monthly', 200, p.accessToken, { year, month: 1, records: [{ indicatorId: first, pencapaianRiil: 0 }] });
    await request('PUT', '/records/monthly', 403, p.accessToken, { year, month: 1, records: [{ indicatorId: second, pencapaianRiil: 0 }] });
    await request('PUT', '/records/monthly', 403, pb.accessToken, { year, month: 1, healthCenterId: centerA.id, records: [{ indicatorId: first, pencapaianRiil: 0 }] });

    t.diagnostic('Atomic bulk rollback and zero-denominator scoring');
    const recordWhere = { healthCenterId: centerA.id, year, month: 1, indicatorId: first };
    const before = await db.monthlyRecord.findFirstOrThrow({ where: recordWhere });
    const auditCount = await db.auditLog.count({ where: { healthCenterId: centerA.id, action: 'MONTHLY_RECORDS_UPDATED' } });
    // The invalid second evidence is checked after the first upsert, exercising actual rollback.
    await request('PUT', '/records/monthly', 400, a.accessToken, { year, month: 1, records: [
      { indicatorId: first, pencapaianRiil: 99 },
      { indicatorId: second, pencapaianRiil: 0, evidenceId: randomUUID() },
    ] });
    assert.deepEqual(await db.monthlyRecord.findFirstOrThrow({ where: recordWhere }), before);
    assert.equal(await db.monthlyRecord.count({ where: { ...recordWhere, indicatorId: second } }), 0);
    assert.equal(await db.auditLog.count({ where: { healthCenterId: centerA.id, action: 'MONTHLY_RECORDS_UPDATED' } }), auditCount);
    await request('PUT', `/targets/annual/${year}/bulk`, 200, b.accessToken, { targets: [
      { indicatorId: first, targetPct: 0, totalSasaran: 120 },
      { indicatorId: second, targetPct: 100, totalSasaran: 0 },
    ] });
    await request('PUT', '/records/monthly', 200, b.accessToken, { year, month: 2, records: [first, second].map(indicatorId => ({ indicatorId, pencapaianRiil: 0 })) });
    const zeroRecords = await db.monthlyRecord.findMany({ where: { healthCenterId: centerB.id, year, month: 2 } });
    assert.equal(zeroRecords.length, 2);
    for (const record of zeroRecords) {
      assert.equal(Number(record.pencapaianRiil), 0);
      assert.equal(record.capaianRiilPct, null);
      assert.equal(record.nilaiKinerja, null);
    }
    await request('POST', '/workflow/submit', 409, b.accessToken, { year, periodNumber: 2, isQuarter: false });

    t.diagnostic('Real MinIO upload, immutable promotion and attachment validation');
    const pdf = Buffer.from('%PDF-1.7\nE2E evidence original\n%%EOF\n');
    async function upload(session: Tokens, content: Buffer) {
      const signed = await request<UploadUrl>('POST', '/storage/presigned-upload', 201, session.accessToken, {
        filename: 'evidence.pdf', mimeType: 'application/pdf', fileSizeBytes: content.length, year, month: 1,
      });
      const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.requiredHeaders, body: content, signal: AbortSignal.timeout(10_000) });
      assert.equal(put.status, 200, await put.text());
      return signed;
    }
    const signed = await upload(a, pdf);
    const finalized = await request<{ objectKey: string; status: string }>('POST', `/storage/uploads/${signed.uploadId}/finalize`, 200, a.accessToken);
    assert.equal(finalized.status, 'READY');
    assert.notEqual(finalized.objectKey, signed.objectKey);
    assert.ok(finalized.objectKey.startsWith(`evidence/${centerA.id}/`));
    const headBefore = await storage.internal.send(new HeadObjectCommand({ Bucket: storage.config.evidenceBucket, Key: finalized.objectKey }));
    assert.equal(headBefore.ContentLength, pdf.length);
    const replacement = Buffer.alloc(pdf.length, 'X');
    const replay = await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.requiredHeaders, body: replacement, signal: AbortSignal.timeout(10_000) });
    assert.equal(replay.status, 200, await replay.text());
    const headAfter = await storage.internal.send(new HeadObjectCommand({ Bucket: storage.config.evidenceBucket, Key: finalized.objectKey }));
    assert.equal(headAfter.ETag, headBefore.ETag);
    assert.equal(headAfter.ContentLength, headBefore.ContentLength);
    const download = await request<{ downloadUrl: string }>('GET', `/storage/presigned-download?uploadId=${signed.uploadId}`, 200, a.accessToken);
    const downloaded = await fetch(download.downloadUrl, { signal: AbortSignal.timeout(10_000) });
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
    const retry = await request<{ objectKey: string }>('POST', `/storage/uploads/${signed.uploadId}/finalize`, 200, a.accessToken);
    assert.equal(retry.objectKey, finalized.objectKey);
    await request('GET', `/storage/presigned-download?uploadId=${signed.uploadId}`, 404, b.accessToken);
    await request('PUT', '/records/monthly', 400, b.accessToken, { year, month: 1, records: [{ indicatorId: first, pencapaianRiil: 0, evidenceId: signed.uploadId }] });
    const malformed = await upload(a, Buffer.from('not a PDF document'));
    await request('POST', `/storage/uploads/${malformed.uploadId}/finalize`, 400, a.accessToken);
    assert.equal((await db.upload.findUniqueOrThrow({ where: { id: malformed.uploadId } })).status, 'PENDING');
    await request('POST', '/storage/presigned-upload', 400, a.accessToken, { filename: 'large.pdf', mimeType: 'application/pdf', fileSizeBytes: MAX_UPLOAD_BYTES + 1, year, month: 1 });
    await request('PUT', '/records/monthly', 200, a.accessToken, { year, month: 1, records: [{ indicatorId: first, pencapaianRiil: 0, evidenceId: signed.uploadId }] });
    assert.equal((await db.upload.findUniqueOrThrow({ where: { id: signed.uploadId } })).status, 'ATTACHED');

    t.diagnostic('Complete Q1, year locking, revision checks and official snapshot stability');
    const allRecords = ids.map(indicatorId => ({ indicatorId, pencapaianRiil: 0 }));
    for (const month of [1, 2, 3]) {
      const saved: { updated: number } = await request<{ updated: number }>('PUT', '/records/monthly', 200, a.accessToken, { year, month, records: allRecords });
      assert.equal(saved.updated, 272);
    }
    const full = await db.monthlyRecord.findMany({ where: { healthCenterId: centerA.id, year } });
    assert.equal(full.length, 816);
    assert.ok(full.every(record => record.capaianRiilPct !== null && record.nilaiKinerja !== null));
    const periodBody = { year, periodNumber: 1, isQuarter: true };
    const submitted = await request<Period>('POST', '/workflow/submit', 201, a.accessToken, periodBody);
    assert.equal(submitted.status, 'SUBMITTED');
    assert.deepEqual(submitted.snapshot.period.coveredMonths, [1, 2, 3]);
    assert.equal(submitted.snapshot.indicators.length, 272);
    assert.equal(submitted.snapshot.targets.length, 272);
    assert.equal(submitted.snapshot.records.length, 816);
    await request('PUT', '/records/monthly', 409, a.accessToken, { year, month: 3, records: [{ indicatorId: first, pencapaianRiil: 1 }] });
    await request('PUT', `/targets/annual/${year}/bulk`, 409, a.accessToken, { targets: [targets[0]] });
    const review = { ...periodBody, healthCenterId: centerA.id, expectedRevision: submitted.revision };
    await request('POST', '/workflow/verify', 400, d.accessToken, { ...periodBody, healthCenterId: centerA.id });
    await request('POST', '/workflow/verify', 409, d.accessToken, { ...review, expectedRevision: submitted.revision + 1 });
    await request('PATCH', `/master/years/${year}`, 200, d.accessToken, { isLocked: true });
    try {
      await request('POST', '/workflow/verify', 409, d.accessToken, review);
      await request('PUT', '/records/monthly', 409, b.accessToken, { year, month: 4, records: [{ indicatorId: first, pencapaianRiil: 0 }] });
    } finally {
      await request('PATCH', `/master/years/${year}`, 200, d.accessToken, { isLocked: false });
    }
    const verified = await request<Period>('POST', '/workflow/verify', 201, d.accessToken, review);
    assert.equal(verified.status, 'VERIFIED');
    assert.equal(verified.revision, submitted.revision + 1);
    assert.deepEqual(verified.snapshot, submitted.snapshot);
    const officialPath = `/analytics/sheet7?year=${year}&quarter=1`;
    const official = await request<Summary>('GET', officialPath, 200, a.accessToken);
    assert.equal(official.source, 'VERIFIED_SNAPSHOT');
    assert.equal(official.isOfficial, true);
    assert.equal(official.isComplete, true);
    assert.equal(official.totalIndikator, 272);
    const target = await db.annualTarget.findUniqueOrThrow({ where: { healthCenterId_indicatorId_year: { healthCenterId: centerA.id, indicatorId: first, year } } });
    await assert.rejects(db.annualTarget.update({ where: { id: target.id }, data: { targetPct: 50, targetSasaran: 60 } }));
    await assert.rejects(db.monthlyRecord.updateMany({ where: { healthCenterId: centerA.id, year, month: 3 }, data: { pencapaianRiil: 999 } }));
    assert.deepEqual(await request<Summary>('GET', officialPath, 200, a.accessToken), official);
    assert.deepEqual((await db.periodLock.findUniqueOrThrow({ where: { id: verified.id } })).snapshot, verified.snapshot);
    const auditRow = await db.auditLog.findFirstOrThrow({ where: { healthCenterId: centerA.id, action: 'PERIOD_VERIFY' } });
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE audit_logs SET action = 'E2E_TAMPER' WHERE id = ${auditRow.id}::uuid`;
    }), /append-only/);
    assert.deepEqual(await db.auditLog.findUniqueOrThrow({ where: { id: auditRow.id } }), auditRow);
    const auditPage = await request<{ items: { healthCenterId: string; action: string }[] }>('GET', '/audit-logs?limit=272', 200, a.accessToken);
    assert.ok(auditPage.items.every(item => item.healthCenterId === centerA.id));
    assert.ok(auditPage.items.some(item => item.action === 'PERIOD_VERIFY'));

    t.diagnostic('Concurrent monthly edit and submission serialize without a post-freeze write');
    // Tenant B's zero-target records are in month 2, so a complete month 1 is independent.
    // Restore only the two fixture target values directly; the API correctly forbids rescoring.
    await db.annualTarget.updateMany({ where: { healthCenterId: centerB.id, year, indicatorId: { in: [first, second] } }, data: { targetPct: 100, totalSasaran: 120, targetSasaran: 120 } });
    await request('PUT', '/records/monthly', 200, b.accessToken, { year, month: 1, records: allRecords });
    async function raceRequest(path: string, method: string, body: unknown) {
      const response = await fetch(`${base}${path}`, {
        method, headers: { Authorization: `Bearer ${b.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(40_000),
      });
      return { status: response.status, body: await response.json() as { data: Period } };
    }
    const [submission, edit] = await Promise.all([
      raceRequest('/workflow/submit', 'POST', { year, periodNumber: 1, isQuarter: false }),
      raceRequest('/records/monthly', 'PUT', { year, month: 1, records: [{ indicatorId: first, pencapaianRiil: 7 }] }),
    ]);
    assert.equal(submission.status, 201, JSON.stringify(submission));
    assert.ok(edit.status === 200 || edit.status === 409, JSON.stringify(edit));
    const finalRecord = await db.monthlyRecord.findFirstOrThrow({ where: { healthCenterId: centerB.id, year, month: 1, indicatorId: first } });
    const frozenRecord = submission.body.data.snapshot.records.find(record => record.indicatorId === first && record.month === 1);
    assert.ok(frozenRecord);
    assert.equal(Number(frozenRecord.pencapaianRiil), Number(finalRecord.pencapaianRiil));
    assert.equal(Number(finalRecord.pencapaianRiil), edit.status === 200 ? 7 : 0);
    await request('PUT', '/records/monthly', 409, b.accessToken, { year, month: 1, records: [{ indicatorId: first, pencapaianRiil: 8 }] });

    t.diagnostic('Real Redis export worker, report downloads and disabled provincial bridge');
    for (const format of ['excel', 'pdf']) {
      const queued = await request<{ jobId: string }>('POST', `/export/${format}/sheet7`, 202, d.accessToken, { healthCenterId: centerA.id, year, quarter: 1 });
      await request('GET', `/export/jobs/${queued.jobId}`, 404, b.accessToken);
      const deadline = Date.now() + 30_000;
      let completed = false;
      while (Date.now() < deadline) {
        const job = await request<{ status: string; error: string | null; downloadUrl?: string }>('GET', `/export/jobs/${queued.jobId}?healthCenterId=${centerA.id}`, 200, d.accessToken);
        assert.notEqual(job.status, 'FAILED', `Export ${queued.jobId}: ${job.error}`);
        if (job.status === 'COMPLETED') {
          assert.ok(job.downloadUrl);
          const report = await fetch(job.downloadUrl, { signal: AbortSignal.timeout(10_000) });
          assert.equal(report.status, 200);
          const bytes = Buffer.from(await report.arrayBuffer());
          assert.ok(bytes.length > 100);
          assert.equal(bytes.subarray(0, format === 'excel' ? 4 : 5).toString('binary'), format === 'excel' ? 'PK\x03\x04' : '%PDF-');
          completed = true;
          break;
        }
        await delay(1000);
      }
      assert.ok(completed, `Export ${queued.jobId} did not complete within 30 seconds`);
    }
    const syncBefore = await db.monthlyRecord.findMany({ where: { healthCenterId: centerA.id, year }, select: { id: true, syncStatus: true }, orderBy: { id: 'asc' } });
    const bridge = await request<{ enabled: boolean; status: string }>('GET', '/bridge/status', 200, a.accessToken);
    assert.equal(bridge.enabled, false);
    assert.equal(bridge.status, 'DISABLED');
    await request('POST', '/bridge/sync-batch', 503, a.accessToken, { year });
    assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: centerA.id, year }, select: { id: true, syncStatus: true }, orderBy: { id: 'asc' } }), syncBefore);
    assert.ok(syncBefore.every(record => record.syncStatus === 'NOT_SYNCED'));

    t.diagnostic('Refresh rotation, logout revocation and password-wide session revocation');
    const rotated = await request<Tokens>('POST', '/auth/refresh', 200, undefined, { refreshToken: p.refreshToken });
    assert.notEqual(rotated.refreshToken, p.refreshToken);
    await request('POST', '/auth/refresh', 401, undefined, { refreshToken: p.refreshToken });
    await request('GET', '/auth/me', 200, rotated.accessToken);
    await request('POST', '/auth/logout', 200, rotated.accessToken);
    await revoked(rotated.accessToken);
    await request('POST', '/auth/refresh', 401, undefined, { refreshToken: rotated.refreshToken });
    const otherSession = await auth.login({ username: adminA.username, password });
    const newPassword = `Changed-${randomUUID()}!`;
    await request('POST', '/auth/change-password', 200, a.accessToken, { currentPassword: password, newPassword });
    await revoked(a.accessToken);
    await revoked(otherSession.accessToken);
    for (const refreshToken of [a.refreshToken, otherSession.refreshToken]) await request('POST', '/auth/refresh', 401, undefined, { refreshToken });
    await assert.rejects(auth.login({ username: adminA.username, password }), { status: 401 });
    const changed = await auth.login({ username: adminA.username, password: newPassword });
    await request('GET', '/auth/me', 200, changed.accessToken);
    await request('POST', '/auth/logout', 200, changed.accessToken);
  } finally {
    // Closes the actual BullMQ worker, Redis connections, S3 clients and Prisma pool.
    await app.close();
  }
});
