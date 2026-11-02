import { Prisma } from '@prisma/client';
import { DO_SCORING_VERSION, scoreDo2026, unavailableDo } from './scorer';
import { DO_RULES } from './rules';
import { DO_REVIEW_HOLDS } from './review-holds';
import { BadRequestException } from '@nestjs/common';
import { evaluateStructuredInput, structuredInputKindFor } from './structured-input';

export type DoObservation = {
  readonly month: number; readonly pencapaianRiil: Prisma.Decimal.Value;
  readonly totalSasaran: Prisma.Decimal.Value; readonly scoringVersion: string; readonly inputBasis?: string;
};
export type DoRecap = {
  readonly numerator: Prisma.Decimal.Value; readonly denominator: Prisma.Decimal.Value;
  readonly endMonth: number; readonly revision: number; readonly notes: string;
  readonly scoringVersion: string; readonly confirmed: boolean;
  readonly structuredInput?: unknown;
};

// These profiles are candidates for pooling, not proof of compatible samples.
// Until structured compatibility exists, only an explicitly confirmed recap is used.
const additive = new Set(['K5-R23', 'K5-R24', 'K5-R25', 'K5-R26', 'K5-R37']);
export const cumulativePolicy = (id: string) => structuredInputKindFor(id) === 'DO_SOURCE_ASSESSMENT' ? 'EXPLICIT_SOURCE_ASSESSMENT_REQUIRED' : !DO_RULES[id] ? 'UNSUPPORTED' : 'EXPLICIT_YTD_REQUIRED';

export function evaluateDoCumulative(indicatorId: string, scope: {
  readonly records: readonly DoObservation[]; readonly months: readonly number[]; readonly recap?: DoRecap; readonly year?: number;
  readonly purpose?: 'SOURCE_RECAP' | 'PERIOD_REPORT';
}) {
  const endMonth = Math.max(...scope.months);
  const structuredKind = structuredInputKindFor(indicatorId);
  const sourceAssessment = structuredKind === 'DO_SOURCE_ASSESSMENT';
  const annualOnly = (!!structuredKind && !sourceAssessment) || DO_RULES[indicatorId]?.annualRecapOnly === true;
  const fullYear = scope.months.length === 12 && scope.months.every((month, index) => month === index + 1);
  const covered = scope.records.filter(row => scope.months.includes(row.month));
  const availableMonths = scope.months.filter(month => covered.some(row => row.month === month && row.scoringVersion === DO_SCORING_VERSION && row.inputBasis === 'PERIOD_ACTUAL'));
  const missingMonths = scope.months.filter(month => !availableMonths.includes(month));
  const recap = scope.recap?.endMonth === endMonth ? scope.recap : undefined;
  const endpoint = covered.find(row => row.month === endMonth && row.inputBasis === 'YTD_ACTUAL');
  let numerator: Prisma.Decimal | null = null;
  let denominator: Prisma.Decimal | null = null;
  let aggregationMethod: string = cumulativePolicy(indicatorId);
  let dataComplete = false;
  let recapStructuredInput: unknown = recap?.structuredInput ?? null;
  let result = unavailableDo('MISSING_PERIOD_BASIS', 'Diperlukan rekap Januari–akhir periode dari sumber yang sesuai DO; orang unik, populasi dan checklist tidak dijumlahkan antarbulan.');
  if (!structuredKind && recapStructuredInput !== null) {
    result = unavailableDo('INVALID_STRUCTURED_INPUT', 'Stored structuredInput is unexpected for this profile; the payload is preserved for review, not scored or discarded.');
  } else if (sourceAssessment) {
    result = unavailableDo('SOURCE_ASSESSMENT_REQUIRED', 'Asesmen sumber terpisah wajib. Data bulanan, histori V1 dan YTD lama tidak digabung atau menggantikannya.');
    if (recap?.confirmed === true && recap.scoringVersion === DO_SCORING_VERSION) {
      try {
        const derived = evaluateStructuredInput(indicatorId, recap.structuredInput, scope.year, endMonth);
        if (typeof recap.notes !== 'string' || !recap.notes.trim()) throw new BadRequestException({ code: 'INVALID_SOURCE_ASSESSMENT', message: 'Referensi dan attestasi rekap wajib dicatat.' });
        result = scoreDo2026(indicatorId, { numerator: recap.numerator, denominator: recap.denominator, sourceAssessmentConfirmed: true, structuredInput: derived.structuredInput, year: scope.year, endMonth });
        numerator = new Prisma.Decimal(derived.numerator); denominator = new Prisma.Decimal(derived.denominator);
        aggregationMethod = 'EXPLICIT_SOURCE_ASSESSMENT';
        dataComplete = result.measurementValue !== null;
        // A stored December snapshot/month is not an annual measurement. Retain its
        // identity and source payload, but never expose its value as a YTD result.
        const assessmentScope = result.assessmentScope;
        const quarterMatch = assessmentScope?.kind === 'QUARTER' && scope.months.length === 3 && scope.months.every((month, index) => month === endMonth - 2 + index);
        const monthMatch = assessmentScope?.kind === 'MONTH' && scope.months.length === 1 && scope.months[0] === endMonth;
        const annualMatch = assessmentScope?.annualComparable === true && fullYear;
        if (scope.purpose !== 'SOURCE_RECAP' && !annualMatch && !quarterMatch && !monthMatch) {
          const localResolutionResult = result.localResolutionResult;
          result = { ...unavailableDo('ASSESSMENT_SCOPE_MISMATCH', 'Lingkup observasi sumber bukan periode laporan. Buka asesmen sumber; tidak ada konversi ke capaian tahunan/YTD.'), assessmentScope,
            ...(localResolutionResult ? { localResolutionResult: { ...localResolutionResult, metrics: localResolutionResult.metrics.map(metric => ({ ...metric, value: null, targetMet: null, status: 'ASSESSMENT_SCOPE_MISMATCH' as const })) } } : {}),
          };
          numerator = null; denominator = null; dataComplete = false;
        }
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        const response = error.getResponse();
        result = unavailableDo(typeof response === 'object' && 'code' in response ? String(response.code) : 'INVALID_SOURCE_ASSESSMENT', error.message);
      }
    }
  } else if (!DO_RULES[indicatorId]) {
    result = unavailableDo('UNRESOLVED_RULE', DO_REVIEW_HOLDS[indicatorId] ?? 'Profil pengukuran belum didukung. Tidak memakai rumus umum atau prorata sebagai pengganti.');
  } else if (annualOnly && (!fullYear || recap?.confirmed !== true || recap.scoringVersion !== DO_SCORING_VERSION || (structuredKind && recap.endMonth !== 12))) {
    result = unavailableDo('ANNUAL_RECAP_REQUIRED', 'Diperlukan rekap tahunan Januari sampai Desember yang dikonfirmasi sesuai DO. Data bulanan, rekap parsial dan YTD lama tidak menggantikannya.');
  } else if (recap && recap.confirmed && recap.scoringVersion === DO_SCORING_VERSION) {
    // A separate, attested source supersedes automatic aggregation; it is never
    // added to monthly observations, including historical V1 observations.
    if (structuredKind) {
      try {
        const derived = evaluateStructuredInput(indicatorId, recap.structuredInput, scope.year);
        if (typeof recap.notes !== 'string' || !recap.notes.trim()) throw new BadRequestException({ code: 'INVALID_STRUCTURED_INPUT', message: 'Sumber dan attestasi rekap (termasuk ledger kosong) wajib dicatat.' });
        result = scoreDo2026(indicatorId, { numerator: recap.numerator, denominator: recap.denominator, annualRecapConfirmed: true, structuredInput: derived.structuredInput, year: scope.year });
        numerator = new Prisma.Decimal(derived.numerator); denominator = new Prisma.Decimal(derived.denominator);
        recapStructuredInput = derived.structuredInput;
        aggregationMethod = 'EXPLICIT_YTD_RECAP'; dataComplete = denominator.gt(0);
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        const response = error.getResponse();
        const code = typeof response === 'object' && 'code' in response ? String(response.code) : 'INVALID_STRUCTURED_INPUT';
        result = unavailableDo(code, error.message);
      }
    } else {
      numerator = new Prisma.Decimal(recap.numerator); denominator = new Prisma.Decimal(recap.denominator);
      aggregationMethod = 'EXPLICIT_YTD_RECAP'; dataComplete = denominator.gt(0);
      result = scoreDo2026(indicatorId, { numerator, denominator, annualRecapConfirmed: annualOnly && fullYear });
    }
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
    populatedMonths: sourceAssessment ? 0 : dataComplete ? scope.months.length : availableMonths.length,
    expectedMonths: scope.months.length, isComplete: dataComplete && result.nilaiKinerja !== null,
    inputBasis: sourceAssessment ? 'SOURCE_ASSESSMENT' : 'YTD_ACTUAL',
    recapRevision: recap?.revision ?? 0, recapNotes: recap?.notes ?? null,
    recapStructuredInput,
  };
}
