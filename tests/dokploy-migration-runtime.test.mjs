import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const image = 'node:22.20.0-bookworm-slim';
const ownerKey = 'pkp.test.dokploy-migration-runtime';
const runtimeEnv = Object.fromEntries(['PATH', 'HOME', 'XDG_RUNTIME_DIR']
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const syntheticEnv = {
  ...runtimeEnv,
  COMPOSE_PROJECT_NAME: 'pkp-migration-config-only',
  DATABASE_URL: 'postgresql://fixture:fixture@database.invalid:5432/fixture',
  REDIS_PASSWORD: 'fixture-only', REDIS_URL: 'redis://:fixture-only@redis:6379',
  JWT_SECRET: 'fixture-only-not-a-deployment-secret',
  PROVINCE_CREDENTIAL_KEY: Buffer.alloc(32).toString('base64'),
  MINIO_ENDPOINT: 'http://storage.invalid:9100',
  MINIO_ACCESS_KEY: 'fixture-only', MINIO_SECRET_KEY: 'fixture-only',
  EVIDENCE_BUCKET: 'fixture', REPORTS_BUCKET: 'fixture',
  TRAEFIK_TRUSTED_PROXY: '192.0.2.10',
  TURNSTILE_SITE_KEY: 'fixture-only', TURNSTILE_SECRET_KEY: 'fixture-only',
};

const prelude = `const fs = require('node:fs');
const path = '/state/';
const read = (name, fallback) => fs.existsSync(path + name)
  ? JSON.parse(fs.readFileSync(path + name, 'utf8')) : fallback;
const write = (name, value) => {
  fs.writeFileSync(path + name + '.next', JSON.stringify(value));
  fs.renameSync(path + name + '.next', path + name);
};
const event = value => fs.appendFileSync(path + 'events', JSON.stringify(value) + '\\n');`;
const migrationScript = `${prelude}
const attempt = read('attempt', 0) + 1;
write('attempt', attempt);
write('status', { attempt, result: 'pending' });
event({ type: 'migration-start', attempt });
const timer = setInterval(() => {
  if (fs.existsSync(path + 'hold')) return;
  clearInterval(timer);
  const failed = fs.existsSync(path + 'fail');
  if (!failed && !fs.existsSync(path + 'schema')) fs.writeFileSync(path + 'schema', 'fixture-schema-v1');
  write('status', { attempt, result: failed ? 'failed' : 'success' });
  event({ type: 'migration-finish', attempt, code: failed ? 23 : 0 });
  process.exit(failed ? 23 : 0);
}, 250);`;
const appScript = `${prelude}
fs.rmSync(path + 'app-ready', { force: true });
const token = require('node:crypto').randomUUID();
event({ type: 'app-start', token, migration: read('status', null) });
setTimeout(() => {
  event({ type: 'app-ready', token });
  fs.writeFileSync(path + 'app-ready', token);
}, 750);
setInterval(() => {}, 1000);`;
const frontendScript = `${prelude}
event({ type: 'frontend-start' });
setInterval(() => {}, 1000);`;

// Only dependency/restart declarations cross from the deployment model into execution.
function fixtureFrom(real, project, owner, localImageId) {
  const services = {};
  for (const name of ['redis', 'migrate', 'app', 'frontend']) {
    const source = real.services[name];
    assert.ok(source, `compose.dokploy.yml must declare ${name}`);
    const script = name === 'migrate' ? migrationScript : name === 'app' ? appScript
      : name === 'frontend' ? frontendScript : 'setInterval(() => {}, 1000)';
    services[name] = {
      image: localImageId, pull_policy: 'never', entrypoint: ['node'], command: ['-e', script],
      network_mode: 'none', read_only: true, cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'], stop_grace_period: '1s',
      restart: source.restart,
      labels: { [ownerKey]: owner, 'traefik.enable': 'false' },
      volumes: [{ type: 'volume', source: 'state', target: '/state', volume: { nocopy: true } }],
      ...(source.depends_on ? { depends_on: structuredClone(source.depends_on) } : {}),
      ...(name === 'migrate' ? {} : { healthcheck: {
        test: ['CMD', 'node', '-e', name === 'app'
          ? "process.exit(require('node:fs').existsSync('/state/app-ready') ? 0 : 1)"
          : 'process.exit(0)'],
        interval: '250ms', timeout: '2s', retries: 40,
      } }),
    };
  }
  return { name: project, services, volumes: { state: { labels: { [ownerKey]: owner } } } };
}

test('Dokploy migration dependency gates on a disposable, offline Compose project', { timeout: 300000 }, async t => {
  // Never follow a remote context/host or inherit application/Compose environment variables.
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith('unix://')) {
    t.skip('Runtime gating requires a local Unix Docker daemon; remote DOCKER_HOST is not used');
    return;
  }
  const rootlessSocket = process.env.XDG_RUNTIME_DIR && join(process.env.XDG_RUNTIME_DIR, 'docker.sock');
  const host = process.env.DOCKER_HOST || `unix://${rootlessSocket && existsSync(rootlessSocket)
    ? rootlessSocket : '/var/run/docker.sock'}`;
  const children = new Set();
  const deadline = Date.now() + 265000;
  let cleaning = false;
  let cleanupDeadline;
  function kill(child) {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
  function command(args, { env = runtimeEnv, timeout = 120000 } = {}) {
    const budget = Math.min(timeout, (cleaning ? cleanupDeadline : deadline) - Date.now());
    assert.ok(budget > 0, 'Aggregate runtime budget exhausted');
    return new Promise(resolve => {
      const child = spawn('docker', ['--host', host, ...args], {
        cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.add(child);
      let stdout = '', stderr = '', error, timedOut = false;
      child.stdout.on('data', data => { stdout = (stdout + data).slice(-65536); });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-65536); });
      const timer = setTimeout(() => { timedOut = true; kill(child); }, budget);
      child.on('error', value => { error = value; });
      child.on('close', code => {
        clearTimeout(timer);
        children.delete(child);
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), error, timedOut });
      });
    });
  }
  function success(result, step) {
    assert.equal(result.timedOut, false, `${step}: command timed out`);
    assert.equal(result.code, 0, `${step}: ${result.error?.message || result.stderr}`);
    return result.stdout;
  }
  const version = await command(['compose', 'version', '--short'], { timeout: 10000 });
  if (version.code !== 0) { t.skip('Docker Compose plugin is unavailable'); return; }
  const daemon = await command(['info', '--format', '{{.ServerVersion}}'], { timeout: 10000 });
  if (daemon.code !== 0) { t.skip('Local Docker daemon is unavailable or inaccessible'); return; }
  const localImage = await command(['image', 'inspect', image, '--format', '{{.Id}}'], { timeout: 10000 });
  if (localImage.code !== 0) { t.skip(`Local ${image} image is unavailable; no pull/build attempted`); return; }
  t.diagnostic(`Compose ${version.stdout}; local Node image; network_mode=none; synthetic commands only (not Prisma/DB tests)`);

  const normalized = JSON.parse(success(await command(['compose', '--env-file', '/dev/null',
    '-f', 'compose.dokploy.yml', 'config', '--no-env-resolution', '--format', 'json'],
  { env: syntheticEnv }), 'Normalize real Compose graph'));
  assert.ok(normalized.services.migrate, 'Main Compose patch must add the mandatory migrate service before running this test');
  assert.deepEqual(Object.keys(normalized.services.app.depends_on).sort(), ['migrate', 'redis']);
  assert.equal(normalized.services.app.depends_on.migrate.condition, 'service_completed_successfully');
  assert.notEqual(normalized.services.app.depends_on.migrate.required, false);
  assert.equal(normalized.services.app.depends_on.redis.condition, 'service_healthy');
  assert.notEqual(normalized.services.app.depends_on.redis.required, false);
  assert.equal(normalized.services.frontend.depends_on.app.condition, 'service_healthy');
  assert.notEqual(normalized.services.frontend.depends_on.app.required, false);
  assert.equal(normalized.services.migrate.restart, 'no');

  const owner = randomUUID();
  const project = `pkp-migration-runtime-${owner}`;
  const fixture = fixtureFrom(normalized, project, owner, localImage.stdout);
  const directory = await mkdtemp('/tmp/opencode/pkp-migration-runtime-');
  const file = join(directory, 'compose.json');
  const composeArgs = ['compose', '--env-file', '/dev/null', '--project-name', project, '-f', file];
  const compose = (...args) => command([...composeArgs, ...args]);
  const up = () => compose('up', '-d', '--no-build', '--pull', 'never', 'frontend');
  const exec = async script => success(await compose('exec', '-T', 'redis', 'node', '-e', script), 'Fixture control');
  const snapshot = async () => JSON.parse(await exec(`${prelude}
console.log(JSON.stringify({
  attempt: read('attempt', 0), status: read('status', null),
  schema: fs.existsSync(path + 'schema') ? fs.readFileSync(path + 'schema', 'utf8') : null,
  events: fs.existsSync(path + 'events') ? fs.readFileSync(path + 'events', 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : []
}));`));
  const control = async (hold = false, fail = false) => exec(`const fs = require('node:fs');
for (const [name, enabled] of ${JSON.stringify([['hold', hold], ['fail', fail]])}) {
  if (enabled) fs.writeFileSync('/state/' + name, 'fixture');
  else fs.rmSync('/state/' + name, { force: true });
}`);
  const containers = async () => {
    const ids = success(await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`,
      '--filter', `label=${ownerKey}=${owner}`]), 'List owned fixture containers').split(/\s+/).filter(Boolean);
    if (!ids.length) return [];
    const format = '{"Id":{{json .Id}},"Config":{"Labels":{{json .Config.Labels}}},"State":{{json .State}}}';
    const inspected = success(await command(['inspect', '--format', format, ...ids]),
      'Inspect owned fixture containers').split('\n').map(line => JSON.parse(line));
    for (const item of inspected) assert.equal(item.Config.Labels[ownerKey], owner);
    return inspected;
  };
  async function until(check, description, timeout = 20000) {
    const end = Math.min(Date.now() + timeout, deadline);
    do {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < end);
    assert.fail(`Timed out waiting for ${description}`);
  }
  const healthy = () => until(async () => {
    const items = await containers();
    return ['app', 'frontend'].every(name => items.some(item =>
      item.Config.Labels['com.docker.compose.service'] === name && item.State.Health?.Status === 'healthy'));
  }, 'healthy fixture app and frontend');
  const assertBlocked = async before => {
    const state = await snapshot();
    assert.equal(state.events.filter(event => event.type === 'app-start').length, before,
      'A new app must not start using a stale successful migration exit');
    const app = (await containers()).find(item => item.Config.Labels['com.docker.compose.service'] === 'app');
    assert.equal(app?.State.Running ?? false, false, 'New app must stay unstarted');
  };
  const assertOrdered = state => {
    const events = state.events;
    const start = events.findIndex(event => event.type === 'app-start');
    const finish = events.findIndex(event => event.type === 'migration-finish' && event.code === 0);
    assert.ok(finish >= 0 && start > finish, 'Successful migration must finish before app startup');
    assert.equal(events[start].migration.result, 'success');
    assert.ok(events.findIndex(event => event.type === 'frontend-start') >
      events.findIndex(event => event.type === 'app-ready'), 'Frontend must wait for app health');
  };
  async function reset() {
    success(await compose('rm', '--stop', '--force', 'frontend', 'app', 'migrate'), 'Reset owned fixture services');
    await exec("const fs = require('node:fs'); for (const file of fs.readdirSync('/state')) fs.rmSync('/state/' + file, { recursive: true, force: true });");
  }

  try {
    await writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
    success(await compose('config', '--quiet', '--no-env-resolution'), 'Validate offline fixture');
    success(await compose('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '20', 'redis'), 'Start fake Redis/control helper');

    await t.test('first migration succeeds before backend startup and frontend app-health gate', async () => {
      success(await up(), 'First release');
      await healthy();
      const state = await snapshot();
      assert.equal(state.attempt, 1);
      assertOrdered(state);
    });

    await t.test('failed migration exits nonzero, blocks a new app, and recovers on the next up', async () => {
      await reset();
      await control(false, true);
      const failed = await up();
      assert.equal(failed.timedOut, false);
      assert.notEqual(failed.code, 0, 'Failed job must fail Compose up');
      assert.equal((await snapshot()).status.result, 'failed');
      await assertBlocked(0);
      const job = (await containers()).find(item => item.Config.Labels['com.docker.compose.service'] === 'migrate');
      assert.equal(job.State.ExitCode, 23);
      await control();
      success(await up(), 'Recovery release');
      await healthy();
      const recovered = await snapshot();
      assert.equal(recovered.attempt, 2);
      assertOrdered(recovered);
    });

    await t.test('pending first migration holds backend until explicitly released', async () => {
      await reset();
      await control(true);
      const pending = up();
      try {
        await until(async () => (await snapshot()).status?.result === 'pending', 'pending first migration');
        await new Promise(resolve => setTimeout(resolve, 1200));
        await assertBlocked(0);
      } finally {
        await control();
        success(await pending, 'Release pending first migration');
      }
      await healthy();
      assertOrdered(await snapshot());
    });

    await t.test('Docker-only backend restart never executes the migration job', async () => {
      await reset();
      success(await up(), 'Release before Docker restart');
      await healthy();
      const before = await snapshot();
      const items = await containers();
      const app = items.find(item => item.Config.Labels['com.docker.compose.service'] === 'app');
      const job = items.find(item => item.Config.Labels['com.docker.compose.service'] === 'migrate');
      success(await command(['restart', '-t', '1', app.Id]), 'Restart only owned app container');
      await until(async () => (await snapshot()).events.filter(event => event.type === 'app-start').length === 2, 'second app startup');
      await healthy();
      assert.equal((await snapshot()).attempt, before.attempt);
      const afterJob = (await containers()).find(item => item.Id === job.Id);
      assert.equal(afterJob.State.FinishedAt, job.State.FinishedAt);
      assert.equal(afterJob.State.Running, false);
    });

    await t.test('unchanged repeated up reruns completed job idempotently without restarting the existing app', async () => {
      await reset();
      success(await up(), 'Baseline unchanged release');
      await healthy();
      const before = await snapshot();
      success(await up(), 'Identical release again');
      await until(async () => (await snapshot()).attempt === 2 && (await snapshot()).status?.result === 'success', 'second unchanged migration completion');
      const after = await snapshot();
      assert.equal(after.schema, before.schema, 'No-change migration must leave fixture schema unchanged');
      assert.deepEqual(after.events.filter(event => event.type === 'app-start'),
        before.events.filter(event => event.type === 'app-start'), 'An existing app run is not a newly gated startup');
      assert.equal(after.events.filter(event => event.type === 'migration-finish').length, 2);
    });

    await t.test('failing rerun reports failure but does not retroactively gate the existing backend run', async () => {
      await reset();
      success(await up(), 'Baseline existing backend');
      await healthy();
      const before = await snapshot();
      const oldApp = (await containers()).find(item => item.Config.Labels['com.docker.compose.service'] === 'app');
      await control(true, true);
      const pending = up();
      let result;
      try {
        await until(async () => (await snapshot()).attempt === 2, 'rerun alongside existing app');
        await new Promise(resolve => setTimeout(resolve, 1200));
      } finally {
        await control(false, true);
        result = await pending;
      }
      await until(async () => (await snapshot()).status?.result === 'failed', 'rerun failure alongside old app');
      const after = await snapshot();
      const app = (await containers()).find(item => item.Id === oldApp.Id);
      assert.equal(app?.State.Running, true, 'Dependency conditions do not stop an already running backend');
      assert.deepEqual(after.events.filter(event => event.type === 'app-start'),
        before.events.filter(event => event.type === 'app-start'), 'The surviving app is the old run, not a new gated startup');
      t.diagnostic(`Failed rerun with existing backend: Compose exit=${result.code}; old backend remains running`);
      assert.equal(result.timedOut, false);
      assert.notEqual(result.code, 0, 'Failed rerun must not report a successful release');
    });

    await t.test('previous successful exit cannot release a NEW backend while same-config rerun is pending', async () => {
      await reset();
      success(await up(), 'Baseline successful job');
      success(await compose('rm', '--stop', '--force', 'frontend', 'app'), 'Remove only previous frontend/app run');
      await control(true);
      const pending = up();
      try {
        await until(async () => (await snapshot()).attempt === 2, 'same-config migration rerun');
        await new Promise(resolve => setTimeout(resolve, 1200));
        await assertBlocked(1);
      } finally {
        await control();
        success(await pending, 'Release repeated migration');
      }
      await healthy();
      const events = (await snapshot()).events;
      const newStart = events.findLastIndex(event => event.type === 'app-start');
      assert.ok(newStart > events.findIndex(event => event.type === 'migration-finish' && event.attempt === 2),
        'Second migration must complete before the new backend startup');
    });

    await t.test('failed same-config rerun cannot authorize a NEW backend using the previous successful exit', async () => {
      await reset();
      success(await up(), 'Baseline before failing rerun');
      success(await compose('rm', '--stop', '--force', 'frontend', 'app'), 'Remove prior app without touching completed job');
      await control(true, true);
      const pending = up();
      let failed;
      try {
        await until(async () => (await snapshot()).attempt === 2, 'controlled failing same-config rerun');
        await new Promise(resolve => setTimeout(resolve, 1200));
      } finally {
        await control(false, true);
        failed = await pending;
      }
      await until(async () => (await snapshot()).attempt === 2 && (await snapshot()).status?.result === 'failed', 'failed same-config rerun');
      t.diagnostic(`Failed rerun for NEW backend: Compose exit=${failed.code}; app startups=${(await snapshot()).events.filter(event => event.type === 'app-start').length}`);
      await assertBlocked(1);
      assert.equal(failed.timedOut, false);
      assert.notEqual(failed.code, 0, 'A stale successful job exit must not make a failing release report success');
    });
  } finally {
    cleaning = true;
    cleanupDeadline = Date.now() + 30000;
    const active = [...children];
    await Promise.all(active.map(child => new Promise(resolve => {
      child.once('close', resolve);
      kill(child);
    })));
    const cleanupErrors = [];
    try {
      // Never down -v: remove only resources carrying both this UUID and project label.
      const items = await containers();
      if (items.length) {
        const removed = await command(['rm', '--force', ...items.map(item => item.Id)], { timeout: 15000 });
        if (removed.code !== 0) cleanupErrors.push('Owned fixture container removal failed');
      }
      const volumes = success(await command(['volume', 'ls', '-q',
        '--filter', `label=com.docker.compose.project=${project}`, '--filter', `label=${ownerKey}=${owner}`],
      { timeout: 5000 }), 'List owned volumes').split(/\s+/).filter(Boolean);
      for (const volume of volumes) {
        const labels = JSON.parse(success(await command(['volume', 'inspect', volume, '--format', '{{json .Labels}}'],
          { timeout: 5000 }), 'Check volume ownership'));
        assert.equal(labels[ownerKey], owner);
        assert.equal(labels['com.docker.compose.project'], project);
        if ((await command(['volume', 'rm', volume], { timeout: 5000 })).code !== 0) cleanupErrors.push('Owned fixture volume removal failed');
      }
      assert.equal((await containers()).length, 0, 'Owned fixture containers must be removed');
      const remaining = success(await command(['volume', 'ls', '-q', '--filter', `label=${ownerKey}=${owner}`],
        { timeout: 5000 }), 'Verify volume cleanup');
      assert.equal(remaining, '', 'Owned fixture volumes must be removed');
      t.diagnostic(`Cleaned UUID-owned fixture project ${project}; no networks, user volumes, or deployment services touched`);
    } catch (error) {
      cleanupErrors.push(error.message);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    assert.deepEqual(cleanupErrors, [], 'Disposable fixture cleanup must succeed');
  }
});
