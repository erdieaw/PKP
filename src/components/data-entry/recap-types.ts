import type { RecapStructuredInput } from '../../types/do2026';
import type { SourceAssessmentPeriod } from '../../types/sourceAssessment';
import type { LocalResolutionResult } from '../../types/localResolution';

export const recapMonths = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'] as const;

export interface PeriodRecapItem {
  readonly indicatorId: string;
  readonly indicator: { readonly indikator: string };
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly measurementValue: number | null;
  readonly measurementUnit: string | null;
  readonly scoringVersion?: string;
  readonly nilaiKinerja: number | null;
  readonly status: string;
  readonly reason: string | null;
  readonly aggregationMethod: string;
  readonly missingMonths: readonly number[];
  readonly availableMonths: readonly number[];
  readonly dataComplete: boolean;
  readonly scoreComplete: boolean;
  readonly recapRevision: number;
  readonly recapNotes: string | null;
  readonly recapStructuredInput?: RecapStructuredInput | null;
  readonly sourceAssessmentPeriod?: SourceAssessmentPeriod & { readonly label: string; readonly annualComparable: boolean };
  readonly assessmentScope?: SourceAssessmentPeriod & { readonly label: string; readonly annualComparable: boolean };
  readonly localResolutionResult?: LocalResolutionResult;
}

export interface PeriodRecapResponse {
  readonly healthCenterId: string;
  readonly year: number;
  readonly endMonth: number;
  readonly isOfficial: false;
  readonly items: readonly PeriodRecapItem[];
}

export const recapMethodLabels: Readonly<Record<string, string>> = {
  EXPLICIT_SOURCE_ASSESSMENT: 'Asesmen sumber terpisah pada lingkup observasi eksplisit',
  EXPLICIT_SOURCE_ASSESSMENT_REQUIRED: 'Memerlukan asesmen sumber terstruktur',
  SUM_ACTUAL_ND: 'Penjumlahan N/D aktual yang kompatibel',
  MISSING_MONTHS: 'Data bulanan belum lengkap',
  EXPLICIT_YTD: 'Rekap terpisah Januari sampai akhir periode',
  EXPLICIT_YTD_RECAP: 'Rekap terpisah Januari sampai akhir periode',
  LEGACY_YTD: 'Observasi kumulatif tersimpan pada bulan akhir',
  LEGACY_EXPLICIT_YTD: 'Observasi kumulatif tersimpan pada bulan akhir',
  SEPARATE_RECAP_REQUIRED: 'Memerlukan rekap terpisah sesuai DO',
  EXPLICIT_YTD_REQUIRED: 'Memerlukan rekap terpisah sesuai DO',
  UNSUPPORTED: 'Metode penghitungan belum tersedia',
};
