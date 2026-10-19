import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import { hash, verify, argon2id } from 'argon2';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../config';
import { Actor } from '../core/auth.decorators';
import { audit } from '../core/audit';
import { DbService } from '../core/db.service';
import { ChangePasswordDto, LoginDto } from './auth.dto';

export const safeUserSelect = {
  id: true, username: true, email: true, name: true, nip: true, role: true,
  status: true, healthCenterId: true, phone: true,
} satisfies Prisma.UserSelect;

const authUserSelect = {
  ...safeUserSelect, tokenVersion: true,
  healthCenter: { select: { isActive: true } },
} satisfies Prisma.UserSelect;
type AuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly config = getConfig();
  // A real hash keeps unknown-user login on the same expensive verification path.
  private readonly dummyHash = hash(randomBytes(32), { type: argon2id });
  constructor(private readonly db: DbService, private readonly jwt: JwtService) {}

  private active(user: AuthUser | null): asserts user is AuthUser {
    if (!user || user.status !== 'ACTIVE' ||
        (user.healthCenterId ? !user.healthCenter?.isActive : user.role !== Role.DINKES_ADMIN)) {
      throw new UnauthorizedException('Username atau kata sandi salah. Periksa kembali dan coba lagi. Jika tetap tidak bisa masuk, hubungi administrator.');
    }
  }

  private actor(user: AuthUser, sessionId: string): Actor {
    return { id: user.id, name: user.name, role: user.role, healthCenterId: user.healthCenterId, sessionId, tokenVersion: user.tokenVersion };
  }

  private async tokens(user: AuthUser, sessionId: string, refreshToken: string) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, sid: sessionId, tokenVersion: user.tokenVersion }, {
      secret: this.config.jwtSecret, algorithm: 'HS256', expiresIn: this.config.accessTokenSeconds,
      issuer: 'sipkp', audience: 'sipkp-api',
    });
    const { tokenVersion: _version, healthCenter: _center, ...safeUser } = user;
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: this.config.accessTokenSeconds, user: safeUser };
  }

  async login(dto: LoginDto) {
    const candidate = await this.db.user.findUnique({ where: { username: dto.username }, select: { id: true, passwordHash: true } });
    const valid = await verify(candidate?.passwordHash ?? await this.dummyHash, dto.password).catch(() => false);
    if (!candidate || !valid) throw new UnauthorizedException('Username atau kata sandi salah. Periksa kembali dan coba lagi. Jika tetap tidak bisa masuk, hubungi administrator.');
    return this.db.$transaction(async tx => {
      // User lock serializes login with password changes and prevents issuing a stale session.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.id}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: candidate.id }, select: { ...authUserSelect, passwordHash: true } });
      this.active(user);
      if (user.passwordHash !== candidate.passwordHash || (dto.role !== undefined && dto.role !== user.role)) throw new UnauthorizedException('Username atau kata sandi salah. Periksa kembali dan coba lagi. Jika tetap tidak bisa masuk, hubungi administrator.');
      const sessionId = randomUUID();
      const refreshToken = `${sessionId}.${randomBytes(32).toString('base64url')}`;
      await tx.session.create({ data: { id: sessionId, userId: user.id, refreshHash: digest(refreshToken), expiresAt: new Date(Date.now() + this.config.refreshTokenDays * 86400000) } });
      await audit(tx, this.actor(user, sessionId), user.healthCenterId, 'AUTH_LOGIN', {});
      const { passwordHash: _hash, ...authUser } = user;
      return this.tokens(authUser, sessionId, refreshToken);
    });
  }

  async refresh(refreshToken: string) {
    const sessionId = refreshToken.split('.')[0]!;
    return this.db.$transaction(async tx => {
      // Stale refreshes are rejected, not family-revoked: concurrent clients cannot revoke the winner.
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const session = await tx.session.findUnique({ where: { id: sessionId }, include: { user: { select: authUserSelect } } });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Invalid refresh token');
      const expected = Buffer.from(session.refreshHash, 'hex');
      const actual = Buffer.from(digest(refreshToken), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new UnauthorizedException('Invalid refresh token');
      this.active(session.user);
      const rotated = `${sessionId}.${randomBytes(32).toString('base64url')}`;
      await tx.session.update({ where: { id: sessionId }, data: { refreshHash: digest(rotated) } });
      await audit(tx, this.actor(session.user, sessionId), session.user.healthCenterId, 'AUTH_REFRESH', {});
      return this.tokens(session.user, sessionId, rotated);
    });
  }

  async authenticate(token: string): Promise<Actor> {
    let payload: { sub?: string; sid?: string; tokenVersion?: number };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: this.config.jwtSecret, algorithms: ['HS256'], issuer: 'sipkp', audience: 'sipkp-api' });
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof payload.sub !== 'string' || !uuid.test(payload.sub) || typeof payload.sid !== 'string' || !uuid.test(payload.sid) || !Number.isInteger(payload.tokenVersion)) throw new Error();
    } catch { throw new UnauthorizedException('Invalid access token'); }
    const session = await this.db.session.findUnique({ where: { id: payload.sid }, include: { user: { select: authUserSelect } } });
    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= new Date() || session.user.tokenVersion !== payload.tokenVersion) throw new UnauthorizedException('Session expired or revoked');
    this.active(session.user);
    return this.actor(session.user, session.id);
  }

  async me(actor: Actor) {
    return this.db.user.findUniqueOrThrow({ where: { id: actor.id }, select: safeUserSelect });
  }

  async logout(actor: Actor) {
    await this.db.$transaction(async tx => {
      await tx.session.updateMany({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, actor, actor.healthCenterId, 'AUTH_LOGOUT', {});
    });
    return { loggedOut: true };
  }

  async changePassword(actor: Actor, dto: ChangePasswordDto) {
    const newHash = await hash(dto.newPassword, { type: argon2id });
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actor.id }, select: { ...authUserSelect, passwordHash: true } });
      this.active(user);
      if (user.tokenVersion !== actor.tokenVersion || !await verify(user.passwordHash, dto.currentPassword).catch(() => false)) throw new UnauthorizedException('Invalid current password');
      await tx.user.update({ where: { id: actor.id }, data: { passwordHash: newHash, tokenVersion: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, actor, actor.healthCenterId, 'AUTH_PASSWORD_CHANGED', {});
    });
    return { passwordChanged: true, requiresLogin: true };
  }
}
