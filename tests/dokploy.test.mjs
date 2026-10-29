import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  COMPOSE_PROJECT_NAME: 'sipkp-compose-validation',
  POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test-only',
  DATABASE_URL: 'postgresql://test:test-only@postgres:5432/test',
  REDIS_PASSWORD: 'test-only', REDIS_URL: 'redis://:test-only@redis:6379',
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  PROVINCE_CREDENTIAL_KEY: Buffer.alloc(32).toString('base64'),
  MINIO_ACCESS_KEY: 'test-key', MINIO_SECRET_KEY: 'test-only-secret',
  TRAEFIK_TRUSTED_PROXY: '192.0.2.10',
};

function config(overrides = {}) {
  return spawnSync('docker', ['compose', '--env-file', '/dev/null', '-f', 'compose.dokploy.yml',
    '--profile', 'tools', 'config', '--format', 'json'], {
    cwd, env: { ...env, ...overrides }, encoding: 'utf8',
  });
}

test('Dokploy routes only frontend and storage, keeps secrets out of FE, and isolates app ingress', () => {
  const result = config();
  assert.equal(result.status, 0, result.stderr);
  const { name, services, networks } = JSON.parse(result.stdout);
  assert.equal(name, env.COMPOSE_PROJECT_NAME);
  for (const service of Object.values(services)) {
    assert.equal(service.ports, undefined);
    assert.equal(service.container_name, undefined);
  }
  const { frontend, app, minio, postgres, redis, ops } = services;
  assert.equal(frontend.build.target, 'dokploy');
  assert.equal(app.build.target, 'runtime');
  assert.equal(ops.build.target, 'ops');
  assert.deepEqual(ops.profiles, ['tools']);
  assert.equal(frontend.environment.NGINX_ENVSUBST_FILTER, '^TRAEFIK_TRUSTED_PROXY');
  assert.deepEqual(Object.keys(frontend.environment).sort(), ['NGINX_ENVSUBST_FILTER', 'TRAEFIK_TRUSTED_PROXY']);
  assert.equal(frontend.networks.proxy.ipv4_address, app.environment.TRUSTED_PROXY_IPS);
  assert.equal(app.networks.proxy.ipv4_address, '172.30.92.3');
  assert.notEqual(app.networks.proxy.ipv4_address, frontend.networks.proxy.ipv4_address);
  assert.deepEqual(Object.keys(app.networks).sort(), ['data', 'proxy']);
  assert.deepEqual(Object.keys(postgres.networks), ['data']);
  assert.deepEqual(Object.keys(redis.networks), ['data']);
  assert.equal(networks['dokploy-network'].external, true);
  assert.equal(frontend.labels['traefik.http.services.sipkp-fe.loadbalancer.server.port'], '8080');
  assert.equal(minio.labels['traefik.http.services.sipkp-storage.loadbalancer.server.port'], '9000');
  assert.equal(app.labels['traefik.enable'], 'false');
  assert.equal(frontend.depends_on.app.condition, 'service_healthy');
  assert.ok(app.healthcheck.test.join(' ').includes('/api/v1/health/ready'));
  assert.equal(app.environment.FRONTEND_URL, 'https://pkp.pkm-ujungpangkah.online');
  assert.equal(app.environment.MINIO_ENDPOINT, 'http://minio:9000');
  assert.equal(app.environment.MINIO_PUBLIC_ENDPOINT, 'https://pkp-storage.pkm-ujungpangkah.online');
  assert.equal(minio.environment.MINIO_API_CORS_ALLOW_ORIGIN, app.environment.FRONTEND_URL);
});

test('Dokploy refuses missing required values and domain/IP overrides stay consistent', () => {
  for (const name of ['COMPOSE_PROJECT_NAME', 'DATABASE_URL', 'REDIS_URL', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET',
    'PROVINCE_CREDENTIAL_KEY', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'TRAEFIK_TRUSTED_PROXY']) {
    const result = config({ [name]: '' });
    assert.notEqual(result.status, 0, `${name} must be required`);
  }
  const result = config({ PKP_DOMAIN: 'pkp.example.test', PKP_STORAGE_DOMAIN: 'files.example.test',
    PKP_PROXY_SUBNET: '172.30.93.0/29', PKP_FRONTEND_PROXY_IP: '172.30.93.2', PKP_BACKEND_PROXY_IP: '172.30.93.3' });
  assert.equal(result.status, 0, result.stderr);
  const { services, networks } = JSON.parse(result.stdout);
  assert.equal(services.app.environment.FRONTEND_URL, 'https://pkp.example.test');
  assert.equal(services.minio.environment.MINIO_API_CORS_ALLOW_ORIGIN, 'https://pkp.example.test');
  assert.equal(services.app.environment.MINIO_PUBLIC_ENDPOINT, 'https://files.example.test');
  assert.equal(services.frontend.networks.proxy.ipv4_address, '172.30.93.2');
  assert.equal(services.app.environment.TRUSTED_PROXY_IPS, '172.30.93.2');
  assert.equal(services.app.networks.proxy.ipv4_address, '172.30.93.3');
  assert.equal(networks.proxy.ipam.config[0].subnet, '172.30.93.0/29');
  assert.equal(services.frontend.labels['traefik.http.routers.sipkp-fe-secure.rule'], 'Host(`pkp.example.test`)');
});
