import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Actor } from '../core/auth.decorators';
import { DbService } from '../core/db.service';
import { activePeriod, lockPeriodSettings } from '../core/period';
import { ProvinceAdapter } from './province.adapter';
import { decryptProvincePassword, encryptProvincePassword, provinceKey } from './province.crypto';
import { ProvinceConfigDto, ProvinceLogsQueryDto, ProvinceMappingsDto, ProvincePreviewDto } from './province.dto';

const FLAGS = { readOnly: true, canWrite: false } as const;
const LOG_ACTIONS = ['PROVINCE_CONFIG_SAVE', 'PROVINCE_TEST', 'PROVINCE_CATALOG', 'PROVINCE_MAPPING_SAVE', 'PROVINCE_PREVIEW'] as const;
const ERROR_CODES = ['INVALID_REQUEST', 'FORBIDDEN', 'CONFLICT', 'REMOTE_UNAVAILABLE', 'INTERNAL_ERROR'] as const;

@Injectable()
export class ProvinceService {
  private readonly logger = new Logger(ProvinceService.name);
  constructor(private readonly db: DbService, private readonly adapter: ProvinceAdapter) {}

  private tenant(actor: Actor, requireKey = true) {
    if (actor.role !== Role.ADMIN_PUSKESMAS || !actor.healthCenterId) throw new ForbiddenException('Own-tenant puskesmas administrator required');
    if (requireKey) provinceKey();
    return actor.healthCenterId;
  }

  private async logged<T>(actor: Actor, action: typeof LOG_ACTIONS[number], operation: () => Promise<T>): Promise<T> {
    const healthCenterId = this.tenant(actor, false);
    const started = performance.now();
    let errorCode: typeof ERROR_CODES[number] | null = null;
    try {
      return await operation();
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      errorCode = status === 400 ? 'INVALID_REQUEST' : status === 403 ? 'FORBIDDEN' : status === 409 ? 'CONFLICT'
        : status === 502 || status === 503 || status === 504 ? 'REMOTE_UNAVAILABLE' : 'INTERNAL_ERROR';
      throw error;
    } finally {
      // Outside business transactions so rollbacks do not erase failed attempts. Never serialize inputs or exceptions.
      try {
        await this.db.auditLog.create({ data: { healthCenterId, userId: actor.id, actorName: 'Province integration', action,
          details: { schemaVersion: 1, status: errorCode === null ? 'SUCCESS' : 'FAILURE',
            durationMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - started))), errorCode } } });
      } catch {
        this.logger.error('Province integration audit persistence failed');
      }
    }
  }

  async logs(actor: Actor, query: ProvinceLogsQueryDto) {
    const healthCenterId = this.tenant(actor, false);
    const rows = await this.db.auditLog.findMany({
      where: { healthCenterId, action: { in: [...LOG_ACTIONS] }, details: { path: ['schemaVersion'], equals: 1 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit + 1,
      select: { id: true, userId: true, action: true, createdAt: true, details: true },
    });
    return { items: rows.slice(0, query.limit).map(row => {
      const details = row.details as Prisma.JsonObject;
      return { id: row.id, actorId: row.userId, action: row.action, status: details.status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
        timestamp: row.createdAt.toISOString(), durationMs: typeof details.durationMs === 'number' && Number.isInteger(details.durationMs)
          && details.durationMs >= 0 && details.durationMs <= 2147483647 ? details.durationMs : null,
        errorCode: ERROR_CODES.includes(details.errorCode as typeof ERROR_CODES[number]) ? details.errorCode : null };
    }), page: query.page, limit: query.limit, hasMore: rows.length > query.limit };
  }

  async config(actor: Actor) {
    const healthCenterId = this.tenant(actor);
    const config = await this.db.provinceConfig.findUnique({ where: { healthCenterId }, select: {
      username: true, provinceHealthCenterCode: true, revision: true, updatedAt: true,
    } });
    return { ...FLAGS, ...await activePeriod(this.db), configured: !!config, hasPassword: !!config, revision: 0, ...config, connectionStatus: config ? 'UNTESTED' : 'NOT_CONFIGURED' };
  }

  async saveConfig(actor: Actor, body: ProvinceConfigDto) {
    return this.logged(actor, 'PROVINCE_CONFIG_SAVE', async () => {
    const healthCenterId = this.tenant(actor);
    if (!body.username.trim() || !body.provinceHealthCenterCode.trim()) throw new BadRequestException('Username and portal code are required');
    try {
      await this.db.$transaction(async tx => {
        const current = await tx.provinceConfig.findUnique({ where: { healthCenterId } });
        if ((current?.revision ?? 0) !== body.revision) throw new ConflictException('Province configuration revision changed');
        if (!current && !body.password) throw new BadRequestException('Password is required for initial configuration');
        const data = {
          username: body.username, provinceHealthCenterCode: body.provinceHealthCenterCode,
          passwordEncrypted: body.password ? encryptProvincePassword(body.password, healthCenterId) : current!.passwordEncrypted,
        };
        if (current) {
          const result = await tx.provinceConfig.updateMany({ where: { healthCenterId, revision: body.revision }, data: { ...data, revision: { increment: 1 } } });
          if (result.count !== 1) throw new ConflictException('Province configuration revision changed');
        } else await tx.provinceConfig.create({ data: { healthCenterId, ...data } });
        // A new account/identity must not inherit mappings validated against an old catalog.
        if (current && (current.username !== body.username || current.provinceHealthCenterCode !== body.provinceHealthCenterCode)) {
          await tx.provinceMapping.deleteMany({ where: { healthCenterId } });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new ConflictException('Province configuration revision changed');
      throw error;
    }
    return this.config(actor);
    });
  }

  private async enabledPeriod() {
    const state = await activePeriod(this.db);
    if (state.activeYear === null || !state.provinceEnabled) throw new ConflictException('Province integration is disabled or no active year is selected');
    return { ...state, activeYear: state.activeYear };
  }

  private async assertPeriod(state: { activeYear: number; periodRevision: number }) {
    const current = await this.enabledPeriod();
    if (current.activeYear !== state.activeYear || current.periodRevision !== state.periodRevision) throw new ConflictException('Active period changed during province read');
  }

  private async snapshot(actor: Actor, monthly = false) {
    const healthCenterId = this.tenant(actor);
    const period = await this.enabledPeriod();
    const config = await this.db.provinceConfig.findUnique({ where: { healthCenterId } });
    if (!config) throw new BadRequestException('Province credentials are not configured');
    const remote = await this.adapter.read({ username: config.username,
      password: decryptProvincePassword(config.passwordEncrypted, healthCenterId),
      provinceHealthCenterCode: config.provinceHealthCenterCode }, monthly);
    const current = await this.db.provinceConfig.findUnique({ where: { healthCenterId }, select: { revision: true } });
    if (current?.revision !== config.revision) throw new ConflictException('Province configuration changed during read');
    await this.assertPeriod(period);
    return { healthCenterId, revision: config.revision, remote, period };
  }

  async test(actor: Actor) {
    return this.logged(actor, 'PROVINCE_TEST', async () => {
    const { remote, revision, period } = await this.snapshot(actor);
    return { ...FLAGS, ...period, connectionStatus: 'CONNECTED', revision, provinceHealthCenterCode: remote.provinceHealthCenterCode, testedAt: new Date().toISOString() };
    });
  }

  async catalog(actor: Actor) {
    return this.logged(actor, 'PROVINCE_CATALOG', async () => {
    const { remote, revision, period } = await this.snapshot(actor);
    return { ...FLAGS, ...period, revision, remoteYear: null, targets: remote.targets, months: remote.months };
    });
  }

  async mappings(actor: Actor) {
    const healthCenterId = this.tenant(actor);
    return this.db.$transaction(async tx => {
      const config = await tx.provinceConfig.findUnique({ where: { healthCenterId }, select: { revision: true } });
      const items = await tx.provinceMapping.findMany({ where: { healthCenterId }, select: { indicatorId: true, provinceCode: true }, orderBy: { indicatorId: 'asc' } });
      return { ...FLAGS, ...await activePeriod(tx), revision: config?.revision ?? 0, items };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async saveMappings(actor: Actor, body: ProvinceMappingsDto) {
    return this.logged(actor, 'PROVINCE_MAPPING_SAVE', async () => {
    this.tenant(actor);
    const ids = body.items.map(item => item.indicatorId);
    const codes = body.items.map(item => item.provinceCode);
    const { healthCenterId, remote, revision, period } = await this.snapshot(actor);
    if (body.revision !== revision) throw new ConflictException('Province mapping revision changed');
    if (new Set(ids).size !== ids.length || new Set(codes).size !== codes.length) throw new BadRequestException('Duplicate indicator or province code');
    const remoteCodes = remote.targets.map(row => row.kd_ind);
    if (codes.some(code => remoteCodes.filter(candidate => candidate === code).length !== 1)) throw new BadRequestException('Each province code must exactly match one catalog entry');
    try {
      await this.db.$transaction(async tx => {
        const settings = await lockPeriodSettings(tx);
        const currentPeriod = await activePeriod(tx);
        if (settings.revision !== period.periodRevision || settings.activeYear !== period.activeYear || !currentPeriod.provinceEnabled) {
          throw new ConflictException('Active period changed during mapping validation');
        }
        // Lock against concurrent account changes while replacing this tenant's mapping set.
        const config = await tx.provinceConfig.updateMany({ where: { healthCenterId, revision: body.revision }, data: { revision: { increment: 1 } } });
        if (config.count !== 1) throw new ConflictException('Province configuration changed during mapping validation');
        const active = await tx.indicator.count({ where: { id: { in: ids }, isActive: true } });
        if (active !== ids.length) throw new BadRequestException('Every local indicator must exist and be active');
        await tx.provinceMapping.deleteMany({ where: { healthCenterId } });
        if (body.items.length) await tx.provinceMapping.createMany({ data: body.items.map(item => ({ healthCenterId, ...item })) });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new ConflictException('Province mappings changed concurrently');
      throw error;
    }
    return this.mappings(actor);
    });
  }

  async preview(actor: Actor, body: ProvincePreviewDto) {
    return this.logged(actor, 'PROVINCE_PREVIEW', async () => {
    this.tenant(actor);
    if (body.operation === 'MONTHLY' && body.month === undefined) throw new BadRequestException('Month is required for MONTHLY preview');
    const { healthCenterId, remote, revision, period } = await this.snapshot(actor, body.operation === 'MONTHLY');
    const mappings = await this.db.provinceMapping.findMany({ where: { healthCenterId }, include: { indicator: true }, orderBy: { indicatorId: 'asc' } });
    const targets = body.operation === 'TARGETS' ? await this.db.annualTarget.findMany({ where: { healthCenterId, year: period.activeYear } }) : [];
    const records = body.operation === 'MONTHLY' ? await this.db.monthlyRecord.findMany({ where: { healthCenterId, year: period.activeYear, month: body.month } }) : [];
    const items = mappings.map(mapping => {
      const warnings = ['REMOTE_YEAR_UNKNOWN', 'FORMULA_EQUIVALENCE_UNVERIFIED'];
      if (!mapping.indicator.isActive) warnings.push('LOCAL_INDICATOR_INACTIVE');
      const matches = body.operation === 'TARGETS' ? remote.targets.filter(row => row.kd_ind === mapping.provinceCode)
        : remote.monthly.filter(row => row.kdindikator === mapping.provinceCode && String(row.bulan).padStart(2, '0') === String(body.month).padStart(2, '0'));
      if (!matches.length) warnings.push('REMOTE_RECORD_MISSING');
      if (matches.length > 1) warnings.push('REMOTE_RECORD_AMBIGUOUS');
      const target = targets.find(row => row.indicatorId === mapping.indicatorId);
      const record = records.find(row => row.indicatorId === mapping.indicatorId);
      const local = body.operation === 'TARGETS' ? target ? {
        targetPct: target.targetPct, totalSasaran: target.totalSasaran, targetSasaran: target.targetSasaran,
      } : null : record ? {
        pencapaianRiil: record.pencapaianRiil, totalSasaran: record.totalSasaran, targetSasaran: record.targetSasaran,
        capaianRiilPct: record.capaianRiilPct, nilaiKinerja: record.nilaiKinerja, scoringVersion: record.scoringVersion,
      } : null;
      if (local === null) warnings.push('LOCAL_RECORD_MISSING');
      return { indicatorId: mapping.indicatorId, provinceCode: mapping.provinceCode, local, remote: matches.length === 1 ? matches[0] : null, warnings };
    });
    const current = await this.db.provinceConfig.findUnique({ where: { healthCenterId }, select: { revision: true } });
    if (current?.revision !== revision) throw new ConflictException('Province configuration or mappings changed during preview');
    await this.assertPeriod(period);
    return { ...FLAGS, ...period, revision, operation: body.operation, localYear: period.activeYear, month: body.month ?? null,
      remoteYear: null, warnings: ['REMOTE_YEAR_UNKNOWN', 'FORMULA_EQUIVALENCE_UNVERIFIED'], items,
      unmappedRemote: (body.operation === 'TARGETS' ? remote.targets : remote.monthly.filter(row => String(row.bulan).padStart(2, '0') === String(body.month).padStart(2, '0')))
        .filter(row => !mappings.some(mapping => mapping.provinceCode === row[body.operation === 'TARGETS' ? 'kd_ind' : 'kdindikator'])) };
    });
  }
}
