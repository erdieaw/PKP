import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Role } from '@prisma/client';
import { validate } from 'class-validator';
import { Actor, ROLES_KEY } from '../src/core/auth.decorators';
import { activePeriod, lockYear } from '../src/core/period';
import { OperationsController } from '../src/operations/operations.controller';
import { ActiveYearDto } from '../src/operations/operations.dto';
import { OperationsService } from '../src/operations/operations.service';
import { IntegrationService } from '../src/integrations/integrations.service';

const actor: Actor = { id: 'dinkes', name: 'Dinkes', role: Role.DINKES_ADMIN, healthCenterId: null, sessionId: 'session', tokenVersion: 0 };

function fixture() {
  const settings = { activeYear: null as number | null, revision: 0 };
  const years = new Map([2024, 2026].map(year => [year, { year, provinceEnabled: false, isLocked: false, cutoffDay: 10 }]));
  const locks: string[] = [];
  // Model the singleton row's transaction serialization without touching the runtime DB.
  let tail = Promise.resolve();
  const db: any = {
    $queryRaw: async (sql: TemplateStringsArray, year: number) => {
      if (sql.join('').includes('period_settings')) { locks.push('settings'); return [{ ...settings }]; }
      locks.push(`year:${year}`);
      return years.has(year) ? [{ ...years.get(year) }] : [];
    },
    periodSettings: {
      findUnique: async () => ({ ...settings, period: settings.activeYear === null ? null : years.get(settings.activeYear) }),
      update: async ({ data }: any) => { settings.activeYear = data.activeYear; settings.revision++; return { ...settings }; },
    },
    yearPeriod: {
      update: async ({ where, data }: any) => { Object.assign(years.get(where.year)!, data); return years.get(where.year); },
      findMany: async () => [...years.values()],
      create: async ({ data }: any) => { years.set(data.year, { ...data, provinceEnabled: false }); return years.get(data.year); },
    },
    auditLog: { create: async () => ({}) },
    $transaction: (fn: any) => {
      const result = tail.then(() => fn(db));
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return { db, service: new OperationsService(db), settings, years, locks };
}

test('only Dinkes may manage years at controller and service boundaries', async () => {
  const { service } = fixture();
  for (const method of ['createYear', 'setYear', 'deleteYear', 'setActiveYear'] as const) {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, OperationsController.prototype[method]), [Role.DINKES_ADMIN]);
  }
  for (const role of [Role.ADMIN_PUSKESMAS, Role.PIC]) {
    const denied = { ...actor, role, healthCenterId: 'tenant' };
    for (const invoke of [() => service.createYear(denied, { year: 2027 }), () => service.setYear(denied, 2026, { cutoffDay: 5 }),
      () => service.deleteYear(denied, 2024), () => service.setActiveYear(denied, { year: 2026, provinceEnabled: true, revision: 0 })]) {
      await assert.rejects(async () => invoke(), /role/i);
    }
  }
});

test('bootstrap fails closed, creation never selects a year, historical lists still work', async () => {
  const { service, db, locks } = fixture();
  assert.deepEqual(await service.activeYear(), { year: null, provinceEnabled: false, revision: 0 });
  await service.createYear(actor, { year: 2027 });
  assert.equal((await service.activeYear()).year, null);
  assert.equal((await service.years()).length, 3);
  await assert.rejects(() => lockYear(db, 2026, true), /not the active year/);
  assert.deepEqual(locks, ['settings']);
  db.periodSettings.findUnique = async () => null;
  assert.deepEqual(await activePeriod(db), { activeYear: null, provinceEnabled: false, periodRevision: 0 });
  db.$queryRaw = async () => [];
  await assert.rejects(() => lockYear(db, 2026), /not configured/);
});

test('activation selects existing year atomically, stale/unknown selections leave state intact', async () => {
  const { service, settings, years, locks } = fixture();
  assert.deepEqual(await service.setActiveYear(actor, { year: 2026, provinceEnabled: true, revision: 0 }), { year: 2026, provinceEnabled: true, revision: 1 });
  assert.deepEqual(locks, ['settings', 'year:2026']);
  assert.equal(years.get(2026)!.provinceEnabled, true);
  await assert.rejects(() => service.setActiveYear(actor, { year: 2024, provinceEnabled: false, revision: 0 }), /revision changed/);
  await assert.rejects(() => service.setActiveYear(actor, { year: 2025, provinceEnabled: false, revision: 1 }), /not found/);
  assert.deepEqual(settings, { activeYear: 2026, revision: 1 });
  assert.equal(years.get(2024)!.provinceEnabled, false);
  await assert.rejects(() => service.deleteYear(actor, 2026), /cannot be deleted/);
  assert.deepEqual(await service.setActiveYear(actor, { year: 2024, provinceEnabled: false, revision: 1 }), { year: 2024, provinceEnabled: false, revision: 2 });
  // The switch belongs to the selected year; old year's setting is retained.
  assert.equal(years.get(2026)!.provinceEnabled, true);
});

test('concurrent selection with same revision permits one winner; old writes freeze', async () => {
  const { service, db, locks } = fixture();
  const results = await Promise.allSettled([2024, 2026].map(year => service.setActiveYear(actor, { year, provinceEnabled: false, revision: 0 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  locks.length = 0;
  await lockYear(db, 2024);
  assert.deepEqual(locks, ['settings', 'year:2024']);
  await service.setActiveYear(actor, { year: 2026, provinceEnabled: false, revision: 1 });
  await assert.rejects(() => lockYear(db, 2024, true), /not the active year/);
  await lockYear(db, 2026);
});

test('DTO forbids clearing selection and requires strict boolean and optimistic revision', async () => {
  for (const body of [{ year: null, provinceEnabled: false, revision: 0 }, { year: 2026, provinceEnabled: 'false', revision: 0 },
    { year: 2026, provinceEnabled: false }, { year: 2026, provinceEnabled: false, revision: -1 }]) {
    assert.ok((await validate(Object.assign(new ActiveYearDto(), body))).length > 0);
  }
  assert.equal((await validate(Object.assign(new ActiveYearDto(), { year: 2026, provinceEnabled: false, revision: 0 }))).length, 0);
});

test('active selection does not bypass year lock rules; allowLocked never bypasses active selection', async () => {
  const { db, settings, years } = fixture();
  settings.activeYear = 2026;
  years.get(2026)!.isLocked = true;
  await assert.rejects(() => lockYear(db, 2026), /Year period is locked/);
  assert.equal((await lockYear(db, 2026, true)).year, 2026);
  await assert.rejects(() => lockYear(db, 2024, true), /not the active year/);
});

test('action plan derives historical year from recommendation and fails closed', async () => {
  const { service, db, settings, locks } = fixture();
  settings.activeYear = 2026;
  let writes = 0;
  db.recommendation = { findFirst: async () => ({ id: 'recommendation', year: 2024 }), update: async () => { writes++; } };
  await assert.rejects(() => service.actionPlan({ ...actor, role: Role.ADMIN_PUSKESMAS, healthCenterId: '00000000-0000-4000-8000-000000000001' }, 'recommendation', { actionPlanText: 'Plan' }), /not the active year/);
  assert.equal(writes, 0);
  assert.deepEqual(locks, ['settings']);
});

test('storage finalize derives year from stored upload and rejects inactive pending uploads before object access', async () => {
  const { db, settings, locks } = fixture();
  settings.activeYear = 2026;
  const healthCenterId = '00000000-0000-4000-8000-000000000001';
  const upload = { id: 'upload', year: 2024, month: 1, healthCenterId, status: 'PENDING' };
  db.upload = { findUnique: async () => upload };
  const service = Object.assign(Object.create(IntegrationService.prototype), { db });
  await assert.rejects(() => service.finalize({ ...actor, role: Role.ADMIN_PUSKESMAS, healthCenterId }, 'upload'), /not the active year/);
  assert.deepEqual(locks, ['settings']);
  // Idempotent historical READY reads do not mutate storage or require an active period.
  upload.status = 'READY';
  assert.equal(await service.finalize({ ...actor, role: Role.ADMIN_PUSKESMAS, healthCenterId }, 'upload'), upload);
});

test('bridge status reflects selected period but never advertises province write support', async () => {
  const { db, settings, years } = fixture();
  const service = Object.assign(Object.create(IntegrationService.prototype), { db }) as IntegrationService;
  const healthCenterId = '00000000-0000-4000-8000-000000000001';
  assert.equal((await service.bridgeStatus(actor, healthCenterId)).enabled, false);
  settings.activeYear = 2026;
  settings.revision = 1;
  years.get(2026)!.provinceEnabled = true;
  const status = await service.bridgeStatus(actor, healthCenterId);
  assert.equal(status.activeYear, 2026);
  assert.equal(status.periodRevision, 1);
  assert.equal(status.enabled, true);
  assert.equal(status.readOnly, true);
  assert.equal(status.canWrite, false);
  await assert.rejects(() => service.bridgeSync(actor, healthCenterId), /Province writes are unavailable/);
});
