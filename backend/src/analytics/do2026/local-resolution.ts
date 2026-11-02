import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import source from './source.json';
import { LOCAL_RESOLUTION_DEFINITIONS, LOCAL_RESOLUTION_VERSION } from './local-resolution-definitions';
import type { SourceAssessmentInput, SourceAssessmentPeriod } from './source-assessment';

export type LocalMetricInput = { numerator: number; denominator: number } | { count: number } | { satisfied: boolean } | {
  numerator: number; denominator: number; population: number; prevalencePercent: number;
  populationReference: string; prevalenceReference: string;
};
export type LocalResolutionInput = {
  contractVersion: typeof LOCAL_RESOLUTION_VERSION; decisionId: string; indicatorId: string; definitionId: string;
  year: number; territoryReference: string; sourcePeriod: SourceAssessmentPeriod; period: SourceAssessmentPeriod;
  accepted: true; acceptanceReference: string; measurementPolicyReference: string; correctionAuthorityReference: string;
  references: Record<string, string>; metrics: Record<string, LocalMetricInput | null>;
  targetPolicy?: { metricKey: string; value: number; reference: string };
};
export type LocalMetricResult = {
  key: string; label: string; type: string; primary: boolean;
  status: 'MEASURED' | 'INCOMPLETE' | 'ZERO_DENOMINATOR' | 'NOT_YET_DUE' | 'NOT_APPLICABLE' | 'ASSESSMENT_SCOPE_MISMATCH';
  value: number | boolean | null; unit: 'PERCENT' | 'COUNT' | 'BOOLEAN';
  numerator: number | null; denominator: number | null; targetMet: boolean | null;
};
export type LocalResolutionResult = {
  contractVersion: typeof LOCAL_RESOLUTION_VERSION; decisionId: string; indicatorId: string; definitionId: string;
  year: number; territoryReference: string; metrics: LocalMetricResult[]; primaryMetricKey: string | null;
  originalTarget: unknown; alternativeTarget: (LocalResolutionInput['targetPolicy'] & { authority: 'USER_ACCEPTED_LOCAL_POLICY_NOT_SOURCE_APPROVAL'; comparator: 'MIN' }) | null;
  sourceConflicts: readonly string[]; sourceStatus: 'SOURCE_UNRESOLVED';
  sourcePeriod: SourceAssessmentPeriod; assessmentScope: SourceAssessmentPeriod & { label: string; annualComparable: boolean };
  rawNumerator: number; rawDenominator: number; performanceScoreAvailable: false; nilaiKinerja: null;
  assessmentComplete: false; completionScope: 'ARITHMETIC_ONLY'; observationStatus: 'NOT_VERIFIED';
  approvalStatus: 'PROVISIONAL_USER_ACCEPTED_LOCAL_RESOLUTION'; referenceAuthority: 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED';
  measurementPolicyReference: string; correctionAuthorityReference: string; acceptanceReference: string;
  timelinessStatus?: 'NOT_ASSESSED';
};

export function localResolutionDescriptor(id: string, period: SourceAssessmentPeriod['kind']) {
  if (!Object.hasOwn(LOCAL_RESOLUTION_DEFINITIONS, id)) return undefined;
  const rule = LOCAL_RESOLUTION_DEFINITIONS[id]!;
  const identity = source.find(row => row.indicatorId === id)!;
  return {
    ...rule, contractVersion: LOCAL_RESOLUTION_VERSION, decisionId: `LOCAL_V1:${id}`, indicatorId: id,
    definitionId: identity.definitionId, sourceRef: identity.sourceRef,
    inputField: 'localResolution', availability: 'EXPLICIT_OPT_IN_ONLY', sourceClassification: 'SOURCE_UNRESOLVED',
    period: rule.periodPolicy === 'MONTH' ? 'MONTH' : period,
    scopeBinding: 'SOURCE_PERIOD_EXACT_AND_LOCAL_PERIOD_WITHIN_SOURCE_AND_SAME_SLOT',
    referenceInstruction: 'Referensi agregat tanpa PII. Penerimaan lokal bukan pengesahan sumber atau verifikasi bukti.',
    requiredAcceptance: ['accepted', 'acceptanceReference', 'measurementPolicyReference', 'correctionAuthorityReference'],
    precision: { maximumInput: 9_999_999_999.9999, resultDecimalPlaces: 8, roundingAffectsTarget: false },
    targetPolicy: 'EXPLICIT_DESCRIPTOR_CANDIDATE_ONLY', performanceScoreAvailable: false,
    aggregation: 'NONE', approvalStatus: 'PROVISIONAL_USER_ACCEPTED_LOCAL_RESOLUTION',
  } as const;
}

function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_LOCAL_RESOLUTION', message });
}

/** Validates local choices independently of conflicting source context, retaining every source field. */
export function evaluateLocalResolution(id: string, input: unknown, parent: SourceAssessmentInput,
  raw: { numerator: number; denominator: number }, originalTarget: unknown, sourceConflicts: readonly string[]): LocalResolutionResult {
  const descriptor = localResolutionDescriptor(id, parent.period.kind);
  if (!descriptor) invalid('Solusi lokal tidak tersedia untuk indikator ini.');
  const object = (value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid('Objek solusi lokal tidak valid.');
    const row = value as Record<string, unknown>;
    if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) invalid('Field solusi lokal hilang atau tidak dikenal.');
    return row;
  };
  const text = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) invalid('Referensi lokal wajib terisi, maksimal 2000 karakter tanpa kontrol.');
    return value;
  };
  const number = (value: unknown, decimalPlaces = 0): Prisma.Decimal => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9_999_999_999.9999) invalid('Angka lokal harus nonnegatif dalam Decimal(14,4).');
    const result = new Prisma.Decimal(value);
    if (result.decimalPlaces() > decimalPlaces || decimalPlaces === 0 && !Number.isSafeInteger(value)) invalid('Count wajib bulat; hanya uang/prevalensi menerima maksimal empat desimal.');
    return result;
  };
  const root = object(input, ['contractVersion', 'decisionId', 'indicatorId', 'definitionId', 'year', 'territoryReference', 'sourcePeriod', 'period', 'accepted', 'acceptanceReference', 'measurementPolicyReference', 'correctionAuthorityReference', 'references', 'metrics'], ['targetPolicy']);
  if (root.contractVersion !== LOCAL_RESOLUTION_VERSION || root.decisionId !== descriptor.decisionId || root.indicatorId !== id || root.definitionId !== parent.definitionId || root.year !== parent.year || root.territoryReference !== parent.provenance.territoryReference || root.accepted !== true) invalid('Versi, keputusan, identitas, wilayah, tahun atau penerimaan lokal tidak cocok.');
  ['territoryReference', 'acceptanceReference', 'measurementPolicyReference', 'correctionAuthorityReference'].forEach(key => text(root[key]));
  const bindPeriod = (value: unknown) => {
    const row = object(value, Object.keys(parent.period));
    if (Object.entries(parent.period).some(([key, val]) => row[key] !== val)) invalid('Periode sumber solusi lokal berbeda dari asesmen asli.');
    return row as SourceAssessmentPeriod;
  };
  const sourcePeriod = bindPeriod(root.sourcePeriod);
  let period: SourceAssessmentPeriod;
  if (descriptor.periodPolicy === 'SOURCE_PERIOD') period = bindPeriod(root.period);
  else {
    const row = object(root.period, ['kind', 'startDate', 'endDate', 'cutoffDate', 'reference', 'month']);
    text(row.reference);
    const month = Number(parent.period.cutoffDate.slice(5, 7));
    const y = String(parent.year).padStart(4, '0');
    const start = `${y}-${String(month).padStart(2, '0')}-01`;
    const end = `${y}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(parent.year, month, 0)).getUTCDate()}`;
    if (row.kind !== 'MONTH' || row.month !== month || row.startDate !== start || row.endDate !== end || row.cutoffDate !== end || start < sourcePeriod.startDate || end > sourcePeriod.endDate || end > sourcePeriod.cutoffDate) invalid('Periode lokal wajib satu bulan penuh dalam periode sumber, pada slot akhir bulan yang sama.');
    if (id === 'K2-R35' && month !== 2 && month !== 8) invalid('Putaran vitamin A hanya Februari atau Agustus.');
    period = row as SourceAssessmentPeriod;
  }
  const references = object(root.references, descriptor.requiredReferences);
  Object.values(references).forEach(text);
  const submitted = descriptor.metrics.filter(metric => !metric.derivedFrom);
  const metrics = object(root.metrics, submitted.filter(metric => metric.required).map(metric => metric.key), submitted.filter(metric => !metric.required).map(metric => metric.key));
  const values = new Map<string, { n?: Prisma.Decimal; d?: Prisma.Decimal; value: Prisma.Decimal | boolean | null }>();
  for (const metric of submitted) {
    if (metrics[metric.key] == null) { values.set(metric.key, { value: null }); continue; }
    const fields = metric.type === 'COUNT' ? ['count'] : metric.type === 'BOOLEAN' ? ['satisfied'] : ['numerator', 'denominator'];
    if (metric.type === 'POPULATION_RATIO') fields.push('population', 'prevalencePercent', 'populationReference', 'prevalenceReference');
    const row = object(metrics[metric.key], fields);
    if (metric.type === 'BOOLEAN') {
      if (typeof row.satisfied !== 'boolean') invalid('Observasi boolean wajib true/false.');
      values.set(metric.key, { value: row.satisfied });
    } else if (metric.type === 'COUNT') values.set(metric.key, { value: number(row.count) });
    else {
      const n = number(row.numerator, metric.decimalPlaces);
      const d = number(row.denominator, metric.type === 'POPULATION_RATIO' ? 4 : metric.decimalPlaces);
      if (metric.subset && n.gt(d)) invalid('Pembilang subset lokal melebihi penyebut.');
      if (metric.type === 'POPULATION_RATIO') {
        const population = number(row.population), prevalence = number(row.prevalencePercent, 4);
        text(row.populationReference); text(row.prevalenceReference);
        if (population.isZero() || prevalence.lte(0) || prevalence.gt(100)) invalid('Populasi dan prevalensi lokal wajib positif; prevalensi maksimal 100%.');
        // Integer arithmetic prevents rounded Decimal division from authenticating a false denominator.
        const product = BigInt(population.toFixed(0)) * BigInt(prevalence.toFixed(4).replace('.', ''));
        if (product % 100n !== 0n || product / 100n > 99999999999999n || !d.mul(10000).eq((product / 100n).toString())) invalid('Estimasi D harus sama persis populasi x prevalensi/100 dalam empat desimal.');
      }
      values.set(metric.key, { n, d, value: d.isZero() ? null : n.div(d).mul(100) });
    }
  }
  // Build equivalence groups from static keys, including null observations and transitive links.
  const denominatorGroups = new Map<string, Set<string>>();
  for (const metric of descriptor.metrics) {
    if (!metric.sameDenominatorAs) continue;
    const group = new Set([
      ...(denominatorGroups.get(metric.key) ?? [metric.key]),
      ...(denominatorGroups.get(metric.sameDenominatorAs) ?? [metric.sameDenominatorAs]),
    ]);
    for (const key of group) denominatorGroups.set(key, group);
  }
  const sharedDenominators = new Map<Set<string>, Prisma.Decimal>();
  for (const metric of descriptor.metrics) {
    if (metric.derivedFrom) {
      const dependencies = metric.derivedFrom.map(key => values.get(key)?.value ?? null);
      const value = dependencies.some(value => value === null) ? null : metric.derivation === 'COUNT_TRUE'
        ? new Prisma.Decimal(dependencies.filter(value => value === true).length)
        : dependencies.every(value => value === true || value instanceof Prisma.Decimal && value.gte(1));
      values.set(metric.key, { value });
    }
    const own = values.get(metric.key)!;
    const group = denominatorGroups.get(metric.key);
    if (group && own.d !== undefined) {
      const denominator = sharedDenominators.get(group);
      if (denominator !== undefined && !own.d.eq(denominator)) invalid('Penyebut komponen harus identik pada semesta yang sama.');
      sharedDenominators.set(group, own.d);
    }
    for (const key of metric.intersectionOf ?? []) {
      const component = values.get(key);
      if (own.n && component?.n && own.n.gt(component.n)) invalid('Konjungsi tidak boleh melebihi salah satu komponennya.');
    }
    if (own.n && own.d && metric.intersectionOf?.every(key => values.get(key)?.n !== undefined)) {
      const sum = metric.intersectionOf.reduce((total, key) => total.add(values.get(key)!.n!), new Prisma.Decimal(0));
      if (own.n.lt(sum.sub(own.d.mul(metric.intersectionOf.length - 1)))) invalid('Konjungsi bertentangan dengan jumlah komponen pada semesta yang sama.');
    }
  }
  if (id === 'K2-R32' && values.get('testingCoverage')?.n && values.get('antiHbsReactive')?.d && !values.get('testingCoverage')!.n!.eq(values.get('antiHbsReactive')!.d!)) invalid('Anak diperiksa harus sama pada kedua metrik kohort.');
  let alternativeTarget: LocalResolutionResult['alternativeTarget'] = null;
  if (Object.hasOwn(root, 'targetPolicy')) {
    const target = object(root.targetPolicy, ['metricKey', 'value', 'reference']);
    const candidate = descriptor.metrics.find(metric => metric.key === target.metricKey && metric.targetValue !== undefined);
    if (!candidate || target.value !== candidate.targetValue || !Object.hasOwn(metrics, candidate.key) || metrics[candidate.key] === null) invalid('Target lokal hanya boleh kandidat eksplisit untuk metrik yang dipilih.');
    text(target.reference);
    alternativeTarget = { metricKey: candidate.key, value: candidate.targetValue!, reference: target.reference as string, comparator: 'MIN', authority: 'USER_ACCEPTED_LOCAL_POLICY_NOT_SOURCE_APPROVAL' };
  }
  const attestation = parent.attestation;
  const complete = attestation.status === 'COMPLETE' && attestation.sourceCoverageComplete && attestation.eligibilityReviewed && attestation.grainReconciled;
  const results: LocalMetricResult[] = descriptor.metrics.map(metric => {
    const row = values.get(metric.key)!;
    const status: LocalMetricResult['status'] = !complete ? attestation.status === 'NOT_YET_DUE' ? 'NOT_YET_DUE' : attestation.status === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'INCOMPLETE'
      : row.d?.isZero() ? 'ZERO_DENOMINATOR' : row.value === null ? 'INCOMPLETE' : 'MEASURED';
    return {
      key: metric.key, label: metric.label, type: metric.type, primary: metric.key === descriptor.primaryMetricKey,
      status, value: status !== 'MEASURED' ? null : row.value instanceof Prisma.Decimal ? row.value.toDecimalPlaces(8).toNumber() : row.value,
      unit: metric.type === 'BOOLEAN' ? 'BOOLEAN' : metric.type === 'COUNT' ? 'COUNT' : 'PERCENT',
      numerator: row.n?.toNumber() ?? null, denominator: row.d?.toNumber() ?? null,
      targetMet: status === 'MEASURED' && alternativeTarget?.metricKey === metric.key && row.value instanceof Prisma.Decimal ? row.value.gte(alternativeTarget.value) : null,
    };
  });
  return {
    contractVersion: LOCAL_RESOLUTION_VERSION, decisionId: descriptor.decisionId, indicatorId: id, definitionId: parent.definitionId,
    year: parent.year, territoryReference: parent.provenance.territoryReference, metrics: results, primaryMetricKey: descriptor.primaryMetricKey,
    originalTarget, alternativeTarget, sourceConflicts, sourceStatus: 'SOURCE_UNRESOLVED', sourcePeriod,
    assessmentScope: { ...period, label: `Solusi lokal ${period.kind}: ${period.startDate} - ${period.endDate}`, annualComparable: period.kind === 'ANNUAL' },
    rawNumerator: raw.numerator, rawDenominator: raw.denominator, performanceScoreAvailable: false, nilaiKinerja: null,
    assessmentComplete: false, completionScope: 'ARITHMETIC_ONLY', observationStatus: 'NOT_VERIFIED',
    approvalStatus: 'PROVISIONAL_USER_ACCEPTED_LOCAL_RESOLUTION', referenceAuthority: 'USER_ATTESTED_NOT_EXTERNALLY_VERIFIED',
    measurementPolicyReference: root.measurementPolicyReference as string, correctionAuthorityReference: root.correctionAuthorityReference as string, acceptanceReference: root.acceptanceReference as string,
    ...(id === 'K5-R17' ? { timelinessStatus: 'NOT_ASSESSED' as const } : {}),
  };
}
