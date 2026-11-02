import { getDoProfile } from '../backend/src/analytics/do2026/profiles';
import { SOURCE_ASSESSMENT_DECISIONS, evaluateSourceAssessment, sourceAssessmentDescriptor, type SourceAssessmentInput } from '../backend/src/analytics/do2026/source-assessment';
import { sourceAssessmentFixture, sourceAssessmentRegressionCases, sourceVerifiedNihilFixture } from '../backend/test/source-assessment.fixtures';

// Executed in Node only. Browser bundles never import backend code or patient data.
const rows = Object.keys(SOURCE_ASSESSMENT_DECISIONS).map(id => {
  const descriptor = sourceAssessmentDescriptor(id)!;
  const input = sourceAssessmentFixture(id);
  if (input.values.kind === 'RATIO_AGGREGATE') {
    const formula = descriptor.formula;
    if (formula?.operator === 'RATIO_PERCENT' && 'fixedDenominator' in formula && formula.fixedDenominator !== undefined) input.values.denominator = formula.fixedDenominator;
    if (id === 'K4-R14') input.values.denominator = 540;
    if (id === 'K4-R15') input.values.denominator = 10;
    if (id === 'K4-R19') input.values.denominator = 40;
    if (id === 'K3-R10') input.values.denominator = 64;
    if (id === 'K1-R34') input.values.denominator = 31;
  }
  const result = evaluateSourceAssessment(id, input, 2026, 12);
  const invalidNihil = { ...input, verifiedNihil: { ...sourceVerifiedNihilFixture(input), territoryReference: 'QA scope mismatch' } };
  let rejected = false;
  try { evaluateSourceAssessment(id, invalidNihil, 2026, 12); } catch { rejected = true; }
  if (!rejected) throw new Error(`Backend accepted invalid nihil: ${id}`);
  const regressionPayloads: { name: string; input: SourceAssessmentInput; year: number; endMonth: number; accepted: boolean; measurement?: number | null }[] = [];
  if (id === 'K1-R34') for (const entry of sourceAssessmentRegressionCases.vaccineMonths) {
    const month = String(entry.month).padStart(2, '0');
    const payload = { ...input, year: entry.year, period: { ...input.period, month: entry.month, startDate: `${entry.year}-${month}-01`, endDate: `${entry.year}-${month}-${entry.days}`, cutoffDate: `${entry.year}-${month}-${entry.days}` }, values: { kind: 'RATIO_AGGREGATE' as const, numerator: entry.numerator, denominator: entry.days } };
    regressionPayloads.push({ name: `vaccine ${entry.year}-${entry.month}`, input: payload, year: entry.year, endMonth: entry.month, accepted: true, measurement: entry.measurement });
    regressionPayloads.push({ name: `vaccine wrong D ${entry.year}-${entry.month}`, input: { ...payload, values: { ...payload.values, denominator: 1 } }, year: entry.year, endMonth: entry.month, accepted: false });
  }
  if (['K1-R137', 'K1-R138'].includes(id)) regressionPayloads.push({ name: 'stale two-year window', input: { ...input, period: { ...input.period, startDate: '2000-01-01', endDate: '2001-12-31' } }, year: 2026, endMonth: 12, accepted: false });
  if (id === 'K4-R15') regressionPayloads.push({ name: 'large repeating allocation', input: { ...input, parameters: { ...sourceAssessmentRegressionCases.repeatingAllocation }, values: { kind: 'RATIO_AGGREGATE', numerator: 1, denominator: sourceAssessmentRegressionCases.roundedAllocationDenominator } }, year: 2026, endMonth: 12, accepted: false });
  for (const scenario of regressionPayloads) {
    let accepted = false, measurement: number | null = null;
    try { measurement = evaluateSourceAssessment(id, scenario.input, scenario.year, scenario.endMonth).measurementValue; accepted = true; } catch { /* Expected negative conformance cases. */ }
    if (accepted !== scenario.accepted || (accepted && measurement !== scenario.measurement)) throw new Error(`Backend conformance mismatch: ${id} ${scenario.name}`);
  }
  return { id, descriptor, profile: getDoProfile(id), input, expected: {
    numerator: result.numerator, denominator: result.denominator, measurementValue: result.measurementValue,
    measurementUnit: result.measurementUnit, targetMet: result.targetMet, status: result.status, assessmentScope: result.assessmentScope,
  }, regressionCases: sourceAssessmentRegressionCases, regressionPayloads, nihilFixture: sourceVerifiedNihilFixture(input), invalidNihil,
  nihilExpected: ['K3-R11', 'K3-R48', 'K3-R49'].includes(id) ? (() => {
    const zero = { ...input, values: { kind: 'RATIO_AGGREGATE' as const, numerator: 0, denominator: 0 }, verifiedNihil: sourceVerifiedNihilFixture(input) };
    const result = evaluateSourceAssessment(id, zero, 2026, 12);
    return { status: result.status, targetMet: result.targetMet, measurementValue: result.measurementValue, nilaiKinerja: result.nilaiKinerja };
  })() : null,
  };
});
process.stdout.write(JSON.stringify(rows));
