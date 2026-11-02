import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { Polarity, Prisma, type Indicator } from '@prisma/client';
import { evaluateDataset } from '../src/analytics/evaluation';
import { SOURCE_ASSESSMENT_DECISIONS, evaluateSourceAssessment, sourceAssessmentDescriptor } from '../src/analytics/do2026/source-assessment';
import { scoreDo2026 } from '../src/analytics/do2026/scorer';
import { evaluateDoCumulative } from '../src/analytics/do2026/cumulative';
import { getDoProfile } from '../src/analytics/do2026/profiles';
import { DO_RULES } from '../src/analytics/do2026/rules';
import { sourceAssessmentFixture, sourceAssessmentRegressionCases, sourceVerifiedNihilFixture } from './source-assessment.fixtures';
import { EXPANDED_MANAGEMENT_FIXTURES } from './expanded-management.fixtures';
import { EXPANDED_CLINICAL_FIXTURES } from './expanded-clinical.fixtures';
import { EXPANDED_INFECTIOUS_CROSS_FIXTURES } from './expanded-infectious-cross.fixtures';

const fixtures = [
  ...EXPANDED_MANAGEMENT_FIXTURES.map(row => ({ id: row[0], n: row[7], d: row[8], expected: row[9] })),
  ...EXPANDED_CLINICAL_FIXTURES.map(row => ({ id: row[0], n: row[7], d: row[8], expected: row[9] })),
  ...EXPANDED_INFECTIOUS_CROSS_FIXTURES.map(row => ({ id: row[0], n: row[7], d: row[8], expected: row[9] })),
];
const months = Array.from({ length: 12 }, (_, index) => index + 1);
const evaluate = (input: ReturnType<typeof sourceAssessmentFixture>, id = 'K1-R11') => evaluateSourceAssessment(id, input, 2026, 12);
const reject = (fn: () => unknown) => assert.throws(fn, error => error instanceof BadRequestException);

test('272 identity contracts preserve the existing 79 rules and add 193 referenced assessment inputs', () => {
  assert.equal(Object.keys(DO_RULES).length, 79);
  assert.equal(Object.keys(SOURCE_ASSESSMENT_DECISIONS).length, 193);
  assert.equal(fixtures.length, 193);
  assert.equal(new Set(fixtures.map(row => row.id)).size, 193);
  let computable = 0;
  for (const { id } of fixtures) {
    assert.equal(DO_RULES[id], undefined);
    const profile = getDoProfile(id)!;
    assert.equal(profile.inputAvailable, true);
    assert.equal(profile.structuredInputKind, 'DO_SOURCE_ASSESSMENT');
    assert.ok(['CONTEXTUAL', 'SOURCE_INPUT_ONLY'].includes(profile.status));
    assert.equal(profile.sourceAssessment!.sourceDefinition!.definitionId, profile.definitionId);
    if (profile.calculationAvailability === 'AVAILABLE_WITH_CONTEXT') computable++;
  }
  // One measurement-only declaration collects components but supplies no composition rule.
  assert.equal(computable, 165);
});

for (const { id, n, d, expected } of fixtures) {
  test(`${id}: runtime source assessment matches independent source arithmetic or retains an explicit null`, () => {
    const input = sourceAssessmentFixture(id, n ?? 0, d ?? 0);
    const result = evaluate(input, id);
    const declaration = SOURCE_ASSESSMENT_DECISIONS[id]!;
    const oracle = declaration.readiness === 'SOURCE_CONFLICT' ? null : expected;
    if (oracle === null) assert.equal(result.measurementValue, null);
    else assert.ok(result.measurementValue !== null && Math.abs(result.measurementValue - oracle) < 1e-7, `${result.measurementValue} != ${oracle}`);
    assert.equal(result.nilaiKinerja, null);
    const scored = scoreDo2026(id, { numerator: result.numerator, denominator: result.denominator, structuredInput: input, sourceAssessmentConfirmed: true, year: 2026, endMonth: 12 });
    assert.equal(scored.measurementValue, result.measurementValue);
    assert.equal(scored.assessmentComplete, false);
    assert.equal(scored.completionScope, 'ARITHMETIC_ONLY');
    const missing = structuredClone(input);
    delete missing.context[Object.keys(missing.context)[0]!];
    reject(() => evaluate(missing, id));
    assert.equal(scoreDo2026(id, { numerator: 1, denominator: 1 }).measurementValue, null);
  });
}

test('strict protocol rejects identity, unknown schemas, missing evidence and confirmation-only bypasses', () => {
  const original = sourceAssessmentFixture('K1-R11', 9, 12);
  for (const input of [null, true, {}, { ...original, kind: 'PME_ANNUAL' }, { ...original, contractVersion: 'future' }, { ...original, definitionId: 'DO26-K1-R12' }, { ...original, year: 2027 }, { ...original, ignored: true }, { ...original, parameters: { factor: 0.5 } }, { ...original, context: { ...original.context, ignored: {} } }, { ...original, provenance: { ...original.provenance, numeratorEvidenceReference: '' } }, { ...original, attestation: { confirmed: true } }]) {
    reject(() => evaluateSourceAssessment('K1-R11', input, 2026, 12));
  }
  const bad = structuredClone(original); bad.context.year!.reference = '';
  reject(() => evaluate(bad));
  reject(() => evaluateSourceAssessment('constructor', original, 2026, 12));
  assert.equal(sourceAssessmentDescriptor('constructor'), undefined);
});

test('counts, decimals, fixed denominators, zero and unresolved attestations retain separate semantics', () => {
  for (const [n, d] of [[0.5, 12], [-1, 12], [13, 12], [1, 11], [NaN, 12], [Infinity, 12]]) reject(() => evaluate(sourceAssessmentFixture('K1-R11', n, d)));
  assert.equal(evaluate(sourceAssessmentFixture('K1-R11', 0, 12)).measurementValue, 0);
  const zero = evaluate(sourceAssessmentFixture('K5-R8', 0, 0), 'K5-R8');
  assert.deepEqual([zero.status, zero.measurementValue, zero.targetMet], ['ZERO_DENOMINATOR', null, null]);
  const pending = sourceAssessmentFixture('K1-R11', 9, 12); pending.context.year!.status = 'UNRESOLVED';
  assert.equal(evaluate(pending).status, 'CONTEXT_INCOMPLETE');
  const notApplicable = sourceAssessmentFixture('K5-R40'); notApplicable.attestation.status = 'NOT_APPLICABLE';
  assert.equal(evaluate(notApplicable, 'K5-R40').measurementValue, null);
  const money = sourceAssessmentFixture('K1-R146', 1100.55, 1000.5);
  assert.equal(evaluate(money, 'K1-R146').measurementValue, 110);
  money.values = { kind: 'RATIO_AGGREGATE', numerator: 1.12345, denominator: 10 };
  reject(() => evaluate(money, 'K1-R146'));
});

test('typed SASARAN origins, source-derived factors and uncapped excess cannot be tampered with', () => {
  const input = sourceAssessmentFixture('K2-R8', 11, 10);
  assert.equal(evaluate(input, 'K2-R8').measurementValue, 110);
  delete input.exceedReviewReference; reject(() => evaluate(input, 'K2-R8'));
  const decimal = sourceAssessmentFixture('K2-R8', 10, 10.5);
  reject(() => evaluate(decimal, 'K2-R8'));
  decimal.denominatorContext!.origin = 'ESTIMATED';
  assert.ok(evaluate(decimal, 'K2-R8').measurementValue);
  decimal.denominatorContext!.territoryReference = 'another territory'; reject(() => evaluate(decimal, 'K2-R8'));
  for (const [id, n, d] of [['K4-R14', 270, 540], ['K4-R15', 9, 10], ['K4-R19', 44, 40], ['K3-R10', 1, 64]] as const) {
    const sample = sourceAssessmentFixture(id, n, d);
    assert.equal(evaluate(sample, id).denominator, d);
    sample.values = { kind: 'RATIO_AGGREGATE', numerator: n, denominator: d * 2 };
    reject(() => evaluate(sample, id));
    sample.values.denominator = d;
    sample.parameters!.factor = 2; reject(() => evaluate(sample, id));
  }
  const allocation = sourceAssessmentFixture('K4-R15', 1, 1);
  allocation.parameters = { pkmPopulation: 1, districtPopulation: 3, districtEstimatedTbCases: 3 };
  assert.equal(evaluate(allocation, 'K4-R15').denominator, 1, 'exact cancellation must precede division rounding');
  allocation.parameters.districtEstimatedTbCases = 1;
  reject(() => evaluate(allocation, 'K4-R15'));
});

test('calendar month, quarter, snapshot and school year are not interchangeable with annual scope', () => {
  for (const id of ['K5-R22', 'K1-R13', 'K4-R33', 'K2-R61']) {
    const input = sourceAssessmentFixture(id);
    assert.notEqual(evaluate(input, id).status, 'INVALID_SOURCE_ASSESSMENT');
    input.period.startDate = '2026-01-01';
    reject(() => evaluate(input, id));
  }
  const wrongMonth = sourceAssessmentFixture('K5-R22'); wrongMonth.period.month = 11;
  reject(() => evaluate(wrongMonth, 'K5-R22'));
  const quarterString = sourceAssessmentFixture('K1-R13'); (quarterString.period as unknown as Record<string, unknown>).quarter = '4';
  reject(() => evaluate(quarterString, 'K1-R13'));
  const leap = sourceAssessmentFixture('K4-R33'); leap.period.startDate = leap.period.endDate = leap.period.cutoffDate = leap.period.asOf = '2026-02-29';
  reject(() => evaluateSourceAssessment('K4-R33', leap, 2026, 2));
});

test('vaccine denominator is the exact calendar month, including leap years, never an attested arbitrary D', () => {
  const descriptor = sourceAssessmentDescriptor('K1-R34')!;
  assert.equal(descriptor.denominatorRule!.kind, 'CALENDAR_MONTH_DAYS');
  assert.equal(descriptor.denominatorRule!.sourceRef, 'S1:KLASTER I!F34');
  assert.match(descriptor.denominatorRule!.sourceQuote, /jumlah hari dalam satu bulan/);
  assert.equal(sourceAssessmentDescriptor('K1-R11')!.denominatorRule!.kind, 'FIXED');
  for (const { year, month, days, numerator, measurement } of sourceAssessmentRegressionCases.vaccineMonths) {
    const input = sourceAssessmentFixture('K1-R34', numerator, days);
    input.year = year;
    input.period = { kind: 'MONTH', month, startDate: `${year}-${String(month).padStart(2, '0')}-01`, endDate: `${year}-${String(month).padStart(2, '0')}-${days}`, cutoffDate: `${year}-${String(month).padStart(2, '0')}-${days}`, reference: 'QA complete calendar month' };
    assert.equal(evaluateSourceAssessment('K1-R34', input, year, month).measurementValue, measurement);
    for (const denominator of [1, days - 1, days + 1]) {
      input.values = { kind: 'RATIO_AGGREGATE', numerator, denominator };
      reject(() => evaluateSourceAssessment('K1-R34', input, year, month));
    }
    input.values = { kind: 'RATIO_AGGREGATE', numerator: days + 1, denominator: days };
    reject(() => evaluateSourceAssessment('K1-R34', input, year, month));
  }
});

test('last two document assessment years are anchored to cutoff with an explicit provisional convention', () => {
  for (const id of ['K1-R137', 'K1-R138']) {
    const descriptor = sourceAssessmentDescriptor(id)!;
    assert.equal(descriptor.periodWindowRule!.kind, 'CURRENT_AND_PREVIOUS_ASSESSMENT_YEAR_TO_CUTOFF');
    assert.equal(descriptor.periodWindowRule!.authority, 'PROVISIONAL_TECHNICAL_CONVENTION_NOT_SOURCE_MANDATED');
    assert.match(descriptor.periodWindowRule!.sourceQuote, /dua tahun terakhir/);
    assert.match(descriptor.periodInstruction, /Konvensi teknis provisional/);
    const input = sourceAssessmentFixture(id, 1, 1);
    assert.equal(evaluate(input, id).measurementValue, 100);
    input.period.endDate = input.period.cutoffDate = '2026-11-15';
    assert.equal(evaluateSourceAssessment(id, input, 2026, 11).measurementValue, 100);
    for (const [startDate, endDate] of [['2000-01-01', '2001-12-31'], ['2024-01-01', '2025-12-31'], ['2025-06-01', '2026-11-15'], ['2025-01-01', '2026-11-14'], ['2025-01-01', '2026-12-31']]) {
      reject(() => evaluateSourceAssessment(id, { ...input, period: { ...input.period, startDate, endDate } }, 2026, 11));
    }
    input.period = { ...input.period, cutoffDate: '2026-12-31', endDate: '2025-12-31' };
    reject(() => evaluate(input, id));
  }
});

test('exact scaled denominator derivation rejects near-integer repeating fractions and preserves exact factors', () => {
  const input = sourceAssessmentFixture('K4-R15', 1, sourceAssessmentRegressionCases.roundedAllocationDenominator);
  input.parameters = { ...sourceAssessmentRegressionCases.repeatingAllocation };
  assert.equal(sourceAssessmentDescriptor('K4-R15')!.denominatorRule!.kind, 'SOURCE_PARAMETERS');
  reject(() => evaluate(input, 'K4-R15'));
  input.parameters = { pkmPopulation: 9999999999, districtPopulation: 9999999999, districtEstimatedTbCases: 9999999999.0001 };
  input.values = { kind: 'RATIO_AGGREGATE', numerator: 1, denominator: 9999999999.0001 };
  assert.equal(evaluate(input, 'K4-R15').denominator, 9999999999.0001);
  input.parameters = { pkmPopulation: 1, districtPopulation: 3, districtEstimatedTbCases: 3 };
  input.values.denominator = 1;
  assert.equal(evaluate(input, 'K4-R15').denominator, 1);
  input.parameters.districtEstimatedTbCases = 1; reject(() => evaluate(input, 'K4-R15'));
  const factor = sourceAssessmentFixture('K4-R14', 0, 0.0005);
  factor.parameters = { detectionTarget: 0.0001 }; reject(() => evaluate(factor, 'K4-R14'));
  factor.parameters.detectionTarget = 0.0005;
  factor.values = { kind: 'RATIO_AGGREGATE', numerator: 0, denominator: 0.0027 };
  assert.equal(evaluate(factor, 'K4-R14').denominator, 0.0027);
  factor.parameters.detectionTarget = 9999999999; reject(() => evaluate(factor, 'K4-R14'));
  const population = sourceAssessmentFixture('K3-R10', 0, 0.0064);
  population.parameters = { population: 1 };
  assert.equal(evaluate(population, 'K3-R10').denominator, 0.0064);
});

test('Dinsos nihil is explicit, scope-bound and never a percentage, numeric score or source-conflict override', () => {
  for (const id of ['K3-R11', 'K3-R48', 'K3-R49']) {
    const input = sourceAssessmentFixture(id, 0, 0);
    assert.equal(evaluate(input, id).status, 'ZERO_DENOMINATOR');
    input.verifiedNihil = sourceVerifiedNihilFixture(input);
    const result = evaluate(input, id);
    assert.deepEqual([result.status, result.targetMet, result.measurementValue, result.capaianRiilPct, result.nilaiKinerja], ['VERIFIED_NO_CASE_TARGET_MET', true, null, null, null]);
    const scored = scoreDo2026(id, { numerator: 0, denominator: 0, structuredInput: input, sourceAssessmentConfirmed: true, year: 2026, endMonth: 12 });
    assert.deepEqual([scored.targetMet, scored.assessmentComplete, scored.nilaiKinerja], [true, false, null]);
    assert.equal(sourceAssessmentDescriptor(id)!.verifiedNihilRule!.available, true);
    assert.match(sourceAssessmentDescriptor(id)!.verifiedNihilRule!.sourceQuote, /Dinas Sosial/);
    for (const patch of [{ dinsosReference: '' }, { cohortAbsenceReference: '' }, { noResidualPriorYearObligationConfirmed: false }, { noResidualPriorYearObligationConfirmed: null }, { definitionId: 'wrong' }, { year: 2025 }, { periodStartDate: '2025-01-01' }, { periodEndDate: '2026-11-30' }, { cutoffDate: '2026-11-30' }, { territoryReference: 'other territory' }, { unknownField: true }]) {
      reject(() => evaluate({ ...input, verifiedNihil: { ...input.verifiedNihil, ...patch } } as typeof input, id));
    }
    const missing = structuredClone(input) as unknown as { verifiedNihil: Record<string, unknown> };
    delete missing.verifiedNihil.noResidualPriorYearObligationConfirmed;
    reject(() => evaluate(missing as unknown as typeof input, id));
    for (const status of ['INCOMPLETE', 'NOT_APPLICABLE', 'NOT_YET_DUE'] as const) reject(() => evaluate({ ...input, attestation: { ...input.attestation, status } }, id));
    for (const key of ['sourceCoverageComplete', 'eligibilityReviewed', 'grainReconciled']) reject(() => evaluate({ ...input, attestation: { ...input.attestation, [key]: false } }, id));
    const unresolved = structuredClone(input); unresolved.context[Object.keys(unresolved.context)[0]!]!.status = 'UNRESOLVED';
    reject(() => evaluate(unresolved, id));
    reject(() => evaluate({ ...input, values: { kind: 'RATIO_AGGREGATE', numerator: 1, denominator: 1 } }, id));
  }
  const blocked = sourceAssessmentFixture('K3-R12', 0, 0);
  assert.deepEqual([evaluate(blocked, 'K3-R12').status, evaluate(blocked, 'K3-R12').targetMet], ['SOURCE_UNRESOLVED', null]);
  blocked.verifiedNihil = sourceVerifiedNihilFixture(blocked);
  reject(() => evaluate(blocked, 'K3-R12'));
  assert.equal(sourceAssessmentDescriptor('K3-R12')!.verifiedNihilRule!.available, false);
  const other = sourceAssessmentFixture('K5-R8', 0, 0);
  other.verifiedNihil = sourceVerifiedNihilFixture(other);
  reject(() => evaluate(other, 'K5-R8'));
});

test('source recaps remain observable without leaking December snapshots or mixed V1 into annual reports', () => {
  for (const id of ['K5-R22', 'K4-R33', 'K2-R61', 'K1-R13']) {
    const input = sourceAssessmentFixture(id);
    const assessed = evaluate(input, id);
    const recap = { numerator: assessed.numerator, denominator: assessed.denominator, endMonth: 12, revision: 1, notes: 'QA source attestation', scoringVersion: 'DO_2026_V2', confirmed: true, structuredInput: input };
    const scope = { records: [{ month: 12, pencapaianRiil: 100, totalSasaran: 100, scoringVersion: 'ILP_2026_V1', inputBasis: 'YTD_ACTUAL' }], recap, months, year: 2026 };
    const report = evaluateDoCumulative(id, scope);
    assert.deepEqual([report.measurementValue, report.numerator, report.dataComplete, report.status], [null, null, false, 'ASSESSMENT_SCOPE_MISMATCH']);
    assert.equal(report.assessmentScope!.kind, input.period.kind);
    assert.deepEqual(report.recapStructuredInput, input);
    const sourceView = evaluateDoCumulative(id, { ...scope, purpose: 'SOURCE_RECAP' });
    assert.equal(sourceView.measurementValue, assessed.measurementValue);
    assert.equal(sourceView.populatedMonths, 0);
    assert.equal(evaluateDoCumulative(id, { ...scope, recap: undefined }).measurementValue, null);
  }
});

test('dataset selects exact month/quarter assessments but never promotes them to YTD or annual', () => {
  for (const [id, selectedMonths] of [['K5-R22', [12]], ['K1-R13', [10, 11, 12]]] as const) {
    const structuredInput = sourceAssessmentFixture(id);
    const derived = evaluate(structuredInput, id);
    const indicator = { id, sectionCode: '1', klasterId: 1, polarity: Polarity.HIGHER_IS_BETTER, targetNumeric: new Prisma.Decimal(100), scoringVersion: 'ILP_2026_V1' } as Indicator;
    const data = {
      indicators: [indicator], targets: [], records: [],
      sections: [{ code: '1', name: 'QA', parentCode: null, klasterId: 1, order: 1 }],
      recaps: [{ indicatorId: id, numerator: derived.numerator, denominator: derived.denominator, structuredInput, endMonth: 12, revision: 1, notes: 'Referenced source', confirmed: true, scoringVersion: 'DO_2026_V2' }],
    };
    const exact = evaluateDataset(data, [...selectedMonths], 2026).items[0]!;
    assert.equal(exact.measurementValue, derived.measurementValue);
    assert.equal(exact.scoringVersion, 'DO_2026_V2');
    assert.equal(exact.nilaiKinerja, null);
    const annual = evaluateDataset(data, months, 2026).items[0]!;
    assert.equal(annual.status, 'ASSESSMENT_SCOPE_MISMATCH');
    assert.equal(annual.measurementValue, null);
    assert.equal(annual.pencapaianRiil, null);
    if (selectedMonths.length === 3) {
      assert.equal(evaluateDataset(data, [12], 2026).items[0]!.status, 'ASSESSMENT_SCOPE_MISMATCH');
      assert.equal(evaluateDoCumulative(id, { months: [10, 10, 12], records: [], recap: data.recaps[0], year: 2026 }).status, 'ASSESSMENT_SCOPE_MISMATCH');
    }
  }
});
