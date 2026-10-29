import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { hash } from 'argon2';
import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { IsDefined, validateSync } from 'class-validator';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { createApp } from '../src/main';
import type { AnalyticsService } from '../src/analytics/analytics.service';

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
