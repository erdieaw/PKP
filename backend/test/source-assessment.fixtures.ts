import { SOURCE_ASSESSMENT_VERSION, sourceAssessmentDescriptor, type SourceAssessmentInput, type SourceVerifiedNihil } from '../src/analytics/do2026/source-assessment';

// Public synthetic conformance cases for the frontend coordinator to mirror.
export const sourceAssessmentRegressionCases = {
  vaccineMonths: [
    { year: 2026, month: 12, days: 31, numerator: 1, measurement: 3.22580645 },
    { year: 2026, month: 11, days: 30, numerator: 1, measurement: 3.33333333 },
    { year: 2026, month: 2, days: 28, numerator: 1, measurement: 3.57142857 },
    { year: 2028, month: 2, days: 29, numerator: 1, measurement: 3.44827586 },
  ],
  repeatingAllocation: { pkmPopulation: 9999999998, districtPopulation: 9999999999, districtEstimatedTbCases: 9999999999.0001 },
  roundedAllocationDenominator: 9999999998.0001,
} as const;

export function sourceVerifiedNihilFixture(input: SourceAssessmentInput): SourceVerifiedNihil {
  return {
    kind: 'DINSOS_VERIFIED_NIHIL', dinsosReference: 'QA aggregate Dinsos confirmation, no patient identifiers',
    cohortAbsenceReference: 'QA current and prior-year cohort reconciliation, no patient identifiers',
    noResidualPriorYearObligationConfirmed: true, definitionId: input.definitionId, year: input.year,
    periodStartDate: input.period.startDate, periodEndDate: input.period.endDate, cutoffDate: input.period.cutoffDate,
    territoryReference: input.provenance.territoryReference,
  };
}

// References in this fixture are synthetic attestations, never claims about real patients/documents.
export function sourceAssessmentFixture(id: string, numerator = 1, denominator = 10): SourceAssessmentInput {
  const descriptor = sourceAssessmentDescriptor(id)!;
  const period: SourceAssessmentInput['period'] = { kind: descriptor.period, startDate: '2026-01-01', endDate: '2026-12-31', cutoffDate: '2026-12-31', reference: 'QA observation window decision' };
  switch (descriptor.period) {
    case 'AS_OF': period.startDate = period.endDate; period.asOf = period.endDate; break;
    case 'MONTH': period.month = 12; period.startDate = '2026-12-01'; break;
    case 'QUARTER': period.quarter = 4; period.startDate = '2026-10-01'; break;
    case 'SCHOOL_YEAR': period.schoolYear = '2025/2026'; period.startDate = '2025-07-14'; period.endDate = '2026-06-30'; break;
    case 'PREVIOUS_YEAR_DOCUMENT': period.documentYear = 2025; period.startDate = '2025-01-01'; period.endDate = '2025-12-31'; break;
    case 'NEXT_YEAR_DOCUMENT': period.documentYear = 2027; break;
    case 'TWO_YEAR_DOCUMENT_WINDOW': period.startDate = '2025-01-01'; break;
  }
  const input: SourceAssessmentInput = {
    kind: 'DO_SOURCE_ASSESSMENT', contractVersion: SOURCE_ASSESSMENT_VERSION, definitionId: descriptor.definitionId, year: 2026,
    period, values: { kind: 'RATIO_AGGREGATE', numerator, denominator },
    context: Object.fromEntries(descriptor.requiredContext.map(({ key }) => [key, { reference: `QA register / ${key}`, description: `Reviewed aggregate basis for ${key}`, status: 'AVAILABLE' }])),
    provenance: {
      territoryReference: 'QA territory', sourceSnapshotReference: 'QA immutable source snapshot', numeratorEvidenceReference: 'QA numerator register',
      denominatorEvidenceReference: 'QA denominator register', eligibilityReference: 'QA source criteria review', completenessReference: 'QA full eligible source coverage',
      grainReference: 'QA unit and repeated outcomes decision', numeratorUnit: 'Source numerator unit', denominatorUnit: 'Source denominator unit', reconciliationReference: 'QA source reconciliation',
    },
    attestation: { status: 'COMPLETE', sourceCoverageComplete: true, eligibilityReviewed: true, grainReconciled: true, criteriaReferences: descriptor.criteria.map((_criterion, index) => `QA criterion evidence ${index + 1}`) },
    exceedReviewReference: 'QA uncapped excess reconciliation',
  };
  const formula = descriptor.formula;
  if (formula?.operator === 'RATIO_PERCENT' && 'denominatorBasis' in formula && ['SASARAN', 'ESTIMATE'].includes(formula.denominatorBasis)) {
    input.denominatorContext = { origin: formula.denominatorBasis === 'ESTIMATE' ? 'ESTIMATED' : 'INTEGER', referenceYear: 2026, territoryReference: 'QA territory', allocationReference: 'QA approved allocation', methodReference: 'QA source population method' };
  }
  switch (descriptor.expectedValueKind) {
    case 'COUNT_AGGREGATE': input.values = { kind: 'COUNT_AGGREGATE', count: numerator }; break;
    case 'DOCUMENT_OBSERVATION': input.values = { kind: 'DOCUMENT_OBSERVATION', present: true }; break;
    case 'SOURCE_OBSERVATION': input.values = { kind: 'SOURCE_OBSERVATION', count: numerator, unit: 'SOURCE_UNRESOLVED', reference: 'QA source observation' }; break;
    case 'COMPONENT_OBSERVATIONS':
      if (formula?.operator === 'COMPONENTS_ONLY') input.values = { kind: 'COMPONENT_OBSERVATIONS', components: Object.fromEntries(formula.components.map(component => [component.key, { numerator: 1, denominator: 2, unit: 'unit' in component ? component.unit : component.input, reference: `QA component ${component.key}` }])) };
      break;
  }
  if (id === 'K4-R14') input.parameters = { detectionTarget: 100 };
  if (id === 'K4-R15') input.parameters = { pkmPopulation: 1000, districtPopulation: 10000, districtEstimatedTbCases: 100 };
  if (id === 'K4-R19') input.parameters = { indexCount: 2 };
  if (id === 'K3-R10') input.parameters = { population: 10000 };
  return input;
}
