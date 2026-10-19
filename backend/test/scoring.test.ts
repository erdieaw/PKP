import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Polarity, Prisma, Role } from '@prisma/client';
import { AnalyticsController } from '../src/analytics/analytics.controller';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { DbService } from '../src/core/db.service';
import { OperationsService } from '../src/operations/operations.service';
import { calculateScore, category, mean, output2, prorated, rollup, SCORING_VERSION } from '../src/analytics/scoring';

const indicator = (id = 'HIGHER', polarity: Polarity = Polarity.HIGHER_IS_BETTER) => ({ id, polarity, targetNumeric: new Prisma.Decimal('0.8'), scoringVersion: SCORING_VERSION });
const score = (id: string, value: number, polarity: Polarity = Polarity.TIERED_BRACKETS) => calculateScore(indicator(id, polarity), value, 100, 100).nilaiKinerja;

test('higher scoring honors operations percentage contract, Decimal, clamp and precision', () => {
  assert.equal(calculateScore(indicator(), 40, 100, 80).nilaiKinerja, 50);
  assert.equal(calculateScore(indicator(), 90, 100, 80).nilaiKinerja, 100);
  const value = calculateScore(indicator(), 1, 3, 100);
  assert.equal(value.nilaiKinerja, 33.3333);
  assert.equal(output2(value.nilaiKinerja), 33.33);
});

test('every tiered boundary and its immediate neighbors', () => {
  const cases: [string, number[], number[]][] = [
    ['K3-R40', [15, 17.5, 20, 22.5], [75, 75, 50, 22.5]],
    ['K3-R41', [3.5, 4.5, 7.5, 10], [75, 75, 50, 25]],
    ['K5-R23', [20, 40, 60, 80], [100, 75, 50, 25]],
    ['K5-R24', [8, 20, 40, 60], [100, 75, 50, 25]],
    ['K5-R25', [1, 10, 20, 30], [100, 75, 50, 25]],
  ];
  for (const [id, boundaries, expected] of cases) {
    boundaries.forEach((boundary, index) => {
      assert.equal(score(id, boundary), expected[index], `${id} at ${boundary}`);
      assert.equal(score(id, boundary - 0.000001), [100, 75, 50, id === 'K3-R40' ? 22.5 : 25][index], `${id} below ${boundary}`);
      assert.equal(score(id, boundary + 0.000001), [75, 50, id === 'K3-R40' ? 22.5 : 25, 0][index], `${id} above ${boundary}`);
    });
  }
  [2.6, 4, 7, 9].forEach((value, index) => {
    const calc = (achievement: number) => calculateScore(indicator('K5-R26', Polarity.TIERED_BRACKETS), achievement, 1, 100).nilaiKinerja;
    assert.equal(calc(value), [100, 75, 50, 25][index]);
    assert.equal(calc(value - 0.000001), [100, 75, 50, 25][index]);
    assert.equal(calc(value + 0.000001), [75, 50, 25, 0][index]);
  });
});

test('lower thresholds are explicit pass/fail, including generic Decimal target', () => {
  for (const [id, threshold] of [['K2-R50', 15.04], ['K2-R52', 8], ['GENERIC', 80]] as const) {
    assert.equal(score(id, threshold, Polarity.LOWER_IS_BETTER), 100);
    assert.equal(score(id, threshold + 0.000001, Polarity.LOWER_IS_BETTER), 0);
    assert.equal(score(id, 0, Polarity.LOWER_IS_BETTER), 100);
  }
});

test('zero targets/denominators are null for every polarity; binary permits threshold inputs', () => {
  for (const polarity of Object.values(Polarity)) {
    const item = indicator(polarity === Polarity.TIERED_BRACKETS ? 'K5-R23' : 'ID', polarity);
    for (const [denominator, target] of [[0, 1], [1, 0]]) {
      assert.deepEqual(calculateScore(item, 0, denominator!, target!), { capaianRiilPct: null, nilaiKinerja: null, status: 'NO_TARGET', scoringVersion: SCORING_VERSION });
    }
  }
  for (const [achievement, expected] of [[0, 0], [0.5, 0], [1, 100], [2, 100]]) {
    assert.equal(calculateScore(indicator('B', Polarity.BINARY), achievement!, 100, 1).nilaiKinerja, expected);
  }
});

test('invalid finite/nonnegative inputs and unsupported rules fail 400', () => {
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    for (let position = 0; position < 3; position++) {
      const args = [1, 1, 1]; args[position] = value;
      assert.throws(() => calculateScore(indicator(), args[0]!, args[1]!, args[2]!), BadRequestException);
    }
    assert.throws(() => calculateScore({ ...indicator(), targetNumeric: value }, 1, 1, 1), BadRequestException);
  }
  assert.throws(() => score('UNKNOWN', 1), BadRequestException);
  assert.throws(() => calculateScore({ ...indicator(), scoringVersion: 'UNKNOWN' }, 1, 1, 1), BadRequestException);
});

test('nullable mean/category and equally weighted hierarchy preserve missing groups', () => {
  assert.equal(mean([null, 80, 100]), 90);
  assert.equal(mean([null]), null);
  assert.equal(category(null), null);
  assert.equal(category(91), 'Kinerja Baik');
  assert.equal(category(81), 'Kinerja Cukup');
  const sections = [
    { code: '1', parentCode: null, klasterId: 1 },
    { code: '1.a', parentCode: '1', klasterId: 1 },
    { code: '1.b', parentCode: '1', klasterId: 1 },
    ...[2, 3, 4, 5].map(id => ({ code: String(id), parentCode: null, klasterId: id })),
  ];
  const indicators = [{ id: 'a', sectionCode: '1.a' }, { id: 'b', sectionCode: '1.a' }, { id: 'c', sectionCode: '1.b' }, ...[2, 3, 4, 5].map(id => ({ id: String(id), sectionCode: String(id) }))];
  const scores = new Map<string, number | null>([['a', 100], ['b', 100], ['c', 0], ['2', 100], ['3', 100], ['4', 100], ['5', 100]]);
  const complete = rollup(sections, indicators, scores);
  assert.equal(complete.klasterScores[1], 50);
  assert.equal(complete.nilaiKinerjaPuskesmas, 90);
  assert.equal(complete.isComplete, true);
  scores.set('c', null);
  const partial = rollup(sections, indicators, scores);
  assert.equal(partial.sectionScores['1.b'], null);
  assert.equal(partial.klasterScores[1], 100);
  assert.equal(partial.isComplete, false);
  assert.equal(rollup(sections, indicators, new Map()).nilaiKinerjaPuskesmas, null);
});

function fixture() {
  const healthCenterId = '11111111-1111-4111-8111-111111111111';
  const healthCenter = { id: healthCenterId, name: 'Original', code: 'PKM', headName: 'Head', headNip: '123' };
  const sections = [1, 2, 3, 4, 5].map(id => ({ code: String(id), parentCode: null, klasterId: id, name: `Section ${id}`, isActive: true }));
  const indicators = sections.map(section => ({ ...indicator(section.code), sectionCode: section.code, klasterId: section.klasterId }));
  const targets = indicators.map(item => ({ healthCenterId, year: 2026, indicatorId: item.id, totalSasaran: '1200', targetSasaran: '1200', targetPct: '100' }));
  const records = indicators.flatMap(item => [1, 2, 3].map(month => ({ healthCenterId, year: 2026, indicatorId: item.id, month, pencapaianRiil: month === 1 ? '200' : month === 2 ? '0' : '100' })));
  const locks: { periodNumber: number; isQuarter: boolean; status: string; snapshot: unknown }[] = [];
  const calls: unknown[] = [];
  const tx = {
    periodLock: { findUnique: async (query: { where: { healthCenterId_year_periodNumber_isQuarter: { healthCenterId: string; year: number; periodNumber: number; isQuarter: boolean } } }) => {
      calls.push(query);
      const identity = query.where.healthCenterId_year_periodNumber_isQuarter;
      assert.equal(identity.healthCenterId, healthCenterId);
      return locks.find(lock => lock.periodNumber === identity.periodNumber && lock.isQuarter === identity.isQuarter) ?? null;
    }, findFirst: async (query: { where: { healthCenterId: string; year: number; isQuarter: boolean; periodNumber: { gte: number }; status: { in: string[] } }; orderBy: { periodNumber: string } }) => {
      assert.equal(query.where.healthCenterId, healthCenterId);
      assert.equal(query.where.year, 2026);
      assert.equal(query.where.isQuarter, true);
      assert.deepEqual(query.where.status.in, ['SUBMITTED', 'VERIFIED']);
      assert.equal(query.orderBy.periodNumber, 'asc');
      return locks.filter(lock => lock.isQuarter && lock.periodNumber >= query.where.periodNumber.gte && query.where.status.in.includes(lock.status)).sort((a, b) => a.periodNumber - b.periodNumber)[0] ?? null;
    } },
    healthCenter: { findUnique: async () => healthCenter }, section: { findMany: async (query: { where: { isActive: boolean } }) => {
      assert.deepEqual(query.where, { isActive: true });
      return sections.filter(section => section.isActive === query.where.isActive);
    } }, indicator: { findMany: async () => indicators },
    annualTarget: { findMany: async (query: { where: { healthCenterId: string } }) => { assert.equal(query.where.healthCenterId, healthCenterId); return targets; } },
    monthlyRecord: { findMany: async (query: { where: { healthCenterId: string; month: number | { lte: number } } }) => {
      assert.equal(query.where.healthCenterId, healthCenterId);
      const month = query.where.month;
      return records.filter(record => typeof month === 'number' ? record.month === month : record.month <= month.lte);
    } },
  };
  const db = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } as unknown as DbService;
  return { service: new AnalyticsService(db), healthCenterId, healthCenter, sections, indicators, targets, records, locks, calls };
}

test('live analytics exclude archived sections but retain incomplete active empty groups', async () => {
  const f = fixture();
  f.sections.push({ code: '1.archived', parentCode: null, klasterId: 1, name: 'Archived empty group', isActive: false });
  const sheet = await f.service.sheet7(f.healthCenterId, 2026, 1);
  assert.equal(sheet.rows.some(row => row.no === '1.archived'), false);
  assert.equal(sheet.isComplete, true);
  assert.equal(sheet.nilaiKinerjaPuskesmas, 100);
  f.sections.push({ code: '1.new', parentCode: null, klasterId: 1, name: 'New empty group', isActive: true });
  const incomplete = await f.service.sheet7(f.healthCenterId, 2026, 1);
  assert.equal(incomplete.rows.some(row => row.no === '1.new'), true);
  assert.equal(incomplete.isComplete, false);
});

test('frozen analytics retain sections with missing or false isActive regardless of live archives', async () => {
  const f = fixture();
  const sections = f.sections.map(({ isActive, ...section }, index) => index === 0 ? section : { ...section, isActive: false });
  const snapshot = JSON.parse(JSON.stringify({ schemaVersion: 1, healthCenter: f.healthCenter, sections, indicators: f.indicators, targets: f.targets, records: f.records, period: { healthCenterId: f.healthCenterId, year: 2026, periodNumber: 1, isQuarter: true } }));
  f.locks.push({ periodNumber: 1, isQuarter: true, status: 'VERIFIED', snapshot });
  f.sections.forEach(section => { section.isActive = false; });
  const sheet = await f.service.sheet7(f.healthCenterId, 2026, 1);
  assert.deepEqual(sheet.rows.filter(row => !row.isKlasterHead).map(row => row.no), ['1', '2', '3', '4', '5']);
  assert.equal(sheet.source, 'VERIFIED_SNAPSHOT');
  assert.equal(sheet.isComplete, true);
  assert.equal(sheet.isOfficial, true);
  assert.equal(sheet.nilaiKinerjaPuskesmas, 100);
});

test('monthly arithmetic completed-month average differs from cumulative official basis; missing is null', async () => {
  const f = fixture();
  const annual = await f.service.annualTrend(f.healthCenterId, 2026);
  const q1 = await f.service.sheet7(f.healthCenterId, 2026, 1);
  assert.equal(q1.nilaiKinerjaPuskesmas, 100);
  assert.equal(annual.annualAveragePKP, 66.67);
  assert.equal(annual.completedMonths, 3);
  assert.equal(annual.monthlyOverallScores[3], null);
  assert.match(annual.aggregation, /ARITHMETIC/);
  assert.match(q1.basis, /YTD_CUMULATIVE/);
  f.records.splice(f.records.findIndex(record => record.indicatorId === '1' && record.month === 2), 1);
  const partial = await f.service.sheet7(f.healthCenterId, 2026, 1);
  assert.equal(partial.indicators[0]!.nilaiKinerja, null);
  assert.equal(partial.indicators[0]!.pencapaianRiil, 300);
  assert.equal(partial.isComplete, false);
  assert.equal(partial.status, 'INCOMPLETE');
  assert.equal(partial.isOfficial, false);
  const trends = await f.service.indicatorTrends(f.healthCenterId, 2026);
  assert.equal(trends.items[0]!.monthlyValues[1], null);
});

test('exact quarterly and monthly frozen snapshots survive changes to live metadata and targets', async () => {
  const f = fixture();
  const snapshot = (periodNumber: number, isQuarter: boolean) => JSON.parse(JSON.stringify({ schemaVersion: 1, healthCenter: f.healthCenter, sections: f.sections, indicators: f.indicators, targets: f.targets, records: f.records, period: { healthCenterId: f.healthCenterId, year: 2026, periodNumber, isQuarter } }));
  f.locks.push({ periodNumber: 1, isQuarter: true, status: 'VERIFIED', snapshot: snapshot(1, true) });
  f.locks.push({ periodNumber: 1, isQuarter: false, status: 'SUBMITTED', snapshot: snapshot(1, false) });
  f.healthCenter.name = 'Changed';
  f.targets.forEach(target => { target.targetPct = '50'; });
  f.indicators.forEach(item => { item.scoringVersion = 'UNSUPPORTED'; });
  const sheet = await f.service.sheet7(f.healthCenterId, 2026, 1);
  assert.equal(sheet.puskesmasName, 'Original');
  assert.equal(sheet.source, 'VERIFIED_SNAPSHOT');
  assert.equal(sheet.isOfficial, true);
  // Freeze the remaining months too before querying the twelve-month series.
  for (let month = 2; month <= 12; month++) {
    const frozen = structuredClone(f.locks[1]!.snapshot) as { period: { periodNumber: number } };
    frozen.period.periodNumber = month;
    f.locks.push({ periodNumber: month, isQuarter: false, status: 'SUBMITTED', snapshot: frozen });
  }
  const trend = await f.service.annualTrend(f.healthCenterId, 2026);
  assert.equal(trend.source[0], 'SUBMITTED_SNAPSHOT');
  assert.equal(trend.monthlyOverallScores[0], 100);
  f.locks[0]!.snapshot = null;
  await assert.rejects(f.service.sheet7(f.healthCenterId, 2026, 1), ConflictException);
});

test('ANNUAL selects quarter four; controller enforces explicit Dinkes tenant and comparison role', async () => {
  const f = fixture();
  await f.service.sheet7(f.healthCenterId, 2026, 'ANNUAL');
  assert.deepEqual((f.calls[0] as { where: unknown }).where, { healthCenterId_year_periodNumber_isQuarter: { healthCenterId: f.healthCenterId, year: 2026, periodNumber: 4, isQuarter: true } });
  const controller = new AnalyticsController(f.service);
  const actor = { id: 'actor', sessionId: 'session', tokenVersion: 0, name: 'Actor', role: Role.DINKES_ADMIN, healthCenterId: null };
  assert.throws(() => controller.sheet7(actor, { year: 2026, quarter: 1 }), BadRequestException);
  assert.throws(() => controller.dashboard({ ...actor, role: Role.PIC, healthCenterId: f.healthCenterId }, { year: 2026, quarter: 1, compare: true }));
  assert.throws(() => controller.sheet7({ ...actor, role: Role.PIC, healthCenterId: f.healthCenterId }, { year: 2026, quarter: 1, healthCenterId: '22222222-2222-4222-8222-222222222222' }));
});

test('explicit zero and absent annual targets stay null rather than using master defaults', async () => {
  const f = fixture();
  f.targets[0]!.targetSasaran = '0';
  f.targets.splice(1, 1);
  const sheet = await f.service.sheet7(f.healthCenterId, 2026, 1);
  for (const item of sheet.indicators.slice(0, 2)) {
    assert.equal(item.nilaiKinerja, null);
    assert.equal(item.status, 'NO_TARGET');
  }
  assert.equal(sheet.aggregateStatus, 'PARTIAL');
  assert.equal(sheet.isComplete, false);
});

test('rounded proration matches the actual operations monthly write and live/frozen indicator trends', async () => {
  const f = fixture();
  f.indicators[0] = { ...f.indicators[0]!, ...indicator('K2-R52', Polarity.LOWER_IS_BETTER) };
  f.targets[0] = { ...f.targets[0]!, indicatorId: 'K2-R52', totalSasaran: '2.9999', targetSasaran: '0.24', targetPct: '8' };
  f.records.splice(0, 3);
  const item = f.indicators[0]!;
  const annual = f.targets[0]!;
  let saved: { totalSasaran: Prisma.Decimal; nilaiKinerja: number | null; capaianRiilPct: number | null } | undefined;
  const tx = {
    $queryRaw: async () => [{ year: 2026, isLocked: false, cutoffDay: 10 }],
    periodLock: { findFirst: async () => null },
    indicator: { findMany: async () => [item] },
    annualTarget: { findMany: async () => [{ ...annual, totalSasaran: new Prisma.Decimal(annual.totalSasaran), targetSasaran: new Prisma.Decimal(annual.targetSasaran), targetPct: new Prisma.Decimal(annual.targetPct) }] },
    monthlyRecord: { upsert: async ({ create }: { create: typeof saved }) => { saved = create; } },
    auditLog: { create: async () => ({}) },
  };
  const operations = new OperationsService({ $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } as unknown as DbService);
  await operations.saveMonthly({ id: 'actor', sessionId: 'session', tokenVersion: 0, name: 'Admin', role: Role.ADMIN_PUSKESMAS, healthCenterId: f.healthCenterId }, {
    year: 2026, month: 1, records: [{ indicatorId: item.id, pencapaianRiil: 0.02 }],
  });
  assert.equal(prorated(new Prisma.Decimal('2.9999'), 1), 0.25);
  assert.equal(prorated('2.9999', 3), 0.75);
  assert.equal(prorated('0.24', 1), 0.02);
  assert.equal(Number(saved!.totalSasaran), 0.25);
  assert.equal(saved!.nilaiKinerja, 100);
  assert.equal(saved!.capaianRiilPct, 8);
  f.records.push({ healthCenterId: f.healthCenterId, year: 2026, indicatorId: item.id, month: 1, pencapaianRiil: '0.02' });
  const live = await f.service.indicatorTrends(f.healthCenterId, 2026);
  assert.equal(live.items.find(entry => entry.indicator.id === item.id)!.monthlyScores[0], saved!.nilaiKinerja);
  const snapshot = JSON.parse(JSON.stringify({ schemaVersion: 1, healthCenter: f.healthCenter, sections: f.sections, indicators: f.indicators, targets: f.targets, records: f.records, period: { healthCenterId: f.healthCenterId, year: 2026, periodNumber: 1, isQuarter: true } }));
  f.locks.push({ periodNumber: 1, isQuarter: true, status: 'VERIFIED', snapshot });
  f.targets[0]!.totalSasaran = '1';
  const frozen = await f.service.indicatorTrends(f.healthCenterId, 2026);
  const trend = frozen.items.find(entry => entry.indicator.id === item.id)!;
  assert.equal(trend.monthlyScores[0], 100);
  assert.equal(trend.monthlyPct[0], 8);
  assert.equal(frozen.source[0], 'VERIFIED_QUARTER_SNAPSHOT');
  assert.equal(frozen.isOfficial, false);
});

test('monthly fallback uses smallest protective YTD quarter, preserves exact precedence and rejects invalid identity', async () => {
  const f = fixture();
  const snapshot = (periodNumber: number, isQuarter: boolean) => JSON.parse(JSON.stringify({ schemaVersion: 1, healthCenter: f.healthCenter, sections: f.sections, indicators: f.indicators, targets: f.targets, records: f.records, period: { healthCenterId: f.healthCenterId, year: 2026, periodNumber, isQuarter } }));
  const q2 = snapshot(2, true);
  q2.records.find((record: { indicatorId: string; month: number }) => record.indicatorId === '1' && record.month === 1).pencapaianRiil = '25';
  f.locks.push({ periodNumber: 2, isQuarter: true, status: 'VERIFIED', snapshot: q2 });
  f.locks.push({ periodNumber: 1, isQuarter: true, status: 'SUBMITTED', snapshot: snapshot(1, true) });
  f.locks.push({ periodNumber: 2, isQuarter: false, status: 'VERIFIED', snapshot: snapshot(2, false) });
  f.targets.forEach(target => { target.targetPct = '50'; });
  f.indicators[0]!.targetNumeric = new Prisma.Decimal('0.1');
  const trends = await f.service.annualTrend(f.healthCenterId, 2026);
  assert.equal(trends.source[0], 'SUBMITTED_QUARTER_SNAPSHOT');
  assert.equal(trends.source[1], 'VERIFIED_SNAPSHOT');
  assert.equal(trends.source[2], 'SUBMITTED_QUARTER_SNAPSHOT');
  assert.equal(trends.source[3], 'VERIFIED_QUARTER_SNAPSHOT');
  assert.equal(trends.source[6], 'LIVE_DATABASE');
  assert.equal(trends.monthlyOverallScores[0], 100);
  assert.equal(trends.monthlyOverallScores[2], 100);
  assert.equal(trends.isOfficial, false);
  q2.period.periodNumber = 3;
  await assert.rejects(f.service.indicatorTrends(f.healthCenterId, 2026), ConflictException);
});
