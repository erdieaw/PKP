import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import { getConfig } from '../src/config';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.JWT_SECRET ??= 'test-only-secret-with-at-least-32-characters';
process.env.MINIO_ACCESS_KEY ??= 'test-key';
process.env.MINIO_SECRET_KEY ??= 'test-secret';

test('proxy trust defaults off and accepts only explicit IP addresses', () => {
  const original = process.env.TRUSTED_PROXY_IPS;
  try {
    delete process.env.TRUSTED_PROXY_IPS;
    assert.deepEqual(getConfig().trustedProxyIps, []);
    process.env.TRUSTED_PROXY_IPS = '172.30.92.2, ::1';
    assert.deepEqual(getConfig().trustedProxyIps, ['172.30.92.2', '::1']);
    for (const value of ['true', '1', '*', '0.0.0.0/0', 'loopback', 'nginx', '127.0.0.1,', Array(17).fill('127.0.0.1').join(',')]) {
      process.env.TRUSTED_PROXY_IPS = value;
      assert.throws(() => getConfig(), /TRUSTED_PROXY_IPS/);
    }
  } finally {
    if (original === undefined) delete process.env.TRUSTED_PROXY_IPS;
    else process.env.TRUSTED_PROXY_IPS = original;
  }
});

test('Express uses only a trusted peer and selects the nearest untrusted client IP', async () => {
  const app = new ExpressAdapter().getInstance();
  app.get('/', (req: any, res: any) => res.json({ ip: req.ip, protocol: req.protocol }));
  app.set('trust proxy', false);
  const headers = { 'X-Forwarded-For': '198.51.100.99, 192.0.2.20', 'X-Forwarded-Proto': 'https' };
  const direct = await request(app).get('/').set(headers).expect(200);
  assert.notEqual(direct.body.ip, '192.0.2.20');
  assert.equal(direct.body.protocol, 'http');
  app.set('trust proxy', ['172.30.92.2']);
  const untrusted = await request(app).get('/').set(headers).expect(200);
  assert.equal(untrusted.body.ip, direct.body.ip);
  app.set('trust proxy', ['127.0.0.1', '::1']);
  const proxied = await request(app).get('/').set(headers).expect(200);
  assert.equal(proxied.body.ip, '192.0.2.20');
  assert.equal(proxied.body.protocol, 'https');
});
