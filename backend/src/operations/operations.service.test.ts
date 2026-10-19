import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as argon2 from 'argon2';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Actor } from '../core/auth.decorators';
import { DbService } from '../core/db.service';
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
  for (const referenced of ['upload', 'exportJob']) {
    const events: string[] = [];
    const tx: any = {
      $queryRaw: async () => { events.push('lock'); return [{ year: 2026, isLocked: false, cutoffDay: 10 }]; },
      yearPeriod: { delete: async () => assert.fail('Referenced year must not be deleted') },
    };
    for (const model of ['annualTarget', 'picAssignment', 'monthlyRecord', 'periodLock', 'recommendation', 'upload', 'exportJob']) {
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
