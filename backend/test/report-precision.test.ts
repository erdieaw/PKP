import 'reflect-metadata';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { Polarity, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { DO_SCORING_VERSION } from '../src/analytics/do2026/scorer';
import { SCORING_VERSION } from '../src/analytics/scoring';
import type { DbService } from '../src/core/db.service';
import { ExportService } from '../src/integrations/export.service';
import { survey } from './annual-structured.fixtures';

const healthCenterId = '11111111-1111-4111-8111-111111111111';

function fixture() {
  const structuredInput = survey();
  structuredInput.semesters[0]!.value = 77.9999;
  structuredInput.semesters[1]!.value = 78;
  const indicators = ['K1-R39', 'K2-R51', 'LEGACY'].map(id => ({
    id, indikator: id, sectionCode: '1', klasterId: 1, targetNumeric: new Prisma.Decimal(100),
    polarity: Polarity.HIGHER_IS_BETTER, scoringVersion: SCORING_VERSION,
  }));
  const recaps = [
    { indicatorId: 'K1-R39', numerator: new Prisma.Decimal('155.9999'), denominator: new Prisma.Decimal(2), structuredInput },
    { indicatorId: 'K2-R51', numerator: new Prisma.Decimal(14), denominator: new Prisma.Decimal('100.1234') },
  ].map(row => ({ ...row, healthCenterId, year: 2026, endMonth: 12, revision: 1, notes: 'Confirmed full-year source register', confirmed: true, scoringVersion: DO_SCORING_VERSION }));
  const tx = {
    periodLock: { findUnique: async () => null },
    healthCenter: { findUnique: async () => ({ id: healthCenterId, code: 'QA', name: 'Precision QA' }) },
    section: { findMany: async () => [{ code: '1', name: 'Precision', parentCode: null, klasterId: 1, isActive: true }] },
    indicator: { findMany: async () => indicators },
    annualTarget: { findMany: async () => [{ indicatorId: 'LEGACY', totalSasaran: new Prisma.Decimal('200.1234'), targetSasaran: new Prisma.Decimal('200.1234'), targetPct: new Prisma.Decimal(100) }] },
    monthlyRecord: { findMany: async () => Array.from({ length: 12 }, (_, i) => ({
      indicatorId: 'LEGACY', healthCenterId, year: 2026, month: i + 1,
      pencapaianRiil: new Prisma.Decimal(i === 0 ? '155.9999' : 0), scoringVersion: SCORING_VERSION,
    })) },
    periodRecap: { findMany: async () => recaps },
  };
  const db = { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } as unknown as DbService;
  return { analytics: new AnalyticsService(db), structuredInput };
}

test('actual sheet7 preserves V2 survey boundary and raw denominator/percentage while V1 stays rounded to two places', async () => {
  const { analytics, structuredInput } = fixture();
  const report = await analytics.sheet7(healthCenterId, 2026, 'ANNUAL');
  const surveyRow = report.indicators.find(row => row.indicatorId === 'K1-R39')!;
  assert.deepEqual([surveyRow.pencapaianRiil, surveyRow.totalSasaran, surveyRow.measurementValue, surveyRow.targetMet], [155.9999, 2, 77.99995, false]);
  assert.deepEqual([surveyRow.capaianRiilPct, surveyRow.nilaiKinerja, surveyRow.targetSasaran], [null, null, null]);
  assert.ok('recapStructuredInput' in surveyRow);
  assert.deepEqual(surveyRow.recapStructuredInput, structuredInput);
  assert.deepEqual(JSON.parse(JSON.stringify(report)).indicators[0].recapStructuredInput, structuredInput);
  const coverage = report.indicators.find(row => row.indicatorId === 'K2-R51')!;
  assert.deepEqual([coverage.pencapaianRiil, coverage.totalSasaran, coverage.effectiveDenominator], [14, 100.1234, 100.1234]);
  assert.deepEqual([coverage.capaianRiilPct, coverage.measurementValue, coverage.targetMet], [13.98274529, 13.98274529, true]);
  const legacy = report.indicators.find(row => row.indicatorId === 'LEGACY')!;
  assert.equal(legacy.scoringVersion, SCORING_VERSION);
  assert.deepEqual([legacy.pencapaianRiil, legacy.totalSasaran, legacy.targetSasaran], [156, 200.12, 200.12]);
  assert.deepEqual([legacy.capaianRiilPct, legacy.nilaiKinerja], [77.95, 77.95]);
  const recap = await analytics.periodRecap(healthCenterId, 2026, 12);
  assert.deepEqual(recap.items.find(row => row.indicatorId === 'K1-R39')!.recapStructuredInput, structuredInput);
});

test('real in-memory XLSX and PDF exports retain survey precision and V1 formatting from actual sheet7', async () => {
  const { analytics } = fixture();
  const summary = await analytics.sheet7(healthCenterId, 2026, 'ANNUAL');
  // Render the real methods without constructing Redis, storage, or a database connection.
  const exporter = Object.create(ExportService.prototype) as ExportService;
  const xlsx: Buffer = await exporter['excel'](summary, '2026-11-01T00:00:00.000Z');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(xlsx).buffer);
  const sheet = workbook.getWorksheet('Indicators')!;
  const rows = new Map<string, ExcelJS.Row>();
  sheet.eachRow(row => rows.set(String(row.getCell(1).value), row));
  const surveyRow = rows.get('K1-R39')!;
  assert.deepEqual([3, 4, 6, 7, 9, 10, 16].map(column => surveyRow.getCell(column).value), [155.9999, 2, null, null, 77.99995, 'SCORE', false]);
  const coverage = rows.get('K2-R51')!;
  assert.deepEqual([3, 4, 6, 9, 15].map(column => coverage.getCell(column).value), [14, 100.1234, 13.98274529, 13.98274529, 100.1234]);
  const legacy = rows.get('LEGACY')!;
  assert.deepEqual([3, 4, 5, 6, 7].map(column => legacy.getCell(column).value), [156, 200.12, 200.12, 77.95, 77.95]);

  const pdf: Buffer = await exporter['pdf'](summary, '2026-11-01T00:00:00.000Z');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // PDFKit's compressed Helvetica content streams encode text as hex TJ fragments.
  const text = [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    const stream = inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
    return [...stream.matchAll(/<([0-9a-f]+)>/gi)].map(part => Buffer.from(part[1]!, 'hex').toString('latin1')).join('');
  }).join('');
  assert.match(text, /K1-R39: 77\.99995 SCORE; skor N\/A/);
  assert.match(text, /N: 155\.9999; D input: 2; D efektif: 2; target: belum tercapai/);
  assert.match(text, /K2-R51: 13\.98274529 PERCENT/);
  assert.match(text, /N: 14; D input: 100\.1234; D efektif: 100\.1234; target: tercapai/);
  assert.match(text, /N: 156; D input: 200\.12; D efektif: 200\.1234/);
});
