import { sourceAssessmentFixture } from './source-assessment.fixtures';
import { evaluateSourceAssessment, sourceAssessmentDescriptor, type SourceAssessmentInput } from '../src/analytics/do2026/source-assessment';
import { localResolutionDescriptor, type LocalResolutionInput, type LocalMetricInput } from '../src/analytics/do2026/local-resolution';

export const localResolutionIds = [
  'K1-R9', 'K1-R10', 'K1-R53', 'K1-R71', 'K1-R88', 'K1-R101', 'K1-R139',
  'K2-R32', 'K2-R34', 'K2-R35', 'K2-R48', 'K2-R60', 'K3-R10', 'K3-R12', 'K3-R19', 'K3-R25',
  'K4-R22', 'K4-R29', 'K4-R36', 'K4-R37', 'K5-R13', 'K5-R14', 'K5-R16', 'K5-R17', 'K5-R27', 'K5-R28', 'K5-R42', 'K5-R44',
] as const;

export function localResolutionFixture(id: string): SourceAssessmentInput & { localResolution: LocalResolutionInput } {
  const parent = sourceAssessmentFixture(id);
  if (id === 'K3-R10' && parent.values.kind === 'RATIO_AGGREGATE') parent.values.denominator = 64;
  const descriptor = localResolutionDescriptor(id, parent.period.kind)!;
  if (id === 'K2-R35') {
    parent.period.startDate = '2026-08-01'; parent.period.endDate = parent.period.cutoffDate = '2026-08-31';
  }
  const period = descriptor.periodPolicy === 'MONTH' ? {
    kind: 'MONTH' as const, startDate: id === 'K2-R35' ? '2026-08-01' : '2026-12-01',
    endDate: parent.period.cutoffDate, cutoffDate: parent.period.cutoffDate,
    month: id === 'K2-R35' ? 8 : 12, reference: 'QA explicit local monthly window',
  } : { ...parent.period };
  const metrics: Record<string, LocalMetricInput> = Object.fromEntries(descriptor.metrics.filter(metric => !metric.derivedFrom).map(metric => [metric.key,
    metric.type === 'BOOLEAN' ? { satisfied: true } : metric.type === 'COUNT' ? { count: 1 }
      : metric.type === 'POPULATION_RATIO' ? { numerator: 1, denominator: 10, population: 100, prevalencePercent: 10, populationReference: 'QA population', prevalenceReference: 'QA local prevalence' }
        : { numerator: 1, denominator: 10 },
  ]));
  if (id === 'K2-R32') metrics.testingCoverage = { numerator: 10, denominator: 20 };
  return { ...parent, localResolution: {
    contractVersion: 'DO_LOCAL_RESOLUTION_V1', decisionId: descriptor.decisionId, indicatorId: id,
    definitionId: sourceAssessmentDescriptor(id)!.definitionId, year: 2026, territoryReference: parent.provenance.territoryReference,
    sourcePeriod: { ...parent.period }, period, accepted: true, acceptanceReference: 'QA explicit user acceptance',
    measurementPolicyReference: 'QA local measurement policy', correctionAuthorityReference: 'QA local correction decision, not source approval',
    references: Object.fromEntries(descriptor.requiredReferences.map(key => [key, `QA ${key}`])), metrics,
  } };
}

export function evaluateLocalFixture(id: string, input = localResolutionFixture(id)) {
  return evaluateSourceAssessment(id, input, input.year, Number(input.period.cutoffDate.slice(5, 7)));
}
