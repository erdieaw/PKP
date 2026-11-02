import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, Role, type PeriodRecap } from '@prisma/client';
import source from '../src/analytics/do2026/source.json';
import { evaluateSourceAssessment, sourceAssessmentDescriptor } from '../src/analytics/do2026/source-assessment';
import { LOCAL_RESOLUTION_DEFINITIONS } from '../src/analytics/do2026/local-resolution-definitions';
import { evaluateDoCumulative } from '../src/analytics/do2026/cumulative';
import { scoreDo2026 } from '../src/analytics/do2026/scorer';
import { getDoProfile } from '../src/analytics/do2026/profiles';
import { RecapsService } from '../src/recaps/recaps.service';
import type { DbService } from '../src/core/db.service';
import type { Actor } from '../src/core/auth.decorators';
import { sourceAssessmentFixture } from './source-assessment.fixtures';
import { evaluateLocalFixture, localResolutionFixture, localResolutionIds } from './local-resolution.fixtures';

const months = Array.from({ length: 12 }, (_, index) => index + 1);
const rejected = (fn: () => unknown) => assert.throws(fn, BadRequestException);

test('28 additive local descriptors, raw 165/28 and 79 classifications unchanged', () => {
  assert.deepEqual(Object.keys(LOCAL_RESOLUTION_DEFINITIONS).sort(), [...localResolutionIds].sort());
  const descriptors = source.map(row => sourceAssessmentDescriptor(row.indicatorId)).filter(row => row !== undefined);
  assert.equal(descriptors.length, 193);
  assert.equal(descriptors.filter(row => row.calculationAvailability === 'AVAILABLE_WITH_CONTEXT').length, 165);
  assert.deepEqual(descriptors.filter(row => row.calculationAvailability === 'SOURCE_UNRESOLVED').map(row => source.find(s => s.definitionId === row.definitionId)!.indicatorId).sort(), [...localResolutionIds].sort());
  assert.equal(source.filter(row => getDoProfile(row.indicatorId)!.status === 'IMPLEMENTED').length, 79);
  assert.equal(source.filter(row => getDoProfile(row.indicatorId)!.localCalculationAvailability === 'EXPLICIT_OPT_IN_ONLY').length, 28);
});

for (const id of localResolutionIds) {
  test(`${id}: positive local metrics, no score; old payload remains exact and raw fields retained`, () => {
    const input = localResolutionFixture(id);
    const { localResolution: local, ...old } = input;
    const before = JSON.stringify(input);
    const endMonth = Number(input.period.cutoffDate.slice(5, 7));
    const oldResult = evaluateSourceAssessment(id, old, 2026, endMonth);
    assert.equal(oldResult.status, 'SOURCE_UNRESOLVED');
    assert.equal(oldResult.measurementValue, null); assert.equal(oldResult.targetMet, null);
    assert.equal(oldResult.localResolutionResult, undefined);
    const result = evaluateLocalFixture(id, input);
    const output = result.localResolutionResult!;
    assert.ok(output.metrics.length > 0);
    assert.ok(output.metrics.every(metric => metric.status === 'MEASURED'));
    assert.equal(output.nilaiKinerja, null); assert.equal(output.performanceScoreAvailable, false);
    assert.equal(output.assessmentComplete, false); assert.equal(output.observationStatus, 'NOT_VERIFIED');
    assert.equal(output.completionScope, 'ARITHMETIC_ONLY');
    assert.equal(output.sourceStatus, 'SOURCE_UNRESOLVED');
    assert.deepEqual(output.originalTarget, sourceAssessmentDescriptor(id)!.target);
    assert.equal(output.alternativeTarget, null);
    assert.ok(output.metrics.every(metric => metric.targetMet === null));
    assert.deepEqual([result.numerator, result.denominator], [oldResult.numerator, oldResult.denominator]);
    assert.equal(output.rawNumerator, oldResult.numerator); assert.equal(output.rawDenominator, oldResult.denominator);
    assert.deepEqual(result.structuredInput, input); assert.equal(JSON.stringify(input), before);
    const scored = scoreDo2026(id, { numerator: result.numerator, denominator: result.denominator, structuredInput: input, year: 2026, endMonth, sourceAssessmentConfirmed: true });
    assert.deepEqual(scored.localResolutionResult, output);
    assert.equal(scored.assessmentComplete, false); assert.equal(scored.nilaiKinerja, null);
    assert.deepEqual(evaluateSourceAssessment(id, old, 2026, endMonth), oldResult);
    assert.equal(local.decisionId, `LOCAL_V1:${id}`);
  });
  test(`${id}: incomplete observations and attestations never claim completion`, () => {
    const input = localResolutionFixture(id);
    for (const key of Object.keys(input.localResolution.metrics)) input.localResolution.metrics[key] = null;
    assert.ok(evaluateLocalFixture(id, input).localResolutionResult!.metrics.every(metric => metric.value === null));
    for (const status of ['INCOMPLETE', 'NOT_YET_DUE', 'NOT_APPLICABLE'] as const) {
      const input = localResolutionFixture(id); input.attestation.status = status;
      const result = evaluateLocalFixture(id, input);
      assert.equal(result.measurementValue, null);
      assert.ok(result.localResolutionResult!.metrics.every(metric => metric.value === null && metric.targetMet === null));
    }
    const missing = localResolutionFixture(id); missing.attestation.grainReconciled = false;
    assert.ok(evaluateLocalFixture(id, missing).localResolutionResult!.metrics.every(metric => metric.value === null));
  });
  test(`${id}: strict malformed, acceptance, ID, definition, version, reference, territory and period binding`, () => {
    const mutators = [
      (row: any) => { row.accepted = false; }, (row: any) => { row.contractVersion = 'DO_LOCAL_RESOLUTION_V2'; },
      (row: any) => { row.decisionId = 'LOCAL_V1:other'; }, (row: any) => { row.indicatorId = 'K1-R12'; },
      (row: any) => { row.definitionId = 'DO26-OTHER'; }, (row: any) => { row.year = 2027; },
      (row: any) => { row.territoryReference = 'other'; }, (row: any) => { row.sourcePeriod.reference = 'other'; },
      (row: any) => { row.period.cutoffDate = '2026-02-30'; }, (row: any) => { row.acceptanceReference = ' '; },
      (row: any) => { row.measurementPolicyReference = ''; }, (row: any) => { row.correctionAuthorityReference = ''; },
      (row: any) => { row.unknown = true; }, (row: any) => { row.references.unknown = 'other'; },
      (row: any) => { row.references[Object.keys(row.references)[0]!] = ''; },
      (row: any) => { delete row.metrics[Object.keys(row.metrics)[0]!]; },
      (row: any) => { row.metrics.unknown = { count: 1 }; },
      (row: any) => { row.metrics[Object.keys(row.metrics)[0]!].extra = 1; },
    ];
    for (const mutate of mutators) { const input = localResolutionFixture(id); mutate(input.localResolution); rejected(() => evaluateLocalFixture(id, input)); }
    for (const value of [null, [], false, 'yes']) {
      const input = localResolutionFixture(id); (input as any).localResolution = value;
      rejected(() => evaluateLocalFixture(id, input));
    }
  });
  test(`${id}: all numeric fields enforce precision, zero and subset rules`, () => {
    const rule = LOCAL_RESOLUTION_DEFINITIONS[id]!;
    for (const metric of rule.metrics.filter(row => !row.derivedFrom && row.type !== 'BOOLEAN')) {
      const field = metric.type === 'COUNT' ? 'count' : 'numerator';
      for (const value of [-1, NaN, Infinity, '1', 10_000_000_000, metric.decimalPlaces === 4 ? 0.00001 : 0.5]) {
        const input = localResolutionFixture(id); (input.localResolution.metrics[metric.key] as any)[field] = value;
        rejected(() => evaluateLocalFixture(id, input));
      }
      if (metric.type === 'RATIO') {
        const input = localResolutionFixture(id); input.localResolution.metrics[metric.key] = { numerator: 0, denominator: 0 };
        // Linked components must be changed together to preserve cohort/denominator invariants.
        for (const other of rule.metrics.filter(row => row.type === 'RATIO')) input.localResolution.metrics[other.key] = { numerator: 0, denominator: 0 };
        const result = evaluateLocalFixture(id, input).localResolutionResult!.metrics.find(row => row.key === metric.key)!;
        assert.equal(result.status, 'ZERO_DENOMINATOR'); assert.equal(result.value, null); assert.equal(result.targetMet, null);
        if (metric.subset) {
          const input = localResolutionFixture(id); input.localResolution.metrics[metric.key] = { numerator: 11, denominator: 10 };
          rejected(() => evaluateLocalFixture(id, input));
        }
      }
    }
  });
}

test('financial decimals, uncapped values and pre-rounding target decision', () => {
  const input = localResolutionFixture('K1-R71');
  input.localResolution.metrics.revenue = { numerator: 9999999999.9998, denominator: 9999999999.9999 };
  input.localResolution.targetPolicy = { metricKey: 'revenue', value: 100, reference: 'QA explicit target' };
  const result = evaluateLocalFixture('K1-R71', input);
  assert.equal(result.measurementValue, 100); assert.equal(result.targetMet, false);
  assert.equal(result.localResolutionResult!.alternativeTarget!.authority, 'USER_ACCEPTED_LOCAL_POLICY_NOT_SOURCE_APPROVAL');
  input.localResolution.metrics.revenue = { numerator: 150.0001, denominator: 100 };
  assert.equal(evaluateLocalFixture('K1-R71', input).measurementValue, 150.0001);
});

test('no automatic target transfer; candidate, metric, reference and value must match', () => {
  for (const id of localResolutionIds) {
    const candidate = LOCAL_RESOLUTION_DEFINITIONS[id]!.metrics.find(metric => metric.targetValue !== undefined);
    const input = localResolutionFixture(id);
    input.localResolution.targetPolicy = { metricKey: candidate?.key ?? Object.keys(input.localResolution.metrics)[0]!, value: candidate?.targetValue ?? 100, reference: 'QA explicit local target' };
    if (candidate) {
      const result = evaluateLocalFixture(id, input).localResolutionResult!;
      assert.equal(result.metrics.filter(row => row.targetMet !== null).length, 1);
      input.localResolution.targetPolicy.value += 1; rejected(() => evaluateLocalFixture(id, input));
    } else rejected(() => evaluateLocalFixture(id, input));
  }
});

test('MFK derives seven literal groups including both facility subcomponents, not percent completeness', () => {
  const input = localResolutionFixture('K1-R53');
  input.localResolution.metrics.facilitySecurity = { satisfied: false };
  const result = evaluateLocalFixture('K1-R53', input);
  assert.equal(result.measurementValue, null);
  assert.equal(result.localResolutionResult!.metrics.find(row => row.key === 'coveredGroups')!.value, 6);
  assert.equal(result.localResolutionResult!.metrics.find(row => row.key === 'facility')!.value, false);
  (input.localResolution.metrics as any).coveredGroups = { count: 8 };
  rejected(() => evaluateLocalFixture('K1-R53', input));
});

test('SK/SOP package is boolean and never invented score; consent has no timeliness primary', () => {
  const input = localResolutionFixture('K5-R44'); input.localResolution.metrics.validSk = { count: 0 };
  const result = evaluateLocalFixture('K5-R44', input);
  assert.equal(result.measurementValue, null); assert.equal(result.nilaiKinerja, null);
  assert.equal(result.localResolutionResult!.metrics.find(row => row.key === 'packageSatisfied')!.value, false);
  const consent = evaluateLocalFixture('K5-R17');
  assert.equal(consent.measurementValue, null); assert.equal(consent.localResolutionResult!.timelinessStatus, 'NOT_ASSESSED');
});

test('DM population result requires explicit exact local prevalence and does not transfer target to register', () => {
  const input = localResolutionFixture('K3-R19');
  input.localResolution.metrics.dmPopulation = { numerator: 1, denominator: 3.125, population: 125, prevalencePercent: 2.5, populationReference: 'QA 15+ population', prevalenceReference: 'QA local prevalence' };
  assert.equal(evaluateLocalFixture('K3-R19', input).localResolutionResult!.metrics.find(row => row.key === 'dmPopulation')!.value, 32);
  (input.localResolution.metrics.dmPopulation as any).numerator = 4;
  assert.equal(evaluateLocalFixture('K3-R19', input).measurementValue, 128);
  (input.localResolution.metrics.dmPopulation as any).denominator = 3.1249;
  rejected(() => evaluateLocalFixture('K3-R19', input));
  input.localResolution.metrics.dmPopulation = null;
  const result = evaluateLocalFixture('K3-R19', input);
  assert.equal(result.localResolutionResult!.metrics.find(row => row.key === 'dmRegister')!.value, 10);
  assert.equal(result.targetMet, null);
});

test('same-cohort and conjunction subset bounds cannot be contradicted by acceptance', () => {
  for (const [id, key] of [['K5-R13', 'gels'], ['K5-R14', 'btls'], ['K5-R16', 'sisrute'], ['K5-R27', 'information']] as const) {
    const input = localResolutionFixture(id); input.localResolution.metrics[key] = { numerator: 1, denominator: 9 };
    rejected(() => evaluateLocalFixture(id, input));
  }
  const input = localResolutionFixture('K5-R13'); input.localResolution.metrics.literalAll = { numerator: 2, denominator: 10 };
  rejected(() => evaluateLocalFixture('K5-R13', input));
  const bundle = localResolutionFixture('K5-R27'); bundle.localResolution.metrics.allThree = { numerator: 2, denominator: 10 };
  rejected(() => evaluateLocalFixture('K5-R27', bundle));
});

for (const [id, anchor, members, conjunction] of [
  ['K5-R13', 'sip', ['gels', 'atls', 'acls', 'literalAll'], 'literalAll'],
  ['K5-R14', 'bls', ['bcls', 'btls', 'literalAll'], 'literalAll'],
  ['K5-R27', 'allThree', ['review', 'service', 'information'], 'allThree'],
] as const) {
  test(`${id}: null anchor cannot hide conflicting populated group denominators`, () => {
    const input = localResolutionFixture(id);
    input.localResolution.metrics[anchor] = null;
    for (const key of members) input.localResolution.metrics[key] = { numerator: 10, denominator: 10 };
    input.localResolution.metrics[members[0]] = { numerator: 10, denominator: 20 };
    if (conjunction !== anchor) input.localResolution.targetPolicy = { metricKey: conjunction, value: 100, reference: 'QA explicit literal target' };
    rejected(() => evaluateLocalFixture(id, input));
  });

  test(`${id}: null anchor permits equal populated group denominators without filling missing data`, () => {
    const input = localResolutionFixture(id);
    input.localResolution.metrics[anchor] = null;
    for (const key of members) input.localResolution.metrics[key] = { numerator: 10, denominator: 10 };
    if (conjunction !== anchor) input.localResolution.targetPolicy = { metricKey: conjunction, value: 100, reference: 'QA explicit literal target' };
    const result = evaluateLocalFixture(id, input).localResolutionResult!;
    assert.equal(result.metrics.find(row => row.key === anchor)!.status, 'INCOMPLETE');
    assert.equal(result.metrics.find(row => row.key === anchor)!.value, null);
    assert.ok(result.metrics.filter(row => members.some(key => key === row.key)).every(row => row.status === 'MEASURED' && row.value === 100));
    if (conjunction !== anchor) assert.equal(result.metrics.find(row => row.key === conjunction)!.targetMet, true);
  });

  test(`${id}: denominator group validation preserves intersection upper and lower bounds`, () => {
    for (const direction of ['upper', 'lower'] as const) {
      const input = localResolutionFixture(id);
      for (const key of [anchor, ...members]) input.localResolution.metrics[key] = { numerator: direction === 'upper' ? 1 : 10, denominator: 10 };
      input.localResolution.metrics[conjunction] = { numerator: direction === 'upper' ? 2 : 9, denominator: 10 };
      rejected(() => evaluateLocalFixture(id, input));
    }
  });
}

test('local opt-in cannot be injected into any of the 165 other source contracts', () => {
  for (const row of source) {
    if (sourceAssessmentDescriptor(row.indicatorId)?.calculationAvailability !== 'AVAILABLE_WITH_CONTEXT') continue;
    const input = sourceAssessmentFixture(row.indicatorId);
    (input as any).localResolution = localResolutionFixture('K1-R9').localResolution;
    rejected(() => evaluateSourceAssessment(row.indicatorId, input, 2026, 12));
  }
});

test('literal conjunctions also respect the minimum intersection implied by complete components', () => {
  for (const [id, keys] of [
    ['K5-R13', ['sip', 'gels', 'atls', 'acls']],
    ['K5-R14', ['bls', 'bcls', 'btls']],
    ['K5-R27', ['review', 'service', 'information']],
  ] as const) {
    const input = localResolutionFixture(id);
    for (const key of keys) input.localResolution.metrics[key] = { numerator: 10, denominator: 10 };
    rejected(() => evaluateLocalFixture(id, input));
    input.localResolution.metrics[id === 'K5-R27' ? 'allThree' : 'literalAll'] = { numerator: 10, denominator: 10 };
    assert.ok(evaluateLocalFixture(id, input).localResolutionResult!.metrics.every(row => row.status === 'MEASURED'));
  }
});

test('local monthly overrides are separately bound, never annual-promoted or pooled', () => {
  for (const id of ['K2-R35', 'K4-R29', 'K5-R27']) {
    const input = localResolutionFixture(id), derived = evaluateLocalFixture(id, input);
    const endMonth = Number(input.period.cutoffDate.slice(5, 7));
    const recap = { numerator: derived.numerator, denominator: derived.denominator, structuredInput: input, endMonth, revision: 1, notes: 'QA source', scoringVersion: 'DO_2026_V2', confirmed: true };
    const result = evaluateDoCumulative(id, { records: [], year: 2026, months: Array.from({ length: endMonth }, (_, i) => i + 1), recap });
    assert.equal(result.measurementValue, null); assert.equal(result.status, 'ASSESSMENT_SCOPE_MISMATCH');
    assert.ok(result.localResolutionResult!.metrics.every(metric => metric.value === null && metric.status === 'ASSESSMENT_SCOPE_MISMATCH'));
    assert.deepEqual(result.recapStructuredInput, input);
    const matching = evaluateDoCumulative(id, { records: [], year: 2026, months: [endMonth], recap });
    assert.ok(matching.localResolutionResult!.metrics.every(metric => metric.status === 'MEASURED'));
    input.localResolution.period.startDate = '2026-01-01'; rejected(() => evaluateLocalFixture(id, input));
  }
});

function serviceFixture(id: string) {
  const actor = { id: 'admin', role: Role.ADMIN_PUSKESMAS, healthCenterId: '11111111-1111-4111-8111-111111111111', name: 'QA Admin', sessionId: 'qa', tokenVersion: 0 } as Actor;
  const state = { assigned: 'pic', locked: false, activeYear: 2026 };
  let saved: PeriodRecap | null = null;
  const audits: any[] = [];
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => query.join('').includes('period_settings') ? [{ activeYear: state.activeYear, revision: 1 }] : [{ year: 2026, isLocked: false, cutoffDay: 10 }],
    periodLock: { findFirst: async () => state.locked ? { id: 'locked' } : null },
    indicator: { findFirst: async () => ({ id }) }, picAssignment: { findUnique: async () => ({ picUserId: state.assigned }) },
    periodRecap: {
      findUnique: async () => saved, findMany: async () => saved ? [saved] : [],
      create: async ({ data }: any) => { saved = { ...data, id: 'qa', numerator: new Prisma.Decimal(data.numerator), denominator: new Prisma.Decimal(data.denominator), createdAt: new Date(0), updatedAt: new Date(0) }; return saved; },
      update: async ({ data }: any) => { saved = { ...saved, ...data, numerator: new Prisma.Decimal(data.numerator), denominator: new Prisma.Decimal(data.denominator) } as PeriodRecap; return saved; },
    }, auditLog: { create: async (row: any) => { audits.push(row); } },
  };
  const db = { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } as unknown as DbService;
  return { service: new RecapsService(db), actor, state, audits, saved: () => saved };
}

for (const id of localResolutionIds) test(`${id}: save/list/revision/full audit, raw counts, unknown saved payload fails closed`, async () => {
  const f = serviceFixture(id), input = localResolutionFixture(id), derived = evaluateLocalFixture(id, input);
  const dto = { year: 2026, endMonth: Number(input.period.cutoffDate.slice(5, 7)), indicatorId: id, numerator: derived.numerator, denominator: derived.denominator, confirmed: true as const, expectedRevision: 0, notes: 'QA accepted local source', structuredInput: input };
  const first = await f.service.save(f.actor, dto);
  assert.deepEqual(first.structuredInput, input);
  assert.equal((await f.service.list(f.actor, { year: 2026, endMonth: dto.endMonth })).items.length, 1);
  const revised = structuredClone(input); revised.localResolution.acceptanceReference = 'QA renewed acceptance';
  await f.service.save(f.actor, { ...dto, expectedRevision: 1, structuredInput: revised });
  assert.equal(f.saved()!.revision, 2);
  const detail = f.audits[1].data.details;
  for (const [key, expected] of [['previous', input], ['value', revised]] as const) {
    const envelope = detail[key].structuredInput;
    assert.equal(envelope.complete, true); assert.deepEqual(envelope.ledger, expected);
    const canonical = JSON.stringify(expected, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
    assert.equal(envelope.sha256, createHash('sha256').update(canonical).digest('hex'));
  }
  await assert.rejects(f.service.save(f.actor, dto), ConflictException);
  (f.saved()!.structuredInput as any).localResolution.unknown = 'preserve';
  await assert.rejects(f.service.save(f.actor, { ...dto, expectedRevision: 2 }), BadRequestException);
  assert.equal(f.audits.length, 2); assert.equal((f.saved()!.structuredInput as any).localResolution.unknown, 'preserve');
});

test('authorization, assignment, tenant, active-year and lock guards also protect local opt-in', async () => {
  const f = serviceFixture('K1-R10'), input = localResolutionFixture('K1-R10'), derived = evaluateLocalFixture('K1-R10', input);
  const dto = { year: 2026, endMonth: 12, indicatorId: 'K1-R10', numerator: derived.numerator, denominator: derived.denominator, confirmed: true as const, expectedRevision: 0, notes: 'QA', structuredInput: input };
  await assert.rejects(async () => f.service.save({ ...f.actor, role: Role.DINKES_ADMIN }, dto), ForbiddenException);
  await assert.rejects(async () => f.service.save({ ...f.actor, role: Role.PIC, id: 'other' }, dto), ForbiddenException);
  await assert.rejects(async () => f.service.save(f.actor, { ...dto, healthCenterId: '22222222-2222-4222-8222-222222222222' }), ForbiddenException);
  f.state.locked = true; await assert.rejects(f.service.save(f.actor, dto)); f.state.locked = false;
  f.state.activeYear = 2027; await assert.rejects(f.service.save(f.actor, dto));
  assert.equal(f.audits.length, 0);
});
