import type { LeprosyCohortAnnualInput, LroaAnnualInput, SemesterSurveyAnnualInput, TbCohortAnnualInput } from '../src/analytics/do2026/structured-input';

export const lroa = (): LroaAnnualInput => ({
  kind: 'LROA_ANNUAL', year: 2026, sourceReference: 'SIHEPI/PISP annual register', sourceCoverageComplete: true,
  months: Array.from({ length: 12 }, (_, i) => ({ month: (i + 1) as LroaAnnualInput['months'][number]['month'],
    reportStatus: i >= 9 ? 'COMPLETE' : 'ABSENT', ...(i >= 9 ? { reportReference: `PISP month ${i + 1}` } : {}),
    activityCounts: { rehydrationCounselling: 2, diarrhoeaManagement: 1, communityEducation: 0, dehydrationTreatment: 0, threeHourObservation: 0, oralitPreparation: 0 },
  })),
});
export const survey = (): SemesterSurveyAnnualInput => ({
  kind: 'SEMESTER_SURVEY_ANNUAL', year: 2026, scale: 'DOCUMENTED_100_POINT', scaleReference: 'Documented 100-point scale',
  methodCompatibilityReference: 'Compatible semester methods attested', compatibleMethodsConfirmed: true,
  semesters: [{ semester: 1, value: 80, methodReference: 'Method I', reportReference: 'Report I' }, { semester: 2, value: 84, methodReference: 'Method II', reportReference: 'Report II' }],
});
export const tb = (): TbCohortAnnualInput => ({ kind: 'TB_COHORT_ANNUAL', year: 2026, cohort: {
  type: 'TB_TREATED_RECORDED_REPORTED', year: 2025, cohortReference: '2025 cohort', sourceSystem: 'SITB', sourceReference: 'SITB register 2025',
  originalDenominator: 100, successfulCount: 90, outcomeDefinition: 'CURED_OR_TREATMENT_COMPLETED', outcomeAssessmentReference: 'Linked outcome assessment',
  complete: true, originalDenominatorAndOutcomeLinkageAttested: true, distinctSuccessfulPatientsAttested: true,
} });
export const leprosy = (): LeprosyCohortAnnualInput => ({ kind: 'LEPROSY_COHORT_ANNUAL', year: 2026, cohorts: [
  { type: 'PB', year: 2025, cohortReference: 'PB 2025', sourceSystem: 'SIPK', sourceReference: 'SIPK PB register', originalNewCaseStarts: 10, completedCount: 10, prescribedPeriodReference: 'PB prescribed treatment period', outcomeAssessmentReference: 'PB linked outcomes', matureAndComplete: true, originalDenominatorAndOutcomeLinkageAttested: true },
  { type: 'MB', year: 2024, cohortReference: 'MB 2024', sourceSystem: 'SIPK', sourceReference: 'SIPK MB register', originalNewCaseStarts: 90, completedCount: 72, prescribedPeriodReference: 'MB prescribed treatment period', outcomeAssessmentReference: 'MB linked outcomes', matureAndComplete: true, originalDenominatorAndOutcomeLinkageAttested: true },
] });

export const annualStructuredFixtures = () => [
  { indicatorId: 'K2-R44', structuredInput: lroa(), numerator: 1, denominator: 4, measurement: 25, targetMet: false, definitionId: 'DO26-K2-R43' },
  { indicatorId: 'K1-R39', structuredInput: survey(), numerator: 164, denominator: 2, measurement: 82, targetMet: true, definitionId: 'DO26-K1-R39' },
  { indicatorId: 'K4-R16', structuredInput: tb(), numerator: 90, denominator: 100, measurement: 90, targetMet: true, definitionId: 'DO26-K4-R15' },
  { indicatorId: 'K4-R20', structuredInput: leprosy(), numerator: 82, denominator: 100, measurement: 82, targetMet: false, definitionId: 'DO26-K4-R19' },
];
