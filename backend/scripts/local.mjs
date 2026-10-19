import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Provision only an explicitly invoked local development environment, never production.
const root = resolve(import.meta.dirname, '..');
const path = resolve(root, '.env');
if (!existsSync(path)) {
  const secret = () => randomBytes(24).toString('hex');
  const password = secret();
  writeFileSync(path, [
    'NODE_ENV=development', 'PORT=4000', 'FRONTEND_URL=http://localhost:5175',
    'ENABLE_SWAGGER=true', 'POSTGRES_DB=sipkp', 'POSTGRES_USER=sipkp',
    `POSTGRES_PASSWORD=${password}`,
    `DATABASE_URL=postgresql://sipkp:${password}@127.0.0.1:55432/sipkp?schema=public`,
    'REDIS_URL=redis://127.0.0.1:56379', `JWT_SECRET=${secret()}`,
    'MINIO_ENDPOINT=http://127.0.0.1:59000', 'MINIO_PUBLIC_ENDPOINT=http://127.0.0.1:59000',
    'MINIO_ACCESS_KEY=sipkp_local', `MINIO_SECRET_KEY=${secret()}`,
    'EVIDENCE_BUCKET=evidence', 'REPORTS_BUCKET=reports', 'SEED_DEMO=false', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('Created private backend/.env with random local secrets. No accounts created.');
}
const result = spawnSync('docker', ['compose', '--env-file', path, '-f', resolve(root, 'compose.yml'), 'up', '-d', '--wait', 'postgres', 'redis', 'minio'], { cwd: root, stdio: 'inherit' });
if (result.status === 0) {
  const initialized = spawnSync(process.execPath, ['scripts/init-storage.mjs'], { cwd: root, stdio: 'inherit' });
  process.exitCode = initialized.status ?? 1;
} else process.exitCode = result.status ?? 1;
