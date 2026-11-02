import type { Do2026Profile } from '../types/do2026';
import type { SourceAssessmentDescriptor, SourceAssessmentDraft, SourceAssessmentInput, SourceAssessmentPeriod } from '../types/sourceAssessment';
import type { LocalResolutionDescriptor } from '../types/localResolution';

export const sourcePeriodLabels = {
  ANNUAL: 'Tahun kalender penuh', MONTH: 'Satu bulan', QUARTER: 'Satu triwulan', AS_OF: 'Snapshot tanggal acuan',
  SCHOOL_YEAR: 'Tahun ajaran 2025/2026', PREVIOUS_YEAR_DOCUMENT: 'Dokumen tahun sebelumnya', NEXT_YEAR_DOCUMENT: 'Dokumen tahun berikutnya',
  TWO_YEAR_DOCUMENT_WINDOW: 'Jendela dokumen dua tahun', PROGRAM_YEAR: 'Tahun program', COHORT_WINDOW: 'Jendela kohort', EXPLICIT_WINDOW: 'Rentang observasi eksplisit',
} as const;

function invalid(message: string): never { throw new Error(message); }
function object(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) invalid('Objek asesmen tidak valid. Data tersimpan tidak diubah.');
  const row = input as Record<string, unknown>;
  if (required.some(key => !Object.prototype.hasOwnProperty.call(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) invalid('Field asesmen hilang atau tidak dikenal. Muat ulang; payload tersimpan dipertahankan.');
  return row;
}
function text(input: unknown) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2000 || /[\u0000-\u001f\u007f]/.test(input)) invalid('Setiap referensi dan uraian wajib terisi, maksimal 2000 karakter tanpa karakter kontrol. Bila belum tersedia, jelaskan kekurangannya.');
}
function date(input: unknown): string {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return invalid('Tanggal wajib dalam format YYYY-MM-DD.');
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input) invalid('Tanggal kalender tidak valid.');
  return input;
}

// Integer arithmetic is exact at the wire's four-place precision, including scientific notation.
function scaled(input: unknown, decimal = false): bigint {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > 9_999_999_999.9999) return invalid('Angka harus nonnegatif dalam rentang Decimal(14,4). Kosong bukan nol.');
  if (!decimal && !Number.isSafeInteger(input)) invalid('Hitungan wajib bilangan bulat; jangan membulatkan data sumber.');
  const [mantissa, exponent = '0'] = String(input).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const shift = 4 + Number(exponent) - fraction.length;
  let digits = BigInt(whole + fraction);
  if (shift < 0) {
    const divisor = 10n ** BigInt(-shift);
    if (digits % divisor !== 0n) invalid('Desimal maksimal empat tempat, tanpa pembulatan otomatis.');
    digits /= divisor;
  } else digits *= 10n ** BigInt(shift);
  return digits;
}
function unscale(value: bigint): number { return Number(value) / 10000; }
function exactDivide(numerator: bigint, denominator: bigint) {
  if (denominator === 0n || numerator % denominator !== 0n) return invalid('Penyebut turunan tidak dapat disimpan tepat dalam Decimal(14,4). Jangan membulatkan; periksa parameter sumber.');
  const value = numerator / denominator;
  if (value > 99999999999999n) invalid('Penyebut turunan melampaui Decimal(14,4).');
  return value;
}

export function calendarSourceDenominator(descriptor: SourceAssessmentDescriptor, year: number, month: number): number | undefined {
  if (descriptor.denominatorRule?.kind !== 'CALENDAR_MONTH_DAYS') return undefined;
  if (!Number.isInteger(year) || year < 2026 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) invalid('Tahun atau bulan kalender tidak valid.');
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function derivedSourceDenominator(descriptor: SourceAssessmentDescriptor, parameters: Record<string, number>): number | undefined {
  const formula = descriptor.formula;
  if (formula?.operator !== 'RATIO_PERCENT') return undefined;
  const values = Object.fromEntries(descriptor.requiredParameters.map(key => [key, scaled(parameters[key], key === 'districtEstimatedTbCases' || key === 'detectionTarget')]));
  let value: bigint | undefined;
  if (formula.documentedFactor !== undefined) value = exactDivide(values.population * scaled(formula.documentedFactor, true), 10000n);
  switch (formula.denominatorDerivation) {
    case 'TB_DETECTION_TARGET_TIMES_FACTORS': case 'INDEX_CASES_TIMES_CONTACT_FACTOR': {
      if (!formula.documentedFactors?.length) invalid('Faktor penyebut sumber tidak tersedia. Muat ulang metadata.');
      const base = formula.denominatorDerivation === 'TB_DETECTION_TARGET_TIMES_FACTORS' ? values.detectionTarget : values.indexCount;
      value = exactDivide(formula.documentedFactors.reduce((product, factor) => product * scaled(factor, true), base), 10000n ** BigInt(formula.documentedFactors.length));
      break;
    }
    case 'REGIONAL_POPULATION_ALLOCATION':
      if (values.districtPopulation === 0n || values.pkmPopulation > values.districtPopulation) invalid('Populasi kabupaten harus positif dan mencakup populasi Puskesmas.');
      value = exactDivide(values.pkmPopulation * values.districtEstimatedTbCases, values.districtPopulation); break;
  }
  return value === undefined ? undefined : unscale(value);
}

export function assertSourceIdentity(profile: Do2026Profile, indicatorId: string): SourceAssessmentDescriptor {
  const descriptor = profile.sourceAssessment;
  if (profile.structuredInputKind !== 'DO_SOURCE_ASSESSMENT' || !descriptor || descriptor.inputKind !== 'DO_SOURCE_ASSESSMENT' ||
    descriptor.contractVersion !== 'DO_SOURCE_ASSESSMENT_V1' || descriptor.sourceDefinition?.indicatorId !== indicatorId ||
    descriptor.definitionId !== profile.definitionId || descriptor.sourceDefinition.definitionId !== profile.definitionId ||
    descriptor.sourceRef !== profile.sourceRef || descriptor.sourceDefinition.sourceRef !== profile.sourceRef ||
    profile.inputAvailable !== true || !['CONTEXTUAL', 'SOURCE_INPUT_ONLY'].includes(profile.status) ||
    profile.calculationAvailability !== descriptor.calculationAvailability || profile.observationPeriod !== descriptor.period ||
    !!profile.annualRecapOnly !== (descriptor.period === 'ANNUAL') || !Object.prototype.hasOwnProperty.call(sourcePeriodLabels, descriptor.period) ||
    typeof profile.definitionId !== 'string' || !profile.definitionId || typeof profile.sourceRef !== 'string' || !profile.sourceRef) {
    return invalid('Identitas definisi dan descriptor asesmen sumber tidak cocok. Muat ulang; penyimpanan ditahan.');
  }
  const expectedKind = descriptor.formula?.operator === 'RATIO_PERCENT' || descriptor.formula?.operator === 'UNRESOLVED_MONTH_MULTIPLIER' ? 'RATIO_AGGREGATE'
    : descriptor.formula?.operator === 'COUNT' ? 'COUNT_AGGREGATE' : descriptor.formula?.operator === 'DOCUMENT_PRESENCE' ? 'DOCUMENT_OBSERVATION'
      : descriptor.formula?.operator === 'COMPONENTS_ONLY' ? 'COMPONENT_OBSERVATIONS' : 'SOURCE_OBSERVATION';
  const executable = descriptor.readiness !== 'SOURCE_CONFLICT' && ['RATIO_PERCENT', 'COUNT'].includes(descriptor.formula?.operator ?? '');
  if (descriptor.expectedValueKind !== expectedKind || descriptor.calculationAvailability !== (executable ? 'AVAILABLE_WITH_CONTEXT' : 'SOURCE_UNRESOLVED') ||
    profile.status !== (executable ? 'CONTEXTUAL' : 'SOURCE_INPUT_ONLY') || descriptor.performanceScoreAvailable !== false ||
    descriptor.referenceAuthority !== 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED' || !Array.isArray(descriptor.requiredContext) ||
    descriptor.requiredContext.some(row => !row || typeof row.key !== 'string' || !row.key || typeof row.label !== 'string' || row.input !== 'REFERENCED_ASSESSMENT') ||
    !Array.isArray(descriptor.criteria) || descriptor.criteria.some(row => typeof row !== 'string') ||
    !Array.isArray(descriptor.unresolved) || descriptor.unresolved.some(row => typeof row !== 'string') ||
    !Array.isArray(descriptor.requiredParameters) || descriptor.requiredParameters.some(row => typeof row !== 'string') ||
    !descriptor.target || typeof descriptor.periodInstruction !== 'string' ||
    (descriptor.formula?.operator === 'COMPONENTS_ONLY' && (!Array.isArray(descriptor.formula.components) || descriptor.formula.components.some(row => !row || typeof row.key !== 'string'))) ||
    new Set(descriptor.requiredContext.map(row => row.key)).size !== descriptor.requiredContext.length) invalid('Descriptor asesmen tidak konsisten. Muat ulang metadata.');
  const rule = descriptor.denominatorRule;
  const ratio = descriptor.formula?.operator === 'RATIO_PERCENT' ? descriptor.formula : undefined;
  const expectedRule = indicatorId === 'K1-R34' ? 'CALENDAR_MONTH_DAYS' : ratio?.fixedDenominator !== undefined ? 'FIXED' : descriptor.requiredParameters.length ? 'SOURCE_PARAMETERS' : null;
  if (expectedRule === null ? rule !== null : !rule || rule.kind !== expectedRule) invalid('Aturan penyebut sumber hilang atau tidak konsisten. Muat ulang metadata.');
  if (rule) {
    object(rule, rule.kind === 'FIXED' ? ['kind', 'value', 'sourceRef', 'sourceQuote'] : rule.kind === 'CALENDAR_MONTH_DAYS'
      ? ['kind', 'inputs', 'unit', 'sourceRef', 'sourceQuote', 'submittedDenominator']
      : ['kind', 'inputs', 'sourceRef', 'sourceQuote', 'arithmetic', 'maximumDecimalPlaces', 'submittedDenominator']);
    if (rule.sourceRef !== (rule.kind === 'CALENDAR_MONTH_DAYS' ? 'S1:KLASTER I!F34' : descriptor.sourceRef) || rule.sourceQuote !== descriptor.sourceDefinition.calculation ||
      (rule.kind === 'FIXED' && rule.value !== ratio?.fixedDenominator) ||
      (rule.kind === 'CALENDAR_MONTH_DAYS' && (descriptor.period !== 'MONTH' || rule.unit !== 'DAY' || JSON.stringify(rule.inputs) !== JSON.stringify(['year', 'period.month']))) ||
      (rule.kind === 'SOURCE_PARAMETERS' && (rule.arithmetic !== 'EXACT_SCALED_INTEGER' || rule.maximumDecimalPlaces !== 4 || JSON.stringify(rule.inputs) !== JSON.stringify(descriptor.requiredParameters))) ||
      (rule.kind !== 'FIXED' && rule.submittedDenominator !== 'MUST_EQUAL_SERVER_DERIVATION')) invalid('Aturan penyebut sumber tidak konsisten.');
  }
  const window = descriptor.periodWindowRule;
  if (descriptor.period === 'TWO_YEAR_DOCUMENT_WINDOW') {
    object(window, ['kind', 'authority', 'startDateRule', 'endDateRule', 'sourceRef', 'sourceQuote']);
    if (window?.kind !== 'CURRENT_AND_PREVIOUS_ASSESSMENT_YEAR_TO_CUTOFF' || window.authority !== 'PROVISIONAL_TECHNICAL_CONVENTION_NOT_SOURCE_MANDATED' ||
      window.startDateRule !== 'JANUARY_1_OF_YEAR_MINUS_ONE' || window.endDateRule !== 'CUTOFF_DATE' || window.sourceRef !== descriptor.sourceRef || window.sourceQuote !== descriptor.sourceDefinition.calculation) invalid('Konvensi jendela dokumen tidak konsisten.');
  } else if (window !== null) invalid('Aturan jendela dokumen tidak berlaku.');
  const nihil = descriptor.verifiedNihilRule;
  const nihilIds = ['K3-R11', 'K3-R48', 'K3-R49', 'K3-R12'];
  if (nihilIds.includes(indicatorId)) {
    object(nihil, ['kind', 'measurement', 'targetMet', 'numericScore', 'available', 'inputField', 'requiredFields', 'matchingFields', 'requiresCompleteContext', 'requiresZeroNumeratorAndDenominator', 'noResidualPriorYearObligationConfirmed', 'referenceInstruction', 'sourceRef', 'sourceQuote', 'referenceAuthority']);
    if (nihil?.kind !== 'DINSOS_VERIFIED_NIHIL' || nihil.available !== (executable && indicatorId !== 'K3-R12') || nihil.inputField !== 'verifiedNihil' ||
      nihil.measurement !== null || nihil.numericScore !== null || nihil.targetMet !== true || nihil.requiresCompleteContext !== true || nihil.requiresZeroNumeratorAndDenominator !== true ||
      nihil.noResidualPriorYearObligationConfirmed !== true || nihil.referenceAuthority !== descriptor.referenceAuthority || typeof nihil.referenceInstruction !== 'string' ||
      nihil.sourceRef !== descriptor.sourceRef || nihil.sourceQuote !== descriptor.sourceDefinition.calculation ||
      JSON.stringify(nihil.requiredFields) !== JSON.stringify(['kind', 'dinsosReference', 'cohortAbsenceReference', 'noResidualPriorYearObligationConfirmed', 'definitionId', 'year', 'periodStartDate', 'periodEndDate', 'cutoffDate', 'territoryReference']) ||
      JSON.stringify(nihil.matchingFields) !== JSON.stringify(['definitionId', 'year', 'periodStartDate', 'periodEndDate', 'cutoffDate', 'territoryReference'])) invalid('Aturan nihil terverifikasi tidak konsisten.');
  } else if (nihil !== null) invalid('Pengecualian nihil tidak tersedia pada indikator ini.');
  if (JSON.stringify(profile.localResolution) !== JSON.stringify(descriptor.localResolution)) invalid('Descriptor solusi lokal dan profil tidak cocok. Muat ulang metadata.');
  if (descriptor.localResolution) assertLocalResolutionDescriptor(descriptor.localResolution, descriptor);
  return descriptor;
}

export function assertLocalResolutionDescriptor(local: LocalResolutionDescriptor, source: SourceAssessmentDescriptor) {
  const ids = ['K1-R9', 'K1-R10', 'K1-R53', 'K1-R71', 'K1-R88', 'K1-R101', 'K1-R139', 'K2-R32', 'K2-R34', 'K2-R35', 'K2-R48', 'K2-R60', 'K3-R10', 'K3-R12', 'K3-R19', 'K3-R25', 'K4-R22', 'K4-R29', 'K4-R36', 'K4-R37', 'K5-R13', 'K5-R14', 'K5-R16', 'K5-R17', 'K5-R27', 'K5-R28', 'K5-R42', 'K5-R44'];
  if (!ids.includes(local.indicatorId) || local.indicatorId !== source.sourceDefinition?.indicatorId || local.definitionId !== source.definitionId ||
    local.sourceRef !== source.sourceRef || local.contractVersion !== 'DO_LOCAL_RESOLUTION_V1' || local.decisionId !== `LOCAL_V1:${local.indicatorId}` ||
    source.calculationAvailability !== 'SOURCE_UNRESOLVED' || local.sourceClassification !== 'SOURCE_UNRESOLVED' ||
    local.availability !== 'EXPLICIT_OPT_IN_ONLY' || local.inputField !== 'localResolution' || local.targetPolicy !== 'EXPLICIT_DESCRIPTOR_CANDIDATE_ONLY' ||
    local.performanceScoreAvailable !== false || local.aggregation !== 'NONE' || local.approvalStatus !== 'PROVISIONAL_USER_ACCEPTED_LOCAL_RESOLUTION' ||
    local.scopeBinding !== 'SOURCE_PERIOD_EXACT_AND_LOCAL_PERIOD_WITHIN_SOURCE_AND_SAME_SLOT' ||
    local.periodPolicy !== (['K2-R35', 'K4-R29', 'K5-R27'].includes(local.indicatorId) ? 'MONTH' : 'SOURCE_PERIOD') ||
    local.period !== (local.periodPolicy === 'MONTH' ? 'MONTH' : source.period) ||
    local.precision?.maximumInput !== 9_999_999_999.9999 || local.precision.resultDecimalPlaces !== 8 || local.precision.roundingAffectsTarget !== false ||
    JSON.stringify(local.requiredAcceptance) !== JSON.stringify(['accepted', 'acceptanceReference', 'measurementPolicyReference', 'correctionAuthorityReference']) ||
    !Array.isArray(local.metrics) || !local.metrics.length || !Array.isArray(local.requiredReferences) || !local.requiredReferences.length ||
    !Array.isArray(local.constraints)) invalid('Descriptor solusi lokal tidak konsisten. Penyimpanan ditahan.');
  text(local.label); text(local.referenceInstruction); local.constraints.forEach(text); local.requiredReferences.forEach(text);
  const keys = local.metrics.map(metric => metric.key);
  if (new Set(keys).size !== keys.length || new Set(local.requiredReferences).size !== local.requiredReferences.length ||
    (local.primaryMetricKey !== null && !keys.includes(local.primaryMetricKey))) invalid('Kunci metrik/referensi lokal tidak konsisten.');
  const seen = new Set<string>();
  for (const metric of local.metrics) {
    text(metric.key); text(metric.label);
    if (!['RATIO', 'COUNT', 'BOOLEAN', 'POPULATION_RATIO'].includes(metric.type) || ![0, 4].includes(metric.decimalPlaces) ||
      typeof metric.required !== 'boolean' || typeof metric.subset !== 'boolean' ||
      (metric.targetValue !== undefined && (typeof metric.targetValue !== 'number' || !Number.isFinite(metric.targetValue))) ||
      (metric.sameDenominatorAs !== undefined && !keys.includes(metric.sameDenominatorAs)) ||
      (metric.intersectionOf !== undefined && (!Array.isArray(metric.intersectionOf) || metric.intersectionOf.some((key: string) => !keys.includes(key)))) ||
      (metric.derivedFrom !== undefined && (!Array.isArray(metric.derivedFrom) || !metric.derivedFrom.length || metric.derivedFrom.some((key: string) => !seen.has(key)) || !['ALL', 'COUNT_TRUE'].includes(metric.derivation ?? '')))) invalid('Aturan metrik lokal tidak dikenal.');
    if (metric.type === 'RATIO' || metric.type === 'POPULATION_RATIO') { text(metric.numeratorLabel); text(metric.denominatorLabel); }
    seen.add(metric.key);
  }
}

export function validateLocalResolution(input: unknown, parent: SourceAssessmentInput, source: SourceAssessmentDescriptor) {
  const descriptor = source.localResolution;
  if (!descriptor) return invalid('Solusi lokal tidak tersedia pada descriptor ini.');
  assertLocalResolutionDescriptor(descriptor, source);
  const root = object(input, ['contractVersion', 'decisionId', 'indicatorId', 'definitionId', 'year', 'territoryReference', 'sourcePeriod', 'period', 'accepted', 'acceptanceReference', 'measurementPolicyReference', 'correctionAuthorityReference', 'references', 'metrics'], ['targetPolicy']);
  if (root.contractVersion !== descriptor.contractVersion || root.decisionId !== descriptor.decisionId || root.indicatorId !== descriptor.indicatorId ||
    root.definitionId !== parent.definitionId || root.year !== parent.year || root.territoryReference !== parent.provenance.territoryReference || root.accepted !== true) invalid('Identitas, versi, wilayah, tahun atau penerimaan solusi lokal tidak cocok.');
  ['territoryReference', 'acceptanceReference', 'measurementPolicyReference', 'correctionAuthorityReference'].forEach(key => text(root[key]));
  const bindPeriod = (value: unknown) => {
    const row = object(value, Object.keys(parent.period));
    if (Object.entries(parent.period).some(([key, entry]) => row[key] !== entry)) invalid('Periode sumber solusi lokal wajib identik dengan asesmen asli.');
  };
  bindPeriod(root.sourcePeriod);
  if (descriptor.periodPolicy === 'SOURCE_PERIOD') bindPeriod(root.period);
  else {
    const row = object(root.period, ['kind', 'startDate', 'endDate', 'cutoffDate', 'reference', 'month']);
    text(row.reference);
    const month = Number(parent.period.cutoffDate.slice(5, 7)), y = String(parent.year).padStart(4, '0'), m = String(month).padStart(2, '0');
    const start = `${y}-${m}-01`, end = `${y}-${m}-${new Date(Date.UTC(parent.year, month, 0)).getUTCDate()}`;
    if (row.kind !== 'MONTH' || row.month !== month || row.startDate !== start || row.endDate !== end || row.cutoffDate !== end ||
      start < parent.period.startDate || end > parent.period.endDate || end > parent.period.cutoffDate ||
      (descriptor.indicatorId === 'K2-R35' && month !== 2 && month !== 8)) invalid('Periode lokal wajib satu bulan penuh dalam sumber dan slot akhir bulan sama; vitamin A hanya Februari/Agustus.');
  }
  Object.values(object(root.references, descriptor.requiredReferences)).forEach(text);
  const submitted = descriptor.metrics.filter(metric => !metric.derivedFrom);
  const metrics = object(root.metrics, submitted.filter(metric => metric.required).map(metric => metric.key), submitted.filter(metric => !metric.required).map(metric => metric.key));
  const values = new Map<string, { n: bigint; d: bigint }>();
  for (const metric of submitted) {
    if (metrics[metric.key] == null) continue;
    const fields = metric.type === 'COUNT' ? ['count'] : metric.type === 'BOOLEAN' ? ['satisfied'] : ['numerator', 'denominator'];
    if (metric.type === 'POPULATION_RATIO') fields.push('population', 'prevalencePercent', 'populationReference', 'prevalenceReference');
    const row = object(metrics[metric.key], fields);
    if (metric.type === 'BOOLEAN') { if (typeof row.satisfied !== 'boolean') invalid('Observasi boolean lokal wajib dinyatakan ya/tidak.'); }
    else if (metric.type === 'COUNT') scaled(row.count);
    else {
      const n = scaled(row.numerator, metric.decimalPlaces === 4), d = scaled(row.denominator, metric.type === 'POPULATION_RATIO' || metric.decimalPlaces === 4);
      if (metric.subset && n > d) invalid('Pembilang subset lokal melebihi penyebut.');
      if (metric.type === 'POPULATION_RATIO') {
        const population = scaled(row.population), prevalence = scaled(row.prevalencePercent, true);
        text(row.populationReference); text(row.prevalenceReference);
        if (population === 0n || prevalence === 0n || prevalence > 1000000n) invalid('Populasi dan prevalensi lokal harus positif, prevalensi maksimal 100%.');
        if (d !== exactDivide(population * prevalence, 1000000n)) invalid('Estimasi D wajib tepat populasi x prevalensi/100, tanpa pembulatan.');
      }
      values.set(metric.key, { n, d });
    }
  }
  // Group static links before comparing observations so null anchors cannot split a shared universe.
  const denominatorGroups = new Map<string, Set<string>>();
  for (const metric of descriptor.metrics) {
    if (!metric.sameDenominatorAs) continue;
    const group = new Set([
      ...(denominatorGroups.get(metric.key) ?? [metric.key]),
      ...(denominatorGroups.get(metric.sameDenominatorAs) ?? [metric.sameDenominatorAs]),
    ]);
    for (const key of group) denominatorGroups.set(key, group);
  }
  const sharedDenominators = new Map<Set<string>, bigint>();
  for (const metric of descriptor.metrics) {
    const own = values.get(metric.key);
    if (!own) continue;
    const group = denominatorGroups.get(metric.key);
    if (group) {
      const denominator = sharedDenominators.get(group);
      if (denominator !== undefined && own.d !== denominator) invalid('Penyebut komponen lokal pada semesta yang sama harus identik.');
      sharedDenominators.set(group, own.d);
    }
    for (const key of metric.intersectionOf ?? []) if (values.has(key) && own.n > values.get(key)!.n) invalid('Konjungsi lokal melebihi salah satu komponennya.');
    if (metric.intersectionOf?.every(key => values.has(key))) {
      const sum = metric.intersectionOf.reduce((total, key) => total + values.get(key)!.n, 0n);
      if (own.n < sum - own.d * BigInt(metric.intersectionOf.length - 1)) invalid('Konjungsi lokal di bawah batas irisan komponen.');
    }
  }
  if (descriptor.indicatorId === 'K2-R32' && values.has('testingCoverage') && values.has('antiHbsReactive') && values.get('testingCoverage')!.n !== values.get('antiHbsReactive')!.d) invalid('Jumlah anak diperiksa harus sama pada kedua metrik kohort.');
  if (Object.prototype.hasOwnProperty.call(root, 'targetPolicy')) {
    const target = object(root.targetPolicy, ['metricKey', 'value', 'reference']);
    const candidate = descriptor.metrics.find(metric => metric.key === target.metricKey && metric.targetValue !== undefined);
    if (!candidate || target.value !== candidate.targetValue || !Object.prototype.hasOwnProperty.call(metrics, candidate.key) || metrics[candidate.key] === null) invalid('Target lokal hanya boleh kandidat descriptor yang dipilih eksplisit untuk observasi tersedia.');
    text(target.reference);
  }
}

export function sourceAssessmentCounts(input: SourceAssessmentInput) {
  switch (input.values.kind) {
    case 'RATIO_AGGREGATE': return { numerator: input.values.numerator, denominator: input.values.denominator };
    case 'COUNT_AGGREGATE': return { numerator: input.values.count, denominator: 0 };
    case 'DOCUMENT_OBSERVATION': return { numerator: input.values.present ? 1 : 0, denominator: 0 };
    // The recap API requires 0/0 placeholders, not a fabricated combined observation.
    default: return { numerator: 0, denominator: 0 };
  }
}

export function validateSourceAssessment(value: unknown, descriptor: SourceAssessmentDescriptor, year: number, endMonth: number): asserts value is SourceAssessmentInput {
  const root = object(value, ['kind', 'contractVersion', 'definitionId', 'year', 'period', 'values', 'context', 'provenance', 'attestation'], ['denominatorContext', 'parameters', 'exceedReviewReference', 'verifiedNihil', 'localResolution']);
  if (root.kind !== 'DO_SOURCE_ASSESSMENT' || root.contractVersion !== descriptor.contractVersion || root.definitionId !== descriptor.definitionId || root.year !== year ||
    !Number.isInteger(year) || year < 2026 || year > 9999 || !Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) invalid('Jenis, versi, definisi, tahun atau akhir bulan tidak sesuai rekap.');
  const extra = descriptor.period === 'MONTH' ? ['month'] : descriptor.period === 'QUARTER' ? ['quarter'] : descriptor.period === 'AS_OF' ? ['asOf']
    : descriptor.period === 'SCHOOL_YEAR' ? ['schoolYear'] : ['PREVIOUS_YEAR_DOCUMENT', 'NEXT_YEAR_DOCUMENT'].includes(descriptor.period) ? ['documentYear'] : [];
  const period = object(root.period, ['kind', 'startDate', 'endDate', 'cutoffDate', 'reference', ...extra]);
  if (period.kind !== descriptor.period) invalid('Jenis periode berbeda dari sumber DO.');
  const start = date(period.startDate), end = date(period.endDate), cutoff = date(period.cutoffDate);
  text(period.reference);
  if (start > end || Number(cutoff.slice(0, 4)) !== year || Number(cutoff.slice(5, 7)) !== endMonth) invalid('Rentang atau cutoff tidak cocok dengan tahun dan akhir bulan rekap.');
  const y = String(year).padStart(4, '0');
  const monthEnd = (month: number) => `${y}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  switch (descriptor.period) {
    case 'ANNUAL': if (start !== `${y}-01-01` || end !== `${y}-12-31` || cutoff !== end || endMonth !== 12) invalid('Tahunan wajib Januari sampai Desember penuh.'); break;
    case 'MONTH': if (period.month !== endMonth || start !== `${y}-${String(endMonth).padStart(2, '0')}-01` || end !== monthEnd(endMonth) || cutoff !== end) invalid('Bulanan wajib tepat satu bulan penuh, bukan YTD.'); break;
    case 'QUARTER': if (!Number.isInteger(period.quarter) || Number(period.quarter) < 1 || Number(period.quarter) > 4 || endMonth !== Number(period.quarter) * 3 || start !== `${y}-${String(Number(period.quarter) * 3 - 2).padStart(2, '0')}-01` || end !== monthEnd(endMonth) || cutoff !== end) invalid('Triwulan wajib satu triwulan utuh berakhir Maret, Juni, September atau Desember.'); break;
    case 'AS_OF': if (date(period.asOf) !== cutoff || start !== cutoff || end !== cutoff) invalid('Snapshot wajib satu tanggal acuan eksplisit.'); break;
    case 'SCHOOL_YEAR': if (year !== 2026 || period.schoolYear !== '2025/2026' || !start.startsWith('2025-') || !end.startsWith('2026-')) invalid('Sumber menetapkan tahun ajaran 2025/2026; bukan tahun kalender.'); break;
    case 'PREVIOUS_YEAR_DOCUMENT': case 'NEXT_YEAR_DOCUMENT': if (period.documentYear !== year + (descriptor.period === 'NEXT_YEAR_DOCUMENT' ? 1 : -1)) invalid('Tahun dokumen tidak sesuai tahun sebelum/sesudah penilaian.'); break;
    case 'TWO_YEAR_DOCUMENT_WINDOW': if (start !== `${year - 1}-01-01` || end !== cutoff) invalid('Konvensi teknis provisional: jendela dokumen mulai 1 Januari tahun penilaian sebelumnya sampai tepat pada cutoff.'); break;
  }
  const context = object(root.context, descriptor.requiredContext.map(row => row.key));
  for (const { key } of descriptor.requiredContext) {
    const row = object(context[key], ['reference', 'description', 'status']);
    text(row.reference); text(row.description);
    if (row.status !== 'AVAILABLE' && row.status !== 'UNRESOLVED') invalid('Status konteks tidak dikenal.');
  }
  const provenance = object(root.provenance, ['territoryReference', 'sourceSnapshotReference', 'numeratorEvidenceReference', 'denominatorEvidenceReference', 'eligibilityReference', 'completenessReference', 'grainReference', 'numeratorUnit', 'denominatorUnit', 'reconciliationReference']);
  Object.values(provenance).forEach(text);
  const attestation = object(root.attestation, ['status', 'sourceCoverageComplete', 'eligibilityReviewed', 'grainReconciled', 'criteriaReferences']);
  if (!['COMPLETE', 'INCOMPLETE', 'NOT_YET_DUE', 'NOT_APPLICABLE'].includes(String(attestation.status)) ||
    ['sourceCoverageComplete', 'eligibilityReviewed', 'grainReconciled'].some(key => typeof attestation[key] !== 'boolean')) invalid('Status dan konfirmasi attestasi tidak valid.');
  if (!Array.isArray(attestation.criteriaReferences) || attestation.criteriaReferences.length !== descriptor.criteria.length) invalid('Referensi setiap kriteria wajib lengkap.');
  attestation.criteriaReferences.forEach(text);
  if (end > cutoff && !(descriptor.period === 'COHORT_WINDOW' && attestation.status === 'NOT_YET_DUE')) invalid('Observasi melewati cutoff. Kohort belum matang harus dinyatakan belum jatuh jadwal.');
  const ratio = descriptor.formula?.operator === 'RATIO_PERCENT' ? descriptor.formula : undefined;
  let estimated = ratio?.input === 'ESTIMATED';
  if (ratio?.denominatorBasis === 'SASARAN' || ratio?.denominatorBasis === 'ESTIMATE') {
    const row = object(root.denominatorContext, ['origin', 'methodReference', 'referenceYear', 'territoryReference', 'allocationReference']);
    if ((row.origin !== 'INTEGER' && row.origin !== 'ESTIMATED') || (ratio.denominatorBasis === 'ESTIMATE' && row.origin !== 'ESTIMATED')) invalid('Pilih asal penyebut riil/estimasi sesuai sumber.');
    if (!Number.isInteger(row.referenceYear) || Number(row.referenceYear) < 1900 || Number(row.referenceYear) > year) invalid('Tahun acuan penyebut harus 1900 sampai tahun rekap.');
    ['methodReference', 'territoryReference', 'allocationReference'].forEach(key => text(row[key]));
    if (row.territoryReference !== provenance.territoryReference) invalid('Referensi wilayah penyebut dan asesmen harus sama.');
    estimated = row.origin === 'ESTIMATED';
  } else if (root.denominatorContext !== undefined) invalid('Konteks penyebut tidak berlaku pada profil ini.');
  let derived = calendarSourceDenominator(descriptor, year, endMonth);
  if (descriptor.requiredParameters.length) {
    const parameters = object(root.parameters, descriptor.requiredParameters);
    derived = derivedSourceDenominator(descriptor, parameters as Record<string, number>);
  } else if (root.parameters !== undefined) invalid('Parameter tidak dideklarasikan untuk profil ini.');
  const fields = { RATIO_AGGREGATE: ['numerator', 'denominator'], COUNT_AGGREGATE: ['count'], DOCUMENT_OBSERVATION: ['present'], COMPONENT_OBSERVATIONS: ['components'], SOURCE_OBSERVATION: ['count', 'unit', 'reference'] };
  const values = object(root.values, ['kind', ...fields[descriptor.expectedValueKind]]);
  if (values.kind !== descriptor.expectedValueKind) invalid('Jenis observasi berbeda dari formula sumber.');
  if (values.kind === 'RATIO_AGGREGATE') {
    const decimal = ratio?.input === 'DECIMAL_MONEY' || ratio?.input === 'DECIMAL_SCORE';
    const n = scaled(values.numerator, decimal), d = scaled(values.denominator, decimal || estimated);
    if (ratio?.fixedDenominator !== undefined && d !== scaled(ratio.fixedDenominator, true)) invalid('Penyebut tetap tidak sesuai DO.');
    if (derived !== undefined && d !== scaled(derived, true)) invalid('Penyebut tidak sama dengan hasil tepat parameter dan faktor sumber.');
    if (ratio?.numeratorSubset === true && n > d) invalid('Pembilang subset tidak boleh melebihi penyebut.');
    if (n > d) text(root.exceedReviewReference);
  } else if (values.kind === 'COUNT_AGGREGATE') scaled(values.count);
  else if (values.kind === 'DOCUMENT_OBSERVATION') { if (typeof values.present !== 'boolean') invalid('Pilih kehadiran dokumen secara eksplisit.'); }
  else if (values.kind === 'SOURCE_OBSERVATION') { scaled(values.count); text(values.unit); text(values.reference); }
  else if (descriptor.formula?.operator === 'COMPONENTS_ONLY') {
    const components = object(values.components, descriptor.formula.components.map(row => row.key));
    for (const component of descriptor.formula.components) {
      const row = object(components[component.key], ['numerator', 'denominator', 'unit', 'reference']);
      const decimal = 'input' in component ? component.input === 'DECIMAL_MONEY' : component.unit === 'SOURCE_UNRESOLVED';
      scaled(row.numerator, decimal); scaled(row.denominator, decimal); text(row.unit); text(row.reference);
      if ('unit' in component && component.unit === 'COUNT_DOCUMENT' && row.unit !== 'COUNT_DOCUMENT') invalid('Unit komponen dokumen harus COUNT_DOCUMENT.');
    }
  }
  if (root.exceedReviewReference !== undefined) text(root.exceedReviewReference);
  if (root.verifiedNihil !== undefined) {
    if (!['K3-R11', 'K3-R48', 'K3-R49'].includes(descriptor.sourceDefinition?.indicatorId ?? '') || descriptor.verifiedNihilRule?.available !== true || descriptor.readiness === 'SOURCE_CONFLICT') invalid('Pengecualian nihil Dinsos tidak tersedia; konflik sumber tidak dapat ditimpa attestasi.');
    const nihil = object(root.verifiedNihil, ['kind', 'dinsosReference', 'cohortAbsenceReference', 'noResidualPriorYearObligationConfirmed', 'definitionId', 'year', 'periodStartDate', 'periodEndDate', 'cutoffDate', 'territoryReference']);
    text(nihil.dinsosReference); text(nihil.cohortAbsenceReference); text(nihil.territoryReference);
    const complete = attestation.status === 'COMPLETE' && attestation.sourceCoverageComplete === true && attestation.eligibilityReviewed === true && attestation.grainReconciled === true && descriptor.requiredContext.every(({ key }) => (context[key] as { status: string }).status === 'AVAILABLE');
    if (nihil.kind !== 'DINSOS_VERIFIED_NIHIL' || nihil.noResidualPriorYearObligationConfirmed !== true || !complete || values.kind !== 'RATIO_AGGREGATE' || values.numerator !== 0 || values.denominator !== 0 ||
      nihil.definitionId !== descriptor.definitionId || nihil.year !== year || nihil.periodStartDate !== start || nihil.periodEndDate !== end || nihil.cutoffDate !== cutoff || nihil.territoryReference !== provenance.territoryReference) invalid('Nihil wajib cocok dengan definisi, tahun, periode dan wilayah, N=D=0, konteks lengkap serta tanpa kewajiban kohort tahun lalu yang tersisa.');
  }
  if (Object.prototype.hasOwnProperty.call(root, 'localResolution')) validateLocalResolution(root.localResolution, value as SourceAssessmentInput, descriptor);
}

export function createSourceAssessmentDraft(descriptor: SourceAssessmentDescriptor, year: number, endMonth: number): SourceAssessmentDraft {
  const y = String(year).padStart(4, '0'), m = String(endMonth).padStart(2, '0');
  const end = `${y}-${m}-${new Date(Date.UTC(year, endMonth, 0)).getUTCDate()}`;
  const period: SourceAssessmentDraft['period'] = { kind: descriptor.period, startDate: '', endDate: '', cutoffDate: '', reference: '' };
  if (descriptor.period === 'ANNUAL') Object.assign(period, { startDate: `${y}-01-01`, endDate: `${y}-12-31`, cutoffDate: `${y}-12-31` });
  if (descriptor.period === 'MONTH') Object.assign(period, { month: endMonth, startDate: `${y}-${m}-01`, endDate: end, cutoffDate: end });
  if (descriptor.period === 'QUARTER' && endMonth % 3 === 0) Object.assign(period, { quarter: endMonth / 3, startDate: `${y}-${String(endMonth - 2).padStart(2, '0')}-01`, endDate: end, cutoffDate: end });
  if (descriptor.period === 'AS_OF') period.asOf = '';
  if (descriptor.periodWindowRule?.kind === 'CURRENT_AND_PREVIOUS_ASSESSMENT_YEAR_TO_CUTOFF') period.startDate = `${year - 1}-01-01`;
  if (descriptor.period === 'SCHOOL_YEAR') period.schoolYear = '2025/2026';
  if (descriptor.period === 'PREVIOUS_YEAR_DOCUMENT' || descriptor.period === 'NEXT_YEAR_DOCUMENT') period.documentYear = year + (descriptor.period === 'NEXT_YEAR_DOCUMENT' ? 1 : -1);
  const formula = descriptor.formula;
  const values: SourceAssessmentDraft['values'] = descriptor.expectedValueKind === 'RATIO_AGGREGATE' ? { kind: 'RATIO_AGGREGATE', numerator: '', denominator: calendarSourceDenominator(descriptor, year, endMonth) ?? (formula?.operator === 'RATIO_PERCENT' ? formula.fixedDenominator ?? '' : '') }
    : descriptor.expectedValueKind === 'COUNT_AGGREGATE' ? { kind: 'COUNT_AGGREGATE', count: '' }
      : descriptor.expectedValueKind === 'DOCUMENT_OBSERVATION' ? { kind: 'DOCUMENT_OBSERVATION', present: '' }
        : descriptor.expectedValueKind === 'COMPONENT_OBSERVATIONS' ? { kind: 'COMPONENT_OBSERVATIONS', components: Object.fromEntries(formula?.operator === 'COMPONENTS_ONLY' ? formula.components.map(row => [row.key, { numerator: '', denominator: '', unit: 'unit' in row && row.unit === 'COUNT_DOCUMENT' ? 'COUNT_DOCUMENT' : '', reference: '' }]) : []) }
          : { kind: 'SOURCE_OBSERVATION', count: '', unit: '', reference: '' };
  return { kind: 'DO_SOURCE_ASSESSMENT', contractVersion: descriptor.contractVersion, definitionId: descriptor.definitionId, year, period, values,
    context: Object.fromEntries(descriptor.requiredContext.map(({ key }) => [key, { reference: '', description: '', status: 'UNRESOLVED' }])),
    provenance: { territoryReference: '', sourceSnapshotReference: '', numeratorEvidenceReference: '', denominatorEvidenceReference: '', eligibilityReference: '', completenessReference: '', grainReference: '', numeratorUnit: '', denominatorUnit: '', reconciliationReference: '' },
    attestation: { status: 'INCOMPLETE', sourceCoverageComplete: false, eligibilityReviewed: false, grainReconciled: false, criteriaReferences: descriptor.criteria.map(() => '') },
    ...(formula?.operator === 'RATIO_PERCENT' && ['SASARAN', 'ESTIMATE'].includes(formula.denominatorBasis ?? '') ? { denominatorContext: { origin: formula.denominatorBasis === 'ESTIMATE' ? 'ESTIMATED' : 'INTEGER', referenceYear: '', territoryReference: '', methodReference: '', allocationReference: '' } } : {}),
    ...(descriptor.requiredParameters.length ? { parameters: Object.fromEntries(descriptor.requiredParameters.map(key => [key, ''])) } : {}),
  };
}

export function bindLocalResolutionDraft(draft: SourceAssessmentDraft): SourceAssessmentDraft {
  const local = draft.localResolution;
  if (!local) return draft;
  // Only identity/scope bindings follow source edits; never manufacture evidence or metric values.
  return { ...draft, localResolution: { ...local, definitionId: draft.definitionId, year: draft.year,
    territoryReference: draft.provenance.territoryReference, sourcePeriod: { ...draft.period },
    period: local.period.kind === 'MONTH' && ['K2-R35', 'K4-R29', 'K5-R27'].includes(local.indicatorId)
      ? localMonthPeriod(draft, local.period.reference) : { ...draft.period } } };
}

function localMonthPeriod(draft: SourceAssessmentDraft, reference: string): SourceAssessmentDraft['period'] {
  const year = Number(draft.year), month = Number(draft.period.cutoffDate.slice(5, 7));
  const valid = Number.isInteger(month) && month >= 1 && month <= 12;
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const end = valid ? `${prefix}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` : '';
  return { kind: 'MONTH', month: valid ? month : '', startDate: valid ? `${prefix}-01` : '', endDate: end, cutoffDate: end, reference };
}

export function createLocalResolutionDraft(draft: SourceAssessmentDraft, descriptor: LocalResolutionDescriptor): NonNullable<SourceAssessmentDraft['localResolution']> {
  return { contractVersion: descriptor.contractVersion, decisionId: descriptor.decisionId, indicatorId: descriptor.indicatorId,
    definitionId: draft.definitionId, year: draft.year, territoryReference: draft.provenance.territoryReference,
    sourcePeriod: { ...draft.period }, period: descriptor.periodPolicy === 'MONTH' ? localMonthPeriod(draft, '') : { ...draft.period },
    accepted: true, acceptanceReference: '', measurementPolicyReference: '', correctionAuthorityReference: '',
    references: Object.fromEntries(descriptor.requiredReferences.map(key => [key, ''])),
    metrics: Object.fromEntries(descriptor.metrics.filter(metric => !metric.derivedFrom && metric.required).map(metric => [metric.key, null])),
  };
}

export function parseSourceAssessmentDraft(draft: SourceAssessmentDraft, descriptor: SourceAssessmentDescriptor, year: number, endMonth: number): SourceAssessmentInput {
  // Only declared numeric paths are converted. Unknown fields survive to strict validation.
  function convert(value: unknown, path = ''): unknown {
    if (typeof value === 'string' && (/^values\.(numerator|denominator|count)$/.test(path) || /^values\.components\.[^.]+\.(numerator|denominator)$/.test(path) || /^parameters\.[^.]+$/.test(path) || path === 'denominatorContext.referenceYear' || /^localResolution\.metrics\.[^.]+\.(numerator|denominator|count|population|prevalencePercent)$/.test(path))) {
      if (!/^\d+(?:\.\d{1,4})?$/.test(value)) invalid('Isi angka nonnegatif maksimal empat desimal. Kosong bukan nol; draft tetap dipertahankan.');
      return Number(value);
    }
    if (Array.isArray(value)) return value.map((row, i) => convert(row, `${path}.${i}`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, convert(row, path ? `${path}.${key}` : key)]));
    return value;
  }
  const result = convert(draft);
  validateSourceAssessment(result, descriptor, year, endMonth);
  return result;
}

export function sourceScopeLabel(period: SourceAssessmentPeriod): string {
  return `${sourcePeriodLabels[period.kind] ?? period.kind}: ${period.startDate} sampai ${period.endDate}; cutoff ${period.cutoffDate}`;
}
