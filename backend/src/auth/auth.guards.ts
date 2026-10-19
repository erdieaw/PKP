import { CanActivate, ExecutionContext, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Actor, PUBLIC_KEY, ROLES_KEY } from '../core/auth.decorators';
import { RedisService } from '../core/redis.service';
import { requireRoles } from '../core/tenant';
import { AuthService } from './auth.service';

type AuthRequest = Request & { actor?: Actor };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Bearer access token required');
    request.actor = await this.auth.authenticate(match[1]!);
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles) return true;
    const actor = context.switchToHttp().getRequest<AuthRequest>().actor;
    if (!actor) throw new UnauthorizedException();
    requireRoles(actor, ...roles);
    return true;
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const path = request.route?.path as string | undefined;
    if (path === '/api/v1/health' && request.method === 'GET') return true;
    const login = path === '/api/v1/auth/login' && request.method === 'POST';
    const limit = login ? 5 : 120;
    const key = `rate:${login ? 'login' : 'operations'}:${request.actor?.id ?? request.ip ?? 'unknown'}`;
    let count: number;
    try {
      count = Number(await this.redis.client.eval(
        "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
        1, key, 60,
      ));
      if (!Number.isFinite(count)) throw new Error();
    } catch { throw new ServiceUnavailableException('Rate limiter unavailable'); }
    if (count > limit) throw new HttpException('Too many requests', 429);
    return true;
  }
}
