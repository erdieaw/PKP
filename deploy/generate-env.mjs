import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const help = `Generate a PRIVATE env file for a NEW Dokploy installation (Node.js 22+).
Usage: node deploy/generate-env.mjs --project <exact-dokploy-project> [options]
  --domain <hostname>       Default: pkp.pkm-ujungpangkah.online (no scheme/path)
  --db-host <hostname>      Existing PostgreSQL container on dokploy-network;
                            Default: database-postgresmain-hoc5kd
  --bootstrap-user <name>   Also generate the first admin password (new DB only)
  --minio-credentials      Generate candidate credentials; provision in SILO first
  --output <path>           Default: deploy/dokploy.env relative to this script
  --help                    Show help without generating secrets
Never reads existing env files, overwrites files, provisions services, or prints secrets.
Do not use to rotate credentials or configure an existing/restored database.
`;

try {
  let values;
  try {
    ({ values } = parseArgs({ options: {
      project: { type: 'string' }, domain: { type: 'string' },
      'db-host': { type: 'string' },
      'bootstrap-user': { type: 'string' }, 'minio-credentials': { type: 'boolean' },
      output: { type: 'string' }, help: { type: 'boolean' },
    }, strict: true, allowPositionals: false }));
  } catch {
    throw new Error('Invalid arguments. Use --help; do not pass secrets as CLI arguments.');
  }
  if (values.help) {
    process.stdout.write(help);
  } else {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(values.project ?? '')) {
      throw new Error('--project is required: use the exact lowercase Dokploy Compose project name.');
    }
    const domain = values.domain ?? 'pkp.pkm-ujungpangkah.online';
    if (domain.length > 253 || !domain.includes('.') || domain.split('.').some(
      label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )) throw new Error('--domain must be a DNS hostname without scheme, port, path, or trailing dot.');
    const dbHost = values['db-host'] ?? 'database-postgresmain-hoc5kd';
    if (dbHost.length > 253 || dbHost.split('.').some(
      label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )) throw new Error('--db-host must be a DNS hostname without scheme, port, path, or trailing dot.');
    const bootstrapUser = values['bootstrap-user'];
    if (bootstrapUser !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,99}$/.test(bootstrapUser)) {
      throw new Error('--bootstrap-user must contain 3..100 letters, digits, dots, underscores, @ or hyphens.');
    }
    if (values.output !== undefined && !values.output.trim()) throw new Error('--output cannot be empty.');
    const secret = () => randomBytes(32).toString('hex');
    const generated = {
      COMPOSE_PROJECT_NAME: values.project,
      PKP_DOMAIN: domain.toLowerCase(),
      POSTGRES_PASSWORD: secret(),
      REDIS_PASSWORD: secret(),
      JWT_SECRET: secret(),
      PROVINCE_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
    };
    generated.DATABASE_URL = `postgresql://sipkp:${encodeURIComponent(generated.POSTGRES_PASSWORD)}@${dbHost}:5432/sipkp?schema=public`;
    generated.REDIS_URL = `redis://:${encodeURIComponent(generated.REDIS_PASSWORD)}@redis:6379`;
    if (bootstrapUser !== undefined) {
      generated.BOOTSTRAP_ADMIN_USERNAME = bootstrapUser;
      generated.BOOTSTRAP_ADMIN_PASSWORD = secret();
    }
    if (values['minio-credentials']) {
      generated.MINIO_ACCESS_KEY = `PKP${randomBytes(9).toString('hex').slice(0, 17)}`;
      generated.MINIO_SECRET_KEY = randomBytes(30).toString('base64');
    }
    const template = readFileSync(new URL('./dokploy.env.example', import.meta.url), 'utf8');
    const content = template.replace(/^([A-Z_]+)=(.*)$/gm,
      (line, name) => Object.hasOwn(generated, name) ? `${name}=${generated[name]}` : line);
    const output = values.output ? resolve(values.output) : fileURLToPath(new URL('./dokploy.env', import.meta.url));
    let fd;
    try {
      fd = openSync(output, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Output already exists; nothing changed. Preserve existing secrets.');
      throw new Error('Cannot create output. Check that its parent directory exists and is writable.');
    }
    try {
      writeFileSync(fd, content);
    } catch {
      unlinkSync(output);
      throw new Error('Cannot write output; incomplete file removed.');
    } finally {
      closeSync(fd);
    }
    process.stdout.write('Private env file created (0600); no secrets printed. Back it up securely.\n');
    process.stdout.write(`DATABASE_URL points at the existing PostgreSQL container (${dbHost}).\n`);
    process.stdout.write('Still required: real Turnstile keys, TRAEFIK_TRUSTED_PROXY, verified MINIO_ENDPOINT and provisioned storage credentials.\n');
    if (values['minio-credentials']) {
      process.stdout.write('MinIO credentials are candidates ONLY: register them with a least-privilege policy in SILO before deployment, or replace with SILO-issued credentials.\n');
    }
    if (bootstrapUser !== undefined) {
      process.stdout.write('Bootstrap is for an approved NEW database only; remove both bootstrap values after provisioning.\n');
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
