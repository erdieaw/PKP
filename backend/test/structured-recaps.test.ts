import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { Indicator, MonthlyRecord, PeriodRecap } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { evaluateStructuredInput, type PmeAnnualInput, type RtmAnnualInput } from '../src/analytics/do2026/structured-input';
import { DO_SCORING_VERSION, scoreDo2026 } from '../src/analytics/do2026/scorer';
import { evaluateDoCumulative } from '../src/analytics/do2026/cumulative';
import { evaluateDataset } from '../src/analytics/evaluation';
import { getDoProfile } from '../src/analytics/do2026/profiles';
import { DO_RULES } from '../src/analytics/do2026/rules';
import { scoreMonthlyInput } from '../src/operations/monthly-scoring';
import { RecapsService } from '../src/recaps/recaps.service';
import { SavePeriodRecapDto } from '../src/recaps/recaps.dto';
import type { Actor } from '../src/core/auth.decorators';
import type { DbService } from '../src/core/db.service';
import source from '../src/analytics/do2026/source.json';
import { validateDoInput } from '../src/analytics/do2026/input-validation';
import { annualStructuredFixtures, leprosy, lroa, survey, tb } from './annual-structured.fixtures';

const months = Array.from({ length: 12 }, (_, i) => i + 1);
const pme = (count = 2): PmeAnnualInput => ({ kind: 'PME_ANNUAL', year: 2026, participations: Array.from({ length: count }, (_, i) => ({
  eventId: `event-${i}`, date: `2026-0${i + 1}-10`, organizer: 'External laboratory', program: 'Quality testing', evidenceReference: `certificate-${i}`,
})) });
const rtm = (meetingCount = 2, complete = true): RtmAnnualInput => ({ kind: 'RTM_ANNUAL', year: 2026,
  meetings: Array.from({ length: meetingCount }, (_, i) => ({ meetingId: `meeting-${i}`, date: `2026-0${i + 1}-10`, minutesReference: `minutes-${i}` })),
  recommendations: meetingCount ? [{ recommendationId: 'rec-1', meetingId: 'meeting-0', description: 'Improve service', followUpStatus: complete ? 'COMPLETED' : 'NOT_COMPLETED', ...(complete ? { followUpDate: '2026-12-31', followUpReference: 'completion-report' } : {}) }] : [],
});
const code = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof BadRequestException);
  assert.equal((error.getResponse() as { code?: string }).code, expected);
  return true;
};
const annual = (id: string, structuredInput: unknown, numerator: Prisma.Decimal.Value, denominator: Prisma.Decimal.Value, year: number | undefined = 2026) => evaluateDoCumulative(id, {
  year, months, records: [{ month: 12, pencapaianRiil: 99, totalSasaran: 100, inputBasis: 'YTD_ACTUAL', scoringVersion: DO_SCORING_VERSION }],
  recap: { numerator, denominator, endMonth: 12, revision: 1, confirmed: true, scoringVersion: DO_SCORING_VERSION, notes: 'Full-year source reconciled; empty ledger explicitly attests no events/recommendations.', structuredInput },
});

test('two new rules match independent raw source identities, and retain provisional metadata', () => {
  for (const [id, kind, ref, pattern] of [
    ['K5-R38', 'PME_ANNUAL', 'S1:LINTAS KLASTER!A37:I37', /2 kali\/ tahun/],
    ['K1-R40', 'RTM_ANNUAL', 'S1:KLASTER I!A40:H40', /jumlah seluruh rekomendasi/],
  ] as const) {
    assert.equal(source.find(row => row.indicatorId === id)?.sourceRef, ref);
    assert.match(source.find(row => row.indicatorId === id)!.calculation, pattern);
    const profile = getDoProfile(id)!;
    assert.equal(profile.structuredInputKind, kind);
    assert.equal(profile.annualRecapOnly, true);
    assert.equal(profile.observationPeriod, 'CALENDAR_YEAR');
    assert.equal(profile.approvalStatus, 'PROVISIONAL_SOURCE_RULE');
    assert.equal(profile.status, 'IMPLEMENTED');
  }
  assert.equal(getDoProfile('K1-R12')!.structuredInputKind, undefined);
  assert.deepEqual(DO_RULES['K5-R38']!.scoring, { kind: 'FREQUENCY_MINIMUM', minimum: 2 });
});

for (const [count, met] of [[0, false], [1, false], [2, true], [3, true]] as const) {
  test(`PME derives ${count}/2 = ${count * 50}% without capping or awarding a score`, () => {
    const input = pme(count);
    const result = annual('K5-R38', input, count, 2);
    assert.deepEqual([result.measurementValue, result.targetMet, result.numerator, result.denominator], [count * 50, met, count, 2]);
    assert.deepEqual([result.nilaiKinerja, result.assessmentComplete, result.scoreComplete, result.dataComplete], [null, false, false, true]);
    assert.equal(result.aggregationMethod, 'EXPLICIT_YTD_RECAP');
    assert.deepEqual(result.recapStructuredInput, input);
  });
}

for (const [meetingCount, completed, value, met] of [[1, true, 100, false], [2, true, 100, true], [2, false, 0, false], [3, true, 100, true]] as const) {
  test(`RTM ${meetingCount} meetings, completed=${completed}: ratio ${value}, target ${met}`, () => {
    const result = annual('K1-R40', rtm(meetingCount, completed), completed ? 1 : 0, 1);
    assert.equal(result.measurementValue, value);
    assert.equal(result.targetMet, met);
    assert.equal(result.nilaiKinerja, null);
    assert.equal(result.dataComplete, true);
    if (meetingCount < 2) assert.match(result.reason!, /RTM_MINIMUM_MEETINGS_REQUIRED/);
  });
}

test('RTM denominator is every recommendation, not number of meetings or completed recommendations', () => {
  const input = rtm();
  input.recommendations.push({ recommendationId: 'rec-2', meetingId: 'meeting-1', description: 'Pending', followUpStatus: 'NOT_COMPLETED' });
  const result = annual('K1-R40', input, 1, 2);
  assert.deepEqual([result.measurementValue, result.targetMet, result.denominator], [50, false, 2]);
});

test('RTM empty/all-no-recommendations ledgers remain unavailable, never 100%', () => {
  for (const meetingCount of [0, 1, 2]) {
    const input = rtm(meetingCount); input.recommendations = [];
    const result = annual('K1-R40', input, 0, 0);
    assert.equal(result.status, 'ZERO_DENOMINATOR');
    assert.deepEqual([result.dataComplete, result.measurementValue, result.targetMet], [false, null, null]);
    assert.deepEqual(result.recapStructuredInput, input);
  }
});

const invalidPme: readonly (readonly [string, () => unknown])[] = [
  ['null', () => null], ['missing', () => undefined], ['boolean', () => true], ['array', () => []],
  ['wrong kind', () => ({ ...pme(), kind: 'RTM_ANNUAL' })],
  ['numeric string year', () => ({ ...pme(), year: '2026' })], ['other year', () => ({ ...pme(), year: 2027 })],
  ['extra root field', () => ({ ...pme(), targetMet: true })], ['missing list', () => ({ kind: 'PME_ANNUAL', year: 2026 })],
  ['bad list', () => ({ ...pme(), participations: {} })], ['too many entries', () => ({ ...pme(), participations: Array(1001).fill(pme().participations[0]) })],
  ...['2026-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '2025-12-31', '2027-01-01', '2026-1-01', '2026-01-01T00:00:00Z'].map(date => [`date ${date}`, () => ({ ...pme(1), participations: [{ ...pme(1).participations[0], date }] })] as const),
  ...['eventId', 'organizer', 'program', 'evidenceReference'].flatMap(field => [
    [`blank ${field}`, () => ({ ...pme(1), participations: [{ ...pme(1).participations[0], [field]: ' ' }] })] as const,
    [`numeric ${field}`, () => ({ ...pme(1), participations: [{ ...pme(1).participations[0], [field]: 1 }] })] as const,
  ]),
  ['oversized ID', () => ({ ...pme(1), participations: [{ ...pme(1).participations[0], eventId: 'x'.repeat(101) }] })],
  ['oversized reference', () => ({ ...pme(1), participations: [{ ...pme(1).participations[0], evidenceReference: 'x'.repeat(1001) }] })],
  ['unknown row field', () => ({ ...pme(1), participations: [{ ...pme(1).participations[0], verified: true }] })],
  ['null row', () => ({ ...pme(), participations: [null] })],
  ['sparse list', () => ({ ...pme(), participations: Array(2) })],
  ['normalized duplicate ID', () => { const input = pme(); input.participations[1]!.eventId = '  EVENT-0 '; return input; }],
  ['unicode duplicate ID', () => { const input = pme(); input.participations[1]!.eventId = '\uff45vent-0'; return input; }],
  ['duplicate event identity', () => { const input = pme(); input.participations[1] = { ...input.participations[0]!, eventId: 'different', organizer: ' EXTERNAL   LABORATORY ', program: ' QUALITY TESTING ' }; return input; }],
];
for (const [name, make] of invalidPme) {
  test(`PME rejects ${name}; cumulative reading fails closed without using legacy YTD`, () => {
    assert.throws(() => evaluateStructuredInput('K5-R38', make(), 2026), BadRequestException);
    const input = make();
    const result = annual('K5-R38', input, 2, 2);
    assert.deepEqual([result.measurementValue, result.numerator, result.denominator, result.targetMet, result.dataComplete, result.recapStructuredInput], [null, null, null, null, false, input ?? null]);
    assert.notEqual(result.aggregationMethod, 'LEGACY_EXPLICIT_YTD');
  });
}

const invalidRtm: readonly [string, (input: RtmAnnualInput) => unknown][] = [
  ['duplicate meeting ID', input => { input.meetings[1]!.meetingId = ' MEETING-0 '; return input; }],
  ['duplicate meeting identity', input => { input.meetings[1] = { ...input.meetings[0]!, meetingId: 'other', minutesReference: ' MINUTES-0 ' }; return input; }],
  ['invalid meeting date', input => { input.meetings[0]!.date = '2026-02-30'; return input; }],
  ['missing minutes', input => { input.meetings[0]!.minutesReference = ''; return input; }],
  ['missing meeting link', input => { input.recommendations[0]!.meetingId = 'unknown'; return input; }],
  ['missing description', input => { input.recommendations[0]!.description = ''; return input; }],
  ['duplicate recommendation ID', input => { input.recommendations.push({ ...input.recommendations[0]!, recommendationId: ' REC-1 ' }); return input; }],
  ['unknown status', input => ({ ...input, recommendations: [{ ...input.recommendations[0], followUpStatus: 'DONE' }] })],
  ['extra field', input => ({ ...input, recommendations: [{ ...input.recommendations[0], evidenceValidated: true }] })],
  ['missing completed date', input => { delete input.recommendations[0]!.followUpDate; return input; }],
  ['missing completed reference', input => { delete input.recommendations[0]!.followUpReference; return input; }],
  ['blank completed reference', input => { input.recommendations[0]!.followUpReference = ' '; return input; }],
  ['completion before meeting', input => { input.recommendations[0]!.followUpDate = '2026-01-09'; return input; }],
  ['completion next year', input => { input.recommendations[0]!.followUpDate = '2027-01-01'; return input; }],
  ['completion previous year', input => { input.recommendations[0]!.followUpDate = '2025-12-31'; return input; }],
  ['incomplete with completed metadata', input => { input.recommendations[0]!.followUpStatus = 'NOT_COMPLETED'; return input; }],
  ['no meetings but linked recommendation', input => ({ ...input, meetings: [] })],
  ['missing recommendations', input => ({ kind: input.kind, year: input.year, meetings: input.meetings })],
];
for (const [name, mutate] of invalidRtm) {
  test(`RTM rejects ${name}, including in reports`, () => {
    const input = mutate(rtm());
    assert.throws(() => evaluateStructuredInput('K1-R40', input, 2026), BadRequestException);
    const result = annual('K1-R40', input, 1, 1);
    assert.equal(result.dataComplete, false);
    assert.equal(result.measurementValue, null);
  });
}

test('valid leap day, same-day completion, normalized links and no arbitrary cutoff are supported', () => {
  const input = rtm();
  input.year = 2028;
  input.meetings = [{ meetingId: 'a', date: '2028-02-29', minutesReference: 'a' }, { meetingId: 'b', date: '2028-12-31', minutesReference: 'b' }];
  input.recommendations[0] = { recommendationId: 'r', meetingId: ' B ', description: 'Work', followUpStatus: 'COMPLETED', followUpDate: '2028-12-31', followUpReference: 'ref' };
  assert.equal(annual('K1-R40', input, 1, 1, 2028).targetMet, true);
});

for (const [id, input, n, d] of [['K5-R38', pme(), 2, 2], ['K1-R40', rtm(), 1, 1]] as const) {
  test(`${id} annual confirmation cannot bypass missing payload/year or mismatched derived counts`, () => {
    assert.throws(() => scoreDo2026(id, { numerator: n, denominator: d, annualRecapConfirmed: true }), code('STRUCTURED_INPUT_REQUIRED'));
    for (const year of [undefined, 2025, 2027, NaN]) {
      assert.throws(() => evaluateStructuredInput(id, input, year), BadRequestException);
    }
    for (const patch of [{ numerator: n + 1 }, { denominator: d + 1 }, { numerator: 0.5 }, { denominator: NaN }, { numerator: -1 }, { numerator: 'broken' }, { denominator: Infinity }]) {
      const result = annual(id, input, patch.numerator ?? n, patch.denominator ?? d);
      assert.equal(result.status, 'STRUCTURED_COUNT_MISMATCH');
      assert.equal(result.measurementValue, null);
      assert.equal(result.dataComplete, false);
    }
  });

  test(`${id} no monthly, partial, unconfirmed, V1-recap or legacy YTD fallback`, () => {
    const indicator = { id, polarity: 'HIGHER_IS_BETTER', targetNumeric: new Prisma.Decimal(1), scoringVersion: 'ILP_2026_V1' } as const;
    assert.throws(() => scoreMonthlyInput(indicator, { indicatorId: id, pencapaianRiil: n, totalSasaran: d, inputBasis: 'PERIOD_ACTUAL', scoringVersion: DO_SCORING_VERSION }, 2026), code('ANNUAL_RECAP_REQUIRED'));
    for (const selected of [months, [12], months.slice(0, 11), [...months].reverse()]) {
      for (const recap of [undefined, { numerator: n, denominator: d, endMonth: 12, revision: 1, notes: 'source', confirmed: false, scoringVersion: DO_SCORING_VERSION, structuredInput: input }, { numerator: n, denominator: d, endMonth: 12, revision: 1, notes: 'source', confirmed: true, scoringVersion: 'ILP_2026_V1', structuredInput: input }]) {
        const result = evaluateDoCumulative(id, { months: selected, year: 2026, recap, records: [{ month: 12, pencapaianRiil: n, totalSasaran: d, inputBasis: 'YTD_ACTUAL', scoringVersion: DO_SCORING_VERSION }] });
        assert.equal(result.status, 'ANNUAL_RECAP_REQUIRED');
        assert.equal(result.dataComplete, false);
      }
    }
    const partial = evaluateDoCumulative(id, { months, year: 2026, records: [], recap: { numerator: n, denominator: d, endMonth: 11, revision: 1, notes: 'source', confirmed: true, scoringVersion: DO_SCORING_VERSION, structuredInput: input } });
    assert.equal(partial.status, 'ANNUAL_RECAP_REQUIRED');
    assert.equal(partial.dataComplete, false);
  });
}

test('frequency permission never generalizes to ordinary coverage or RTM', () => {
  assert.throws(() => scoreDo2026('K1-R29', { numerator: 3, denominator: 2, annualRecapConfirmed: true }), BadRequestException);
  assert.throws(() => scoreDo2026('K1-R12', { numerator: 3, denominator: 2 }), BadRequestException);
  assert.throws(() => scoreDo2026('K1-R40', { numerator: 2, denominator: 1, annualRecapConfirmed: true, structuredInput: rtm(), year: 2026 }), BadRequestException);
  assert.throws(() => scoreDo2026('K1-R29', { numerator: 1, denominator: 2, annualRecapConfirmed: true, structuredInput: pme() }), BadRequestException);
});

test('report dataset uses explicit scope year, returns ledger and never changes V1-only history', () => {
  const indicator = { id: 'K5-R38', sectionCode: '5.4', polarity: 'HIGHER_IS_BETTER', targetNumeric: new Prisma.Decimal(1), scoringVersion: 'ILP_2026_V1' } as Indicator;
  const records = months.map(month => ({ indicatorId: indicator.id, year: 2026, month, pencapaianRiil: new Prisma.Decimal(1), totalSasaran: new Prisma.Decimal(10), scoringVersion: 'ILP_2026_V1', inputBasis: 'MONTHLY_DELTA' } as MonthlyRecord));
  const data = { indicators: [indicator], targets: [], sections: [], records };
  const before = evaluateDataset(data, months, 2026);
  assert.equal(before.items[0]!.scoringVersion, 'ILP_2026_V1');
  const recap = { indicatorId: indicator.id, numerator: 3, denominator: 2, endMonth: 12, revision: 1, notes: 'attested annual source', confirmed: true, scoringVersion: DO_SCORING_VERSION, structuredInput: pme(3) };
  const report = evaluateDataset({ ...data, recaps: [recap] }, months, 2026);
  assert.equal(report.items[0]!.measurementValue, 150);
  assert.ok('recapStructuredInput' in report.items[0]!);
  assert.equal(evaluateDataset({ ...data, recaps: [recap] }, months, 2027).items[0]!.measurementValue, null);
  const invalid = evaluateDataset({ ...data, recaps: [{ ...recap, structuredInput: null }] }, months, 2026);
  assert.equal(invalid.items[0]!.status, 'STRUCTURED_INPUT_REQUIRED');
  assert.deepEqual(evaluateDataset(data, months, 2026), before);
});

function fixture(id = 'K5-R38') {
  const actor = { id: 'admin', role: Role.ADMIN_PUSKESMAS, healthCenterId: '11111111-1111-4111-8111-111111111111', name: 'Admin', sessionId: 'session', tokenVersion: 0 } as Actor;
  const state = { assigned: 'pic', locked: false, activeYear: 2026 };
  let saved: PeriodRecap | null = null;
  const audits: unknown[] = [];
  const checked: number[] = [];
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => query.join('').includes('period_settings') ? [{ activeYear: state.activeYear, revision: 1 }] : [{ year: 2026, isLocked: false, cutoffDay: 10 }],
    periodLock: { findFirst: async ({ where }: { where: { OR: { periodNumber: number }[] } }) => { checked.push(where.OR[0]!.periodNumber); return state.locked ? { id: 'locked' } : null; } },
    indicator: { findFirst: async () => ({ id, scoringVersion: 'ILP_2026_V1', do2026: { annualRecapOnly: false, structuredInputKind: 'OTHER' } }) },
    picAssignment: { findUnique: async () => ({ picUserId: state.assigned }) },
    periodRecap: {
      findUnique: async () => saved,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        saved = { ...data, structuredInput: data.structuredInput === Prisma.DbNull ? null : data.structuredInput, id: 'recap', numerator: new Prisma.Decimal(data.numerator as number), denominator: new Prisma.Decimal(data.denominator as number), createdAt: new Date(0), updatedAt: new Date(0) } as PeriodRecap;
        return saved;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => { saved = { ...saved, ...data, structuredInput: data.structuredInput === Prisma.DbNull ? null : data.structuredInput } as PeriodRecap; return saved; },
    },
    auditLog: { create: async (value: unknown) => { audits.push(value); } },
  };
  const db = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } as unknown as DbService;
  const dto: SavePeriodRecapDto = { indicatorId: id, year: 2026, endMonth: 12, numerator: 2, denominator: 2, confirmed: true, expectedRevision: 0, notes: 'Reconciled source, explicit no-participation attestation if ledger empty.', structuredInput: pme() };
  return { actor, state, audits, checked, dto, service: new RecapsService(db), saved: () => saved };
}

test('service derives and persists normalized ledger, audits revisions, and rejects stale writes', async () => {
  const f = fixture();
  const input = pme(); input.participations[0]!.eventId = ' event-0 ';
  const saved = await f.service.save(f.actor, { ...f.dto, structuredInput: input });
  assert.deepEqual(saved.structuredInput, pme());
  assert.equal(saved.numerator.toNumber(), 2);
  assert.equal(f.audits.length, 1);
  assert.deepEqual(f.checked, months);
  await assert.rejects(() => f.service.save(f.actor, f.dto), ConflictException);
  await f.service.save(f.actor, { ...f.dto, expectedRevision: 1, structuredInput: pme(0), numerator: 0 });
  assert.deepEqual(f.saved()!.structuredInput, pme(0));
  assert.equal(f.audits.length, 2);
});

test('audit retains all 1000 PME entries and item 101 changes through the real security sanitizer', async () => {
  const f = fixture();
  const input: PmeAnnualInput = { ...pme(), participations: Array.from({ length: 1000 }, (_, i) => ({
    eventId: `${i}`.padEnd(100, 'x'), date: '2026-12-31', organizer: `Lab ${i}`, program: 'PME', evidenceReference: 'a'.repeat(1000),
  })) };
  await f.service.save(f.actor, { ...f.dto, numerator: 1000, structuredInput: input });
  const revised = structuredClone(input);
  revised.participations[100]!.evidenceReference = 'b'.repeat(1000);
  await f.service.save(f.actor, { ...f.dto, expectedRevision: 1, numerator: 1000, structuredInput: revised });
  type Evidence = { format: string; sha256: string; complete: boolean; ledger: { kind: string; year: number; participations: { count: number; chunks: PmeAnnualInput['participations'][] } } };
  const events = f.audits as { data: { details: { previous: null | { revision: number; structuredInput: Evidence }; value: { revision: number; structuredInput: Evidence } } } }[];
  const decode = (evidence: Evidence, expected: PmeAnnualInput) => {
    assert.equal(evidence.format, 'RECAP_LEDGER_CHUNKS_V1');
    assert.equal(evidence.complete, true);
    assert.equal(evidence.ledger.participations.count, 1000);
    assert.deepEqual(evidence.ledger.participations.chunks.map(chunk => chunk.length), Array(10).fill(100));
    const restored = { ...evidence.ledger, participations: evidence.ledger.participations.chunks.flat() };
    assert.deepEqual(restored, expected);
    const canonical = JSON.stringify(restored, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]])) : value);
    assert.equal(evidence.sha256, createHash('sha256').update(canonical).digest('hex'));
  };
  assert.equal(events[0]!.data.details.previous, null);
  decode(events[0]!.data.details.value.structuredInput, input);
  assert.equal(events[1]!.data.details.previous!.revision, 1);
  decode(events[1]!.data.details.previous!.structuredInput, input);
  assert.equal(events[1]!.data.details.value.revision, 2);
  decode(events[1]!.data.details.value.structuredInput, revised);
  assert.notEqual(events[1]!.data.details.previous!.structuredInput.sha256, events[1]!.data.details.value.structuredInput.sha256);
});

test('audit retains max-length RTM descriptions, references and both chunked collections', async () => {
  const f = fixture('K1-R40');
  const input: RtmAnnualInput = { kind: 'RTM_ANNUAL', year: 2026,
    meetings: Array.from({ length: 101 }, (_, i) => ({ meetingId: `meeting-${i}`, date: '2026-01-01', minutesReference: `${i}`.padEnd(1000, 'm') })),
    recommendations: Array.from({ length: 101 }, (_, i) => ({ recommendationId: `rec-${i}`, meetingId: `meeting-${i}`, description: 'd'.repeat(2000), followUpStatus: 'COMPLETED', followUpDate: '2026-12-31', followUpReference: 'r'.repeat(1000) })),
  };
  await f.service.save(f.actor, { ...f.dto, numerator: 101, denominator: 101, structuredInput: input });
  const events = f.audits as { data: { details: { value: { structuredInput: { complete: boolean; ledger: { kind: string; year: number; meetings: { count: number; chunks: RtmAnnualInput['meetings'][] }; recommendations: { count: number; chunks: RtmAnnualInput['recommendations'][] } } } } } } }[];
  const evidence = events[0]!.data.details.value.structuredInput;
  assert.equal(evidence.complete, true);
  for (const collection of [evidence.ledger.meetings, evidence.ledger.recommendations]) {
    assert.equal(collection.count, 101);
    assert.deepEqual(collection.chunks.map(chunk => chunk.length), [100, 1]);
  }
  assert.deepEqual({ ...evidence.ledger, meetings: evidence.ledger.meetings.chunks.flat(), recommendations: evidence.ledger.recommendations.chunks.flat() }, input);
});

for (const payload of [{ kind: 'FUTURE_KIND', year: 2026, entries: [1] }, {}, [], 'future_kind', false, 0]) {
  test(`aggregate recaps preserve unexpected ${JSON.stringify(payload)} and reject writes without erasure`, async () => {
    const f = fixture('K1-R29');
    const dto = { ...f.dto, numerator: 1, structuredInput: undefined };
    const previous = await f.service.save(f.actor, dto);
    assert.equal(previous.structuredInput, null);
    previous.structuredInput = payload;
    const before = structuredClone(previous.structuredInput);
    const result = annual('K1-R29', payload, 1, 2);
    assert.deepEqual([result.status, result.dataComplete, result.measurementValue, result.targetMet, result.nilaiKinerja], ['INVALID_STRUCTURED_INPUT', false, null, null, null]);
    assert.deepEqual(result.recapStructuredInput, payload);
    const report = evaluateDataset({ indicators: [{ id: dto.indicatorId } as Indicator], targets: [], sections: [], records: [], recaps: [previous] }, months, 2026).items[0]!;
    assert.equal(report.status, 'INVALID_STRUCTURED_INPUT');
    assert.equal(report.measurementValue, null);
    assert.ok('recapStructuredInput' in report);
    assert.deepEqual(report.recapStructuredInput, payload);
    await assert.rejects(() => f.service.save(f.actor, { ...dto, expectedRevision: 1, numerator: 2 }), code('INVALID_STRUCTURED_INPUT'));
    assert.equal(f.saved(), previous);
    assert.equal(f.saved()!.revision, 1);
    assert.deepEqual(f.saved()!.structuredInput, before);
    assert.equal(f.audits.length, 1);
  });
}

test('ordinary null/absent structured payloads remain supported and preserve audit revisions', async () => {
  for (const structuredInput of [null, undefined]) {
    const f = fixture('K1-R29');
    const dto = { ...f.dto, numerator: 1, structuredInput: undefined };
    const previous = await f.service.save(f.actor, dto);
    if (structuredInput === undefined) delete (previous as Partial<PeriodRecap>).structuredInput;
    const result = annual('K1-R29', structuredInput, 1, 2);
    assert.equal(result.dataComplete, true);
    assert.equal(result.measurementValue, 50);
    assert.equal(result.recapStructuredInput, null);
    await f.service.save(f.actor, { ...dto, expectedRevision: 1, numerator: 2 });
    assert.equal(f.saved()!.structuredInput, null);
    assert.equal(f.saved()!.revision, 2);
    assert.equal(f.audits.length, 2);
  }
});

test('unknown or malformed existing PME ledgers cannot be overwritten by a supported payload', async () => {
  for (const payload of [{ kind: 'FUTURE_KIND' }, 'future', { ...pme(), participations: [null] }]) {
    const f = fixture();
    const previous = await f.service.save(f.actor, f.dto);
    previous.structuredInput = payload;
    await assert.rejects(() => f.service.save(f.actor, { ...f.dto, expectedRevision: 1 }), BadRequestException);
    assert.equal(f.saved(), previous);
    assert.equal(f.saved()!.revision, 1);
    assert.deepEqual(f.saved()!.structuredInput, payload);
    assert.equal(f.audits.length, 1);
  }
});

test('service protects required ledgers despite stale metadata, strict confirmation and scope', async () => {
  for (const patch of [
    { structuredInput: undefined }, { structuredInput: null }, { structuredInput: { ...pme(), year: 2027 } },
    { numerator: 3 }, { denominator: 3 }, { notes: ' ' }, { endMonth: 11 }, { confirmed: 'true' },
    { confirmed: false }, { structuredInput: { ...rtm() } },
  ]) {
    const f = fixture();
    await assert.rejects(() => f.service.save(f.actor, { ...f.dto, ...patch } as SavePeriodRecapDto), BadRequestException);
    assert.equal(f.saved(), null);
    assert.deepEqual(f.audits, []);
  }
  const other = fixture('K1-R29');
  await assert.rejects(() => other.service.save(other.actor, { ...other.dto, numerator: 1, denominator: 2 }), BadRequestException);
  assert.equal(other.saved(), null);
});

test('structured writes retain PIC/tenant/read-only, active-year and period-lock permissions', async () => {
  const f = fixture();
  const pic = { ...f.actor, id: 'pic', role: Role.PIC };
  f.state.assigned = 'someone-else';
  await assert.rejects(() => f.service.save(pic, f.dto), ForbiddenException);
  assert.throws(() => f.service.save(f.actor, { ...f.dto, healthCenterId: 'other' }), ForbiddenException);
  assert.throws(() => f.service.save({ ...f.actor, role: Role.DINKES_ADMIN }, f.dto), ForbiddenException);
  f.state.activeYear = 2027;
  await assert.rejects(() => f.service.save(f.actor, f.dto), ConflictException);
  f.state.activeYear = 2026; f.state.locked = true;
  await assert.rejects(() => f.service.save(f.actor, f.dto), ConflictException);
  f.state.locked = false; f.state.assigned = 'pic';
  assert.equal((await f.service.save(pic, f.dto)).updatedBy, 'pic');
});

test('DTO preserves structured types without coercion; service rejects unknown nested fields', async () => {
  const f = fixture();
  const dto = plainToInstance(SavePeriodRecapDto, { ...f.dto, structuredInput: { ...pme(), year: '2026' } });
  assert.equal(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length, 0);
  await assert.rejects(() => f.service.save(f.actor, dto), BadRequestException);
});

for (const row of annualStructuredFixtures()) {
  const { indicatorId: id, structuredInput: input, numerator, denominator } = row;
  test(`${id} exact source identity, annual metadata and independent arithmetic oracle`, () => {
    const profile = getDoProfile(id)!;
    assert.equal(profile.definitionId, row.definitionId);
    assert.equal(profile.sourceRef, source.find(source => source.indicatorId === id)!.sourceRef);
    assert.equal(profile.structuredInputKind, input.kind);
    assert.deepEqual([profile.annualRecapOnly, profile.observationPeriod, profile.status, profile.approvalStatus], [true, 'CALENDAR_YEAR', 'IMPLEMENTED', 'PROVISIONAL_SOURCE_RULE']);
    const result = annual(id, input, numerator, denominator);
    assert.deepEqual([result.numerator, result.denominator, result.measurementValue, result.targetMet], [numerator, denominator, row.measurement, row.targetMet]);
    assert.deepEqual([result.nilaiKinerja, result.scoreComplete, result.assessmentComplete, result.completionScope, result.observationStatus], [null, false, false, 'ARITHMETIC_ONLY', 'NOT_VERIFIED']);
    assert.equal(result.dataComplete, true);
    assert.deepEqual(result.recapStructuredInput, input);
  });

  test(`${id} requires full confirmed V2 annual scope and explicit matching scope year`, () => {
    for (const selected of [[12], months.slice(0, 11), [...months].reverse(), [...months, 12]]) {
      const result = evaluateDoCumulative(id, { year: 2026, months: selected, records: [], recap: { numerator, denominator, confirmed: true, scoringVersion: DO_SCORING_VERSION, notes: 'source', revision: 1, endMonth: 12, structuredInput: input } });
      assert.equal(result.status, 'ANNUAL_RECAP_REQUIRED');
    }
    for (const recap of [undefined, { numerator, denominator, confirmed: false, scoringVersion: DO_SCORING_VERSION, notes: 'source', revision: 1, endMonth: 12, structuredInput: input }, { numerator, denominator, confirmed: true, scoringVersion: 'ILP_2026_V1', notes: 'source', revision: 1, endMonth: 12, structuredInput: input }]) {
      assert.equal(evaluateDoCumulative(id, { year: 2026, months, records: [], recap }).status, 'ANNUAL_RECAP_REQUIRED');
    }
    for (const year of [undefined, NaN, 2025, 2027, 10000]) assert.throws(() => evaluateStructuredInput(id, input, year), code('INVALID_STRUCTURED_INPUT'));
    const indicator = { id, polarity: 'HIGHER_IS_BETTER', targetNumeric: new Prisma.Decimal(1), scoringVersion: 'ILP_2026_V1' } as const;
    assert.throws(() => scoreMonthlyInput(indicator, { indicatorId: id, pencapaianRiil: numerator, totalSasaran: denominator, inputBasis: 'PERIOD_ACTUAL', scoringVersion: DO_SCORING_VERSION }, 2026), code('ANNUAL_RECAP_REQUIRED'));
  });

  test(`${id} malformed unions fail closed without discarding stored payload or using YTD`, () => {
    for (const payload of [undefined, null, [], false, {}, { ...input, year: '2026' }, { ...input, kind: 'FUTURE_KIND' }, { ...input, patientIdentifiers: [] }, { ...input, year: 2025 }]) {
      assert.throws(() => evaluateStructuredInput(id, payload, 2026), BadRequestException);
      const result = annual(id, payload, numerator, denominator);
      assert.deepEqual([result.dataComplete, result.measurementValue, result.numerator, result.denominator], [false, null, null, null]);
      assert.deepEqual(result.recapStructuredInput, payload ?? null);
    }
    assert.equal(annual(id, input, numerator + 1, denominator).status, 'STRUCTURED_COUNT_MISMATCH');
    assert.equal(annual(id, input, numerator, denominator + 1).status, 'STRUCTURED_COUNT_MISMATCH');
  });

  test(`${id} persists, audits full payload, protects auth/revision/year/period and stored tampering`, async () => {
    const f = fixture(id);
    const dto = { ...f.dto, numerator, denominator, structuredInput: input };
    const pic = { ...f.actor, id: 'pic', role: Role.PIC };
    f.state.assigned = 'other';
    await assert.rejects(() => f.service.save(pic, dto), ForbiddenException);
    assert.throws(() => f.service.save(f.actor, { ...dto, healthCenterId: 'other' }), ForbiddenException);
    assert.throws(() => f.service.save({ ...f.actor, role: Role.DINKES_ADMIN }, dto), ForbiddenException);
    f.state.activeYear = 2027;
    await assert.rejects(() => f.service.save(f.actor, dto), ConflictException);
    f.state.activeYear = 2026; f.state.locked = true;
    await assert.rejects(() => f.service.save(f.actor, dto), ConflictException);
    f.state.locked = false;
    for (const patch of [{ endMonth: 11 }, { confirmed: false }, { notes: '' }, { numerator: numerator + 1 }, { structuredInput: undefined }]) {
      await assert.rejects(() => f.service.save(f.actor, { ...dto, ...patch } as SavePeriodRecapDto), BadRequestException);
    }
    const saved = await f.service.save(f.actor, dto);
    assert.deepEqual(saved.structuredInput, input);
    assert.equal(saved.numerator.toNumber(), numerator);
    assert.equal(saved.denominator.toNumber(), denominator);
    const evidence = (f.audits[0] as { data: { details: { value: { structuredInput: { complete: boolean; sha256: string; ledger: Record<string, unknown> } } } } }).data.details.value.structuredInput;
    const restored = Object.fromEntries(Object.entries(evidence.ledger).map(([key, value]) => [key,
      value && typeof value === 'object' && 'chunks' in value ? (value as { chunks: unknown[][] }).chunks.flat() : value]));
    assert.equal(evidence.complete, true);
    assert.deepEqual(restored, input);
    const canonical = JSON.stringify(restored, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
    assert.equal(evidence.sha256, createHash('sha256').update(canonical).digest('hex'));
    await assert.rejects(() => f.service.save(f.actor, dto), ConflictException);
    saved.numerator = new Prisma.Decimal(numerator + 1);
    await assert.rejects(() => f.service.save(f.actor, { ...dto, expectedRevision: 1 }), code('STRUCTURED_COUNT_MISMATCH'));
    saved.numerator = new Prisma.Decimal(numerator);
    saved.structuredInput = { kind: 'FUTURE_KIND' };
    await assert.rejects(() => f.service.save(f.actor, { ...dto, expectedRevision: 1 }), code('INVALID_STRUCTURED_INPUT'));
    assert.equal(f.audits.length, 1);
    saved.structuredInput = input;
    f.state.assigned = 'pic';
    await f.service.save(pic, { ...dto, expectedRevision: 1 });
    assert.equal(f.saved()!.revision, 2);
    assert.equal(f.audits.length, 2);
  });
}

test('LROA counts quarters only when all three monthly reports and two positive activity categories qualify', () => {
  const input = lroa();
  assert.equal(annual('K2-R44', input, 1, 4).measurementValue, 25);
  input.months[10]!.reportStatus = 'INCOMPLETE';
  assert.equal(annual('K2-R44', input, 0, 4).measurementValue, 0);
  input.months[10]!.reportStatus = 'ABSENT';
  assert.equal(annual('K2-R44', input, 0, 4).measurementValue, 0);
  input.months[10]!.reportStatus = 'COMPLETE';
  input.months[10]!.activityCounts.diarrhoeaManagement = 0;
  assert.equal(annual('K2-R44', input, 0, 4).measurementValue, 0);
  for (const month of input.months) { month.reportStatus = 'COMPLETE'; month.reportReference = 'report'; month.activityCounts.oralitPreparation = 1; }
  assert.equal(annual('K2-R44', input, 4, 4).targetMet, true);
  assert.match(getDoProfile('K2-R44')!.assessmentInstruction, /threeHourObservation.*paling sedikit tiga jam/);
  assert.match(getDoProfile('K2-R44')!.assessmentInstruction, /bukan rubrik skor resmi/);
});

test('LROA rejects missing slots, duplicates, malformed report status/references, missing or invalid activity counts', () => {
  const input = lroa();
  for (const patch of [
    { months: input.months.slice(1) }, { months: [...input.months, input.months[0]] },
    { months: input.months.map(row => ({ ...row, month: 1 })) }, { sourceCoverageComplete: false }, { sourceReference: '' },
    ...[0, 13, '1', NaN, 1.5].map(month => ({ months: [{ ...input.months[0], month }, ...input.months.slice(1)] })),
    ...[{ reportStatus: 'MISSING' }, { reportStatus: 'COMPLETE' }, { reportReference: '' }, { reportReference: null }, { activityCounts: {} }].map(patch => ({ months: [{ ...input.months[0], ...patch }, ...input.months.slice(1)] })),
    ...Object.keys(input.months[0]!.activityCounts).flatMap(key => [undefined, '1', -1, 0.1, NaN, Infinity, 10_000_000_000].map(value => ({ months: [{ ...input.months[0], activityCounts: { ...input.months[0]!.activityCounts, [key]: value } }, ...input.months.slice(1)] }))),
  ]) assert.throws(() => evaluateStructuredInput('K2-R44', { ...input, ...patch }, 2026), BadRequestException);
});

test('semester survey uses exact decimal sums, 78-point threshold, zero and four-decimal storage without scale conversion', async () => {
  const input = survey();
  for (const [a, b, sum, mean, met] of [[0.1, 0.2, 0.3, 0.15, false], [77.9998, 78, 155.9998, 77.9999, false], [77.9999, 78.0001, 156, 78, true], [0, 0, 0, 0, false], [100, 100, 200, 100, true]] as const) {
    input.semesters[0]!.value = a!; input.semesters[1]!.value = b!;
    const result = annual('K1-R39', input, sum!, 2);
    assert.deepEqual([result.numerator, result.measurementValue, result.targetMet, result.measurementUnit, result.capaianRiilPct], [sum, mean, met, 'SCORE', null]);
    assert.doesNotThrow(() => validateDoInput('K1-R39', { numerator: sum!, denominator: 2 }));
    const f = fixture('K1-R39');
    assert.equal((await f.service.save(f.actor, { ...f.dto, numerator: sum as number, denominator: 2, structuredInput: input })).numerator.toNumber(), sum);
  }
  assert.equal(getDoProfile('K1-R39')!.numeratorInput, 'DECIMAL');
  assert.throws(() => validateDoInput('K1-R29', { numerator: 0.3, denominator: 2 }), code('INTEGER_NUMERATOR_REQUIRED'));
  assert.throws(() => validateDoInput('K1-R39', { numerator: 0.12345, denominator: 2 }), code('INVALID_SURVEY_SUM'));
});

test('survey rejects duplicate/missing semesters, incompatible methods, undocumented scale and unrepresentable decimals', () => {
  const input = survey();
  for (const patch of [
    { semesters: [input.semesters[0]] }, { semesters: [input.semesters[0], input.semesters[0]] }, { semesters: [...input.semesters, input.semesters[0]] },
    { scale: 'INDEX_4' }, { scale: 'DOCUMENTED_100_POINT', scaleReference: '' }, { methodCompatibilityReference: '' }, { compatibleMethodsConfirmed: 'true' }, { compatibleMethodsConfirmed: false },
    ...[-1, 100.0001, NaN, Infinity, '80', 0.12345, 1e-7, 80.00000000000001].map(value => ({ semesters: [{ ...input.semesters[0], value }, input.semesters[1]] })),
    ...[{ semester: 3 }, { semester: '1' }, { methodReference: '' }, { reportReference: null }, { sampleWeight: 100 }].map(patch => ({ semesters: [{ ...input.semesters[0], ...patch }, input.semesters[1]] })),
  ]) assert.throws(() => evaluateStructuredInput('K1-R39', { ...input, ...patch }, 2026), BadRequestException);
  input.semesters.reverse();
  assert.equal(annual('K1-R39', input, 164, 2).measurementValue, 82);
});

test('cohort counts enforce original denominators and mature linked outcomes, not current-year cases or mean percentages', () => {
  const input = leprosy();
  assert.equal(annual('K4-R20', input, 82, 100).measurementValue, 82, 'not the unweighted mean of 100% and 80%');
  input.cohorts[0]!.originalNewCaseStarts = 0; input.cohorts[0]!.completedCount = 0;
  assert.equal(annual('K4-R20', input, 72, 90).measurementValue, 80);
  input.cohorts[1]!.originalNewCaseStarts = 0; input.cohorts[1]!.completedCount = 0;
  assert.deepEqual([annual('K4-R20', input, 0, 0).status, annual('K4-R20', input, 0, 0).dataComplete], ['ZERO_DENOMINATOR', false]);
  const zero = tb(); zero.cohort.originalDenominator = 0; zero.cohort.successfulCount = 0;
  assert.equal(annual('K4-R16', zero, 0, 0).targetMet, null);
  zero.cohort.originalDenominator = 10;
  assert.equal(annual('K4-R16', zero, 0, 10).measurementValue, 0);
  for (const year of [2027, 9999]) {
    const t = tb(); t.year = year; t.cohort.year = year - 1;
    const l = leprosy(); l.year = year; l.cohorts[0]!.year = year - 1; l.cohorts[1]!.year = year - 2;
    assert.equal(annual('K4-R16', t, 90, 100, year).measurementValue, 90);
    assert.equal(annual('K4-R20', l, 82, 100, year).measurementValue, 82);
  }
});

test('TB rejects wrong years/systems/definitions, absent attestations/references, coercion, overflow and N>D', () => {
  for (const patch of [
    { year: 2026 }, { year: 2024 }, { year: '2025' }, { type: 'TB_ALL_CURRENT_CASES' }, { sourceSystem: 'SIPK' }, { outcomeDefinition: 'CURED_AND_TREATMENT_COMPLETED' },
    ...['complete', 'originalDenominatorAndOutcomeLinkageAttested', 'distinctSuccessfulPatientsAttested'].flatMap(key => [false, 'true', undefined].map(value => ({ [key]: value }))),
    ...['cohortReference', 'sourceReference', 'outcomeAssessmentReference'].flatMap(key => ['', null, 'x'.repeat(1001)].map(value => ({ [key]: value }))),
    ...['originalDenominator', 'successfulCount'].flatMap(key => [-1, 0.1, NaN, Infinity, '90', 10_000_000_000].map(value => ({ [key]: value }))),
    { successfulCount: 101 }, { patientId: 'not-solicited' },
  ]) assert.throws(() => evaluateStructuredInput('K4-R16', { ...tb(), cohort: { ...tb().cohort, ...patch } }, 2026), BadRequestException);
  const max = tb(); max.cohort.originalDenominator = 9_999_999_999; max.cohort.successfulCount = 9_999_999_999;
  assert.equal(annual('K4-R16', max, 9_999_999_999, 9_999_999_999).measurementValue, 100);
});

test('leprosy rejects missing/duplicate type, PB/MB year mismatch, immature cohorts and per-component N>D', () => {
  const input = leprosy();
  for (const cohorts of [[], [input.cohorts[0]], [input.cohorts[0], input.cohorts[0]], [...input.cohorts, input.cohorts[0]]]) {
    assert.throws(() => evaluateStructuredInput('K4-R20', { ...input, cohorts }, 2026), BadRequestException);
  }
  for (const index of [0, 1]) for (const patch of [
    { year: 2026 }, { year: index === 0 ? 2024 : 2025 }, { year: String(input.cohorts[index]!.year) }, { type: 'OTHER' }, { sourceSystem: 'SITB' },
    { matureAndComplete: false }, { matureAndComplete: 'true' }, { originalDenominatorAndOutcomeLinkageAttested: false },
    ...['cohortReference', 'sourceReference', 'outcomeAssessmentReference', 'prescribedPeriodReference'].map(key => ({ [key]: '' })),
    ...['originalNewCaseStarts', 'completedCount'].flatMap(key => [-1, 0.1, NaN, Infinity, '10', 10_000_000_000].map(value => ({ [key]: value }))),
    { originalNewCaseStarts: 1, completedCount: 2 }, { patientId: 'not-solicited' },
  ]) assert.throws(() => evaluateStructuredInput('K4-R20', { ...input, cohorts: input.cohorts.map((row, i) => i === index ? { ...row, ...patch } : row) }, 2026), BadRequestException);
  const overflow = leprosy(); for (const row of overflow.cohorts) row.originalNewCaseStarts = 5_000_000_000;
  assert.throws(() => evaluateStructuredInput('K4-R20', overflow, 2026), BadRequestException);
  input.cohorts.reverse();
  assert.equal(annual('K4-R20', input, 82, 100).measurementValue, 82);
});
