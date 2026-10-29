import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AnnualTarget } from '@prisma/client';
import { calculateScore } from '../analytics/scoring';
import { DO_SCORING_VERSION, scoreDo2026 } from '../analytics/do2026/scorer';
import { evaluateDoPeriod } from '../analytics/do2026/period';
import type { MonthlyRecordDto } from './operations.dto';
import { validateDoInput } from '../analytics/do2026/input-validation';

// Year and annual target are the existing persistence scope; the optional target
// deliberately does not apply to V2. Keep the V1 caller contract explicit.
export function scoreMonthlyInput(indicator: Parameters<typeof calculateScore>[0], record: MonthlyRecordDto, year: number, annual?: Pick<AnnualTarget, 'totalSasaran' | 'targetSasaran' | 'targetPct'>) {
  if (record.scoringVersion === DO_SCORING_VERSION) {
    if (year < 2026) throw new BadRequestException('DO_2026_V2 requires year 2026 or later');
    if (record.inputBasis === 'YTD_ACTUAL') throw new BadRequestException({
      code: 'SEPARATE_RECAP_REQUIRED',
      message: 'Simpan rekap kumulatif melalui Rekap Kumulatif & Tahunan dengan catatan sumber dan konfirmasi. Observasi YTD lama tetap dapat dibaca.',
    });
    if (record.inputBasis !== 'PERIOD_ACTUAL' || record.totalSasaran === undefined || record.totalSasaran === null) {
      throw new BadRequestException('DO_2026_V2 requires explicit inputBasis and actual totalSasaran');
    }
    validateDoInput(indicator.id, { numerator: record.pencapaianRiil, denominator: record.totalSasaran });
    const scored = scoreDo2026(indicator.id, { numerator: record.pencapaianRiil, denominator: record.totalSasaran });
    return { totalSasaran: new Prisma.Decimal(record.totalSasaran), targetSasaran: new Prisma.Decimal(0), capaianRiilPct: scored.capaianRiilPct, nilaiKinerja: scored.nilaiKinerja, scoringVersion: DO_SCORING_VERSION, inputBasis: record.inputBasis };
  }
  if (record.inputBasis !== undefined || record.totalSasaran !== undefined) throw new BadRequestException('Actual denominator and inputBasis require DO_2026_V2');
  if (!annual) throw new ConflictException('Every legacy record requires an explicit annual target');
  const totalSasaran = new Prisma.Decimal(annual.totalSasaran).div(12).toDecimalPlaces(4);
  const targetSasaran = new Prisma.Decimal(annual.targetSasaran).div(12).toDecimalPlaces(4);
  const scored = calculateScore(indicator, record.pencapaianRiil, Number(totalSasaran), Number(annual.targetPct));
  const usable = totalSasaran.greaterThan(0) && targetSasaran.greaterThan(0) && annual.targetPct.greaterThan(0);
  return { totalSasaran, targetSasaran, capaianRiilPct: usable ? scored.capaianRiilPct : null, nilaiKinerja: usable ? scored.nilaiKinerja : null, scoringVersion: scored.scoringVersion, inputBasis: 'MONTHLY_DELTA' };
}

type PeriodRecord = Parameters<typeof evaluateDoPeriod>[1][number] & { readonly indicatorId: string };

export function guardLegacyOverwrite(existing: readonly { readonly scoringVersion: string }[]) {
  if (existing.some(record => record.scoringVersion === DO_SCORING_VERSION)) throw new ConflictException('A DO_2026_V2 record cannot be overwritten by a legacy payload; preserve its explicit version, inputBasis and actual denominator');
}

export function guardDoSubmission(catalogue: readonly { readonly id: string }[], records: readonly PeriodRecord[], months: number[]) {
  if (!records.some(record => record.scoringVersion === DO_SCORING_VERSION)) return;
  const evaluations = catalogue.map(indicator => {
    const selected = records.filter(record => record.indicatorId === indicator.id);
    const versions = new Set(selected.map(record => record.scoringVersion));
    if (versions.size > 1) return { indicatorId: indicator.id, status: 'MIXED_SCORING_VERSIONS', isComplete: false };
    const result = evaluateDoPeriod(indicator.id, selected, months);
    return { indicatorId: indicator.id, status: result.status, isComplete: result.isComplete, reason: result.reason };
  });
  throw new ConflictException({ message: 'DO_2026_V2 submission is blocked until official category and aggregation policy is confirmed', code: 'DO_POLICY_UNRESOLVED', evaluations });
}

export function containsDoSnapshot(snapshot: Prisma.JsonValue | undefined): boolean {
  if (snapshot === null || typeof snapshot !== 'object') return false;
  if (Array.isArray(snapshot)) return snapshot.some(containsDoSnapshot);
  return snapshot['scoringVersion'] === DO_SCORING_VERSION || Object.values(snapshot).some(containsDoSnapshot);
}
