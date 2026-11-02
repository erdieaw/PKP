import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Generate only, using the existing npm script and installed CLI. Prisma must
// never discover the application .env while generating the test/build client.
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp('/tmp/opencode/pkp-generate-');
try {
  const schema = await readFile(join(backend, 'prisma/schema.prisma'), 'utf8');
  const manifest = JSON.parse(await readFile(join(backend, 'package.json'), 'utf8'));
  const output = join(backend, 'node_modules/.prisma/client');
  await writeFile(join(temporary, 'schema.prisma'), schema.replace('generator client {', `generator client {\n  output = ${JSON.stringify(output)}`));
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true, scripts: { 'prisma:generate': manifest.scripts['prisma:generate'] } }));
  await symlink(join(backend, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  const result = spawnSync('npm', ['run', 'prisma:generate', '--', '--schema', join(temporary, 'schema.prisma')], {
    cwd: temporary, stdio: 'inherit', timeout: 120000,
    env: {
      PATH: `${join(backend, 'node_modules/.bin')}:${process.env.PATH}`,
      HOME: process.env.HOME, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
      PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    },
  });
  assert.equal(result.status, 0, result.error?.message);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
