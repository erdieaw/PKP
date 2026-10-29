import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../src/core/auth.decorators';
import { PeriodRecapQuery, SavePeriodRecapDto } from '../src/recaps/recaps.dto';
import { RecapsController } from '../src/recaps/recaps.module';

const input = {
  year: 2026, endMonth: 3, indicatorId: 'K5-R26', numerator: 250, denominator: 100,
  notes: 'Unique prescription recap January through March, register verified', confirmed: true, expectedRevision: 0,
};

test('accepts a confirmed cumulative recap when all required fields are supplied', async () => {
  const dto = plainToInstance(SavePeriodRecapDto, input);
  const errors = await validate(dto);
  assert.deepEqual(errors, []);
});

const invalidInputs: readonly { readonly label: string; readonly field: string; readonly value: unknown }[] = [
  { label: 'historical year', field: 'year', value: 2025 },
  { label: 'fractional year', field: 'year', value: 2026.5 },
  { label: 'invalid end month', field: 'endMonth', value: 13 },
  { label: 'fractional end month', field: 'endMonth', value: 1.5 },
  { label: 'unconfirmed recap', field: 'confirmed', value: false },
  { label: 'string confirmation', field: 'confirmed', value: 'true' },
  { label: 'missing confirmation', field: 'confirmed', value: undefined },
  { label: 'blank attestation', field: 'notes', value: ' \t\n ' },
  { label: 'null attestation', field: 'notes', value: null },
  { label: 'missing attestation', field: 'notes', value: undefined },
  { label: 'negative numerator', field: 'numerator', value: -1 },
  { label: 'negative denominator', field: 'denominator', value: -1 },
  { label: 'excess numerator precision', field: 'numerator', value: 1.12345 },
  { label: 'excess denominator precision', field: 'denominator', value: 1.12345 },
  { label: 'overflow numerator', field: 'numerator', value: 10000000000 },
  { label: 'overflow denominator', field: 'denominator', value: 10000000000 },
  { label: 'string numerator', field: 'numerator', value: '250' },
  { label: 'null denominator', field: 'denominator', value: null },
  { label: 'missing revision', field: 'expectedRevision', value: undefined },
  { label: 'negative revision', field: 'expectedRevision', value: -1 },
  { label: 'fractional revision', field: 'expectedRevision', value: 1.5 },
];

for (const scenario of invalidInputs) {
  test(`rejects recap input when it contains ${scenario.label}`, async () => {
    const dto = plainToInstance(SavePeriodRecapDto, { ...input, [scenario.field]: scenario.value });
    const errors = await validate(dto);
    assert.ok(errors.some(error => error.property === scenario.field));
  });
}

test('accepts zero denominator when it represents an unavailable result', async () => {
  const dto = plainToInstance(SavePeriodRecapDto, { ...input, denominator: 0 });
  const errors = await validate(dto);
  assert.deepEqual(errors, []);
});

test('accepts four-place decimals when storage precision can preserve them', async () => {
  const dto = plainToInstance(SavePeriodRecapDto, { ...input, numerator: 1.2345, denominator: 2.3456 });
  const errors = await validate(dto);
  assert.deepEqual(errors, []);
});

test('transforms query year and end month when passed as URL values', async () => {
  const dto = plainToInstance(PeriodRecapQuery, { year: '2026', endMonth: '3' });
  const errors = await validate(dto);
  assert.deepEqual(errors, []);
  assert.equal(dto.year, 2026);
  assert.equal(dto.endMonth, 3);
});

test('restricts writes to tenant admin and PIC when controller authorization is applied', () => {
  const handler = RecapsController.prototype.save;
  const roles: unknown = Reflect.getMetadata(ROLES_KEY, handler);
  assert.deepEqual(roles, [Role.ADMIN_PUSKESMAS, Role.PIC]);
});
