import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface Actor {
  id: string;
  name: string;
  role: Role;
  healthCenterId: string | null;
  sessionId: string;
  tokenVersion: number;
}

export const PUBLIC_KEY = 'auth:public';
export const ROLES_KEY = 'auth:roles';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const actor = context.switchToHttp().getRequest().actor as Actor | undefined;
  if (!actor) throw new UnauthorizedException();
  return actor;
});
