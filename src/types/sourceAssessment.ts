import type { LocalResolutionDescriptor, LocalResolutionInput } from './localResolution';

export type SourcePeriodKind = 'ANNUAL' | 'MONTH' | 'QUARTER' | 'AS_OF' | 'SCHOOL_YEAR'
  | 'PREVIOUS_YEAR_DOCUMENT' | 'NEXT_YEAR_DOCUMENT' | 'TWO_YEAR_DOCUMENT_WINDOW'
  | 'PROGRAM_YEAR' | 'COHORT_WINDOW' | 'EXPLICIT_WINDOW';
export type SourceReference = { reference: string; description: string; status: 'AVAILABLE' | 'UNRESOLVED' };
export type SourceAssessmentPeriod = {
  kind: SourcePeriodKind; startDate: string; endDate: string; cutoffDate: string; reference: string;
  month?: number; quarter?: number; asOf?: string; schoolYear?: '2025/2026'; documentYear?: number;
};
export type SourceAssessmentValues =
  | { kind: 'RATIO_AGGREGATE'; numerator: number; denominator: number }
  | { kind: 'COUNT_AGGREGATE'; count: number }
  | { kind: 'DOCUMENT_OBSERVATION'; present: boolean }
  | { kind: 'COMPONENT_OBSERVATIONS'; components: Record<string, { numerator: number; denominator: number; unit: string; reference: string }> }
  | { kind: 'SOURCE_OBSERVATION'; count: number; unit: string; reference: string };
export type SourceVerifiedNihil = {
  kind: 'DINSOS_VERIFIED_NIHIL'; dinsosReference: string; cohortAbsenceReference: string;
  noResidualPriorYearObligationConfirmed: true;
  definitionId: string; year: number; periodStartDate: string; periodEndDate: string;
  cutoffDate: string; territoryReference: string;
};
export type SourceAssessmentInput = {
  kind: 'DO_SOURCE_ASSESSMENT'; contractVersion: 'DO_SOURCE_ASSESSMENT_V1'; definitionId: string; year: number;
  period: SourceAssessmentPeriod; values: SourceAssessmentValues;
  context: Record<string, SourceReference>;
  provenance: {
    territoryReference: string; sourceSnapshotReference: string; numeratorEvidenceReference: string;
    denominatorEvidenceReference: string; eligibilityReference: string; completenessReference: string;
    grainReference: string; numeratorUnit: string; denominatorUnit: string; reconciliationReference: string;
  };
  attestation: {
    status: 'COMPLETE' | 'INCOMPLETE' | 'NOT_YET_DUE' | 'NOT_APPLICABLE';
    sourceCoverageComplete: boolean; eligibilityReviewed: boolean; grainReconciled: boolean; criteriaReferences: string[];
  };
  denominatorContext?: {
    origin: 'INTEGER' | 'ESTIMATED'; methodReference: string; referenceYear: number; territoryReference: string; allocationReference: string;
  };
  parameters?: Record<string, number>;
  exceedReviewReference?: string;
  verifiedNihil?: SourceVerifiedNihil;
  localResolution?: LocalResolutionInput;
};

type SourceDraft<T> = T extends number ? number | string : T extends boolean ? boolean | ''
  : T extends (infer Row)[] ? SourceDraft<Row>[] : T extends object ? { [Key in keyof T]: SourceDraft<T[Key]> } : T;
export type SourceAssessmentDraft = SourceDraft<SourceAssessmentInput>;

export type SourceFormula =
  | { readonly operator: 'RATIO_PERCENT'; readonly numerator: string; readonly denominator: string;
      readonly input: 'INTEGER' | 'DECIMAL_MONEY' | 'DECIMAL_SCORE' | 'DENOMINATOR_CONTEXT' | 'ESTIMATED';
      readonly numeratorSubset: boolean | 'CONTEXT_REQUIRED'; readonly fixedDenominator?: number;
      readonly denominatorBasis?: 'REGISTER' | 'SASARAN' | 'ESTIMATE' | 'VISITS' | 'INVENTORY' | 'PLAN';
      readonly documentedFactor?: number; readonly documentedFactors?: readonly number[];
      readonly denominatorDerivation?: 'TB_DETECTION_TARGET_TIMES_FACTORS' | 'REGIONAL_POPULATION_ALLOCATION' | 'INDEX_CASES_TIMES_CONTACT_FACTOR' }
  | { readonly operator: 'COUNT'; readonly numerator: string }
  | { readonly operator: 'DOCUMENT_PRESENCE'; readonly numerator: string; readonly presentValue: 1; readonly presentScore: 100 }
  | { readonly operator: 'COMPONENTS_ONLY'; readonly components: readonly (
      { readonly key: string; readonly numerator: string; readonly denominator: string; readonly input: 'INTEGER' | 'DECIMAL_MONEY' }
      | { readonly key: string; readonly label: string; readonly unit: 'SOURCE_UNRESOLVED' | 'COUNT_DOCUMENT' })[] }
  | { readonly operator: 'UNRESOLVED_MONTH_MULTIPLIER'; readonly numerator: string; readonly denominator: string; readonly multiplier: 12;
      readonly candidates: readonly ['N_DIV_D_TIMES_12_TIMES_100', 'N_DIV_D_TIMES_12_DENOMINATOR_TIMES_100'] };

export interface SourceAssessmentDescriptor {
  readonly definitionId: string; readonly sourceRef: string; readonly kind: string;
  readonly readiness: 'CONTEXT_REQUIRED' | 'MEASUREMENT_ONLY' | 'SOURCE_CONFLICT';
  readonly formula: SourceFormula | null;
  readonly target: { readonly raw: string | number; readonly excelNumberFormat: string; readonly value: number | null;
    readonly unit: 'PERCENT' | 'COUNT' | 'DOCUMENT'; readonly comparator: 'MIN' | 'MAX' | 'LT' | 'GT' | 'UNRESOLVED';
    readonly basis: 'LITERAL_MINIMUM' | 'TECHNICAL_MINIMUM' | 'LITERAL_MAXIMUM' | 'UNRESOLVED' };
  readonly period: SourcePeriodKind; readonly criteria: readonly string[];
  readonly thresholds?: Readonly<Record<string, number | readonly number[]>>;
  readonly applicability?: string; readonly unresolved: readonly string[];
  readonly calculationQuote?: string; readonly formulaRaw?: string; readonly calculability?: string;
  readonly zeroException?: { readonly kind: 'DINSOS_VERIFIED_NIHIL'; readonly measurement: null; readonly targetMet: true; readonly numericScore: null };
  readonly denominatorRule: null | {
    readonly kind: 'CALENDAR_MONTH_DAYS'; readonly inputs: readonly string[]; readonly unit: 'DAY';
    readonly sourceRef: string; readonly sourceQuote: string; readonly submittedDenominator: 'MUST_EQUAL_SERVER_DERIVATION';
  } | { readonly kind: 'FIXED'; readonly value: number; readonly sourceRef: string; readonly sourceQuote: string }
    | { readonly kind: 'SOURCE_PARAMETERS'; readonly inputs: readonly string[]; readonly sourceRef: string; readonly sourceQuote: string;
      readonly arithmetic: 'EXACT_SCALED_INTEGER'; readonly maximumDecimalPlaces: 4; readonly submittedDenominator: 'MUST_EQUAL_SERVER_DERIVATION' };
  readonly periodWindowRule: null | {
    readonly kind: 'CURRENT_AND_PREVIOUS_ASSESSMENT_YEAR_TO_CUTOFF';
    readonly authority: 'PROVISIONAL_TECHNICAL_CONVENTION_NOT_SOURCE_MANDATED';
    readonly startDateRule: 'JANUARY_1_OF_YEAR_MINUS_ONE'; readonly endDateRule: 'CUTOFF_DATE';
    readonly sourceRef: string; readonly sourceQuote: string;
  };
  readonly verifiedNihilRule: null | {
    readonly kind: 'DINSOS_VERIFIED_NIHIL'; readonly available: boolean; readonly inputField: 'verifiedNihil';
    readonly measurement: null; readonly targetMet: true; readonly numericScore: null;
    readonly requiredFields: readonly string[]; readonly matchingFields: readonly string[];
    readonly requiresCompleteContext: true; readonly requiresZeroNumeratorAndDenominator: true;
    readonly noResidualPriorYearObligationConfirmed: true; readonly referenceInstruction: string;
    readonly sourceRef: string; readonly sourceQuote: string; readonly referenceAuthority: 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED';
  };
  readonly contractVersion: 'DO_SOURCE_ASSESSMENT_V1'; readonly inputKind: 'DO_SOURCE_ASSESSMENT';
  readonly expectedValueKind: SourceAssessmentValues['kind']; readonly requiredParameters: readonly string[];
  readonly requiredContext: readonly { readonly key: string; readonly label: string; readonly input: 'REFERENCED_ASSESSMENT' }[];
  readonly calculationAvailability: 'AVAILABLE_WITH_CONTEXT' | 'SOURCE_UNRESOLVED';
  readonly sourceDefinition?: { readonly indicatorId: string; readonly definitionId: string; readonly sourceRef: string;
    readonly definition: string; readonly calculation: string; readonly notes: string;
    readonly target: { readonly raw: string | number | null; readonly excel_number_format: string }; readonly formulaFamily: string };
  readonly referenceAuthority: 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED'; readonly periodInstruction: string;
  readonly performanceScoreAvailable: false;
  readonly localResolution?: LocalResolutionDescriptor;
}
