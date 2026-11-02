import assert from 'node:assert/strict';
import { getDoProfile } from '../backend/src/analytics/do2026/profiles';
import { evaluateSourceAssessment, sourceAssessmentDescriptor } from '../backend/src/analytics/do2026/source-assessment';
import { localResolutionFixture, localResolutionIds } from '../backend/test/local-resolution.fixtures';

// Synthetic aggregate fixtures only; backend imports run in Node, never in the application bundle.
const rows = localResolutionIds.map(id => {
  const input = localResolutionFixture(id), endMonth = Number(input.period.cutoffDate.slice(5, 7));
  const profile = getDoProfile(id), descriptor = sourceAssessmentDescriptor(id)!;
  const local = descriptor.localResolution!;
  const expected = evaluateSourceAssessment(id, input, 2026, endMonth);
  const { localResolution: _local, ...oldInput } = input;
  const oldExpected = evaluateSourceAssessment(id, oldInput, 2026, endMonth);
  assert.equal(expected.status, 'LOCAL_RESOLUTION_PROVISIONAL');
  assert.equal(oldExpected.status, 'SOURCE_UNRESOLVED');
  const cases: { name: string; input: unknown; accepted: boolean; result?: unknown }[] = [];
  function scenario(name: string, accepted: boolean, change: (value: any) => void) {
    const value = structuredClone(input); change(value);
    let result;
    try { result = evaluateSourceAssessment(id, value, 2026, Number(value.period.cutoffDate.slice(5, 7))); } catch (error) { if (accepted) throw error; }
    assert.equal(!!result, accepted, `${id}: backend oracle ${name}`);
    cases.push({ name, input: value, accepted, ...(result ? { result } : {}) });
  }
  for (const key of ['contractVersion', 'decisionId', 'indicatorId', 'definitionId', 'year', 'territoryReference', 'accepted']) {
    scenario(`wrong ${key}`, false, value => { value.localResolution[key] = key === 'year' ? 2027 : key === 'accepted' ? false : 'WRONG'; });
  }
  for (const [name, change] of [
    ['unknown root', (value: any) => { value.localResolution.extra = true; }],
    ['null local', (value: any) => { value.localResolution = null; }],
    ['array local', (value: any) => { value.localResolution = []; }],
    ['missing acceptance reference', (value: any) => { delete value.localResolution.acceptanceReference; }],
    ['blank policy', (value: any) => { value.localResolution.measurementPolicyReference = ' '; }],
    ['control authority', (value: any) => { value.localResolution.correctionAuthorityReference = 'a\nb'; }],
    ['oversized reference', (value: any) => { value.localResolution.acceptanceReference = 'a'.repeat(2001); }],
    ['wrong source period', (value: any) => { value.localResolution.sourcePeriod.reference = 'changed'; }],
    ['extra source period', (value: any) => { value.localResolution.sourcePeriod.extra = 'x'; }],
    ['wrong local period', (value: any) => { value.localResolution.period.startDate = '1900-01-01'; }],
    ['extra local period', (value: any) => { value.localResolution.period.extra = true; }],
    ['unknown reference', (value: any) => { value.localResolution.references.extra = 'x'; }],
    ['missing reference', (value: any) => { delete value.localResolution.references[local.requiredReferences[0]]; }],
    ['blank evidence', (value: any) => { value.localResolution.references[local.requiredReferences[0]] = ''; }],
    ['unknown metric', (value: any) => { value.localResolution.metrics.extra = null; }],
    ['guessed target', (value: any) => { value.localResolution.targetPolicy = { metricKey: 'unknown', value: 100, reference: 'QA' }; }],
  ] as const) scenario(name, false, change);
  for (const metric of local.metrics.filter(metric => !metric.derivedFrom)) {
    if (metric.required) scenario(`${metric.key}: missing required`, false, value => { delete value.localResolution.metrics[metric.key]; });
    scenario(`${metric.key}: incomplete`, true, value => { value.localResolution.metrics[metric.key] = null; });
    if (!metric.required) scenario(`${metric.key}: optional absent`, true, value => { delete value.localResolution.metrics[metric.key]; });
    scenario(`${metric.key}: extra field`, false, value => { value.localResolution.metrics[metric.key].extra = true; });
    if (metric.type === 'BOOLEAN') {
      scenario(`${metric.key}: false is observed`, true, value => { value.localResolution.metrics[metric.key].satisfied = false; });
      scenario(`${metric.key}: boolean string`, false, value => { value.localResolution.metrics[metric.key].satisfied = 'true'; });
    } else {
      const field = metric.type === 'COUNT' ? 'count' : 'numerator';
      for (const [name, number] of [['negative', -1], ['overflow', 10000000000], ['precision', 0.00001], ['numeric string', '1']] as const)
        scenario(`${metric.key}: ${name}`, false, value => { value.localResolution.metrics[metric.key][field] = number; });
      if (metric.decimalPlaces === 0) scenario(`${metric.key}: fractional count`, false, value => { value.localResolution.metrics[metric.key][field] = 1.1; });
      if (metric.subset) scenario(`${metric.key}: subset exceeded`, false, value => { value.localResolution.metrics[metric.key].numerator = 11; });
      if (metric.type !== 'COUNT') scenario(`${metric.key}: denominator precision`, false, value => { value.localResolution.metrics[metric.key].denominator = 10.00001; });
    }
    if (metric.targetValue !== undefined) {
      scenario(`${metric.key}: explicit target`, true, value => { value.localResolution.targetPolicy = { metricKey: metric.key, value: metric.targetValue, reference: 'QA explicit alternative' }; });
      scenario(`${metric.key}: wrong target`, false, value => { value.localResolution.targetPolicy = { metricKey: metric.key, value: metric.targetValue! + 1, reference: 'QA' }; });
      scenario(`${metric.key}: target null observation`, false, value => { value.localResolution.metrics[metric.key] = null; value.localResolution.targetPolicy = { metricKey: metric.key, value: metric.targetValue, reference: 'QA' }; });
      scenario(`${metric.key}: target extra`, false, value => { value.localResolution.targetPolicy = { metricKey: metric.key, value: metric.targetValue, reference: 'QA', extra: 1 }; });
      scenario(`${metric.key}: target blank reference`, false, value => { value.localResolution.targetPolicy = { metricKey: metric.key, value: metric.targetValue, reference: ' ' }; });
    }
    if (metric.derivedFrom) throw new Error('Unreachable derived metric');
  }
  for (const metric of local.metrics.filter(metric => metric.derivedFrom)) scenario(`${metric.key}: reject submitted derived`, false, value => { value.localResolution.metrics[metric.key] = { count: 1 }; });
  for (const status of ['INCOMPLETE', 'NOT_YET_DUE', 'NOT_APPLICABLE']) scenario(`source ${status}`, true, value => { value.attestation.status = status; });
  for (const key of ['sourceCoverageComplete', 'eligibilityReviewed', 'grainReconciled']) scenario(`source false ${key}`, true, value => { value.attestation[key] = false; });
  scenario('all metrics null', true, value => { for (const key of Object.keys(value.localResolution.metrics)) value.localResolution.metrics[key] = null; });
  const ratios = local.metrics.filter(metric => metric.type === 'RATIO' && !metric.derivedFrom);
  if (ratios.length) scenario('all ratio denominators zero', true, value => {
    for (const metric of ratios) value.localResolution.metrics[metric.key] = { numerator: 0, denominator: 0 };
  });
  for (const metric of local.metrics.filter(metric => metric.sameDenominatorAs)) scenario(`${metric.key}: shared denominator`, false, value => { value.localResolution.metrics[metric.key].denominator = 11; });
  if (['K5-R13', 'K5-R14', 'K5-R27'].includes(id)) {
    const anchor = id === 'K5-R13' ? 'sip' : id === 'K5-R14' ? 'bls' : 'allThree';
    const sibling = local.metrics.find(metric => metric.sameDenominatorAs === anchor)!;
    const withoutAnchor = (value: any, denominator = 10) => {
      for (const metric of local.metrics) value.localResolution.metrics[metric.key] = { numerator: denominator, denominator };
      value.localResolution.metrics[anchor] = null;
      if (id !== 'K5-R27') value.localResolution.targetPolicy = { metricKey: 'literalAll', value: 100, reference: 'QA explicit literal target with incomplete anchor' };
    };
    scenario('null anchor: matching sibling denominators', true, value => withoutAnchor(value));
    scenario('null anchor: different sibling denominators', false, value => {
      withoutAnchor(value); value.localResolution.metrics[sibling.key].denominator = 20;
    });
    scenario('null anchor: matching zero denominators', true, value => withoutAnchor(value, 0));
    scenario('null anchor: zero versus positive denominator', false, value => {
      withoutAnchor(value, 0); value.localResolution.metrics[sibling.key].denominator = 10;
    });
    if (id !== 'K5-R27') scenario('null anchor: intersection upper bound', false, value => {
      withoutAnchor(value); value.localResolution.metrics[sibling.key].numerator = 0;
    });
  }
  for (const metric of local.metrics.filter(metric => metric.intersectionOf)) {
    scenario(`${metric.key}: intersection upper`, false, value => { value.localResolution.metrics[metric.key].numerator = 2; });
    scenario(`${metric.key}: intersection lower`, false, value => {
      for (const key of metric.intersectionOf!) value.localResolution.metrics[key].numerator = 10;
      value.localResolution.metrics[metric.key].numerator = 0;
    });
  }
  if (id === 'K2-R32') scenario('cohort linkage', false, value => { value.localResolution.metrics.testingCoverage.numerator = 9; });
  if (id === 'K3-R19') {
    for (const [name, patch] of [
      ['wrong exact D', { denominator: 9 }], ['zero population', { population: 0 }], ['zero prevalence', { prevalencePercent: 0 }],
      ['prevalence overflow', { prevalencePercent: 101 }], ['population fraction', { population: 100.1 }],
      ['prevalence precision', { prevalencePercent: 10.00001 }], ['population reference', { populationReference: '' }],
      ['prevalence reference', { prevalenceReference: '' }], ['unrepresentable D', { population: 1, prevalencePercent: 0.0001, denominator: 0 }],
      ['overflow estimate', { population: 9999999999, prevalencePercent: 100, denominator: 9999999999.9999 }],
    ] as const) scenario(`estimated: ${name}`, false, value => { Object.assign(value.localResolution.metrics.dmPopulation, patch); });
    scenario('exact fractional estimated D uncapped', true, value => { Object.assign(value.localResolution.metrics.dmPopulation, { population: 1, prevalencePercent: 1.23, denominator: 0.0123, numerator: 2 }); });
    scenario('large exact estimate', true, value => { Object.assign(value.localResolution.metrics.dmPopulation, { population: 9999999999, prevalencePercent: 99.99, denominator: 9998999999.0001 }); });
  }
  if (local.periodPolicy === 'MONTH') {
    scenario('monthly wrong slot', false, value => { value.localResolution.period.month = 1; });
    scenario('monthly not full month', false, value => { value.localResolution.period.endDate = '2026-12-30'; });
    scenario('monthly missing reference', false, value => { value.localResolution.period.reference = ''; });
    scenario('monthly outside source', false, value => { value.period.startDate = value.localResolution.sourcePeriod.startDate = `${input.period.cutoffDate.slice(0, 7)}-02`; });
  }
  if (id === 'K2-R35') {
    scenario('February allowed', true, value => { value.period.startDate = '2026-02-01'; value.period.endDate = value.period.cutoffDate = '2026-02-28'; value.localResolution.sourcePeriod = { ...value.period }; Object.assign(value.localResolution.period, { startDate: '2026-02-01', endDate: '2026-02-28', cutoffDate: '2026-02-28', month: 2 }); });
  }
  return { id, input, oldInput, oldExpected, expected, profile, descriptor, endMonth, cases };
});
process.stdout.write(JSON.stringify(rows));
