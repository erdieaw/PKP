import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateDoCumulative } from '../src/analytics/do2026/cumulative';
import { DO_SCORING_VERSION } from '../src/analytics/do2026/scorer';
import { scoreDo2026 } from '../src/analytics/do2026/scorer';
import { evaluateDoPeriod } from '../src/analytics/do2026/period';

const row = (month: number, n: number, d: number) => ({ month, pencapaianRiil: n, totalSasaran: d, inputBasis: 'PERIOD_ACTUAL', scoringVersion: DO_SCORING_VERSION });
const months = [1, 2];

test('one KB month can produce an arithmetic score but never a complete annual assessment', () => {
  // Given / When
  const result = evaluateDoPeriod('K3-R40', [row(3, 425, 2000)], [3]);
  // Then: retain the arithmetic compatibility field, explicitly separate assessment.
  assert.equal(result.nilaiKinerja, 25);
  assert.equal(result.isComplete, true);
  assert.equal(result.assessmentComplete, false);
  assert.equal(result.completionScope, 'ARITHMETIC_ONLY');
  assert.equal(result.observationStatus, 'NOT_VERIFIED');
});

test('decimal scoring does not round a source gap into the 2.6 boundary', () => {
  // Given
  const input = { numerator: '2.6000000000000001', denominator: '1' };
  // When
  const result = scoreDo2026('K5-R26', input);
  // Then
  assert.equal(result.nilaiKinerja, null);
});

test('QC complete months do not prove sampling and workday compatibility', () => {
  // Given
  const records = [row(1, 80, 100), row(2, 9, 10)];
  // When
  const result = evaluateDoCumulative('K5-R37', { records, months });
  // Then
  assert.deepEqual([result.numerator, result.denominator, result.status, result.dataComplete], [null, null, 'COMPATIBILITY_UNVERIFIED', false]);
});

test('confirmed recipe recap uses reconciled item counts once, not mean monthly ratios', () => {
  // Given
  const records = [row(1, 10, 5), row(2, 90, 30)];
  const recap = { numerator: 100, denominator: 35, endMonth: 2, revision: 1, notes: 'Sampel resep dan periode telah direkonsiliasi', confirmed: true, scoringVersion: DO_SCORING_VERSION };
  // When
  const result = evaluateDoCumulative('K5-R26', { records, months, recap });
  // Then
  assert.deepEqual([result.numerator, result.denominator, result.measurementValue, result.nilaiKinerja], [100, 35, 2.85714286, 75]);
});

test('twelve real observations alone do not prove compatibility for annual aggregation', () => {
  // Given
  const records = Array.from({ length: 12 }, (_, i) => row(i + 1, 1, 10));
  // When
  const result = evaluateDoCumulative('K5-R23', { records, months: records.map(record => record.month) });
  // Then
  assert.deepEqual([result.numerator, result.denominator, result.nilaiKinerja, result.missingMonths, result.status], [null, null, null, [], 'COMPATIBILITY_UNVERIFIED']);
});

test('missing months stay missing and do not produce a partial cumulative score', () => {
  // Given
  const records = [row(1, 0, 10)];
  // When
  const result = evaluateDoCumulative('K5-R23', { records, months });
  // Then
  assert.deepEqual([result.status, result.measurementValue, result.missingMonths, result.availableMonths, result.dataComplete], ['MISSING_DATA', null, [2], [1], false]);
});

test('zero denominator in a covered month cannot disappear into a positive total', () => {
  // Given
  const records = [row(1, 0, 0), row(2, 0, 10)];
  // When
  const result = evaluateDoCumulative('K5-R23', { records, months });
  // Then
  assert.deepEqual([result.status, result.measurementValue, result.dataComplete], ['ZERO_DENOMINATOR', null, false]);
});

for (const id of ['K2-R51', 'K3-R41', 'K5-R35', 'K2-R42']) {
  test(`${id} never sums repeated persons, checklists or population estimates`, () => {
    // Given
    const records = [row(1, 1, 100), row(2, 2, 100)];
    // When
    const result = evaluateDoCumulative(id, { records, months });
    // Then
    assert.deepEqual([result.status, result.measurementValue], ['MISSING_PERIOD_BASIS', null]);
  });
}

test('separate confirmed recap supersedes but never adds to historical monthly values', () => {
  // Given
  const records = [{ ...row(1, 100, 100), scoringVersion: 'ILP_2026_V1' }, row(2, 10, 100)];
  const recap = { numerator: 5, denominator: 100, endMonth: 2, confirmed: true, revision: 3, notes: 'Register unik Januari–Februari', scoringVersion: DO_SCORING_VERSION };
  // When
  const result = evaluateDoCumulative('K2-R51', { records, months, recap });
  // Then
  assert.deepEqual([result.numerator, result.denominator, result.nilaiKinerja, result.aggregationMethod, result.recapRevision, result.dataComplete], [5, 100, 100, 'EXPLICIT_YTD_RECAP', 3, true]);
  assert.equal(records[0]?.pencapaianRiil, 100);
  assert.deepEqual(result.requiredMissingMonths, []);
});

test('mixed monthly scoring versions cannot be pooled automatically', () => {
  // Given
  const records = [row(1, 0, 100), { ...row(2, 0, 100), scoringVersion: 'ILP_2026_V1' }];
  // When
  const result = evaluateDoCumulative('K5-R23', { records, months });
  // Then
  assert.equal(result.status, 'MIXED_SCORING_VERSIONS');
});

test('legacy YTD endpoint stays a single cumulative observation', () => {
  // Given
  const records = [row(1, 5, 100), { ...row(2, 10, 100), inputBasis: 'YTD_ACTUAL' }];
  // When
  const result = evaluateDoCumulative('K5-R23', { records, months });
  // Then
  assert.deepEqual([result.numerator, result.denominator, result.aggregationMethod], [10, 100, 'LEGACY_EXPLICIT_YTD']);
});
