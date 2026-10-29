import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DO_RULES } from './rules';

export const DO_SCORING_VERSION = 'DO_2026_V2';
export type DoResult = {
  readonly assessmentComplete: false;
  readonly completionScope: 'ARITHMETIC_ONLY';
  readonly observationStatus: 'NOT_VERIFIED';
  readonly capaianRiilPct: number | null; readonly measurementValue: number | null;
  readonly measurementUnit: string | null; readonly nilaiKinerja: number | null;
  readonly scoringVersion: string; readonly status: string; readonly reason: string | null;
  readonly targetMet: boolean | null;
  readonly effectiveDenominator: number | null;
};
export const unavailableDo = (status: string, reason: string): DoResult => ({
  assessmentComplete: false, completionScope: 'ARITHMETIC_ONLY', observationStatus: 'NOT_VERIFIED',
  capaianRiilPct: null, measurementValue: null, measurementUnit: null, nilaiKinerja: null,
  scoringVersion: DO_SCORING_VERSION, status, reason, targetMet: null, effectiveDenominator: null,
});

export function scoreDo2026(indicatorId: string, input: { readonly numerator: Prisma.Decimal.Value; readonly denominator: Prisma.Decimal.Value }): DoResult {
  const numeratorValue = new Prisma.Decimal(input.numerator);
  const denominatorValue = new Prisma.Decimal(input.denominator);
  if ([numeratorValue, denominatorValue].some(value => !value.isFinite() || value.isNegative())) throw new BadRequestException('Pembilang dan penyebut harus angka nonnegatif yang terbatas');
  const rule = DO_RULES[indicatorId];
  if (!rule) return unavailableDo('UNRESOLVED_RULE', 'Profil DO belum lengkap; rumus umum tidak digunakan sebagai pengganti.');
  if (rule.fixedDenominator !== undefined && !denominatorValue.eq(rule.fixedDenominator)) throw new BadRequestException(`Penyebut sesuai DO harus ${rule.fixedDenominator}`);
  if (denominatorValue.isZero()) return unavailableDo('ZERO_DENOMINATOR', 'Penyebut nol bukan otomatis nihil terverifikasi, N/A, atau nilai 100.');
  if ((rule.fixedDenominator !== undefined || rule.unit === 'COUNT') && !numeratorValue.isInteger()) throw new BadRequestException('Jumlah komponen/dokumen/kelompok harus bilangan bulat');
  const denominator = denominatorValue.mul(rule.denominatorFactor ?? 1);
  if ((rule.unit === 'PERCENT' && rule.denominatorFactor === undefined || rule.scoring.kind === 'DOCUMENT') && numeratorValue.gt(denominator)) throw new BadRequestException('Pembilang tidak boleh melebihi penyebut untuk profil ini');
  let value = numeratorValue;
  switch (rule.unit) {
    case 'PERCENT': value = value.div(denominator).mul(100); break;
    case 'ITEMS_PER_PRESCRIPTION': value = value.div(denominator); break;
    case 'COUNT': break;
    case 'SCORE': value = value.div(denominator); break;
    default: return assertNever(rule.unit);
  }
  let score: number | null = null;
  let targetMet: boolean | null = null;
  let reason: string | null = null;
  switch (rule.scoring.kind) {
    case 'THRESHOLD': score = value.lte(rule.scoring.maximum) ? 100 : 0; targetMet = score === 100; break;
    case 'COVERAGE':
      targetMet = value.gte(rule.scoring.target);
      reason = 'Pengukuran dan ketercapaian tersedia. Normalisasi terhadap target serta batas skor maksimum memerlukan kebijakan penilaian yang disahkan.';
      break;
    case 'DOCUMENT': score = value.eq(1) ? 100 : 0; targetMet = score === 100; break;
    case 'ATTAINMENT':
      switch (rule.scoring.direction) {
        case 'MAX': targetMet = value.lte(rule.scoring.limit); break;
        case 'MIN': targetMet = value.gte(rule.scoring.limit); break;
        default: return assertNever(rule.scoring.direction);
      }
      reason = 'Ketercapaian dapat ditentukan, tetapi sumber belum menetapkan konversi skor numerik.';
      break;
    case 'BANDS': {
      const matches = rule.scoring.bands.filter(band => (band.minInclusive ? value.gte(band.min) : value.gt(band.min)) && (band.max === null || (band.maxInclusive ? value.lte(band.max) : value.lt(band.max))));
      if (matches.length === 1 && matches[0]) score = matches[0].score;
      else reason = matches.length > 1 ? 'Nilai berada pada interval sumber yang tumpang tindih.' : 'Nilai berada di celah rubrik sumber; tidak ada pembulatan/interpolasi otomatis.';
      break;
    }
    default: return assertNever(rule.scoring);
  }
  const measurementValue = value.toDecimalPlaces(8).toNumber();
  if (!Number.isFinite(measurementValue)) throw new BadRequestException('Hasil pengukuran di luar rentang angka');
  return {
    assessmentComplete: false, completionScope: 'ARITHMETIC_ONLY', observationStatus: 'NOT_VERIFIED',
    capaianRiilPct: rule.unit === 'PERCENT' ? measurementValue : null,
    measurementValue, measurementUnit: rule.unit,
    effectiveDenominator: denominator.toNumber(),
    nilaiKinerja: score === null ? null : new Prisma.Decimal(score).toDecimalPlaces(4).toNumber(),
    scoringVersion: DO_SCORING_VERSION, status: score === null ? 'UNRESOLVED_RULE' : 'SCORED', reason, targetMet,
  };
}

function assertNever(value: never): never { throw new BadRequestException(`Profil DO tidak dikenal: ${String(value)}`); }
