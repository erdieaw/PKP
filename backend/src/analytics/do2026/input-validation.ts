import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DO_RULES } from './rules';

/** Only new writes are constrained. Historical arithmetic remains reproducible. */
export function validateDoInput(indicatorId: string, input: {
  readonly numerator: Prisma.Decimal.Value; readonly denominator: Prisma.Decimal.Value;
}) {
  const rule = DO_RULES[indicatorId];
  if (!rule) return;
  const numerator = new Prisma.Decimal(input.numerator);
  const denominator = new Prisma.Decimal(input.denominator);
  if (!numerator.isInteger()) throw new BadRequestException({ code: 'INTEGER_NUMERATOR_REQUIRED', message: 'Jumlah orang, kasus, item, hari, dokumen, atau komponen harus bilangan bulat.' });
  if (rule.denominatorInput === 'INTEGER' && !denominator.isInteger()) throw new BadRequestException({ code: 'INTEGER_DENOMINATOR_REQUIRED', message: 'Penyebut aktual berupa jumlah orang, kasus, resep, hari, atau komponen harus bilangan bulat. Desimal hanya diizinkan untuk profil estimasi.' });
}
