import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { getConfig } from '../src/config';
import { RateLimitGuard } from '../src/auth/auth.guards';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.JWT_SECRET ??= 'test-only-secret-with-at-least-32-characters';
process.env.MINIO_ACCESS_KEY ??= 'test-key';
process.env.MINIO_SECRET_KEY ??= 'test-secret';
for (const name of ['READ', 'WRITE', 'LOGIN', 'PUBLIC']) delete process.env[`RATE_LIMIT_${name}_PER_MINUTE`];

function fixture() {
  const counts = new Map<string, number>();
  const calls: unknown[][] = [];
  const headers = new Map<string, unknown>();
  let ttl = 37;
  let failure: unknown;
  const redis: any = { client: { eval: async (...args: unknown[]) => {
    calls.push(args);
    if (failure) throw failure;
    const key = args[2] as string;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return [count, ttl];
  } } };
  const guard = new RateLimitGuard(redis);
  function context(method = 'GET', actor: string | null = 'user-a', ip = '192.0.2.1', path = '/api/v1/records/monthly') {
    return { switchToHttp: () => ({
      getRequest: () => ({ method, route: { path }, actor: actor ? { id: actor } : undefined, ip }),
      getResponse: () => ({ setHeader: (name: string, value: unknown) => headers.set(name, value) }),
    }) } as ExecutionContext;
  }
  return { guard, context, counts, calls, headers, redis,
    setTtl: (value: number) => { ttl = value; },
    fail: () => { failure = new Error('Redis unavailable'); },
  };
}

const status = (expected: number) => (error: unknown) => error instanceof HttpException && error.getStatus() === expected;

test('authenticated reads allow 600 per minute without consuming the write budget', async () => {
  const f = fixture();
  for (let index = 0; index < 600; index++) assert.equal(await f.guard.canActivate(f.context()), true);
  await assert.rejects(() => f.guard.canActivate(f.context()), status(429));
  assert.equal(f.headers.get('Retry-After'), 37);
  for (let index = 0; index < 120; index++) assert.equal(await f.guard.canActivate(f.context('POST')), true);
  await assert.rejects(() => f.guard.canActivate(f.context('PATCH')), status(429));
  assert.ok(f.calls.every(args => args[1] === 1 && args[3] === 60));
  assert.match(String(f.calls[0]![0]), /if n == 1 then.*EXPIRE/);
});

test('users behind one IP have independent budgets; HEAD shares the read budget', async () => {
  const f = fixture();
  f.counts.set('rate:read:user-a', 600);
  await assert.rejects(() => f.guard.canActivate(f.context('HEAD')), status(429));
  assert.equal(await f.guard.canActivate(f.context('GET', 'user-b')), true);
  assert.equal(await f.guard.canActivate(f.context('DELETE')), true);
  assert.equal(f.counts.get('rate:read:user-b'), 1);
  assert.equal(f.counts.get('rate:write:user-a'), 1);
});

test('login still blocks the sixth attempt and public refresh has a separate IP budget', async () => {
  const f = fixture();
  const login = () => f.context('POST', null, '192.0.2.1', '/api/v1/auth/login');
  for (let index = 0; index < 5; index++) assert.equal(await f.guard.canActivate(login()), true);
  await assert.rejects(() => f.guard.canActivate(login()), status(429));
  assert.equal(await f.guard.canActivate(f.context('POST', null, '192.0.2.2', '/api/v1/auth/login')), true);
  const refresh = () => f.context('POST', null, '192.0.2.1', '/api/v1/auth/refresh');
  for (let index = 0; index < 120; index++) assert.equal(await f.guard.canActivate(refresh()), true);
  await assert.rejects(() => f.guard.canActivate(refresh()), status(429));
});

test('liveness bypasses Redis but readiness does not; Redis errors fail closed', async () => {
  const f = fixture();
  f.fail();
  assert.equal(await f.guard.canActivate(f.context('GET', null, '192.0.2.1', '/api/v1/health')), true);
  assert.equal(f.calls.length, 0);
  await assert.rejects(() => f.guard.canActivate(f.context('GET', null, '192.0.2.1', '/api/v1/health/ready')), status(503));
  await assert.rejects(() => f.guard.canActivate(f.context()), status(503));
});

test('invalid Redis replies fail closed and expiring windows return a positive Retry-After', async () => {
  const f = fixture();
  for (const reply of [null, 1, [], [1], [0, 60], [1.5, 60], [1, -1], [1, 61], [NaN, 30]]) {
    f.redis.client.eval = async () => reply;
    await assert.rejects(() => f.guard.canActivate(f.context()), status(503));
  }
  const expiring = fixture();
  expiring.setTtl(0);
  expiring.counts.set('rate:read:user-a', 600);
  await assert.rejects(() => expiring.guard.canActivate(expiring.context()), status(429));
  assert.equal(expiring.headers.get('Retry-After'), 1);
});

test('rate limit environment settings are validated and read at guard startup', async () => {
  const names = ['READ', 'WRITE', 'LOGIN', 'PUBLIC'].map(name => `RATE_LIMIT_${name}_PER_MINUTE`);
  try {
    assert.deepEqual(getConfig().rateLimits, { read: 600, write: 120, login: 5, public: 120 });
    process.env.RATE_LIMIT_READ_PER_MINUTE = '2';
    const f = fixture();
    await f.guard.canActivate(f.context());
    await f.guard.canActivate(f.context());
    await assert.rejects(() => f.guard.canActivate(f.context()), status(429));
    delete process.env.RATE_LIMIT_READ_PER_MINUTE;
    for (const name of names) {
      for (const value of ['0', '-1', '1.5', 'invalid', 'Infinity', '10001', '']) {
        process.env[name] = value;
        assert.throws(() => getConfig(), new RegExp(name));
      }
      delete process.env[name];
    }
    process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '101';
    assert.throws(() => getConfig(), /RATE_LIMIT_LOGIN_PER_MINUTE/);
  } finally {
    for (const name of names) delete process.env[name];
  }
});
