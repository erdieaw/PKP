import { Prisma } from '@prisma/client';
import { Actor } from './auth.decorators';

export async function audit(tx: Prisma.TransactionClient, actor: Actor, healthCenterId: string | null, action: string, details: Prisma.InputJsonValue) {
  const sanitize = (value: unknown, depth = 0): unknown => {
    if (depth > 12) return '[truncated]';
    if (typeof value === 'string') return value.slice(0, 4000);
    if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .slice(0, 100).map(([key, item]) => [key, /password|secret|token|authorization|cookie|hash/i.test(key) ? '[redacted]' : sanitize(item, depth + 1)]));
    return value;
  };
  return tx.auditLog.create({ data: {
    userId: actor.id, actorName: actor.name, healthCenterId, action,
    details: sanitize(details) as Prisma.InputJsonValue,
  } });
}
