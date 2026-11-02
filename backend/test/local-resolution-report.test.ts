import 'reflect-metadata';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { Polarity, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AnalyticsService } from '../src/analytics/analytics.service';
import type { DbService } from '../src/core/db.service';
import { ExportService } from '../src/integrations/export.service';
import { evaluateLocalFixture, localResolutionFixture, localResolutionIds } from './local-resolution.fixtures';

const healthCenterId = '11111111-1111-4111-8111-111111111111';

test('all 28 local results survive analytics JSON and exports with explicit scope, components and no invented score', async () => {
  const inputs = localResolutionIds.map(indicatorId => ({ indicatorId, input: localResolutionFixture(indicatorId) }));
  inputs.find(row => row.indicatorId === 'K1-R71')!.input.localResolution.targetPolicy = { metricKey: 'revenue', value: 100, reference: 'QA explicit revenue target' };
  const recaps = inputs.map(({ indicatorId, input }) => {
    const result = evaluateLocalFixture(indicatorId, input);
    return { healthCenterId, indicatorId, year: 2026, endMonth: Number(input.period.cutoffDate.slice(5, 7)),
      numerator: new Prisma.Decimal(result.numerator), denominator: new Prisma.Decimal(result.denominator), structuredInput: input,
      confirmed: true, revision: 1, notes: 'QA accepted local policy', scoringVersion: 'DO_2026_V2' };
  });
  const tx = {
    periodLock: { findUnique: async () => null },
    healthCenter: { findUnique: async () => ({ id: healthCenterId, code: 'QA', name: 'Local resolution QA' }) },
    section: { findMany: async () => [{ code: '1', name: 'Local QA', parentCode: null, klasterId: 1, isActive: true }] },
    indicator: { findMany: async () => localResolutionIds.map(id => ({ id, indikator: id, sectionCode: '1', klasterId: 1,
      targetNumeric: new Prisma.Decimal(100), polarity: Polarity.HIGHER_IS_BETTER, scoringVersion: 'ILP_2026_V1' })) },
    annualTarget: { findMany: async () => [] }, monthlyRecord: { findMany: async () => [] },
    periodRecap: { findMany: async ({ where }: any) => recaps.filter(row => typeof where.endMonth === 'number' ? row.endMonth === where.endMonth : row.endMonth <= where.endMonth.lte) },
  };
  const db = { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } as unknown as DbService;
  const analytics = new AnalyticsService(db);
  for (const endMonth of [8, 12]) {
    const view = JSON.parse(JSON.stringify(await analytics.periodRecap(healthCenterId, 2026, endMonth)));
    for (const recap of recaps.filter(row => row.endMonth === endMonth)) {
      const result = view.items.find((row: any) => row.indicatorId === recap.indicatorId);
      assert.deepEqual(result.recapStructuredInput, recap.structuredInput);
      assert.ok(result.localResolutionResult.metrics.every((row: any) => row.status === 'MEASURED'));
      assert.equal(result.nilaiKinerja, null); assert.equal(result.assessmentComplete, false);
    }
  }
  const summary = await analytics.sheet7(healthCenterId, 2026, 'ANNUAL');
  assert.equal(summary.isOfficial, false); assert.equal(summary.nilaiKinerjaPuskesmas, null);
  for (const id of ['K4-R29', 'K5-R27']) {
    const result = summary.indicators.find(row => row.indicatorId === id)!;
    assert.equal(result.measurementValue, null); assert.equal(result.status, 'ASSESSMENT_SCOPE_MISMATCH');
    assert.ok('localResolutionResult' in result && result.localResolutionResult?.metrics.every(row => row.value === null && row.targetMet === null));
  }
  const exporter = Object.create(ExportService.prototype) as ExportService;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(await exporter['excel'](summary, '2026-11-02T00:00:00Z')).buffer);
  const local = workbook.getWorksheet('Local Resolutions')!;
  const rows: ExcelJS.Row[] = []; local.eachRow((row, index) => { if (index > 1) rows.push(row); });
  const revenue = rows.find(row => row.getCell(1).value === 'K1-R71' && row.getCell(7).value === 'revenue')!;
  assert.deepEqual([10, 16, 17, 18, 21].map(column => revenue.getCell(column).value), [10, 100, false, 'USER_ACCEPTED_LOCAL_POLICY_NOT_SOURCE_APPROVAL', false]);
  for (const row of rows.filter(row => row.getCell(1).value === 'K5-R27')) {
    assert.equal(row.getCell(10).value, null); assert.equal(row.getCell(12).value, 'ASSESSMENT_SCOPE_MISMATCH');
  }
  const mfk = rows.find(row => row.getCell(1).value === 'K1-R53' && row.getCell(7).value === 'coveredGroups')!;
  assert.equal(mfk.getCell(10).value, 7);
  const pdf = await exporter['pdf'](summary, '2026-11-02T00:00:00Z');
  const text = [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    const stream = inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
    return [...stream.matchAll(/<([0-9a-f]+)>/gi)].map(part => Buffer.from(part[1]!, 'hex').toString('latin1')).join('');
  }).join('');
  assert.match(text, /PROVISIONAL_USER_ACCEPTED_LOCAL_RESOLUTION/);
  assert.match(text, /coveredGroups: 7 COUNT/);
  assert.match(text, /allThree: N\/A PERCENT; ASSESSMENT_SCOPE_MISMATCH/);
  assert.match(text, /USER_ACCEPTED_LOCAL_POLICY_NOT_SOURCE_APPROVAL/);
  assert.match(text, /Ketepatan waktu: NOT_ASSESSED/);
});
