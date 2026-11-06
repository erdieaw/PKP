import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Actor, ROLES_KEY } from '../core/auth.decorators';
import { DbService } from '../core/db.service';
import { OperationsController } from './operations.controller';
import { ArchiveQuery, ResetPasswordDto } from './operations.dto';
import { OperationsService } from './operations.service';

const centerId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actor: Actor = { id: '33333333-3333-4333-8333-333333333333', name: 'Admin', role: 'ADMIN_PUSKESMAS', healthCenterId: centerId, sessionId: 'session', tokenVersion: 0 };

test('archive query accepts explicit booleans and rejects other strings', () => {
  for (const value of ['true', 'false']) assert.equal(validateSync(plainToInstance(ArchiveQuery, { includeArchived: value })).length, 0);
  assert.ok(validateSync(plainToInstance(ArchiveQuery, { includeArchived: '1' })).length);
  const dto = plainToInstance(ResetPasswordDto, { newPassword: 'valid-password-123', reason: '   ' });
  assert.ok(validateSync(dto).some(error => error.property === 'reason'));
});

test('health-center mutation controller handlers allow only Dinkes while operational reads stay unrestricted by role', () => {
  const reflector = new Reflector();
  for (const method of ['createHealthCenter', 'updateHealthCenter', 'deleteHealthCenter'] as const) {
    assert.deepEqual(reflector.getAllAndOverride(ROLES_KEY, [OperationsController.prototype[method], OperationsController]), [Role.DINKES_ADMIN], method);
  }
  for (const method of ['indicators', 'sections', 'healthCenters'] as const) {
    assert.equal(reflector.getAllAndOverride(ROLES_KEY, [OperationsController.prototype[method], OperationsController]), undefined, method);
  }
});

for (const role of [Role.ADMIN_PUSKESMAS, Role.PIC]) {
  test(`${role} cannot update any health-center profile before DB access`, () => {
    let transactionCount = 0;
    const db = { $transaction: () => { transactionCount++; assert.fail('Forbidden profile updates must not access the DB'); } } as unknown as DbService;
    const service = new OperationsService(db);
    for (const id of [centerId, targetId]) {
      for (const dto of [{ name: 'Forbidden', address: 'Forbidden' }, { isActive: true }, { isActive: false }, {}]) {
        assert.throws(() => service.updateHealthCenter({ ...actor, role }, id, dto), ForbiddenException);
      }
    }
    assert.equal(transactionCount, 0);
  });

  test(`${role} cannot read archived indicators or sections before DB access`, async () => {
    const service = new OperationsService({} as DbService);
    await assert.rejects(service.indicators({ ...actor, role }, { includeArchived: true }), ForbiddenException);
    assert.throws(() => service.sections({ ...actor, role }, { includeArchived: true }), ForbiddenException);
  });
}

test('active catalogue reads remain available to Admin and PIC; only Dinkes may include archived entries', async () => {
  const calls: { model: string; args: any }[] = [];
  const indicator = { id: 'CUSTOM-OPERATIONAL', isActive: true };
  const section = { code: '1.1', isActive: true };
  const db = {
    indicator: {
      findMany: async (args: any) => { calls.push({ model: 'indicator.findMany', args }); return [indicator]; },
      count: async (args: any) => { calls.push({ model: 'indicator.count', args }); return 1; },
    },
    section: { findMany: async (args: any) => { calls.push({ model: 'section.findMany', args }); return [section]; } },
    $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as DbService;
  const service = new OperationsService(db);
  for (const role of [Role.ADMIN_PUSKESMAS, Role.PIC, Role.DINKES_ADMIN]) {
    for (const query of [{}, { includeArchived: false }, ...(role === Role.DINKES_ADMIN ? [{ includeArchived: true }] : [])]) {
      calls.length = 0;
      const result = await service.indicators({ ...actor, role }, query);
      assert.equal(result.items[0]!.id, indicator.id);
      assert.equal(result.total, 1);
      assert.deepEqual(await service.sections({ ...actor, role }, query), [section]);
      assert.deepEqual(calls, [
        { model: 'indicator.findMany', args: { where: { AND: query.includeArchived ? [] : [{ isActive: true, section: { isActive: true } }] }, include: { section: true }, orderBy: [{ sectionCode: 'asc' }, { id: 'asc' }] } },
        { model: 'indicator.count', args: { where: { AND: query.includeArchived ? [] : [{ isActive: true, section: { isActive: true } }] } } },
        { model: 'section.findMany', args: { where: query.includeArchived ? {} : { isActive: true }, orderBy: [{ order: 'asc' }, { code: 'asc' }] } },
      ]);
    }
  }
});

test('Admin and PIC may read only their own health center; Dinkes may read all or select a tenant', async () => {
  const calls: unknown[] = [];
  const db = { healthCenter: { findMany: async (args: unknown) => { calls.push(args); return [{ id: centerId }]; } } } as unknown as DbService;
  const service = new OperationsService(db);
  for (const role of [Role.ADMIN_PUSKESMAS, Role.PIC]) {
    for (const requested of [undefined, centerId]) {
      assert.deepEqual(await service.healthCenters({ ...actor, role }, requested), [{ id: centerId }]);
      assert.deepEqual(calls.at(-1), { where: { id: centerId }, orderBy: { name: 'asc' } });
    }
    const readCount = calls.length;
    assert.throws(() => service.healthCenters({ ...actor, role }, targetId), ForbiddenException);
    assert.equal(calls.length, readCount);
  }
  await service.healthCenters({ ...actor, role: Role.DINKES_ADMIN, healthCenterId: null });
  assert.deepEqual(calls.at(-1), { where: { id: undefined }, orderBy: { name: 'asc' } });
  await service.healthCenters({ ...actor, role: Role.DINKES_ADMIN, healthCenterId: null }, targetId);
  assert.deepEqual(calls.at(-1), { where: { id: targetId }, orderBy: { name: 'asc' } });
});

test('Dinkes may update a health-center profile after locking and audit the edited fields', async () => {
  const events: string[] = [];
  const dto = { name: 'Updated center', address: 'Updated address' };
  let auditData: any;
  const tx = {
    $queryRaw: async () => { events.push('lock'); return [{ id: centerId }]; },
    healthCenter: { update: async (args: any) => { events.push('write'); assert.deepEqual(args, { where: { id: centerId }, data: dto }); return { id: centerId, ...dto }; } },
    auditLog: { create: async ({ data }: any) => { auditData = data; } },
  };
  const db = { $transaction: async (callback: any) => callback(tx) } as unknown as DbService;
  assert.deepEqual(await new OperationsService(db).updateHealthCenter({ ...actor, role: Role.DINKES_ADMIN, healthCenterId: null }, centerId, dto), { id: centerId, ...dto });
  assert.deepEqual(events, ['lock', 'write']);
  assert.equal(auditData.action, 'HEALTH_CENTER_UPDATED');
  assert.deepEqual(auditData.details, { id: centerId, fields: ['name', 'address'] });
});

test('password reset locks before reading, preserves inactive status and returns only safe fields', async () => {
  const events: string[] = [];
  let update: any;
  let auditData: any;
  const tx = {
    $queryRaw: async () => { events.push('lock'); return [{ id: targetId }]; },
    user: {
      findFirst: async ({ where }: any) => { events.push('read'); assert.deepEqual(where, { id: targetId, healthCenterId: centerId }); return { id: targetId, username: 'pic', role: 'PIC', status: 'INACTIVE' }; },
      update: async (args: any) => { update = args.data; },
    },
    session: { updateMany: async ({ where }: any) => { assert.deepEqual(where, { userId: targetId, revokedAt: null }); return { count: 3 }; } },
    auditLog: { create: async ({ data }: any) => { auditData = data; } },
  };
  const db = { $transaction: async (callback: any) => callback(tx) } as unknown as DbService;
  const result = await new OperationsService(db).resetPassword(actor, targetId, { newPassword: 'valid-password-123', reason: 'Requested by PIC' });
  assert.deepEqual(events, ['lock', 'read']);
  assert.deepEqual(result, { id: targetId, username: 'pic', sessionsRevoked: 3 });
  assert.equal(await argon2.verify(update.passwordHash, 'valid-password-123'), true);
  assert.deepEqual(update.tokenVersion, { increment: 1 });
  assert.equal('status' in update, false);
  assert.equal(auditData.action, 'PASSWORD_RESET');
  assert.deepEqual(auditData.details, { targetUserId: targetId, targetRole: 'PIC', reason: 'Requested by PIC' });
});

test('self reset and cross-tenant reset are rejected before opening a transaction', async () => {
  const service = new OperationsService({} as DbService);
  await assert.rejects(service.resetPassword(actor, actor.id, { newPassword: 'valid-password-123', reason: 'test' }), /change-password/);
  await assert.rejects(service.resetPassword(actor, targetId, { healthCenterId: targetId, newPassword: 'valid-password-123', reason: 'test' }), /Tenant access denied/);
  assert.throws(() => service.updateHealthCenter(actor, centerId, { isActive: false }), /Role access denied/);
  assert.throws(() => service.setYear(actor, 2026, { isLocked: true }), /Role access denied/);
});

test('year deletion checks non-FK uploads and export jobs after locking', async () => {
  for (const referenced of ['upload', 'exportJob', 'monthlyObservation']) {
    const events: string[] = [];
    const tx: any = {
      $queryRaw: async () => { events.push('lock'); return [{ year: 2026, isLocked: false, cutoffDay: 10 }]; },
      yearPeriod: { delete: async () => assert.fail('Referenced year must not be deleted') },
    };
    for (const model of ['annualTarget', 'picAssignment', 'monthlyRecord', 'monthlyObservation', 'periodLock', 'recommendation', 'upload', 'exportJob']) {
      tx[model] = { count: async () => { assert.equal(events[0], 'lock'); return model === referenced ? 1 : 0; } };
    }
    const db = { $transaction: async (callback: any) => callback(tx) } as unknown as DbService;
    await assert.rejects(new OperationsService(db).deleteYear({ ...actor, role: 'DINKES_ADMIN' }, 2026), /referenced/);
  }
});

test('center deactivation revokes all center sessions and increments every center user version', async () => {
  let users: any;
  let sessions: any;
  const tx = {
    $queryRaw: async () => [{ id: centerId }],
    healthCenter: { update: async () => ({ id: centerId, isActive: false }) },
    user: { updateMany: async (args: any) => { users = args; } },
    session: { updateMany: async (args: any) => { sessions = args; } },
    auditLog: { create: async () => ({}) },
  };
  const db = { $transaction: async (callback: any) => callback(tx) } as unknown as DbService;
  const result = await new OperationsService(db).deleteHealthCenter({ ...actor, role: 'DINKES_ADMIN' }, centerId);
  assert.equal(result.isActive, false);
  assert.deepEqual(users, { where: { healthCenterId: centerId }, data: { tokenVersion: { increment: 1 } } });
  assert.deepEqual(sessions.where, { user: { healthCenterId: centerId }, revokedAt: null });
});
