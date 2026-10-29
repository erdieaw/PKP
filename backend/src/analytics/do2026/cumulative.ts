import { Prisma } from '@prisma/client';
import { DO_SCORING_VERSION, scoreDo2026, unavailableDo } from './scorer';
import { DO_RULES } from './rules';

export type DoObservation = {
  readonly month: number; readonly pencapaianRiil: Prisma.Decimal.Value;
  readonly totalSasaran: Prisma.Decimal.Value; readonly scoringVersion: string; readonly inputBasis?: string;
};
export type DoRecap = {
  readonly numerator: Prisma.Decimal.Value; readonly denominator: Prisma.Decimal.Value;
  readonly endMonth: number; readonly revision: number; readonly notes: string;
  readonly scoringVersion: string; readonly confirmed: boolean;
};

// These profiles are candidates for pooling, not proof of compatible samples.
// Until structured compatibility exists, only an explicitly confirmed recap is used.
const additive = new Set(['K5-R23', 'K5-R24', 'K5-R25', 'K5-R26', 'K5-R37']);
export const cumulativePolicy = (id: string) => !DO_RULES[id] ? 'UNSUPPORTED' : 'EXPLICIT_YTD_REQUIRED';

export function evaluateDoCumulative(indicatorId: string, scope: {
  readonly records: readonly DoObservation[]; readonly months: readonly number[]; readonly recap?: DoRecap;
}) {
  const endMonth = Math.max(...scope.months);
  const covered = scope.records.filter(row => scope.months.includes(row.month));
  const availableMonths = scope.months.filter(month => covered.some(row => row.month === month && row.scoringVersion === DO_SCORING_VERSION && row.inputBasis === 'PERIOD_ACTUAL'));
  const missingMonths = scope.months.filter(month => !availableMonths.includes(month));
  const recap = scope.recap?.endMonth === endMonth ? scope.recap : undefined;
  const endpoint = covered.find(row => row.month === endMonth && row.inputBasis === 'YTD_ACTUAL');
  let numerator: Prisma.Decimal | null = null;
  let denominator: Prisma.Decimal | null = null;
  let aggregationMethod: string = cumulativePolicy(indicatorId);
  let dataComplete = false;
  let result = unavailableDo('MISSING_PERIOD_BASIS', 'Diperlukan rekap Januari–akhir periode dari sumber yang sesuai DO; orang unik, populasi dan checklist tidak dijumlahkan antarbulan.');
  if (!DO_RULES[indicatorId]) {
    result = unavailableDo('UNRESOLVED_RULE', 'Profil pengukuran belum didukung. Tidak memakai rumus umum atau prorata sebagai pengganti.');
  } else if (recap && recap.confirmed && recap.scoringVersion === DO_SCORING_VERSION) {
    // A separate, attested source supersedes automatic aggregation; it is never
    // added to monthly observations, including historical V1 observations.
    numerator = new Prisma.Decimal(recap.numerator); denominator = new Prisma.Decimal(recap.denominator);
    aggregationMethod = 'EXPLICIT_YTD_RECAP'; dataComplete = denominator.gt(0);
    result = scoreDo2026(indicatorId, { numerator, denominator });
  } else if (covered.some(row => row.scoringVersion !== DO_SCORING_VERSION)) {
    result = unavailableDo('MIXED_SCORING_VERSIONS', 'Versi bulanan berbeda tidak digabung. Gunakan rekap terpisah dengan sumber periode yang dikonfirmasi.');
  } else if (endpoint) {
    numerator = new Prisma.Decimal(endpoint.pencapaianRiil); denominator = new Prisma.Decimal(endpoint.totalSasaran);
    aggregationMethod = 'LEGACY_EXPLICIT_YTD'; dataComplete = denominator.gt(0);
    result = scoreDo2026(indicatorId, { numerator, denominator });
  } else if (additive.has(indicatorId)) {
    if (missingMonths.length) result = unavailableDo('MISSING_DATA', 'Belum semua bulan memiliki N dan D aktual bulanan. Bulan kosong tidak dianggap nol.');
    else if (covered.some(row => new Prisma.Decimal(row.totalSasaran).lte(0))) result = unavailableDo('ZERO_DENOMINATOR', 'Ada bulan dengan penyebut nol; perlu peninjauan atau rekap terpisah yang dikonfirmasi.');
    else result = unavailableDo('COMPATIBILITY_UNVERIFIED', 'Bulan tersedia, tetapi kesesuaian sampel, metode, dan periode belum terverifikasi. Tidak dijumlahkan otomatis. Susun rekap terpisah dari sumber yang direkonsiliasi dan konfirmasikan kesesuaiannya.');
  }
  return {
    ...result, pencapaianRiil: numerator?.toNumber() ?? null, totalSasaran: denominator?.toNumber() ?? null, targetSasaran: null,
    numerator: numerator?.toNumber() ?? null, denominator: denominator?.toNumber() ?? null, aggregationMethod, availableMonths, missingMonths,
    requiredMissingMonths: dataComplete ? [] : missingMonths,
    dataComplete, scoreComplete: dataComplete && result.nilaiKinerja !== null,
    populatedMonths: dataComplete ? scope.months.length : availableMonths.length,
    expectedMonths: scope.months.length, isComplete: dataComplete && result.nilaiKinerja !== null,
    inputBasis: 'YTD_ACTUAL',
    recapRevision: recap?.revision ?? 0, recapNotes: recap?.notes ?? null,
  };
}
