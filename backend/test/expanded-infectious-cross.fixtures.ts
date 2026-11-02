import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  EXPANDED_INFECTIOUS_CROSS_CONTRACT,
  EXPANDED_INFECTIOUS_CROSS_DECISIONS,
  type InfectiousCrossDecision,
} from '../src/analytics/do2026/expanded-infectious-cross';

// Independent S1 oracles, not generated from the declarations or achievement data.
// id, source row, raw target, percent target, period, readiness, operator, N, effective D, result.
// Null means source-blocked/components-only, not zero, N/A or a numeric performance score.
export const EXPANDED_INFECTIOUS_CROSS_FIXTURES = [
  ['K4-R12', 11, 0.55, 55, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 4, 5, 80],
  ['K4-R14', 13, 1, 100, 'ANNUAL', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 270, 540, 50],
  ['K4-R15', 14, 0.9, 90, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 9, 10, 90],
  ['K4-R19', 18, 0.8, 80, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 44, 40, 110],
  ['K4-R22', 21, 1, 100, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 0, 10, null],
  ['K4-R23', 22, 1, 100, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 9, 10, 90],
  ['K4-R24', 23, 1, 100, 'COHORT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 3, 4, 75],
  ['K4-R25', 24, 1, 100, 'MONTH', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 4, 5, 80],
  ['K4-R28', 27, 1, 100, 'MONTH', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 3, 4, 75],
  ['K4-R29', 28, 0.8, 80, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'COMPONENTS_ONLY', null, null, null],
  ['K4-R33', 32, 0.2, 20, 'AS_OF', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 1, 5, 20],
  ['K4-R36', 35, 0.2, 20, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 1, 5, null],
  ['K4-R37', 36, 0.2, 20, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 1, 5, null],
  ['K5-R8', 7, 0.8, 80, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 8, 10, 80],
  ['K5-R9', 8, 0.8, 80, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 7, 10, 70],
  ['K5-R10', 9, 0.8, 80, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 9, 10, 90],
  ['K5-R12', 11, 1, 100, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 19, 20, 95],
  ['K5-R13', 12, 1, 100, 'AS_OF', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 9, 10, null],
  ['K5-R14', 13, 1, 100, 'AS_OF', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 9, 10, null],
  ['K5-R15', 14, 0.8, 80, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 4, 5, 80],
  ['K5-R16', 15, 0.3, 30, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 8, 10, null],
  ['K5-R17', 16, 1, 100, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 10, 10, null],
  ['K5-R20', 19, 0.8, 80, 'AS_OF', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 8, 10, 80],
  ['K5-R22', 21, 0.8, 80, 'MONTH', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 17, 20, 85],
  ['K5-R27', 26, 0.8, 80, 'MONTH', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 30, 10, null],
  ['K5-R28', 27, 0.05, 5, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 12, 10, null],
  ['K5-R29', 28, 0.8, 80, 'ANNUAL', 'MEASUREMENT_ONLY', 'RATIO_PERCENT', 16, 20, 80],
  ['K5-R36', 35, 1, 100, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 3, 4, 75],
  ['K5-R40', 39, 1, 100, 'EXPLICIT_WINDOW', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 9, 10, 90],
  ['K5-R41', 40, 1, 100, 'AS_OF', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 5, 8, 62.5],
  ['K5-R42', 41, 1, 100, 'EXPLICIT_WINDOW', 'SOURCE_CONFLICT', 'RATIO_PERCENT', 10, 10, null],
  ['K5-R44', 43, 1, 100, 'AS_OF', 'SOURCE_CONFLICT', 'COMPONENTS_ONLY', null, null, null],
  ['K5-R48', 47, 1, 100, 'MONTH', 'CONTEXT_REQUIRED', 'RATIO_PERCENT', 1, 2, 50],
] as const;

// One missing-context negative per source. These are portable integration obligations,
// not claims that a production validator or the evidence itself has been tested here.
export const INFECTIOUS_CROSS_CONTEXT_NEGATIVES = [
  ['K4-R12', 'sevenComponentEvidence', 'Six components cannot establish a complete response.'],
  ['K4-R14', 'detectionTargetReference', 'Actual suspects cannot replace the estimate.'],
  ['K4-R15', 'districtPopulation', 'No allocation with a missing/zero district population.'],
  ['K4-R19', 'contactToIndexLinks', 'Doses or contacts with no index linkage are not eligible contacts.'],
  ['K4-R22', 'noCaseExclusionScopeDecisionReference', 'Zero positives must not hide untested suspects.'],
  ['K4-R23', 'patientCaseGrainDecisionReference', 'One patient with two unlike episodes is not one ever-treated success.'],
  ['K4-R24', 'maturityAndCutoffReference', 'Day28 not yet due cannot be declared complete or zero.'],
  ['K4-R25', 'caseMonthAndPeLinks', 'A PE in a different month cannot be moved silently.'],
  ['K4-R28', 'schoolRosterReference', 'Schools reached last month cannot fill a missing current month.'],
  ['K4-R29', 'compositionDecisionReference', 'Do not invent component denominators or 50:50 weights.'],
  ['K4-R33', 'fivePillarsSameAssessment', 'Pillars from different dates do not establish STBM.'],
  ['K4-R36', 'titlePopulationDecisionReference', 'Village arithmetic does not resolve a Puskesmas title.'],
  ['K4-R37', 'titlePopulationDecisionReference', 'Patient arithmetic does not resolve a Puskesmas title.'],
  ['K5-R8', 'repeatOutcomeDecisionReference', 'A second untreated caries need cannot be hidden by first treatment.'],
  ['K5-R9', 'completeE8DiagnosisScope', 'Pulpitis alone is not the complete pulpal/periradicular diagnosis scope.'],
  ['K5-R10', 'completeE9DiagnosisScope', 'All dental disease cannot replace the periodontal scope.'],
  ['K5-R12', 'repeatOutcomeDecisionReference', 'Timely first admission does not erase an inappropriate repeat admission.'],
  ['K5-R13', 'certificateConjunctionOrAlternativeDecisionReference', 'One of three certificates cannot resolve and versus examples.'],
  ['K5-R14', 'certificateConjunctionOrAlternativeDecisionReference', 'Nurse certificate equivalence cannot be inferred.'],
  ['K5-R15', 'doorArrivalAndInitialMedicalTimestamps', 'Registration time cannot replace door arrival.'],
  ['K5-R16', 'sisruteRubricDecisionReference', '30/80 percent boundaries cannot be filled by chained comparisons.'],
  ['K5-R17', 'twentyFourHourOriginAndEndpointDecisionReference', 'Do not invent the 24-hour origin or drop non-consented patients from D.'],
  ['K5-R20', 'standardVersionAndApplicabilityReference', 'Examples or a revoked reference are not a complete current inventory.'],
  ['K5-R22', 'monthlySnapshotMethodReference', 'Do not pick December or pool monthly drug snapshots.'],
  ['K5-R27', 'activityVersusBundleDecisionReference', 'Three activities per prescription are not automatically 300 percent coverage.'],
  ['K5-R28', 'sessionPatientDenominatorDecisionReference', 'Counselling sessions cannot silently become unique patients.'],
  ['K5-R29', 'minimumAndRatioDecisionReference', '80 percent with only eight activities does not resolve the minimum twelve.'],
  ['K5-R36', 'multipleResultOutcomeDecisionReference', 'One timely test among several requests is not automatically a timely patient.'],
  ['K5-R40', 'inpatientApplicabilityAndServiceReference', 'No inpatient service is not zero eligible patients or automatic 100.'],
  ['K5-R41', 'requiredDocumentInventoryAndQuantities', 'Four document headings do not prove D=4.'],
  ['K5-R42', 'reconciliationVersusConsumptionDecisionReference', 'Taking medicine does not prove reconciliation.'],
  ['K5-R44', 'minimumSkOperatorDecisionReference', 'One decree and one SOP cannot resolve >=1 versus >1 decree.'],
  ['K5-R48', 'physiotherapistAssignmentAndQualification', 'Documented service alone does not establish a qualified physiotherapist.'],
] as const;

type Source = { indicatorId: string; definitionId: string; sourceRef: string; calculation: string; target: { raw: number; excel_number_format: string } };
const source = JSON.parse(readFileSync(new URL('../src/analytics/do2026/source.json', import.meta.url), 'utf8')) as Source[];
const decisions: Readonly<Record<keyof typeof EXPANDED_INFECTIOUS_CROSS_DECISIONS, InfectiousCrossDecision>> = EXPANDED_INFECTIOUS_CROSS_DECISIONS;

// A test-only arithmetic interpreter. It intentionally cannot establish source eligibility,
// choose a period, validate clinical outcomes or stand in for the coordinator's runtime.
function declaredArithmetic(decision: InfectiousCrossDecision, n: unknown, d: unknown): number | null {
  if (decision.calculability !== 'RATIO_WITH_CONTEXT' || decision.formula.operator !== 'RATIO_PERCENT') return null;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return null;
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return null;
  if (decision.formula.input === 'INTEGER' && !Number.isSafeInteger(d)) return null;
  if (decision.formula.numeratorSubset === true && n > d) return null;
  return n * 100 / d;
}

test('infectious/cross source inventory is exactly the remaining 33 source identities', () => {
  assert.equal(EXPANDED_INFECTIOUS_CROSS_FIXTURES.length, 33);
  assert.equal(new Set(EXPANDED_INFECTIOUS_CROSS_FIXTURES.map(([id]) => id)).size, 33);
  assert.deepEqual(Object.keys(decisions).sort(), EXPANDED_INFECTIOUS_CROSS_FIXTURES.map(([id]) => id).sort());
  assert.equal(Object.keys(decisions).filter((id) => id.startsWith('K4-')).length, 13);
  assert.equal(Object.keys(decisions).filter((id) => id.startsWith('K5-')).length, 20);
  assert.equal(EXPANDED_INFECTIOUS_CROSS_CONTRACT.status, 'PROVISIONAL_SOURCE_DECLARATIONS');
  assert.equal(INFECTIOUS_CROSS_CONTEXT_NEGATIVES.length, 33);
});

for (const [id, row, raw, target, period, readiness, operator, n, d, expected] of EXPANDED_INFECTIOUS_CROSS_FIXTURES) {
  test(`${id}: independent identity, raw formula/target, Excel unit and period oracle`, () => {
    const decision = decisions[id];
    const original = source.find((entry) => entry.indicatorId === id);
    assert.ok(original);
    const cluster = id.startsWith('K4-') ? 4 : 5;
    const sheet = cluster === 4 ? 'KLASTER 4' : 'LINTAS KLASTER';
    const ref = `S1:${sheet}!A${row}:${cluster === 4 ? 'J' : 'I'}${row}`;
    assert.equal(decision.definitionId, `DO26-K${cluster}-R${row}`);
    assert.equal(decision.sourceRef, ref);
    assert.equal(original.definitionId, decision.definitionId);
    assert.equal(original.sourceRef, ref);
    assert.equal(original.target.raw, raw);
    assert.equal(original.target.excel_number_format, '0%');
    assert.equal(decision.target.raw, raw);
    assert.equal(decision.target.value, target);
    assert.equal(decision.target.excelNumberFormat, '0%');
    assert.equal(decision.target.unit, 'PERCENT');
    assert.equal(decision.formulaRaw, original.calculation);
    assert.equal(decision.formula.operator, operator);
    assert.equal(decision.readiness, readiness);
    assert.equal(decision.period, period);
    assert.ok(decision.criteria.length > 0);
    assert.ok(decision.requiredContext.length >= 3);
    if (readiness === 'SOURCE_CONFLICT') assert.ok(decision.unresolved.length > 0);
    if (decision.calculability !== 'RATIO_WITH_CONTEXT') assert.equal(decision.target.comparator, 'UNRESOLVED');
  });

  test(`${id}: independent arithmetic oracle (or deliberate source block)`, () => {
    assert.equal(declaredArithmetic(decisions[id], n, d), expected);
    assert.equal(declaredArithmetic(decisions[id], 0, 0), null);
    assert.equal(declaredArithmetic(decisions[id], 1, 0), null);
    assert.equal(declaredArithmetic(decisions[id], undefined, 10), null);
    assert.equal(declaredArithmetic(decisions[id], 1, undefined), null);
    assert.equal(declaredArithmetic(decisions[id], -1, 10), null);
    assert.equal(declaredArithmetic(decisions[id], '1', 10), null);
    assert.equal(declaredArithmetic(decisions[id], 1, Infinity), null);
    assert.equal(declaredArithmetic(decisions[id], NaN, 10), null);
    assert.equal(declaredArithmetic(decisions[id], 1.5, 10), null);
    if (expected !== null) assert.equal(declaredArithmetic(decisions[id], 0, d), 0);
  });
}

for (const [id, missingField, reason] of INFECTIOUS_CROSS_CONTEXT_NEGATIVES) {
  test(`${id}: negative integration obligation retains ${missingField}`, () => {
    assert.ok(decisions[id].requiredContext.includes(missingField), reason);
    const requirements = new Set(decisions[id].requiredContext);
    assert.equal(requirements.size, decisions[id].requiredContext.length);
    assert.ok(reason.length > 20);
  });
}

test('raw declarations independently match Markdown raw records, not review annotations', () => {
  const records: { id: string; catalogue_candidate: string; cara_penghitungan_raw: string; target: { raw: number; excel_number_format: string } }[] = [];
  for (const name of ['13-klaster-4-menular-lingkungan-bagian-1.md', '13-klaster-4-menular-lingkungan-bagian-2.md', '14-lintas-klaster-bagian-1.md', '14-lintas-klaster-bagian-2.md']) {
    const text = readFileSync(new URL(`../../docs/pkp-2026/${name}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/```json\s*([\s\S]*?)```/g)) records.push(JSON.parse(match[1]!));
  }
  for (const [id] of EXPANDED_INFECTIOUS_CROSS_FIXTURES) {
    const original = records.find((record) => record.catalogue_candidate === id);
    assert.ok(original, id);
    assert.equal(decisions[id].definitionId, original.id);
    assert.equal(decisions[id].formulaRaw, original.cara_penghitungan_raw);
    assert.equal(decisions[id].target.raw, original.target.raw);
    assert.equal(decisions[id].target.excelNumberFormat, original.target.excel_number_format);
  }
});

test('estimate factors are denominator factors, not target scaling or per-100000 rates', () => {
  const tb = decisions['K4-R14'].formula;
  const allocation = decisions['K4-R15'].formula;
  const leprosy = decisions['K4-R19'].formula;
  assert.equal(tb.operator, 'RATIO_PERCENT');
  assert.equal(allocation.operator, 'RATIO_PERCENT');
  assert.equal(leprosy.operator, 'RATIO_PERCENT');
  if (tb.operator !== 'RATIO_PERCENT' || allocation.operator !== 'RATIO_PERCENT' || leprosy.operator !== 'RATIO_PERCENT') assert.fail();
  assert.equal(tb.denominatorDerivation, 'TB_DETECTION_TARGET_TIMES_FACTORS');
  assert.deepEqual(tb.documentedFactors, [0.54, 10]);
  assert.equal(100 * tb.documentedFactors![0]! * tb.documentedFactors![1]!, 540);
  assert.equal(allocation.denominatorDerivation, 'REGIONAL_POPULATION_ALLOCATION');
  assert.equal(10000 / 100000 * 100, 10);
  assert.equal(leprosy.denominatorDerivation, 'INDEX_CASES_TIMES_CONTACT_FACTOR');
  assert.deepEqual(leprosy.documentedFactors, [20]);
  assert.equal(2 * leprosy.documentedFactors![0]!, 40);
  assert.equal(declaredArithmetic(decisions['K4-R14'], 1, 5.4e-1), 185.18518518518516);
  assert.equal(declaredArithmetic(decisions['K4-R15'], 20, 12.3), 162.60162601626016);
  assert.equal(declaredArithmetic(decisions['K4-R19'], 44, 40), 110);
  for (const id of ['K4-R14', 'K4-R15', 'K4-R19'] as const) {
    const formula = decisions[id].formula;
    assert.equal(formula.operator === 'RATIO_PERCENT' && formula.numeratorSubset, false);
    assert.ok(decisions[id].requiredContext.includes('exceedReviewReference'));
  }
});

test('actual subset counts reject impossible or fractional denominators', () => {
  assert.equal(declaredArithmetic(decisions['K5-R48'], 3, 2), null);
  assert.equal(declaredArithmetic(decisions['K5-R22'], 1, 1.5), null);
  assert.equal(declaredArithmetic(decisions['K5-R22'], 1, '2'), null);
  assert.equal(declaredArithmetic(decisions['K5-R22'], Number.MAX_SAFE_INTEGER + 1, 1e20), null);
});

test('KLB seven days inclusive and emergency response thirty minutes exclusive stay different', () => {
  assert.equal(decisions['K4-R12'].thresholds?.maximumResponseDaysInclusive, 7);
  assert.equal(decisions['K4-R12'].thresholds?.requiredComponents, 7);
  assert.equal(decisions['K5-R15'].thresholds?.responseMinutesExclusive, 30);
  const klbDays = [6.999, 7, 7.001];
  const ugdMinutes = [29.999, 30, 30.001];
  assert.deepEqual(klbDays.map((days) => days <= 7), [true, true, false]);
  assert.deepEqual(ugdMinutes.map((minutes) => minutes < 30), [true, false, false]);
  assert.equal(decisions['K4-R12'].applicability, 'EXCLUDE_EVIDENCED_NO_KLB');
  assert.equal(decisions['K4-R22'].applicability, 'MALARIA_NO_CASE_SCOPE_UNRESOLVED');
  assert.equal(declaredArithmetic(decisions['K4-R22'], 0, 10), null);
});

test('malaria follow-up uses the case cohort, not test/visit counts or new-case cohorts from another row', () => {
  assert.deepEqual(decisions['K4-R24'].thresholds?.followUpDays, [3, 7, 14, 21, 28]);
  assert.equal(decisions['K4-R24'].period, 'COHORT_WINDOW');
  assert.ok(decisions['K4-R24'].requiredContext.includes('negativeEndpointPolicyReference'));
  assert.ok(decisions['K4-R24'].requiredContext.includes('crossYearPolicyReference'));
  assert.equal(declaredArithmetic(decisions['K4-R24'], 5, 1), null);
  assert.equal(decisions['K4-R23'].kind, 'MIXED_GRAIN_RATIO');
  assert.equal(decisions['K4-R25'].kind, 'MIXED_GRAIN_RATIO');
  assert.equal(decisions['K4-R25'].period, 'MONTH');
  assert.match(decisions['K4-R15'].criteria.join(' '), /tidak membatasi ke kasus baru/);
  assert.match(decisions['K4-R19'].criteria.join(' '), /bukan.*kasus baru mulai pengobatan/);
});

test('dengue components and SK/SOP conflicts are typed collection, not invented arithmetic', () => {
  const dengue = decisions['K4-R29'].formula;
  const decree = decisions['K5-R44'].formula;
  assert.equal(dengue.operator, 'COMPONENTS_ONLY');
  assert.equal(decree.operator, 'COMPONENTS_ONLY');
  if (dengue.operator !== 'COMPONENTS_ONLY' || decree.operator !== 'COMPONENTS_ONLY') assert.fail();
  assert.deepEqual(dengue.components.map((component) => component.key), ['epidemiologyOrDetection', 'psn']);
  assert.ok(dengue.components.every((component) => component.unit === 'SOURCE_UNRESOLVED'));
  assert.deepEqual(decree.components.map((component) => component.key), ['skCount', 'sopCount']);
  assert.equal(declaredArithmetic(decisions['K4-R29'], 100, 2), null);
  assert.equal(declaredArithmetic(decisions['K5-R44'], 2, 2), null);
});

test('STBM requires all pillars in one assessment, not mean of thresholds', () => {
  assert.deepEqual(decisions['K4-R33'].thresholds, { pillar1Percent: 100, pillar2To4MinimumPercent: 75, pillar5MinimumPercent: 30 });
  const qualifies = (values: [number, number, number, number, number]) => values[0] === 100 && values.slice(1, 4).every((value) => value >= 75) && values[4] >= 30;
  assert.equal(qualifies([100, 75, 75, 75, 30]), true);
  assert.equal(qualifies([99.999, 100, 100, 100, 100]), false);
  assert.equal(qualifies([100, 74.999, 100, 100, 100]), false);
  assert.equal(qualifies([100, 75, 75, 75, 29.999]), false);
});

test('pharmacy monthly snapshots, activity/prescription and session/patient grains remain distinct', () => {
  assert.equal(decisions['K5-R22'].period, 'MONTH');
  assert.equal(decisions['K5-R22'].kind, 'SNAPSHOT');
  assert.equal(declaredArithmetic(decisions['K5-R22'], 8, 10), 80);
  assert.equal(declaredArithmetic(decisions['K5-R22'], 19, 20), 95);
  assert.equal(decisions['K5-R27'].period, 'MONTH');
  assert.equal(declaredArithmetic(decisions['K5-R27'], 30, 10), null);
  assert.equal(declaredArithmetic(decisions['K5-R28'], 12, 10), null);
  assert.equal(decisions['K5-R29'].thresholds?.minimumAnnualActivities, 12);
  assert.equal(declaredArithmetic(decisions['K5-R29'], 8, 10), 80);
  assert.equal(decisions['K5-R29'].target.comparator, 'UNRESOLVED');
  assert.equal(declaredArithmetic(decisions['K5-R29'], 24, 20), 120);
});

test('laboratory patients are not tests, panels, repeated requests or a universal waiting threshold', () => {
  const lab = decisions['K5-R36'];
  assert.ok(lab.requiredContext.includes('patientTestAndRepeatedRequestLinks'));
  assert.ok(lab.requiredContext.includes('testSpecificWaitPolicyWithOperators'));
  assert.ok(lab.requiredContext.includes('sampleExpertiseAndReceiptTimestamps'));
  assert.equal(lab.thresholds, undefined);
  assert.match(lab.formula.operator === 'RATIO_PERCENT' ? lab.formula.denominator : '', /pasien/);
  assert.equal(declaredArithmetic(lab, 5, 2), null);
});

test('inpatient and physiotherapy applicability are evidence gates, never D=0 success', () => {
  for (const id of ['K5-R40', 'K5-R41', 'K5-R42'] as const) assert.equal(decisions[id].applicability, 'INPATIENT_SERVICE_REQUIRED');
  assert.equal(decisions['K5-R48'].applicability, 'PHYSIOTHERAPIST_AND_ROOM_REQUIRED');
  assert.ok(decisions['K5-R48'].requiredContext.includes('physicalOccupationalSpeechRoomEvidence'));
  assert.equal(decisions['K5-R48'].period, 'MONTH');
  assert.equal(declaredArithmetic(decisions['K5-R48'], 1, 2), 50); // Two services, one patient, one documented.
  assert.equal(declaredArithmetic(decisions['K5-R48'], 0, 0), null);
  assert.equal(decisions['K5-R41'].formula.operator, 'RATIO_PERCENT');
  assert.equal(declaredArithmetic(decisions['K5-R41'], 4, 8), 50); // Four headings are not the inventory D.
  assert.equal(declaredArithmetic(decisions['K5-R42'], 10, 10), null);
});
