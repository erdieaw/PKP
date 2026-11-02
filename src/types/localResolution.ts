import type { SourceAssessmentPeriod, SourcePeriodKind } from './sourceAssessment';

export type LocalMetricDefinition = {
  readonly key: string; readonly label: string; readonly type: 'RATIO' | 'COUNT' | 'BOOLEAN' | 'POPULATION_RATIO';
  readonly numeratorLabel?: string; readonly denominatorLabel?: string; readonly decimalPlaces: 0 | 4;
  readonly subset: boolean; readonly required: boolean; readonly targetValue?: number;
  readonly sameDenominatorAs?: string; readonly intersectionOf?: readonly string[];
  readonly derivedFrom?: readonly string[]; readonly derivation?: 'ALL' | 'COUNT_TRUE';
};
export type LocalResolutionDescriptor = {
  readonly contractVersion: 'DO_LOCAL_RESOLUTION_V1'; readonly decisionId: string; readonly indicatorId: string;
  readonly definitionId: string; readonly sourceRef: string; readonly label: string;
  readonly metrics: readonly LocalMetricDefinition[]; readonly requiredReferences: readonly string[];
  readonly primaryMetricKey: string | null; readonly periodPolicy: 'SOURCE_PERIOD' | 'MONTH';
  readonly constraints: readonly string[]; readonly period: SourcePeriodKind;
  readonly inputField: 'localResolution'; readonly availability: 'EXPLICIT_OPT_IN_ONLY';
  readonly sourceClassification: 'SOURCE_UNRESOLVED';
  readonly scopeBinding: 'SOURCE_PERIOD_EXACT_AND_LOCAL_PERIOD_WITHIN_SOURCE_AND_SAME_SLOT';
  readonly referenceInstruction: string; readonly requiredAcceptance: readonly string[];
  readonly precision: { readonly maximumInput: number; readonly resultDecimalPlaces: 8; readonly roundingAffectsTarget: false };
  readonly targetPolicy: 'EXPLICIT_DESCRIPTOR_CANDIDATE_ONLY'; readonly performanceScoreAvailable: false;
  readonly aggregation: 'NONE'; readonly approvalStatus: 'PROVISIONAL_USER_ACCEPTED_LOCAL_RESOLUTION';
};
export type LocalMetricInput = { numerator: number; denominator: number } | { count: number } | { satisfied: boolean }
  | { numerator: number; denominator: number; population: number; prevalencePercent: number; populationReference: string; prevalenceReference: string };
export type LocalResolutionInput = {
  contractVersion: 'DO_LOCAL_RESOLUTION_V1'; decisionId: string; indicatorId: string; definitionId: string;
  year: number; territoryReference: string; sourcePeriod: SourceAssessmentPeriod; period: SourceAssessmentPeriod;
  accepted: true; acceptanceReference: string; measurementPolicyReference: string; correctionAuthorityReference: string;
  references: Record<string, string>; metrics: Record<string, LocalMetricInput | null>;
  targetPolicy?: { metricKey: string; value: number; reference: string };
};
export type LocalMetricResult = {
  key: string; label: string; type: LocalMetricDefinition['type']; primary: boolean;
  status: 'MEASURED' | 'INCOMPLETE' | 'ZERO_DENOMINATOR' | 'NOT_YET_DUE' | 'NOT_APPLICABLE' | 'ASSESSMENT_SCOPE_MISMATCH';
  value: number | boolean | null; unit: 'PERCENT' | 'COUNT' | 'BOOLEAN';
  numerator: number | null; denominator: number | null; targetMet: boolean | null;
};
export type LocalResolutionResult = {
  contractVersion: 'DO_LOCAL_RESOLUTION_V1'; decisionId: string; indicatorId: string; definitionId: string;
  year: number; territoryReference: string; metrics: LocalMetricResult[]; primaryMetricKey: string | null;
  originalTarget: unknown; alternativeTarget: (NonNullable<LocalResolutionInput['targetPolicy']> & {
    authority: 'USER_ACCEPTED_LOCAL_POLICY_NOT_SOURCE_APPROVAL'; comparator: 'MIN';
  }) | null;
  sourceConflicts: readonly string[]; sourceStatus: 'SOURCE_UNRESOLVED'; sourcePeriod: SourceAssessmentPeriod;
  assessmentScope: SourceAssessmentPeriod & { label: string; annualComparable: boolean };
  rawNumerator: number; rawDenominator: number; performanceScoreAvailable: false; nilaiKinerja: null;
  assessmentComplete: false; completionScope: 'ARITHMETIC_ONLY'; observationStatus: 'NOT_VERIFIED';
  approvalStatus: 'PROVISIONAL_USER_ACCEPTED_LOCAL_RESOLUTION'; referenceAuthority: 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED';
  measurementPolicyReference: string; correctionAuthorityReference: string; acceptanceReference: string;
  timelinessStatus?: 'NOT_ASSESSED';
};
