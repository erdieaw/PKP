import type { SourceAssessmentDescriptor, SourceAssessmentInput, SourceAssessmentPeriod, SourcePeriodKind } from './sourceAssessment';
import type { LocalResolutionDescriptor, LocalResolutionResult } from './localResolution';
export type Do2026InputBasis = 'PERIOD_ACTUAL' | 'YTD_ACTUAL' | 'SOURCE_ASSESSMENT';
export type Do2026Unit = 'PERCENT' | 'ITEMS_PER_PRESCRIPTION' | 'COUNT' | 'SCORE';

export type PmeAnnualInput = {
  kind: 'PME_ANNUAL'; year: number;
  participations: { eventId: string; date: string; organizer: string; program: string; evidenceReference: string }[];
};

export type RtmAnnualInput = {
  kind: 'RTM_ANNUAL'; year: number;
  meetings: { meetingId: string; date: string; minutesReference: string }[];
  recommendations: {
    recommendationId: string; meetingId: string; description: string;
    followUpStatus: 'COMPLETED' | 'NOT_COMPLETED'; followUpDate?: string; followUpReference?: string;
  }[];
};

export type LroaAnnualInput = {
  kind: 'LROA_ANNUAL'; year: number; sourceReference: string; sourceCoverageComplete: true;
  months: {
    month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    reportStatus: 'COMPLETE' | 'INCOMPLETE' | 'ABSENT'; reportReference?: string;
    activityCounts: {
      rehydrationCounselling: number; diarrhoeaManagement: number; communityEducation: number;
      dehydrationTreatment: number; threeHourObservation: number; oralitPreparation: number;
    };
  }[];
};
export type SemesterSurveyAnnualInput = {
  kind: 'SEMESTER_SURVEY_ANNUAL'; year: number; scale: 'DOCUMENTED_100_POINT';
  scaleReference: string; methodCompatibilityReference: string; compatibleMethodsConfirmed: true;
  semesters: { semester: 1 | 2; value: number; methodReference: string; reportReference: string }[];
};
export type TbCohortAnnualInput = {
  kind: 'TB_COHORT_ANNUAL'; year: number;
  cohort: {
    type: 'TB_TREATED_RECORDED_REPORTED'; year: number; cohortReference: string;
    sourceSystem: 'SITB'; sourceReference: string; originalDenominator: number; successfulCount: number;
    outcomeDefinition: 'CURED_OR_TREATMENT_COMPLETED'; outcomeAssessmentReference: string;
    complete: true; originalDenominatorAndOutcomeLinkageAttested: true; distinctSuccessfulPatientsAttested: true;
  };
};
export type LeprosyCohortAnnualInput = {
  kind: 'LEPROSY_COHORT_ANNUAL'; year: number;
  cohorts: {
    type: 'PB' | 'MB'; year: number; cohortReference: string; sourceSystem: 'SIPK'; sourceReference: string;
    originalNewCaseStarts: number; completedCount: number; prescribedPeriodReference: string;
    outcomeAssessmentReference: string; matureAndComplete: true; originalDenominatorAndOutcomeLinkageAttested: true;
  }[];
};
export type AnnualStructuredInput = PmeAnnualInput | RtmAnnualInput | LroaAnnualInput
  | SemesterSurveyAnnualInput | TbCohortAnnualInput | LeprosyCohortAnnualInput;
export type RecapStructuredInput = AnnualStructuredInput | SourceAssessmentInput;

// Editable scalars retain invalid/empty text until validation; fixed period slots never become editable.
type LedgerDraft<T> = T extends true ? boolean : T extends number ? number | string
  : T extends (infer Row)[] ? LedgerDraft<Row>[]
    : T extends object ? { [Key in keyof T]: Key extends 'year' | 'month' | 'semester' ? T[Key] : Key extends 'reportStatus' ? T[Key] | '' : LedgerDraft<T[Key]> } : T;
export type RecapLedgerDraft = LedgerDraft<AnnualStructuredInput>;

export interface SavePeriodRecap {
  readonly year: number; readonly endMonth: number; readonly indicatorId: string;
  readonly numerator: number; readonly denominator: number; readonly notes: string;
  readonly confirmed: true; readonly expectedRevision: number;
  readonly structuredInput?: RecapStructuredInput;
}

export interface Do2026Profile {
  readonly definitionId: string;
  readonly sourceRef: string;
  readonly formulaFamily: string;
  readonly measurementUnit: Do2026Unit | null;
  readonly numeratorLabel: string;
  readonly denominatorLabel: string;
  readonly status: 'IMPLEMENTED' | 'CONTEXTUAL' | 'SOURCE_INPUT_ONLY' | 'UNRESOLVED_RULE';
  readonly reason: string | null;
  readonly targetDisplay: string;
  readonly definition: string;
  readonly calculation: string;
  readonly cumulativePolicy?: string;
  readonly cumulativeInstruction?: string;
  readonly annualRecapOnly?: boolean;
  readonly structuredInputKind?: RecapStructuredInput['kind'];
  readonly numeratorInput?: 'INTEGER' | 'DECIMAL' | 'DECIMAL_MONEY' | 'DECIMAL_SCORE' | 'DENOMINATOR_CONTEXT' | 'ESTIMATED' | null;
  readonly denominatorInput?: 'INTEGER' | 'ESTIMATED' | 'DECIMAL_MONEY' | 'DECIMAL_SCORE' | 'DENOMINATOR_CONTEXT' | null;
  readonly observationPeriod?: 'CALENDAR_YEAR' | 'PROFILE_REVIEW_REQUIRED' | SourcePeriodKind;
  readonly assessmentInstruction?: string;
  readonly sourceAssessment?: SourceAssessmentDescriptor;
  readonly localResolution?: LocalResolutionDescriptor;
  readonly inputAvailable?: boolean;
  readonly calculationAvailability?: SourceAssessmentDescriptor['calculationAvailability'];
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
  readonly sourceAssessmentPeriod?: SourceAssessmentPeriod & { label: string; annualComparable: boolean };
  readonly assessmentScope?: SourceAssessmentPeriod & { label: string; annualComparable: boolean };
  readonly localResolutionResult?: LocalResolutionResult;
}

export function measurementText(value: number | null | undefined, unit: string | null | undefined, maximumFractionDigits = 4): string {
  if (value == null) return '-';
  const formatted = new Intl.NumberFormat('id-ID', { maximumFractionDigits }).format(value);
  switch (unit) {
    case 'PERCENT': return `${formatted}%`;
    case 'ITEMS_PER_PRESCRIPTION': return `${formatted} item/resep`;
    case 'COUNT': return `${formatted} jumlah`;
    case 'SCORE': return `${formatted} poin`;
    default: return formatted;
  }
}
