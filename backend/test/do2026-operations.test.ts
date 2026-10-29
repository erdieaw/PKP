import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MonthlyRecordDto } from '../src/operations/operations.dto';
import { containsDoSnapshot, guardDoSubmission, guardLegacyOverwrite, scoreMonthlyInput } from '../src/operations/monthly-scoring';

const indicator = { id: 'K3-R40', polarity: 'TIERED_BRACKETS', targetNumeric: new Prisma.Decimal(1), scoringVersion: 'ILP_2026_V1' } as const;
const annual = { totalSasaran: new Prisma.Decimal(12000), targetSasaran: new Prisma.Decimal(12000), targetPct: new Prisma.Decimal(100) };
const actual = { indicatorId: indicator.id, pencapaianRiil: 425, totalSasaran: 2000, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL' } as const satisfies MonthlyRecordDto;

test('persists actual denominator and corrected DO score when no annual target exists', () => {
  const result = scoreMonthlyInput(indicator, actual, 2026);
  assert.equal(result.totalSasaran.toNumber(), 2000);
  assert.equal(result.targetSasaran.toNumber(), 0);
  assert.equal(result.nilaiKinerja, 25);
  assert.equal(result.capaianRiilPct, 21.25);
  assert.equal(result.scoringVersion, 'DO_2026_V2');
  assert.equal(result.inputBasis, 'PERIOD_ACTUAL');
});

test('preserves legacy prorata and historical bracket when version is omitted', () => {
  const result = scoreMonthlyInput(indicator, { indicatorId: indicator.id, pencapaianRiil: 212.5 }, 2026, annual);
  assert.equal(result.totalSasaran.toNumber(), 1000);
  assert.equal(result.targetSasaran.toNumber(), 1000);
  assert.equal(result.nilaiKinerja, 22.5);
  assert.equal(result.scoringVersion, 'ILP_2026_V1');
  assert.equal(result.inputBasis, 'MONTHLY_DELTA');
});

test('rejects legacy data without an explicit annual target', () => {
  assert.throws(() => scoreMonthlyInput(indicator, { indicatorId: indicator.id, pencapaianRiil: 1 }, 2026), ConflictException);
});

test('rejects cumulative input at the monthly write boundary', () => {
  // Given: a valid cumulative count must use the separately confirmed recap route.
  const cumulative = { ...actual, inputBasis: 'YTD_ACTUAL' } as const;
  // When / Then
  assert.throws(() => scoreMonthlyInput(indicator, cumulative, 2026), (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(Reflect.get(Object(error.getResponse()), 'code'), 'SEPARATE_RECAP_REQUIRED');
    return true;
  });
});

for (const [name, record, year] of [
  ['missing basis', { ...actual, inputBasis: undefined }, 2026],
  ['missing denominator', { ...actual, totalSasaran: undefined }, 2026],
  ['pre-2026', actual, 2025],
  ['legacy actual data', { ...actual, scoringVersion: 'ILP_2026_V1' }, 2026],
] satisfies readonly [string, MonthlyRecordDto, number][]) {
  test(`rejects ${name} before persistence`, () => {
    assert.throws(() => scoreMonthlyInput(indicator, record, year, annual), BadRequestException);
  });
}

for (const patch of [{ totalSasaran: null }, { totalSasaran: -1 }, { totalSasaran: Infinity }, { totalSasaran: '100' }, { scoringVersion: 'OTHER' }, { inputBasis: 'MONTHLY_DELTA' }]) {
  test(`DTO rejects unsupported input ${JSON.stringify(patch)}`, () => {
    const dto = plainToInstance(MonthlyRecordDto, { ...actual, ...patch });
    assert.ok(validateSync(dto).length > 0);
  });
}

test('stores unknown-source measurement without inventing a score', () => {
  const result = scoreMonthlyInput({ ...indicator, id: 'UNKNOWN' }, { ...actual, indicatorId: 'UNKNOWN' }, 2026);
  assert.equal(result.nilaiKinerja, null);
  assert.equal(result.scoringVersion, 'DO_2026_V2');
});

test('stores prescription mean without a percent label', () => {
  const result = scoreMonthlyInput({ ...indicator, id: 'K5-R26' }, { ...actual, indicatorId: 'K5-R26', pencapaianRiil: 250, totalSasaran: 100 }, 2026);
  assert.equal(result.capaianRiilPct, null);
  assert.equal(result.nilaiKinerja, 100);
});

for (const id of ['K3-R40', 'K2-R51', 'K5-R26', 'K5-R37', 'K2-R42']) {
  test(`${id} rejects fractional actual counts before persistence`, () => {
    // Given / When / Then: numerator is a count, even for an estimated denominator.
    assert.throws(() => scoreMonthlyInput({ ...indicator, id }, { ...actual, indicatorId: id, pencapaianRiil: 0.5 }, 2026), BadRequestException);
  });
}

for (const id of ['K3-R40', 'K5-R26', 'K5-R37']) {
  test(`${id} rejects a fractional actual denominator before persistence`, () => {
    // Given / When / Then
    assert.throws(() => scoreMonthlyInput({ ...indicator, id }, { ...actual, indicatorId: id, pencapaianRiil: 1, totalSasaran: 10.5 }, 2026), BadRequestException);
  });
}

test('estimated source population may retain decimals and applies its factor once', () => {
  // Given / When
  const result = scoreMonthlyInput({ ...indicator, id: 'K2-R42' }, { ...actual, indicatorId: 'K2-R42', pencapaianRiil: 30, totalSasaran: 1000.5 }, 2026);
  // Then
  assert.equal(result.totalSasaran.toNumber(), 1000.5);
  assert.equal(result.capaianRiilPct, 65.90111538);
});

test('stores zero actual denominator without inventing achievement', () => {
  const result = scoreMonthlyInput(indicator, { ...actual, totalSasaran: 0 }, 2026);
  assert.equal(result.totalSasaran.toNumber(), 0);
  assert.equal(result.capaianRiilPct, null);
  assert.equal(result.nilaiKinerja, null);
});

test('rejects legacy overwrite of an existing DO observation', () => {
  assert.throws(() => guardLegacyOverwrite([{ scoringVersion: 'DO_2026_V2' }]), ConflictException);
});

test('permits legacy overwrite when no DO observation exists', () => {
  assert.equal(guardLegacyOverwrite([{ scoringVersion: 'ILP_2026_V1' }]), undefined);
});

test('leaves legacy submission guard unchanged', () => {
  assert.equal(guardDoSubmission([{ id: indicator.id }], [{ ...actual, totalSasaran: 1000, month: 1, scoringVersion: 'ILP_2026_V1' }], [1]), undefined);
});

test('blocks DO submission and evaluates all catalogue entries despite stored scores', () => {
  const records = [{ ...actual, totalSasaran: 1000, month: 1, nilaiKinerja: 100 }];
  assert.throws(() => guardDoSubmission([{ id: indicator.id }, { id: 'UNKNOWN' }], records, [1]), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    const response = error.getResponse();
    assert.equal(typeof response, 'object');
    assert.ok('code' in Object(response));
    assert.equal(Reflect.get(Object(response), 'code'), 'DO_POLICY_UNRESOLVED');
    const evaluations: unknown = Reflect.get(Object(response), 'evaluations');
    assert.ok(Array.isArray(evaluations));
    assert.equal(evaluations.length, 2);
    return true;
  });
});

test('identifies immutable DO records in snapshots without changing V1 snapshots', () => {
  assert.equal(containsDoSnapshot({ schemaVersion: 1, records: [{ scoringVersion: 'DO_2026_V2' }] }), true);
  assert.equal(containsDoSnapshot({ schemaVersion: 1, records: [{ scoringVersion: 'ILP_2026_V1' }] }), false);
});

test('rejects a mixed-version covered period independently of stored score values', () => {
  const records = [
    { ...actual, totalSasaran: 1000, month: 1 },
    { ...actual, totalSasaran: 1000, month: 2, scoringVersion: 'ILP_2026_V1' },
  ];
  assert.throws(() => guardDoSubmission([{ id: indicator.id }], records, [1, 2, 3]), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    const evaluations: unknown = Reflect.get(Object(error.getResponse()), 'evaluations');
    assert.ok(Array.isArray(evaluations));
    assert.equal(evaluations[0].status, 'MIXED_SCORING_VERSIONS');
    assert.equal(evaluations[0].isComplete, false);
    return true;
  });
});
