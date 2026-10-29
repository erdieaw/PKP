import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Polarity } from '@prisma/client';
import { scoreDo2026, DO_SCORING_VERSION } from '../src/analytics/do2026/scorer';
import { evaluateDoPeriod } from '../src/analytics/do2026/period';
import { getDoProfile } from '../src/analytics/do2026/profiles';
import { calculateScore, SCORING_VERSION } from '../src/analytics/scoring';

for (const [value, expected] of [[14.9, 100], [15, 75], [17.5, 75], [20, 50], [21.25, 25], [22.5, 25], [22.5001, 0]] as const) {
  test(`DO dropout scores ${value} without reinterpreting V1`, () => {
    // Given: the source-defined percentage, with the OLD catalogue identity.
    const input = { numerator: value, denominator: 100 };
    // When
    const result = scoreDo2026('K3-R40', input);
    // Then
    assert.equal(result.nilaiKinerja, expected);
  });
}

for (const [id, boundary] of [['K2-R50', 15.04], ['K2-R51', 14], ['K2-R52', 8]] as const) {
  for (const [offset, expected] of [[0, 100], [0.0001, 0]] as const) {
    test(`${id} compares unrounded prevalence at ${boundary}+${offset}`, () => {
      // Given
      const input = { numerator: boundary + offset, denominator: 100 };
      // When
      const result = scoreDo2026(id, input);
      // Then
      assert.equal(result.nilaiKinerja, expected);
    });
  }
}

test('item/resep preserves its native unit and does not expose a percentage', () => {
  // Given
  const input = { numerator: 250, denominator: 100 };
  // When
  const result = scoreDo2026('K5-R26', input);
  // Then
  assert.deepEqual([result.measurementValue, result.measurementUnit, result.capaianRiilPct, result.nilaiKinerja], [2.5, 'ITEMS_PER_PRESCRIPTION', null, 100]);
});

for (const [id, value] of [['K3-R38', 90], ['K3-R38', 70.5], ['K5-R23', 20.5], ['K5-R24', 8.5], ['K5-R25', 1.5], ['K5-R26', 2.65], ['K5-R26', 4.5], ['K5-R26', 7.5]] as const) {
  test(`${id} refuses ambiguous literal rubric at ${value}`, () => {
    // Given
    const input = { numerator: value, denominator: id === 'K5-R26' ? 1 : 100 };
    // When
    const result = scoreDo2026(id, input);
    // Then
    assert.equal(result.status, 'UNRESOLVED_RULE');
    assert.equal(result.nilaiKinerja, null);
  });
}

test('CPR uses the explicit nonmonotonic interval rather than higher-is-better', () => {
  // Given
  const input = { numerator: 80, denominator: 100 };
  // When
  const result = scoreDo2026('K3-R38', input);
  // Then
  assert.equal(result.nilaiKinerja, 80);
});

test('smoking reports attainment without inventing numeric scores', () => {
  // Given
  const input = { numerator: 11.4, denominator: 100 };
  // When
  const result = scoreDo2026('K2-R75', input);
  // Then
  assert.equal(result.targetMet, true);
  assert.equal(result.nilaiKinerja, null);
});

test('zero denominator remains unavailable, not a verified no-case exception', () => {
  // Given
  const input = { numerator: 0, denominator: 0 };
  // When
  const result = scoreDo2026('K2-R51', input);
  // Then
  assert.equal(result.status, 'ZERO_DENOMINATOR');
  assert.equal(result.nilaiKinerja, null);
});

test('zero numerator with a real population is valid', () => {
  // Given
  const input = { numerator: 0, denominator: 100 };
  // When
  const result = scoreDo2026('K2-R51', input);
  // Then
  assert.equal(result.nilaiKinerja, 100);
  assert.equal(result.measurementValue, 0);
});

test('unknown rules never fall back to universal coverage', () => {
  // Given
  const input = { numerator: 1, denominator: 1 };
  // When
  const result = scoreDo2026('UNKNOWN', input);
  // Then
  assert.equal(result.status, 'UNRESOLVED_RULE');
});

const record = (month: number, n: number, d: number, basis = 'YTD_ACTUAL') => ({ month, pencapaianRiil: n, totalSasaran: d, scoringVersion: DO_SCORING_VERSION, inputBasis: basis });

test('YTD takes the matching cumulative endpoint, never sums monthly cumulative observations', () => {
  // Given
  const records = [record(1, 10, 100), record(2, 20, 100), record(3, 30, 100)];
  // When
  const result = evaluateDoPeriod('K3-R40', records, [1, 2, 3]);
  // Then
  assert.equal(result.pencapaianRiil, 30);
  assert.equal(result.totalSasaran, 100);
  assert.equal(result.measurementValue, 30);
});

test('monthly-only data cannot masquerade as cumulative unique persons', () => {
  // Given
  const records = [record(1, 10, 100, 'PERIOD_ACTUAL'), record(2, 20, 100, 'PERIOD_ACTUAL'), record(3, 30, 100, 'PERIOD_ACTUAL')];
  // When
  const result = evaluateDoPeriod('K3-R40', records, [1, 2, 3]);
  // Then
  assert.equal(result.status, 'MISSING_PERIOD_BASIS');
  assert.equal(result.nilaiKinerja, null);
});

test('YTD observations do not appear as monthly scores after January', () => {
  // Given
  const records = [record(2, 20, 100)];
  // When
  const result = evaluateDoPeriod('K3-R40', records, [2]);
  // Then
  assert.equal(result.status, 'MISSING_PERIOD_BASIS');
});

test('mixing scoring versions is rejected instead of blending definitions', () => {
  // Given
  const records = [record(1, 10, 100), { ...record(3, 20, 100), scoringVersion: SCORING_VERSION }];
  // When
  const result = evaluateDoPeriod('K3-R40', records, [1, 2, 3]);
  // Then
  assert.equal(result.status, 'MIXED_SCORING_VERSIONS');
});

test('historical V1 dropout preserves its original result after adding DO scoring', () => {
  // Given
  const indicator = { id: 'K3-R40', polarity: Polarity.TIERED_BRACKETS, targetNumeric: 0.15, scoringVersion: SCORING_VERSION };
  // When
  const result = calculateScore(indicator, 21.25, 100, 100);
  // Then
  assert.equal(result.nilaiKinerja, 22.5);
});

test('source identity and target unit survive catalogue mapping', () => {
  // Given: DO row 39 is NOT old API K3-R39.
  const id = 'K3-R40';
  // When
  const profile = getDoProfile(id);
  // Then
  assert.equal(profile?.definitionId, 'DO26-K3-R39');
  assert.equal(profile?.sourceRef, 'S1:KLASTER 3!A39:I39');
});
