import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const do2026 = process.argv.includes('--do2026');
const observations = process.argv.includes('--monthly-observations');
assert.ok(process.argv.slice(2).every(arg => ['--do2026', '--monthly-observations'].includes(arg)), 'Unsupported suite');
assert.ok(!(do2026 && observations), 'Select one suite');
const project = `pkp-e2e-${randomUUID()}`;
const label = 'pkp.disposable-e2e';
const names = ['pg', 'redis', 'minio'].map(service => `${project}-${service}`);
const [pg, redis, minio] = names;
const secret = () => randomBytes(24).toString('hex');
// Do not inherit database URLs, seed accounts, challenge keys or deployment settings.
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: '/tmp/opencode',
  NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null', DOTENV_CONFIG_QUIET: 'true',
  CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
  PORT: '4000', FRONTEND_URL: 'http://localhost:5175', ENABLE_SWAGGER: 'false',
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/pkp_disposable_e2e',
  REDIS_URL: 'redis://127.0.0.1:1', MINIO_ENDPOINT: 'http://127.0.0.1:1',
  JWT_SECRET: secret(), ACCESS_TOKEN_SECONDS: '900', REFRESH_TOKEN_DAYS: '7',
  TURNSTILE_REQUIRED: 'false', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
  TRUSTED_PROXY_IPS: '', RATE_LIMIT_LOGIN_PER_MINUTE: '5',
  RATE_LIMIT_READ_PER_MINUTE: '600', RATE_LIMIT_WRITE_PER_MINUTE: '120', RATE_LIMIT_PUBLIC_PER_MINUTE: '120',
  SEED_DEMO: 'false', BOOTSTRAP_ADMIN_USERNAME: '', BOOTSTRAP_ADMIN_PASSWORD: '',
  EVIDENCE_BUCKET: 'evidence-e2e', REPORTS_BUCKET: 'reports-e2e',
  MINIO_ACCESS_KEY: `e2e${randomBytes(6).toString('hex')}`, MINIO_SECRET_KEY: secret(),
  POSTGRES_USER: 'e2e', POSTGRES_PASSWORD: secret(), POSTGRES_DB: observations ? 'pkp_monthly_observations_qa' : do2026 ? 'pkp_do_qa' : 'pkp_disposable_e2e',
  TEST_E2E: 'false', TEST_DO_E2E: 'false', TEST_MONTHLY_OBSERVATIONS_E2E: 'false',
  TEST_DISPOSABLE_STORAGE_PROJECT: project, TEST_STORAGE_S3: 'false', NO_COLOR: '1',
};
env.MINIO_ROOT_USER = env.MINIO_ACCESS_KEY;
env.MINIO_ROOT_PASSWORD = env.MINIO_SECRET_KEY;

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: backend, env, encoding: 'utf8', stdio: 'inherit', timeout: 300000, ...options,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed (${result.status ?? result.signal}): ${result.stderr ?? ''}`);
  return result.stdout?.trim();
}
function docker(args, options = {}) { return run('docker', args, options); }
async function waitFor(name, probe) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await probe()) return;
    await delay(1000);
  }
  throw new Error(`${name} did not become ready`);
}
function execReady(container, args) {
  return spawnSync('docker', ['exec', container, ...args], { env, stdio: 'ignore', timeout: 5000 }).status === 0;
}
function port(container, number) {
  const binding = docker(['port', container, `${number}/tcp`], { stdio: 'pipe' });
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  return binding.split(':')[1];
}

let temporary;
let networkCreated = false;
try {
  // Compile and exercise the default skip gates before provisioning anything.
  run('npm', ['run', 'test:e2e']);
  docker(['network', 'create', '--label', `${label}=${project}`, project]);
  networkCreated = true;
  docker(['run', '-d', '--name', pg, '--label', `${label}=${project}`, '--network', project,
    '-p', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data',
    '-e', 'POSTGRES_USER', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB', 'postgres:16.10-alpine']);
  docker(['run', '-d', '--name', redis, '--label', `${label}=${project}`, '--network', project,
    '-p', '127.0.0.1::6379', '--tmpfs', '/data', 'redis:7.4.5-alpine', 'redis-server', '--save', '', '--appendonly', 'no']);
  docker(['run', '-d', '--name', minio, '--label', `${label}=${project}`, '--network', project,
    '-p', '127.0.0.1::9000', '--tmpfs', '/data', '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD',
    'quay.io/minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e', 'server', '/data']);
  const pgPort = port(pg, 5432);
  const redisPort = port(redis, 6379);
  const minioPort = port(minio, 9000);
  env.DATABASE_URL = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${pgPort}/${env.POSTGRES_DB}?schema=public`;
  env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
  env.MINIO_ENDPOINT = `http://127.0.0.1:${minioPort}`;
  console.log(`Disposable project: ${project}; loopback ports: pg=${pgPort}, redis=${redisPort}, minio=${minioPort}`);
  for (const name of names) {
    const mounts = JSON.parse(docker(['inspect', '--format', '{{json .Mounts}}', name], { stdio: 'pipe' }));
    assert.ok(mounts.every(mount => mount.Type === 'tmpfs'), 'Only tmpfs mounts are permitted');
  }
  await waitFor('Postgres', () => execReady(pg, ['pg_isready', '-U', env.POSTGRES_USER, '-d', env.POSTGRES_DB]));
  await waitFor('Redis', () => execReady(redis, ['redis-cli', 'ping']));
  await waitFor('MinIO', async () => {
    try { return (await fetch(`${env.MINIO_ENDPOINT}/minio/health/ready`, { signal: AbortSignal.timeout(2000) })).ok; }
    catch { return false; }
  });
  // Prisma CLI searches for .env beside its schema/cwd. Copy only migration inputs
  // to an isolated directory so it cannot even read the application's .env.
  temporary = await mkdtemp('/tmp/opencode/pkp-e2e-');
  await copyFile(join(backend, 'prisma/schema.prisma'), join(temporary, 'schema.prisma'));
  await cp(join(backend, 'prisma/migrations'), join(temporary, 'migrations'), { recursive: true });
  run(process.execPath, [join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(temporary, 'schema.prisma')], { cwd: temporary });
  if (!observations) run('npm', ['run', 'db:seed']);
  run(process.execPath, ['scripts/init-storage.mjs']);
  run(process.execPath, ['--import', 'tsx', '--test', '--test-name-pattern=real MinIO', 'test/storage-gateway.test.ts'], { env: { ...env, TEST_STORAGE_S3: 'true' } });
  const suites = observations ? ['monthly-observations'] : do2026 ? ['do2026', 'period-recaps'] : ['backend'];
  run(process.execPath, ['--test', '--test-concurrency=1', ...suites.map(suite => `dist-test/test/${suite}.e2e.js`)], {
    env: { ...env, TEST_E2E: String(!do2026 && !observations), TEST_DO_E2E: String(do2026), TEST_MONTHLY_OBSERVATIONS_E2E: String(observations) },
  });
  console.log(`Disposable ${observations ? 'monthly observations' : do2026 ? 'DO2026' : 'backend'} E2E passed against real Postgres, Redis and MinIO.`);
} catch (error) {
  console.error(error.message);
  const logs = spawnSync('docker', ['logs', pg], { env, encoding: 'utf8', timeout: 10000 });
  for (const line of `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`.split('\n')) {
    if (line.includes('Upload object and etag may change only during finalization')) console.error(`Database diagnostic: ${line}`);
  }
  process.exitCode = 1;
} finally {
  for (const name of names) {
    const owned = spawnSync('docker', ['inspect', '--format', `{{index .Config.Labels "${label}"}}`, name], { env, encoding: 'utf8', timeout: 10000 });
    if (owned.status === 0 && owned.stdout.trim() === project) {
      try { docker(['rm', '-f', name]); } catch (error) { console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1; }
    }
  }
  if (networkCreated) {
    try { docker(['network', 'rm', project]); } catch (error) { console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1; }
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
  console.log(`Cleanup completed for owned project ${project}. No existing volumes or containers were modified.`);
}
