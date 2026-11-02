import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EXPANDED_MANAGEMENT_CONTRACT, EXPANDED_MANAGEMENT_DECISIONS, type ManagementDecision } from '../src/analytics/do2026/expanded-management';

// Independently transcribed S1 oracles. These tuples never read declarations to generate expectations.
// id, DO row, measurement kind, period, operator, target value, readiness, N, D, arithmetic result.
// Null arithmetic is deliberate: these declaration fixtures are separate from runtime evaluator tests.
export const EXPANDED_MANAGEMENT_FIXTURES = [
  ['K1-R9', 9, 'DOCUMENT', 'PREVIOUS_YEAR_DOCUMENT', 'DOCUMENT_PRESENCE', 1, 'SOURCE_CONFLICT', 1, null, null],
  ['K1-R10', 10, 'COMPOSITE', 'ANNUAL', 'COMPONENTS_ONLY', 75, 'SOURCE_CONFLICT', null, null, null],
  ['K1-R11', 11, 'FREQUENCY', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 9, 12, 75],
  ['K1-R13', 13, 'RATIO', 'QUARTER', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 2, 3, 66.66666666666667],
  ['K1-R15', 15, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 80, 'CONTEXT_REQUIRED', 80, 100, 80],
  ['K1-R16', 16, 'CHECKLIST', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 3, 4, 75],
  ['K1-R19', 19, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 85, 'CONTEXT_REQUIRED', 17, 20, 85],
  ['K1-R20', 20, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 85, 'CONTEXT_REQUIRED', 17, 20, 85],
  ['K1-R21', 21, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 19, 20, 95],
  ['K1-R22', 22, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'MEASUREMENT_ONLY', 2, 1, 200],
  ['K1-R23', 23, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 85, 'CONTEXT_REQUIRED', 17, 20, 85],
  ['K1-R26', 26, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 60, 'CONTEXT_REQUIRED', 6, 10, 60],
  ['K1-R27', 27, 'COMPOSITE', 'ANNUAL', 'RATIO_PERCENT', 82, 'CONTEXT_REQUIRED', 3, 4, 75],
  ['K1-R28', 28, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 60, 'CONTEXT_REQUIRED', 12, 20, 60],
  ['K1-R31', 31, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 60, 'CONTEXT_REQUIRED', 6, 10, 60],
  ['K1-R33', 33, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 90, 'CONTEXT_REQUIRED', 36, 40, 90],
  ['K1-R34', 34, 'TIME_AVAILABILITY', 'MONTH', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 29, 31, 93.54838709677419],
  ['K1-R35', 35, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 80, 'CONTEXT_REQUIRED', 12, 15, 80],
  ['K1-R38', 38, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 4, 5, 80],
  ['K1-R43', 43, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 5, 6, 83.33333333333333],
  ['K1-R44', 44, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 8, 10, 80],
  ['K1-R45', 45, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 13, 16, 81.25],
  ['K1-R47', 47, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 4, 5, 80],
  ['K1-R48', 48, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 9, 12, 75],
  ['K1-R49', 49, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 3, 4, 75],
  ['K1-R51', 51, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 5, 5, 100],
  ['K1-R52', 52, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 10, 12, 83.33333333333333],
  ['K1-R53', 53, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'SOURCE_CONFLICT', 7, 9, 77.77777777777777],
  ['K1-R59', 59, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 5, 6, 83.33333333333333],
  ['K1-R60', 60, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 7, 8, 87.5],
  ['K1-R61', 61, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 4, 5, 80],
  ['K1-R63', 63, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 5, 7, 71.42857142857143],
  ['K1-R64', 64, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 6, 8, 75],
  ['K1-R65', 65, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 4, 6, 66.66666666666667],
  ['K1-R69', 70, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 95, 'CONTEXT_REQUIRED', 19, 20, 95],
  ['K1-R71', 72, 'COMPOSITE', 'ANNUAL', 'COMPONENTS_ONLY', 100, 'MEASUREMENT_ONLY', null, null, null],
  ['K1-R74', 75, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 80, 'CONTEXT_REQUIRED', 8, 10, 80],
  ['K1-R75', 76, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 20, 'CONTEXT_REQUIRED', 2, 10, 20],
  ['K1-R79', 80, 'RATIO', 'MONTH', 'RATIO_PERCENT', 50, 'CONTEXT_REQUIRED', 5, 10, 50],
  ['K1-R81', 82, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 20, 'CONTEXT_REQUIRED', 1, 5, 20],
  ['K1-R82', 83, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 32, 'CONTEXT_REQUIRED', 8, 25, 32],
  ['K1-R83', 84, 'COUNT', 'ANNUAL', 'COUNT', 50, 'MEASUREMENT_ONLY', 12, null, 12],
  ['K1-R84', 85, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 22, 'CONTEXT_REQUIRED', 11, 50, 22],
  ['K1-R88', 89, 'FREQUENCY', 'ANNUAL', 'UNRESOLVED_MONTH_MULTIPLIER', 50, 'SOURCE_CONFLICT', null, null, null],
  ['K1-R89', 90, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 35, 'CONTEXT_REQUIRED', 7, 20, 35],
  ['K1-R100', 101, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 30, 'CONTEXT_REQUIRED', 3, 10, 30],
  ['K1-R101', 102, 'FREQUENCY', 'ANNUAL', 'UNRESOLVED_MONTH_MULTIPLIER', 40, 'SOURCE_CONFLICT', null, null, null],
  ['K1-R102', 103, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 10, 'CONTEXT_REQUIRED', 1, 10, 10],
  ['K1-R103', 104, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 10, 'CONTEXT_REQUIRED', 1, 10, 10],
  ['K1-R105', 106, 'COMPOSITE', 'ANNUAL', 'RATIO_PERCENT', 25, 'CONTEXT_REQUIRED', 1, 5, 20],
  ['K1-R113', 114, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 58, 'CONTEXT_REQUIRED', 29, 50, 58],
  ['K1-R114', 115, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 77, 'CONTEXT_REQUIRED', 77, 100, 77],
  ['K1-R115', 116, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 65, 'CONTEXT_REQUIRED', 13, 20, 65],
  ['K1-R118', 119, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 3, 2, 150],
  ['K1-R119', 120, 'COMPOSITE', 'ANNUAL', 'RATIO_PERCENT', 75, 'CONTEXT_REQUIRED', 3, 4, 75],
  ['K1-R120', 121, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 70, 'CONTEXT_REQUIRED', 7, 10, 70],
  ['K1-R121', 122, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 50, 'CONTEXT_REQUIRED', 1, 3, 33.333333333333336],
  ['K1-R122', 123, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 19, 'CONTEXT_REQUIRED', 19, 100, 19],
  ['K1-R124', 125, 'COMPOSITE', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 4, 4, 100],
  ['K1-R126', 127, 'COMPOSITE', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 5, 6, 83.33333333333333],
  ['K1-R128', 129, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 3, 4, 75],
  ['K1-R129', 130, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 4, 5, 80],
  ['K1-R130', 131, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 2, 4, 50],
  ['K1-R131', 132, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 7, 8, 87.5],
  ['K1-R132', 133, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 9, 10, 90],
  ['K1-R133', 134, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'MEASUREMENT_ONLY', 3, 4, 75],
  ['K1-R134', 135, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'MEASUREMENT_ONLY', 4, 5, 80],
  ['K1-R136', 137, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 90, 'CONTEXT_REQUIRED', 9, 10, 90],
  ['K1-R137', 138, 'CHECKLIST', 'TWO_YEAR_DOCUMENT_WINDOW', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 8, 10, 80],
  ['K1-R138', 139, 'CHECKLIST', 'TWO_YEAR_DOCUMENT_WINDOW', 'RATIO_PERCENT', 90, 'CONTEXT_REQUIRED', 3, 10, 30],
  ['K1-R139', 140, 'CHECKLIST', 'ANNUAL', 'RATIO_PERCENT', 80, 'SOURCE_CONFLICT', null, null, null],
  ['K1-R141', 142, 'SCORE_RATIO', 'AS_OF', 'RATIO_PERCENT', 90, 'CONTEXT_REQUIRED', 67.5, 75, 90],
  ['K1-R142', 143, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 3, 2, 150],
  ['K1-R143', 144, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 5, 4, 125],
  ['K1-R145', 146, 'COUNT', 'NEXT_YEAR_DOCUMENT', 'COUNT', null, 'MEASUREMENT_ONLY', 1, null, 1],
  ['K1-R146', 147, 'FINANCIAL_RATIO', 'QUARTER', 'RATIO_PERCENT', 100, 'MEASUREMENT_ONLY', 1100.55, 1000.5, 110],
  ['K1-R147', 148, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 6, 5, 120],
  ['K1-R148', 149, 'SNAPSHOT', 'AS_OF', 'RATIO_PERCENT', 100, 'CONTEXT_REQUIRED', 9, 10, 90],
  ['K1-R149', 150, 'FINANCIAL_RATIO', 'AS_OF', 'RATIO_PERCENT', 100, 'MEASUREMENT_ONLY', 1100.55, 1000.5, 110],
  ['K1-R150', 151, 'FINANCIAL_RATIO', 'AS_OF', 'RATIO_PERCENT', 100, 'MEASUREMENT_ONLY', 900.45, 1000.5, 90],
] as const;

// Additional executable contract checks plus portable scenarios for the future coordinator evaluator.
// expected fields are literal source-derived or explicitly provisional outcomes, not evaluator results.
export const MANAGEMENT_CONTEXT_FIXTURES = [
  { id: 'K1-R9', input: { assessmentYear: 2026, documentPlanningYear: 2027, completionYear: 2025, feedbackMonth: 11, qualifyingDocumentCount: 1 }, expected: { documentMeasurement: 1, explicitPresentScore: 100, temporalValidity: 'UNRESOLVED' } },
  { id: 'K1-R10', input: { realizedActivities: 3, plannedActivities: 4, budgetRealized: 40, budgetPlanned: 100 }, expected: { activityPercent: 75, budgetPercent: 40, combinedMeasurement: null, targetMet: null } },
  { id: 'K1-R11', input: { completeMonthlyMinutes: 9, meetingsInOneMonth: 4 }, expected: { denominator: 12, measurement: 75, extraMeetingsDoNotReplaceMissingMonths: true } },
  { id: 'K1-R13', input: { q1UnpreparedAndEvidenced: true, q2Complete: true, q3Complete: true, q4Complete: true }, expected: { numerator: 3, denominator: 3, measurement: 100 } },
  { id: 'K1-R16', input: { decree: 1, sop: 1, recording: 1, reporting: 1, available: 3 }, expected: { denominator: 4, measurement: 75 } },
  { id: 'K1-R19', input: { staffCount: 1, profileChangeUpdated: true, laterTrainingChangeNotUpdated: true }, expected: { qualifiedStaff: 0, measurement: 0 } },
  { id: 'K1-R21', input: { activeProfessionStaff: 1, strActive: true, sipActive: false }, expected: { numerator: 0, denominator: 1, measurement: 0 } },
  { id: 'K1-R22', input: { qualifyingDoctors: 2 }, expected: { denominator: 1, measurement: 200, targetMet: null } },
  { id: 'K1-R27', input: { updates: 4, validated: 4, june30SpaPercent: 59, december31SpaPercent: 80, bothDueDateValidations: true }, expected: { measurement: 100, sourceCriteriaMet: false } },
  { id: 'K1-R27', input: { updates: 2, validated: 2, june30SpaPercent: 60, december31SpaPercent: 60, bothDueDateValidations: false }, expected: { measurement: 100, sourceCriteriaMet: false } },
  { id: 'K1-R31', input: { scheduledDocumented: 6, totalIncludingUnscheduled: 10 }, expected: { denominator: 10, measurement: 60 } },
  { id: 'K1-R33', input: { availableNomenclatures: 36, availableAlternativeProducts: 52 }, expected: { numerator: 36, denominator: 40, measurement: 90 } },
  { id: 'K1-R34', input: { year: 2026, month: 1, sixVaccinesAvailableDays: 31, seventhAvailableDays: 29 }, expected: { completeDays: 29, denominator: 31, measurement: 93.54838709677419 } },
  { id: 'K1-R34', input: { year: 2028, month: 2, allSevenCompleteDays: 29 }, expected: { denominator: 29, measurement: 100 } },
  { id: 'K1-R35', input: { availableOrdinarySlots: 10, lipidPanelSubstitutesCholesterolAndTriglyceride: true }, expected: { numerator: 12, denominator: 15, measurement: 80 } },
  { id: 'K1-R43', input: { decree: true, fiveYearPlan: true, annualPlan: false, kak: true, sop: true, forms: true }, expected: { requiredDocumentsAtLeast: 6, complete: false } },
  { id: 'K1-R53', input: { sevenNamedActivitiesReported: true, allRegisteredReports: true }, expected: { sourceEighthActivity: 'UNRESOLVED', targetMet: null } },
  { id: 'K1-R71', input: { income: 80, incomeTarget: 100, expenditure: 300, expenditureBudget: 300 }, expected: { incomePercent: 80, expenditurePercent: 100, combinedMeasurement: null, targetMet: null } },
  { id: 'K1-R75', input: { networkCount: 10, electronic: 8, electronicAndSatuSehat: 2 }, expected: { numerator: 2, denominator: 10, measurement: 20 } },
  { id: 'K1-R79', input: { month: 2, activeNetworks: 10, reportsInJanuaryOnly: 10, reportsInFebruary: 0 }, expected: { numerator: 0, denominator: 10, measurement: 0 } },
  { id: 'K1-R81', input: { pantiSehatCount: 0, completeAbsenceEvidence: true }, expected: { applicability: 'EXCLUDE_IF_NO_PANTI_SEHAT', measurement: null, numericScore: null } },
  { id: 'K1-R83', input: { distinctHattraCoached: 12, allHattraInAnotherIndicator: 24 }, expected: { measurement: 12, measurementUnit: 'COUNT', percent: null, targetMet: null } },
  { id: 'K1-R88', input: { numerator: 1, denominator: 2 }, expected: { literalLeftAssociativePercent: 600, denominatorTimesTwelvePercent: 4.166666666666667, selectedMeasurement: null } },
  { id: 'K1-R89', input: { asOf: '2026-10-31', members: 10, exerciseByMonth: [1, 1, 0, 1, 1, 1] }, expected: { eligible: false } },
  { id: 'K1-R100', input: { coachedGovernmentSubdistrictOffices: 3, allOffices: 10, governmentSubdistrictOffices: 4 }, expected: { denominator: 10, measurement: 30 } },
  { id: 'K1-R101', input: { cadres: 1, workers: 11, monthlyActivityPresent: true }, expected: { cadrePercent: 9.090909090909092, activeCriteriaMet: false, selectedMeasurement: null } },
  { id: 'K1-R102', input: { femaleWorkers: 50, gp2spPercent: 40, companyClass: 'MEDIUM' }, expected: { eligible: true, qualifies: true, boundaryDecision: 'D103_E103_MINIMUM_50' } },
  { id: 'K1-R102', input: { femaleWorkers: 49, gp2spPercent: 100, companyClass: 'LARGE' }, expected: { eligible: false } },
  { id: 'K1-R103', input: { workers: 100, highRisk: false }, expected: { eligible: false, boundaryDecision: 'E104_GREATER_THAN_100_OR_HIGH_RISK' } },
  { id: 'K1-R103', input: { workers: 100, highRisk: true }, expected: { eligible: true } },
  { id: 'K1-R105', input: { referralMeetings: 1, allNetworkMeetings: 1 }, expected: { measurement: 100, fourMeetingContextMet: false } },
  { id: 'K1-R114', input: { metCriteria: 8, totalCriteria: 10 }, expected: { educationQualifies: true } },
  { id: 'K1-R115', input: { metCriteria: 11, totalCriteria: 13 }, expected: { ponpesQualifies: true } },
  { id: 'K1-R115', input: { allPonpes: 3, assessedPonpes: 0, numerator: 0 }, expected: { applicability: 'NOT_AUTOMATICALLY_EXCLUDED', measurement: null } },
  { id: 'K1-R118', input: { distinctIntervenedAtLeastTwice: 3, assessedPonpes: 2, allPonpes: 3 }, expected: { measurement: 150, numeratorSubset: false } },
  { id: 'K1-R119', input: { annualOpenings: 8, lifeCycleGroupsServed: 6, cadresAtAssessment: 5 }, expected: { qualifies: true } },
  { id: 'K1-R119', input: { annualOpenings: 12, lifeCycleGroupsServed: 6, cadresAtAssessment: 4 }, expected: { qualifies: false } },
  { id: 'K1-R120', input: { allPonpes: 3, poskestren: 0 }, expected: { applicability: 'NOT_AUTOMATICALLY_EXCLUDED', measurement: null } },
  { id: 'K1-R121', input: { schools: 3, oneToOneSbhBases: 1, qualifiedBases: 1, schoolsWithoutSbh: 2 }, expected: { numerator: 1, denominator: 3, measurement: 33.333333333333336 } },
  { id: 'K1-R121', input: { schools: 0, absenceEvidenced: true }, expected: { applicability: 'EXCLUDE_IF_NO_SCHOOL_INCLUDE_SCHOOLS_WITHOUT_SBH', measurement: null } },
  { id: 'K1-R124', input: { unitsWithKie: 4, totalUnits: 4, distinctInstallationLocations: 9 }, expected: { measurement: 100, sourceCriteriaMet: false } },
  { id: 'K1-R126', input: { posyandu: 5, sbh: 1, poskestren: 0, missingPoskestrenEvidenced: true, measuredAndCoached: 5 }, expected: { denominator: 6, measurement: 83.33333333333333 } },
  { id: 'K1-R128', input: { firstEightCriteriaMet: true, smokingAreaPresent: true }, expected: { qualifies: false } },
  { id: 'K1-R133', input: { firstEightCriteriaMet: true, additionalSmokingAreaPresent: true }, expected: { coreCriteriaMet: true, additionalCriterionMet: true, officialTargetMet: null } },
  { id: 'K1-R137', input: { allStaff: 10, asnWithTwoYearSkp: 8 }, expected: { denominator: 10, measurement: 80 } },
  { id: 'K1-R138', input: { allStaff: 10, functionalAsnWithTwoYearPak: 3 }, expected: { denominator: 10, measurement: 30 } },
  { id: 'K1-R139', input: { violatingEmployees: 2, completePackages: 1, availableFiles: 7 }, expected: { fileCountCandidatePercent: 350, packageCandidatePercent: 50, selectedMeasurement: null } },
  { id: 'K1-R141', input: { documentedScore: 67.5, documentedMaximum: 75, aspectsListed: 24 }, expected: { denominator: 75, measurement: 90 } },
  { id: 'K1-R142', input: { approvedReports: 3, reportTarget: 2 }, expected: { measurement: 150, numeratorSubset: false } },
  { id: 'K1-R143', input: { approvedReports: 5, reportTarget: 4, spmIndicators: 12 }, expected: { denominator: 4, measurement: 125 } },
  { id: 'K1-R145', input: { assessmentYear: 2026, documentPlanningYear: 2027, distinctDocuments: 1 }, expected: { measurement: 1, percent: null, targetMet: null } },
  { id: 'K1-R146', input: { quarter: 2, recordedMoney: 1100.55, lraMoney: 1000.5 }, expected: { measurement: 110, targetMet: null } },
  { id: 'K1-R147', input: { distinctCards: 6, rooms: 5 }, expected: { measurement: 120, numeratorSubset: false } },
  { id: 'K1-R149', input: { recordedMoney: 1100.55, lraMoney: 1000.5 }, expected: { measurement: 110, targetMet: null } },
  { id: 'K1-R150', input: { physicalBaMoney: 900.45, stockCardMoney: 1000.5 }, expected: { measurement: 90, targetMet: null } },
] as const;

export const MANAGEMENT_FIXED_DENOMINATOR_ORACLES = {
  'K1-R11': 12, 'K1-R22': 1, 'K1-R33': 40, 'K1-R35': 15,
} as const;

export const MANAGEMENT_UNRESOLVED_COMPARATOR_ORACLES = [
  'K1-R10', 'K1-R22', 'K1-R53', 'K1-R71', 'K1-R83', 'K1-R88', 'K1-R101',
  'K1-R133', 'K1-R134', 'K1-R139', 'K1-R145', 'K1-R146', 'K1-R149', 'K1-R150',
] as const;

const decisions: Readonly<Record<string, ManagementDecision>> = EXPANDED_MANAGEMENT_DECISIONS;

test('management source inventory contains exactly the 80 independently enumerated source identities', () => {
  assert.equal(EXPANDED_MANAGEMENT_FIXTURES.length, 80);
  const ids = EXPANDED_MANAGEMENT_FIXTURES.map(([id]) => id).sort();
  assert.equal(new Set(ids).size, 80);
  assert.deepEqual(Object.keys(decisions).sort(), ids);
  assert.equal(EXPANDED_MANAGEMENT_CONTRACT.status, 'PROVISIONAL_SOURCE_DECLARATIONS');
});

for (const [id, row, kind, period, operator, target, readiness, numerator, denominator, measurement] of EXPANDED_MANAGEMENT_FIXTURES) {
  test(`${id}: independent S1 row, kind, period, operator and target oracle`, () => {
    const decision = decisions[id]!;
    assert.equal(decision.definitionId, `DO26-K1-R${row}`);
    assert.equal(decision.sourceRef, `S1:KLASTER I!A${row}:H${row}`);
    assert.equal(decision.kind, kind);
    assert.equal(decision.period, period);
    assert.equal(decision.formula.operator, operator);
    assert.equal(decision.target.value, target);
    assert.equal(decision.readiness, readiness);
    assert.ok(decision.requiredContext.length > 0);
    assert.ok(decision.criteria.length > 0);
    if (operator === 'RATIO_PERCENT' && numerator !== null && denominator !== null && measurement !== null) {
      // Arithmetic oracle consistency only, not a claim that a runtime contract interpreter is tested.
      assert.ok(Math.abs(100 * numerator / denominator - measurement) < 1e-10);
      if (decision.formula.operator === 'RATIO_PERCENT') {
        if (decision.formula.fixedDenominator !== undefined) assert.equal(denominator, decision.formula.fixedDenominator);
        if (numerator > denominator) assert.equal(decision.formula.numeratorSubset, false);
      }
    }
    if (operator === 'COUNT') assert.equal(numerator, measurement);
    if (readiness !== 'CONTEXT_REQUIRED') assert.ok(decision.unresolved.length > 0);
  });
}

test('every raw target, format and source identity matches the static S1 transcription, without using review labels', () => {
  const sources = JSON.parse(readFileSync(new URL('../src/analytics/do2026/source.json', import.meta.url), 'utf8')) as {
    indicatorId: string; definitionId: string; sourceRef: string;
    target: { raw: string | number; excel_number_format: string };
  }[];
  for (const [id] of EXPANDED_MANAGEMENT_FIXTURES) {
    const source = sources.find((candidate) => candidate.indicatorId === id)!;
    assert.ok(source, id);
    const decision = decisions[id]!;
    assert.equal(decision.definitionId, source.definitionId, id);
    assert.equal(decision.sourceRef, source.sourceRef, id);
    assert.equal(decision.target.raw, source.target.raw, id);
    assert.equal(decision.target.excelNumberFormat, source.target.excel_number_format, id);
  }
});

test('only four ratios have a literal fixed denominator; document inventories never infer file counts', () => {
  const actual = Object.fromEntries(Object.entries(decisions).flatMap(([id, decision]) =>
    decision.formula.operator === 'RATIO_PERCENT' && decision.formula.fixedDenominator !== undefined
      ? [[id, decision.formula.fixedDenominator]] : []));
  assert.deepEqual(actual, MANAGEMENT_FIXED_DENOMINATOR_ORACLES);
});

test('unresolved target comparators are explicit, never a normalized performance score', () => {
  assert.deepEqual(Object.entries(decisions).filter(([, r]) => r.target.comparator === 'UNRESOLVED').map(([id]) => id).sort(), [...MANAGEMENT_UNRESOLVED_COMPARATOR_ORACLES].sort());
  for (const id of MANAGEMENT_UNRESOLVED_COMPARATOR_ORACLES) assert.ok(decisions[id]!.unresolved.length > 0, id);
  assert.equal(decisions['K1-R83']!.formula.operator, 'COUNT');
  assert.equal(decisions['K1-R145']!.target.value, null);
  assert.deepEqual(decisions['K1-R9']!.formula, { operator: 'DOCUMENT_PRESENCE', numerator: 'RUK tahunan hasil feedback Dinkes pada November N-1', presentValue: 1, presentScore: 100 });
});

test('only an explicit source operator is labelled a literal minimum', () => {
  assert.deepEqual(Object.entries(decisions).filter(([, r]) => r.target.basis === 'LITERAL_MINIMUM').map(([id]) => id), ['K1-R26']);
  assert.equal(decisions['K1-R26']!.target.comparator, 'MIN');
  assert.equal(decisions['K1-R26']!.target.raw, '\u226560 %');
  assert.equal(decisions['K1-R9']!.target.basis, 'TECHNICAL_MINIMUM');
  for (const [id, { target }] of Object.entries(decisions)) {
    assert.equal(target.comparator === 'UNRESOLVED', target.basis === 'UNRESOLVED', id);
  }
});

test('decimal money and decimal instrument scores are not integer entity counts', () => {
  for (const id of ['K1-R146', 'K1-R149', 'K1-R150']) {
    const formula = decisions[id]!.formula;
    assert.equal(formula.operator, 'RATIO_PERCENT');
    if (formula.operator !== 'RATIO_PERCENT') throw new Error(id);
    assert.equal(formula.input, 'DECIMAL_MONEY');
    assert.equal(formula.numeratorSubset, false);
  }
  const sepekan = decisions['K1-R141']!.formula;
  assert.equal(sepekan.operator, 'RATIO_PERCENT');
  if (sepekan.operator !== 'RATIO_PERCENT') throw new Error('SEPEKAN ratio missing');
  assert.equal(sepekan.input, 'DECIMAL_SCORE');
  assert.equal(sepekan.fixedDenominator, undefined);
});

test('financial component ratios and RPK unit candidates remain separate without an invented mean', () => {
  const finance = decisions['K1-R71']!.formula;
  const rpk = decisions['K1-R10']!.formula;
  assert.equal(finance.operator, 'COMPONENTS_ONLY');
  assert.equal(rpk.operator, 'COMPONENTS_ONLY');
  if (finance.operator !== 'COMPONENTS_ONLY' || rpk.operator !== 'COMPONENTS_ONLY') throw new Error('components missing');
  assert.deepEqual(finance.components.map(({ key, input }) => [key, input]), [['income', 'DECIMAL_MONEY'], ['expenditure', 'DECIMAL_MONEY']]);
  assert.deepEqual(rpk.components.map(({ key, input }) => [key, input]), [['activityCountCandidate', 'INTEGER'], ['budgetRealizationCandidate', 'DECIMAL_MONEY']]);
  assert.equal('aggregate' in finance, false);
});

test('snapshot observations require an explicit asOf, not annual pooling or automatic December selection', () => {
  for (const [id, decision] of Object.entries(decisions)) {
    if (decision.period === 'AS_OF') assert.ok(decision.requiredContext.includes('asOf'), id);
  }
  assert.equal(decisions['K1-R34']!.period, 'MONTH');
  assert.equal(decisions['K1-R79']!.period, 'MONTH');
  assert.equal(decisions['K1-R146']!.period, 'QUARTER');
  assert.equal(decisions['K1-R9']!.period, 'PREVIOUS_YEAR_DOCUMENT');
  assert.equal(decisions['K1-R145']!.period, 'NEXT_YEAR_DOCUMENT');
});

test('source-specific exclusions never generalize zero denominator to a passing score', () => {
  const expected = {
    'K1-R13': 'EXCLUDE_UNPREPARED_Q1_ONLY', 'K1-R81': 'EXCLUDE_IF_NO_PANTI_SEHAT',
    'K1-R115': 'EXCLUDE_IF_NO_PONPES', 'K1-R118': 'EXCLUDE_IF_NO_PONPES', 'K1-R120': 'EXCLUDE_IF_NO_PONPES',
    'K1-R121': 'EXCLUDE_IF_NO_SCHOOL_INCLUDE_SCHOOLS_WITHOUT_SBH',
    'K1-R126': 'EXCLUDE_ABSENT_POSKESTREN_SBH_COMPONENTS_ONLY',
  };
  assert.deepEqual(Object.fromEntries(Object.entries(decisions).filter(([, r]) => r.applicability).map(([id, r]) => [id, r.applicability])), expected);
  assert.match(EXPANDED_MANAGEMENT_CONTRACT.zeroPolicy, /not 100/);
});

test('source thresholds distinguish count, calendar, assessment and denominator roles', () => {
  assert.deepEqual(decisions['K1-R11']!.thresholds, { monthlySlots: 12, requiredMinutesElements: 8 });
  assert.deepEqual(decisions['K1-R27']!.thresholds, { minimumSpaPercent: 60, minimumUpdates: 2, minimumValidations: 2, dueMonths: [6, 12], dueDays: [30, 31] });
  assert.deepEqual(decisions['K1-R34']!.thresholds, { requiredVaccineTypesPerDay: 7 });
  assert.deepEqual(decisions['K1-R89']!.thresholds, { minimumMembers: 10, minimumExercisePerMonth: 1, consecutiveMonths: 6 });
  assert.deepEqual(decisions['K1-R101']!.thresholds, { minimumCadrePercent: 10, minimumActivitiesPerMonth: 1, requiredCriteria: 4 });
  assert.deepEqual(decisions['K1-R102']!.thresholds, { minimumFemaleWorkersInclusive: 50, minimumSelfAssessmentPercent: 40 });
  assert.deepEqual(decisions['K1-R103']!.thresholds, { workerCountExclusive: 100 });
  assert.deepEqual(decisions['K1-R105']!.thresholds, { minimumReferralMeetings: 1, annualNetworkMeetings: 4 });
  assert.deepEqual(decisions['K1-R114']!.thresholds, { minimumPhbsCriteria: 8, totalPhbsCriteria: 10, anthropometryIntervalMonths: 6 });
  assert.deepEqual(decisions['K1-R115']!.thresholds, { minimumPhbsCriteria: 11, totalPhbsCriteria: 13, anthropometryIntervalMonths: 6 });
  assert.deepEqual(decisions['K1-R118']!.thresholds, { minimumInterventionsPerPonpes: 2, requiredPhbsCoverage: 13 });
  assert.deepEqual(decisions['K1-R119']!.thresholds, { minimumAnnualOpenings: 8, lifeCycleGroups: 6, minimumCadres: 5 });
  assert.deepEqual(decisions['K1-R124']!.thresholds, { minimumDistinctInstallationLocations: 10 });
});

test('unparenthesized x12 candidates stay typed and unresolved, never evaluated from source text', () => {
  for (const id of ['K1-R88', 'K1-R101']) {
    const formula = decisions[id]!.formula;
    assert.equal(formula.operator, 'UNRESOLVED_MONTH_MULTIPLIER');
    if (formula.operator !== 'UNRESOLVED_MONTH_MULTIPLIER') throw new Error(id);
    assert.equal(formula.multiplier, 12);
    assert.deepEqual(formula.candidates, ['N_DIV_D_TIMES_12_TIMES_100', 'N_DIV_D_TIMES_12_DENOMINATOR_TIMES_100']);
  }
});

test('portable context fixture expected values are not computed from implementation declarations', () => {
  assert.equal(MANAGEMENT_CONTEXT_FIXTURES.length, 55);
  for (const scenario of MANAGEMENT_CONTEXT_FIXTURES) {
    assert.ok(decisions[scenario.id], scenario.id);
    assert.ok(Object.keys(scenario.input).length > 0);
    assert.ok(Object.keys(scenario.expected).length > 0);
  }
});
