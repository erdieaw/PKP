import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { hash } from 'argon2';
import { Prisma, Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { IsDefined, validateSync } from 'class-validator';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { createApp } from '../src/main';
import type { AnalyticsService } from '../src/analytics/analytics.service';
import type { PmeAnnualInput, RtmAnnualInput } from '../src/analytics/do2026/structured-input';
import { annualStructuredFixtures } from './annual-structured.fixtures';
import { sourceAssessmentFixture, sourceAssessmentRegressionCases, sourceVerifiedNihilFixture } from './source-assessment.fixtures';
import { evaluateSourceAssessment, sourceAssessmentDescriptor } from '../src/analytics/do2026/source-assessment';
import { evaluateLocalFixture, localResolutionFixture, localResolutionIds } from './local-resolution.fixtures';

class Envelope<T> { @IsDefined() data!: T; }
type View = Awaited<ReturnType<AnalyticsService['periodRecap']>>;
type Sheet = Awaited<ReturnType<AnalyticsService['sheet7']>>;

test('separate recaps persist and authorize through real HTTP without changing monthly history', {
  skip: process.env.TEST_DO_E2E !== 'true', timeout: 120000,
}, async t => {
  // Given: a dedicated, disposable migrated database.
  assert.equal(new URL(process.env.DATABASE_URL ?? '').pathname, '/pkp_do_qa');
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const db = app.get(DbService);
    const auth = app.get(AuthService);
    const suffix = randomUUID();
    const password = `Disposable-${suffix}`;
    const passwordHash = await hash(password);
    const center = await db.healthCenter.create({ data: { code: `RC-${suffix}`, name: 'QA Rekap Terpisah', district: 'QA' } });
    const other = await db.healthCenter.create({ data: { code: `OTHER-${suffix}`, name: 'QA Other', district: 'QA' } });
    const makeUser = (role: Role, username: string) => db.user.create({ data: { username: `${username}-${suffix}`, name: username, role, passwordHash, ...(role === Role.DINKES_ADMIN ? {} : { healthCenterId: center.id }) } });
    const admin = await makeUser(Role.ADMIN_PUSKESMAS, 'recap');
    const pic = await makeUser(Role.PIC, 'recap-pic');
    const dinkes = await makeUser(Role.DINKES_ADMIN, 'recap-dk');
    const [a, p, d] = await Promise.all([admin, pic, dinkes].map(user => auth.login({ username: user.username, password })));
    assert.ok(a && p && d);
    await db.periodSettings.update({ where: { id: 1 }, data: { activeYear: 2026 } });
    const api = async <T>(method: string, path: string, body?: unknown, token = a.accessToken, status = 200): Promise<T> => {
      const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
      const payload: unknown = await response.json();
      assert.equal(response.status, status, JSON.stringify(payload));
      const result = plainToInstance<Envelope<T>, unknown>(Envelope, payload);
      if (status < 400) assert.equal(validateSync(result).length, 0);
      return result.data;
    };
    const recap = { year: 2026, endMonth: 3, indicatorId: 'K2-R51', numerator: 5, denominator: 100, notes: 'Register unik Januari–Maret; seluruh periode telah direkonsiliasi.', confirmed: true, expectedRevision: 0 };
    const view = (endMonth = 3) => api<View>('GET', `/analytics/period-recap?year=2026&endMonth=${endMonth}`);
    await t.test('complete months cannot bypass compatibility review and missing months stay visible', async () => {
      // Given
      for (const [month, n, denominator] of [[1, 10, 5], [2, 90, 30]]) await api('PUT', '/records/monthly', { year: 2026, month, records: [{ indicatorId: 'K5-R26', pencapaianRiil: n, totalSasaran: denominator, inputBasis: 'PERIOD_ACTUAL', scoringVersion: 'DO_2026_V2' }] });
      // When
      const february = (await view(2)).items.find(item => item.indicatorId === 'K5-R26');
      const march = (await view()).items.find(item => item.indicatorId === 'K5-R26');
      // Then
      assert.deepEqual([february?.numerator, february?.denominator, february?.status, february?.nilaiKinerja], [null, null, 'COMPATIBILITY_UNVERIFIED', null]);
      assert.deepEqual([march?.measurementValue, march?.missingMonths, march?.dataComplete], [null, [3], false]);
    });
    await t.test('confirmed separate recap appears in quarterly reports while monthly rows stay identical', async () => {
      // Given
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      // When
      const saved = await api<{ revision: number }>('PUT', '/records/period-recaps', recap);
      const result = (await view()).items.find(item => item.indicatorId === recap.indicatorId);
      const sheet = await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=1');
      // Then
      assert.equal(saved.revision, 1);
      assert.deepEqual([result?.numerator, result?.measurementValue, result?.nilaiKinerja, result?.dataComplete, result?.missingMonths], [5, 5, 100, true, [1, 2, 3]]);
      assert.equal(sheet.indicators.find(item => item.indicatorId === recap.indicatorId)?.nilaiKinerja, 100);
      assert.equal(sheet.isOfficial, false);
      assert.equal(sheet.kategoriPKP, null);
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
      assert.equal(await db.auditLog.count({ where: { healthCenterId: center.id, action: 'PERIOD_RECAP_SAVED' } }), 1);
    });
    await t.test('stale revision cannot overwrite a saved recap', async () => {
      // Given / When
      await api('PUT', '/records/period-recaps', { ...recap, numerator: 9 }, a.accessToken, 409);
      // Then
      assert.equal((await view()).items.find(item => item.indicatorId === recap.indicatorId)?.numerator, 5);
    });
    await t.test('concurrent same-revision writes have exactly one winner', async () => {
      // Given
      const write = { ...recap, expectedRevision: 1 };
      // When
      const statuses = await Promise.all([6, 7].map(numerator => fetch(`${base}/records/period-recaps`, { method: 'PUT', headers: { Authorization: `Bearer ${a.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...write, numerator }), signal: AbortSignal.timeout(15000) }).then(response => response.status)));
      // Then
      assert.deepEqual(statuses.sort(), [200, 409]);
      assert.equal((await view()).items.find(item => item.indicatorId === recap.indicatorId)?.recapRevision, 2);
    });
    await t.test('tenant access and Dinkes read-only authority are enforced', async () => {
      // Given / When / Then
      await api('PUT', '/records/period-recaps', { ...recap, healthCenterId: other.id }, a.accessToken, 403);
      await api('GET', '/analytics/period-recap?year=2026&endMonth=3', undefined, d.accessToken, 400);
      await api('GET', `/analytics/period-recap?year=2026&endMonth=3&healthCenterId=${center.id}`, undefined, d.accessToken);
      await api('PUT', '/records/period-recaps', { ...recap, healthCenterId: center.id }, d.accessToken, 403);
    });
    await t.test('PIC can save only assigned indicators', async () => {
      // Given / When / Then
      const input = { ...recap, endMonth: 4 };
      await api('PUT', '/records/period-recaps', input, p.accessToken, 403);
      await db.picAssignment.create({ data: { healthCenterId: center.id, year: 2026, indicatorId: recap.indicatorId, picUserId: pic.id } });
      await api('PUT', '/records/period-recaps', input, p.accessToken);
    });
    await t.test('unsupported profiles and unconfirmed or excessive-precision input fail closed', async () => {
      // Given / When / Then
      for (const change of [{ confirmed: false }, { notes: ' ' }, { numerator: 0.12345 }, { numerator: 0.5 }, { denominator: 10.5 }, { indicatorId: 'K1-R9' }, { year: 2025 }]) await api('PUT', '/records/period-recaps', { ...recap, ...change }, a.accessToken, 400);
    });
    await t.test('annual recap is independent of quarter recaps and disables misleading annual means', async () => {
      // Given / When
      await api('PUT', '/records/period-recaps', { ...recap, endMonth: 12, numerator: 10 });
      const annual = await view(12);
      const trend = await api<{ annualAveragePKP: number | null }>('GET', '/analytics/annual-trend?year=2026');
      // Then
      assert.equal(annual.items.find(item => item.indicatorId === recap.indicatorId)?.numerator, 10);
      assert.notEqual((await view()).items.find(item => item.indicatorId === recap.indicatorId)?.numerator, 10);
      assert.equal(trend.annualAveragePKP, null);
    });
    await t.test('recap-only DO data blocks official legacy submission', async () => {
      // Given: this tenant has no monthly records of either version.
      const recapUser = await db.user.create({ data: { username: `only-recap-${suffix}`, name: 'Only recap', role: Role.ADMIN_PUSKESMAS, passwordHash, healthCenterId: other.id } });
      const session = await auth.login({ username: recapUser.username, password });
      await api('PUT', '/records/period-recaps', recap, session.accessToken);
      // When / Then
      await api('POST', '/workflow/submit', { year: 2026, periodNumber: 1, isQuarter: true }, session.accessToken, 409);
      assert.equal((await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=1', undefined, session.accessToken)).indicators.find(item => item.indicatorId === recap.indicatorId)?.scoringVersion, 'DO_2026_V2');
    });
    await t.test('annual-only profiles reject monthly and partial recap writes without changing history', async () => {
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      for (const indicatorId of ['K1-R29', 'K2-R11', 'K3-R14', 'K4-R9', 'K5-R21']) {
        for (const month of [3, 12]) await api('PUT', '/records/monthly', {
          year: 2026, month, records: [{ indicatorId, pencapaianRiil: 1, totalSasaran: 100, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL' }],
        }, a.accessToken, 400);
        await api('PUT', '/records/period-recaps', { ...recap, indicatorId }, a.accessToken, 400);
        await api('PUT', '/records/period-recaps', { ...recap, indicatorId, endMonth: 12, confirmed: false }, a.accessToken, 400);
        assert.equal(await db.periodRecap.count({ where: { healthCenterId: center.id, indicatorId } }), 0);
      }
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
    });
    await t.test('annual-only recaps produce measurements but no performance score or official assessment', async () => {
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      const fixtures = [
        ['K1-R29', 60, 100, 60, true], ['K1-R56', 3, 4, 75, false],
        ['K2-R11', 85, 100, 85, true], ['K3-R14', 13, 100, 13, true], ['K4-R9', 9, 10, 90, true],
        ['K5-R21', 4, 5, 80, true],
      ] as const;
      for (const [indicatorId, numerator, denominator] of fixtures) {
        await api('PUT', '/records/period-recaps', { ...recap, indicatorId, endMonth: 12, numerator, denominator });
      }
      const annual = await view(12);
      const partial = await view(3);
      const sheet = await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=4');
      for (const [indicatorId, numerator, denominator, measurement, targetMet] of fixtures) {
        const row = annual.items.find(item => item.indicatorId === indicatorId);
        assert.deepEqual([row?.numerator, row?.denominator, row?.measurementValue, row?.targetMet], [numerator, denominator, measurement, targetMet]);
        assert.deepEqual([row?.nilaiKinerja, row?.scoreComplete, row?.assessmentComplete, row?.completionScope], [null, false, false, 'ARITHMETIC_ONLY']);
        assert.equal(partial.items.find(item => item.indicatorId === indicatorId)?.status, 'ANNUAL_RECAP_REQUIRED');
        const reported = sheet.indicators.find(item => item.indicatorId === indicatorId);
        assert.ok(reported && 'assessmentComplete' in reported);
        assert.deepEqual([reported.measurementValue, reported.nilaiKinerja, reported.assessmentComplete], [measurement, null, false]);
      }
      assert.equal(sheet.isOfficial, false);
      assert.equal(sheet.reportingPolicy.canSubmit, false);
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
    });
    await t.test('annual-only recap access and optimistic revisions still fail closed', async () => {
      const annual = { ...recap, indicatorId: 'K1-R29', endMonth: 12, numerator: 61, denominator: 100 };
      await api('PUT', '/records/period-recaps', annual, a.accessToken, 409);
      await api('PUT', '/records/period-recaps', { ...annual, expectedRevision: 1 }, p.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...annual, healthCenterId: other.id, expectedRevision: 1 }, a.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...annual, healthCenterId: center.id, expectedRevision: 1 }, d.accessToken, 403);
      await db.picAssignment.create({ data: { healthCenterId: center.id, year: 2026, indicatorId: annual.indicatorId, picUserId: pic.id } });
      await api('PUT', '/records/period-recaps', { ...annual, expectedRevision: 1 }, p.accessToken);
      assert.equal((await view(12)).items.find(item => item.indicatorId === annual.indicatorId)?.recapRevision, 2);
    });
    const pme: PmeAnnualInput = { kind: 'PME_ANNUAL', year: 2026, participations: [1, 2, 3].map(i => ({ eventId: `PME-${i}`, date: `2026-0${i}-10`, organizer: 'External lab', program: 'PME', evidenceReference: `Certificate ${i}` })) };
    const rtm: RtmAnnualInput = { kind: 'RTM_ANNUAL', year: 2026,
      meetings: [{ meetingId: 'RTM-1', date: '2026-01-10', minutesReference: 'Minutes 1' }, { meetingId: 'RTM-2', date: '2026-12-31', minutesReference: 'Minutes 2' }],
      recommendations: [{ recommendationId: 'R1', meetingId: 'RTM-1', description: 'Improve quality', followUpStatus: 'COMPLETED', followUpDate: '2026-12-31', followUpReference: 'Report 1' }],
    };
    const structuredWrite = { ...recap, indicatorId: 'K5-R38', endMonth: 12, numerator: 3, denominator: 2, structuredInput: pme };
    await t.test('structured annual recaps require strict ledgers, scope, derived counts and confirmation over HTTP', async () => {
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      for (const change of [
        { structuredInput: undefined }, { structuredInput: null }, { structuredInput: true },
        { numerator: 2 }, { denominator: 3 }, { numerator: 0.5 }, { endMonth: 11 }, { confirmed: false }, { confirmed: 'true' },
        { structuredInput: { ...pme, year: 2027 } }, { structuredInput: { ...pme, year: '2026' } },
        { structuredInput: { ...pme, kind: 'RTM_ANNUAL' } }, { structuredInput: { ...pme, unrecognized: true } },
        { structuredInput: { ...pme, participations: [{ ...pme.participations[0], evidenceReference: '' }] } },
        ...['2026-02-29', '2027-01-01', '2025-12-31', '2026-01-01T00:00:00Z'].map(date => ({ structuredInput: { ...pme, participations: [{ ...pme.participations[0], date }] } })),
        { structuredInput: { ...pme, participations: [pme.participations[0], { ...pme.participations[1], eventId: ' pme-1 ' }] } },
        { structuredInput: { ...pme, participations: [pme.participations[0], { ...pme.participations[0], eventId: 'different', organizer: ' EXTERNAL LAB ', program: ' pme ' }] } },
      ]) await api('PUT', '/records/period-recaps', { ...structuredWrite, ...change }, a.accessToken, 400);
      await api('PUT', '/records/period-recaps', { ...structuredWrite, indicatorId: 'K1-R29', numerator: 1 }, a.accessToken, 400);
      await api('PUT', '/records/period-recaps', { ...structuredWrite, year: 2027, structuredInput: { ...pme, year: 2026 } }, a.accessToken, 409);
      for (const indicatorId of ['K5-R38', 'K1-R40']) {
        for (const month of [1, 12]) await api('PUT', '/records/monthly', { year: 2026, month, records: [{ indicatorId, pencapaianRiil: 1, totalSasaran: 2, inputBasis: 'PERIOD_ACTUAL', scoringVersion: 'DO_2026_V2' }] }, a.accessToken, 400);
        assert.equal(await db.periodRecap.count({ where: { healthCenterId: center.id, indicatorId } }), 0);
      }
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
    });
    await t.test('PME persists JSONB, reads 150% with no performance score, and appears in annual reports', async () => {
      const saved = await api<{ structuredInput: unknown; revision: number }>('PUT', '/records/period-recaps', structuredWrite);
      assert.deepEqual(saved.structuredInput, pme);
      assert.equal(saved.revision, 1);
      const stored = await db.periodRecap.findUniqueOrThrow({ where: { healthCenterId_indicatorId_year_endMonth: { healthCenterId: center.id, year: 2026, indicatorId: 'K5-R38', endMonth: 12 } } });
      assert.deepEqual(stored.structuredInput, pme);
      const result = (await view(12)).items.find(item => item.indicatorId === 'K5-R38')!;
      assert.deepEqual([result.measurementValue, result.numerator, result.denominator, result.targetMet, result.nilaiKinerja, result.dataComplete], [150, 3, 2, true, null, true]);
      assert.deepEqual(result.recapStructuredInput, pme);
      const sheet = await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=ANNUAL');
      const reported = sheet.indicators.find(item => item.indicatorId === 'K5-R38')!;
      assert.ok('recapStructuredInput' in reported);
      assert.equal(reported.measurementValue, 150);
      assert.deepEqual(reported.recapStructuredInput, pme);
      assert.equal(sheet.isOfficial, false);
      assert.equal(sheet.reportingPolicy.canSubmit, false);
      const list = await api<{ items: { indicatorId: string; structuredInput: unknown }[] }>('GET', '/records/period-recaps?year=2026&endMonth=12');
      assert.deepEqual(list.items.find(item => item.indicatorId === 'K5-R38')!.structuredInput, pme);
      assert.equal(list.items.find(item => item.indicatorId === 'K2-R51')!.structuredInput, null, 'historical numeric recap retains SQL NULL');
      assert.equal((await view(11)).items.find(item => item.indicatorId === 'K5-R38')!.measurementValue, null);
    });
    await t.test('RTM validates meetings and linked same-year completion evidence over HTTP', async () => {
      const write = { ...structuredWrite, indicatorId: 'K1-R40', numerator: 1, denominator: 1, structuredInput: rtm };
      for (const structuredInput of [
        { ...rtm, meetings: [] },
        { ...rtm, meetings: [rtm.meetings[0], { ...rtm.meetings[1], meetingId: ' rtm-1 ' }] },
        { ...rtm, meetings: [rtm.meetings[0], { ...rtm.meetings[0], meetingId: 'other', minutesReference: ' MINUTES 1 ' }] },
        { ...rtm, meetings: [{ ...rtm.meetings[0], minutesReference: '' }] },
        { ...rtm, recommendations: [rtm.recommendations[0], { ...rtm.recommendations[0], recommendationId: ' r1 ' }] },
        ...['2026-01-09', '2027-01-01', '2025-12-31', '2026-02-29'].map(followUpDate => ({ ...rtm, recommendations: [{ ...rtm.recommendations[0], followUpDate }] })),
        { ...rtm, recommendations: [{ ...rtm.recommendations[0], meetingId: 'unknown' }] },
        { ...rtm, recommendations: [{ ...rtm.recommendations[0], followUpReference: '' }] },
        { ...rtm, recommendations: [{ ...rtm.recommendations[0], followUpDate: undefined }] },
        { ...rtm, recommendations: [{ ...rtm.recommendations[0], followUpStatus: 'NOT_COMPLETED' }] },
      ]) await api('PUT', '/records/period-recaps', { ...write, structuredInput }, a.accessToken, 400);
      const oneMeeting = { ...rtm, meetings: [rtm.meetings[0]] };
      await api('PUT', '/records/period-recaps', { ...write, structuredInput: oneMeeting });
      let result = (await view(12)).items.find(item => item.indicatorId === 'K1-R40')!;
      assert.deepEqual([result.measurementValue, result.targetMet, result.dataComplete], [100, false, true]);
      assert.match(result.reason!, /RTM_MINIMUM_MEETINGS_REQUIRED/);
      await api('PUT', '/records/period-recaps', { ...write, expectedRevision: 1 });
      result = (await view(12)).items.find(item => item.indicatorId === 'K1-R40')!;
      assert.deepEqual([result.measurementValue, result.targetMet, result.nilaiKinerja, result.assessmentComplete], [100, true, null, false]);
    });
    await t.test('empty ledgers distinguish explicit zero PME from missing/zero RTM recommendations', async () => {
      await api('PUT', '/records/period-recaps', { ...structuredWrite, expectedRevision: 1, numerator: 0, structuredInput: { ...pme, participations: [] }, notes: 'Confirmed full-year source register: no PME participations.' });
      const zero = (await view(12)).items.find(item => item.indicatorId === 'K5-R38')!;
      assert.deepEqual([zero.measurementValue, zero.targetMet, zero.dataComplete], [0, false, true]);
      await api('PUT', '/records/period-recaps', { ...structuredWrite, indicatorId: 'K1-R40', expectedRevision: 2, numerator: 0, denominator: 0, structuredInput: { ...rtm, recommendations: [] }, notes: 'Confirmed full-year minutes: no recommendations.' });
      const unavailable = (await view(12)).items.find(item => item.indicatorId === 'K1-R40')!;
      assert.deepEqual([unavailable.status, unavailable.measurementValue, unavailable.targetMet, unavailable.dataComplete], ['ZERO_DENOMINATOR', null, null, false]);
      await api('PUT', '/records/period-recaps', { ...structuredWrite, indicatorId: 'K1-R40', expectedRevision: 3, numerator: 0, denominator: 0, structuredInput: { ...rtm, recommendations: undefined } }, a.accessToken, 400);
    });
    await t.test('corrupt/missing structured DB payload fails closed in cumulative and reports without history fallback', async () => {
      const where = { healthCenterId_indicatorId_year_endMonth: { healthCenterId: center.id, year: 2026, indicatorId: 'K5-R38', endMonth: 12 } };
      const original = await db.periodRecap.findUniqueOrThrow({ where });
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      const { Prisma } = await import('@prisma/client');
      try {
        for (const structuredInput of [Prisma.DbNull, { ...pme, year: 2027 }, { ...pme, participations: [null] }, pme]) {
          await db.periodRecap.update({ where, data: { structuredInput } });
          const result = (await view(12)).items.find(item => item.indicatorId === 'K5-R38')!;
          assert.equal(result.dataComplete, false);
          assert.equal(result.measurementValue, null);
          assert.deepEqual(result.recapStructuredInput, structuredInput === Prisma.DbNull ? null : structuredInput);
          const report = await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=4');
          assert.equal(report.indicators.find(item => item.indicatorId === 'K5-R38')!.measurementValue, null);
        }
      } finally { await db.periodRecap.update({ where, data: { structuredInput: original.structuredInput ?? Prisma.DbNull } }); }
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
    });
    await t.test('structured ledgers preserve PIC/tenant permissions, revisions, official hold and protected earlier months', async () => {
      const write = { ...structuredWrite, expectedRevision: 2 };
      await api('PUT', '/records/period-recaps', write, p.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...write, healthCenterId: other.id }, a.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...write, healthCenterId: center.id }, d.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...write, expectedRevision: 0 }, a.accessToken, 409);
      await db.picAssignment.create({ data: { healthCenterId: center.id, year: 2026, indicatorId: 'K5-R38', picUserId: pic.id } });
      await api('PUT', '/records/period-recaps', write, p.accessToken);
      await api('POST', '/workflow/submit', { year: 2026, periodNumber: 4, isQuarter: true }, a.accessToken, 409);
      await db.periodLock.create({ data: { healthCenterId: center.id, year: 2026, periodNumber: 2, isQuarter: false, status: 'SUBMITTED' } });
      try { await api('PUT', '/records/period-recaps', { ...write, expectedRevision: 3 }, a.accessToken, 409); }
      finally { await db.periodLock.deleteMany({ where: { healthCenterId: center.id, year: 2026, periodNumber: 2, isQuarter: false } }); }
    });
    // Independent actor budget keeps the expanded negative cases within the real 120 writes/minute limit.
    const annualAdmin = await makeUser(Role.ADMIN_PUSKESMAS, 'annual-structured');
    const annualSession = await auth.login({ username: annualAdmin.username, password });
    for (const fixture of annualStructuredFixtures()) await t.test(`${fixture.indicatorId} structured annual JSONB, HTTP JSON, authorization, revisions and audits roundtrip`, async () => {
      if (fixture.structuredInput.kind === 'SEMESTER_SURVEY_ANNUAL') {
        fixture.structuredInput.semesters[0]!.value = 77.9999;
        fixture.structuredInput.semesters[1]!.value = 78;
        fixture.numerator = 155.9999; fixture.measurement = 77.99995; fixture.targetMet = false;
      }
      const { indicatorId, structuredInput, numerator, denominator, measurement, targetMet } = fixture;
      const write = { ...recap, indicatorId, endMonth: 12, structuredInput, numerator, denominator };
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      const where = { healthCenterId_indicatorId_year_endMonth: { healthCenterId: center.id, year: 2026, indicatorId, endMonth: 12 } };
      for (const patch of [{ endMonth: 11 }, { confirmed: false }, { structuredInput: null }, { structuredInput: { ...structuredInput, year: 2027 } }, { structuredInput: { ...structuredInput, patientId: 'unexpected' } }, { numerator: numerator + 1 }, { denominator: denominator + 1 }]) {
        await api('PUT', '/records/period-recaps', { ...write, ...patch }, annualSession.accessToken, 400);
      }
      await api('PUT', '/records/monthly', { year: 2026, month: 12, records: [{ indicatorId, pencapaianRiil: numerator, totalSasaran: denominator, inputBasis: 'PERIOD_ACTUAL', scoringVersion: 'DO_2026_V2' }] }, annualSession.accessToken, 400);
      await api('PUT', '/records/period-recaps', write, p.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...write, healthCenterId: other.id }, annualSession.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...write, healthCenterId: center.id }, d.accessToken, 403);
      const saved = await api<{ structuredInput: unknown; revision: number }>('PUT', '/records/period-recaps', write, annualSession.accessToken);
      assert.deepEqual([saved.structuredInput, saved.revision], [structuredInput, 1]);
      assert.deepEqual((await db.periodRecap.findUniqueOrThrow({ where })).structuredInput, structuredInput);
      const result = (await view(12)).items.find(item => item.indicatorId === indicatorId)!;
      assert.deepEqual([result.numerator, result.denominator, result.measurementValue, result.targetMet], [numerator, denominator, measurement, targetMet]);
      assert.deepEqual([result.nilaiKinerja, result.assessmentComplete, result.completionScope], [null, false, 'ARITHMETIC_ONLY']);
      assert.deepEqual(result.recapStructuredInput, structuredInput);
      assert.equal((await view(11)).items.find(item => item.indicatorId === indicatorId)!.measurementValue, null);
      const report = await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=ANNUAL');
      const reported = report.indicators.find(item => item.indicatorId === indicatorId)!;
      assert.ok('recapStructuredInput' in reported);
      // This is the JSON report consumed by the client's JSON download, not a new export-job format.
      assert.deepEqual(JSON.parse(JSON.stringify(reported.recapStructuredInput)), structuredInput);
      assert.deepEqual([reported.pencapaianRiil, reported.totalSasaran, reported.targetMet], [numerator, denominator, targetMet]);
      assert.equal(reported.measurementValue, measurement);
      assert.equal(report.isOfficial, false);
      assert.equal(report.reportingPolicy.canSubmit, false);
      const list = await api<{ items: { indicatorId: string; structuredInput: unknown }[] }>('GET', '/records/period-recaps?year=2026&endMonth=12');
      assert.deepEqual(list.items.find(item => item.indicatorId === indicatorId)!.structuredInput, structuredInput);
      await api('PUT', '/records/period-recaps', write, annualSession.accessToken, 409);
      const revisedInput = structuredClone(structuredInput);
      let revisedNumerator = numerator;
      switch (revisedInput.kind) {
        case 'LROA_ANNUAL': revisedInput.sourceReference = 'Reconciled SIHEPI/PISP register'; break;
        case 'SEMESTER_SURVEY_ANNUAL': revisedInput.semesters[1]!.value += 0.25; revisedNumerator += 0.25; break;
        case 'TB_COHORT_ANNUAL': revisedInput.cohort.outcomeAssessmentReference = 'Reconciled linked outcomes'; break;
        case 'LEPROSY_COHORT_ANNUAL': revisedInput.cohorts[0]!.outcomeAssessmentReference = 'Reconciled PB outcomes'; break;
      }
      const revision = { ...write, structuredInput: revisedInput, numerator: revisedNumerator, expectedRevision: 1 };
      await db.picAssignment.create({ data: { healthCenterId: center.id, year: 2026, indicatorId, picUserId: pic.id } });
      await api('PUT', '/records/period-recaps', revision, p.accessToken);
      const stored = await db.periodRecap.findUniqueOrThrow({ where });
      assert.deepEqual([stored.structuredInput, stored.revision, stored.numerator.toNumber()], [revisedInput, 2, revisedNumerator]);
      const revised = (await view(12)).items.find(item => item.indicatorId === indicatorId)!;
      assert.deepEqual(revised.recapStructuredInput, revisedInput);
      assert.equal(revised.measurementValue, indicatorId === 'K1-R39' ? 78.12495 : measurement);
      const logs = await db.auditLog.findMany({ where: { healthCenterId: center.id, action: 'PERIOD_RECAP_SAVED' }, orderBy: { createdAt: 'desc' } });
      const details = logs.map(log => log.details as Prisma.JsonObject).find(row => (row.value as Prisma.JsonObject)?.indicatorId === indicatorId)!;
      for (const [key, expected] of [['previous', structuredInput], ['value', revisedInput]] as const) {
        const snapshot = details[key] as Prisma.JsonObject;
        const wrapped = snapshot.structuredInput as Prisma.JsonObject;
        assert.equal(wrapped.format, 'RECAP_LEDGER_CHUNKS_V1');
        assert.equal(wrapped.complete, true);
        const restored = Object.fromEntries(Object.entries(wrapped.ledger as Prisma.JsonObject).map(([key, value]) => [key,
          value && typeof value === 'object' && !Array.isArray(value) && 'chunks' in value ? (value.chunks as Prisma.JsonArray).flat() : value,
        ]));
        assert.deepEqual(restored, expected);
      }
      await db.periodRecap.update({ where, data: { structuredInput: { ...revisedInput, unexpected: true } } });
      try {
        const corrupt = (await view(12)).items.find(item => item.indicatorId === indicatorId)!;
        assert.deepEqual([corrupt.dataComplete, corrupt.measurementValue], [false, null]);
        await api('PUT', '/records/period-recaps', { ...revision, expectedRevision: 2 }, annualSession.accessToken, 400);
      } finally { await db.periodRecap.update({ where, data: { structuredInput: revisedInput } }); }
      await db.periodLock.create({ data: { healthCenterId: center.id, year: 2026, periodNumber: 2, isQuarter: false, status: 'SUBMITTED' } });
      try { await api('PUT', '/records/period-recaps', { ...revision, expectedRevision: 2 }, annualSession.accessToken, 409); }
      finally { await db.periodLock.deleteMany({ where: { healthCenterId: center.id, year: 2026, periodNumber: 2, isQuarter: false } }); }
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
    });
    const sourceAdmin = await makeUser(Role.ADMIN_PUSKESMAS, 'source-assessment');
    const sourceSession = await auth.login({ username: sourceAdmin.username, password });
    await t.test('source descriptors expose calendar derivation, provisional window and scoped nihil evidence through HTTP', async () => {
      const catalogue = await api<{ items: { id: string; do2026: { sourceAssessment: ReturnType<typeof sourceAssessmentDescriptor> } }[] }>('GET', '/master/indicators');
      const descriptor = (id: string) => catalogue.items.find(row => row.id === id)!.do2026.sourceAssessment!;
      assert.equal(descriptor('K1-R34').denominatorRule!.kind, 'CALENDAR_MONTH_DAYS');
      assert.match(descriptor('K1-R34').denominatorRule!.sourceQuote, /jumlah hari dalam satu bulan/);
      for (const id of ['K1-R137', 'K1-R138']) {
        assert.equal(descriptor(id).periodWindowRule!.kind, 'CURRENT_AND_PREVIOUS_ASSESSMENT_YEAR_TO_CUTOFF');
        assert.equal(descriptor(id).periodWindowRule!.authority, 'PROVISIONAL_TECHNICAL_CONVENTION_NOT_SOURCE_MANDATED');
      }
      for (const id of ['K3-R11', 'K3-R48', 'K3-R49']) {
        assert.equal(descriptor(id).verifiedNihilRule!.available, true);
        assert.match(descriptor(id).verifiedNihilRule!.sourceQuote, /Dinas Sosial/);
      }
      assert.equal(descriptor('K3-R12').verifiedNihilRule!.available, false);
      assert.equal(descriptor('K4-R15').denominatorRule!.arithmetic, 'EXACT_SCALED_INTEGER');
    });
    for (const [indicatorId, n, denominatorInput] of [
      ['K1-R11', 9, 12], ['K1-R13', 1, 2], ['K4-R33', 2, 10], ['K5-R22', 8, 10],
      ['K1-R9', 1, 0], ['K1-R10', 1, 2], ['K2-R61', 8, 10], ['K4-R14', 270, 540], ['K1-R146', 1100.55, 1000.5],
      ['K1-R34', 1, 31], ['K1-R137', 1, 1], ['K1-R138', 1, 1],
      ['K3-R11', 0, 0], ['K3-R48', 0, 0], ['K3-R49', 0, 0], ['K3-R12', 0, 0], ['K4-R15', 9, 10],
    ] as const) await t.test(`${indicatorId} source assessment JSONB, scope, revision, audit and authority safeguards`, async () => {
      // Isolate each contract's write budget without relaxing the real rate limiter.
      const sourceAdmin = await makeUser(Role.ADMIN_PUSKESMAS, `source-${indicatorId}`);
      const sourceSession = await auth.login({ username: sourceAdmin.username, password });
      const structuredInput = sourceAssessmentFixture(indicatorId, n, denominatorInput);
      if (['K3-R11', 'K3-R48', 'K3-R49'].includes(indicatorId)) structuredInput.verifiedNihil = sourceVerifiedNihilFixture(structuredInput);
      const derived = evaluateSourceAssessment(indicatorId, structuredInput, 2026, 12);
      const write = { ...recap, indicatorId, endMonth: 12, structuredInput, numerator: derived.numerator, denominator: derived.denominator };
      const where = { healthCenterId_indicatorId_year_endMonth: { healthCenterId: center.id, year: 2026, indicatorId, endMonth: 12 } };
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      const auditCount = await db.auditLog.count({ where: { healthCenterId: center.id, action: 'PERIOD_RECAP_SAVED' } });
      for (const patch of [
        { structuredInput: null }, { confirmed: false }, { numerator: derived.numerator + 1 },
        { structuredInput: { ...structuredInput, contractVersion: 'FUTURE' } },
        { structuredInput: { ...structuredInput, context: {} } },
      ]) await api('PUT', '/records/period-recaps', { ...write, ...patch }, sourceSession.accessToken, 400);
      const invalidPayloads: unknown[] = [];
      if (indicatorId === 'K1-R34') invalidPayloads.push({ ...structuredInput, values: { kind: 'RATIO_AGGREGATE', numerator: 1, denominator: 1 } });
      if (indicatorId === 'K1-R137' || indicatorId === 'K1-R138') invalidPayloads.push(
        { ...structuredInput, period: { ...structuredInput.period, startDate: '2000-01-01', endDate: '2001-12-31' } },
        { ...structuredInput, period: { ...structuredInput.period, startDate: '2024-01-01', endDate: '2025-12-31' } },
      );
      if (structuredInput.verifiedNihil) {
        for (const patch of [{ dinsosReference: '' }, { cohortAbsenceReference: '' }, { noResidualPriorYearObligationConfirmed: false }, { territoryReference: 'other territory' }, { periodStartDate: '2025-01-01' }]) invalidPayloads.push({ ...structuredInput, verifiedNihil: { ...structuredInput.verifiedNihil, ...patch } });
        invalidPayloads.push({ ...structuredInput, attestation: { ...structuredInput.attestation, sourceCoverageComplete: false } });
      } else invalidPayloads.push({ ...structuredInput, verifiedNihil: sourceVerifiedNihilFixture(structuredInput) });
      if (indicatorId === 'K4-R15') invalidPayloads.push({ ...structuredInput, parameters: { ...sourceAssessmentRegressionCases.repeatingAllocation }, values: { kind: 'RATIO_AGGREGATE', numerator: 1, denominator: sourceAssessmentRegressionCases.roundedAllocationDenominator } });
      for (const payload of invalidPayloads) await api('PUT', '/records/period-recaps', { ...write, structuredInput: payload }, sourceSession.accessToken, 400);
      assert.equal(await db.periodRecap.findUnique({ where }), null);
      assert.equal(await db.auditLog.count({ where: { healthCenterId: center.id, action: 'PERIOD_RECAP_SAVED' } }), auditCount);
      await api('PUT', '/records/monthly', { year: 2026, month: 12, records: [{ indicatorId, pencapaianRiil: write.numerator, totalSasaran: write.denominator, inputBasis: 'PERIOD_ACTUAL', scoringVersion: 'DO_2026_V2' }] }, sourceSession.accessToken, 400);
      await api('PUT', '/records/period-recaps', write, p.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...write, healthCenterId: other.id }, sourceSession.accessToken, 403);
      await api('PUT', '/records/period-recaps', { ...write, healthCenterId: center.id }, d.accessToken, 403);
      const saved = await api<{ structuredInput: unknown; revision: number }>('PUT', '/records/period-recaps', write, sourceSession.accessToken);
      assert.deepEqual([saved.structuredInput, saved.revision], [structuredInput, 1]);
      assert.deepEqual((await db.periodRecap.findUniqueOrThrow({ where })).structuredInput, structuredInput);
      const observed = (await view(12)).items.find(row => row.indicatorId === indicatorId)!;
      assert.deepEqual([observed.numerator, observed.denominator, observed.measurementValue, observed.nilaiKinerja, observed.assessmentComplete], [derived.numerator, derived.denominator, derived.measurementValue, null, false]);
      assert.equal(observed.targetMet, derived.targetMet);
      if (indicatorId === 'K1-R34') assert.equal(observed.measurementValue, 3.22580645);
      if (structuredInput.verifiedNihil) assert.deepEqual([observed.status, observed.targetMet, observed.measurementValue], ['VERIFIED_NO_CASE_TARGET_MET', true, null]);
      if (indicatorId === 'K3-R12') assert.deepEqual([observed.status, observed.targetMet], ['SOURCE_UNRESOLVED', null]);
      assert.deepEqual(observed.recapStructuredInput, structuredInput);
      const sheet = await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=ANNUAL');
      const reported = sheet.indicators.find(row => row.indicatorId === indicatorId)!;
      assert.equal(reported.measurementValue, derived.assessmentScope.annualComparable ? derived.measurementValue : null);
      assert.equal(reported.nilaiKinerja, null);
      assert.ok('recapStructuredInput' in reported);
      assert.deepEqual(reported.recapStructuredInput, structuredInput);
      assert.equal(sheet.isOfficial, false);
      assert.equal(sheet.reportingPolicy.canSubmit, false);
      if (indicatorId === 'K5-R22' || indicatorId === 'K1-R13') {
        const trend = await api<{ items: { indicator: { id: string }; monthlyMeasurements: (number | null)[]; monthlyVersions: (string | null)[]; annualAveragePct: number | null }[] }>('GET', '/analytics/indicator-trends?year=2026');
        const item = trend.items.find(row => row.indicator.id === indicatorId)!;
        assert.equal(item.monthlyVersions[11], 'DO_2026_V2');
        assert.equal(item.monthlyMeasurements[11], indicatorId === 'K5-R22' ? derived.measurementValue : null);
        assert.equal(item.annualAveragePct, null);
      }
      await api('PUT', '/records/period-recaps', write, sourceSession.accessToken, 409);
      const revisedInput = structuredClone(structuredInput);
      revisedInput.provenance.reconciliationReference = 'QA revised reconciliation with unchanged observations';
      await db.picAssignment.create({ data: { healthCenterId: center.id, year: 2026, indicatorId, picUserId: pic.id } });
      const revision = { ...write, structuredInput: revisedInput, expectedRevision: 1 };
      await api('PUT', '/records/period-recaps', revision, p.accessToken);
      const logs = await db.auditLog.findMany({ where: { healthCenterId: center.id, action: 'PERIOD_RECAP_SAVED' }, orderBy: { createdAt: 'desc' } });
      const details = logs.map(log => log.details as Prisma.JsonObject).find(row => (row.value as Prisma.JsonObject)?.indicatorId === indicatorId)!;
      for (const [key, expected] of [['previous', structuredInput], ['value', revisedInput]] as const) {
        const wrapped = (details[key] as Prisma.JsonObject).structuredInput as Prisma.JsonObject;
        assert.equal(wrapped.complete, true);
        assert.deepEqual(wrapped.ledger, expected);
      }
      const unsupported = { ...revisedInput, contractVersion: 'FUTURE' };
      await db.periodRecap.update({ where, data: { structuredInput: unsupported } });
      try {
        const corrupt = (await view(12)).items.find(row => row.indicatorId === indicatorId)!;
        assert.deepEqual([corrupt.measurementValue, corrupt.dataComplete, corrupt.recapStructuredInput], [null, false, unsupported]);
        await api('PUT', '/records/period-recaps', { ...revision, expectedRevision: 2 }, sourceSession.accessToken, 400);
      } finally { await db.periodRecap.update({ where, data: { structuredInput: revisedInput } }); }
      if (['K1-R34', 'K1-R137', 'K1-R138', 'K3-R11', 'K3-R48', 'K3-R49', 'K4-R15'].includes(indicatorId)) {
        const invalidStored = invalidPayloads[indicatorId === 'K4-R15' ? invalidPayloads.length - 1 : 0] as Prisma.InputJsonObject;
        await db.periodRecap.update({ where, data: { structuredInput: invalidStored } });
        try {
          const corrupt = (await view(12)).items.find(row => row.indicatorId === indicatorId)!;
          assert.deepEqual([corrupt.measurementValue, corrupt.targetMet, corrupt.dataComplete, corrupt.recapStructuredInput], [null, null, false, invalidStored]);
          await api('PUT', '/records/period-recaps', { ...revision, expectedRevision: 2 }, sourceSession.accessToken, 400);
        } finally { await db.periodRecap.update({ where, data: { structuredInput: revisedInput } }); }
      }
      await db.periodLock.create({ data: { healthCenterId: center.id, year: 2026, periodNumber: 2, isQuarter: false, status: 'SUBMITTED' } });
      try { await api('PUT', '/records/period-recaps', { ...revision, expectedRevision: 2 }, sourceSession.accessToken, 409); }
      finally { await db.periodLock.deleteMany({ where: { healthCenterId: center.id, year: 2026, periodNumber: 2, isQuarter: false } }); }
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
    });
    await t.test('two-year document windows accept a November cutoff without December or stale-year substitution', async () => {
      for (const indicatorId of ['K1-R137', 'K1-R138']) {
        const structuredInput = sourceAssessmentFixture(indicatorId, 1, 1);
        structuredInput.period.endDate = structuredInput.period.cutoffDate = '2026-11-15';
        const write = { ...recap, indicatorId, endMonth: 11, structuredInput, numerator: 1, denominator: 1 };
        const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
        await api('PUT', '/records/period-recaps', { ...write, structuredInput: { ...structuredInput, period: { ...structuredInput.period, endDate: '2026-12-31' } } }, sourceSession.accessToken, 400);
        await api('PUT', '/records/period-recaps', write, sourceSession.accessToken);
        const observed = (await view(11)).items.find(row => row.indicatorId === indicatorId)!;
        assert.equal(observed.measurementValue, 100);
        assert.equal(observed.assessmentScope!.annualComparable, false);
        assert.deepEqual(observed.recapStructuredInput, structuredInput);
        assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
      }
    });
    for (const indicatorId of localResolutionIds) await t.test(`${indicatorId} explicit local resolution HTTP/JSONB, revision, audit and report scope`, async () => {
      const localAdmin = await makeUser(Role.ADMIN_PUSKESMAS, `local-${indicatorId}`);
      const session = await auth.login({ username: localAdmin.username, password });
      const structuredInput = localResolutionFixture(indicatorId), derived = evaluateLocalFixture(indicatorId, structuredInput);
      const endMonth = Number(structuredInput.period.cutoffDate.slice(5, 7));
      const where = { healthCenterId_indicatorId_year_endMonth: { healthCenterId: center.id, indicatorId, year: 2026, endMonth } };
      const previous = await db.periodRecap.findUnique({ where });
      const expectedRevision = previous?.revision ?? 0;
      const write = { ...recap, indicatorId, endMonth, numerator: derived.numerator, denominator: derived.denominator, structuredInput, expectedRevision };
      const before = await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } });
      for (const localResolution of [null, { ...structuredInput.localResolution, accepted: false }, { ...structuredInput.localResolution, contractVersion: 'FUTURE' }, { ...structuredInput.localResolution, indicatorId: 'other' }]) {
        await api('PUT', '/records/period-recaps', { ...write, structuredInput: { ...structuredInput, localResolution } }, session.accessToken, 400);
      }
      await api('PUT', '/records/period-recaps', { ...write, numerator: derived.numerator + 1 }, session.accessToken, 400);
      const saved = await api<{ structuredInput: unknown; revision: number }>('PUT', '/records/period-recaps', write, session.accessToken);
      assert.deepEqual([saved.structuredInput, saved.revision], [structuredInput, expectedRevision + 1]);
      assert.deepEqual((await db.periodRecap.findUniqueOrThrow({ where })).structuredInput, structuredInput);
      const observed = (await view(endMonth)).items.find(row => row.indicatorId === indicatorId)!;
      assert.deepEqual(observed.localResolutionResult, derived.localResolutionResult);
      assert.deepEqual([observed.numerator, observed.denominator, observed.nilaiKinerja, observed.assessmentComplete], [derived.numerator, derived.denominator, null, false]);
      const listed = await api<{ items: { indicatorId: string; structuredInput: unknown }[] }>('GET', `/records/period-recaps?year=2026&endMonth=${endMonth}`, undefined, session.accessToken);
      assert.deepEqual(listed.items.find(row => row.indicatorId === indicatorId)!.structuredInput, structuredInput);
      await api('PUT', '/records/period-recaps', write, session.accessToken, 409);
      const revised = structuredClone(structuredInput); revised.localResolution.acceptanceReference = 'QA renewed explicit local acceptance';
      await api('PUT', '/records/period-recaps', { ...write, expectedRevision: expectedRevision + 1, structuredInput: revised }, session.accessToken);
      const logs = await db.auditLog.findMany({ where: { healthCenterId: center.id, userId: localAdmin.id, action: 'PERIOD_RECAP_SAVED' } });
      const detail = logs.map(row => row.details as Prisma.JsonObject).find(row => (row.value as Prisma.JsonObject)?.revision === expectedRevision + 2)!;
      for (const [key, expected] of [['previous', structuredInput], ['value', revised]] as const) {
        const wrapped = (detail[key] as Prisma.JsonObject).structuredInput as Prisma.JsonObject;
        assert.equal(wrapped.complete, true); assert.deepEqual(wrapped.ledger, expected);
      }
      const report = await api<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=ANNUAL', undefined, session.accessToken);
      const reported = report.indicators.find(row => row.indicatorId === indicatorId)!;
      assert.equal(reported.nilaiKinerja, null); assert.equal(report.isOfficial, false);
      assert.equal(report.reportingPolicy.canSubmit, false); assert.equal(report.reportingPolicy.canVerify, false);
      if (endMonth === 12) {
        assert.ok('localResolutionResult' in reported && reported.localResolutionResult);
        if (!derived.assessmentScope.annualComparable) {
          assert.equal(reported.measurementValue, null);
          assert.ok(reported.localResolutionResult.metrics.every(row => row.value === null && row.targetMet === null));
        }
      }
      const unsupported = { ...revised, localResolution: { ...revised.localResolution, unknown: true } };
      await db.periodRecap.update({ where, data: { structuredInput: unsupported } });
      try {
        const corrupt = (await view(endMonth)).items.find(row => row.indicatorId === indicatorId)!;
        assert.deepEqual([corrupt.measurementValue, corrupt.dataComplete, corrupt.recapStructuredInput], [null, false, unsupported]);
        await api('PUT', '/records/period-recaps', { ...write, expectedRevision: expectedRevision + 2 }, session.accessToken, 400);
      } finally { await db.periodRecap.update({ where, data: { structuredInput: revised } }); }
      await api('POST', '/workflow/submit', { year: 2026, periodNumber: 4, isQuarter: true }, session.accessToken, 409);
      assert.deepEqual(await db.monthlyRecord.findMany({ where: { healthCenterId: center.id } }), before);
    });
    await t.test('inactive and locked years reject recap writes', async () => {
      // Given
      await db.yearPeriod.upsert({ where: { year: 2027 }, create: { year: 2027 }, update: {} });
      // When / Then
      await api('PUT', '/records/period-recaps', { ...recap, year: 2027 }, a.accessToken, 409);
      await db.yearPeriod.update({ where: { year: 2026 }, data: { isLocked: true } });
      try { await api('PUT', '/records/period-recaps', { ...recap, endMonth: 5 }, a.accessToken, 409); }
      finally { await db.yearPeriod.update({ where: { year: 2026 }, data: { isLocked: false } }); }
    });
    await t.test('a protected early month blocks changes to a later cumulative recap', async () => {
      // Given
      await db.periodLock.create({ data: { healthCenterId: center.id, year: 2026, periodNumber: 1, isQuarter: false, status: 'SUBMITTED' } });
      // When / Then
      await api('PUT', '/records/period-recaps', { ...recap, endMonth: 12, expectedRevision: 1 }, a.accessToken, 409);
    });
  } finally { await app.close(); }
});
