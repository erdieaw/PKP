import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { isUUID } from 'class-validator';
import { Actor } from './auth.decorators';

export function tenantFor(actor: Actor, requested?: string): string {
  if (actor.role === Role.DINKES_ADMIN) {
    if (!requested || !isUUID(requested)) throw new BadRequestException('An explicit UUID healthCenterId is required');
    return requested;
  }
  if (!actor.healthCenterId || !isUUID(actor.healthCenterId) ||
      (requested !== undefined && requested !== actor.healthCenterId)) {
    throw new ForbiddenException('Tenant access denied');
  }
  return actor.healthCenterId;
}

export function requireRoles(actor: Actor, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) throw new ForbiddenException('Role access denied');
}
