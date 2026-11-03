import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { hash } from 'argon2';
import { Prisma, Role } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { createApp } from '../src/main';
import { MonthlyObservationInput } from '../src/operations/monthly-observations.dto';
import { MonthlyObservationsService } from '../src/operations/monthly-observations.service';

type Result = Awaited<ReturnType<MonthlyObservationsService['list']>>;

test('monthly observations: isolated HTTP, database guards and real evidence storage', {
  skip: process.env.TEST_MONTHLY_OBSERVATIONS_E2E !== 'true', timeout: 180000,
}, async t => {
  assert.equal(new URL(process.env.DATABASE_URL ?? '').pathname, '/pkp_monthly_observations_qa');
  assert.ok(process.env.TEST_DISPOSABLE_STORAGE_PROJECT?.startsWith('pkp-e2e-'));
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const db = app.get(DbService);
    const auth = app.get(AuthService);
    const base = `${await app.getUrl()}/api/v1`;
    // Test fixtures only. This suite never invokes seed or targets the application database.
    const catalogue = JSON.parse(await readFile(join(__dirname, '../../prisma/seed-data/catalogue.json'), 'utf8')) as {
      sections: Prisma.SectionCreateManyInput[]; indicators: Prisma.IndicatorCreateManyInput[];
    };
    for (const section of [...catalogue.sections].sort((a, b) => a.code.split('.').length - b.code.split('.').length)) await db.section.create({ data: section });
    await db.indicator.createMany({ data: catalogue.indicators });
    for (const year of [2025, 2026, 2027]) await db.yearPeriod.create({ data: { year } });
    await db.periodSettings.update({ where: { id: 1 }, data: { activeYear: 2026 } });
    const center = await db.healthCenter.create({ data: { code: 'OBS-A', name: 'Observations QA', district: 'QA' } });
    const other = await db.healthCenter.create({ data: { code: 'OBS-B', name: 'Other QA', district: 'QA' } });
    const password = `Disposable-${randomUUID()}`;
    const passwordHash = await hash(password);
    const makeUser = (role: Role, username: string, healthCenterId: string | null = center.id) => db.user.create({ data: { username, name: username, role, healthCenterId, passwordHash } });
    const admin = await makeUser(Role.ADMIN_PUSKESMAS, 'obs-admin');
    const pic = await makeUser(Role.PIC, 'obs-pic');
    const secondPic = await makeUser(Role.PIC, 'obs-pic-other');
    const otherAdmin = await makeUser(Role.ADMIN_PUSKESMAS, 'other-admin', other.id);
    const dinkes = await makeUser(Role.DINKES_ADMIN, 'obs-dinkes', null);
    const [a, p, p2, o, d] = await Promise.all([admin, pic, secondPic, otherAdmin, dinkes].map(user => auth.login({ username: user.username, password })));
    const request = (method: string, path: string, body?: unknown, token = a!.accessToken) => fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
    const api = async <T>(method: string, path: string, body?: unknown, token = a!.accessToken, status = 200): Promise<T> => {
      const response = await request(method, path, body, token);
      const payload = await response.json() as { data: T };
      assert.equal(response.status, status, JSON.stringify(payload));
      return payload.data;
    };
    const endpoint = '/records/monthly-observations';
    const listPath = `${endpoint}?year=2026&month=1`;
    const note: MonthlyObservationInput = { indicatorId: 'K1-R9', revision: 0, kind: 'NOTE', status: 'RECORDED', notes: 'Raw observation, not a score' };
    const body = (records: unknown = [note], month = 1) => ({ year: 2026, month, records });
    const save = (records: MonthlyObservationInput[], month = 1, token = a!.accessToken, status = 200) => api<Result>('PUT', endpoint, body(records, month), token, status);

    await t.test('GET is persisted-only and authentication and selected-tenant rules apply', async () => {
      assert.deepEqual(await api('GET', listPath), { items: [] });
      await api('GET', listPath, undefined, '', 401);
      await api('GET', `${listPath}&healthCenterId=${other.id}`, undefined, a!.accessToken, 403);
      await api('GET', listPath, undefined, d!.accessToken, 400);
      assert.deepEqual(await api('GET', `${listPath}&healthCenterId=${center.id}`, undefined, d!.accessToken), { items: [] });
      await api('PUT', endpoint, body(), d!.accessToken, 403);
      await api('PUT', endpoint, { ...body(), healthCenterId: other.id }, a!.accessToken, 400);
    });

    let oldMonthly: unknown;
    let oldRecaps: unknown;
    let analyticsBefore: unknown[];
    const analyticsPaths = ['/analytics/sheet7?year=2026&quarter=1', '/analytics/period-recap?year=2026&endMonth=3', '/analytics/annual-trend?year=2026', '/analytics/indicator-trends?year=2026'];
    await t.test('scored monthly history and separate recaps are independent before/after all-identity input', async () => {
      await api('PUT', '/records/monthly', { year: 2026, month: 1, records: [{ indicatorId: 'K5-R26', pencapaianRiil: 250, totalSasaran: 100, inputBasis: 'PERIOD_ACTUAL', scoringVersion: 'DO_2026_V2' }] });
      await api('PUT', '/records/period-recaps', { year: 2026, endMonth: 3, indicatorId: 'K2-R51', numerator: 5, denominator: 100, notes: 'QA independently confirmed source', confirmed: true, expectedRevision: 0 });
      oldMonthly = await db.monthlyRecord.findMany();
      oldRecaps = await db.periodRecap.findMany();
      analyticsBefore = await Promise.all(analyticsPaths.map(path => api('GET', path)));
      const records = catalogue.indicators.map(indicator => ({ ...note, indicatorId: indicator.id }));
      const saved = await save(records);
      assert.equal(saved.items.length, 272);
      assert.ok(saved.items.every(item => item.revision === 1 && item.value === null));
      assert.equal((await api<Result>('GET', listPath)).items.length, 272);
      assert.deepEqual(await db.monthlyRecord.findMany(), oldMonthly);
      assert.deepEqual(await db.periodRecap.findMany(), oldRecaps);
      assert.deepEqual(await Promise.all(analyticsPaths.map(path => api('GET', path))), analyticsBefore);
      assert.equal(await db.auditLog.count({ where: { action: 'MONTHLY_OBSERVATION_SAVED' } }), 272, 'no 100-row audit truncation');
      assert.equal(await db.annualTarget.count({ where: { healthCenterId: center.id } }), 0);
    });

    await t.test('raw precision, zero denominator and false round-trip with exact public fields', async () => {
      const records: MonthlyObservationInput[] = [
        { ...note, indicatorId: 'K5-R38', kind: 'NUMBER', value: 0.123456789123456, unit: 'events' },
        { ...note, indicatorId: 'K1-R40', kind: 'RATIO', value: 3.141592653589793, denominator: 0, unit: 'recommendations' },
        { ...note, indicatorId: 'K3-R12', kind: 'DOCUMENT', documentAvailable: false },
        { ...note, indicatorId: 'K2-R35', kind: 'NUMBER', value: 1e12, unit: 'rupiah' },
        { ...note, indicatorId: 'K4-R29', kind: 'NUMBER', value: 1e-30, unit: 'units' },
      ];
      const saved = await save(records, 2);
      assert.deepEqual(saved.items.map(item => item.value), records.map(record => record.value ?? null));
      assert.equal(saved.items[1]!.denominator, 0);
      assert.equal(saved.items[2]!.documentAvailable, false);
      assert.deepEqual(Object.keys(saved.items[0]!).sort(), ['id', 'healthCenterId', 'indicatorId', 'year', 'month', 'revision', 'kind', 'status', 'value', 'denominator', 'documentAvailable', 'unit', 'notes', 'sourceReference', 'evidenceId', 'updatedAt'].sort());
      const fetched = await api<Result>('GET', `${endpoint}?year=2026&month=2`);
      for (const row of saved.items) assert.deepEqual(fetched.items.find(item => item.id === row.id), row);
    });

    await t.test('strict shape/type/unknown fields and duplicate/empty batches reject with no mutation', async () => {
      for (const records of [[], [null], [[]], [[note]], [note, note], [{ ...note, revision: undefined }], [{ ...note, notes: ' \n' }],
        [{ ...note, value: 0 }], [{ ...note, unit: 'count' }], [{ ...note, scoringVersion: 'DO_2026_V2' }], [{ ...note, revision: '0' }],
        [{ ...note, kind: 'NUMBER', value: '1', unit: 'people' }], [{ ...note, kind: 'NUMBER', value: 1, unit: ' ' }],
        [{ ...note, kind: 'NUMBER', value: 1e12 + 1, unit: 'people' }], [{ ...note, kind: 'NUMBER', value: -1, unit: 'people' }],
        [{ ...note, kind: 'RATIO', value: 1, unit: 'people' }], [{ ...note, kind: 'DOCUMENT', documentAvailable: 'false' }],
        [{ ...note, kind: 'DOCUMENT', documentAvailable: null }], [{ ...note, status: 'NOT_DUE', value: 0 }], [{ ...note, status: 'NOT_AVAILABLE', documentAvailable: false }],
      ]) await api('PUT', endpoint, body(records, 3), a!.accessToken, 400);
      for (const changes of [{ year: '2026' }, { month: '1' }, { month: 13 }, { healthCenterId: center.id }]) await api('PUT', endpoint, { ...body(), ...changes }, a!.accessToken, 400);
      assert.equal(await db.monthlyObservation.count({ where: { month: 3 } }), 0);
    });

    await t.test('NOT_DUE/NOT_AVAILABLE require notes; changing kind or status clears previous payload', async () => {
      const input = { ...note, indicatorId: 'K1-R40', revision: 1, kind: 'RATIO' as const, value: 2, denominator: 0, unit: 'items' };
      await save([input], 2);
      for (const [index, status] of (['NOT_DUE', 'NOT_AVAILABLE'] as const).entries()) {
        const result = await save([{ ...note, indicatorId: input.indicatorId, revision: index + 2, kind: 'RATIO', status, notes: 'Source not due or unavailable' }], 2);
        assert.deepEqual([result.items[0]!.value, result.items[0]!.denominator, result.items[0]!.documentAvailable], [null, null, null]);
      }
      const changed = await save([{ ...note, indicatorId: input.indicatorId, revision: 4, kind: 'DOCUMENT', documentAvailable: false }], 2);
      assert.deepEqual([changed.items[0]!.kind, changed.items[0]!.value, changed.items[0]!.unit], ['DOCUMENT', null, null]);
    });

    await t.test('concurrent creates and updates have one winner and batches roll back on late conflict', async () => {
      for (const revision of [0, 1]) {
        const responses = await Promise.all(['first', 'second'].map(notes => request('PUT', endpoint, body([{ ...note, revision, notes }], 3))));
        assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      }
      const count = await db.auditLog.count({ where: { action: 'MONTHLY_OBSERVATION_SAVED' } });
      await save([{ ...note, indicatorId: 'K1-R8' }, { ...note, revision: 0 }], 3, a!.accessToken, 409);
      assert.equal(await db.monthlyObservation.count({ where: { month: 3 } }), 1);
      assert.equal(await db.auditLog.count({ where: { action: 'MONTHLY_OBSERVATION_SAVED' } }), count);
    });

    await t.test('audit before/after strings remain complete at maximum lengths', async () => {
      const long = { ...note, revision: 2, notes: 'n'.repeat(4000), sourceReference: 'r'.repeat(1000) };
      await save([long], 3);
      await save([{ ...note, revision: 3 }], 3);
      const logs = await db.auditLog.findMany({ where: { action: 'MONTHLY_OBSERVATION_SAVED', details: { path: ['value', 'month'], equals: 3 } }, orderBy: { createdAt: 'asc' } });
      const details = logs.at(-1)!.details as { previous: { notes: string; sourceReference: string }; value: { revision: number } };
      assert.equal(details.previous.notes, long.notes);
      assert.equal(details.previous.sourceReference, long.sourceReference);
      assert.equal(details.value.revision, 4);
    });

    await t.test('PIC assignment and inactive/unknown catalogue entries are guarded independently', async () => {
      await save([note], 4, p!.accessToken, 403);
      await db.picAssignment.create({ data: { healthCenterId: center.id, indicatorId: note.indicatorId, year: 2026, picUserId: pic.id } });
      await save([note], 4, p!.accessToken);
      await save([{ ...note, indicatorId: 'unknown' }], 4, a!.accessToken, 400);
      const section = await db.section.create({ data: { code: 'OBS-QA', name: 'QA', klasterId: 1, isActive: false } });
      const template = catalogue.indicators[0]!;
      await db.indicator.create({ data: { ...template, id: 'OBS-INACTIVE-SECTION', sectionCode: section.code } });
      await db.indicator.create({ data: { ...template, id: 'OBS-INACTIVE', isActive: false } });
      for (const indicatorId of ['OBS-INACTIVE', 'OBS-INACTIVE-SECTION']) await save([{ ...note, indicatorId }], 4, a!.accessToken, 400);
      await db.indicator.deleteMany({ where: { id: { in: ['OBS-INACTIVE', 'OBS-INACTIVE-SECTION'] } } });
      await db.section.delete({ where: { code: section.code } });
    });

    const upload = async (token: string) => {
      const bytes = Buffer.from('%PDF-1.4\nObservation QA\n%%EOF');
      const prepared = await api<{ uploadId: string }>('POST', '/storage/uploads', { year: 2026, month: 5, filename: 'observation.pdf', mimeType: 'application/pdf', fileSizeBytes: bytes.length }, token, 201);
      const content = await fetch(`${base}/storage/uploads/${prepared.uploadId}/content`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) }, body: bytes });
      assert.equal(content.status, 200, await content.text());
      await api('POST', `/storage/uploads/${prepared.uploadId}/finalize`, {}, token);
      return { id: prepared.uploadId, bytes };
    };

    await t.test('real evidence attachment supports owner/admin/Dinkes download; preserves on omission, clears on null', async () => {
      const evidence = await upload(p!.accessToken);
      await save([{ ...note, evidenceId: evidence.id }], 5, p!.accessToken);
      assert.equal((await db.upload.findUniqueOrThrow({ where: { id: evidence.id } })).status, 'ATTACHED');
      for (const [token, query] of [[p!.accessToken, ''], [a!.accessToken, ''], [d!.accessToken, `&healthCenterId=${center.id}`]]) {
        const response = await request('GET', `/storage/download?uploadId=${evidence.id}${query}`, undefined, token);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), evidence.bytes);
      }
      await api('GET', `/storage/download?uploadId=${evidence.id}`, undefined, p2!.accessToken, 404);
      await api('GET', `/storage/download?uploadId=${evidence.id}`, undefined, o!.accessToken, 404);
      await assert.rejects(() => db.upload.delete({ where: { id: evidence.id } }), /Foreign key constraint/);
      const result = await save([{ ...note, revision: 1 }], 5);
      assert.equal(result.items[0]!.evidenceId, evidence.id);
      await save([{ ...note, revision: 2, evidenceId: null }], 5);
      assert.equal((await db.upload.findUniqueOrThrow({ where: { id: evidence.id } })).status, 'ATTACHED');
      assert.equal((await api<Result>('GET', `${endpoint}?year=2026&month=5`)).items[0]!.evidenceId, null);
    });

    await t.test('evidence scope, readiness, PIC ownership and late-batch rollback are enforced', async () => {
      const valid = await upload(a!.accessToken);
      for (const change of [{ healthCenterId: other.id }, { year: 2025 }, { month: 6 }, { status: 'PENDING' as const }, { etag: null }]) {
        const row = await db.upload.create({ data: { healthCenterId: center.id, userId: pic.id, year: 2026, month: 5,
          objectKey: `evidence/qa/${randomUUID()}`, filename: 'qa.pdf', mimeType: 'application/pdf', sizeBytes: 10,
          status: 'READY', etag: 'qa', expiresAt: new Date(), ...change } });
        await save([{ ...note, revision: 3, evidenceId: row.id }], 5, a!.accessToken, 400);
      }
      await save([{ ...note, revision: 3, evidenceId: valid.id }], 5, p!.accessToken, 400);
      await save([{ ...note, revision: 3, evidenceId: valid.id }, { ...note, indicatorId: 'K1-R8', revision: 999 }], 5, a!.accessToken, 409);
      assert.equal((await db.upload.findUniqueOrThrow({ where: { id: valid.id } })).status, 'READY');
      assert.equal((await api<Result>('GET', `${endpoint}?year=2026&month=5`)).items[0]!.revision, 3);
    });

    await t.test('assigned PIC retains admin evidence without gaining download or foreign replacement access', async () => {
      const evidence = await upload(a!.accessToken);
      const replacement = await upload(a!.accessToken);
      const created = (await save([{ ...note, revision: 3, evidenceId: evidence.id }], 5)).items[0]!;
      await api('GET', `/storage/download?uploadId=${evidence.id}`, undefined, p!.accessToken, 404);
      const saved = (await save([{ ...note, revision: 4, notes: 'Assigned PIC updates notes only' }], 5, p!.accessToken)).items[0]!;
      assert.equal(saved.evidenceId, evidence.id);
      assert.equal(saved.notes, 'Assigned PIC updates notes only');
      assert.equal(saved.revision, 5);
      const fetched = await api<Result>('GET', `${endpoint}?year=2026&month=5`, undefined, p!.accessToken);
      assert.deepEqual(fetched.items.find(item => item.id === created.id), saved);
      await api('GET', `/storage/download?uploadId=${evidence.id}`, undefined, p!.accessToken, 404);
      await save([{ ...note, revision: 5, evidenceId: replacement.id }], 5, p!.accessToken, 400);
      // Exercise the SQL guard directly, independently of the HTTP service's ownership check.
      await assert.rejects(() => db.monthlyObservation.update({ where: { id: created.id }, data: {
        revision: 6, updatedBy: pic.id, evidenceId: replacement.id,
      } }), /Invalid observation evidence/);
      assert.equal((await db.upload.findUniqueOrThrow({ where: { id: replacement.id } })).status, 'READY');
      assert.equal((await db.monthlyObservation.findUniqueOrThrow({ where: { id: created.id } })).revision, 5);
      await save([{ ...note, revision: 5, evidenceId: evidence.id }], 5, p!.accessToken);
      // Reassignment changes the writer, not the evidence's uploader or download authorization.
      await db.picAssignment.update({ where: { healthCenterId_indicatorId_year: {
        healthCenterId: center.id, indicatorId: note.indicatorId, year: 2026,
      } }, data: { picUserId: secondPic.id } });
      const reassigned = (await save([{ ...note, revision: 6, notes: 'Reassigned PIC retains evidence' }], 5, p2!.accessToken)).items[0]!;
      assert.equal(reassigned.evidenceId, evidence.id);
      assert.equal(reassigned.revision, 7);
      await api('GET', `/storage/download?uploadId=${evidence.id}`, undefined, p2!.accessToken, 404);
      await save([{ ...note, revision: 7, evidenceId: replacement.id }], 5, p2!.accessToken, 400);
      await db.picAssignment.update({ where: { healthCenterId_indicatorId_year: {
        healthCenterId: center.id, indicatorId: note.indicatorId, year: 2026,
      } }, data: { picUserId: pic.id } });
      const stored = await db.upload.findUniqueOrThrow({ where: { id: evidence.id } });
      assert.equal(stored.status, 'ATTACHED');
      assert.equal(stored.userId, admin.id);
      const response = await request('GET', `/storage/download?uploadId=${evidence.id}`);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), evidence.bytes);
    });

    await t.test('year activity, year lock, monthly lock and cumulative quarterly locks protect writes', async () => {
      await api('PUT', endpoint, { ...body(), year: 2025 }, a!.accessToken, 409);
      await db.yearPeriod.update({ where: { year: 2026 }, data: { isLocked: true } });
      await save([note], 6, a!.accessToken, 409);
      await db.yearPeriod.update({ where: { year: 2026 }, data: { isLocked: false } });
      for (const isQuarter of [false, true]) {
        const lock = await db.periodLock.create({ data: { healthCenterId: center.id, year: 2026, periodNumber: isQuarter ? 3 : 6, isQuarter, status: 'SUBMITTED' } });
        await save([note], 6, a!.accessToken, 409);
        await db.periodLock.delete({ where: { id: lock.id } });
      }
      await save([note], 6);
      assert.equal((await api<Result>('GET', `${endpoint}?year=2026&month=6`)).items.length, 1);
    });

    await t.test('SQL guards mirror shape, revision, identity, evidence, active year and period locks', async () => {
      const row = await db.monthlyObservation.findFirstOrThrow({ where: { healthCenterId: center.id, month: 6 } });
      for (const data of [{ revision: 1 }, { revision: 3 }, { revision: 2, notes: null }, { revision: 2, value: 0 },
        { revision: 2, indicatorId: 'K1-R8' }, { revision: 2, healthCenterId: other.id },
        { revision: 2, updatedBy: secondPic.id }, { revision: 2, kind: 'NUMBER', unit: 'count', value: NaN },
        { revision: 2, kind: 'NUMBER', unit: 'count', value: Infinity },
      ]) await assert.rejects(() => db.monthlyObservation.update({ where: { id: row.id }, data }));
      await db.yearPeriod.update({ where: { year: 2026 }, data: { isLocked: true } });
      await assert.rejects(() => db.monthlyObservation.update({ where: { id: row.id }, data: { revision: 2 } }));
      await assert.rejects(() => db.monthlyObservation.delete({ where: { id: row.id } }));
      await db.yearPeriod.update({ where: { year: 2026 }, data: { isLocked: false } });
      const lock = await db.periodLock.create({ data: { healthCenterId: center.id, year: 2026, periodNumber: 4, isQuarter: true, status: 'VERIFIED' } });
      await assert.rejects(() => db.monthlyObservation.update({ where: { id: row.id }, data: { revision: 2 } }));
      await assert.rejects(() => db.monthlyObservation.delete({ where: { id: row.id } }));
      await db.periodLock.delete({ where: { id: lock.id } });
      await db.periodSettings.update({ where: { id: 1 }, data: { activeYear: 2027 } });
      await assert.rejects(() => db.monthlyObservation.update({ where: { id: row.id }, data: { revision: 2 } }));
      await db.periodSettings.update({ where: { id: 1 }, data: { activeYear: 2026 } });
      assert.equal((await db.monthlyObservation.findUniqueOrThrow({ where: { id: row.id } })).revision, 1);
    });

    await t.test('observation-only year deletion is rejected by HTTP guard and database FK', async () => {
      await db.periodSettings.update({ where: { id: 1 }, data: { activeYear: 2027 } });
      await api('PUT', endpoint, { ...body(), year: 2027 });
      await db.periodSettings.update({ where: { id: 1 }, data: { activeYear: 2026 } });
      await api('DELETE', '/master/years/2027', undefined, d!.accessToken, 409);
      await assert.rejects(() => db.yearPeriod.delete({ where: { year: 2027 } }), /Foreign key constraint/);
    });

    await t.test('all observation edits leave original monthly rows, recaps, and analytics identical', async () => {
      assert.deepEqual(await db.monthlyRecord.findMany(), oldMonthly);
      assert.deepEqual(await db.periodRecap.findMany(), oldRecaps);
      // No final analytics timestamp or score is influenced by observation updatedAt.
      assert.deepEqual(await Promise.all(analyticsPaths.map(path => api('GET', path))), analyticsBefore);
    });
  } finally { await app.close(); }
});
