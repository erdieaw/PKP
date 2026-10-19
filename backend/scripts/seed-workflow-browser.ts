import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

config({ path: resolve(__dirname, '../.env'), quiet: true });

async function main() {
  if (process.env.NODE_ENV !== 'development') throw new Error('Workflow fixtures require NODE_ENV=development.');
  const password = process.env.FE_E2E_PASSWORD;
  if (!password || password.length < 12) throw new Error('FE_E2E_PASSWORD must contain at least 12 characters.');
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const suffix = randomUUID().replaceAll('-', '');
    const fixture = await prisma.$transaction(async tx => {
      const year = await tx.yearPeriod.findUnique({ where: { year: 2026 } });
      if (!year || year.isLocked) throw new Error('Workflow fixtures require an existing writable year 2026.');
      if (await tx.indicator.count({ where: { isActive: true } }) !== 272) throw new Error('Workflow fixtures require 272 active indicators.');
      const code = `FE-WORKFLOW-${suffix}`;
      const center = await tx.healthCenter.create({ data: { code, name: `Puskesmas ${code}`, district: 'Workflow browser E2E' } });
      const adminUsername = `wf.admin.${suffix}`;
      const dinkesUsername = `wf.dinkes.${suffix}`;
      await tx.user.create({ data: { username: adminUsername, name: `Workflow Admin ${suffix}`, role: Role.ADMIN_PUSKESMAS, healthCenterId: center.id, passwordHash } });
      await tx.user.create({ data: { username: dinkesUsername, name: `Workflow Dinkes ${suffix}`, role: Role.DINKES_ADMIN, passwordHash } });
      return { healthCenterId: center.id, code, adminUsername, dinkesUsername, year: 2026 };
    });
    console.log(JSON.stringify(fixture));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error && /^(Workflow fixtures|FE_E2E_PASSWORD)/.test(error.message)
    ? error.message : 'Workflow fixture seed failed; check development database configuration.');
  process.exitCode = 1;
});
