import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Role } from '@prisma/client';
import { hash } from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { createApp } from '../src/main';

test('province log HTTP contract with persistent tenant-isolated database fixtures', {
  skip: process.env.TEST_E2E !== 'true' ? 'Set TEST_E2E=true to use real Postgres, Redis and MinIO' : false,
  timeout: 60000,
}, async t => {
  const previousKey = process.env.PROVINCE_CREDENTIAL_KEY;
  process.env.PROVINCE_CREDENTIAL_KEY = randomBytes(32).toString('base64');
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const db = app.get(DbService);
    const auth = app.get(AuthService);
    const password = randomUUID();
    const passwordHash = await hash(password);
    const tenants = await Promise.all(['A', 'B'].map(label => db.healthCenter.create({ data: {
      code: `province-log-${label}-${randomUUID()}`, name: 'Log fixture', district: 'Test',
    } })));
    const users = await Promise.all([
      { role: Role.ADMIN_PUSKESMAS, healthCenterId: tenants[0]!.id },
      { role: Role.ADMIN_PUSKESMAS, healthCenterId: tenants[1]!.id },
      { role: Role.PIC, healthCenterId: tenants[0]!.id },
      { role: Role.DINKES_ADMIN, healthCenterId: null },
    ].map(identity => db.user.create({ data: { ...identity, username: randomUUID(), name: 'private-name-NIP', passwordHash } })));
    const tokens = await Promise.all(users.map(user => auth.login({ username: user.username, password })));
    async function request(method: string, path: string, expected: number, token?: string, body?: unknown) {
      const response = await fetch(`${await app.getUrl()}/api/v1/bridge${path}`, { method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const envelope = await response.json() as any;
      assert.equal(response.status, expected, JSON.stringify(envelope));
      return envelope.data;
    }
    const a = tokens[0]!.accessToken;
    const b = tokens[1]!.accessToken;
    const body = { revision: 0, username: 'private-portal-username', password: 'private-portal-password', provinceHealthCenterCode: 'private-code' };
    for (const token of [a, b]) await request('PUT', '/config', 200, token, body);
    await request('PUT', '/config', 409, a, body);
    // Authentication has its own audit events; this contract covers sanitized province events.
    const provinceAudit = { healthCenterId: tenants[0]!.id, action: 'PROVINCE_CONFIG_SAVE', details: { path: ['schemaVersion'], equals: 1 } };
    const stored = await db.auditLog.findMany({ where: provinceAudit });
    assert.equal(stored.length, 2);
    assert.doesNotMatch(JSON.stringify(stored), /private-|password|username|cookie|NIP/);
    const first = await request('GET', '/logs?limit=1', 200, a);
    const second = await request('GET', '/logs?limit=1&page=2', 200, a);
    assert.deepEqual({ page: first.page, limit: first.limit, hasMore: first.hasMore }, { page: 1, limit: 1, hasMore: true });
    assert.equal(first.items[0].status, 'FAILURE');
    assert.equal(first.items[0].errorCode, 'CONFLICT');
    assert.equal(second.items[0].status, 'SUCCESS');
    assert.equal(second.hasMore, false);
    assert.equal(first.items[0].actorId, users[0]!.id);
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.deepEqual(Object.keys(first.items[0]).sort(), ['action', 'actorId', 'durationMs', 'errorCode', 'id', 'status', 'timestamp']);
    const other = await request('GET', '/logs', 200, b);
    assert.equal(other.items.length, 1);
    assert.equal(other.items[0].actorId, users[1]!.id);
    await request('GET', '/logs', 401);
    for (const token of [tokens[2]!.accessToken, tokens[3]!.accessToken]) await request('GET', '/logs', 403, token);
    for (const query of ['limit=101', 'limit=0', 'page=0', 'page=1.5', `healthCenterId=${tenants[1]!.id}`]) {
      await request('GET', `/logs?${query}`, 400, a);
    }
    await request('GET', '/config', 200, a);
    await request('GET', '/mappings', 200, a);
    assert.equal(await db.auditLog.count({ where: provinceAudit }), 2);
    t.diagnostic(`Retained append-only province log fixtures: ${tenants.map(row => row.id).join(', ')}`);
  } finally {
    await app.close();
    if (previousKey === undefined) delete process.env.PROVINCE_CREDENTIAL_KEY;
    else process.env.PROVINCE_CREDENTIAL_KEY = previousKey;
  }
});
