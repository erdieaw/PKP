import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { scoreDo2026 } from '../src/analytics/do2026/scorer';
import source from '../src/analytics/do2026/source.json';

for (const [value, score] of [[3.4999, 100], [3.5, 75], [4.5, 75], [7.5, 50], [10, 25], [10.0001, 0]] as const) {
  test(`complication literal band scores ${value} without rounding`, () => {
    // Given
    const input = { numerator: value, denominator: 100 };
    // When
    const result = scoreDo2026('K3-R41', input);
    // Then
    assert.equal(result.nilaiKinerja, score);
  });
}

for (const [id, n, d, effective, measured] of [['K2-R15', 30, 1000, 200, 15], ['K2-R25', 30, 800, 120, 25], ['K2-R42', 30, 1000, 45.5, 65.93406593]] as const) {
  test(`${id} derives its own denominator but does not invent target normalization`, () => {
    // Given
    const input = { numerator: n, denominator: d };
    // When
    const result = scoreDo2026(id, input);
    // Then
    assert.equal(result.effectiveDenominator, effective);
    assert.equal(result.measurementValue, measured);
    assert.equal(result.nilaiKinerja, null);
  });
}

test('checklist measures two required documents rather than binary existence', () => {
  // Given
  const input = { numerator: 1, denominator: 2 };
  // When
  const result = scoreDo2026('K5-R19', input);
  // Then
  assert.equal(result.measurementValue, 50);
  assert.equal(result.targetMet, false);
  assert.equal(result.nilaiKinerja, null);
});

for (const input of [{ numerator: 1, denominator: 3 }, { numerator: 1.5, denominator: 2 }, { numerator: 3, denominator: 2 }]) {
  test(`checklist rejects invalid components ${JSON.stringify(input)}`, () => {
    // Given: a two-document checklist.
    // When / Then
    assert.throws(() => scoreDo2026('K5-R19', input), BadRequestException);
  });
}

for (const value of [-1, Infinity, NaN]) {
  test(`actual ratio rejects invalid input ${value}`, () => {
    // Given
    const input = { numerator: value, denominator: 100 };
    // When / Then
    assert.throws(() => scoreDo2026('K2-R51', input), BadRequestException);
  });
}

test('minimum count has no implicit percent conversion or numeric score', () => {
  // Given
  const input = { numerator: 3, denominator: 1 };
  // When
  const result = scoreDo2026('K1-R85', input);
  // Then
  assert.equal(result.measurementValue, 3);
  assert.equal(result.measurementUnit, 'COUNT');
  assert.equal(result.targetMet, true);
  assert.equal(result.nilaiKinerja, null);
});

test('runtime source metadata exactly reproduces all mapped knowledge records', async () => {
  // Given
  const root = join(process.cwd(), '..', 'docs', 'pkp-2026');
  const shards = (await readdir(root)).filter(name => name.includes('-bagian-') && name.endsWith('.md'));
  const records = [];
  for (const name of shards.sort()) {
    const markdown = await readFile(join(root, name), 'utf8');
    for (const match of markdown.matchAll(/```json\s+([\s\S]*?)\s+```/g)) {
      assert.ok(match[1]);
      const row = JSON.parse(match[1]);
      records.push({ indicatorId: row.catalogue_candidate, definitionId: row.id, sourceRef: `S1:${row.source.sheet}!${row.source.range}`, definition: row.definisi_operasional_raw, calculation: row.cara_penghitungan_raw, notes: row.keterangan_raw, target: row.target, formulaFamily: row.review.formula_family });
    }
  }
  // When: compare the machine-readable runtime source with the maintained MD source.
  const sort = (a: { indicatorId: string }, b: { indicatorId: string }) => a.indicatorId.localeCompare(b.indicatorId);
  // Then
  assert.equal(records.length, 272);
  assert.deepEqual([...source].sort(sort), records.sort(sort));
});
