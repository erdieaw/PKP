import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const demo = process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO === 'true';
  const bootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (Boolean(bootstrapUsername) !== Boolean(bootstrapPassword)) {
    throw new Error('BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must both be supplied');
  }
  if (bootstrapPassword && bootstrapPassword.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters');
  }
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (demo && (!demoPassword || demoPassword.length < 12)) {
    throw new Error('SEED_DEMO_PASSWORD must contain at least 12 characters when demo seeding is enabled');
  }
  if (demo && bootstrapUsername && ['demo.dinkes', 'demo.admin', 'demo.pic'].includes(bootstrapUsername)) {
    throw new Error('Bootstrap username must not overlap demo usernames');
  }
  const catalogue = JSON.parse(await readFile(join(__dirname, 'seed-data/catalogue.json'), 'utf8')) as {
    scoringVersion: string;
    sections: Prisma.SectionCreateManyInput[];
    indicators: Prisma.IndicatorCreateManyInput[];
  };
  if (catalogue.scoringVersion !== 'ILP_2026_V1' || catalogue.indicators.length !== 272 ||
      catalogue.sections.filter(section => section.parentCode === null).length !== 29) {
    throw new Error('Invalid backend indicator catalogue');
  }
  const bootstrapHash = bootstrapPassword ? await argon2.hash(bootstrapPassword, { type: argon2.argon2id }) : null;
  const demoHash = demo ? await argon2.hash(demoPassword!, { type: argon2.argon2id }) : null;

  await prisma.$transaction(async tx => {
    // Serialize repeated seed invocations without changing application lock order.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2026, 272)`;
    for (const section of [...catalogue.sections].sort((a, b) => a.code.split('.').length - b.code.split('.').length)) {
      await tx.section.upsert({ where: { code: section.code }, create: section, update: {} });
    }
    for (const indicator of catalogue.indicators) {
      await tx.indicator.upsert({ where: { id: indicator.id }, create: indicator, update: {} });
    }
    await tx.yearPeriod.upsert({ where: { year: 2026 }, create: { year: 2026 }, update: {} });
    if (bootstrapUsername && bootstrapHash) {
      const existing = await tx.user.findUnique({ where: { username: bootstrapUsername } });
      if (existing && (existing.role !== Role.DINKES_ADMIN || existing.healthCenterId !== null)) {
        throw new Error('Bootstrap username already belongs to a non-Dinkes account');
      }
      // Bootstrap never resets an existing account's password or suspension state.
      await tx.user.upsert({
        where: { username: bootstrapUsername }, update: {},
        create: { username: bootstrapUsername, name: 'Administrator Dinas Kesehatan', role: Role.DINKES_ADMIN, passwordHash: bootstrapHash },
      });
    }
    if (demoHash) {
      const center = await tx.healthCenter.upsert({
        where: { code: 'DEMO-001' }, update: {},
        create: { code: 'DEMO-001', name: 'Puskesmas Demo', district: 'Demo' },
      });
      for (const account of [
        { username: 'demo.dinkes', name: 'Demo Dinkes', role: Role.DINKES_ADMIN, healthCenterId: null },
        { username: 'demo.admin', name: 'Demo Admin Puskesmas', role: Role.ADMIN_PUSKESMAS, healthCenterId: center.id },
        { username: 'demo.pic', name: 'Demo PIC', role: Role.PIC, healthCenterId: center.id },
      ]) {
        const existing = await tx.user.findUnique({ where: { username: account.username } });
        if (existing && (existing.role !== account.role || existing.healthCenterId !== account.healthCenterId)) {
          throw new Error('Demo username already belongs to an incompatible account');
        }
        await tx.user.upsert({ where: { username: account.username }, update: {}, create: { ...account, passwordHash: demoHash } });
      }
    }
  }, { timeout: 120_000 });
  console.log(`Seeded 272 indicators, ${catalogue.sections.length} sections (29 top-level), and year 2026. No monthly history created.`);
  if (bootstrapHash) console.log('Bootstrap admin ensured; existing credentials preserved.');
  if (demoHash) console.log('Demo accounts ensured: demo.dinkes, demo.admin, demo.pic; existing credentials preserved.');
}

main().catch(() => {
  // Do not print Prisma query arguments or environment credentials on failure.
  console.error('Seed failed. Check catalogue, database availability, and seed credential configuration.');
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
