import 'dotenv/config';

export function getConfig() {
  const env = process.env;
  const required = (name: string, min = 1) => {
    const value = env[name];
    if (!value || value.trim().length < min) throw new Error(`${name} must contain at least ${min} characters`);
    return value;
  };
  const integer = (name: string, fallback: number, max: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} is invalid`);
    return value;
  };
  const url = (name: string, fallback: string, protocols: string[]) => {
    const value = env[name] ?? fallback;
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
    if (!protocols.includes(parsed.protocol)) throw new Error(`${name} has an invalid protocol`);
    return value;
  };
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV is invalid');
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const frontendUrl = url('FRONTEND_URL', 'http://localhost:3000', ['http:', 'https:']);
  if (new URL(frontendUrl).origin !== frontendUrl) throw new Error('FRONTEND_URL must be an exact origin without a path or trailing slash');
  return {
    port: integer('PORT', 4000, 65535),
    databaseUrl: url('DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:']),
    redisUrl: url('REDIS_URL', 'redis://127.0.0.1:56379', ['redis:', 'rediss:']),
    jwtSecret: required('JWT_SECRET', 32),
    accessTokenSeconds: integer('ACCESS_TOKEN_SECONDS', 900, 86400),
    refreshTokenDays: integer('REFRESH_TOKEN_DAYS', 7, 365),
    minioEndpoint: url('MINIO_ENDPOINT', 'http://127.0.0.1:59000', ['http:', 'https:']),
    minioPublicEndpoint: url('MINIO_PUBLIC_ENDPOINT', 'http://127.0.0.1:59000', ['http:', 'https:']),
    minioAccessKey: required('MINIO_ACCESS_KEY', 3),
    minioSecretKey: required('MINIO_SECRET_KEY', 8),
    evidenceBucket: env.EVIDENCE_BUCKET ?? 'evidence',
    reportsBucket: env.REPORTS_BUCKET ?? 'reports',
    frontendUrl,
    nodeEnv,
  };
}
