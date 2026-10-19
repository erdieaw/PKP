import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockYear(tx: Prisma.TransactionClient, year: number, allowLocked = false) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new BadRequestException('Invalid year');
  const rows = await tx.$queryRaw<{ year: number; isLocked: boolean; cutoffDay: number }[]>`
    SELECT "year", "isLocked", "cutoffDay" FROM year_periods WHERE year = ${year} FOR UPDATE`;
  const period = rows[0];
  if (!period) throw new NotFoundException('Year period not found');
  if (period.isLocked && !allowLocked) throw new ConflictException('Year period is locked');
  return period;
}

// All period writers must acquire lockYear first, including creation of period locks.
export async function assertWritable(tx: Prisma.TransactionClient, healthCenterId: string, year: number, month: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('Invalid month');
  const locked = await tx.periodLock.findFirst({
    where: {
      healthCenterId, year, status: { in: ['SUBMITTED', 'VERIFIED'] },
      OR: [{ isQuarter: false, periodNumber: month }, { isQuarter: true, periodNumber: { gte: Math.ceil(month / 3) } }],
    }, select: { id: true },
  });
  if (locked) throw new ConflictException('Month is protected by a submitted or verified period');
}
