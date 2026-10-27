import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Prisma, Role } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { createApp } from '../src/main';

type Period = { id: string; status: string; revision: number; snapshot: Prisma.JsonValue; invalidatedPeriods: { id: string; status: string; revision: number }[] };

// Retain isolated fixtures because their audit history is append-only.
test('workflow: repeated target locks, transitive cascade, revision history and resubmission', {
  skip: process.env.TEST_E2E !== 'true' ? 'Set TEST_E2E=true for real infrastructure' : false,
  timeout: 180_000,
}, async t => {
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const db = app.get(DbService);
    const auth = app.get(AuthService);
    const suffix = randomUUID();
    const center = await db.healthCenter.create({ data: { code: `wf-${suffix}`, name: `Workflow ${suffix}`, district: 'Integration' } });
    let year: number | undefined;
    const start = randomInt(20);
    for (let offset = 0; offset < 20; offset++) {
      const candidate = 2060 + ((start + offset) % 20);
      try {
        await db.yearPeriod.create({ data: { year: candidate } });
        year = candidate;
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      }
    }
    assert.ok(year !== undefined, 'A fresh year in 2060-2079 is required');
    t.diagnostic(`Retained workflow fixtures: year=${year}, tenant=${center.id}`);
    const password = `Workflow-${randomUUID()}!`;
    const passwordHash = await hash(password, { type: argon2id });
    async function login(role: Role) {
      const user = await db.user.create({ data: { username: `wf-${randomUUID()}`, name: `Workflow ${role}`, role, healthCenterId: role === Role.DINKES_ADMIN ? null : center.id, passwordHash } });
      return { user, token: (await auth.login({ username: user.username, password })).accessToken };
    }
    // Setup authentication directly, leaving the public IP login rate limit untouched.
    const admin = await login(Role.ADMIN_PUSKESMAS);
    const dinkes = await login(Role.DINKES_ADMIN);
    async function request<T = unknown>(method: string, path: string, expected: number, token: string, body?: unknown): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method, signal: AbortSignal.timeout(40_000),
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      assert.equal(response.status, expected, `${method} ${path}: ${text}`);
      return (JSON.parse(text) as { data: T }).data;
    }
    const period = await request<{ revision: number }>('GET', '/master/active-year', 200, dinkes.token);
    await request('PUT', '/master/active-year', 200, dinkes.token, { year, provinceEnabled: false, revision: period.revision });
    const catalogue = await db.indicator.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
    assert.ok(catalogue.length > 100, 'Snapshots must exercise history beyond audit truncation limits');
    const defaults = await request<{ items: { indicatorId: string; targetPct: string; rawTargetNumeric: string }[] }>('GET', `/targets/annual/${year}`, 200, admin.token);
    for (const indicator of catalogue) {
      const item = defaults.items.find(item => item.indicatorId === indicator.id)!;
      assert.equal(Number(item.rawTargetNumeric), Number(indicator.targetNumeric));
      assert.equal(Number(item.targetPct), indicator.totalSasaranDefault.greaterThan(0)
        ? Number(indicator.targetSasaranDefault.div(indicator.totalSasaranDefault).mul(100).toDecimalPlaces(4)) : 0);
    }
    await request('PUT', `/targets/annual/${year}/bulk`, 200, admin.token, { targets: catalogue.map(indicator => ({ indicatorId: indicator.id, targetPct: 100, totalSasaran: 120 })) });
    for (const month of [1, 2, 3, 4]) await request('PUT', '/records/monthly', 200, admin.token, { year, month, records: catalogue.map(indicator => ({ indicatorId: indicator.id, pencapaianRiil: 1 })) });
    const monthly = (periodNumber: number) => ({ year, periodNumber, isQuarter: false });
    const quarter = { year, periodNumber: 1, isQuarter: true };
    async function submit(body: object) { return request<Period>('POST', '/workflow/submit', 201, admin.token, body); }
    async function verify(body: object, period: Period) { return request<Period>('POST', '/workflow/verify', 201, dinkes.token, { ...body, healthCenterId: center.id, expectedRevision: period.revision }); }
    let month1 = await verify(monthly(1), await submit(monthly(1)));
    // These submits must not attempt to update targets that month 1 already locked.
    let month2 = await verify(monthly(2), await submit(monthly(2)));
    let q1 = await verify(quarter, await submit(quarter));
    const month4 = await verify(monthly(4), await submit(monthly(4)));
    const lockedAgain = await request<{ locked: number }>('POST', `/targets/annual/${year}/lock`, 201, admin.token, {});
    assert.equal(lockedAgain.locked, 0);
    const original = [month1, month2, q1];
    const reopen = { ...monthly(1), healthCenterId: center.id, expectedRevision: month1.revision, reason: 'Correct January numerator' };
    await request('POST', '/workflow/reopen', 400, dinkes.token, { ...reopen, expectedRevision: undefined, cascadeDependencies: true });
    await request('POST', '/workflow/reopen', 400, dinkes.token, { ...reopen, reason: ' ' });
    await request('POST', '/workflow/reopen', 400, dinkes.token, { ...reopen, cascadeDependencies: 'true' });
    await request('POST', '/workflow/reopen', 403, admin.token, { ...reopen, cascadeDependencies: true });
    await request('POST', '/workflow/reopen', 409, dinkes.token, { ...reopen, expectedRevision: 0, cascadeDependencies: true });
    const auditBefore = await db.auditLog.count({ where: { healthCenterId: center.id } });
    // Month 2 is disjoint from January but connected through Q1.
    for (const cascadeDependencies of [undefined, false]) {
      const response = await fetch(`${base}/workflow/reopen`, { method: 'POST', headers: { Authorization: `Bearer ${dinkes.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...reopen, cascadeDependencies }) });
      assert.equal(response.status, 409);
      const conflict = await response.json() as { dependencies: { id: string }[] };
      assert.deepEqual(conflict.dependencies.map(period => period.id).sort(), [month2.id, q1.id].sort());
    }
    assert.equal(await db.auditLog.count({ where: { healthCenterId: center.id } }), auditBefore);
    for (const period of original) assert.equal((await db.periodLock.findUniqueOrThrow({ where: { id: period.id } })).status, 'VERIFIED');
    month1 = await request<Period>('POST', '/workflow/reopen', 201, dinkes.token, { ...reopen, cascadeDependencies: true });
    assert.deepEqual(month1.invalidatedPeriods.map(period => period.id).sort(), [month2.id, q1.id].sort());
    for (const period of original) {
      const current = await db.periodLock.findUniqueOrThrow({ where: { id: period.id } });
      assert.equal(current.status, 'REVISION_REQUIRED');
      assert.equal(current.revision, period.revision + 1);
      assert.equal(current.verifiedAt, null);
      assert.equal(current.verifiedById, null);
      assert.ok(current.revisionNote?.includes(reopen.reason));
      assert.deepEqual(current.snapshot, period.snapshot);
    }
    assert.equal((await db.periodLock.findUniqueOrThrow({ where: { id: month4.id } })).status, 'VERIFIED');
    const cascadeAudits = await db.auditLog.findMany({ where: { healthCenterId: center.id, action: 'PERIOD_CASCADE_INVALIDATED' } });
    assert.equal(cascadeAudits.length, 2);
    for (const row of cascadeAudits) {
      const details = row.details as { id: string; reason: string; cascadeOrigin: { id: string }; previousSnapshot: Prisma.JsonValue };
      assert.equal(row.userId, dinkes.user.id);
      assert.equal(details.reason, reopen.reason);
      assert.equal(details.cascadeOrigin.id, month1.id);
      assert.deepEqual(details.previousSnapshot, original.find(period => period.id === details.id)!.snapshot);
    }
    const centralAudit = await db.auditLog.findFirstOrThrow({ where: { healthCenterId: center.id, action: 'PERIOD_REOPEN' } });
    assert.deepEqual((centralAudit.details as { previousSnapshot: Prisma.JsonValue }).previousSnapshot, original[0]!.snapshot);
    await request('PUT', '/records/monthly', 200, admin.token, { year, month: 1, records: [{ indicatorId: catalogue[0]!.id, pencapaianRiil: 2 }] });
    month1 = await submit(monthly(1));
    month2 = await submit(monthly(2));
    q1 = await submit(quarter);
    assert.notDeepEqual(month1.snapshot, original[0]!.snapshot);
    assert.notDeepEqual(q1.snapshot, original[2]!.snapshot);
    const revise = { ...monthly(1), healthCenterId: center.id, expectedRevision: month1.revision, revisionNote: 'Review revised figures' };
    await request('POST', '/workflow/revise', 400, dinkes.token, { ...revise, revisionNote: ' ', cascadeDependencies: true });
    await request('POST', '/workflow/revise', 409, dinkes.token, revise);
    const revised = await request<Period>('POST', '/workflow/revise', 201, dinkes.token, { ...revise, cascadeDependencies: true });
    assert.equal(revised.status, 'REVISION_REQUIRED');
    assert.deepEqual(revised.invalidatedPeriods.map(period => period.id).sort(), [month2.id, q1.id].sort());
    assert.deepEqual((await db.auditLog.findUniqueOrThrow({ where: { id: centralAudit.id } })).details, centralAudit.details);
    assert.equal(await db.auditLog.count({ where: { healthCenterId: center.id, action: 'PERIOD_CASCADE_INVALIDATED' } }), 4);
    for (const period of [month1, month2, q1]) {
      const current = await db.periodLock.findUniqueOrThrow({ where: { id: period.id } });
      assert.equal(current.status, 'REVISION_REQUIRED');
      assert.equal(current.revision, period.revision + 1);
      assert.deepEqual(current.snapshot, period.snapshot);
    }
  } finally {
    await app.close();
  }
});
