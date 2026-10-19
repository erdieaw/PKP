import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Polarity, Prisma, Role } from '@prisma/client';
import { Actor } from '../core/auth.decorators';
import { DbService } from '../core/db.service';
import { CreateIndicatorDto, CreateSectionDto, UpdateIndicatorDto, UpdateSectionDto } from './masters.dto';
import { MastersService } from './masters.service';

const actor: Actor = { id: 'admin', name: 'Admin', role: Role.ADMIN_PUSKESMAS, healthCenterId: 'tenant', sessionId: 'session', tokenVersion: 0 };
const payload = {
  id: 'CUSTOM-1_a.b', klasterId: 1, sectionCode: '1.1', no: '1', kegiatan: 'Activity', indikator: 'Indicator', satuan: '%',
  targetDisplay: '100%', targetNumeric: 1, totalSasaranDefault: 100, targetSasaranDefault: 100, polarity: Polarity.HIGHER_IS_BETTER,
};
const previous = { ...payload, targetNumeric: new Prisma.Decimal(1), totalSasaranDefault: new Prisma.Decimal(100), targetSasaranDefault: new Prisma.Decimal(100), isActive: true, scoringVersion: 'ILP_2026_V1', updatedAt: new Date('2026-01-01T00:00:00.000Z') };

function fixture() {
  const logs: unknown[] = [];
  const locks: string[] = [];
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => { locks.push(sql.join('')); return []; },
    indicator: {
      findUnique: async (): Promise<Omit<typeof previous, 'polarity'> & { polarity: Polarity }> => previous,
      findFirst: async (): Promise<{ id: string } | null> => null,
      create: async ({ data }: { data: object }) => data,
      update: async ({ data }: { data: object }) => ({ ...previous, ...data }),
    },
    section: {
      findUnique: async () => ({ code: '1.1', klasterId: 1, isActive: true, parentCode: null, name: 'Section', order: 0 }),
      findFirst: async (): Promise<{ code: string } | null> => null,
      create: async ({ data }: { data: object }) => data,
      update: async ({ data }: { data: object }) => data,
    },
    monthlyRecord: { findFirst: async (): Promise<{ id: string } | null> => null },
    auditLog: { create: async ({ data }: { data: object }) => { logs.push(data); return data; } },
  };
  const db = { $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx) } as unknown as DbService;
  return { service: new MastersService(db), tx, logs, locks };
}

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
const validate = (metatype: typeof CreateIndicatorDto | typeof UpdateIndicatorDto | typeof CreateSectionDto | typeof UpdateSectionDto, value: object) => pipe.transform(value, { type: 'body', metatype });

test('indicator DTO accepts natural keys, trims metadata and rejects invalid precision/null/owned fields', async () => {
  const dto = await validate(CreateIndicatorDto, { ...payload, kegiatan: ' Activity ' });
  assert.equal(dto.kegiatan, 'Activity');
  for (const change of [{ id: 'bad/key' }, { id: 'x'.repeat(101) }, { kegiatan: '   ' }, { targetNumeric: 0.1234567 }, { totalSasaranDefault: 1.12345 }, { klasterId: 6 }, { isActive: null }, { scoringVersion: 'arbitrary' }, { targetNumeric: '1' }]) {
    await assert.rejects(validate(CreateIndicatorDto, { ...payload, ...change }), BadRequestException);
  }
  for (const body of [{ id: 'new-id' }, { scoringVersion: 'new' }, { kegiatan: null }, { isActive: null }]) await assert.rejects(validate(UpdateIndicatorDto, body), BadRequestException);
  await validate(UpdateIndicatorDto, { notes: null, formulaRaw: null });
});

test('section DTO rejects hierarchy updates and permits explicit nullable parent on create', async () => {
  await validate(CreateSectionDto, { code: '1.1', name: 'Section', klasterId: 1, parentCode: null });
  for (const body of [{ code: '1.2' }, { klasterId: 2 }, { parentCode: null }, { name: '  ' }, { order: null }]) await assert.rejects(validate(UpdateSectionDto, body), BadRequestException);
});

test('both admin roles may create globally, PIC cannot mutate and locks precede catalogue access', async () => {
  for (const role of [Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN]) {
    const { service, logs, locks } = fixture();
    const result = await service.createIndicator({ ...actor, role }, payload);
    assert.equal(result.scoringVersion, 'ILP_2026_V1');
    assert.match(locks[0]!, /ORDER BY "year" ASC FOR UPDATE/);
    assert.match(locks[1]!, /pg_advisory_xact_lock/);
    assert.match(JSON.stringify(logs), /GLOBAL_ALL_TENANTS/);
  }
  const { service, locks } = fixture();
  assert.throws(() => service.archiveIndicator({ ...actor, role: Role.PIC }, payload.id), ForbiddenException);
  assert.equal(locks.length, 0);
});

test('unknown tiered rules are rejected while existing tiered metadata can change', async () => {
  const { service, tx } = fixture();
  await assert.rejects(service.createIndicator(actor, { ...payload, polarity: Polarity.TIERED_BRACKETS }), BadRequestException);
  tx.indicator.findUnique = async () => ({ ...previous, polarity: Polarity.TIERED_BRACKETS });
  const result = await service.updateIndicator(actor, payload.id, { indikator: 'Edited metadata' });
  assert.equal(result.indikator, 'Edited metadata');
});

test('monthly history protects calculation, denominators and hierarchy but allows metadata and archiving', async () => {
  const { service, tx, logs } = fixture();
  tx.monthlyRecord.findFirst = async () => ({ id: 'record' });
  for (const change of [{ targetNumeric: 2 }, { totalSasaranDefault: 200 }, { targetSasaranDefault: 200 }, { polarity: Polarity.BINARY }, { sectionCode: '1.2' }, { klasterId: 2 }]) {
    await assert.rejects(service.updateIndicator(actor, payload.id, change), ConflictException);
  }
  assert.equal((await service.updateIndicator(actor, payload.id, { targetNumeric: 1, notes: 'Metadata only' })).notes, 'Metadata only');
  assert.equal((await service.archiveIndicator(actor, payload.id)).isActive, false);
  assert.match(JSON.stringify(logs), /MASTER_INDICATOR_ARCHIVED/);
  assert.doesNotMatch(JSON.stringify(logs), /Metadata only/);
});

test('optimistic guard detects stale indicator updates', async () => {
  const { service } = fixture();
  await assert.rejects(service.updateIndicator(actor, payload.id, { notes: 'Edit', expectedUpdatedAt: '2026-01-02T00:00:00.000Z' }), ConflictException);
});

test('indicator placement and restore require active same-cluster section', async () => {
  const { service, tx } = fixture();
  tx.section.findUnique = async () => ({ code: '1.1', klasterId: 1, isActive: false, parentCode: null, name: 'Section', order: 0 });
  await assert.rejects(service.createIndicator(actor, payload), BadRequestException);
  tx.indicator.findUnique = async () => ({ ...previous, isActive: false });
  await assert.rejects(service.updateIndicator(actor, payload.id, { isActive: true }), BadRequestException);
});

test('section parent is immediate and same-cluster; PATCH and DELETE archive checks match', async () => {
  const { service, tx } = fixture();
  await assert.rejects(service.createSection(actor, { code: '1.1.1', klasterId: 1, name: 'Nested' }), BadRequestException);
  await assert.rejects(service.createSection(actor, { code: '1.1', klasterId: 2, name: 'Wrong cluster' }), BadRequestException);
  tx.section.findFirst = async () => ({ code: '1.1.1' });
  await assert.rejects(service.archiveSection(actor, '1.1'), ConflictException);
  await assert.rejects(service.updateSection(actor, '1.1', { isActive: false }), ConflictException);
  tx.section.findFirst = async () => null;
  tx.indicator.findFirst = async () => ({ id: 'active-indicator' });
  await assert.rejects(service.archiveSection(actor, '1.1'), ConflictException);
  tx.indicator.findFirst = async () => null;
  assert.equal((await service.archiveSection(actor, '1.1')).isActive, false);
});
