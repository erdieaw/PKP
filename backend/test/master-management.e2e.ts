import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Polarity, Role } from '@prisma/client';
import { argon2id, hash, verify } from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { createApp } from '../src/main';

type Tokens = Awaited<ReturnType<AuthService['login']>>;
type Catalogue = { total: number; items: { id: string; isActive: boolean; indikator: string }[] };
type Section = { code: string; name: string; isActive: boolean };
type Indicator = { id: string; updatedAt: string; indikator: string; isActive: boolean };

test('real master management: global catalogue, tenant administration and password resets', {
  skip: process.env.TEST_E2E !== 'true' ? 'Set TEST_E2E=true to use real Postgres, Redis and HTTP' : false,
  timeout: 240_000,
}, async t => {
  const app = await createApp();
  const db = app.get(DbService);
  const auth = app.get(AuthService);
  const suffix = randomUUID();
  const indicatorId = `CUSTOM_${suffix}`;
  let sectionCode: string | undefined;
  let baseline: number | undefined;
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const requests = new Map<string, number>();
    const tokenOwners = new Map<string, string>();
    async function login(username: string, password: string) {
      const tokens = await auth.login({ username, password });
      tokenOwners.set(tokens.accessToken, tokens.user.id);
      return tokens;
    }
    async function request<T = unknown>(method: string, path: string, expected: number, token?: string, body?: unknown): Promise<T> {
      if (token) {
        const owner = tokenOwners.get(token);
        assert.ok(owner, 'Only fixture credentials may be used');
        const count = (requests.get(owner) ?? 0) + 1;
        requests.set(owner, count);
        assert.ok(count < 120, 'Keep each actor below the real HTTP rate limit');
      }
      const response = await fetch(`${base}${path}`, {
        method, signal: AbortSignal.timeout(40_000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      // Do not include response bodies here: authentication responses can contain credentials.
      assert.equal(response.status, expected, `${method} ${path}`);
      const envelope = JSON.parse(text) as { success: boolean; statusCode: number; data: T };
      assert.equal(envelope.success, expected < 400, `${method} ${path}`);
      assert.equal(envelope.statusCode, expected);
      return envelope.data;
    }
    await request('GET', '/health/ready', 200);
    const password = `Master-${randomUUID()}!`;
    const passwordHash = await hash(password, { type: argon2id });
    const centerA = await db.healthCenter.create({ data: { code: `mm-a-${suffix}`, name: `Master A ${suffix}`, district: 'Integration' } });
    const centerB = await db.healthCenter.create({ data: { code: `mm-b-${suffix}`, name: `Master B ${suffix}`, district: 'Integration' } });
    async function user(role: Role, healthCenterId: string | null) {
      return db.user.create({ data: { username: `mm-${randomUUID()}`, name: `Master ${role}`, role, healthCenterId: role === Role.DINKES_ADMIN ? null : healthCenterId, passwordHash } });
    }
    const adminA = await user(Role.ADMIN_PUSKESMAS, centerA.id);
    const adminB = await user(Role.ADMIN_PUSKESMAS, centerB.id);
    const picA = await user(Role.PIC, centerA.id);
    const picB = await user(Role.PIC, centerB.id);
    const dinkes = await user(Role.DINKES_ADMIN, null);
    const peer = await user(Role.DINKES_ADMIN, null);
    let a = await login(adminA.username, password);
    const b = await login(adminB.username, password);
    let p = await login(picA.username, password);
    let pb = await login(picB.username, password);
    const d = await login(dinkes.username, password);
    const period = await request<{ revision: number }>('GET', '/master/active-year', 200, d.accessToken);
    await request('PUT', '/master/active-year', 200, d.accessToken, { year: 2026, provinceEnabled: false, revision: period.revision });
    baseline = (await request<Catalogue>('GET', '/master/indicators', 200, a.accessToken)).total;
    const snapshots = await db.periodLock.findMany({ where: { status: { in: ['SUBMITTED', 'VERIFIED'] } }, select: { id: true, snapshot: true }, orderBy: { id: 'asc' } });
    const year = await db.yearPeriod.findUniqueOrThrow({ where: { year: 2026 } });
    assert.equal(year.isLocked, false, 'The fixture year 2026 must be writable');
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `1.${randomInt(990000, 999999)}`;
      if (!await db.section.findUnique({ where: { code: candidate } })) { sectionCode = candidate; break; }
    }
    assert.ok(sectionCode, 'An unused section code is required');
    const code = sectionCode;
    const indicator = {
      id: indicatorId, klasterId: 1, sectionCode: code, no: 'CUSTOM', kegiatan: 'Integration activity',
      indikator: `Integration indicator ${suffix}`, satuan: '%', targetDisplay: '100%', targetNumeric: 100,
      totalSasaranDefault: 120, targetSasaranDefault: 120, polarity: Polarity.HIGHER_IS_BETTER,
    };
    let current: Indicator;

    await t.test('ADMIN creates a global section and indicator visible to other tenants and PICs', async () => {
      await request('POST', '/master/sections', 201, a.accessToken, { code, name: `Master ${suffix}`, klasterId: 1, parentCode: null });
      current = await request<Indicator>('POST', '/master/indicators', 201, a.accessToken, indicator);
      for (const session of [b, p, pb]) {
        const catalogue = await request<Catalogue>('GET', `/master/indicators?search=${indicatorId}`, 200, session.accessToken);
        assert.deepEqual(catalogue.items.map(item => item.id), [indicatorId]);
        const sections = await request<Section[]>('GET', '/master/sections', 200, session.accessToken);
        assert.ok(sections.some(section => section.code === code));
      }
      assert.equal((await request<Catalogue>('GET', '/master/indicators', 200, b.accessToken)).total, baseline! + 1);
    });

    await t.test('PIC cannot mutate masters, health centers, users or passwords; public resets require authentication', async () => {
      for (const [method, path, body] of [
        ['POST', '/master/sections', { code: `${code}.1`, name: 'Forbidden', klasterId: 1, parentCode: code }],
        ['PATCH', `/master/sections/${code}`, { name: 'Forbidden' }],
        ['DELETE', `/master/sections/${code}`, undefined],
        ['POST', '/master/indicators', { ...indicator, id: `${indicatorId}_forbidden` }],
        ['PATCH', `/master/indicators/${indicatorId}`, { notes: 'Forbidden' }],
        ['DELETE', `/master/indicators/${indicatorId}`, undefined],
        ['POST', '/health-centers', { code: 'forbidden', name: 'Forbidden', district: 'Test' }],
        ['PATCH', `/health-centers/${centerA.id}`, { name: 'Forbidden' }],
        ['DELETE', `/health-centers/${centerA.id}`, undefined],
        ['POST', '/users/pics', { username: `mm-${randomUUID()}`, name: 'Forbidden', password }],
        ['PATCH', `/users/${picB.id}`, { name: 'Forbidden' }],
        ['DELETE', `/users/${picB.id}`, undefined],
        ['POST', `/users/${picB.id}/reset-password`, { newPassword: password, reason: 'Forbidden' }],
      ] as const) await request(method, path, 403, p.accessToken, body);
      await request('POST', `/users/${picA.id}/reset-password`, 401, undefined, { newPassword: password, reason: 'Unauthenticated' });
    });

    await t.test('hierarchy, immutable keys, unknown tiered rules, nulls and archive query booleans are validated', async () => {
      await request('POST', '/master/sections', 400, a.accessToken, { code: `${code}.1`, name: 'Mismatch', klasterId: 2, parentCode: code });
      await request('POST', '/master/sections', 400, a.accessToken, { code: `${code}.1`, name: 'Missing parent', klasterId: 1, parentCode: null });
      await request('POST', '/master/indicators', 400, a.accessToken, { ...indicator, id: `${indicatorId}_mismatch`, klasterId: 2 });
      await request('POST', '/master/indicators', 400, a.accessToken, { ...indicator, id: `${indicatorId}_tiered`, polarity: Polarity.TIERED_BRACKETS });
      await request('PATCH', `/master/indicators/${indicatorId}`, 400, a.accessToken, { id: 'replacement' });
      await request('PATCH', `/master/sections/${code}`, 400, a.accessToken, { code: `${code}.1` });
      for (const field of ['targetNumeric', 'isActive', 'indikator', 'expectedUpdatedAt']) {
        await request('PATCH', `/master/indicators/${indicatorId}`, 400, a.accessToken, { [field]: null });
      }
      await request('PATCH', `/master/sections/${code}`, 400, a.accessToken, { name: null });
      for (const path of ['/master/indicators', '/master/sections']) {
        for (const value of ['1', 'TRUE', 'null', '']) await request('GET', `${path}?includeArchived=${value}`, 400, b.accessToken);
        await request('GET', `${path}?includeArchived=false`, 200, p.accessToken);
        await request('GET', `${path}?includeArchived=true`, 403, p.accessToken);
      }
    });

    await t.test('both administrator roles update metadata and reject stale optimistic versions', async () => {
      const original = current.updatedAt;
      current = await request<Indicator>('PATCH', `/master/indicators/${indicatorId}`, 200, a.accessToken, { indikator: 'ADMIN metadata', expectedUpdatedAt: original });
      await request('PATCH', `/master/indicators/${indicatorId}`, 409, d.accessToken, { notes: 'Stale', expectedUpdatedAt: original });
      const previous = current.updatedAt;
      current = await request<Indicator>('PATCH', `/master/indicators/${indicatorId}`, 200, d.accessToken, { indikator: 'DINKES metadata', expectedUpdatedAt: previous, formulaRaw: null, notes: null });
      await request('PATCH', `/master/indicators/${indicatorId}`, 409, a.accessToken, { notes: 'Stale', expectedUpdatedAt: previous });
      await request('PATCH', `/master/sections/${code}`, 200, a.accessToken, { name: 'ADMIN section' });
      await request('PATCH', `/master/sections/${code}`, 200, d.accessToken, { name: 'DINKES section', order: 999 });
      const global = await request<Catalogue>('GET', `/master/indicators?search=${indicatorId}`, 200, b.accessToken);
      assert.equal(global.items[0]!.indikator, 'DINKES metadata');
    });

    await t.test('monthly calculations are immutable, metadata remains editable, archives retain records and snapshots', async () => {
      await request('PUT', '/targets/annual/2026/bulk', 200, a.accessToken, { targets: [{ indicatorId, targetPct: 100, totalSasaran: 120, targetSasaran: 120 }] });
      await request('PUT', '/records/monthly', 200, a.accessToken, { year: 2026, month: 1, records: [{ indicatorId, pencapaianRiil: 5 }] });
      const where = { healthCenterId: centerA.id, indicatorId, year: 2026, month: 1 };
      const record = await db.monthlyRecord.findFirstOrThrow({ where });
      const target = await db.annualTarget.findFirstOrThrow({ where: { healthCenterId: centerA.id, indicatorId, year: 2026 } });
      for (const body of [{ targetNumeric: 90 }, { totalSasaranDefault: 240 }, { targetSasaranDefault: 60 }, { polarity: Polarity.LOWER_IS_BETTER }]) {
        await request('PATCH', `/master/indicators/${indicatorId}`, 409, d.accessToken, body);
      }
      await request('PATCH', `/master/indicators/${indicatorId}`, 200, a.accessToken, { notes: 'Historical records retained', indikator: 'Updated display only' });
      await request('DELETE', `/master/sections/${code}`, 409, a.accessToken);
      await request('DELETE', `/master/indicators/${indicatorId}`, 200, a.accessToken);
      await request('DELETE', `/master/sections/${code}`, 200, d.accessToken);
      for (const session of [a, p]) {
        assert.equal((await request<Catalogue>('GET', `/master/indicators?search=${indicatorId}`, 200, session.accessToken)).total, 0);
        assert.ok(!(await request<Section[]>('GET', '/master/sections', 200, session.accessToken)).some(section => section.code === code));
      }
      for (const session of [a, d]) {
        const archived = await request<Catalogue>('GET', `/master/indicators?includeArchived=true&search=${indicatorId}`, 200, session.accessToken);
        assert.equal(archived.items[0]!.isActive, false);
        assert.equal((await request<Section[]>('GET', '/master/sections?includeArchived=true', 200, session.accessToken)).find(section => section.code === code)!.isActive, false);
      }
      assert.deepEqual(await db.monthlyRecord.findFirstOrThrow({ where }), record);
      assert.deepEqual(await db.annualTarget.findUniqueOrThrow({ where: { id: target.id } }), target);
      for (const snapshot of snapshots) assert.deepEqual((await db.periodLock.findUniqueOrThrow({ where: { id: snapshot.id } })).snapshot, snapshot.snapshot);
      await request('PATCH', `/master/indicators/${indicatorId}`, 400, a.accessToken, { isActive: true });
      await request('PATCH', `/master/sections/${code}`, 200, d.accessToken, { isActive: true });
      await request('PATCH', `/master/indicators/${indicatorId}`, 200, a.accessToken, { isActive: true });
      assert.equal((await request<Catalogue>('GET', `/master/indicators?search=${indicatorId}`, 200, b.accessToken)).total, 1);
      await request('DELETE', `/master/indicators/${indicatorId}`, 200, d.accessToken);
      await request('DELETE', `/master/sections/${code}`, 200, a.accessToken);
    });

    await t.test('year CRUD is DINKES-only, including cutoff editing and deletion', async () => {
      const existing = new Set((await db.yearPeriod.findMany({ select: { year: true } })).map(item => item.year));
      const start = randomInt(20);
      const unused = Array.from({ length: 20 }, (_, index) => 2040 + (start + index) % 20).find(candidate => !existing.has(candidate));
      assert.ok(unused, 'An unused year in 2040-2059 is required');
      await request('POST', '/master/years', 403, a.accessToken, { year: unused, cutoffDay: 10 });
      await request('POST', '/master/years', 201, d.accessToken, { year: unused, cutoffDay: 10 });
      await request('PATCH', `/master/years/${unused}`, 403, a.accessToken, { cutoffDay: 15 });
      await request('PATCH', `/master/years/${unused}`, 200, d.accessToken, { cutoffDay: 15 });
      await request('PATCH', `/master/years/${unused}`, 403, a.accessToken, { isLocked: true });
      await request('PATCH', `/master/years/${unused}`, 400, d.accessToken, { cutoffDay: null });
      await request('PATCH', `/master/years/${unused}`, 400, d.accessToken, { isLocked: null });
      await request('PATCH', `/master/years/${unused}`, 200, d.accessToken, { isLocked: true });
      const years = await request<{ year: number; cutoffDay: number; isLocked: boolean }[]>('GET', '/master/years', 200, p.accessToken);
      const saved = years.find(item => item.year === unused);
      assert.ok(saved);
      assert.equal(saved.cutoffDay, 15);
      assert.equal(saved.isLocked, true);
      await request('DELETE', `/master/years/${unused}`, 403, a.accessToken);
      await request('PATCH', `/master/years/${unused}`, 200, d.accessToken, { isLocked: false });
      await request('DELETE', `/master/years/${unused}`, 200, d.accessToken);
      assert.equal(await db.yearPeriod.findUnique({ where: { year: unused } }), null);
      await request('DELETE', '/master/years/2026', 409, d.accessToken);
    });

    await t.test('password reset authorization, all-session revocation, password hashes and audit redaction', async () => {
      const replacement = `Reset-${randomUUID()}!`;
      const reason = `Integration reset ${suffix}`;
      const resetBody = { newPassword: replacement, reason };
      const beforeB = await db.user.findUniqueOrThrow({ where: { id: picB.id } });
      await request('POST', `/users/${picB.id}/reset-password`, 404, a.accessToken, resetBody);
      await request('POST', `/users/${picB.id}/reset-password`, 403, a.accessToken, { ...resetBody, healthCenterId: centerB.id });
      assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: picB.id } }), beforeB);
      await request('POST', `/users/${adminA.id}/reset-password`, 403, b.accessToken, { ...resetBody, healthCenterId: centerA.id });
      await request('POST', `/users/${adminA.id}/reset-password`, 403, a.accessToken, resetBody);
      const otherAdmin = await user(Role.ADMIN_PUSKESMAS, centerA.id);
      await request('POST', `/users/${otherAdmin.id}/reset-password`, 403, a.accessToken, resetBody);
      await request('POST', `/users/${picA.id}/reset-password`, 400, a.accessToken, { ...resetBody, newPassword: 'short' });
      await request('POST', `/users/${picA.id}/reset-password`, 400, a.accessToken, { ...resetBody, reason: null });
      await request('POST', `/users/${picA.id}/reset-password`, 400, a.accessToken, { ...resetBody, reason: ' ' });
      // DINKES users have no tenant and are excluded by the tenant-scoped lookup.
      const beforePeer = await db.user.findUniqueOrThrow({ where: { id: peer.id } });
      await request('POST', `/users/${peer.id}/reset-password`, 404, d.accessToken, { ...resetBody, healthCenterId: centerA.id });
      assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: peer.id } }), beforePeer);
      await request('POST', `/users/${dinkes.id}/reset-password`, 403, d.accessToken, resetBody);
      const secondPicSession = await login(picA.username, password);
      for (const [target, actor, tenant, sessions] of [
        [picA, a, undefined, [p, secondPicSession]],
        [adminA, d, centerA.id, [a]],
        [picB, d, centerB.id, [pb]],
      ] as const) {
        const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
        const active = await db.session.count({ where: { userId: target.id, revokedAt: null } });
        const result = await request<{ id: string; sessionsRevoked: number }>('POST', `/users/${target.id}/reset-password`, 201, actor.accessToken, { ...resetBody, ...(tenant ? { healthCenterId: tenant } : {}) });
        assert.equal(result.id, target.id);
        assert.equal(result.sessionsRevoked, active);
        const updated = await db.user.findUniqueOrThrow({ where: { id: target.id } });
        assert.equal(updated.tokenVersion, before.tokenVersion + 1);
        assert.ok(await verify(updated.passwordHash, replacement), 'Replacement password must verify');
        assert.ok(!await verify(updated.passwordHash, password), 'Old password must not verify');
        assert.equal(await db.session.count({ where: { userId: target.id, revokedAt: null } }), 0);
        for (const session of sessions) {
          await request('GET', '/auth/me', 401, session.accessToken);
          await request('POST', '/auth/refresh', 401, undefined, { refreshToken: session.refreshToken });
        }
        await assert.rejects(auth.login({ username: target.username, password }), { status: 401 });
        const fresh = await login(target.username, replacement);
        await request('GET', '/auth/me', 200, fresh.accessToken);
        if (target.id === adminA.id) a = fresh;
        if (target.id === picA.id) p = fresh;
        if (target.id === picB.id) pb = fresh;
        const logs = await db.auditLog.findMany({ where: { action: 'PASSWORD_RESET', details: { path: ['targetUserId'], equals: target.id } } });
        assert.equal(logs.length, 1);
        const details = logs[0]!.details as Record<string, unknown>;
        assert.deepEqual(details, { targetUserId: target.id, targetRole: target.role, reason });
        const serialized = JSON.stringify({ result, details });
        for (const secret of [password, replacement, updated.passwordHash, 'passwordHash', 'newPassword', 'refreshToken']) assert.ok(!serialized.includes(secret), 'Reset response and audit must not leak credentials');
      }
    });

    await t.test('health-center profile boundaries, DINKES CRUD and archival session revocation', async () => {
      await request('PATCH', `/health-centers/${centerA.id}`, 200, a.accessToken, { name: `Updated A ${suffix}`, address: 'Integration address' });
      const beforeB = await db.healthCenter.findUniqueOrThrow({ where: { id: centerB.id } });
      await request('PATCH', `/health-centers/${centerB.id}`, 403, a.accessToken, { name: 'Forbidden' });
      assert.deepEqual(await db.healthCenter.findUniqueOrThrow({ where: { id: centerB.id } }), beforeB);
      await request('PATCH', `/health-centers/${centerA.id}`, 403, a.accessToken, { isActive: false });
      await request('PATCH', `/health-centers/${centerA.id}`, 400, a.accessToken, { name: null });
      const body = { code: `mm-new-${suffix}`, name: `New ${suffix}`, district: 'Integration' };
      await request('POST', '/health-centers', 403, a.accessToken, body);
      const created = await request<{ id: string }>('POST', '/health-centers', 201, d.accessToken, body);
      await request('PATCH', `/health-centers/${created.id}`, 200, d.accessToken, { name: `Updated new ${suffix}` });
      await request('DELETE', `/health-centers/${created.id}`, 403, a.accessToken);
      await request('DELETE', `/health-centers/${created.id}`, 200, d.accessToken);
      assert.equal((await db.healthCenter.findUniqueOrThrow({ where: { id: created.id } })).isActive, false);
      const before = await db.user.findUniqueOrThrow({ where: { id: picB.id } });
      await request('DELETE', `/health-centers/${centerB.id}`, 200, d.accessToken);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: picB.id } })).tokenVersion, before.tokenVersion + 1);
      assert.equal(await db.session.count({ where: { user: { healthCenterId: centerB.id }, revokedAt: null } }), 0);
      for (const session of [pb, b]) {
        await request('GET', '/auth/me', 401, session.accessToken);
        await request('POST', '/auth/refresh', 401, undefined, { refreshToken: session.refreshToken });
      }
      assert.equal(await db.monthlyRecord.count({ where: { healthCenterId: centerA.id, indicatorId } }), 1);
    });
  } finally {
    // Retain append-only audit history and fixture records, but never enlarge the active catalogue.
    try {
      await db.indicator.updateMany({ where: { id: indicatorId }, data: { isActive: false } });
      if (sectionCode) await db.section.updateMany({ where: { code: sectionCode }, data: { isActive: false } });
      if (baseline !== undefined) assert.equal(await db.indicator.count({ where: { isActive: true, section: { isActive: true } } }), baseline, 'Restore the original active catalogue count');
    } finally {
      await app.close();
    }
  }
});
