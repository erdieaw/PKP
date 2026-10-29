import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import ExcelJS from 'exceljs';
import { hash } from 'argon2';
import { Prisma, Role } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/core/db.service';
import { IntegrationService } from '../src/integrations/integrations.service';
import { createApp } from '../src/main';
import type { OperationsService } from '../src/operations/operations.service';
import type { AnalyticsService } from '../src/analytics/analytics.service';
import { plainToInstance } from 'class-transformer';
import { IsDefined, validateSync } from 'class-validator';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DefinitionsController } from '../src/definitions/definitions.module';
import { scoreDo2026 } from '../src/analytics/do2026/scorer';

class Envelope<T> {
  @IsDefined() data!: T;
}

type Monthly = Awaited<ReturnType<OperationsService['monthlyRecords']>>;
type Sheet = Awaited<ReturnType<AnalyticsService['sheet7']>>;

test('DO saves, reads, authorizes, exports and preserves V1 snapshots through real HTTP', {
  skip: process.env.TEST_DO_E2E !== 'true', timeout: 120_000,
}, async t => {
  // Given: a disposable, migrated and catalogue-seeded database, never the user's DB.
  assert.equal(new URL(process.env.DATABASE_URL ?? '').pathname, '/pkp_do_qa');
  const app = await createApp();
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1`;
    const db = app.get(DbService);
    const auth = app.get(AuthService);
    const storage = app.get(IntegrationService);
    const reportsBucket = `reports-${randomUUID()}`;
    storage.config.reportsBucket = reportsBucket;
    await storage.internal.send(new CreateBucketCommand({ Bucket: reportsBucket }));
    const suffix = randomUUID();
    const center = await db.healthCenter.create({ data: { code: `DO-${suffix}`, name: 'DO QA', district: 'QA' } });
    const legacy = await db.healthCenter.create({ data: { code: `V1-${suffix}`, name: 'V1 QA', district: 'QA' } });
    const passwordHash = await hash(`Disposable-${suffix}`);
    const admin = await db.user.create({ data: { username: `do-${suffix}`, name: 'DO QA', passwordHash, role: Role.ADMIN_PUSKESMAS, healthCenterId: center.id } });
    const oldAdmin = await db.user.create({ data: { username: `v1-${suffix}`, name: 'V1 QA', passwordHash, role: Role.ADMIN_PUSKESMAS, healthCenterId: legacy.id } });
    const pic = await db.user.create({ data: { username: `pic-${suffix}`, name: 'PIC QA', passwordHash, role: Role.PIC, healthCenterId: center.id } });
    const dinkes = await db.user.create({ data: { username: `dk-${suffix}`, name: 'Dinkes QA', passwordHash, role: Role.DINKES_ADMIN } });
    const login = (username: string) => auth.login({ username, password: `Disposable-${suffix}` });
    const [a, old, p, dk] = await Promise.all([login(admin.username), login(oldAdmin.username), login(pic.username), login(dinkes.username)]);
    await db.periodSettings.upsert({ where: { id: 1 }, create: { id: 1, activeYear: 2026 }, update: { activeYear: 2026 } });
    async function request<T>(method: string, path: string, token: string, body?: unknown, status = 200): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(payload)}`);
      const envelope = plainToInstance<Envelope<T>, unknown>(Envelope, payload);
      if (status < 400) assert.equal(validateSync(envelope).length, 0);
      return envelope.data;
    }
    const save = (id: string, n: number, d: number, month = 3, basis = 'PERIOD_ACTUAL') => ({ year: 2026, month, records: [{ indicatorId: id, pencapaianRiil: n, totalSasaran: d, scoringVersion: 'DO_2026_V2', inputBasis: basis }] });
    // Read-only compatibility fixture: historical YTD cannot be created by today's HTTP writer.
    async function seedHistoricalYtd(indicatorId: string, n: number, d: number, month = 3) {
      const scored = scoreDo2026(indicatorId, { numerator: n, denominator: d });
      const data = { pencapaianRiil: n, totalSasaran: d, targetSasaran: 0, capaianRiilPct: scored.capaianRiilPct, nilaiKinerja: scored.nilaiKinerja, scoringVersion: 'DO_2026_V2', inputBasis: 'YTD_ACTUAL', updatedBy: admin.id };
      return db.monthlyRecord.upsert({ where: { healthCenterId_indicatorId_year_month: { healthCenterId: center.id, indicatorId, year: 2026, month } }, create: { ...data, healthCenterId: center.id, indicatorId, year: 2026, month }, update: data });
    }

    await t.test('all 272 database definitions retain complete source records from MD', async () => {
      // Given
      const root = join(process.cwd(), '..', 'docs', 'pkp-2026');
      const expected = new Map<string, unknown>();
      for (const file of (await readdir(root)).filter(file => /-bagian-\d+\.md$/.test(file))) {
        const markdown = await readFile(join(root, file), 'utf8');
        for (const match of markdown.matchAll(/```json\n([\s\S]*?)\n```/g)) {
          const row = JSON.parse(match[1] ?? 'null');
          expected.set(row.id, row);
        }
      }
      // When
      const rows = await db.operationalDefinition.findMany({ where: { version: 'DO_2026_V2' } });
      // Then
      assert.equal(rows.length, 272);
      assert.equal(expected.size, 272);
      for (const row of rows) assert.deepEqual(row.sourceRecord, expected.get(row.definitionId));
    });
    await t.test('all authenticated roles can read the database definition through HTTP', async () => {
      // Given
      const stored = await db.operationalDefinition.findUniqueOrThrow({ where: { indicatorId_version: { indicatorId: 'K5-R26', version: 'DO_2026_V2' } } });
      // When / Then
      for (const token of [a.accessToken, p.accessToken, dk.accessToken]) {
        const result = await request<Awaited<ReturnType<DefinitionsController['definition']>>>('GET', '/master/indicators/K5-R26/definition?year=2026', token);
        assert.equal(result.definition, stored.definition);
        assert.equal(result.calculation, stored.calculation);
        assert.equal(result.dataSource, stored.dataSource);
        assert.equal(result.storage, 'DATABASE');
        assert.equal(result.sourceHash, stored.sourceHash);
      }
    });
    await t.test('definition route requires authentication', async () => {
      // Given / When / Then
      await request('GET', '/master/indicators/K5-R26/definition', '', undefined, 401);
    });
    await t.test('definition route rejects unknown indicators and unavailable years without fallback', async () => {
      // Given / When / Then
      await request('GET', '/master/indicators/unknown/definition', a.accessToken, undefined, 404);
      await request('GET', '/master/indicators/K5-R26/definition?year=2025', a.accessToken, undefined, 404);
      await request('GET', '/master/indicators/K5-R26/definition?year=bad', a.accessToken, undefined, 400);
    });
    await t.test('database definition versions reject in-place changes', async () => {
      // Given / When / Then: the trigger protects even updates which preserve the text.
      await assert.rejects(db.operationalDefinition.updateMany({
        where: { indicatorId: 'K5-R26', version: 'DO_2026_V2' }, data: { year: 2025 },
      }));
    });

    await t.test('actual monthly N/D persists without annual targets', async () => {
      // When
      await request('PUT', '/records/monthly', a.accessToken, save('K3-R40', 425, 2000));
      const rows = await request<Monthly>('GET', '/records/monthly?year=2026&month=3', a.accessToken);
      const row = rows.items.find(item => item.indicatorId === 'K3-R40');
      // Then: the stored basis is explicitly one month, not cumulative.
      assert.ok(row);
      assert.equal(Number(row.totalSasaran), 2000);
      assert.equal(row.nilaiKinerja, 25);
      assert.equal(row.measurementValue, 21.25);
      assert.ok('inputBasis' in row);
      assert.equal(row.inputBasis, 'PERIOD_ACTUAL');
      assert.equal(await db.annualTarget.count({ where: { healthCenterId: center.id } }), 0);
    });
    await t.test('fresh YTD creation is rejected without storing a monthly row', async () => {
      // Given / When: this indicator has no monthly observation yet.
      await request('PUT', '/records/monthly', a.accessToken, save('K5-R26', 250, 100, 3, 'YTD_ACTUAL'), 400);
      // Then
      assert.equal(await db.monthlyRecord.count({ where: { healthCenterId: center.id, indicatorId: 'K5-R26' } }), 0);
    });
    await t.test('conversion from monthly actual to unconfirmed YTD is rejected atomically', async () => {
      // Given
      const where = { healthCenterId: center.id, indicatorId: 'K3-R40', year: 2026, month: 3 };
      const before = await db.monthlyRecord.findFirstOrThrow({ where });
      // When
      await request('PUT', '/records/monthly', a.accessToken, save('K3-R40', 100, 1000, 3, 'YTD_ACTUAL'), 400);
      // Then
      assert.deepEqual(await db.monthlyRecord.findFirstOrThrow({ where }), before);
    });
    await t.test('legacy payload cannot silently replace a DO observation', async () => {
      // When / Then
      await request('PUT', '/records/monthly', a.accessToken, { year: 2026, month: 3, records: [{ indicatorId: 'K3-R40', pencapaianRiil: 99 }] }, 409);
    });
    await t.test('PIC and tenant authorization remain enforced', async () => {
      // When / Then
      await request('PUT', '/records/monthly', p.accessToken, save('K3-R40', 1, 100), 403);
      await request('GET', `/records/monthly?year=2026&month=3&healthCenterId=${legacy.id}`, a.accessToken, undefined, 403);
    });
    await t.test('invalid basis fails before persistence', async () => {
      // When / Then
      await request('PUT', '/records/monthly', a.accessToken, save('K5-R26', 250, 100, 3, 'MONTHLY_DELTA'), 400);
    });
    await t.test('fractional actual counts are rejected while estimated population precision is preserved', async () => {
      // Given / When / Then: save boundaries, not historical reads, enforce counts.
      for (const id of ['K3-R40', 'K5-R26', 'K5-R37']) {
        await request('PUT', '/records/monthly', a.accessToken, save(id, 0.5, 100), 400);
        await request('PUT', '/records/monthly', a.accessToken, save(id, 1, 10.5), 400);
      }
      await request('PUT', '/records/monthly', a.accessToken, save('K2-R42', 30, 1000.5));
      const rows = await request<Monthly>('GET', '/records/monthly?year=2026&month=3', a.accessToken);
      assert.equal(Number(rows.items.find(item => item.indicatorId === 'K2-R42')?.totalSasaran), 1000.5);
    });
    await t.test('historical cumulative endpoint remains readable without summing YTD', async () => {
      // Given: pre-existing YTD history in the isolated DB, not newly accepted input.
      await seedHistoricalYtd('K3-R40', 10, 1000, 1);
      await seedHistoricalYtd('K3-R40', 20, 1000, 2);
      const before = await seedHistoricalYtd('K3-R40', 425, 2000);
      // When
      const sheet = await request<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=1', a.accessToken);
      // Then
      assert.equal(sheet.indicators.find(item => item.indicatorId === 'K3-R40')?.pencapaianRiil, 425);
      assert.equal(sheet.kategoriPKP, null);
      assert.equal(sheet.isOfficial, false);
      assert.equal(sheet.reportingPolicy.operatingMode, 'INTERNAL_PHASED');
      assert.equal(sheet.reportingPolicy.canSubmit, false);
      assert.equal(sheet.classificationStatus, 'UNRESOLVED_CLASSIFICATION');
      assert.deepEqual(await db.monthlyRecord.findUniqueOrThrow({ where: { id: before.id } }), before);
    });
    await t.test('historical YTD editing is rejected without rewriting the historical row', async () => {
      // Given
      const where = { healthCenterId: center.id, indicatorId: 'K3-R40', year: 2026, month: 3 };
      const before = await db.monthlyRecord.findFirstOrThrow({ where });
      // When
      await request('PUT', '/records/monthly', a.accessToken, save('K3-R40', 1, 1000, 3, 'YTD_ACTUAL'), 409);
      // Then
      assert.deepEqual(await db.monthlyRecord.findFirstOrThrow({ where }), before);
    });
    await t.test('monthly payload cannot relabel historical YTD as one month', async () => {
      // Given
      const where = { healthCenterId: center.id, indicatorId: 'K3-R40', year: 2026, month: 3 };
      const before = await db.monthlyRecord.findFirstOrThrow({ where });
      // When
      await request('PUT', '/records/monthly', a.accessToken, save('K3-R40', 1, 1000), 409);
      // Then
      assert.deepEqual(await db.monthlyRecord.findFirstOrThrow({ where }), before);
    });
    await t.test('native units, rubric gaps and estimated D survive persistence', async () => {
      // Given: retained historical YTD observations, separate from today's write contract.
      for (const [id, n, d] of [['K5-R26', 250, 100], ['K3-R38', 90, 100], ['K2-R42', 30, 1000]] as const) await seedHistoricalYtd(id, n, d);
      // When
      const sheet = await request<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=1', a.accessToken);
      // Then
      const prescription = sheet.indicators.find(item => item.indicatorId === 'K5-R26');
      assert.equal(prescription?.measurementValue, 2.5);
      assert.equal(prescription?.capaianRiilPct, null);
      assert.equal(sheet.indicators.find(item => item.indicatorId === 'K3-R38')?.status, 'UNRESOLVED_RULE');
      assert.equal(sheet.indicators.find(item => item.indicatorId === 'K2-R42')?.effectiveDenominator, 45.5);
    });
    await t.test('monthly trend does not reuse cumulative YTD or invent an annual mean', async () => {
      // When
      const trend = await request<Awaited<ReturnType<AnalyticsService['annualTrend']>>>('GET', '/analytics/annual-trend?year=2026', a.accessToken);
      // Then
      assert.equal(trend.annualAveragePKP, null);
      assert.equal(trend.monthlyOverallScores[2], null);
    });
    await t.test('DO submission is blocked instead of becoming an official report', async () => {
      // When / Then
      await request('POST', '/workflow/submit', a.accessToken, { year: 2026, periodNumber: 1, isQuarter: true }, 409);
    });
    await t.test('new complete V1 reports cannot bypass the 2026 approval hold', async () => {
      // Given
      const catalogue = await db.indicator.findMany({ where: { isActive: true }, select: { id: true } });
      await request('PUT', '/targets/annual/2026/bulk', old.accessToken, { targets: catalogue.map(item => ({ indicatorId: item.id, targetPct: 100, totalSasaran: 12000, targetSasaran: 12000 })) });
      const records = catalogue.map(item => ({ indicatorId: item.id, pencapaianRiil: item.id === 'K3-R40' ? 212.5 : 0 }));
      for (const month of [1, 2, 3]) await request('PUT', '/records/monthly', old.accessToken, { year: 2026, month, records });
      // When
      await request('POST', '/workflow/submit', old.accessToken, { year: 2026, periodNumber: 1, isQuarter: true }, 409);
      // Then
      assert.equal(await db.periodLock.count({ where: { healthCenterId: legacy.id } }), 0);
      assert.equal(await db.annualTarget.count({ where: { healthCenterId: legacy.id, isLocked: true } }), 0);
    });
    await t.test('previously submitted V1 cannot be newly verified; existing verified history stays unchanged', async () => {
      // Given: import an existing schema-v1 snapshot fixture in the disposable DB.
      const frozen = {
        schemaVersion: 1, denominatorMode: 'ANNUAL_DIVIDED_BY_12',
        period: { healthCenterId: legacy.id, year: 2026, periodNumber: 1, isQuarter: true },
        healthCenter: legacy, sections: await db.section.findMany({ where: { isActive: true } }), indicators: await db.indicator.findMany({ where: { isActive: true, section: { isActive: true } } }),
        targets: await db.annualTarget.findMany({ where: { healthCenterId: legacy.id, year: 2026 } }),
        records: await db.monthlyRecord.findMany({ where: { healthCenterId: legacy.id, year: 2026, month: { lte: 3 } } }),
      };
      const snapshot: Prisma.InputJsonValue = JSON.parse(JSON.stringify(frozen));
      const submitted = await db.periodLock.create({ data: { healthCenterId: legacy.id, year: 2026, periodNumber: 1, isQuarter: true, status: 'SUBMITTED', revision: 1, snapshot } });
      // When / Then: guard rejects verification without changing the frozen fixture.
      await request('POST', '/workflow/verify', dk.accessToken, { healthCenterId: legacy.id, year: 2026, periodNumber: 1, isQuarter: true, expectedRevision: submitted.revision }, 409);
      assert.deepEqual((await db.periodLock.findUniqueOrThrow({ where: { id: submitted.id } })).snapshot, snapshot);
      // Simulate a previously verified historical fixture, not a new workflow approval.
      await db.periodLock.update({ where: { id: submitted.id }, data: { status: 'VERIFIED' } });
      const sheet = await request<Sheet>('GET', '/analytics/sheet7?year=2026&quarter=1', old.accessToken);
      // Then
      assert.equal(sheet.source, 'VERIFIED_SNAPSHOT');
      assert.equal(sheet.isOfficial, true);
      assert.equal(sheet.workflowVerified, true);
      assert.equal(sheet.reportingPolicy.canSubmit, false);
      assert.equal(sheet.reportingPolicy.operatingMode, 'INTERNAL_PHASED');
      assert.equal(sheet.policyConformity, 'NOT_ASSESSED');
      assert.equal(sheet.indicators.find(item => item.indicatorId === 'K3-R40')?.nilaiKinerja, 22.5);
      await request('PUT', '/records/monthly', old.accessToken, save('K3-R40', 1, 1000), 409);
      await request('POST', '/workflow/reopen', dk.accessToken, { healthCenterId: legacy.id, year: 2026, periodNumber: 1, isQuarter: true, expectedRevision: 1, reason: 'QA: historical revision remains available' }, 201);
      assert.deepEqual((await db.periodLock.findUniqueOrThrow({ where: { id: submitted.id } })).snapshot, snapshot);
    });
    await t.test('real queue exports native measurements to Excel and generates PDF', async () => {
      // Given: a separate recap differs from the existing monthly YTD value (2.5).
      await request('PUT', '/records/period-recaps', a.accessToken, { year: 2026, endMonth: 3, indicatorId: 'K5-R26', numerator: 310, denominator: 100, notes: 'Independent January–March prescription register, reconciled.', confirmed: true, expectedRevision: 0 });
      for (const format of ['excel', 'pdf']) {
        // When
        const queued = await request<{ jobId: string }>('POST', `/export/${format}/sheet7`, a.accessToken, { year: 2026, quarter: 1 }, 202);
        let download: string | undefined;
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          const job = await request<{ status: string; downloadUrl?: string }>('GET', `/export/jobs/${queued.jobId}`, a.accessToken);
          assert.notEqual(job.status, 'FAILED');
          if (job.status === 'COMPLETED') { download = job.downloadUrl; break; }
          await delay(250);
        }
        assert.ok(download);
        const response = await fetch(download, { signal: AbortSignal.timeout(10_000) });
        assert.equal(response.status, 200);
        const buffer = await response.arrayBuffer();
        const bytes = Buffer.from(buffer);
        // Then
        if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        else {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          const policy = workbook.getWorksheet('Policy');
          assert.ok(policy);
          assert.deepEqual([1, 2, 3, 4, 5].map(index => policy.getRow(2).getCell(index).value), ['INTERNAL_PHASED', 'PENDING_AUTHORITY', false, false, 'NOT_ASSESSED']);
          const rows = workbook.getWorksheet('Indicators');
          assert.ok(rows);
          let checked = false;
          rows.eachRow(row => {
            if (row.getCell(1).value !== 'K5-R26') return;
            assert.equal(row.getCell(6).value, null);
            assert.equal(row.getCell(9).value, 3.1);
            assert.equal(row.getCell(10).value, 'ITEMS_PER_PRESCRIPTION');
            assert.equal(row.getCell(22).value, 'ARITHMETIC_ONLY');
            assert.equal(row.getCell(23).value, false);
            assert.equal(row.getCell(24).value, 'NOT_VERIFIED');
            checked = true;
          });
          assert.ok(checked);
        }
      }
    });
  } finally { await app.close(); }
});
