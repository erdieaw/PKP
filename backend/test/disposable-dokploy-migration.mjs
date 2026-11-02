import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const backend = fileURLToPath(new URL('../', import.meta.url));
const owner = randomUUID();
const label = 'pkp.test.disposable-dokploy-migration';
const project = `pkp-migrate-${owner}`;
const image = `${project}:test`;
const pg = `${project}-pg`;
const containers = [pg];
const latest = '20261101120000_period_recap_structured_input';
// Never inherit app, Compose, Docker-context, or database environment settings.
const env = Object.fromEntries(['PATH', 'HOME'].filter(key => process.env[key] !== undefined)
  .map(key => [key, process.env[key]]));
const password = randomBytes(24).toString('hex');
const user = 'fixture';
const database = 'disposable';
const marker = randomUUID();

function docker(args, { extraEnv = {}, input, timeout = 30000 } = {}) {
  return spawnSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {
    cwd: backend, env: { ...env, ...extraEnv }, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], input, timeout, maxBuffer: 16 * 1024 * 1024,
  });
}
function success(result, step) {
  // Do not expose arguments, SDK errors, raw Prisma/build output, or database URLs.
  if (result.error || result.signal || result.status !== 0) throw new Error(`${step} failed or timed out`);
  return result.stdout.trim();
}
function check(condition, message) { assert.ok(condition, message); }
function sql(query) {
  return success(docker(['exec', '-i', pg, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', user, '-d', database], { input: query }), 'Disposable SQL check');
}
function snapshot() {
  const counts = sql(`SELECT format('SELECT %L AS name, count(*) FROM public.%I;', tablename, tablename)
    FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`);
  return {
    counts: sql(counts),
    migrations: sql('SELECT row_to_json(m)::text FROM public._prisma_migrations m ORDER BY migration_name;'),
    marker: sql('SELECT id FROM public.fixture_marker ORDER BY id;'),
    schema: success(docker(['exec', pg, 'pg_dump', '-U', user, '-d', database,
      '--schema-only', '--no-owner', '--no-privileges']), 'Disposable schema snapshot')
      .split('\n').filter(line => !line.startsWith('\\restrict ') && !line.startsWith('\\unrestrict ')).join('\n'),
  };
}
function migrate(attempt, valid = true) {
  const name = `${project}-${attempt}`;
  containers.push(name);
  const result = docker(['run', '--pull', 'never', '--name', name, '--label', `${label}=${owner}`,
    '--network', project, '--memory', '512m', '--cpus', '1', '--pids-limit', '256',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-e', 'DATABASE_URL', image], {
    extraEnv: { DATABASE_URL: `postgresql://${user}:${valid ? password : randomBytes(24).toString('hex')}@db:5432/${database}?schema=public&connect_timeout=5` },
    timeout: 120000,
  });
  const state = JSON.parse(success(docker(['inspect', '--format',
    '{{json .State}}', name]), 'Inspect migration exit'));
  check(!state.Running && !state.OOMKilled, 'Migration must finish without OOM');
  check(!result.error && !result.signal && result.status === state.ExitCode, 'Migration exit must reach caller');
  check(success(docker(['inspect', '--format', '{{json .Config.Cmd}}', name]),
    'Check unmodified CMD') === '["npm","run","db:deploy"]', 'Image CMD must not be overridden');
  if (valid) success(result, 'Actual image migration CMD');
  else check(state.ExitCode > 0 && /P1000/.test(`${result.stdout}\n${result.stderr}`),
    'Invalid authentication must fail with Prisma P1000, without bypass');
  console.log(`${attempt}: exit=${state.ExitCode}${valid ? '' : '; Prisma P1000 (authentication rejected)'}`);
}

let cleanupFailed = false;
let imageRetained = false;
try {
  check(process.argv.length === 2, 'No arguments accepted');
  const ignored = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8').split(/\r?\n/);
  check(ignored.includes('.env') && ignored.includes('.env.*'), 'Build context must exclude environment files');
  const migrations = readdirSync(new URL('../prisma/migrations/', import.meta.url))
    .filter(name => /^\d{14}_/.test(name)).sort();
  check(migrations.at(-1) === latest, 'Expected latest migration must be present');
  success(docker(['info', '--format', '{{.ServerVersion}}']), 'Local Docker daemon');
  success(docker(['image', 'inspect', 'node:22.20.0-bookworm-slim', '--format', '{{.Id}}']), 'Local Node 22 base');
  success(docker(['image', 'inspect', 'postgres:17', '--format', '{{.Id}}']), 'Local PostgreSQL 17 image');
  console.log(`Building backend/Dockerfile --target migrate; UUID tag=${image}; output captured, no build arguments`);
  const started = Date.now();
  const build = docker(['build', '--pull=false', '--progress=plain', '--target', 'migrate',
    '--label', `${label}=${owner}`, '--tag', image, '.'], { timeout: 900000 });
  success(build, 'Migrate image build');
  console.log(`Image build: PASS (${Math.round((Date.now() - started) / 1000)}s; cached steps=${(`${build.stdout}\n${build.stderr}`.match(/\bCACHED\b/g) || []).length})`);
  const config = JSON.parse(success(docker(['image', 'inspect', '--format', '{{json .Config}}', image]), 'Image config'));
  check(config.Labels[label] === owner && config.User === 'node', 'Owned image must run as node');
  check(JSON.stringify(config.Cmd) === '["npm","run","db:deploy"]', 'Image default CMD must deploy');
  success(docker(['run', '--rm', '--pull', 'never', '--network', 'none', '--label', `${label}=${owner}`,
    '--name', `${project}-check`, '--entrypoint', 'node', image, '-e', `
      const fs = require('node:fs');
      if (process.getuid() === 0 || process.getuid() !== 1000) process.exit(1);
      for (const dir of ['/app', '/app/prisma']) {
        if (fs.readdirSync(dir).some(n => n === '.env' || (n.startsWith('.env.') && n !== '.env.example'))) process.exit(2);
      }
      if (!fs.existsSync('/app/node_modules/prisma/build/index.js') ||
          !fs.existsSync('/app/prisma/migrations/${latest}/migration.sql')) process.exit(3);
      if (require('/app/package.json').scripts['db:deploy'] !== 'prisma migrate deploy') process.exit(4);
    `]), 'Nonroot, environment exclusion, Prisma CLI and migration checks');
  containers.push(`${project}-cli`);
  const version = success(docker(['run', '--pull', 'never', '--name', `${project}-cli`,
    '--label', `${label}=${owner}`, '--network', 'none', '--entrypoint',
    '/app/node_modules/.bin/prisma', image, '--version']), 'Actual Prisma CLI');
  check(/prisma\s*:\s*6\.19\.3/.test(version), 'Expected real Prisma CLI version');
  console.log('Image checks: node uid=1000; default CMD npm run db:deploy; Prisma 6.19.3; latest migration present; no .env');

  success(docker(['network', 'create', '--internal', '--label', `${label}=${owner}`, project]), 'Create isolated network');
  check(success(docker(['network', 'inspect', '--format', '{{.Internal}}', project]), 'Network isolation') === 'true',
    'Database network must be internal');
  success(docker(['run', '-d', '--pull', 'never', '--name', pg, '--label', `${label}=${owner}`,
    '--network', project, '--network-alias', 'db', '--tmpfs', '/var/lib/postgresql/data',
    '--memory', '256m', '--cpus', '1', '--pids-limit', '256',
    '-e', 'POSTGRES_USER', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB', 'postgres:17'], {
    extraEnv: { POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database },
  }), 'Start disposable PostgreSQL');
  check(success(docker(['inspect', '--format', '{{json .HostConfig.PortBindings}}', pg]), 'No host ports') === '{}',
    'PostgreSQL must not publish host ports');
  const mounts = JSON.parse(success(docker(['inspect', '--format', '{{json .Mounts}}', pg]), 'Check tmpfs'));
  const tmpfs = JSON.parse(success(docker(['inspect', '--format', '{{json .HostConfig.Tmpfs}}', pg]), 'Check tmpfs configuration'));
  check(Object.hasOwn(tmpfs, '/var/lib/postgresql/data') && mounts.every(m => m.Type === 'tmpfs'),
    'Only tmpfs database mounts allowed');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', user, '-d', database], { timeout: 5000 }).status === 0) { ready = true; break; }
    await delay(1000);
  }
  check(ready, 'Disposable PostgreSQL readiness timed out');
  check(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';") === '0', 'Fresh database must be empty');
  migrate('initial');
  check(sql(`SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`)
    === String(migrations.length), 'All source migrations must be applied');
  check(sql(`SELECT count(*) FROM public._prisma_migrations WHERE migration_name='${latest}' AND finished_at IS NOT NULL;`)
    === '1', 'Latest migration must be applied exactly once');
  check(sql(`SELECT udt_name FROM information_schema.columns WHERE table_schema='public'
    AND table_name='period_recaps' AND column_name='structuredInput';`) === 'jsonb', 'structuredInput must be jsonb');
  check(sql('SELECT count(*) FROM public.users;') === '0', 'Migration must not seed users');
  sql(`CREATE TABLE public.fixture_marker (id uuid PRIMARY KEY); INSERT INTO public.fixture_marker VALUES ('${marker}');`);
  const baseline = snapshot();
  check(baseline.marker === marker, 'Synthetic marker must exist');
  check(baseline.counts.split('\n').every(row => {
    const [table, count] = row.split('|');
    const expected = { _prisma_migrations: migrations.length, fixture_marker: 1,
      operational_definitions: 272, period_settings: 1 };
    return count === String(expected[table] ?? 0);
  }), 'Only migration-authored definition/settings rows and the synthetic marker are permitted');
  for (const attempt of ['repeat-1', 'repeat-2', 'invalid-auth']) {
    migrate(attempt, attempt !== 'invalid-auth');
    check(JSON.stringify(snapshot()) === JSON.stringify(baseline), 'Schema, migration ledger, row counts and marker must remain unchanged');
  }
  console.log(`PASS: latest=${latest}; applied migrations=${migrations.length}; structuredInput=jsonb; users=0; two repeats idempotent; bad auth leaves schema/rows/marker unchanged`);
} catch (error) {
  console.error(`FAIL: ${error instanceof assert.AssertionError || error?.constructor === Error ? error.message : 'Disposable migration validation failed'}`);
  process.exitCode = 1;
} finally {
  // Check labels before every removal, including resources left by a timed-out command.
  containers.push(`${project}-check`);
  for (const [kind, names, template] of [
    ['container', containers, '{{json .Config.Labels}}'],
    ['network', [project], '{{json .Labels}}'],
    ['image', [image], '{{json .Config.Labels}}'],
  ]) {
    for (const name of names) {
      const inspected = docker([kind, 'inspect', '--format', template, name]);
      if (inspected.status !== 0) {
        if (!/No such (object|container|network|image)/i.test(inspected.stderr ?? '')) cleanupFailed = true;
        continue;
      }
      try {
        check(JSON.parse(inspected.stdout)?.[label] === owner, 'Resource ownership mismatch');
        if (kind === 'image') {
          const used = success(docker(['ps', '-aq', '--filter', `ancestor=${image}`]), 'Image usage check');
          if (used) { imageRetained = true; continue; }
        }
        success(docker([kind, 'rm', ...(kind === 'container' ? ['--force'] : []), name]), 'Owned resource cleanup');
      } catch { cleanupFailed = true; }
    }
    const remaining = docker([kind === 'container' ? 'ps' : kind,
      ...(kind === 'container' ? ['-aq'] : ['ls', '-q']), '--filter', `label=${label}=${owner}`]);
    if (remaining.status !== 0 || (remaining.stdout.trim() && !(kind === 'image' && imageRetained))) cleanupFailed = true;
  }
  console.log(`Cleanup: ${cleanupFailed ? 'FAILED (inspect owned resources)' : `PASS (owned containers/network removed; ${imageRetained ? 'in-use image retained' : 'owned tag removed'}; shared build cache retained)`}`);
  if (cleanupFailed) process.exitCode = 1;
}
