import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { Role } from '@prisma/client';
import { chromium } from 'playwright';
import { ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Actor, ROLES_KEY } from '../src/core/auth.decorators';
import { DbService } from '../src/core/db.service';
import { fulfillProvinceRequest, ProvinceAdapter, provinceRequestAllowed, provinceRows } from '../src/integrations/province.adapter';
import { validate } from 'class-validator';
import { ProvinceLogsQueryDto, ProvinceMappingsDto, ProvincePreviewDto } from '../src/integrations/province.dto';
import { ProvinceController } from '../src/integrations/province.controller';
import { decryptProvincePassword, encryptProvincePassword } from '../src/integrations/province.crypto';
import { ProvinceService } from '../src/integrations/province.service';

process.env.PROVINCE_CREDENTIAL_KEY = randomBytes(32).toString('base64');
const actor: Actor = { id: 'admin', name: 'Admin', role: Role.ADMIN_PUSKESMAS, healthCenterId: 'tenant-a', sessionId: 'session', tokenVersion: 0 };

function fixture() {
  const configs = new Map<string, any>();
  const logs: any[] = [];
  const mappings: any[] = [];
  const targets = [{ healthCenterId: 'tenant-a', year: 2024, indicatorId: 'local', targetPct: 0, totalSasaran: 0, targetSasaran: 0 }];
  const records = [{ ...targets[0], month: 2, pencapaianRiil: 0, capaianRiilPct: null, nilaiKinerja: 0, scoringVersion: 'LOCAL' }];
  const calls: string[] = [];
  const period = { activeYear: 2024 as number | null, revision: 0, period: { provinceEnabled: true } };
  const db: any = {
    auditLog: {
      create: async ({ data }: any) => { logs.push({ ...structuredClone(data), id: String(logs.length).padStart(5, '0'), createdAt: new Date('2026-10-19T00:00:00Z') }); },
      findMany: async ({ where, skip, take, select }: any) => logs.filter(row => row.healthCenterId === where.healthCenterId
        && where.action.in.includes(row.action) && row.details.schemaVersion === where.details.equals)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(skip, skip + take)
        .map(row => Object.fromEntries(Object.keys(select).map(key => [key, row[key]]))),
    },
    periodSettings: { findUnique: async () => structuredClone(period) },
    $queryRaw: async () => [{ activeYear: period.activeYear, revision: period.revision }],
    provinceConfig: {
      findUnique: async ({ where, select }: any) => {
        const value = configs.get(where.healthCenterId);
        return value ? select ? Object.fromEntries(Object.keys(select).map(key => [key, value[key]])) : { ...value } : null;
      },
      create: async ({ data }: any) => { configs.set(data.healthCenterId, { ...data, revision: 1 }); },
      updateMany: async ({ where, data }: any) => {
        const current = configs.get(where.healthCenterId);
        if (!current || current.revision !== where.revision) return { count: 0 };
        configs.set(where.healthCenterId, { ...current, ...data, revision: current.revision + 1 });
        return { count: 1 };
      },
    },
    provinceMapping: {
      findMany: async ({ where, include }: any) => mappings.filter(row => row.healthCenterId === where.healthCenterId)
        .map(row => include ? { ...row, indicator: { isActive: true } } : { indicatorId: row.indicatorId, provinceCode: row.provinceCode }),
      deleteMany: async ({ where }: any) => { for (let i = mappings.length - 1; i >= 0; i--) if (mappings[i].healthCenterId === where.healthCenterId) mappings.splice(i, 1); },
      createMany: async ({ data }: any) => { mappings.push(...data); },
    },
    indicator: { count: async ({ where }: any) => where.id.in.filter((id: string) => ['local', 'missing'].includes(id)).length },
    annualTarget: { findMany: async ({ where }: any) => targets.filter(row => row.healthCenterId === where.healthCenterId && row.year === where.year) },
    monthlyRecord: { findMany: async ({ where }: any) => records.filter(row => row.healthCenterId === where.healthCenterId && row.year === where.year && row.month === where.month) },
    $transaction: async (fn: any) => fn(db),
  };
  const adapter = { read: async (credentials: any) => {
    calls.push(credentials.username);
    return { provinceHealthCenterCode: credentials.provinceHealthCenterCode,
      targets: [{ kd_ind: '01.02', total_sasaran: '0' }, { kd_ind: '02.03', total_sasaran: '2' }],
      months: [{ bulan: '02', nama: 'Februari' }], monthly: [{ bulan: '02', kdindikator: '01.02', capaian: '0', sasaran: 'Dokumen' }] };
  } };
  return { service: new ProvinceService(db as DbService, adapter as unknown as ProvinceAdapter), db, configs, mappings, calls, period, adapter, logs };
}

test('AES-GCM is randomized, authenticated, tenant-bound and fails closed without a valid key', () => {
  const encrypted = encryptProvincePassword('secret', 'tenant-a');
  assert.notEqual(encrypted, encryptProvincePassword('secret', 'tenant-a'));
  assert.equal(decryptProvincePassword(encrypted, 'tenant-a'), 'secret');
  assert.throws(() => decryptProvincePassword(encrypted, 'tenant-b'), /cannot be decrypted/);
  assert.throws(() => decryptProvincePassword(`${encrypted}x`, 'tenant-a'), /cannot be decrypted/);
  const key = process.env.PROVINCE_CREDENTIAL_KEY;
  try {
    for (const value of ['', 'bad', randomBytes(16).toString('base64')]) {
      process.env.PROVINCE_CREDENTIAL_KEY = value;
      assert.throws(() => encryptProvincePassword('secret', 'tenant-a'), /not configured/);
    }
  } finally { process.env.PROVINCE_CREDENTIAL_KEY = key; }
});

test('all service entrypoints require own-tenant admin and controller roles match', async () => {
  const { service } = fixture();
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, ProvinceController), [Role.ADMIN_PUSKESMAS]);
  for (const rejected of [{ ...actor, role: Role.DINKES_ADMIN }, { ...actor, role: Role.PIC }, { ...actor, healthCenterId: null }]) {
    for (const invoke of [() => service.config(rejected), () => service.saveConfig(rejected, {} as any),
      () => service.test(rejected), () => service.catalog(rejected), () => service.mappings(rejected),
      () => service.saveMappings(rejected, { revision: 0, items: [] }), () => service.preview(rejected, {} as any),
      () => service.logs(rejected, new ProvinceLogsQueryDto())]) {
      await assert.rejects(invoke, /Own-tenant/);
    }
  }
});

test('integration logs persist every operation outcome, redact inputs/errors and exclude passive reads', async () => {
  const { service, logs, adapter, db } = fixture();
  const sensitive = 'username password cookie NIP raw-portal-body';
  await service.saveConfig({ ...actor, name: sensitive }, { revision: 0, username: sensitive, password: sensitive, provinceHealthCenterCode: sensitive });
  await service.test(actor);
  await service.catalog(actor);
  await service.saveMappings(actor, { revision: 1, items: [] });
  await service.preview(actor, { operation: 'TARGETS' });
  assert.deepEqual(logs.map(row => row.action), ['PROVINCE_CONFIG_SAVE', 'PROVINCE_TEST', 'PROVINCE_CATALOG', 'PROVINCE_MAPPING_SAVE', 'PROVINCE_PREVIEW']);
  assert.ok(logs.every(row => row.details.status === 'SUCCESS' && row.details.errorCode === null && row.userId === actor.id));
  const error = new ServiceUnavailableException(sensitive);
  adapter.read = async () => { throw error; };
  for (const invoke of [() => service.test(actor), () => service.catalog(actor),
    () => service.saveMappings(actor, { revision: 2, items: [] }), () => service.preview(actor, { operation: 'TARGETS' })]) {
    await assert.rejects(invoke, value => value === error);
    assert.equal(logs.at(-1).details.status, 'FAILURE');
    assert.equal(logs.at(-1).details.errorCode, 'REMOTE_UNAVAILABLE');
  }
  // A transaction rollback still leaves a durable failure entry outside that transaction.
  db.$transaction = async () => { throw new Error(sensitive); };
  await assert.rejects(() => service.saveConfig(actor, { revision: 2, username: sensitive, provinceHealthCenterCode: sensitive }));
  assert.equal(logs.at(-1).details.errorCode, 'INTERNAL_ERROR');
  db.$transaction = async (fn: any) => fn(db);
  const count = logs.length;
  await service.config(actor);
  await service.mappings(actor);
  const response = await service.logs(actor, new ProvinceLogsQueryDto());
  assert.equal(logs.length, count);
  assert.doesNotMatch(JSON.stringify([logs, response]), /username|password|cookie|NIP|raw-portal-body/);
  assert.ok(response.items.every(row => row.durationMs !== null && row.durationMs >= 0));
  assert.deepEqual(Object.keys(response.items[0]!).sort(), ['action', 'actorId', 'durationMs', 'errorCode', 'id', 'status', 'timestamp']);
});

test('logs are tenant-isolated, deterministically paginated and available without a credential key', async () => {
  const { service, logs } = fixture();
  for (let i = 0; i < 5; i++) await assert.rejects(() => service.test(actor));
  await assert.rejects(() => service.test({ ...actor, healthCenterId: 'tenant-b' }));
  logs.push({ ...logs[0], id: 'unrelated', action: 'USER_UPDATED' });
  const key = process.env.PROVINCE_CREDENTIAL_KEY;
  try {
    delete process.env.PROVINCE_CREDENTIAL_KEY;
    const first = await service.logs(actor, { page: 1, limit: 2 });
    const second = await service.logs(actor, { page: 2, limit: 2 });
    const last = await service.logs(actor, { page: 3, limit: 2 });
    assert.equal(first.hasMore, true);
    assert.equal(second.hasMore, true);
    assert.equal(last.hasMore, false);
    assert.equal(new Set([...first.items, ...second.items, ...last.items].map(row => row.id)).size, 5);
    assert.deepEqual(first.items.map(row => row.id), ['00004', '00003']);
    assert.equal((await service.logs({ ...actor, healthCenterId: 'tenant-b' }, new ProvinceLogsQueryDto())).items.length, 1);
    assert.deepEqual((await service.logs(actor, { page: 4, limit: 2 })).items, []);
  } finally { process.env.PROVINCE_CREDENTIAL_KEY = key; }
});

test('audit persistence errors never replace the original failure or successful result', async t => {
  const { service, db, adapter } = fixture();
  await service.saveConfig(actor, { revision: 0, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
  const { Logger } = await import('@nestjs/common');
  const diagnostics: unknown[][] = [];
  t.mock.method(Logger.prototype, 'error', (...args: unknown[]) => { diagnostics.push(args); });
  db.auditLog.create = async () => { throw new Error('private database detail'); };
  assert.equal((await service.test(actor)).connectionStatus, 'CONNECTED');
  const original = new Error('private remote detail');
  adapter.read = async () => { throw original; };
  await assert.rejects(() => service.test(actor), error => error === original);
  assert.equal(diagnostics.length, 2);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private/);
});

test('logs query validates defaults, numeric bounds and forbids tenant overrides', async () => {
  assert.deepEqual({ ...new ProvinceLogsQueryDto() }, { page: 1, limit: 20 });
  for (const query of [{ limit: '101' }, { limit: '0' }, { limit: '1.5' }, { page: '-1' }, { page: '1000001' },
    { page: 'abc' }, { healthCenterId: 'tenant-b' }, { cursor: 'anything' }]) {
    assert.ok((await validate(plainToInstance(ProvinceLogsQueryDto, query), { whitelist: true, forbidNonWhitelisted: true })).length > 0);
  }
  assert.equal((await validate(plainToInstance(ProvinceLogsQueryDto, { page: '2', limit: '100' }))).length, 0);
});

test('configuration encrypts credentials, never returns secrets, enforces revision and tenant isolation', async () => {
  const { service, configs, calls } = fixture();
  const body = { revision: 0, username: 'account-a', password: 'secret', provinceHealthCenterCode: 'A' };
  const saved = await service.saveConfig(actor, body);
  assert.equal(saved.revision, 1);
  assert.equal(saved.hasPassword, true);
  assert.doesNotMatch(JSON.stringify(saved), /secret|passwordEncrypted/);
  assert.notEqual(configs.get('tenant-a').passwordEncrypted, 'secret');
  await assert.rejects(() => service.saveConfig(actor, body), /revision changed/);
  await service.saveConfig(actor, { ...body, revision: 1, password: undefined });
  const other = { ...actor, healthCenterId: 'tenant-b' };
  assert.equal((await service.config(other)).configured, false);
  await assert.rejects(() => service.catalog(other), /not configured/);
  await service.saveConfig(other, { ...body, username: 'account-b', provinceHealthCenterCode: 'B' });
  await service.catalog(other);
  await service.test(actor);
  assert.deepEqual(calls, ['account-b', 'account-a']);
});

test('mapping requires exact existing codes, unique pairs and active local indicators; replacement is tenant-scoped', async () => {
  const { service, mappings } = fixture();
  await service.saveConfig(actor, { revision: 0, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
  for (const items of [
    [{ indicatorId: 'local', provinceCode: '1.02' }],
    [{ indicatorId: 'inactive', provinceCode: '01.02' }],
    [{ indicatorId: 'local', provinceCode: '01.02' }, { indicatorId: 'missing', provinceCode: '01.02' }],
    [{ indicatorId: 'local', provinceCode: '01.02' }, { indicatorId: 'local', provinceCode: '02.03' }],
  ]) await assert.rejects(async () => service.saveMappings(actor, { revision: (await service.mappings(actor)).revision, items }));
  mappings.push({ healthCenterId: 'tenant-b', indicatorId: 'local', provinceCode: 'unrelated' });
  await service.saveMappings(actor, { revision: (await service.mappings(actor)).revision, items: [{ indicatorId: 'local', provinceCode: '01.02' }] });
  assert.equal((await service.mappings(actor)).items.length, 1);
  assert.equal(mappings.filter(row => row.healthCenterId === 'tenant-b').length, 1);
  await service.saveMappings(actor, { revision: (await service.mappings(actor)).revision, items: [] });
  assert.equal((await service.mappings(actor)).items.length, 0);
});

test('preview derives selected year, preserves zero/null and never writes local records', async () => {
  const { service, period } = fixture();
  await service.saveConfig(actor, { revision: 0, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
  await service.saveMappings(actor, { revision: 1, items: [{ indicatorId: 'local', provinceCode: '01.02' }, { indicatorId: 'missing', provinceCode: '02.03' }] });
  const target = await service.preview(actor, { operation: 'TARGETS' });
  assert.equal(target.localYear, 2024);
  assert.equal(target.readOnly, true);
  assert.equal(target.canWrite, false);
  assert.equal(target.remoteYear, null);
  assert.equal(target.items[0]!.local!.totalSasaran, 0);
  assert.equal(target.items[1]!.local, null);
  assert.equal(target.items[0]!.remote!.total_sasaran, '0');
  assert.ok(target.items[0]!.warnings.includes('FORMULA_EQUIVALENCE_UNVERIFIED'));
  const monthly = await service.preview(actor, { operation: 'MONTHLY', month: 2 });
  assert.equal(monthly.items[0]!.local!.pencapaianRiil, 0);
  assert.equal(monthly.items[0]!.local!.capaianRiilPct, null);
  assert.equal(monthly.items[0]!.remote!.sasaran, 'Dokumen');
  period.activeYear = 2025;
  period.revision++;
  assert.equal((await service.preview(actor, { operation: 'TARGETS' })).items[0]!.local, null);
  await assert.rejects(() => service.preview(actor, { operation: 'MONTHLY' }), /Month is required/);
});

test('disabled and unconfigured periods block remote operations but not config or mapping reads', async () => {
  const { service, period, calls } = fixture();
  for (const [year, enabled] of [[2024, false], [null, false], [null, true]] as const) {
    period.activeYear = year;
    period.period.provinceEnabled = enabled;
    const config = await service.saveConfig(actor, { revision: (await service.config(actor)).revision, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
    assert.equal(config.activeYear, year);
    assert.equal(config.provinceEnabled, enabled);
    await service.mappings(actor);
    for (const invoke of [() => service.test(actor), () => service.catalog(actor),
      () => service.preview(actor, { operation: 'TARGETS' }), () => service.saveMappings(actor, { revision: config.revision, items: [] })]) {
      await assert.rejects(invoke, /disabled or no active year/);
    }
  }
  assert.equal(calls.length, 0);
});

test('preview DTO rejects a client-supplied year', async () => {
  const body = Object.assign(new ProvincePreviewDto(), { operation: 'TARGETS', year: 2024 });
  const errors = await validate(body, { whitelist: true, forbidNonWhitelisted: true });
  assert.ok(errors.some(error => error.property === 'year'));
});

test('remote reads reject period revision changes even when selected year is restored', async () => {
  for (const operation of ['test', 'catalog', 'preview', 'saveMappings'] as const) {
    const { service, period, adapter } = fixture();
    await service.saveConfig(actor, { revision: 0, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
    const read = adapter.read;
    adapter.read = async credentials => { const result = await read(credentials); period.revision += 2; return result; };
    await assert.rejects(() => operation === 'preview' ? service.preview(actor, { operation: 'TARGETS' })
      : operation === 'saveMappings' ? service.saveMappings(actor, { revision: 1, items: [] }) : service[operation](actor), /Active period changed/);
  }
});

test('mapping commit and preview final response reject changes after remote validation', async () => {
  const { service, db, period } = fixture();
  await service.saveConfig(actor, { revision: 0, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
  const transaction = db.$transaction;
  db.$transaction = async (fn: any) => { period.revision++; return transaction(fn); };
  await assert.rejects(() => service.saveMappings(actor, { revision: 1, items: [] }), /Active period changed/);
  db.$transaction = transaction;
  db.annualTarget.findMany = async () => { period.revision++; return []; };
  await assert.rejects(() => service.preview(actor, { operation: 'TARGETS' }), /Active period changed/);
});

test('request policy denies mutations, arbitrary origins, query strings, redirects to unapproved paths and non-login POST', () => {
  const base = 'https://vfs-dinkes.com/pkp/';
  assert.equal(provinceRequestAllowed(`${base}api/login.php`, 'POST', true), true);
  assert.equal(provinceRequestAllowed(`${base}api/login.php`, 'POST', false), false);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal(provinceRequestAllowed(`${base}api/bulk_update_total_sasaran.php`, method, true), false);
    assert.equal(provinceRequestAllowed('https://evil.test/pkp/api/get_current_user.php', method, true), false);
  }
  assert.equal(provinceRequestAllowed(`${base}api/get_current_user.php`, 'GET', false), true);
  assert.equal(provinceRequestAllowed(`${base}api/get_current_user.php?url=evil`, 'GET', false), false);
  assert.equal(provinceRequestAllowed(`${base}api/get_current_user.php`, 'POST', true), false);
  assert.equal(provinceRequestAllowed(`${base}styles.css`, 'GET', false), false);
  const rows = provinceRows({ data: [{ kd_ind: '01', nip: 'private', cookie: 'private' }] }, ['kd_ind']);
  assert.deepEqual(rows, [{ kd_ind: '01' }]);
});

test('mapping client revisions reject stale replacement and clearing, with consistent GET reads', async () => {
  const { service, db, configs } = fixture();
  assert.equal((await service.mappings(actor)).revision, 0);
  await service.saveConfig(actor, { revision: 0, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
  const originalTransaction = db.$transaction;
  let isolation: string | undefined;
  db.$transaction = async (fn: any, options: any) => { isolation = options.isolationLevel; return originalTransaction(fn); };
  const before = await service.mappings(actor);
  assert.equal(isolation, 'RepeatableRead');
  const saved = await service.saveMappings(actor, { revision: before.revision, items: [{ indicatorId: 'local', provinceCode: '01.02' }] });
  assert.equal(saved.revision, before.revision + 1);
  for (const items of [[], [{ indicatorId: 'local', provinceCode: '02.03' }]]) {
    await assert.rejects(() => service.saveMappings(actor, { revision: before.revision, items }), /mapping revision changed/);
  }
  assert.deepEqual((await service.mappings(actor)).items, saved.items);
  // A race after the remote snapshot must still fail the transaction's revision guard.
  db.$transaction = async (fn: any) => { configs.get('tenant-a').revision++; return originalTransaction(fn); };
  await assert.rejects(() => service.saveMappings(actor, { revision: saved.revision, items: [] }), /changed during mapping validation/);
  const invalid = Object.assign(new ProvinceMappingsDto(), { items: [] });
  assert.ok((await validate(invalid)).some(error => error.property === 'revision'));
});

test('route fetch never follows redirects and only neutralizes the exact login dashboard redirect', async () => {
  const base = 'https://vfs-dinkes.com/pkp/';
  for (const scenario of [
    { method: 'POST', path: 'api/login.php', status: 302, location: '../puskesmas.html', accepted: true },
    { method: 'POST', path: 'api/login.php', status: 303, location: `${base}puskesmas.html`, accepted: true },
    { method: 'POST', path: 'api/login.php', status: 307, location: `${base}puskesmas.html`, accepted: false },
    { method: 'POST', path: 'api/login.php', status: 308, location: 'https://evil.test/steal', accepted: false },
    { method: 'POST', path: 'api/login.php', status: 302, location: 'https://evil.test/steal', accepted: false },
    { method: 'POST', path: 'api/login.php', status: 302, location: `${base}api/bulk_update_total_sasaran.php`, accepted: false },
    { method: 'POST', path: 'api/login.php', status: 302, location: `${base}puskesmas.html?password=secret`, accepted: false },
    { method: 'GET', path: 'api/get_current_user.php', status: 302, location: `${base}puskesmas.html`, accepted: false },
    { method: 'GET', path: 'puskesmas.html', status: 301, location: 'https://evil.test/', accepted: false },
  ]) {
    const fetched: unknown[] = [];
    const fulfilled: any[] = [];
    let disposed = false;
    const response = { status: () => scenario.status,
      headers: () => ({ location: scenario.location, 'set-cookie': 'session=fixture; Secure; HttpOnly', refresh: '0;url=https://evil.test/' }),
      dispose: async () => { disposed = true; } };
    const route: any = {
      request: () => ({ method: () => scenario.method, url: () => `${base}${scenario.path}` }),
      fetch: async (options: unknown) => { fetched.push(options); return response; },
      fulfill: async (options: unknown) => { fulfilled.push(options); },
      continue: () => { throw new Error('Must not continue'); },
    };
    if (scenario.accepted) {
      await fulfillProvinceRequest(route, 1234);
      assert.equal(fulfilled[0].status, 200);
      assert.equal(fulfilled[0].body, '');
      assert.equal(fulfilled[0].headers['set-cookie'], 'session=fixture; Secure; HttpOnly');
      assert.equal(fulfilled[0].headers.location, undefined);
      assert.equal(fulfilled[0].headers.refresh, undefined);
      assert.equal(fulfilled[0].response, undefined);
    } else {
      await assert.rejects(() => fulfillProvinceRequest(route, 1234), /Redirect blocked/);
      assert.equal(fulfilled.length, 0);
    }
    assert.deepEqual(fetched, [{ maxRedirects: 0, maxRetries: 0, timeout: 1234 }]);
    assert.equal(disposed, true);
  }
  for (const refresh of [undefined, '0;url=https://evil.test/']) {
    let fulfilled = false;
    const response = { status: () => 200, headers: () => ({ refresh }), dispose: async () => undefined };
    const route: any = { fetch: async () => response, fulfill: async (options: any) => {
      assert.equal(options.response, response);
      fulfilled = true;
    } };
    if (refresh) await assert.rejects(() => fulfillProvinceRequest(route, 1000), /Redirect blocked/);
    else await fulfillProvinceRequest(route, 1000);
    assert.equal(fulfilled, !refresh);
  }
});

test('reads reject configuration changes in flight and account changes clear mappings', async () => {
  const { service, configs, mappings, db } = fixture();
  await service.saveConfig(actor, { revision: 0, username: 'a', password: 'secret', provinceHealthCenterCode: 'A' });
  mappings.push({ healthCenterId: 'tenant-a', indicatorId: 'local', provinceCode: '01.02' });
  await service.saveConfig(actor, { revision: 1, username: 'new-account', provinceHealthCenterCode: 'A' });
  assert.equal(mappings.length, 0);
  const adapter = { read: async () => {
    configs.get('tenant-a').revision++;
    return { provinceHealthCenterCode: 'A', targets: [], months: [], monthly: [] };
  } };
  const raced = new ProvinceService(db, adapter as unknown as ProvinceAdapter);
  await assert.rejects(() => raced.catalog(actor), /changed during read/);
});

test('browser concurrency rejects excess work and releases slots after launch failure', async t => {
  const pending: Array<(value: never) => void> = [];
  t.mock.method(chromium, 'launch', () => new Promise<never>((_resolve, reject) => pending.push(reject)));
  const adapter = new ProvinceAdapter();
  const credentials = { username: 'a', password: 'secret', provinceHealthCenterCode: 'A' };
  const first = assert.rejects(() => adapter.read(credentials), /BROWSER_UNAVAILABLE: Province read failed/);
  const second = assert.rejects(() => adapter.read(credentials), /BROWSER_UNAVAILABLE: Province read failed/);
  await assert.rejects(() => adapter.read(credentials), /busy/);
  pending.forEach(reject => reject(new Error('private browser detail') as never));
  await Promise.all([first, second]);
  const next = assert.rejects(() => adapter.read(credentials), /BROWSER_UNAVAILABLE: Province read failed/);
  pending[2]!(new Error('private browser detail') as never);
  await next;
});

test('browser adapter fixture validates exact identity, uses fresh contexts, sanitizes failures and closes finally', async t => {
  let closes = 0;
  let contexts = 0;
  const liveUser = { user_id: 1, nama: 'private', nip: 'private', role: 'puskesmas',
    provinsi: 'private', kabupaten: 'private', kabupaten_kode: 'private', kabupaten_nama: 'private',
    puskesmas_kode: '001', puskesmas: 'private' };
  let identity: unknown = { user: liveUser };
  let failure: 'login' | 'identity' | 'read' | undefined;
  let loginOk = true;
  const reads: string[] = [];
  const submitted: string[] = [];
  const page: any = {
    goto: async () => { if (failure === 'login') throw new Error('secret private cookie'); },
    locator: (selector: string) => ({ fill: async () => undefined, filter: () => ({
      getAttribute: async (name: string) => name === 'action' ? 'api/login.php' : 'POST',
      locator: () => ({ click: async () => { submitted.push(selector); } }),
    }) }),
    waitForResponse: async () => ({ ok: () => loginOk }),
    evaluate: async (_fn: any, url: string) => {
      reads.push(url);
      if (failure === 'identity' || (failure === 'read' && !url.endsWith('get_current_user.php'))) throw new Error('secret private cookie');
      if (url.endsWith('get_current_user.php')) return identity;
      return { data: [] };
    },
  };
  t.mock.method(chromium, 'launch', async () => ({
    newContext: async (options: any) => {
      contexts++;
      assert.equal(options.serviceWorkers, 'block');
      return { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, routeWebSocket: async () => undefined,
        route: async () => undefined, newPage: async () => page };
    }, close: async () => { closes++; },
  }) as any);
  const adapter = new ProvinceAdapter();
  const credentials = { username: 'a', password: 'secret', provinceHealthCenterCode: '001' };
  const snapshot = await adapter.read(credentials);
  assert.equal(snapshot.provinceHealthCenterCode, '001');
  assert.doesNotMatch(JSON.stringify(snapshot), /private|nip|nama|user_id/);
  for (const user of [
    { ...liveUser, puskesmas_kode: '002' },
    { ...liveUser, puskesmas_kode: undefined },
    { ...liveUser, puskesmas_kode: '', kdpusk: '001' },
    { ...liveUser, puskesmas_kode: undefined, kdpusk: '001' },
    { ...liveUser, puskesmas_kode: 1 },
    { ...liveUser, puskesmas_kode: '1' },
    { ...liveUser, puskesmas_kode: ' 001' },
    { ...liveUser, role: 'admin' },
    undefined,
  ]) {
    identity = { user };
    reads.length = 0;
    await assert.rejects(() => adapter.read(credentials), /IDENTITY_MISMATCH: Province read failed/);
    assert.equal(reads.length, 1);
  }
  identity = { ok: false, user: liveUser };
  await assert.rejects(() => adapter.read(credentials), /PORTAL_LOGIN_FAILED: Province read failed/);
  identity = { user: liveUser };
  loginOk = false;
  await assert.rejects(() => adapter.read(credentials), /PORTAL_LOGIN_FAILED: Province read failed/);
  loginOk = true;
  for (const stage of ['login', 'identity', 'read'] as const) {
    failure = stage;
    await assert.rejects(() => adapter.read(credentials), (error: any) => {
      const code = stage === 'login' ? 'PORTAL_LOGIN_FAILED' : 'READ_FAILED';
      assert.equal(error.getStatus(), 503);
      assert.equal(error.getResponse().message, `${code}: Province read failed`);
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /secret|private|cookie/);
      return true;
    });
  }
  assert.equal(contexts, 15);
  assert.equal(closes, contexts);
  assert.equal(submitted.length, contexts - 1);
});
