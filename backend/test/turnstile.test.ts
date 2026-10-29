import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Global, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HTTP_CODE_METADATA, HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

test('Turnstile login protection (isolated environment, mocked fetch and database)', async t => {
  const originalEnv = process.env;
  const env = {
    NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null',
    DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
    JWT_SECRET: 'unit-test-secret-with-at-least-32-characters',
    MINIO_ACCESS_KEY: 'unused-key', MINIO_SECRET_KEY: 'unused-secret',
    FRONTEND_URL: 'https://pkp.example.test:8443',
  };
  process.env = { ...env };
  // Never permit an unexpected request to reach Cloudflare or another external host.
  const unexpectedFetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch'); });
  t.beforeEach(() => { process.env = { ...env }; });
  try {
    // Import only after dotenv is directed away from any real .env file.
    const { getConfig } = await import('../src/config');
    const { TurnstileService } = await import('../src/auth/turnstile.service');
    const { AuthService } = await import('../src/auth/auth.service');
    const { AuthController } = await import('../src/auth/auth.controller');
    const { AuthModule } = await import('../src/auth/auth.module');
    const { LoginDto } = await import('../src/auth/auth.dto');
    const { DbService } = await import('../src/core/db.service');
    const { PUBLIC_KEY } = await import('../src/core/auth.decorators');

    const configure = () => {
      process.env.TURNSTILE_SITE_KEY = ' configured-site-key ';
      process.env.TURNSTILE_SECRET_KEY = ' configured-secret-key ';
    };
    const success = { success: true, hostname: 'pkp.example.test', action: 'login' };
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const statusIs = (status: number) => (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), status);
      const text = JSON.stringify(error.getResponse());
      assert.ok(text.includes(status === 422 ? 'Verifikasi keamanan gagal' : 'Layanan verifikasi keamanan'));
      for (const value of ['configured-secret-key', 'private-token', 'raw-provider-detail']) assert.ok(!text.includes(value));
      return true;
    };

    for (const mode of ['development', 'test']) {
      await t.test(`${mode} permits disabled Turnstile only with both keys empty`, () => {
        process.env.NODE_ENV = mode;
        assert.deepEqual(getConfig().turnstile, { required: false, siteKey: '', secretKey: '', hostname: 'pkp.example.test' });
        process.env.TURNSTILE_SITE_KEY = ' \t ';
        process.env.TURNSTILE_SECRET_KEY = ' \n ';
        assert.equal(getConfig().turnstile.siteKey, '');
      });
    }

    for (const mode of ['development', 'test', 'production']) {
      for (const key of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
        await t.test(`${mode} rejects an unpaired ${key}`, () => {
          process.env.NODE_ENV = mode;
          process.env[key] = 'configured-key';
          assert.throws(getConfig, /must both be configured/);
          for (const required of ['true', 'false']) {
            process.env.TURNSTILE_REQUIRED = required;
            assert.throws(getConfig, /must both be configured/);
          }
        });
      }
      await t.test(`${mode} trims paired keys and derives hostname without the port`, () => {
        process.env.NODE_ENV = mode;
        configure();
        assert.deepEqual(getConfig().turnstile, {
          required: mode === 'production', siteKey: 'configured-site-key', secretKey: 'configured-secret-key', hostname: 'pkp.example.test',
        });
        for (const required of ['true', 'false']) {
          process.env.TURNSTILE_REQUIRED = required;
          assert.equal(getConfig().turnstile.required, required === 'true');
          assert.equal(getConfig().turnstile.siteKey, 'configured-site-key');
        }
      });
      await t.test(`${mode} requires both keys when explicitly required`, () => {
        process.env.NODE_ENV = mode;
        process.env.TURNSTILE_REQUIRED = 'true';
        assert.throws(getConfig, /must both be configured/);
        process.env.TURNSTILE_SITE_KEY = ' \t ';
        process.env.TURNSTILE_SECRET_KEY = ' \n ';
        assert.throws(getConfig, /must both be configured/);
      });
      await t.test(`${mode} permits absent keys when explicitly not required`, async () => {
        process.env.NODE_ENV = mode;
        process.env.TURNSTILE_REQUIRED = 'false';
        assert.deepEqual(getConfig().turnstile, {
          required: false, siteKey: '', secretKey: '', hostname: 'pkp.example.test',
        });
        const service = new TurnstileService();
        assert.deepEqual(service.loginConfig(), { turnstileEnabled: false, turnstileSiteKey: null });
        await service.verify(undefined);
        process.env.TURNSTILE_SITE_KEY = ' \t ';
        process.env.TURNSTILE_SECRET_KEY = ' \n ';
        assert.equal(getConfig().turnstile.required, false);
        assert.equal(getConfig().turnstile.siteKey, '');
      });
    }

    for (const value of ['', 'TRUE', 'FALSE', '1', '0', 'yes', 'no', ' true', 'false ', 'null']) {
      await t.test(`rejects invalid TURNSTILE_REQUIRED value ${JSON.stringify(value)}`, () => {
        configure();
        process.env.TURNSTILE_REQUIRED = value;
        assert.throws(getConfig, /TURNSTILE_REQUIRED must be true or false/);
      });
    }

    await t.test('production rejects missing or whitespace-only keys', () => {
      process.env.NODE_ENV = 'production';
      assert.throws(getConfig, /must both be configured/);
      process.env.TURNSTILE_SITE_KEY = ' \t ';
      process.env.TURNSTILE_SECRET_KEY = ' \t ';
      assert.throws(getConfig, /must both be configured/);
    });

    const testSiteKeys = [
      '1x00000000000000000000AA', '2x00000000000000000000AB',
      '1x00000000000000000000BB', '2x00000000000000000000BB', '3x00000000000000000000FF',
    ];
    const testSecretKeys = [
      '1x0000000000000000000000000000000AA',
      '2x0000000000000000000000000000000AA',
      '3x0000000000000000000000000000000AA',
    ];
    for (const [name, keys] of [['TURNSTILE_SITE_KEY', testSiteKeys], ['TURNSTILE_SECRET_KEY', testSecretKeys]] as const) {
      for (const key of keys) {
        await t.test(`production rejects official test key ${key}`, () => {
          configure();
          process.env.NODE_ENV = 'production';
          process.env[name] = ` ${key} `;
          assert.throws(getConfig, /testing keys are not allowed/);
          process.env.TURNSTILE_REQUIRED = 'false';
          assert.throws(getConfig, /testing keys are not allowed/);
        });
      }
    }

    await t.test('test mode accepts official dummy keys', () => {
      process.env.TURNSTILE_SITE_KEY = testSiteKeys[0];
      process.env.TURNSTILE_SECRET_KEY = testSecretKeys[0];
      assert.equal(getConfig().turnstile.siteKey, testSiteKeys[0]);
    });

    await t.test('disabled login config contains no secret and makes no verification request', async () => {
      const service = new TurnstileService();
      assert.deepEqual(service.loginConfig(), { turnstileEnabled: false, turnstileSiteKey: null });
      await service.verify(undefined);
      assert.equal(unexpectedFetch.mock.callCount(), 0);
    });

    await t.test('enabled login config exposes only the trimmed public key', () => {
      configure();
      assert.deepEqual(new TurnstileService().loginConfig(), {
        turnstileEnabled: true, turnstileSiteKey: 'configured-site-key',
      });
      const handler = AuthController.prototype.loginConfig;
      assert.equal(Reflect.getMetadata(PUBLIC_KEY, handler), true);
      assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'login-config');
      assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 200);
      assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, handler), [{ name: 'Cache-Control', value: 'no-store' }]);
      const auth = new AuthService({} as never, {} as never, new TurnstileService());
      assert.deepEqual(new AuthController(auth).loginConfig(), auth.loginConfig());
    });

    await t.test('DTO permits an absent token or a nonblank token up to 2048 characters', async () => {
      for (const token of [undefined, 'private-token', 'a'.repeat(2048)]) {
        const dto = plainToInstance(LoginDto, { username: 'user', password: 'password', turnstileToken: token });
        assert.deepEqual(await validate(dto), []);
      }
      for (const token of [null, '', ' \t ', 1, {}, [], 'a'.repeat(2049)]) {
        const dto = plainToInstance(LoginDto, { username: 'user', password: 'password', turnstileToken: token });
        assert.ok((await validate(dto)).some(error => error.property === 'turnstileToken'));
      }
    });

    await t.test('verification uses one fixed form POST, a 5-second timeout, and exact hostname/action', async s => {
      configure();
      const signal = new AbortController().signal;
      const timeout = s.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
        assert.equal(milliseconds, 5000);
        return signal;
      });
      const fetch = s.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
        assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
        assert.equal(options?.method, 'POST');
        assert.ok(options?.body instanceof URLSearchParams);
        assert.deepEqual([...options.body.entries()], [
          ['secret', 'configured-secret-key'], ['response', 'private-token'],
        ]);
        assert.equal(options.signal, signal);
        return response(success);
      });
      await new TurnstileService().verify('private-token');
      assert.equal(fetch.mock.callCount(), 1);
      assert.equal(timeout.mock.callCount(), 1);
    });

    const outcomes = [
      { label: 'invalid token', body: { success: false, 'error-codes': ['invalid-input-response'] }, status: 422 },
      { label: 'expired or replayed token', body: { success: false, 'error-codes': ['timeout-or-duplicate'] }, status: 422 },
      { label: 'failed challenge', body: { success: false }, status: 422 },
      { label: 'wrong hostname', body: { ...success, hostname: 'other.example.test' }, status: 422 },
      { label: 'hostname including port', body: { ...success, hostname: 'pkp.example.test:8443' }, status: 422 },
      { label: 'wrong action', body: { ...success, action: 'register' }, status: 422 },
      { label: 'internal error', body: { success: false, 'error-codes': ['internal-error'] }, status: 503 },
      { label: 'invalid secret', body: { success: false, 'error-codes': ['invalid-input-secret'] }, status: 503 },
      { label: 'missing secret', body: { success: false, 'error-codes': ['missing-input-secret'] }, status: 503 },
      { label: 'null payload', body: null, status: 503 },
      { label: 'array payload', body: [], status: 503 },
      { label: 'string payload', body: 'raw-provider-detail', status: 503 },
      { label: 'missing success', body: {}, status: 503 },
      { label: 'nonboolean success', body: { ...success, success: 'true' }, status: 503 },
      { label: 'missing hostname', body: { success: true, action: 'login' }, status: 503 },
      { label: 'missing action', body: { success: true, hostname: 'pkp.example.test' }, status: 503 },
      { label: 'nonstring hostname', body: { ...success, hostname: 1 }, status: 503 },
      { label: 'nonstring action', body: { ...success, action: null }, status: 503 },
      { label: 'malformed error codes', body: { success: false, 'error-codes': 'internal-error' }, status: 503 },
      { label: 'nonstring error code', body: { success: false, 'error-codes': [null] }, status: 503 },
    ];
    for (const outcome of outcomes) {
      await t.test(`${outcome.label} rejects direct login before database, Argon2, or session work`, async s => {
        configure();
        const fetch = s.mock.method(globalThis, 'fetch', async () => response(outcome.body));
        const lookup = s.mock.fn(() => { throw new Error('Database lookup must not run'); });
        const transaction = s.mock.fn(() => { throw new Error('Session transaction must not run'); });
        const sign = s.mock.fn(() => { throw new Error('JWT signing must not run'); });
        const auth = new AuthService({ user: { findUnique: lookup }, $transaction: transaction } as never,
          { signAsync: sign } as never, new TurnstileService());
        await assert.rejects(auth.login({ username: 'user', password: 'password', turnstileToken: 'private-token' }), statusIs(outcome.status));
        assert.equal(lookup.mock.callCount(), 0);
        assert.equal(transaction.mock.callCount(), 0);
        assert.equal(sign.mock.callCount(), 0);
        assert.equal(fetch.mock.callCount(), 1);
      });
    }

    await t.test('missing, null, blank, nonstring, or oversized tokens reject before fetch or database', async s => {
      configure();
      const fetch = s.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
      const lookup = s.mock.fn(() => { throw new Error('Must not look up user'); });
      const auth = new AuthService({ user: { findUnique: lookup } } as never, {} as never, new TurnstileService());
      for (const token of [undefined, null, '', ' \t ', 123, 'a'.repeat(2049)]) {
        await assert.rejects(auth.login({ username: 'user', password: 'password', turnstileToken: token as string }), statusIs(422));
      }
      assert.equal(fetch.mock.callCount(), 0);
      assert.equal(lookup.mock.callCount(), 0);
    });

    await t.test('explicit false never bypasses verification for configured production keys', async s => {
      configure();
      process.env.NODE_ENV = 'production';
      process.env.TURNSTILE_REQUIRED = 'false';
      const fetch = s.mock.method(globalThis, 'fetch', async () => response({ success: false }));
      const lookup = s.mock.fn(() => { throw new Error('Must not look up user'); });
      const auth = new AuthService({ user: { findUnique: lookup } } as never, {} as never, new TurnstileService());
      assert.deepEqual(auth.loginConfig(), { turnstileEnabled: true, turnstileSiteKey: 'configured-site-key' });
      await assert.rejects(auth.login({ username: 'user', password: 'password' }), statusIs(422));
      assert.equal(fetch.mock.callCount(), 0);
      await assert.rejects(auth.login({ username: 'user', password: 'password', turnstileToken: 'private-token' }), statusIs(422));
      assert.equal(fetch.mock.callCount(), 1);
      assert.equal(lookup.mock.callCount(), 0);
    });

    for (const failure of ['http', 'malformed-json', 'network', 'timeout']) {
      await t.test(`${failure} produces safe 503 without retries or database lookup`, async s => {
        configure();
        const timeoutController = new AbortController();
        timeoutController.abort(new DOMException('raw-provider-detail', 'TimeoutError'));
        if (failure === 'timeout') s.mock.method(AbortSignal, 'timeout', () => timeoutController.signal);
        const fetch = s.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
          if (failure === 'http') return response({ message: 'raw-provider-detail' }, 500);
          if (failure === 'malformed-json') return new Response('{broken-json');
          if (failure === 'timeout') {
            assert.equal(options?.signal?.aborted, true);
            throw options?.signal?.reason;
          }
          throw new Error('private-token configured-secret-key raw-provider-detail');
        });
        const lookup = s.mock.fn(() => { throw new Error('Must not look up user'); });
        const auth = new AuthService({ user: { findUnique: lookup } } as never, {} as never, new TurnstileService());
        await assert.rejects(auth.login({ username: 'user', password: 'password', turnstileToken: 'private-token' }), statusIs(503));
        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(lookup.mock.callCount(), 0);
      });
    }

    await t.test('replay verifies again and cannot use a previously successful token result', async s => {
      configure();
      let requests = 0;
      const fetch = s.mock.method(globalThis, 'fetch', async () => response(++requests === 1
        ? success : { success: false, 'error-codes': ['timeout-or-duplicate'] }));
      const service = new TurnstileService();
      await service.verify('private-token');
      await assert.rejects(service.verify('private-token'), statusIs(422));
      assert.equal(fetch.mock.callCount(), 2);
    });

    await t.test('successful verification allows the first database lookup only after Cloudflare responds', async s => {
      configure();
      const order: string[] = [];
      s.mock.method(globalThis, 'fetch', async () => {
        order.push('cloudflare');
        return response(success);
      });
      const reachedDatabase = new Error('Mock database boundary reached');
      const auth = new AuthService({ user: { findUnique: () => {
        order.push('database');
        throw reachedDatabase;
      } } } as never, {} as never, new TurnstileService());
      await assert.rejects(auth.login({ username: 'user', password: 'password', turnstileToken: 'private-token' }), error => error === reachedDatabase);
      assert.deepEqual(order, ['cloudflare', 'database']);
    });

    await t.test('Nest resolves TurnstileService through AuthModule with a mock database provider', async () => {
      configure();
      // tsx omits constructor metadata; mirror the metadata emitted by the production tsc build.
      Reflect.defineMetadata('design:paramtypes', [DbService, JwtService, TurnstileService], AuthService);
      Reflect.defineMetadata('design:paramtypes', [AuthService], AuthController);
      @Global()
      @Module({ providers: [{ provide: DbService, useValue: {} }], exports: [DbService] })
      class MockDatabaseModule {}
      @Module({ imports: [MockDatabaseModule, AuthModule] })
      class TestModule {}
      const app = await NestFactory.createApplicationContext(TestModule, { logger: false, abortOnError: false });
      try {
        assert.deepEqual(app.get(AuthService).loginConfig(), {
          turnstileEnabled: true, turnstileSiteKey: 'configured-site-key',
        });
        assert.ok(app.get(TurnstileService) instanceof TurnstileService);
      } finally { await app.close(); }
    });
  } finally {
    process.env = originalEnv;
  }
});
