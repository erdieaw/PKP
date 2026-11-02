import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EXPANDED_CLINICAL_CONTRACT, EXPANDED_CLINICAL_DECISIONS, type ClinicalDecision } from '../src/analytics/do2026/expanded-clinical';

// Independent S1 transcription and manual arithmetic, not generated from the declarations.
// id, DO row, kind, period, operator, normalized target, calculability, N, D, measurement.
// Synthetic counts are examples, NOT achievements. Blocked candidates intentionally have no result.
export const EXPANDED_CLINICAL_FIXTURES = [
  ['K2-R8', 7, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 90, 'RATIO_WITH_CONTEXT', 90, 100, 90],
  ['K2-R9', 8, 'COHORT', 'ANNUAL', 'RATIO_PERCENT', 82, 'RATIO_WITH_CONTEXT', 41, 50, 82],
  ['K2-R10', 9, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 92, 'RATIO_WITH_CONTEXT', 46, 50, 92],
  ['K2-R12', 11, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 9, 10, 90],
  ['K2-R13', 12, 'COHORT', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 89, 'RATIO_WITH_CONTEXT', 89, 100, 89],
  ['K2-R14', 13, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 88, 'RATIO_WITH_CONTEXT', 22, 25, 88],
  ['K2-R16', 15, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 9, 12, 75],
  ['K2-R17', 16, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 3, 4, 75],
  ['K2-R18', 17, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 88, 'RATIO_WITH_CONTEXT', 44, 50, 88],
  ['K2-R19', 18, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 15, 'RATIO_WITH_CONTEXT', 3, 20, 15],
  ['K2-R20', 19, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 2, 20, 10],
  ['K2-R23', 22, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 8, 10, 80],
  ['K2-R24', 23, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 92, 'RATIO_WITH_CONTEXT', 23, 25, 92],
  ['K2-R26', 25, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 92, 'RATIO_WITH_CONTEXT', 23, 25, 92],
  ['K2-R27', 26, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 64, 'RATIO_WITH_CONTEXT', 16, 25, 64],
  ['K2-R28', 27, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 70, 'RATIO_WITH_CONTEXT', 7, 10, 70],
  ['K2-R29', 28, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 2, 3, 66.66666666666667],
  ['K2-R30', 29, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 1, 2, 50],
  ['K2-R31', 30, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 95, 'RATIO_WITH_CONTEXT', 19, 20, 95],
  ['K2-R32', 31, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 95, 'SOURCE_BLOCKED', 19, 20, null],
  ['K2-R34', 33, 'COHORT', 'ANNUAL', 'RATIO_PERCENT', 90, 'SOURCE_BLOCKED', 9, 10, null],
  ['K2-R35', 34, 'UNDEFINED', 'EXPLICIT_WINDOW', null, 92, 'UNDEFINED', null, null, null],
  ['K2-R36', 35, 'COHORT', 'PROGRAM_YEAR', 'RATIO_PERCENT', 92, 'RATIO_WITH_CONTEXT', 23, 25, 92],
  ['K2-R37', 36, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 70, 'RATIO_WITH_CONTEXT', 7, 10, 70],
  ['K2-R38', 37, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 92, 'RATIO_WITH_CONTEXT', 23, 25, 92],
  ['K2-R39', 38, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 90, 'RATIO_WITH_CONTEXT', 18, 20, 90],
  ['K2-R40', 39, 'COHORT', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 55, 'RATIO_WITH_CONTEXT', 11, 20, 55],
  ['K2-R43', 42, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 7, 8, 87.5],
  ['K2-R45', 44, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 50, 'RATIO_WITH_CONTEXT', 5, 12.5, 40],
  ['K2-R47', 46, 'COHORT', 'ANNUAL', 'RATIO_PERCENT', 95, 'RATIO_WITH_CONTEXT', 19, 20, 95],
  ['K2-R48', 47, 'COHORT', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 88, 'SOURCE_BLOCKED', 22, 25, null],
  ['K2-R54', 53, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 1, 10, 10],
  ['K2-R56', 55, 'COHORT', 'ANNUAL', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 9, 10, 90],
  ['K2-R57', 56, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 2, 20, 10],
  ['K2-R59', 58, 'RATIO', 'SCHOOL_YEAR', 'RATIO_PERCENT', 90, 'RATIO_WITH_CONTEXT', 9, 10, 90],
  ['K2-R60', 59, 'RATIO', 'SCHOOL_YEAR', 'RATIO_PERCENT', 90, 'SOURCE_BLOCKED', 9, 10, null],
  ['K2-R61', 60, 'RATIO', 'SCHOOL_YEAR', 'RATIO_PERCENT', 90, 'RATIO_WITH_CONTEXT', 9, 10, 90],
  ['K2-R62', 61, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 77, 'RATIO_WITH_CONTEXT', 77, 100, 77],
  ['K2-R63', 62, 'COHORT', 'ANNUAL', 'RATIO_PERCENT', 67, 'RATIO_WITH_CONTEXT', 67, 100, 67],
  ['K2-R64', 63, 'COHORT', 'ANNUAL', 'RATIO_PERCENT', 97, 'RATIO_WITH_CONTEXT', 97, 100, 97],
  ['K2-R65', 64, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 35, 'RATIO_WITH_CONTEXT', 7, 20, 35],
  ['K2-R66', 65, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 15, 'RATIO_WITH_CONTEXT', 3, 20, 15],
  ['K2-R67', 66, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 1, 10, 10],
  ['K2-R68', 67, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 30, 'RATIO_WITH_CONTEXT', 3, 10, 30],
  ['K2-R69', 68, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 30, 'RATIO_WITH_CONTEXT', 3, 10, 30],
  ['K2-R71', 70, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 15, 'RATIO_WITH_CONTEXT', 3, 20, 15],
  ['K2-R72', 71, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 3, 4, 75],
  ['K2-R73', 72, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 1, 10, 10],
  ['K2-R74', 73, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 35, 'RATIO_WITH_CONTEXT', 7, 20, 35],
  ['K2-R76', 75, 'COUNT', 'COHORT_WINDOW', 'COUNT', 50, 'COUNT_ONLY', 12, null, 12],
  ['K3-R9', 8, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 15, 'RATIO_WITH_CONTEXT', 3, 20, 15],
  ['K3-R10', 9, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 60, 'SOURCE_BLOCKED', 32, 64, null],
  ['K3-R11', 10, 'VERIFIED_ZERO_RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 3, 4, 75],
  ['K3-R12', 11, 'VERIFIED_ZERO_RATIO', 'ANNUAL', 'RATIO_PERCENT', 10, 'SOURCE_BLOCKED', 1, 10, null],
  ['K3-R15', 14, 'MIXED_GRAIN_RATIO', 'ANNUAL', 'RATIO_PERCENT', 75, 'RATIO_WITH_CONTEXT', 300, 400, 75],
  ['K3-R17', 16, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 60, 'RATIO_WITH_CONTEXT', 3, 5, 60],
  ['K3-R18', 17, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 60, 'RATIO_WITH_CONTEXT', 3, 5, 60],
  ['K3-R19', 18, 'ESTIMATED_RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'SOURCE_BLOCKED', 10, 12.5, null],
  ['K3-R20', 19, 'LAST_VISIT', 'AS_OF', 'RATIO_PERCENT', 20, 'RATIO_WITH_CONTEXT', 5, 25, 20],
  ['K3-R21', 20, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 70, 'RATIO_WITH_CONTEXT', 7, 10, 70],
  ['K3-R23', 22, 'ESTIMATED_RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 10, 12.5, 80],
  ['K3-R24', 23, 'LAST_VISIT', 'AS_OF', 'RATIO_PERCENT', 25, 'RATIO_WITH_CONTEXT', 1, 4, 25],
  ['K3-R25', 24, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 50, 'SOURCE_BLOCKED', 3, 2, null],
  ['K3-R27', 26, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 25, 'RATIO_WITH_CONTEXT', 1, 4, 25],
  ['K3-R28', 27, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 75, 'RATIO_WITH_CONTEXT', 3, 4, 75],
  ['K3-R29', 28, 'RATIO', 'ANNUAL', 'RATIO_PERCENT', 60, 'RATIO_WITH_CONTEXT', 3, 5, 60],
  ['K3-R30', 29, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 25, 'RATIO_WITH_CONTEXT', 1, 4, 25],
  ['K3-R31', 30, 'COUNT', 'ANNUAL', 'COUNT', 70, 'COUNT_ONLY', 17, null, 17],
  ['K3-R32', 31, 'COUNT', 'ANNUAL', 'COUNT', 70, 'COUNT_ONLY', 11, null, 11],
  ['K3-R34', 33, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 1, 10, 10],
  ['K3-R36', 35, 'COHORT', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 45, 'RATIO_WITH_CONTEXT', 9, 20, 45],
  ['K3-R39', 38, 'COHORT', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 1, 10, 10],
  ['K3-R42', 41, 'RATIO', 'AS_OF', 'RATIO_PERCENT', 80, 'RATIO_WITH_CONTEXT', 4, 5, 80],
  ['K3-R43', 42, 'COHORT', 'COHORT_WINDOW', 'RATIO_PERCENT', 60, 'RATIO_WITH_CONTEXT', 3, 5, 60],
  ['K3-R44', 43, 'COHORT', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 55, 'RATIO_WITH_CONTEXT', 11, 20, 55],
  ['K3-R47', 46, 'ESTIMATED_RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 15, 'RATIO_WITH_CONTEXT', 3, 20, 15],
  ['K3-R48', 47, 'VERIFIED_ZERO_RATIO', 'ANNUAL', 'RATIO_PERCENT', 100, 'RATIO_WITH_CONTEXT', 3, 4, 75],
  ['K3-R49', 48, 'VERIFIED_ZERO_RATIO', 'ANNUAL', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 1, 10, 10],
  ['K3-R51', 50, 'RATIO', 'EXPLICIT_WINDOW', 'RATIO_PERCENT', 10, 'RATIO_WITH_CONTEXT', 1, 10, 10],
  ['K3-R53', 52, 'COHORT', 'ANNUAL', 'RATIO_PERCENT', 55, 'RATIO_WITH_CONTEXT', 11, 20, 55],
] as const;

// Portable behavioral obligations for the coordinator's FUTURE interpreter. The tests here
// check declarations and arithmetic oracles, not execution of a clinical validation engine.
export const CLINICAL_CONTEXT_FIXTURES = [
  { id: 'K2-R8', scenario: 'first-contact-boundary', input: { weeks: [12, 12.01], firstContact: [true, true] }, expected: { eligible: [true, false] } },
  { id: 'K2-R8', scenario: 'subsequent-contact-not-k1', input: { firstContactWeeks: 14, repeatContactWeeks: 15 }, expected: { qualifyingPregnancies: 0 } },
  { id: 'K2-R8', scenario: 'documented-estimate-exceed', input: { numerator: 12, denominator: 10.5, denominatorInputType: 'ESTIMATED', hasMethodAndAllocation: true, exceedReviewReference: null }, expected: { measurementBeforeCap: 114.28571428571429, targetMet: null, review: 'EXCEED_RECONCILIATION_REQUIRED' } },
  { id: 'K2-R9', scenario: 'six-contacts-wrong-trimesters', input: { trimesterContacts: [1, 1, 4], doctorTrimesterContacts: [1, 1], complete12T: true, alreadyDelivered: true }, expected: { qualifyingPregnancies: 0 } },
  { id: 'K2-R9', scenario: 'not-yet-delivered', input: { trimesterContacts: [1, 2, 3], complete12T: true, alreadyDelivered: false }, expected: { qualifyingPregnancies: 0, state: 'NOT_YET_ELIGIBLE' } },
  { id: 'K2-R9', scenario: 'pregnancy-crosses-years', input: { firstContact: '2025-08-01', delivery: '2026-03-01', linkedHistoryComplete: true, complete12T: true, trimesterContacts: [1, 2, 3], doctorTrimesterContacts: [1, 1] }, expected: { deliveryYear: 2026, qualifyingPregnancies: 1 } },
  { id: 'K2-R10', scenario: 'tablets-versus-mothers', input: { tabletsPerMother: [179, 180, 360] }, expected: { qualifyingMothers: 2, notNumerator: 719 } },
  { id: 'K2-R12', scenario: 'valid-alternative', input: { dentistAbsentEvidenced: true, otherHealthWorkerEducationAtK1: true }, expected: { qualifyingMothers: 1 } },
  { id: 'K2-R12', scenario: 'alternative-not-eligible', input: { dentistAbsentEvidenced: false, otherHealthWorkerEducationAtK1: true, dentistContact: false }, expected: { qualifyingMothers: 0 } },
  { id: 'K2-R13', scenario: 'twins-one-delivery', input: { motherDeliveryIdentities: ['m1-delivery1', 'm1-delivery1'], babies: 2 }, expected: { qualifyingDeliveries: 1 } },
  { id: 'K2-R14', scenario: 'four-visits-not-four-windows', input: { postpartumHours: [6, 7, 8, 9] }, expected: { qualifyingMothers: 0 } },
  { id: 'K2-R14', scenario: 'late-december-not-yet-due', input: { deliveryDate: '2026-12-30', asOf: '2026-12-31', fourthWindowOpen: false }, expected: { state: 'NOT_YET_DUE', measurement: null, targetMet: null } },
  { id: 'K2-R16', scenario: 'unidentified-kmk-allocation', input: { testedMothers: 5, kmkAllocation: null }, expected: { measurement: null, review: 'MISSING_DENOMINATOR_CONTEXT' } },
  { id: 'K2-R17', scenario: 'wrong-referral-destination', input: { tenofovirArea: true, referred: true, designatedCapableFacility: false }, expected: { qualifyingMothers: 0 } },
  { id: 'K2-R18', scenario: 'screening-plus-dose-one-person', input: { t2PlusPersons: ['m1', 'm1'], newDoses: 2 }, expected: { qualifyingMothers: 1 } },
  { id: 'K2-R19', scenario: 'maternal-status-overlap', input: { screenedPersonIdentities: ['m1', 'm1', 'm1'], phases: ['pregnant', 'delivery', 'postpartum'] }, expected: { numerator: 1 } },
  { id: 'K2-R20', scenario: 'service-not-population-denominator', input: { traditionalRecipients: 1, healthServiceRecipients: 10, allPregnantAndPostpartumResidents: 100 }, expected: { denominator: 10, measurement: 10 } },
  { id: 'K2-R23', scenario: 'kn1-incomplete-package', input: { contactHours: 24, shk: false, otherSixComponents: true }, expected: { qualifyingInfants: 0 } },
  { id: 'K2-R24', scenario: 'three-visits-same-window', input: { visitAgeDays: [3, 4, 5] }, expected: { qualifyingInfants: 0 } },
  { id: 'K2-R26', scenario: 'four-infant-windows-without-kn', input: { fourAgeWindowsComplete: true, knComplete: false }, expected: { qualifyingInfants: 0 } },
  { id: 'K2-R27', scenario: 'exclusive-currently-not-from-birth', input: { currentAgeMonths: 6, currentlyBreastfedOnly: true, formulaAtAgeMonths: 2 }, expected: { qualifyingInfants: 0 } },
  { id: 'K2-R28', scenario: 'minimum-two-distinct-types', input: { typesByInfant: [['weight', 'weight'], ['weight', 'pjbk']] }, expected: { qualifyingInfants: 1 } },
  { id: 'K2-R29', scenario: 'strict-hb0-hour-boundary', input: { exposedInfantDoseHours: [23.99, 24] }, expected: { eligible: [true, false] } },
  { id: 'K2-R30', scenario: 'hb0-not-hbig', input: { hb0Hours: 6, hbigHours: null }, expected: { qualifyingInfants: 0 } },
  { id: 'K2-R31', scenario: 'results-not-testing-coverage', input: { exposed: 30, hbsagTested: 20, hbsagNonreactive: 19 }, expected: { numerator: 19, denominator: 20, measurement: 95 } },
  { id: 'K2-R32', scenario: 'different-tests-not-merged', input: { hbsagNonreactive: 19, antiHbsReactive: 15, antiHbsTested: 20 }, expected: { measurement: null, targetMet: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K2-R34', scenario: 'do-not-drop-infant-age-band', input: { population0To11: 10, population12To59: 20, complete12To59: 18 }, expected: { measurement: null, targetMet: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K2-R35', scenario: 'neighbor-formula-not-borrowed', input: { treated6To59: 92, all6To59: 100, twiceYearly: 80 }, expected: { measurement: null, targetMet: null, numericScore: null } },
  { id: 'K2-R36', scenario: 'two-doses-per-child', input: { dosesPerChild: [1, 1, 2, 2] }, expected: { numerator: 2, notNumerator: 3 } },
  { id: 'K2-R37', scenario: 'strict-z-score-boundaries', input: { bbTbZ: [-3, -2.5, -2] }, expected: { eligible: [false, true, false] } },
  { id: 'K2-R38', scenario: 'severe-nutrition-thresholds', input: { ageMonths: 12, zScore: -3, lilaCm: 11.5, clinicalSigns: false }, expected: { eligibleViaTheseBranches: false } },
  { id: 'K2-R38', scenario: 'under-six-month-risk-branch', input: { ageMonths: 5, poorGrowthDevelopmentRisk: true }, expected: { eligible: true } },
  { id: 'K2-R39', scenario: 'no-monthly-sum', input: { january: { weighed: ['c1'], residents: ['c1', 'c2'] }, february: { weighed: ['c1'], residents: ['c1', 'c2'] }, annualMethod: null }, expected: { januaryPercent: 50, februaryPercent: 50, annualMeasurement: null } },
  { id: 'K2-R40', scenario: 'risk-component-conditional', input: { ageYears: 3, sixCoreChecksComplete: true, hepatitisRisk: false, hepatitisChecked: false }, expected: { qualifyingChildren: 1 } },
  { id: 'K2-R43', scenario: 'both-treatments-required', input: { oralit: true, zinc: false }, expected: { qualifyingPatients: 0 } },
  { id: 'K2-R45', scenario: 'target-not-prevalence', input: { found: 5, estimate: null, targetPercent: 50 }, expected: { denominator: null, measurement: null } },
  { id: 'K2-R45', scenario: 'decimal-estimate-not-rounded', input: { numerator: 5, denominator: 12.5, estimateEvidence: true }, expected: { measurement: 40 } },
  { id: 'K2-R47', scenario: 'idl-packet-not-total-doses', input: { hbDay: 7, bcg: 1, bopv: 4, ipv: 0, dptHbHib: 3, mr: 1 }, expected: { qualifyingInfants: 0 } },
  { id: 'K2-R48', scenario: 'do-not-correct-eleven-to-twelve', input: { vaccinated12To23: 22, target11To23: 25, target12To23: 24 }, expected: { measurement: null, targetMet: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K2-R54', scenario: 'two-year-boundary-needs-reference', input: { childAgeMonths: 24, ageBoundaryReference: null }, expected: { measurement: null, review: 'MISSING_ELIGIBILITY_CONTEXT' } },
  { id: 'K2-R56', scenario: 'growth-and-development', input: { ageMonths: 60, growthChecks: 8, developmentChecks: 1 }, expected: { qualifyingChildren: 0 } },
  { id: 'K2-R57', scenario: 'child-not-parent-or-actions', input: { childIdentities: ['c1', 'c1'], parentEducated: true, massage: true }, expected: { numerator: 1 } },
  { id: 'K2-R59', scenario: 'ponpes-needs-equivalence', input: { ponpes: 1, equivalenceReference: null }, expected: { measurement: null, review: 'MISSING_ELIGIBILITY_CONTEXT' } },
  { id: 'K2-R60', scenario: 'school-level-conflict', input: { screenedSmp: 9, totalSd: 10, totalSmp: 9 }, expected: { measurement: null, targetMet: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K2-R61', scenario: 'wrong-calendar-period', input: { periodStart: '2026-01-01', periodEnd: '2026-12-31', schoolYear2025To2026: null }, expected: { measurement: null, review: 'SCHOOL_YEAR_REQUIRED' } },
  { id: 'K2-R61', scenario: 'school-not-student-grain', input: { schoolYear: '2025/2026', screenedSchoolIds: ['s1', 's1', 's2'], schoolCount: 4, screenedStudents: 600 }, expected: { numerator: 2, denominator: 4, measurement: 50 } },
  { id: 'K2-R62', scenario: 'grades-and-hb', input: { femaleGrades: [7, 8, 10], hasHb: [true, true, true] }, expected: { qualifyingStudents: 2 } },
  { id: 'K2-R63', scenario: 'consumption-not-distribution', input: { distributed: 52, consumedWeekly: 25 }, expected: { qualifyingStudents: 0 } },
  { id: 'K2-R64', scenario: 'td-not-divided-doses', input: { gradeFiveTdDoses: [1, 1, 2] }, expected: { qualifyingStudents: 1 } },
  { id: 'K2-R65', scenario: 'student-upper-age-exclusive', input: { ages: [7, 17, 18], inEducation: [true, true, true], eligiblePackagesComplete: true }, expected: { eligible: [true, true, false] } },
  { id: 'K2-R66', scenario: 'instrument-events-not-persons', input: { mmysPersons: ['p1', 'p1'], frequencyStandardReference: 'fixture-standard' }, expected: { numerator: 1 } },
  { id: 'K2-R67', scenario: 'service-recipient-denominator', input: { traditionalRecipients: 1, healthRecipients7To12: 10, allResidents7To12: 100 }, expected: { denominator: 10, measurement: 10 } },
  { id: 'K2-R68', scenario: 'six-year-olds-in-dental', input: { ageYears: 6, dentalScreened: true }, expected: { eligible: true } },
  { id: 'K2-R69', scenario: 'same-cohort-required', input: { numeratorSchoolYear: '2025/2026', denominatorSchoolYear: '2026/2027' }, expected: { measurement: null, review: 'COHORT_MISMATCH' } },
  { id: 'K2-R71', scenario: 'assist-age-eligibility', input: { ages: [14, 15], mmys: [true, true] }, expected: { assistAgeEligible: [false, true] } },
  { id: 'K2-R72', scenario: 'risk-union-not-groups-sum', input: { pregnantIds: ['p1'], tbIds: ['p1', 'p2'], screenedAndEducatedIds: ['p1'] }, expected: { numerator: 1, denominator: 2, measurement: 50 } },
  { id: 'K2-R73', scenario: 'eighteen-not-kestrad-adolescent', input: { ageYears: 18 }, expected: { eligible: false } },
  { id: 'K2-R74', scenario: 'screening-not-smoking-prevalence', input: { residents: 20, screened: 7, smokers: 1 }, expected: { numerator: 7, denominator: 20, measurement: 35 } },
  { id: 'K2-R76', scenario: 'count-not-percent', input: { qualifyingPeople: 12, smokersFromOtherMetric: 24 }, expected: { count: 12, percent: null, targetMet: null, numericScore: null } },
  { id: 'K3-R9', scenario: 'maternal-exclusion-not-silent-denominator-edit', input: { allAdultsEstimated: 20, maternalAdults: 2, nonmaternalScreened: 3 }, expected: { literalDenominator: 20, measurement: 15 } },
  { id: 'K3-R10', scenario: 'fixed-factor-known-base-conflicted', input: { totalPopulation: 10000, adultPopulation: 6000, treatedAdults: 32 }, expected: { literalTotalPopulationEstimate: 64, adultBaseCandidate: 38.4, measurement: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K3-R11', scenario: 'previous-year-free-still-visit-obligation', input: { currentCases: 0, previousYearReleasedNoRepasung: 2, visitedTwice: 1 }, expected: { numerator: 1, denominator: 2, measurement: 50, nihil: false } },
  { id: 'K3-R11', scenario: 'nihil-not-proved', input: { numerator: 0, denominator: 0, dinsosNihilReference: null }, expected: { measurement: null, targetMet: null } },
  { id: 'K3-R11', scenario: 'nihil-proved', input: { numerator: 0, denominator: 0, eligibleCohortEmpty: true, previousYearObligations: 0, dinsosNihilReference: 'fixture-dinsos-same-period-territory' }, expected: { measurement: null, targetMet: true, numericScore: null } },
  { id: 'K3-R12', scenario: 'adult-zero-not-combined-zero', input: { adultCases: 0, elderlyCases: 2, dinsosAdultNihilReference: 'fixture-dinsos-adult' }, expected: { measurement: null, targetMet: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K3-R15', scenario: 'person-encounter-distinction', input: { screenedUniquePeople: 2, allVisits: 8, uniqueVisitors: 4 }, expected: { numerator: 2, denominator: 8, measurement: 25, isPersonCoverage: false } },
  { id: 'K3-R17', scenario: 'age-boundary-fifteen', input: { ages: [14, 15], gdsChecked: [true, true] }, expected: { eligible: [false, true] } },
  { id: 'K3-R18', scenario: 'checked-not-obese-only', input: { adultsCheckedImt: 10, adultsObese: 3 }, expected: { numerator: 10 } },
  { id: 'K3-R19', scenario: 'age-conflict-retained', input: { patientAgeYears: 15, districtEstimateAgeMinimum: 15 }, expected: { literalNumeratorAgeEligible: false, measurement: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K3-R20', scenario: 'last-not-best-dm', input: { hba1cVisits: [{ date: '2026-02-01', value: 6 }, { date: '2026-10-01', value: 7 }], otherControlTests: [] }, expected: { controlledAtLastVisit: false } },
  { id: 'K3-R20', scenario: 'dm-control-boundaries', input: { preprandialMgDl: [79, 80, 130, 131], twoPpMgDl: [179, 180] }, expected: { preprandialControlled: [false, true, true, false], twoPpControlled: [true, false] } },
  { id: 'K3-R20', scenario: 'external-prevalence-no-default', input: { population15Plus: 1000, ski2023Prevalence: null }, expected: { denominator: null, measurement: null } },
  { id: 'K3-R21', scenario: 'people-not-repeat-pressure-checks', input: { bloodPressurePatientIds: ['p1', 'p1', 'p2'] }, expected: { numerator: 2 } },
  { id: 'K3-R23', scenario: 'one-month-missing', input: { monthlyBpChecks: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0], educationComplete: true }, expected: { qualifyingPatients: 0 } },
  { id: 'K3-R24', scenario: 'new-treatment-excluded-n-only', input: { examined: 4, controlledEstablished: 1, controlledNewTreatmentTwoMonths: 1 }, expected: { numerator: 1, denominator: 4, fraction: 0.25, percent: 25 } },
  { id: 'K3-R24', scenario: 'both-pressure-boundaries', input: { pressures: [[139, 89], [140, 89], [139, 90]], treatmentAtLeastThreeMonths: true }, expected: { controlled: [true, false, false] } },
  { id: 'K3-R25', scenario: 'or-not-and', input: { htOnlyScreened: 1, dmOnlyScreened: 1, bothScreened: 1, bothDiseaseTotal: 2 }, expected: { measurement: null, targetMet: null, review: 'SOURCE_BLOCKED' } },
  { id: 'K3-R27', scenario: 'symptomatic-outside-age-separate', input: { screened45Plus: 1, population45Plus: 4, screenedSymptomaticAge40: 1 }, expected: { numerator: 1, denominator: 4, measurement: 25, separateOutOfAge: 1 } },
  { id: 'K3-R28', scenario: 'menopause-changes-method', input: { menopause: true, ivaOnly: true, hpvDna: false }, expected: { qualifyingWomen: 0 } },
  { id: 'K3-R29', scenario: 'previous-year-not-reused', input: { assessmentYear: 2026, screeningDates: ['2025-12-01'] }, expected: { numerator: 0 } },
  { id: 'K3-R30', scenario: 'symptomatic-age71-separate', input: { screened45To70: 1, population45To70: 4, symptomatic71: 1 }, expected: { numerator: 1, denominator: 4, measurement: 25, separateOutOfAge: 1 } },
  { id: 'K3-R31', scenario: 'vision-missing-denominator', input: { uniqueScreened: 17, residents7PlusFromAnotherMetric: 100 }, expected: { count: 17, percent: null, targetMet: null } },
  { id: 'K3-R32', scenario: 'hearing-missing-denominator', input: { uniqueScreened: 11, residents7PlusFromAnotherMetric: 100 }, expected: { count: 11, percent: null, targetMet: null } },
  { id: 'K3-R34', scenario: 'adult-kestrad-service-denominator', input: { traditionalRecipients: 1, healthRecipients18To59: 10, allAdults: 100 }, expected: { denominator: 10, measurement: 10 } },
  { id: 'K3-R36', scenario: 'pkg-not-individual-colorectal-age', input: { ageYears: 47, otherEligiblePkgChecksComplete: true, colorectalChecked: false }, expected: { pkgColorectalAgeEligible: false, individualColorectalAgeEligible: true } },
  { id: 'K3-R39', scenario: 'rest-minimum-three-months', input: { restMonths: [2, 3], otherNewParticipantBranches: false }, expected: { eligible: [false, true] } },
  { id: 'K3-R42', scenario: 'four-t-strict-boundaries', input: { wifeAge: 35, livingChildren: 3, intervalYears: 2 }, expected: { fourT: false } },
  { id: 'K3-R42', scenario: 'four-t-union-not-sum', input: { wifeAge: 36, livingChildren: 4, intervalYears: 1, usesKb: true }, expected: { numerator: 1, denominator: 1 } },
  { id: 'K3-R43', scenario: 'postpartum-day-inclusive', input: { startDays: [0, 42, 43] }, expected: { eligible: [true, true, false] } },
  { id: 'K3-R44', scenario: 'person-not-couple', input: { couples: 2, fullyScreenedPeople: 3, sasaranPeople: 4 }, expected: { numerator: 3, denominator: 4, measurement: 75 } },
  { id: 'K3-R47', scenario: 'no-frequency-invented', input: { screenedPeople: 3, estimate: 20, frequencyStandardReference: null }, expected: { measurement: null, review: 'MISSING_ELIGIBILITY_CONTEXT' } },
  { id: 'K3-R48', scenario: 'nihil-with-prior-obligation-invalid', input: { currentCases: 0, previousYearReleasedNoRepasung: 1, dinsosCurrentCasesZero: true }, expected: { denominator: 1, nihil: false } },
  { id: 'K3-R48', scenario: 'verified-elderly-nihil', input: { numerator: 0, denominator: 0, completeCohortAbsent: true, previousYearObligations: 0, dinsosSameScopeVerified: true }, expected: { measurement: null, targetMet: true, numericScore: null } },
  { id: 'K3-R49', scenario: 'repasung-disqualifies-release', input: { released: true, repasungDuringAssessmentYear: true }, expected: { qualifyingReleasedPatients: 0 } },
  { id: 'K3-R49', scenario: 'verified-release-cohort-nihil', input: { numerator: 0, denominator: 0, completeCohortAbsent: true, dinsosSameScopeVerified: true }, expected: { measurement: null, targetMet: true, numericScore: null } },
  { id: 'K3-R51', scenario: 'elderly-boundary', input: { ages: [59, 60], traditionalServices: [true, true] }, expected: { eligible: [false, true] } },
  { id: 'K3-R53', scenario: 'pkg-not-spm-replacement', input: { spmR55Complete: true, pkgPriorityPackageComplete: false }, expected: { qualifyingPkgPeople: 0 } },
] as const;

export const CLINICAL_COMMON_INVALID_FIXTURES = [
  { input: { numerator: null, denominator: 10 }, expected: { measurement: null, review: 'MISSING_INPUT' } },
  { input: { numerator: 0, denominator: null }, expected: { measurement: null, review: 'MISSING_INPUT' } },
  { input: { numerator: 0, denominator: 0 }, expected: { measurement: null, targetMet: null, review: 'ZERO_DENOMINATOR_REVIEW' } },
  { input: { numerator: 1, denominator: 0 }, expected: { measurement: null, targetMet: null, review: 'INCONSISTENT_ZERO_DENOMINATOR' } },
  { input: { numerator: -1, denominator: 10 }, expected: { measurement: null, review: 'INVALID_COUNT' } },
  { input: { numerator: 0.5, denominator: 10 }, expected: { measurement: null, review: 'INVALID_COUNT' } },
  { input: { numerator: 1, denominator: -1 }, expected: { measurement: null, review: 'INVALID_DENOMINATOR' } },
  { input: { numerator: Number.NaN, denominator: 10 }, expected: { measurement: null, review: 'NONFINITE_INPUT' } },
  { input: { numerator: 1, denominator: Number.POSITIVE_INFINITY }, expected: { measurement: null, review: 'NONFINITE_INPUT' } },
  { input: { numerator: 9007199254740992, denominator: 10 }, expected: { measurement: null, review: 'UNSAFE_COUNT' } },
  { input: { numerator: 1, denominator: 10, sourceSnapshotReference: null }, expected: { measurement: null, review: 'MISSING_SOURCE_CONTEXT' } },
  { input: { numerator: 1, denominator: 10, periodStart: null }, expected: { measurement: null, review: 'MISSING_PERIOD_CONTEXT' } },
  { input: { numerator: 1, denominator: 10, numeratorTerritory: 'A', denominatorTerritory: 'B' }, expected: { measurement: null, review: 'TERRITORY_MISMATCH' } },
  { input: { numerator: 1, denominator: 10.5, denominatorInputType: null }, expected: { measurement: null, review: 'MISSING_DENOMINATOR_CONTEXT' } },
  { input: { numerator: 12, denominator: 10, denominatorInputType: 'INTEGER', actualRosterSubset: true }, expected: { measurement: null, review: 'SUBSET_VIOLATION' } },
] as const;

export const CLINICAL_SOURCE_BLOCKED_ORACLES = ['K2-R32', 'K2-R34', 'K2-R48', 'K2-R60', 'K3-R10', 'K3-R12', 'K3-R19', 'K3-R25'] as const;
const decisions: Readonly<Record<string, ClinicalDecision>> = EXPANDED_CLINICAL_DECISIONS;

test('exactly 80 independently enumerated clinical identities, with no existing profiles', () => {
  const ids = EXPANDED_CLINICAL_FIXTURES.map(([id]) => id).sort();
  assert.equal(ids.length, 80);
  assert.equal(new Set(ids).size, 80);
  assert.deepEqual(Object.keys(decisions).sort(), ids);
  assert.equal(EXPANDED_CLINICAL_CONTRACT.status, 'PROVISIONAL_SOURCE_DECLARATIONS');
  for (const existing of ['K2-R11', 'K2-R15', 'K2-R25', 'K2-R42', 'K2-R44', 'K2-R50', 'K2-R51', 'K2-R52', 'K2-R75', 'K3-R14', 'K3-R22', 'K3-R26', 'K3-R38', 'K3-R40', 'K3-R41', 'K3-R55']) {
    assert.equal(existing in decisions, false, existing);
  }
});

for (const [id, row, kind, period, operator, target, calculability, numerator, denominator, measurement] of EXPANDED_CLINICAL_FIXTURES) {
  test(`${id}: independent identity, method, target, period and arithmetic oracle`, () => {
    const decision = decisions[id]!;
    const cluster = id.startsWith('K2') ? 2 : 3;
    assert.equal(decision.definitionId, `DO26-K${cluster}-R${row}`);
    assert.equal(decision.sourceRef, `S1:KLASTER ${cluster}!A${row}:I${row}`);
    assert.equal(decision.kind, kind);
    assert.equal(decision.period, period);
    assert.equal(decision.formula?.operator ?? null, operator);
    assert.equal(decision.target.value, target);
    assert.equal(decision.calculability, calculability);
    assert.ok(decision.criteria.length > 0);
    assert.ok(decision.requiredContext.length > 0);
    assert.ok(decision.calculationQuote.length > 10);
    assert.equal(decision.readiness, calculability === 'SOURCE_BLOCKED' ? 'SOURCE_CONFLICT'
      : calculability === 'COUNT_ONLY' || calculability === 'UNDEFINED' ? 'MEASUREMENT_ONLY' : 'CONTEXT_REQUIRED');
    if (calculability === 'RATIO_WITH_CONTEXT') {
      assert.notEqual(numerator, null);
      assert.notEqual(denominator, null);
      assert.notEqual(measurement, null);
      assert.ok(Math.abs(100 * numerator! / denominator! - measurement!) < 1e-10);
    } else if (calculability === 'COUNT_ONLY') {
      assert.equal(denominator, null);
      assert.equal(numerator, measurement);
      assert.equal(decision.target.comparator, 'UNRESOLVED');
    } else {
      assert.equal(measurement, null);
      assert.equal(decision.target.comparator, 'UNRESOLVED');
      assert.ok(decision.unresolved.length > 0);
    }
  });
}

test('raw E/F/G identity and target proof agrees with both source.json and verbatim Markdown, not review labels', () => {
  type Raw = { id: string; catalogue_candidate: string; source: { sheet: string; row: number; range: string }; definisi_operasional_raw: string; cara_penghitungan_raw: string; sumber_data_raw: string; target: { raw: string | number; excel_number_format: string } };
  const documents = ['11-klaster-2-ibu-anak-bagian-1.md', '11-klaster-2-ibu-anak-bagian-2.md', '11-klaster-2-ibu-anak-bagian-3.md', '12-klaster-3-dewasa-lansia-bagian-1.md', '12-klaster-3-dewasa-lansia-bagian-2.md'];
  const rawRecords = documents.flatMap((file) => [...readFileSync(new URL(`../../docs/pkp-2026/${file}`, import.meta.url), 'utf8').matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]!) as Raw));
  const sourceRecords = JSON.parse(readFileSync(new URL('../src/analytics/do2026/source.json', import.meta.url), 'utf8')) as { indicatorId: string; definitionId: string; sourceRef: string; definition: string; calculation: string; target: Raw['target'] }[];
  for (const [id, row] of EXPANDED_CLINICAL_FIXTURES) {
    const decision = decisions[id]!;
    const matches = rawRecords.filter((r) => r.id === decision.definitionId);
    assert.equal(matches.length, 1, id);
    const raw = matches[0]!;
    const source = sourceRecords.find((r) => r.indicatorId === id)!;
    assert.ok(source, id);
    assert.equal(raw.catalogue_candidate, id);
    assert.equal(raw.source.row, row);
    assert.equal(`S1:${raw.source.sheet}!${raw.source.range}`, decision.sourceRef);
    assert.equal(source.definitionId, decision.definitionId);
    assert.equal(source.sourceRef, decision.sourceRef);
    assert.equal(source.definition, raw.definisi_operasional_raw);
    assert.equal(source.calculation, raw.cara_penghitungan_raw);
    assert.ok(raw.cara_penghitungan_raw.includes(decision.calculationQuote), `${id}: quote must be literal F text`);
    assert.ok(raw.sumber_data_raw.trim().length > 0, `${id}: source proof reference available in H`);
    assert.equal(decision.target.raw, raw.target.raw, id);
    assert.equal(decision.target.excelNumberFormat, raw.target.excel_number_format, id);
    assert.deepEqual(source.target, raw.target, id);
    if (typeof raw.target.raw === 'number') assert.ok(Math.abs(raw.target.raw * 100 - decision.target.value!) < 1e-10, id);
  }
});

test('all 80 have at least one independently authored domain scenario; common invalid cases remain null', () => {
  assert.deepEqual([...new Set(CLINICAL_CONTEXT_FIXTURES.map(({ id }) => id))].sort(), Object.keys(decisions).sort());
  assert.equal(new Set(CLINICAL_CONTEXT_FIXTURES.map(({ id, scenario }) => `${id}:${scenario}`)).size, CLINICAL_CONTEXT_FIXTURES.length);
  for (const { expected } of CLINICAL_COMMON_INVALID_FIXTURES) assert.equal(expected.measurement, null);
  assert.ok(EXPANDED_CLINICAL_CONTRACT.requiredContext.includes('sourceSnapshotReference'));
  assert.ok(EXPANDED_CLINICAL_CONTRACT.requiredContext.includes('denominatorEvidenceReference'));
  assert.ok(EXPANDED_CLINICAL_CONTRACT.sasaranRequiredContext.includes('denominatorInputType'));
  assert.ok(EXPANDED_CLINICAL_CONTRACT.estimateRequiredContext.includes('estimateParametersReference'));
});

test('source conflicts and undefined/count methods do not manufacture ratio results or score bands', () => {
  assert.deepEqual(Object.entries(decisions).filter(([, r]) => r.calculability === 'SOURCE_BLOCKED').map(([id]) => id).sort(), [...CLINICAL_SOURCE_BLOCKED_ORACLES].sort());
  assert.equal(decisions['K2-R35']!.formula, null);
  assert.deepEqual(Object.entries(decisions).filter(([, r]) => r.calculability === 'COUNT_ONLY').map(([id]) => id), ['K2-R76', 'K3-R31', 'K3-R32']);
  for (const decision of Object.values(decisions)) {
    assert.equal('scoring' in decision, false);
    assert.equal('scoreBands' in decision, false);
    assert.equal(decision.target.comparator === 'UNRESOLVED', decision.target.basis === 'UNRESOLVED');
  }
});

test('decision and calculability tallies are exhaustive, independently specified', () => {
  const kinds: Record<string, number> = {};
  const calculability: Record<string, number> = {};
  for (const decision of Object.values(decisions)) {
    kinds[decision.kind] = (kinds[decision.kind] ?? 0) + 1;
    calculability[decision.calculability] = (calculability[decision.calculability] ?? 0) + 1;
  }
  assert.deepEqual(kinds, { RATIO: 31, COHORT: 28, ESTIMATED_RATIO: 10, UNDEFINED: 1, COUNT: 3, VERIFIED_ZERO_RATIO: 4, MIXED_GRAIN_RATIO: 1, LAST_VISIT: 2 });
  assert.deepEqual(calculability, { RATIO_WITH_CONTEXT: 68, SOURCE_BLOCKED: 8, UNDEFINED: 1, COUNT_ONLY: 3 });
});

test('sasaran is not silently made INTEGER, ESTIMATED or allowExceed', () => {
  for (const [id, decision] of Object.entries(decisions)) {
    const formula = decision.formula;
    if (formula?.operator !== 'RATIO_PERCENT') continue;
    assert.equal('allowExceed' in formula, false, id);
    if (formula.denominatorBasis === 'SASARAN') {
      assert.equal(formula.input, 'DENOMINATOR_CONTEXT', id);
      assert.equal(formula.numeratorSubset, 'CONTEXT_REQUIRED', id);
      assert.ok(decision.requiredContext.includes('sasaranProvenance'), id);
    }
    if (formula.denominatorBasis === 'ESTIMATE') assert.equal(formula.input, 'ESTIMATED', id);
    if (formula.numeratorSubset === true) assert.equal(formula.input, 'INTEGER', id);
  }
  assert.match(EXPANDED_CLINICAL_CONTRACT.exceedPolicy, /never silently reject.*cap at 100/);
  assert.match(EXPANDED_CLINICAL_CONTRACT.inputPolicy, /no rounding/);
});

test('no factor is guessed from targets or borrowed from existing profiles', () => {
  const factors = Object.fromEntries(Object.entries(decisions).flatMap(([id, d]) => d.formula?.operator === 'RATIO_PERCENT' && d.formula.documentedFactor !== undefined ? [[id, d.formula.documentedFactor]] : []));
  assert.deepEqual(factors, { 'K3-R10': 0.0064 });
  assert.equal(10000 * 0.0064, 64);
  assert.ok(Math.abs(6000 * 0.0064 - 38.4) < 1e-10);
  assert.equal(decisions['K3-R10']!.calculability, 'SOURCE_BLOCKED');
  assert.ok(decisions['K2-R45']!.requiredContext.includes('estimateParametersReference'));
  assert.ok(decisions['K3-R20']!.requiredContext.includes('ski2023DmPrevalenceReference'));
  assert.ok(decisions['K3-R23']!.requiredContext.includes('districtPrevalenceAndEstimateReference'));
});

test('source-specific period and cohort requirements never become universal calendar-year pooling', () => {
  for (const id of ['K2-R59', 'K2-R60', 'K2-R61']) {
    assert.equal(decisions[id]!.period, 'SCHOOL_YEAR');
    assert.ok(decisions[id]!.requiredContext.includes('schoolYear2025To2026'));
  }
  assert.equal(decisions['K2-R36']!.period, 'PROGRAM_YEAR');
  for (const id of ['K2-R14', 'K2-R23', 'K2-R24', 'K2-R26', 'K3-R43']) {
    assert.equal(decisions[id]!.period, 'COHORT_WINDOW');
    assert.ok(decisions[id]!.requiredContext.includes('crossYearPolicyReference'));
  }
  assert.ok(decisions['K2-R9']!.requiredContext.includes('pregnancyToDeliveryLink'));
  assert.ok(decisions['K2-R69']!.requiredContext.includes('gradeSevenCohortAndSchoolYearReference'));
  for (const id of ['K3-R20', 'K3-R24', 'K3-R42']) {
    assert.equal(decisions[id]!.period, 'AS_OF');
    assert.ok(decisions[id]!.requiredContext.includes('asOf'));
  }
  assert.match(EXPANDED_CLINICAL_CONTRACT.periodPolicy, /No universal annualization/);
});

test('only pasung has a conditional nihil exception; source blocking has precedence', () => {
  const actual = Object.entries(decisions).filter(([, d]) => d.zeroException).map(([id]) => id);
  assert.deepEqual(actual, ['K3-R11', 'K3-R12', 'K3-R48', 'K3-R49']);
  for (const id of actual) {
    assert.deepEqual(decisions[id]!.zeroException, { kind: 'DINSOS_VERIFIED_NIHIL', measurement: null, targetMet: true, numericScore: null });
    assert.ok(decisions[id]!.requiredContext.includes('dinsosNihilReferenceIfZero'));
  }
  assert.equal(decisions['K3-R12']!.calculability, 'SOURCE_BLOCKED');
  assert.equal(decisions['K3-R12']!.target.comparator, 'UNRESOLVED');
  for (const id of ['K3-R11', 'K3-R48']) {
    assert.ok(decisions[id]!.requiredContext.includes('currentAndPreviousYearCohort'));
    assert.equal(decisions[id]!.thresholds!.minimumAnnualVisits, 2);
  }
  assert.match(EXPANDED_CLINICAL_CONTRACT.zeroPolicy, /N=D=0/);
});

test('eligibility thresholds are literal boundaries, not rubrics', () => {
  assert.deepEqual(decisions['K2-R9']!.thresholds!.trimesterContacts, [1, 2, 3]);
  assert.equal(decisions['K2-R9']!.thresholds!.qualityComponents, 12);
  assert.equal(decisions['K2-R10']!.thresholds!.minimumTablets, 180);
  assert.equal(decisions['K2-R28']!.thresholds!.minimumScreeningTypes, 2);
  assert.equal(decisions['K2-R29']!.thresholds!.maximumHoursExclusive, 24);
  assert.equal(decisions['K2-R30']!.thresholds!.maximumHoursExclusive, 24);
  assert.equal(decisions['K2-R36']!.thresholds!.minimumAdministrations, 2);
  assert.deepEqual(decisions['K2-R37']!.thresholds!.zScoreExclusiveBounds, [-3, -2]);
  assert.equal(decisions['K2-R38']!.thresholds!.lilaMaximumCmExclusive, 11.5);
  assert.equal(decisions['K2-R47']!.thresholds!.hbMaximumAgeDays, 7);
  assert.equal(decisions['K2-R56']!.thresholds!.minimumGrowthChecks, 8);
  assert.equal(decisions['K2-R56']!.thresholds!.minimumDevelopmentChecks, 2);
  assert.equal(decisions['K2-R63']!.thresholds!.minimumAnnualTablets, 26);
  assert.equal(decisions['K2-R64']!.thresholds!.requiredTdDoses, 2);
  assert.equal(decisions['K2-R65']!.thresholds!.maximumAgeYearsExclusive, 18);
  assert.equal(decisions['K2-R71']!.thresholds!.assistMinimumAgeYears, 15);
  assert.equal(decisions['K3-R20']!.thresholds!.hba1cMaximumExclusive, 7);
  assert.deepEqual(decisions['K3-R20']!.thresholds!.preprandialInclusive, [80, 130]);
  assert.equal(decisions['K3-R24']!.thresholds!.newTreatmentMonthsExclusive, 3);
  assert.equal(decisions['K3-R36']!.thresholds!.colorectalMinimumAge, 50);
  assert.equal(decisions['K3-R39']!.thresholds!.minimumRestMonths, 3);
  assert.deepEqual(decisions['K3-R43']!.thresholds!.postpartumDayWindow, [0, 42]);
});

test('mixed grain and source scale choices are explicit and testable, not silent corrections', () => {
  const leprosy = decisions['K3-R15']!.formula;
  assert.equal(leprosy?.operator, 'RATIO_PERCENT');
  if (leprosy?.operator !== 'RATIO_PERCENT') throw new Error('Missing leprosy literal ratio');
  assert.equal(leprosy.denominatorBasis, 'VISITS');
  assert.equal(leprosy.numeratorSubset, false);
  assert.ok(decisions['K3-R15']!.requiredContext.includes('mixedGrainAcknowledgement'));
  assert.ok(decisions['K3-R24']!.requiredContext.includes('percentScaleAcknowledgement'));
  assert.equal(1 / 4, 0.25);
  assert.equal(100 * 1 / 4, 25);
  assert.ok(decisions['K3-R9']!.requiredContext.includes('literalDenominatorScopeAcknowledgement'));
  for (const id of ['K3-R27', 'K3-R30']) assert.ok(decisions[id]!.requiredContext.includes('outOfAgeSymptomaticSeparateRegister'));
});
