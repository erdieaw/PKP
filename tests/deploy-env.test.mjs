import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../deploy/generate-env.mjs', import.meta.url));
const assignments = text => Object.fromEntries(text.split('\n').filter(line => /^[A-Z_]+=/.test(line))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pkp-deploy-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'private.env');
  const run = (...args) => spawnSync(process.execPath, [script, '--output', output, ...args], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, JWT_SECRET: 'ignored-shell-secret' },
  });
  return { dir, output, run };
}

test('generator creates independent private secrets and matching internal URLs without exposing them', t => {
  const { dir, output, run } = fixture(t);
  writeFileSync(join(dir, '.env'), 'JWT_SECRET=ignored-file-secret\nPOSTGRES_USER=not-sipkp\n');
  const result = run('--project', 'pkp-production-123', '--domain', 'pkp.example.test');
  assert.equal(result.status, 0, result.stderr);
  const env = assignments(readFileSync(output, 'utf8'));
  assert.equal(env.COMPOSE_PROJECT_NAME, 'pkp-production-123');
  assert.equal(env.PKP_DOMAIN, 'pkp.example.test');
  assert.equal(env.POSTGRES_USER, 'sipkp');
  const hexSecrets = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET'].map(name => env[name]);
  for (const value of hexSecrets) {
    assert.match(value, /^[0-9a-f]{64}$/);
    assert.ok(!(result.stdout + result.stderr).includes(value));
  }
  assert.equal(new Set(hexSecrets).size, hexSecrets.length);
  const key = Buffer.from(env.PROVINCE_CREDENTIAL_KEY, 'base64');
  assert.equal(key.length, 32);
  assert.equal(key.toString('base64'), env.PROVINCE_CREDENTIAL_KEY);
  assert.ok(!result.stdout.includes(env.PROVINCE_CREDENTIAL_KEY));
  assert.equal(new URL(env.DATABASE_URL).password, env.POSTGRES_PASSWORD);
  assert.equal(new URL(env.DATABASE_URL).hostname, 'postgres');
  assert.equal(new URL(env.REDIS_URL).password, env.REDIS_PASSWORD);
  assert.equal(new URL(env.REDIS_URL).hostname, 'redis');
  for (const name of ['MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY', 'TRAEFIK_TRUSTED_PROXY', 'BOOTSTRAP_ADMIN_USERNAME', 'BOOTSTRAP_ADMIN_PASSWORD']) {
    assert.equal(env[name], '');
  }
  if (process.platform !== 'win32') assert.equal(statSync(output).mode & 0o777, 0o600);
  const second = join(dir, 'second.env');
  const independent = run('--project', 'pkp-production-123', '--output', second);
  assert.equal(independent.status, 0, independent.stderr);
  assert.notEqual(assignments(readFileSync(second, 'utf8')).JWT_SECRET, env.JWT_SECRET);
});

test('optional bootstrap and MinIO candidates are generated but never printed or provisioned', t => {
  const { output, run } = fixture(t);
  const result = run('--project', 'pkp-new', '--bootstrap-user', 'dinkes.admin', '--minio-credentials');
  assert.equal(result.status, 0, result.stderr);
  const env = assignments(readFileSync(output, 'utf8'));
  assert.equal(env.BOOTSTRAP_ADMIN_USERNAME, 'dinkes.admin');
  assert.match(env.MINIO_ACCESS_KEY, /^PKP[0-9a-f]{17}$/);
  assert.match(env.BOOTSTRAP_ADMIN_PASSWORD, /^[0-9a-f]{64}$/);
  assert.match(env.MINIO_SECRET_KEY, /^[A-Za-z0-9+/]{40}$/);
  assert.equal(Buffer.from(env.MINIO_SECRET_KEY, 'base64').length, 30);
  for (const name of ['MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'BOOTSTRAP_ADMIN_PASSWORD']) {
    assert.ok(!(result.stdout + result.stderr).includes(env[name]));
  }
  assert.notEqual(env.MINIO_SECRET_KEY, env.JWT_SECRET);
  assert.match(result.stdout, /candidates ONLY/);
  assert.equal(env.MINIO_ENDPOINT, '');
  assert.equal(env.MINIO_ROOT_USER, undefined);
});

test('existing files and symlinks are never overwritten', t => {
  const { dir, output, run } = fixture(t);
  writeFileSync(output, 'existing-secret-do-not-replace');
  const result = run('--project', 'pkp-new');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/);
  assert.equal(readFileSync(output, 'utf8'), 'existing-secret-do-not-replace');
  assert.ok(!result.stderr.includes('existing-secret-do-not-replace'));
  const link = join(dir, 'symlink.env');
  symlinkSync(output, link);
  assert.notEqual(run('--project', 'pkp-new', '--output', link).status, 0);
  assert.equal(readFileSync(output, 'utf8'), 'existing-secret-do-not-replace');
});

test('help and invalid arguments do not create output or echo argument values', t => {
  const { output, run } = fixture(t);
  assert.equal(run('--help').status, 0);
  const invalid = [[], ['--project', 'INVALID'], ['--project', 'pkp\nJWT_SECRET=injected'],
    ['--project', 'pkp', '--domain', 'https://pkp.example.test'],
    ['--project', 'pkp', '--domain', 'a..test'],
    ['--project', 'pkp', '--output', ''],
    ['--project', 'pkp', '--bootstrap-user', 'admin\nJWT_SECRET=injected'],
    ['--unknown-secret', 'do-not-echo-this']];
  for (const args of invalid) {
    const result = run(...args);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /injected|do-not-echo-this/);
  }
  assert.throws(() => statSync(output), { code: 'ENOENT' });
});

test('default output follows the script directory, not the working directory', t => {
  const { dir } = fixture(t);
  const deploy = join(dir, 'deploy');
  mkdirSync(deploy);
  copyFileSync(script, join(deploy, 'generate-env.mjs'));
  copyFileSync(new URL('../deploy/dokploy.env.example', import.meta.url), join(deploy, 'dokploy.env.example'));
  const result = spawnSync(process.execPath, [join(deploy, 'generate-env.mjs'), '--project', 'pkp-new'], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(assignments(readFileSync(join(deploy, 'dokploy.env'), 'utf8')).COMPOSE_PROJECT_NAME, 'pkp-new');
  assert.throws(() => statSync(join(dir, 'dokploy.env')), { code: 'ENOENT' });
});

test('generated env fails closed until external fields are supplied, then Compose consumes it consistently', t => {
  const { output, run } = fixture(t);
  assert.equal(run('--project', 'pkp-fixture', '--minio-credentials', '--bootstrap-user', 'fixture.admin').status, 0);
  const compose = (...args) => spawnSync('docker', ['compose', '--env-file', output,
    '-f', fileURLToPath(new URL('../compose.dokploy.yml', import.meta.url)), '--profile', 'tools', 'config', ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  const incomplete = compose('--quiet');
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /required variable/);
  const content = readFileSync(output, 'utf8');
  const external = {
    TURNSTILE_SITE_KEY: 'fixture-site-key', TURNSTILE_SECRET_KEY: 'fixture-turnstile-secret',
    TRAEFIK_TRUSTED_PROXY: '192.0.2.10', MINIO_ENDPOINT: 'http://fixture-silo.test:9100',
  };
  writeFileSync(output, content.replace(/^([A-Z_]+)=(.*)$/gm,
    (line, name) => Object.hasOwn(external, name) ? `${name}=${external[name]}` : line));
  const result = compose('--format', 'json');
  // Never put Compose stdout in assertion messages: it contains generated credentials.
  assert.equal(result.status, 0, 'Compose must accept the completed fixture env');
  const env = assignments(readFileSync(output, 'utf8'));
  const { name, services } = JSON.parse(result.stdout);
  assert.equal(name, 'pkp-fixture');
  for (const service of [services.app, services.ops]) {
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'PROVINCE_CREDENTIAL_KEY',
      'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY']) assert.ok(service.environment[key] === env[key], `${key} mismatch`);
  }
  assert.ok(services.postgres.environment.POSTGRES_PASSWORD === env.POSTGRES_PASSWORD);
  assert.ok(services.redis.environment.REDIS_PASSWORD === env.REDIS_PASSWORD);
  assert.ok(services.ops.environment.BOOTSTRAP_ADMIN_PASSWORD === env.BOOTSTRAP_ADMIN_PASSWORD);
  assert.equal(services.app.environment.BOOTSTRAP_ADMIN_PASSWORD, undefined);
  assert.equal(services.frontend.environment.JWT_SECRET, undefined);
});
