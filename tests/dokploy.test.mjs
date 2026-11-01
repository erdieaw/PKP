import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  COMPOSE_PROJECT_NAME: 'sipkp-compose-validation',
  POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test-only',
  DATABASE_URL: 'postgresql://sipkp:test-only@database-postgresmain-hoc5kd:5432/sipkp?schema=public',
  REDIS_PASSWORD: 'test-only', REDIS_URL: 'redis://:test-only@redis:6379',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  PROVINCE_CREDENTIAL_KEY: Buffer.alloc(32).toString('base64'),
  MINIO_ACCESS_KEY: 'test-key', MINIO_SECRET_KEY: 'test-only-secret',
  MINIO_ENDPOINT: 'http://silo.example.test:9100',
  EVIDENCE_BUCKET: 'pkponline', REPORTS_BUCKET: 'pkponline',
  TRAEFIK_TRUSTED_PROXY: '192.0.2.10',
  TURNSTILE_SITE_KEY: 'fixture-public-site-key',
  TURNSTILE_SECRET_KEY: 'fixture-server-only-secret',
};

function config(overrides = {}) {
  return spawnSync('docker', ['compose', '--env-file', '/dev/null', '-f', 'compose.dokploy.yml',
    '--profile', 'tools', 'config', '--format', 'json'], {
    cwd, env: { ...env, ...overrides }, encoding: 'utf8',
  });
}

test('Dokploy routes only frontend, requires private external storage, and preserves data declarations', () => {
  const result = config();
  assert.equal(result.status, 0, result.stderr);
  const { name, services, networks } = JSON.parse(result.stdout);
  assert.equal(name, env.COMPOSE_PROJECT_NAME);
  for (const service of Object.values(services)) {
    assert.equal(service.ports, undefined);
    assert.equal(service.container_name, undefined);
  }
  assert.deepEqual(Object.keys(services).sort(), ['app', 'frontend', 'ops', 'redis']);
  const { frontend, app, redis, ops } = services;
  assert.equal(frontend.build.target, 'dokploy');
  assert.equal(app.build.target, 'runtime');
  assert.equal(ops.build.target, 'ops');
  assert.deepEqual(ops.profiles, ['tools']);
  assert.equal(frontend.environment.NGINX_ENVSUBST_FILTER, '^TRAEFIK_TRUSTED_PROXY');
  assert.deepEqual(Object.keys(frontend.environment).sort(), ['NGINX_ENVSUBST_FILTER', 'TRAEFIK_TRUSTED_PROXY']);
  assert.equal(frontend.networks.proxy.ipv4_address, app.environment.TRUSTED_PROXY_IPS);
  assert.equal(app.networks.proxy.ipv4_address, '172.30.92.3');
  assert.notEqual(app.networks.proxy.ipv4_address, frontend.networks.proxy.ipv4_address);
  assert.deepEqual(Object.keys(app.networks).sort(), ['data', 'dokploy-network', 'proxy']);
  assert.deepEqual(Object.keys(redis.networks), ['data']);
  assert.equal(networks['dokploy-network'].external, true);
  assert.equal(app.environment.DATABASE_URL, env.DATABASE_URL);
  assert.equal(new URL(app.environment.DATABASE_URL).hostname, 'database-postgresmain-hoc5kd');
  assert.equal(frontend.labels['traefik.http.services.sipkp-fe.loadbalancer.server.port'], '8080');
  for (const [name, service] of Object.entries(services)) {
    assert.equal(service.labels['traefik.enable'], name === 'frontend' ? 'true' : 'false');
    assert.ok(Object.keys(service.labels).every(label => !label.includes('storage')));
    if (name !== 'frontend') {
      assert.equal(Object.keys(service.labels).some(label => label.startsWith('traefik.http')), false);
    }
  }
  assert.equal(frontend.depends_on.app.condition, 'service_healthy');
  assert.ok(app.healthcheck.test.join(' ').includes('/api/v1/health/ready'));
  assert.equal(app.environment.FRONTEND_URL, 'https://pkp.pkm-ujungpangkah.online');
  assert.equal(app.environment.TURNSTILE_REQUIRED, 'true');
  assert.equal(app.environment.TURNSTILE_SITE_KEY, env.TURNSTILE_SITE_KEY);
  assert.equal(app.environment.TURNSTILE_SECRET_KEY, env.TURNSTILE_SECRET_KEY);
  assert.deepEqual(Object.keys(app.depends_on).sort(), ['redis']);
  assert.equal(app.depends_on.redis.condition, 'service_healthy');
  assert.deepEqual(Object.keys(ops.networks), ['data', 'dokploy-network']);
  assert.equal(ops.depends_on, undefined);
  for (const service of [app, ops]) {
    assert.deepEqual(Object.keys(service.environment).filter(key => /BUCKET|MINIO/.test(key)).sort(),
      ['EVIDENCE_BUCKET', 'MINIO_ACCESS_KEY', 'MINIO_ENDPOINT', 'MINIO_SECRET_KEY', 'REPORTS_BUCKET']);
    for (const key of ['MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'EVIDENCE_BUCKET', 'REPORTS_BUCKET']) {
      assert.equal(service.environment[key], env[key]);
    }
  }
  assert.equal(redis.volumes[0].source, 'redis_data');
  const source = readFileSync(new URL('../compose.dokploy.yml', import.meta.url), 'utf8');
  // Reuse of the existing Dokploy PostgreSQL container must not reintroduce a DB service.
  assert.doesNotMatch(source, /^\s{2}postgres:\s*$/m);
  assert.doesNotMatch(source, /postgres_data|POSTGRES_HOST_AUTH_METHOD/);
  // Compose can omit unused volumes from normalized output; the source must retain it.
  assert.match(source, /^  minio_data:\s*$/m);
  assert.doesNotMatch(source, /MINIO_ROOT_|MINIO_PUBLIC_ENDPOINT|PKP_STORAGE_DOMAIN|sipkp-storage/);
});

test('Dokploy refuses missing required values and domain/IP overrides stay consistent', () => {
  for (const name of ['COMPOSE_PROJECT_NAME', 'DATABASE_URL', 'REDIS_URL', 'REDIS_PASSWORD', 'JWT_SECRET',
    'PROVINCE_CREDENTIAL_KEY', 'MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY',
    'EVIDENCE_BUCKET', 'REPORTS_BUCKET', 'TRAEFIK_TRUSTED_PROXY', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
    for (const value of ['', undefined]) {
      const result = config({ [name]: value });
      assert.notEqual(result.status, 0, `${name} must be required when empty or unset`);
    }
  }
  const result = config({ PKP_DOMAIN: 'pkp.example.test', MINIO_ENDPOINT: 'https://private-s3.example.test:9100',
    EVIDENCE_BUCKET: 'private-evidence', REPORTS_BUCKET: 'private-reports',
    PKP_PROXY_SUBNET: '172.30.93.0/29', PKP_FRONTEND_PROXY_IP: '172.30.93.2', PKP_BACKEND_PROXY_IP: '172.30.93.3' });
  assert.equal(result.status, 0, result.stderr);
  const { services, networks } = JSON.parse(result.stdout);
  assert.equal(services.app.environment.FRONTEND_URL, 'https://pkp.example.test');
  for (const service of [services.app, services.ops]) {
    assert.equal(service.environment.MINIO_ENDPOINT, 'https://private-s3.example.test:9100');
    assert.equal(service.environment.EVIDENCE_BUCKET, 'private-evidence');
    assert.equal(service.environment.REPORTS_BUCKET, 'private-reports');
  }
  assert.equal(services.frontend.networks.proxy.ipv4_address, '172.30.93.2');
  assert.equal(services.app.environment.TRUSTED_PROXY_IPS, '172.30.93.2');
  assert.equal(services.app.networks.proxy.ipv4_address, '172.30.93.3');
  assert.equal(networks.proxy.ipam.config[0].subnet, '172.30.93.0/29');
  assert.equal(services.frontend.labels['traefik.http.routers.sipkp-fe-secure.rule'], 'Host(`pkp.example.test`)');
});

test('local Compose keeps loopback MinIO development and supports separate root credentials without reading env files', () => {
  const localConfig = (overrides = {}) => spawnSync('docker', ['compose', '--env-file', '/dev/null',
    '-f', 'backend/compose.yml', '--profile', 'app', 'config', '--no-env-resolution', '--format', 'json'], {
    cwd, env: { ...env, ...overrides }, encoding: 'utf8',
  });
  const legacy = localConfig();
  assert.equal(legacy.status, 0, legacy.stderr);
  const { services } = JSON.parse(legacy.stdout);
  assert.equal(services.minio.environment.MINIO_ROOT_USER, env.MINIO_ACCESS_KEY);
  assert.equal(services.minio.environment.MINIO_ROOT_PASSWORD, env.MINIO_SECRET_KEY);
  assert.equal(services.app.environment.MINIO_ENDPOINT, 'http://minio:9000');
  assert.equal(services.app.environment.MINIO_PUBLIC_ENDPOINT, undefined);
  assert.equal(services.app.environment.TURNSTILE_REQUIRED, 'false');
  for (const service of Object.values(services)) {
    for (const port of service.ports ?? []) assert.equal(port.host_ip, '127.0.0.1');
  }
  assert.equal(services.minio.volumes[0].source, 'minio_data');
  const separate = localConfig({ MINIO_ROOT_USER: 'fixture-root', MINIO_ROOT_PASSWORD: 'fixture-root-secret',
    EVIDENCE_BUCKET: 'evidence-dev', REPORTS_BUCKET: 'reports-dev' });
  assert.equal(separate.status, 0, separate.stderr);
  const split = JSON.parse(separate.stdout).services;
  assert.equal(split.minio.environment.MINIO_ROOT_USER, 'fixture-root');
  assert.equal(split.minio.environment.MINIO_ROOT_PASSWORD, 'fixture-root-secret');
  assert.equal(split.app.environment.MINIO_ACCESS_KEY, env.MINIO_ACCESS_KEY);
  assert.equal(split.app.environment.MINIO_SECRET_KEY, env.MINIO_SECRET_KEY);
  assert.equal(split.app.environment.MINIO_ROOT_USER, '');
  assert.equal(split.app.environment.MINIO_ROOT_PASSWORD, '');
  assert.equal(split.app.environment.EVIDENCE_BUCKET, 'evidence-dev');
  assert.equal(split.app.environment.REPORTS_BUCKET, 'reports-dev');
  const defaults = localConfig({ EVIDENCE_BUCKET: undefined, REPORTS_BUCKET: undefined });
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.equal(JSON.parse(defaults.stdout).services.app.environment.EVIDENCE_BUCKET, 'evidence');
  assert.equal(JSON.parse(defaults.stdout).services.app.environment.REPORTS_BUCKET, 'reports');
});

test('storage examples expose only backend runtime variables and no production credential defaults', () => {
  const production = readFileSync(new URL('../deploy/dokploy.env.example', import.meta.url), 'utf8');
  const development = readFileSync(new URL('../backend/.env.example', import.meta.url), 'utf8');
  const assignments = source => Object.fromEntries(source.split('\n')
    .filter(line => /^[A-Z_]+=/.test(line)).map(line => line.split(/=(.*)/s).slice(0, 2)));
  for (const source of [production, development]) {
    const values = assignments(source);
    assert.equal(values.MINIO_PUBLIC_ENDPOINT, undefined);
    assert.equal(values.PKP_STORAGE_DOMAIN, undefined);
    assert.deepEqual(Object.keys(values).filter(key => key.endsWith('BUCKET')).sort(), ['EVIDENCE_BUCKET', 'REPORTS_BUCKET']);
    assert.equal(values.MINIO_ACCESS_KEY, '');
    assert.equal(values.MINIO_SECRET_KEY, '');
  }
  const prod = assignments(production);
  assert.equal(prod.MINIO_ENDPOINT, '');
  assert.equal(prod.EVIDENCE_BUCKET, 'pkponline');
  assert.equal(prod.REPORTS_BUCKET, 'pkponline');
  const dev = assignments(development);
  assert.equal(dev.EVIDENCE_BUCKET, 'evidence');
  assert.equal(dev.REPORTS_BUCKET, 'reports');
  assert.equal(prod.MINIO_ROOT_USER, undefined);
  assert.equal(prod.MINIO_ROOT_PASSWORD, undefined);
});

test('PKP storage runtime policy limits object operations and never grants bucket administration', () => {
  const policy = JSON.parse(readFileSync(new URL('../deploy/minio-pkp-runtime-policy.json', import.meta.url), 'utf8'));
  assert.equal(policy.Version, '2012-10-17');
  assert.deepEqual(policy.Statement, [
    { Sid: 'BucketReadiness', Effect: 'Allow', Action: ['s3:ListBucket'], Resource: ['arn:aws:s3:::pkponline'] },
    { Sid: 'ApplicationObjects', Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: [
      'arn:aws:s3:::pkponline/staging/*', 'arn:aws:s3:::pkponline/evidence/*', 'arn:aws:s3:::pkponline/reports/*',
    ] },
    { Sid: 'UploadCleanup', Effect: 'Allow', Action: ['s3:DeleteObject'], Resource: [
      'arn:aws:s3:::pkponline/staging/*', 'arn:aws:s3:::pkponline/evidence/*',
    ] },
  ]);
});
