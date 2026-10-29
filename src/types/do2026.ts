export type Do2026InputBasis = 'PERIOD_ACTUAL' | 'YTD_ACTUAL';
export type Do2026Unit = 'PERCENT' | 'ITEMS_PER_PRESCRIPTION' | 'COUNT' | 'SCORE';

export interface SavePeriodRecap {
  readonly year: number; readonly endMonth: number; readonly indicatorId: string;
  readonly numerator: number; readonly denominator: number; readonly notes: string;
  readonly confirmed: true; readonly expectedRevision: number;
}

export interface Do2026Profile {
  readonly definitionId: string;
  readonly sourceRef: string;
  readonly formulaFamily: string;
  readonly measurementUnit: Do2026Unit | null;
  readonly numeratorLabel: string;
  readonly denominatorLabel: string;
  readonly status: 'IMPLEMENTED' | 'UNRESOLVED_RULE';
  readonly reason: string | null;
  readonly targetDisplay: string;
  readonly definition: string;
  readonly calculation: string;
  readonly cumulativePolicy?: string;
  readonly cumulativeInstruction?: string;
  readonly numeratorInput?: 'INTEGER' | null;
  readonly denominatorInput?: 'INTEGER' | 'ESTIMATED' | null;
  readonly observationPeriod?: 'CALENDAR_YEAR' | 'PROFILE_REVIEW_REQUIRED';
  readonly assessmentInstruction?: string;
}

export interface Do2026RecordFields {
  readonly scoringVersion?: string;
  readonly inputBasis?: string;
  readonly measurementValue?: number | null;
  readonly measurementUnit?: string | null;
  readonly totalSasaran?: number | null;
  readonly targetSasaran?: number | null;
  readonly status?: string;
  readonly reason?: string | null;
  readonly targetMet?: boolean | null;
  readonly effectiveDenominator?: number | null;
}

export function measurementText(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null) return '-';
  const formatted = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(value);
  switch (unit) {
    case 'PERCENT': return `${formatted}%`;
    case 'ITEMS_PER_PRESCRIPTION': return `${formatted} item/resep`;
    case 'COUNT': return `${formatted} jumlah`;
    case 'SCORE': return `${formatted} poin`;
    default: return formatted;
  }
}
