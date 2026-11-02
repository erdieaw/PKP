import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import source from './source.json';
import { EXPANDED_MANAGEMENT_DECISIONS, type ManagementDecision } from './expanded-management';
import { EXPANDED_CLINICAL_DECISIONS, type ClinicalDecision } from './expanded-clinical';
import { EXPANDED_INFECTIOUS_CROSS_DECISIONS, type InfectiousCrossDecision } from './expanded-infectious-cross';
import { evaluateLocalResolution, localResolutionDescriptor, type LocalResolutionInput } from './local-resolution';

export const SOURCE_ASSESSMENT_VERSION = 'DO_SOURCE_ASSESSMENT_V1' as const;
type Decision = ManagementDecision | ClinicalDecision | InfectiousCrossDecision;
export const SOURCE_ASSESSMENT_DECISIONS: Readonly<Record<string, Decision>> = {
  ...EXPANDED_MANAGEMENT_DECISIONS, ...EXPANDED_CLINICAL_DECISIONS, ...EXPANDED_INFECTIOUS_CROSS_DECISIONS,
};
type PeriodKind = Decision['period'];
export type SourceReference = { reference: string; description: string; status: 'AVAILABLE' | 'UNRESOLVED' };
export type SourceAssessmentPeriod = {
  kind: PeriodKind; startDate: string; endDate: string; cutoffDate: string; reference: string;
  month?: number; quarter?: number; asOf?: string; schoolYear?: '2025/2026'; documentYear?: number;
};
export type SourceAssessmentValues =
  | { kind: 'RATIO_AGGREGATE'; numerator: number; denominator: number }
  | { kind: 'COUNT_AGGREGATE'; count: number }
  | { kind: 'DOCUMENT_OBSERVATION'; present: boolean }
  | { kind: 'COMPONENT_OBSERVATIONS'; components: Record<string, { numerator: number; denominator: number; unit: string; reference: string }> }
  | { kind: 'SOURCE_OBSERVATION'; count: number; unit: string; reference: string };
export type SourceVerifiedNihil = {
  kind: 'DINSOS_VERIFIED_NIHIL'; dinsosReference: string; cohortAbsenceReference: string;
  noResidualPriorYearObligationConfirmed: true;
  definitionId: string; year: number; periodStartDate: string; periodEndDate: string;
  cutoffDate: string; territoryReference: string;
};
export type SourceAssessmentInput = {
  kind: 'DO_SOURCE_ASSESSMENT'; contractVersion: typeof SOURCE_ASSESSMENT_VERSION; definitionId: string; year: number;
  period: SourceAssessmentPeriod; values: SourceAssessmentValues;
  context: Record<string, SourceReference>;
  provenance: {
    territoryReference: string; sourceSnapshotReference: string; numeratorEvidenceReference: string;
    denominatorEvidenceReference: string; eligibilityReference: string; completenessReference: string;
    grainReference: string; numeratorUnit: string; denominatorUnit: string; reconciliationReference: string;
  };
  attestation: {
    status: 'COMPLETE' | 'INCOMPLETE' | 'NOT_YET_DUE' | 'NOT_APPLICABLE';
    sourceCoverageComplete: boolean; eligibilityReviewed: boolean; grainReconciled: boolean;
    criteriaReferences: string[];
  };
  denominatorContext?: {
    origin: 'INTEGER' | 'ESTIMATED'; methodReference: string; referenceYear: number;
    territoryReference: string; allocationReference: string;
  };
  parameters?: Record<string, number>;
  exceedReviewReference?: string;
  verifiedNihil?: SourceVerifiedNihil;
  localResolution?: LocalResolutionInput;
};

const parameterKeys = (decision: Decision): readonly string[] => {
  const formula = decision.formula;
  if (formula?.operator !== 'RATIO_PERCENT') return [];
  if ('documentedFactor' in formula) return ['population'];
  if ('denominatorDerivation' in formula) {
    switch (formula.denominatorDerivation) {
      case 'TB_DETECTION_TARGET_TIMES_FACTORS': return ['detectionTarget'];
      case 'REGIONAL_POPULATION_ALLOCATION': return ['pkmPopulation', 'districtPopulation', 'districtEstimatedTbCases'];
      case 'INDEX_CASES_TIMES_CONTACT_FACTOR': return ['indexCount'];
    }
  }
  return [];
};
const valueKind = (decision: Decision): SourceAssessmentValues['kind'] => {
  switch (decision.formula?.operator) {
    case 'RATIO_PERCENT': case 'UNRESOLVED_MONTH_MULTIPLIER': return 'RATIO_AGGREGATE';
    case 'COUNT': return 'COUNT_AGGREGATE';
    case 'DOCUMENT_PRESENCE': return 'DOCUMENT_OBSERVATION';
    case 'COMPONENTS_ONLY': return 'COMPONENT_OBSERVATIONS';
    default: return 'SOURCE_OBSERVATION';
  }
};
export function sourceAssessmentDescriptor(id: string) {
  if (!Object.hasOwn(SOURCE_ASSESSMENT_DECISIONS, id)) return undefined;
  const decision = SOURCE_ASSESSMENT_DECISIONS[id];
  if (!decision) return undefined;
  const executable = decision.readiness !== 'SOURCE_CONFLICT' &&
    (decision.formula?.operator === 'RATIO_PERCENT' || decision.formula?.operator === 'COUNT');
  const sourceDefinition = source.find(row => row.indicatorId === id);
  const formula = decision.formula;
  const denominatorRule = id === 'K1-R34' ? {
    kind: 'CALENDAR_MONTH_DAYS' as const, inputs: ['year', 'period.month'], unit: 'DAY',
    sourceRef: 'S1:KLASTER I!F34', sourceQuote: sourceDefinition!.calculation,
    submittedDenominator: 'MUST_EQUAL_SERVER_DERIVATION',
  } : formula?.operator === 'RATIO_PERCENT' && 'fixedDenominator' in formula && formula.fixedDenominator !== undefined
    ? { kind: 'FIXED' as const, value: formula.fixedDenominator, sourceRef: decision.sourceRef, sourceQuote: sourceDefinition!.calculation }
    : parameterKeys(decision).length ? {
      kind: 'SOURCE_PARAMETERS' as const, inputs: parameterKeys(decision), sourceRef: decision.sourceRef,
      sourceQuote: sourceDefinition!.calculation, arithmetic: 'EXACT_SCALED_INTEGER', maximumDecimalPlaces: 4,
      submittedDenominator: 'MUST_EQUAL_SERVER_DERIVATION',
    } : null;
  const periodWindowRule = decision.period === 'TWO_YEAR_DOCUMENT_WINDOW' ? {
    kind: 'CURRENT_AND_PREVIOUS_ASSESSMENT_YEAR_TO_CUTOFF' as const,
    authority: 'PROVISIONAL_TECHNICAL_CONVENTION_NOT_SOURCE_MANDATED' as const,
    startDateRule: 'JANUARY_1_OF_YEAR_MINUS_ONE', endDateRule: 'CUTOFF_DATE',
    sourceRef: decision.sourceRef, sourceQuote: sourceDefinition!.calculation,
  } : null;
  return {
    ...decision, contractVersion: SOURCE_ASSESSMENT_VERSION, inputKind: 'DO_SOURCE_ASSESSMENT' as const,
    expectedValueKind: valueKind(decision), requiredParameters: parameterKeys(decision),
    requiredContext: decision.requiredContext.map(key => ({ key, label: key, input: 'REFERENCED_ASSESSMENT' as const })),
    calculationAvailability: executable ? 'AVAILABLE_WITH_CONTEXT' as const : 'SOURCE_UNRESOLVED' as const,
    sourceDefinition, denominatorRule, periodWindowRule,
    verifiedNihilRule: 'zeroException' in decision && decision.zeroException ? {
      ...decision.zeroException, available: executable, inputField: 'verifiedNihil',
      requiredFields: ['kind', 'dinsosReference', 'cohortAbsenceReference', 'noResidualPriorYearObligationConfirmed', 'definitionId', 'year', 'periodStartDate', 'periodEndDate', 'cutoffDate', 'territoryReference'],
      matchingFields: ['definitionId', 'year', 'periodStartDate', 'periodEndDate', 'cutoffDate', 'territoryReference'],
      requiresCompleteContext: true, requiresZeroNumeratorAndDenominator: true,
      noResidualPriorYearObligationConfirmed: true,
      referenceInstruction: 'Referensi dokumen agregat saja, tanpa identitas pasien atau data pribadi.',
      sourceRef: decision.sourceRef, sourceQuote: sourceDefinition!.calculation,
      referenceAuthority: 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED',
    } : null,
    referenceAuthority: 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED' as const,
    periodInstruction: periodWindowRule
      ? 'Konvensi teknis provisional, bukan batas tanggal yang ditetapkan sumber: 1 Januari tahun penilaian sebelumnya sampai cutoffDate pada tahun penilaian. Sumber hanya menyebut dua tahun terakhir. Tidak dikonversi menjadi hasil tahunan.'
      : 'Lingkup observasi eksplisit, bukan otomatis Januari sampai akhir bulan. Tidak dijumlahkan atau dirata-rata antarbulan.',
    performanceScoreAvailable: false,
    ...(localResolutionDescriptor(id, decision.period) ? { localResolution: localResolutionDescriptor(id, decision.period) } : {}),
  };
}

function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_SOURCE_ASSESSMENT', message });
}

/** Validates referenced aggregate assessments; never executes source narrative or verifies external evidence. */
export function evaluateSourceAssessment(id: string, value: unknown, year: number | undefined, endMonth: number | undefined) {
  if (!Object.hasOwn(SOURCE_ASSESSMENT_DECISIONS, id)) invalid('Identitas kontrak tidak dikenal.');
  const decision = SOURCE_ASSESSMENT_DECISIONS[id];
  if (!decision) invalid('Identitas kontrak tidak dikenal.');
  if (value == null) throw new BadRequestException({ code: 'SOURCE_ASSESSMENT_REQUIRED', message: 'Asesmen sumber terstruktur wajib; N/D dan konfirmasi saja tidak cukup.' });
  const object = (input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) invalid('Objek asesmen tidak valid.');
    const row = input as Record<string, unknown>;
    if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) invalid('Field asesmen hilang atau tidak dikenal.');
    return row;
  };
  const text = (input: unknown): string => {
    if (typeof input !== 'string' || !input.trim() || input.length > 2000 || /[\u0000-\u001f\u007f]/.test(input)) invalid('Referensi dan uraian wajib terisi, maksimal 2000 karakter tanpa karakter kontrol.');
    return input;
  };
  const number = (input: unknown, decimal = false): Prisma.Decimal => {
    if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 9_999_999_999.9999) invalid('Angka harus nonnegatif dan dalam rentang Decimal(14,4).');
    const result = new Prisma.Decimal(input);
    if (decimal ? result.decimalPlaces() > 4 : !Number.isSafeInteger(input)) invalid('Presisi angka tidak sesuai kontrak; count wajib bulat dan desimal maksimal empat tempat.');
    return result;
  };
  const date = (input: unknown): string => {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) invalid('Tanggal harus YYYY-MM-DD.');
    const parsed = new Date(`${input}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input) invalid('Tanggal kalender tidak valid.');
    return input;
  };
  const root = object(value, ['kind', 'contractVersion', 'definitionId', 'year', 'period', 'values', 'context', 'provenance', 'attestation'], ['denominatorContext', 'parameters', 'exceedReviewReference', 'verifiedNihil', 'localResolution']);
  if (root.kind !== 'DO_SOURCE_ASSESSMENT' || root.contractVersion !== SOURCE_ASSESSMENT_VERSION || root.definitionId !== decision.definitionId || root.year !== year || !Number.isInteger(year) || year! < 2026 || year! > 9999 || !Number.isInteger(endMonth) || endMonth! < 1 || endMonth! > 12) invalid('Jenis, versi, definisi, tahun atau akhir bulan tidak cocok dengan rekap.');
  const scopeKeys: Partial<Record<PeriodKind, readonly string[]>> = {
    MONTH: ['month'], QUARTER: ['quarter'], AS_OF: ['asOf'], SCHOOL_YEAR: ['schoolYear'],
    PREVIOUS_YEAR_DOCUMENT: ['documentYear'], NEXT_YEAR_DOCUMENT: ['documentYear'],
  };
  const period = object(root.period, ['kind', 'startDate', 'endDate', 'cutoffDate', 'reference', ...(scopeKeys[decision.period] ?? [])]);
  if (period.kind !== decision.period) invalid('Jenis periode berbeda dari sumber.');
  const startDate = date(period.startDate), endDate = date(period.endDate), cutoffDate = date(period.cutoffDate);
  text(period.reference);
  if (startDate > endDate || Number(cutoffDate.slice(0, 4)) !== year || Number(cutoffDate.slice(5, 7)) !== endMonth) invalid('Rentang/tanggal acuan tidak cocok dengan tahun dan akhir bulan rekap.');
  const y = String(year).padStart(4, '0');
  const monthEnd = (month: number) => `${y}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year!, month, 0)).getUTCDate()}`;
  switch (decision.period) {
    case 'ANNUAL':
      if (startDate !== `${y}-01-01` || endDate !== `${y}-12-31` || cutoffDate !== endDate || endMonth !== 12) invalid('Rekap tahunan wajib Januari sampai Desember penuh.');
      break;
    case 'MONTH':
      if (period.month !== endMonth || startDate !== `${y}-${String(endMonth).padStart(2, '0')}-01` || endDate !== monthEnd(endMonth!) || cutoffDate !== endDate) invalid('Rekap bulanan wajib satu bulan utuh yang dipilih, bukan YTD.');
      break;
    case 'QUARTER': {
      const quarter = period.quarter as number;
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4 || endMonth !== quarter * 3 || startDate !== `${y}-${String(quarter * 3 - 2).padStart(2, '0')}-01` || endDate !== monthEnd(quarter * 3) || cutoffDate !== endDate) invalid('Rekap triwulan wajib tepat satu triwulan, bukan YTD.');
      break;
    }
    case 'AS_OF':
      if (date(period.asOf) !== cutoffDate || startDate !== cutoffDate || endDate !== cutoffDate) invalid('Snapshot wajib satu tanggal acuan eksplisit.');
      break;
    case 'SCHOOL_YEAR':
      if (year !== 2026 || period.schoolYear !== '2025/2026' || !startDate.startsWith('2025-') || !endDate.startsWith('2026-')) invalid('Sumber ini menetapkan tahun ajaran 2025/2026, bukan tahun kalender.');
      break;
    case 'PREVIOUS_YEAR_DOCUMENT': case 'NEXT_YEAR_DOCUMENT':
      if (period.documentYear !== year! + (decision.period === 'NEXT_YEAR_DOCUMENT' ? 1 : -1)) invalid('Tahun dokumen tidak sesuai tahun sebelum/sesudah penilaian.');
      break;
    case 'TWO_YEAR_DOCUMENT_WINDOW':
      if (startDate !== `${year! - 1}-01-01` || endDate !== cutoffDate) invalid('Konvensi teknis provisional: jendela dua tahun dokumen mulai 1 Januari tahun penilaian sebelumnya dan berakhir tepat pada cutoffDate tahun penilaian.');
      break;
    case 'PROGRAM_YEAR': case 'COHORT_WINDOW': case 'EXPLICIT_WINDOW': break;
  }
  const context = object(root.context, decision.requiredContext);
  for (const key of decision.requiredContext) {
    const item = object(context[key], ['reference', 'description', 'status']);
    text(item.reference); text(item.description);
    if (item.status !== 'AVAILABLE' && item.status !== 'UNRESOLVED') invalid('Status konteks tidak dikenal.');
  }
  const provenance = object(root.provenance, ['territoryReference', 'sourceSnapshotReference', 'numeratorEvidenceReference', 'denominatorEvidenceReference', 'eligibilityReference', 'completenessReference', 'grainReference', 'numeratorUnit', 'denominatorUnit', 'reconciliationReference']);
  Object.values(provenance).forEach(text);
  const attestation = object(root.attestation, ['status', 'sourceCoverageComplete', 'eligibilityReviewed', 'grainReconciled', 'criteriaReferences']);
  if (!['COMPLETE', 'INCOMPLETE', 'NOT_YET_DUE', 'NOT_APPLICABLE'].includes(String(attestation.status)) || ['sourceCoverageComplete', 'eligibilityReviewed', 'grainReconciled'].some(key => typeof attestation[key] !== 'boolean')) invalid('Attestasi tidak valid.');
  if (!Array.isArray(attestation.criteriaReferences) || attestation.criteriaReferences.length !== decision.criteria.length) invalid('Referensi penilaian setiap kriteria wajib lengkap.');
  attestation.criteriaReferences.forEach(text);
  if (endDate > cutoffDate && !(decision.period === 'COHORT_WINDOW' && attestation.status === 'NOT_YET_DUE')) invalid('Observasi melewati cutoff; kohort belum matang harus dinyatakan belum jatuh jadwal.');
  const formula = decision.formula;
  const ratio = formula?.operator === 'RATIO_PERCENT' ? formula : undefined;
  const basis = ratio && 'denominatorBasis' in ratio ? ratio.denominatorBasis : undefined;
  let estimated = ratio?.input === 'ESTIMATED';
  if (basis === 'SASARAN' || basis === 'ESTIMATE') {
    const denominatorContext = object(root.denominatorContext, ['origin', 'methodReference', 'referenceYear', 'territoryReference', 'allocationReference']);
    if (denominatorContext.origin !== 'INTEGER' && denominatorContext.origin !== 'ESTIMATED' || basis === 'ESTIMATE' && denominatorContext.origin !== 'ESTIMATED') invalid('Asal penyebut INTEGER/ESTIMATED wajib eksplisit sesuai sumber.');
    if (!Number.isInteger(denominatorContext.referenceYear) || Number(denominatorContext.referenceYear) < 1900 || Number(denominatorContext.referenceYear) > year!) invalid('Tahun acuan penyebut tidak valid.');
    ['methodReference', 'territoryReference', 'allocationReference'].forEach(key => text(denominatorContext[key]));
    if (denominatorContext.territoryReference !== provenance.territoryReference) invalid('Wilayah penyebut dan asesmen berbeda.');
    estimated = denominatorContext.origin === 'ESTIMATED';
  } else if (root.denominatorContext !== undefined) invalid('Konteks estimasi tidak berlaku untuk penyebut ini.');
  const keys = parameterKeys(decision);
  // Validate divisibility at storage scale before any Decimal division can round.
  const exactDenominator = (factors: Prisma.Decimal[], divisors: Prisma.Decimal[] = []): Prisma.Decimal => {
    const scale = 10000n;
    const scaled = (value: Prisma.Decimal) => {
      if (value.decimalPlaces() > 4) invalid('Faktor sumber melebihi presisi penyimpanan.');
      return BigInt(value.toFixed(4).replace('.', ''));
    };
    let top = scale, bottom = 1n;
    for (const factor of factors) { top *= scaled(factor); bottom *= scale; }
    for (const divisor of divisors) { top *= scale; bottom *= scaled(divisor); }
    if (bottom === 0n || top % bottom !== 0n || top / bottom > 99999999999999n) invalid('Penyebut turunan tidak dapat disimpan tepat dalam Decimal(14,4); jangan membulatkan diam-diam.');
    const result = top / bottom;
    return new Prisma.Decimal(`${result / scale}.${String(result % scale).padStart(4, '0')}`);
  };
  let derivedDenominator = id === 'K1-R34' ? new Prisma.Decimal(new Date(Date.UTC(year!, endMonth!, 0)).getUTCDate()) : undefined;
  if (keys.length) {
    const parameters = object(root.parameters, keys);
    const values = Object.fromEntries(keys.map(key => [key, number(parameters[key], key === 'districtEstimatedTbCases' || key === 'detectionTarget')]));
    if (ratio && 'documentedFactor' in ratio) derivedDenominator = exactDenominator([values.population!, new Prisma.Decimal(ratio.documentedFactor!)]);
    if (ratio && 'denominatorDerivation' in ratio) {
      switch (ratio.denominatorDerivation) {
        case 'TB_DETECTION_TARGET_TIMES_FACTORS': derivedDenominator = exactDenominator([values.detectionTarget!, new Prisma.Decimal('0.54'), new Prisma.Decimal(10)]); break;
        case 'INDEX_CASES_TIMES_CONTACT_FACTOR': derivedDenominator = exactDenominator([values.indexCount!, new Prisma.Decimal(20)]); break;
        case 'REGIONAL_POPULATION_ALLOCATION':
          if (values.districtPopulation!.isZero() || values.pkmPopulation!.gt(values.districtPopulation!)) invalid('Populasi kabupaten harus positif dan mencakup populasi Puskesmas.');
          derivedDenominator = exactDenominator([values.pkmPopulation!, values.districtEstimatedTbCases!], [values.districtPopulation!]); break;
      }
    }
  } else if (root.parameters !== undefined) invalid('Parameter tidak dideklarasikan untuk profil ini.');
  const kind = valueKind(decision);
  let numerator = new Prisma.Decimal(0), denominator = new Prisma.Decimal(0);
  const fields: Record<SourceAssessmentValues['kind'], string[]> = {
    RATIO_AGGREGATE: ['numerator', 'denominator'], COUNT_AGGREGATE: ['count'], DOCUMENT_OBSERVATION: ['present'],
    COMPONENT_OBSERVATIONS: ['components'], SOURCE_OBSERVATION: ['count', 'unit', 'reference'],
  };
  const values = object(root.values, ['kind', ...fields[kind]]);
  if (values.kind !== kind) invalid('Jenis observasi berbeda dari formula sumber.');
  if (kind === 'RATIO_AGGREGATE') {
    const decimal = ratio?.input === 'DECIMAL_MONEY' || ratio?.input === 'DECIMAL_SCORE';
    numerator = number(values.numerator, decimal); denominator = number(values.denominator, decimal || estimated);
    if (ratio && 'fixedDenominator' in ratio && ratio.fixedDenominator !== undefined && !denominator.eq(ratio.fixedDenominator)) invalid('Penyebut tetap tidak sesuai DO.');
    if (derivedDenominator && !denominator.eq(derivedDenominator)) invalid('Penyebut berbeda dari parameter dan faktor sumber yang dihitung server.');
    if (ratio?.numeratorSubset === true && numerator.gt(denominator)) invalid('Pembilang subset tidak boleh melebihi penyebut.');
    if (numerator.gt(denominator)) text(root.exceedReviewReference);
  } else if (kind === 'COUNT_AGGREGATE') numerator = number(values.count);
  else if (kind === 'DOCUMENT_OBSERVATION') {
    if (typeof values.present !== 'boolean') invalid('Kehadiran dokumen harus boolean.');
    numerator = new Prisma.Decimal(values.present ? 1 : 0);
  } else if (kind === 'SOURCE_OBSERVATION') {
    number(values.count); text(values.unit); text(values.reference);
  } else if (formula?.operator === 'COMPONENTS_ONLY') {
    const components = object(values.components, formula.components.map(component => component.key));
    for (const component of formula.components) {
      const item = object(components[component.key], ['numerator', 'denominator', 'unit', 'reference']);
      const decimal = 'input' in component ? component.input === 'DECIMAL_MONEY' : component.unit === 'SOURCE_UNRESOLVED';
      number(item.numerator, decimal); number(item.denominator, decimal); text(item.unit); text(item.reference);
      if ('unit' in component && component.unit === 'COUNT_DOCUMENT' && item.unit !== 'COUNT_DOCUMENT') invalid('Unit komponen dokumen tidak sesuai sumber.');
    }
  }
  if (root.exceedReviewReference !== undefined) text(root.exceedReviewReference);
  const complete = attestation.status === 'COMPLETE' && attestation.sourceCoverageComplete === true && attestation.eligibilityReviewed === true && attestation.grainReconciled === true &&
    decision.requiredContext.every(key => (context[key] as SourceReference).status === 'AVAILABLE');
  if (root.verifiedNihil !== undefined) {
    if (!('zeroException' in decision) || !decision.zeroException || decision.readiness === 'SOURCE_CONFLICT') invalid('Pengecualian nihil Dinsos tidak tersedia untuk indikator ini; konflik sumber tidak dapat ditimpa attestasi.');
    const nihil = object(root.verifiedNihil, ['kind', 'dinsosReference', 'cohortAbsenceReference', 'noResidualPriorYearObligationConfirmed', 'definitionId', 'year', 'periodStartDate', 'periodEndDate', 'cutoffDate', 'territoryReference']);
    text(nihil.dinsosReference); text(nihil.cohortAbsenceReference); text(nihil.territoryReference);
    if (nihil.kind !== 'DINSOS_VERIFIED_NIHIL' || nihil.noResidualPriorYearObligationConfirmed !== true || !complete || !numerator.isZero() || !denominator.isZero() ||
      nihil.definitionId !== decision.definitionId || nihil.year !== year || nihil.periodStartDate !== startDate || nihil.periodEndDate !== endDate || nihil.cutoffDate !== cutoffDate || nihil.territoryReference !== provenance.territoryReference) invalid('Nihil wajib cocok dengan definisi, tahun, periode dan wilayah, N=D=0, konteks lengkap serta tanpa kewajiban kohort tahun lalu yang tersisa.');
  }
  let status = 'SOURCE_UNRESOLVED';
  let measurement: Prisma.Decimal | null = null;
  const executable = sourceAssessmentDescriptor(id)!.calculationAvailability === 'AVAILABLE_WITH_CONTEXT';
  if (executable && !complete) status = attestation.status === 'NOT_YET_DUE' ? 'NOT_YET_DUE' : 'CONTEXT_INCOMPLETE';
  else if (executable && ratio && denominator.isZero()) status = root.verifiedNihil ? 'VERIFIED_NO_CASE_TARGET_MET' : 'ZERO_DENOMINATOR';
  else if (executable) {
    status = 'MEASUREMENT_ONLY';
    measurement = ratio ? numerator.div(denominator).mul(100) : numerator;
  }
  const target = decision.target;
  let targetMet: boolean | null = status === 'VERIFIED_NO_CASE_TARGET_MET' ? true : null;
  if (measurement && target.value !== null && target.basis !== 'UNRESOLVED' && target.comparator !== 'UNRESOLVED' &&
    (ratio ? target.unit === 'PERCENT' : target.unit === 'COUNT')) {
    switch (target.comparator) {
      case 'MIN': targetMet = measurement.gte(target.value); break;
      case 'MAX': targetMet = measurement.lte(target.value); break;
      case 'LT': targetMet = measurement.lt(target.value); break;
      case 'GT': targetMet = measurement.gt(target.value); break;
    }
  }
  const measurementValue = measurement?.toDecimalPlaces(8).toNumber() ?? null;
  if (measurementValue !== null && !Number.isFinite(measurementValue)) invalid('Hasil di luar rentang angka.');
  const localResolutionResult = Object.hasOwn(root, 'localResolution')
    ? evaluateLocalResolution(id, root.localResolution, value as SourceAssessmentInput, { numerator: numerator.toNumber(), denominator: denominator.toNumber() }, target, decision.unresolved)
    : undefined;
  const primary = localResolutionResult?.metrics.find(metric => metric.primary);
  return {
    structuredInput: value as SourceAssessmentInput, numerator: numerator.toNumber(), denominator: denominator.toNumber(), prerequisiteMet: complete,
    measurementValue, measurementUnit: measurement === null ? null : ratio ? 'PERCENT' : 'COUNT',
    capaianRiilPct: ratio ? measurementValue : null, effectiveDenominator: ratio ? denominator.toNumber() : null,
    targetMet, nilaiKinerja: null, status,
    reason: status === 'SOURCE_UNRESOLVED' ? `Sumber belum menetapkan hasil tunggal. ${decision.unresolved.join(' ')}`
      : status === 'VERIFIED_NO_CASE_TARGET_MET' ? 'Nihil memenuhi target menurut pengecualian DO dengan referensi Dinsos dan rekonsiliasi seluruh kohort. Referensi adalah attestasi pengguna, bukan verifikasi eksternal; tidak ada persentase 0/0 atau skor numerik.'
      : status === 'MEASUREMENT_ONLY' ? 'Hasil ukur internal provisional; referensi adalah attestasi, bukan verifikasi eksternal. Skor kinerja tidak ditetapkan.'
        : 'Data belum layak dihitung; nol, belum jatuh jadwal, tidak berlaku dan konteks belum lengkap tidak menjadi nilai 100.',
    assessmentScope: { ...(period as SourceAssessmentPeriod), label: `${decision.period}: ${startDate} - ${endDate}`, annualComparable: decision.period === 'ANNUAL' },
    ...(localResolutionResult ? {
      localResolutionResult, measurementValue: typeof primary?.value === 'number' ? primary.value : null,
      measurementUnit: typeof primary?.value === 'number' ? primary.unit : null,
      capaianRiilPct: primary?.unit === 'PERCENT' && typeof primary.value === 'number' ? primary.value : null,
      effectiveDenominator: primary?.denominator ?? null, targetMet: primary?.targetMet ?? null,
      status: 'LOCAL_RESOLUTION_PROVISIONAL',
      reason: 'Solusi lokal diterima eksplisit; konflik sumber tetap terbuka. Komponen bukan skor/komposit, referensi bukan verifikasi eksternal.',
      assessmentScope: localResolutionResult.assessmentScope,
    } : {}),
  };
}
