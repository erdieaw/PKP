import 'dotenv/config';
import { isIP } from 'node:net';

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
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? '';
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? '';
  const turnstileRequiredValue = env.TURNSTILE_REQUIRED;
  if (turnstileRequiredValue !== undefined && !['true', 'false'].includes(turnstileRequiredValue)) {
    throw new Error('TURNSTILE_REQUIRED must be true or false');
  }
  const turnstileRequired = turnstileRequiredValue === undefined ? nodeEnv === 'production' : turnstileRequiredValue === 'true';
  if (Boolean(siteKey) !== Boolean(secretKey) || (turnstileRequired && !siteKey)) {
    throw new Error('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must both be configured');
  }
  if (nodeEnv === 'production' && (/^[123]x0{20}[A-Z]{2}$/i.test(siteKey) || /^[123]x0{31}AA$/i.test(secretKey))) {
    throw new Error('Turnstile testing keys are not allowed in production');
  }
  const trustedProxyIps = env.TRUSTED_PROXY_IPS?.trim()
    ? env.TRUSTED_PROXY_IPS.split(',').map(value => value.trim()) : [];
  if (trustedProxyIps.length > 16 || trustedProxyIps.some(value => !isIP(value))) {
    throw new Error('TRUSTED_PROXY_IPS must contain at most 16 comma-separated IP addresses');
  }
  return {
    port: integer('PORT', 4000, 65535),
    databaseUrl: url('DATABASE_URL', databaseUrl, ['postgres:', 'postgresql:']),
    redisUrl: url('REDIS_URL', 'redis://127.0.0.1:56379', ['redis:', 'rediss:']),
    jwtSecret: required('JWT_SECRET', 32),
    accessTokenSeconds: integer('ACCESS_TOKEN_SECONDS', 900, 86400),
    refreshTokenDays: integer('REFRESH_TOKEN_DAYS', 7, 365),
    rateLimits: {
      login: integer('RATE_LIMIT_LOGIN_PER_MINUTE', 5, 100),
      read: integer('RATE_LIMIT_READ_PER_MINUTE', 600, 10000),
      write: integer('RATE_LIMIT_WRITE_PER_MINUTE', 120, 10000),
      public: integer('RATE_LIMIT_PUBLIC_PER_MINUTE', 120, 10000),
    },
    minioEndpoint: url('MINIO_ENDPOINT', 'http://127.0.0.1:59000', ['http:', 'https:']),
    minioPublicEndpoint: url('MINIO_PUBLIC_ENDPOINT', 'http://127.0.0.1:59000', ['http:', 'https:']),
    minioAccessKey: required('MINIO_ACCESS_KEY', 3),
    minioSecretKey: required('MINIO_SECRET_KEY', 8),
    evidenceBucket: env.EVIDENCE_BUCKET ?? 'evidence',
    reportsBucket: env.REPORTS_BUCKET ?? 'reports',
    frontendUrl,
    turnstile: { required: turnstileRequired, siteKey, secretKey, hostname: new URL(frontendUrl).hostname },
    trustedProxyIps,
    nodeEnv,
  };
}
