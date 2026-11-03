import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { MonthlyObservation, Role } from '@prisma/client';
import { Actor, ROLES_KEY } from '../src/core/auth.decorators';
import { DbService } from '../src/core/db.service';
import { MonthlyObservationsController } from '../src/operations/monthly-observations.controller';
import { MAX_OBSERVATION_NUMBER, MonthlyObservationInput, MonthlyObservationQuery, SaveMonthlyObservationsDto } from '../src/operations/monthly-observations.dto';
import { MonthlyObservationsService, observationPayload } from '../src/operations/monthly-observations.service';

const tenant = '00000000-0000-4000-8000-000000000001';
const evidenceId = '00000000-0000-4000-8000-000000000002';
const actor: Actor = { id: 'admin', name: 'Admin', role: Role.ADMIN_PUSKESMAS, healthCenterId: tenant, sessionId: 'session', tokenVersion: 0 };
const note: MonthlyObservationInput = { indicatorId: 'K1-R9', revision: 0, kind: 'NOTE', status: 'RECORDED', notes: 'Observation, not a score' };
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transformOptions: { enableImplicitConversion: false } });
const validate = (records: unknown, changes = {}) => pipe.transform({ year: 2026, month: 1, records, ...changes }, { type: 'body', metatype: SaveMonthlyObservationsDto });

test('observation DTO accepts nullable payloads and JSON numeric precision without scoring coercions', async () => {
  for (const record of [note,
    { ...note, kind: 'NUMBER', value: 0.123456789123456, unit: 'items' },
    { ...note, kind: 'RATIO', value: MAX_OBSERVATION_NUMBER, denominator: 0, unit: 'people' },
    { ...note, kind: 'DOCUMENT', documentAvailable: false },
    { ...note, status: 'NOT_DUE', value: null, denominator: null, documentAvailable: null, unit: null, sourceReference: null, evidenceId: null },
  ]) {
    const dto = await validate([record]);
    assert.equal(dto.records[0].value, 'value' in record ? record.value : undefined);
    assert.doesNotThrow(() => observationPayload(dto.records[0]));
  }
});

const malformed = [null, [], {}, { ...note, revision: undefined }, { ...note, revision: null }, { ...note, revision: '0' },
  { ...note, revision: -1 }, { ...note, revision: 0.1 }, { ...note, revision: 2147483647 },
  { ...note, kind: null }, { ...note, kind: 'SCORE' }, { ...note, status: 'SCORED' },
  { ...note, value: '1' }, { ...note, value: NaN }, { ...note, value: Infinity }, { ...note, value: -1 },
  { ...note, value: MAX_OBSERVATION_NUMBER + 1 }, { ...note, denominator: -1 }, { ...note, documentAvailable: 'false' },
  { ...note, evidenceId: '' }, { ...note, evidenceId: 1 }, { ...note, notes: 'a'.repeat(4001) },
  { ...note, unit: 'a'.repeat(101) }, { ...note, sourceReference: 'a'.repeat(1001) },
  { ...note, scoringVersion: 'DO_2026_V2' }, { ...note, healthCenterId: tenant },
];
for (const [index, record] of malformed.entries()) test(`observation DTO rejects malformed row ${index}`, async () => {
  await assert.rejects(() => validate([record]));
});

test('strict root/query whitelist and batch boundaries are enforced', async () => {
  for (const records of [undefined, null, {}, [], [note, note], Array.from({ length: 501 }, (_, i) => ({ ...note, indicatorId: String(i) }))]) await assert.rejects(() => validate(records));
  for (const change of [{ year: '2026' }, { year: null }, { year: 10000 }, { month: '1' }, { month: 0 }, { month: 13 }, { healthCenterId: tenant }, { scoringVersion: 'DO_2026_V2' }]) await assert.rejects(() => validate([note], change));
  const query = await pipe.transform({ year: '2026', month: '1', healthCenterId: tenant }, { type: 'query', metatype: MonthlyObservationQuery });
  assert.deepEqual([query.year, query.month], [2026, 1]);
  await assert.rejects(() => pipe.transform({ year: '2026', month: '1', klasterId: '1' }, { type: 'query', metatype: MonthlyObservationQuery }));
});

const invalidShapes = [
  { ...note, notes: null }, { ...note, notes: ' \n\t\u200B\uFEFF' },
  { ...note, value: 0 }, { ...note, denominator: 0 }, { ...note, documentAvailable: false }, { ...note, unit: 'documents' },
  { ...note, kind: 'NUMBER', value: null, unit: 'people' }, { ...note, kind: 'NUMBER', value: 0, unit: null },
  { ...note, kind: 'NUMBER', value: 0, unit: ' \u200B' }, { ...note, kind: 'NUMBER', value: 0, unit: 'people', denominator: 1 },
  { ...note, kind: 'RATIO', value: 0, unit: 'people' }, { ...note, kind: 'RATIO', value: 0, denominator: 0 },
  { ...note, kind: 'RATIO', value: 0, denominator: 0, unit: 'people', documentAvailable: true },
  { ...note, kind: 'DOCUMENT' }, { ...note, kind: 'DOCUMENT', documentAvailable: false, value: 0 },
  { ...note, kind: 'DOCUMENT', documentAvailable: true, unit: 'documents' },
  ...(['NOT_DUE', 'NOT_AVAILABLE'] as const).flatMap(status => [
    { ...note, status, notes: '' }, { ...note, status, value: 0 }, { ...note, status, denominator: 0 }, { ...note, status, documentAvailable: false },
  ]),
];
for (const [index, record] of invalidShapes.entries()) test(`observation payload rejects incompatible shape ${index}`, () => {
  assert.throws(() => observationPayload(record as MonthlyObservationInput));
});

function fixture() {
  const rows: MonthlyObservation[] = [];
  const audits: any[] = [];
  const uploads = [{ id: evidenceId, healthCenterId: tenant, year: 2026, month: 1, status: 'READY', etag: 'etag', userId: 'pic' }];
  const events: string[] = [];
  const state = { year: 2026, isLocked: false, lockedMonth: false, assigned: true, active: true, activeIndicators: true, failAudit: false };
  let tail = Promise.resolve();
  const db: any = {
    $queryRaw: async (sql: TemplateStringsArray) => {
      const text = sql.join('');
      events.push(text.includes('period_settings') ? 'settings' : text.includes('uploads') ? 'evidence' : 'year');
      return text.includes('period_settings') ? [{ activeYear: state.year }] : [{ year: 2026, isLocked: state.isLocked }];
    },
    healthCenter: { findFirst: async () => state.active ? { id: tenant } : null },
    indicator: { count: async ({ where }: any) => state.activeIndicators ? where.id.in.length : 0 },
    picAssignment: { count: async ({ where }: any) => state.assigned ? where.indicatorId.in.length : 0 },
    periodLock: { findFirst: async () => state.lockedMonth ? { id: 'lock' } : null },
    upload: {
      findFirst: async ({ where }: any) => uploads.find(row => row.id === where.id && row.healthCenterId === where.healthCenterId && row.year === where.year && row.month === where.month && where.status.in.includes(row.status) && (!where.userId || row.userId === where.userId)),
      update: async ({ where, data }: any) => Object.assign(uploads.find(row => row.id === where.id)!, data),
    },
    monthlyObservation: {
      findUnique: async ({ where }: any) => rows.find(row => Object.entries(where.healthCenterId_indicatorId_year_month).every(([key, value]) => row[key as keyof MonthlyObservation] === value)) ?? null,
      findMany: async ({ where }: any) => rows.filter(row => row.healthCenterId === where.healthCenterId && row.year === where.year && row.month === where.month),
      create: async ({ data }: any) => { const row = { ...data, id: String(rows.length), createdAt: new Date(), updatedAt: new Date() }; rows.push(row); return row; },
      update: async ({ where, data }: any) => { const index = rows.findIndex(row => row.id === where.id && row.revision === where.revision); const row = { ...rows[index], ...data, updatedAt: new Date() }; rows[index] = row; return row; },
    },
    auditLog: { create: async ({ data }: any) => { if (state.failAudit) throw new Error('Audit unavailable'); audits.push(data); return data; } },
    $transaction: (callback: any) => {
      const result = tail.then(async () => {
        const previous = { rows: structuredClone(rows), uploads: structuredClone(uploads), audits: structuredClone(audits) };
        try { return await callback(db); }
        catch (error) { rows.splice(0, rows.length, ...previous.rows); uploads.splice(0, uploads.length, ...previous.uploads); audits.splice(0, audits.length, ...previous.audits); throw error; }
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return { service: new MonthlyObservationsService(db as DbService), rows, audits, uploads, events, state };
}

const save = (service: MonthlyObservationsService, records = [note], user = actor) => service.save(user, { year: 2026, month: 1, records });

test('storage API round-trips raw numbers, zero denominator and false without adding score fields', async () => {
  const { service, events } = fixture();
  const input: MonthlyObservationInput = { ...note, kind: 'RATIO', value: 0.123456789123456, denominator: 0, unit: 'items/prescription' };
  const result = await save(service, [input]);
  assert.deepEqual(events, ['settings', 'year']);
  assert.equal(result.items[0]!.revision, 1);
  assert.equal(result.items[0]!.value, input.value);
  assert.equal(result.items[0]!.denominator, 0);
  assert.deepEqual(Object.keys(result.items[0]!).sort(), ['id', 'healthCenterId', 'indicatorId', 'year', 'month', 'revision', 'kind', 'status', 'value', 'denominator', 'documentAvailable', 'unit', 'notes', 'sourceReference', 'evidenceId', 'updatedAt'].sort());
  assert.deepEqual(await service.list(actor, { year: 2026, month: 1 }), result);
  assert.deepEqual(await service.list(actor, { year: 2025, month: 1 }), { items: [] });
});

test('create/update revisions, races and complete transactional audit reject stale and partial batches', async () => {
  const { service, rows, audits, state } = fixture();
  await save(service);
  await assert.rejects(() => save(service), /revision changed/);
  const results = await Promise.allSettled([1, 2].map(i => save(service, [{ ...note, revision: 1, notes: String(i) }])));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(rows[0]!.revision, 2);
  await assert.rejects(() => save(service, [{ ...note, indicatorId: 'K1-R8' }, note]), /revision changed/);
  assert.equal(rows.length, 1);
  assert.equal(audits.length, 2);
  const long = 'x'.repeat(4000);
  await save(service, [{ ...note, revision: 2, notes: long }]);
  assert.equal(audits[2].details.value.notes, long);
  assert.equal(audits[2].details.previous.revision, 2);
  state.failAudit = true;
  await assert.rejects(() => save(service, [{ ...note, revision: 3 }]), /Audit unavailable/);
  assert.equal(rows[0]!.revision, 3);
  assert.equal(audits.length, 3);
});

test('evidence omission preserves, explicit null clears, and attachment/audit roll back together', async () => {
  const { service, uploads, rows, audits } = fixture();
  await assert.rejects(() => save(service, [{ ...note, evidenceId }, { ...note, indicatorId: 'K1-R8', revision: 2 }]), /revision changed/);
  assert.equal(uploads[0]!.status, 'READY');
  assert.equal(rows.length, 0);
  assert.equal(audits.length, 0);
  await save(service, [{ ...note, evidenceId }]);
  assert.equal(uploads[0]!.status, 'ATTACHED');
  assert.equal((await save(service, [{ ...note, revision: 1 }])).items[0]!.evidenceId, evidenceId);
  assert.equal((await save(service, [{ ...note, revision: 2, evidenceId: null }])).items[0]!.evidenceId, null);
  assert.equal(uploads[0]!.status, 'ATTACHED', 'cleared links never make historical evidence eligible for pending cleanup');
});

test('evidence rejects wrong scope, pending/unfinalized uploads and new attachments owned by another user', async () => {
  for (const change of [{ healthCenterId: 'other' }, { year: 2025 }, { month: 2 }, { status: 'PENDING' }, { etag: '' }, { userId: 'other' }]) {
    const { service, uploads } = fixture();
    Object.assign(uploads[0]!, change);
    await assert.rejects(() => save(service, [{ ...note, evidenceId }], { ...actor, id: 'pic', role: Role.PIC }), /Evidence must/);
  }
  for (const change of [{ healthCenterId: 'other' }, { year: 2025 }, { month: 2 }, { status: 'PENDING' }, { etag: '' }]) {
    const { service, uploads } = fixture();
    await save(service, [{ ...note, evidenceId }]);
    Object.assign(uploads[0]!, change);
    await assert.rejects(() => save(service, [{ ...note, revision: 1 }], { ...actor, id: 'pic', role: Role.PIC }), /Evidence must/);
  }
});

test('assigned PIC retains unchanged evidence from admin or former PIC but cannot replace it with foreign evidence', async () => {
  const pic = { ...actor, id: 'pic', role: Role.PIC };
  for (const uploader of ['admin', 'former-pic']) {
    const { service, uploads, rows, audits } = fixture();
    uploads[0]!.userId = uploader;
    await save(service, [{ ...note, evidenceId }]);
    for (const [index, attachment] of [{}, { evidenceId }].entries()) {
      const result = await save(service, [{ ...note, revision: index + 1, notes: 'Updated by assigned PIC', ...attachment }], pic);
      assert.equal(result.items[0]!.evidenceId, evidenceId);
      assert.equal(result.items[0]!.notes, 'Updated by assigned PIC');
      assert.equal(audits[index + 1].details.previous.evidenceId, evidenceId);
      assert.equal(audits[index + 1].details.value.evidenceId, evidenceId);
    }
    const replacementId = '00000000-0000-4000-8000-000000000003';
    uploads.push({ ...uploads[0]!, id: replacementId, status: 'READY' });
    await assert.rejects(() => save(service, [{ ...note, revision: 3, evidenceId: replacementId }], pic), /Evidence must/);
    assert.equal(rows[0]!.revision, 3);
    assert.equal(rows[0]!.evidenceId, evidenceId);
    assert.equal(uploads[1]!.status, 'READY');
    assert.equal(audits.length, 3);
    await save(service, [{ ...note, revision: 3, evidenceId: null }], pic);
    await assert.rejects(() => save(service, [{ ...note, revision: 4, evidenceId }], pic), /Evidence must/);
  }
});

test('tenant, role, PIC assignment, catalog activity and period gates are independent of scoring profiles', async () => {
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, MonthlyObservationsController.prototype.save), [Role.ADMIN_PUSKESMAS, Role.PIC]);
  const { service, state } = fixture();
  assert.throws(() => save(service, [note], { ...actor, role: Role.DINKES_ADMIN, healthCenterId: null }), /Role access denied/);
  await assert.rejects(() => service.list(actor, { year: 2026, month: 1, healthCenterId: evidenceId }), /Tenant access denied/);
  await assert.rejects(() => service.list({ ...actor, role: Role.DINKES_ADMIN, healthCenterId: null }, { year: 2026, month: 1 }), /healthCenterId/);
  assert.deepEqual(await service.list({ ...actor, role: Role.DINKES_ADMIN, healthCenterId: null }, { year: 2026, month: 1, healthCenterId: tenant }), { items: [] });
  state.year = 2025;
  await assert.rejects(() => save(service), /not the active year/);
  state.year = 2026; state.isLocked = true;
  await assert.rejects(() => save(service), /Year period is locked/);
  state.isLocked = false; state.lockedMonth = true;
  await assert.rejects(() => save(service), /Month is protected/);
  state.lockedMonth = false; state.active = false;
  await assert.rejects(() => save(service), /Active health center/);
  state.active = true; state.activeIndicators = false;
  await assert.rejects(() => save(service), /Unknown or inactive indicator/);
  state.activeIndicators = true; state.assigned = false;
  await assert.rejects(() => save(service, [note], { ...actor, role: Role.PIC }), /assigned indicators/);
  await save(service);
});
