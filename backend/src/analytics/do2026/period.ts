import { Prisma } from '@prisma/client';
import { DO_SCORING_VERSION, scoreDo2026, unavailableDo } from './scorer';
import { evaluateDoCumulative } from './cumulative';

type Observation = {
  readonly month: number; readonly pencapaianRiil: Prisma.Decimal.Value;
  readonly totalSasaran: Prisma.Decimal.Value; readonly scoringVersion: string; readonly inputBasis?: string;
};

export function evaluateDoPeriod(indicatorId: string, records: readonly Observation[], months: readonly number[]) {
  const covered = records.filter(record => months.includes(record.month));
  const endpoint = Math.max(...months);
  const record = covered.find(row => row.month === endpoint);
  const cumulative = months.length > 1 && months.every((month, index) => month === index + 1);
  if (cumulative) return evaluateDoCumulative(indicatorId, { records, months });
  const expectedBasis = cumulative ? 'YTD_ACTUAL' : 'PERIOD_ACTUAL';
  const result = covered.some(row => row.scoringVersion !== DO_SCORING_VERSION)
    ? unavailableDo('MIXED_SCORING_VERSIONS', 'Periode berisi versi aturan berbeda. Pisahkan revisi secara eksplisit; hasil tidak digabung.')
    : !record ? unavailableDo('MISSING_DATA', 'Belum ada rekap pada akhir periode yang dipilih.')
    : record.inputBasis !== expectedBasis && !(endpoint === 1 && record.inputBasis === 'YTD_ACTUAL')
      ? unavailableDo('MISSING_PERIOD_BASIS', 'Rekap harus mencakup tepat periode yang dipilih. Data bulanan tidak dijumlahkan menjadi orang unik; data YTD bukan data bulan mandiri.')
      : scoreDo2026(indicatorId, { numerator: record.pencapaianRiil, denominator: record.totalSasaran });
  return {
    ...result, pencapaianRiil: record ? Number(record.pencapaianRiil) : null,
    totalSasaran: record ? Number(record.totalSasaran) : null, targetSasaran: null,
    populatedMonths: record ? 1 : 0, expectedMonths: 1, isComplete: result.nilaiKinerja !== null,
    inputBasis: record?.inputBasis ?? null,
  };
}
