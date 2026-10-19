import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

config({ path: resolve(__dirname, '../.env'), quiet: true });

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Browser fixtures are forbidden in production.');
  const password = process.env.FE_E2E_PASSWORD;
  if (!password || password.length < 12) throw new Error('FE_E2E_PASSWORD must contain at least 12 characters.');
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const fixtures = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2026, 272)`;
      const indicators = await tx.indicator.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
      if (indicators.length !== 272) throw new Error('Seed the official 272-indicator catalogue first.');
      const year = await tx.yearPeriod.upsert({ where: { year: 2026 }, update: {}, create: { year: 2026, isLocked: false } });
      if (year.isLocked) throw new Error('Year 2026 is locked; refusing to change global reporting state.');
      const centers = [];
      for (const code of ['FE-E2E-001', 'FE-E2E-002']) {
        const name = `Puskesmas ${code}`;
        const existing = await tx.healthCenter.findUnique({ where: { code } });
        if (existing && (existing.name !== name || !existing.isActive)) throw new Error('Fixture center conflicts with an existing center.');
        centers.push(await tx.healthCenter.upsert({ where: { code }, update: {}, create: { code, name, district: 'FE E2E' } }));
      }
      const users = [];
      for (const account of [
        { username: 'fe.admin', name: 'FE E2E Admin', role: Role.ADMIN_PUSKESMAS, healthCenterId: centers[0].id },
        { username: 'fe.pic', name: 'FE E2E PIC', role: Role.PIC, healthCenterId: centers[0].id },
        { username: 'fe.dinkes', name: 'FE E2E Dinkes', role: Role.DINKES_ADMIN, healthCenterId: null },
      ]) {
        const existing = await tx.user.findUnique({ where: { username: account.username } });
        if (existing && (existing.name !== account.name || existing.role !== account.role || existing.healthCenterId !== account.healthCenterId || existing.status !== 'ACTIVE')) {
          throw new Error('Fixture username conflicts with an existing account.');
        }
        // Only these isolated fixture accounts may follow a rotated test password.
        const update = existing && !await argon2.verify(existing.passwordHash, password)
          ? { passwordHash, tokenVersion: { increment: 1 } } : {};
        users.push(await tx.user.upsert({ where: { username: account.username }, update, create: { ...account, passwordHash } }));
      }
      for (const center of centers) {
        await tx.annualTarget.createMany({
          skipDuplicates: true,
          data: indicators.map(indicator => ({ healthCenterId: center.id, indicatorId: indicator.id, year: 2026, totalSasaran: 120, targetPct: 100, targetSasaran: 120 })),
        });
      }
      const assignment = { healthCenterId: centers[0].id, indicatorId: indicators[0].id, year: 2026 };
      const existing = await tx.picAssignment.findUnique({ where: { healthCenterId_indicatorId_year: assignment } });
      if (existing && existing.picUserId !== users[1].id) throw new Error('Fixture assignment has changed; refusing to overwrite it.');
      await tx.picAssignment.upsert({ where: { healthCenterId_indicatorId_year: assignment }, update: {}, create: { ...assignment, picUserId: users[1].id } });
      return { healthCenterIds: centers.map(center => center.id), users: users.map(user => ({ username: user.username, id: user.id })), indicatorId: indicators[0].id };
    }, { timeout: 120_000 });
    console.log(JSON.stringify(fixtures));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  // Never print Prisma errors, query arguments, hashes, or environment secrets.
  console.error(error instanceof Error && /^(Browser fixtures|FE_E2E_PASSWORD|Seed the official|Year 2026|Fixture)/.test(error.message)
    ? error.message : 'Browser fixture seed failed; check database availability and configuration.');
  process.exitCode = 1;
});
