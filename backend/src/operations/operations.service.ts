import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PeriodStatus, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { DO_SCORING_VERSION, scoreDo2026 } from '../analytics/do2026/scorer';
import { getDoProfile } from '../analytics/do2026/profiles';
import { guardReportingPolicy } from '../analytics/reporting-policy';
import { containsDoSnapshot, guardDoSubmission, guardLegacyOverwrite, scoreMonthlyInput } from './monthly-scoring';
import { Actor } from '../core/auth.decorators';
import { audit } from '../core/audit';
import { DbService } from '../core/db.service';
import { activePeriod, assertWritable, lockPeriodSettings, lockYear } from '../core/period';
import { ActiveYearDto } from './operations.dto';
import { requireRoles, tenantFor } from '../core/tenant';
import { ActionPlanDto, ArchiveQuery, AssignmentDto, AuditQuery, BulkMonthlyDto, BulkTargetsDto, CreateHealthCenterDto, CreateUserDto, CreateYearDto, FeedbackDto, IndicatorQuery, LockYearDto, MonthlyQuery, PaginationQuery, RecommendationQuery, ResetPasswordDto, UpdateHealthCenterDto, UpdateUserDto, WorkflowDto, YearQuery } from './operations.dto';

const userSelect = { id: true, healthCenterId: true, username: true, email: true, name: true, nip: true, role: true, status: true, phone: true, createdAt: true, updatedAt: true } satisfies Prisma.UserSelect;
const lockedStatuses: PeriodStatus[] = ['SUBMITTED', 'VERIFIED'];
const sectionFilter = (code: string): Prisma.IndicatorWhereInput => ({ OR: [{ sectionCode: code }, { sectionCode: { startsWith: `${code}.` } }] });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const monthsFor = (period: { isQuarter: boolean; periodNumber: number }): number[] => period.isQuarter
  ? Array.from({ length: period.periodNumber * 3 }, (_value, index) => index + 1) : [period.periodNumber];

@Injectable()
export class OperationsService {
  constructor(private readonly db: DbService) {}

  async indicators(actor: Actor, query: IndicatorQuery) {
    if (query.includeArchived) requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const filters: Prisma.IndicatorWhereInput[] = query.includeArchived ? [] : [{ isActive: true, section: { isActive: true } }];
    if (query.klasterId) filters.push({ klasterId: query.klasterId });
    if (query.section) filters.push(sectionFilter(query.section));
    if (query.subKlasterCode) filters.push(sectionFilter(query.subKlasterCode));
    if (query.search) filters.push({ OR: ['id', 'kegiatan', 'indikator'].map(field => ({ [field]: { contains: query.search, mode: 'insensitive' } })) });
    const where: Prisma.IndicatorWhereInput = { AND: filters };
    const paginated = query.page !== undefined || query.limit !== undefined;
    const page = query.page ?? 1;
    const limit = query.limit ?? 500;
    const [items, total] = await this.db.$transaction([
      this.db.indicator.findMany({ where, include: { section: true }, orderBy: [{ sectionCode: 'asc' }, { id: 'asc' }], ...(paginated ? { skip: (page - 1) * limit, take: limit } : {}) }),
      this.db.indicator.count({ where }),
    ]);
    return { items: items.map(indicator => ({ ...indicator, do2026: getDoProfile(indicator.id) ?? null })), total, page: paginated ? page : 1, limit: paginated ? limit : total };
  }

  sections(actor: Actor, query: ArchiveQuery) {
    if (query.includeArchived) requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    return this.db.section.findMany({ where: query.includeArchived ? {} : { isActive: true }, orderBy: [{ order: 'asc' }, { code: 'asc' }] });
  }
  years() { return this.db.yearPeriod.findMany({ orderBy: { year: 'desc' } }); }

  async activeYear() {
    const state = await activePeriod(this.db);
    return { year: state.activeYear, provinceEnabled: state.provinceEnabled, revision: state.periodRevision };
  }

  async setActiveYear(actor: Actor, dto: ActiveYearDto) {
    requireRoles(actor, Role.DINKES_ADMIN);
    return this.db.$transaction(async tx => {
      const settings = await lockPeriodSettings(tx);
      if (settings.revision !== dto.revision) throw new ConflictException('Period settings revision changed');
      const rows = await tx.$queryRaw<{ year: number }[]>`SELECT year FROM year_periods WHERE year = ${dto.year} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Year period not found');
      await tx.yearPeriod.update({ where: { year: dto.year }, data: { provinceEnabled: dto.provinceEnabled } });
      const updated = await tx.periodSettings.update({ where: { id: 1 }, data: { activeYear: dto.year, revision: { increment: 1 } } });
      await audit(tx, actor, null, 'ACTIVE_YEAR_UPDATED', { previousYear: settings.activeYear, ...dto });
      return { year: updated.activeYear, provinceEnabled: dto.provinceEnabled, revision: updated.revision };
    });
  }

  healthCenters(actor: Actor, requested?: string) {
    const id = actor.role === Role.DINKES_ADMIN && requested === undefined ? undefined : tenantFor(actor, requested);
    return this.db.healthCenter.findMany({ where: { id }, orderBy: { name: 'asc' } });
  }

  createHealthCenter(actor: Actor, dto: CreateHealthCenterDto) {
    requireRoles(actor, Role.DINKES_ADMIN);
    return this.db.$transaction(async tx => {
      const center = await tx.healthCenter.create({ data: dto });
      await audit(tx, actor, center.id, 'HEALTH_CENTER_CREATED', { id: center.id });
      return center;
    });
  }

  createYear(actor: Actor, dto: CreateYearDto) {
    requireRoles(actor, Role.DINKES_ADMIN);
    return this.db.$transaction(async tx => {
      const year = await tx.yearPeriod.create({ data: dto });
      await audit(tx, actor, null, 'YEAR_CREATED', { year: dto.year });
      return year;
    });
  }

  setYear(actor: Actor, year: number, dto: LockYearDto) {
    requireRoles(actor, Role.DINKES_ADMIN);
    const { isLocked, cutoffDay } = dto;
    if (isLocked !== undefined) requireRoles(actor, Role.DINKES_ADMIN);
    if (isLocked === undefined && cutoffDay === undefined) throw new BadRequestException('At least one editable field is required');
    return this.db.$transaction(async tx => {
      await lockPeriodSettings(tx);
      const rows = await tx.$queryRaw<{ isLocked: boolean; cutoffDay: number }[]>`SELECT "isLocked", "cutoffDay" FROM year_periods WHERE year = ${year} FOR UPDATE`;
      const previous = rows[0];
      if (!previous) throw new NotFoundException('Year period not found');
      const updated = await tx.yearPeriod.update({ where: { year }, data: { isLocked, cutoffDay } });
      if (isLocked !== undefined) await audit(tx, actor, null, isLocked ? 'YEAR_LOCKED' : 'YEAR_UNLOCKED', { year, previousIsLocked: previous.isLocked });
      if (cutoffDay !== undefined) await audit(tx, actor, null, 'YEAR_UPDATED', { year, previousCutoffDay: previous.cutoffDay, cutoffDay });
      return updated;
    });
  }

  deleteYear(actor: Actor, year: number) {
    requireRoles(actor, Role.DINKES_ADMIN);
    return this.db.$transaction(async tx => {
      const settings = await lockPeriodSettings(tx);
      if (settings.activeYear === year) throw new ConflictException('Active year cannot be deleted');
      const rows = await tx.$queryRaw<{ year: number }[]>`SELECT year FROM year_periods WHERE year = ${year} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Year period not found');
      const references = await Promise.all([
        tx.annualTarget.count({ where: { year } }), tx.picAssignment.count({ where: { year } }),
        tx.monthlyRecord.count({ where: { year } }), tx.periodLock.count({ where: { year } }),
        tx.recommendation.count({ where: { year } }), tx.upload.count({ where: { year } }),
        tx.exportJob.count({ where: { year } }),
      ]);
      if (references.some(count => count > 0)) throw new ConflictException('Year period is referenced and cannot be deleted');
      await tx.yearPeriod.delete({ where: { year } });
      await audit(tx, actor, null, 'YEAR_DELETED', { year });
      return { year };
    });
  }

  updateHealthCenter(actor: Actor, id: string, dto: UpdateHealthCenterDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    tenantFor(actor, id);
    if (dto.isActive === false) requireRoles(actor, Role.DINKES_ADMIN);
    const fields = Object.entries(dto).filter(([, value]) => value !== undefined).map(([key]) => key);
    if (!fields.length) throw new BadRequestException('At least one editable field is required');
    return this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM health_centers WHERE id = ${id}::uuid FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Health center not found');
      const center = await tx.healthCenter.update({ where: { id }, data: dto });
      if (dto.isActive === false) {
        await tx.user.updateMany({ where: { healthCenterId: id }, data: { tokenVersion: { increment: 1 } } });
        await tx.session.updateMany({ where: { user: { healthCenterId: id }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await audit(tx, actor, id, dto.isActive === false ? 'HEALTH_CENTER_DEACTIVATED' : 'HEALTH_CENTER_UPDATED', { id, fields });
      return center;
    });
  }

  deleteHealthCenter(actor: Actor, id: string) {
    requireRoles(actor, Role.DINKES_ADMIN);
    return this.updateHealthCenter(actor, id, { isActive: false });
  }

  async users(actor: Actor, role: Role, query: PaginationQuery) {
    requireRoles(actor, ...(role === Role.ADMIN_PUSKESMAS ? [Role.DINKES_ADMIN] : [Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN]));
    const healthCenterId = tenantFor(actor, query.healthCenterId);
    const where = { healthCenterId, role };
    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.user.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async createUser(actor: Actor, role: Role, dto: CreateUserDto) {
    requireRoles(actor, ...(role === Role.ADMIN_PUSKESMAS ? [Role.DINKES_ADMIN] : [Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN]));
    if (role !== Role.ADMIN_PUSKESMAS && role !== Role.PIC) throw new ForbiddenException('Unsupported user role');
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    return this.db.$transaction(async tx => {
      const center = await tx.healthCenter.findUnique({ where: { id: healthCenterId } });
      if (!center?.isActive) throw new BadRequestException('Active health center required');
      const user = await tx.user.create({ data: {
        healthCenterId, role, username: dto.username, name: dto.name, nip: dto.nip, email: dto.email, phone: dto.phone, passwordHash,
      }, select: userSelect });
      await audit(tx, actor, healthCenterId, 'USER_CREATED', { id: user.id, role });
      return user;
    });
  }

  updateUser(actor: Actor, id: string, dto: UpdateUserDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    const { name, nip, phone, email, status } = dto;
    if (actor.role === Role.ADMIN_PUSKESMAS && status === 'SUSPENDED') throw new ForbiddenException('Only Dinkes may suspend users');
    if ([name, nip, phone, email, status].every(value => value === undefined)) throw new BadRequestException('At least one editable field is required');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({ where: { id, healthCenterId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.role === Role.DINKES_ADMIN || (actor.role === Role.ADMIN_PUSKESMAS && user.role !== Role.PIC)) throw new ForbiddenException('Only Dinkes may manage health center administrators');
      const updated = await tx.user.update({ where: { id }, data: { name, nip, phone, email, status, ...(status !== undefined ? { tokenVersion: { increment: 1 } } : {}) }, select: userSelect });
      if (status !== undefined) await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, actor, healthCenterId, 'USER_UPDATED', { id, fields: Object.entries({ name, nip, phone, email, status }).filter(([, value]) => value !== undefined).map(([key]) => key) });
      return updated;
    });
  }

  deleteUser(actor: Actor, id: string, requested?: string) {
    return this.updateUser(actor, id, { healthCenterId: requested, status: 'INACTIVE' });
  }

  async resetPassword(actor: Actor, id: string, dto: ResetPasswordDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    if (id === actor.id) throw new ForbiddenException('Use your own change-password flow');
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({ where: { id, healthCenterId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.role === Role.DINKES_ADMIN || (actor.role === Role.ADMIN_PUSKESMAS && user.role !== Role.PIC)) throw new ForbiddenException('Role access denied');
      await tx.user.update({ where: { id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
      const sessions = await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, actor, healthCenterId, 'PASSWORD_RESET', { targetUserId: id, targetRole: user.role, reason: dto.reason });
      return { id, username: user.username, sessionsRevoked: sessions.count };
    });
  }

  async annualTargets(actor: Actor, year: number, requested?: string) {
    const healthCenterId = tenantFor(actor, requested);
    const [catalogue, targets] = await this.db.$transaction([
      this.db.indicator.findMany({ where: { isActive: true, section: { isActive: true } }, orderBy: { id: 'asc' } }),
      this.db.annualTarget.findMany({ where: { healthCenterId, year } }),
    ]);
    const persisted = new Map(targets.map(target => [target.indicatorId, target]));
    return { healthCenterId, year, items: catalogue.map(indicator => {
      const target = persisted.get(indicator.id);
      const defaultPct = indicator.totalSasaranDefault.greaterThan(0)
        ? indicator.targetSasaranDefault.div(indicator.totalSasaranDefault).mul(100).toDecimalPlaces(4)
        : new Prisma.Decimal(0);
      return { indicator, rawTargetNumeric: indicator.targetNumeric, ...(target ?? { healthCenterId, year, indicatorId: indicator.id, targetPct: defaultPct, totalSasaran: indicator.totalSasaranDefault, targetSasaran: indicator.targetSasaranDefault, isLocked: false }), source: target ? 'PERSISTED' : 'DEFAULT', hasExplicitTarget: Boolean(target) };
    }) };
  }

  saveTargets(actor: Actor, year: number, dto: BulkTargetsDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS);
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    return this.db.$transaction(async tx => {
      await lockYear(tx, year);
      const indicatorIds = dto.targets.map(target => target.indicatorId);
      if (new Set(indicatorIds).size !== indicatorIds.length) throw new BadRequestException('Duplicate indicator IDs');
      const lock = await tx.periodLock.findFirst({ where: { healthCenterId, year, status: { in: lockedStatuses } } });
      if (lock) throw new ConflictException('Annual targets are protected by a submitted or verified period');
      if (await tx.annualTarget.findFirst({ where: { healthCenterId, year, isLocked: true } })) throw new ConflictException('Annual targets are locked');
      if (await tx.monthlyRecord.findFirst({ where: { healthCenterId, year, indicatorId: { in: indicatorIds } } })) throw new ConflictException('Targets with existing monthly records cannot change; rescoring is not supported');
      if (await tx.indicator.count({ where: { id: { in: indicatorIds }, isActive: true, section: { isActive: true } } }) !== indicatorIds.length) throw new BadRequestException('Unknown or inactive indicator');
      for (const target of dto.targets) {
        const derived = new Prisma.Decimal(target.totalSasaran).mul(target.targetPct).div(100).toDecimalPlaces(4);
        if (derived.greaterThan('9999999999.9999')) throw new BadRequestException('Derived target exceeds storage range');
        if (target.targetSasaran !== undefined && !derived.equals(new Prisma.Decimal(target.targetSasaran))) throw new BadRequestException(`Inconsistent targetSasaran for ${target.indicatorId}`);
        const data = { targetPct: target.targetPct, totalSasaran: target.totalSasaran, targetSasaran: derived };
        await tx.annualTarget.upsert({ where: { healthCenterId_indicatorId_year: { healthCenterId, indicatorId: target.indicatorId, year } }, create: { healthCenterId, indicatorId: target.indicatorId, year, ...data }, update: data });
      }
      await audit(tx, actor, healthCenterId, 'ANNUAL_TARGETS_UPDATED', { year, count: indicatorIds.length, indicatorIds });
      return { healthCenterId, year, updated: indicatorIds.length };
    }, { timeout: 30000 });
  }

  lockTargets(actor: Actor, year: number, requested?: string) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS);
    const healthCenterId = tenantFor(actor, requested);
    return this.db.$transaction(async tx => {
      await lockYear(tx, year);
      const result = await tx.annualTarget.updateMany({ where: { healthCenterId, year, isLocked: false }, data: { isLocked: true } });
      await audit(tx, actor, healthCenterId, 'ANNUAL_TARGETS_LOCKED', { year, count: result.count });
      return { healthCenterId, year, locked: result.count };
    });
  }

  assignments(actor: Actor, query: YearQuery) {
    const healthCenterId = tenantFor(actor, query.healthCenterId);
    return this.db.picAssignment.findMany({ where: { healthCenterId, year: query.year }, include: { picUser: { select: userSelect } }, orderBy: { indicatorId: 'asc' } });
  }

  deleteAssignment(actor: Actor, indicatorId: string, query: YearQuery) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, query.healthCenterId);
    return this.db.$transaction(async tx => {
      await lockYear(tx, query.year);
      const assignment = await tx.picAssignment.findUnique({ where: { healthCenterId_indicatorId_year: { healthCenterId, indicatorId, year: query.year } } });
      if (!assignment) throw new NotFoundException('PIC assignment not found');
      await tx.picAssignment.delete({ where: { id: assignment.id } });
      await audit(tx, actor, healthCenterId, 'PIC_ASSIGNMENT_DELETED', { year: query.year, indicatorId, picUserId: assignment.picUserId });
      return { healthCenterId, year: query.year, indicatorId };
    });
  }

  saveAssignments(actor: Actor, dto: AssignmentDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    if ((dto.indicatorIds === undefined) === (dto.sectionCode === undefined)) throw new BadRequestException('Provide exactly one of indicatorIds or sectionCode');
    return this.db.$transaction(async tx => {
      await lockYear(tx, dto.year);
      const pic = await tx.user.findFirst({ where: { id: dto.picUserId, healthCenterId, role: Role.PIC, status: 'ACTIVE' } });
      if (!pic) throw new BadRequestException('Active PIC in the same health center required');
      const indicators = await tx.indicator.findMany({ where: { isActive: true, section: { isActive: true }, ...(dto.indicatorIds ? { id: { in: dto.indicatorIds } } : sectionFilter(dto.sectionCode!)) }, select: { id: true } });
      if (!indicators.length || (dto.indicatorIds && indicators.length !== dto.indicatorIds.length)) throw new BadRequestException('Unknown, duplicate or inactive indicators/section');
      for (const indicator of indicators) await tx.picAssignment.upsert({ where: { healthCenterId_indicatorId_year: { healthCenterId, indicatorId: indicator.id, year: dto.year } }, create: { healthCenterId, indicatorId: indicator.id, year: dto.year, picUserId: pic.id }, update: { picUserId: pic.id, assignedAt: new Date() } });
      await audit(tx, actor, healthCenterId, 'PIC_ASSIGNMENTS_UPDATED', { year: dto.year, picUserId: pic.id, count: indicators.length, indicatorIds: indicators.map(indicator => indicator.id) });
      return { healthCenterId, year: dto.year, assigned: indicators.length };
    }, { timeout: 30000 });
  }

  async monthlyRecords(actor: Actor, query: MonthlyQuery) {
    const healthCenterId = tenantFor(actor, query.healthCenterId);
    const { year, month } = query;
    const [catalogue, records, targets, assignments] = await this.db.$transaction([
      this.db.indicator.findMany({ where: { isActive: true, section: { isActive: true }, ...(query.klasterId ? { klasterId: query.klasterId } : {}) }, orderBy: { id: 'asc' } }),
      this.db.monthlyRecord.findMany({ where: { healthCenterId, year, month } }),
      this.db.annualTarget.findMany({ where: { healthCenterId, year } }),
      this.db.picAssignment.findMany({ where: { healthCenterId, year, picUserId: actor.id } }),
    ]);
    const persisted = new Map(records.map(record => [record.indicatorId, record]));
    const explicitTargets = new Set(targets.map(target => target.indicatorId));
    const assigned = new Set(assignments.map(assignment => assignment.indicatorId));
    return { healthCenterId, year, month, denominatorMode: records.some(record => record.scoringVersion === DO_SCORING_VERSION) ? 'PER_RECORD_INPUT_BASIS' : 'ANNUAL_DIVIDED_BY_12', items: catalogue.map(indicator => {
      const record = persisted.get(indicator.id);
      // This route edits the declared observation, including YTD. Monthly trends
      // separately reject YTD as a standalone month's measurement.
      const doResult = record?.scoringVersion === DO_SCORING_VERSION ? { ...scoreDo2026(indicator.id, { numerator: Number(record.pencapaianRiil), denominator: Number(record.totalSasaran) }), targetSasaran: null } : undefined;
      return { indicator: { ...indicator, do2026: getDoProfile(indicator.id) ?? null }, ...(record ?? { healthCenterId, year, month, indicatorId: indicator.id, pencapaianRiil: null, totalSasaran: null, targetSasaran: null, capaianRiilPct: null, nilaiKinerja: null, evidenceId: null, notes: null, syncStatus: 'NOT_SYNCED', scoringVersion: indicator.scoringVersion }), ...(doResult ?? {}), isMissing: !record, hasExplicitTarget: explicitTargets.has(indicator.id), isAssignedToMe: assigned.has(indicator.id), source: record ? 'PERSISTED' : 'MISSING' };
    }) };
  }

  saveMonthly(actor: Actor, dto: BulkMonthlyDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    const { year, month } = dto;
    return this.db.$transaction(async tx => {
      await lockYear(tx, year);
      await assertWritable(tx, healthCenterId, year, month);
      const indicatorIds = dto.records.map(record => record.indicatorId);
      if (new Set(indicatorIds).size !== indicatorIds.length) throw new BadRequestException('Duplicate indicator IDs');
      const catalogue = await tx.indicator.findMany({ where: { id: { in: indicatorIds }, isActive: true, section: { isActive: true } } });
      if (catalogue.length !== indicatorIds.length) throw new BadRequestException('Unknown or inactive indicator');
      if (actor.role === Role.PIC && await tx.picAssignment.count({ where: { healthCenterId, year, picUserId: actor.id, indicatorId: { in: indicatorIds } } }) !== indicatorIds.length) throw new ForbiddenException('PIC may only write assigned indicators');
      const historicalYtd = await tx.monthlyRecord.findFirst({ where: { healthCenterId, year, month, indicatorId: { in: indicatorIds }, scoringVersion: DO_SCORING_VERSION, inputBasis: 'YTD_ACTUAL' }, select: { id: true } });
      if (historicalYtd) throw new ConflictException({ code: 'SEPARATE_RECAP_REQUIRED', message: 'Observasi YTD lama hanya dapat dibaca. Simpan koreksi kumulatif melalui Rekap Kumulatif & Tahunan dengan sumber dan konfirmasi.' });
      const legacyIds = dto.records.filter(record => record.scoringVersion !== DO_SCORING_VERSION).map(record => record.indicatorId);
      if (legacyIds.length) {
        const existing = await tx.$queryRaw<{ indicatorId: string; scoringVersion: string }[]>`SELECT "indicatorId", "scoringVersion" FROM "monthly_records" WHERE "healthCenterId" = ${healthCenterId}::uuid AND "year" = ${year} AND "month" = ${month} AND "indicatorId" IN (${Prisma.join(legacyIds)}) AND "scoringVersion" = ${DO_SCORING_VERSION}`;
        guardLegacyOverwrite(existing);
      }
      const targets = await tx.annualTarget.findMany({ where: { healthCenterId, year, indicatorId: { in: indicatorIds } } });
      const targetById = new Map(targets.map(target => [target.indicatorId, target]));
      const indicatorById = new Map(catalogue.map(indicator => [indicator.id, indicator]));
      for (const record of dto.records) {
        const indicator = indicatorById.get(record.indicatorId);
        if (!indicator) throw new BadRequestException('Unknown or inactive indicator');
        const scored = scoreMonthlyInput(indicator, record, year, targetById.get(record.indicatorId));
        if (record.evidenceId) {
          const evidence = await tx.upload.findFirst({ where: { id: record.evidenceId, healthCenterId, year, month, status: { in: ['READY', 'ATTACHED'] } } });
          if (!evidence || !evidence.etag) throw new BadRequestException('Evidence must be finalized and belong to this tenant and month');
          await tx.upload.update({ where: { id: evidence.id }, data: { status: 'ATTACHED' } });
        }
        const data = { pencapaianRiil: record.pencapaianRiil, ...scored, evidenceId: record.evidenceId, notes: record.notes, updatedBy: actor.id, syncStatus: 'NOT_SYNCED' };
        await tx.monthlyRecord.upsert({ where: { healthCenterId_indicatorId_year_month: { healthCenterId, indicatorId: record.indicatorId, year, month } }, create: { healthCenterId, indicatorId: record.indicatorId, year, month, ...data }, update: data });
      }
      await audit(tx, actor, healthCenterId, 'MONTHLY_RECORDS_UPDATED', { year, month, count: indicatorIds.length, indicatorIds, inputs: dto.records.map(record => ({ indicatorId: record.indicatorId, scoringVersion: record.scoringVersion ?? 'ILP_2026_V1', inputBasis: record.inputBasis ?? 'MONTHLY_DELTA' })) });
      return { healthCenterId, year, month, updated: indicatorIds.length, syncStatus: 'NOT_SYNCED' };
    }, { timeout: 30000 });
  }

  periods(actor: Actor, query: YearQuery) {
    return this.db.periodLock.findMany({ where: { healthCenterId: tenantFor(actor, query.healthCenterId), year: query.year }, orderBy: [{ isQuarter: 'asc' }, { periodNumber: 'asc' }] });
  }

  workflow(actor: Actor, action: 'submit' | 'verify' | 'revise' | 'reopen', dto: WorkflowDto) {
    requireRoles(actor, ...(action === 'submit' ? [Role.ADMIN_PUSKESMAS] : [Role.DINKES_ADMIN]));
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    const { year, periodNumber, isQuarter } = dto;
    if (isQuarter && periodNumber > 4) throw new BadRequestException('Quarter must be between 1 and 4');
    if (action !== 'submit' && dto.expectedRevision === undefined) throw new BadRequestException('expectedRevision is required');
    if (action === 'reopen' && !dto.reason?.trim()) throw new BadRequestException('Reopening requires a reason');
    if (action === 'revise' && !dto.revisionNote?.trim()) throw new BadRequestException('Revision requires revisionNote');
    return this.db.$transaction(async tx => {
      await lockYear(tx, year);
      const identity = { healthCenterId, year, periodNumber, isQuarter };
      const previous = await tx.periodLock.findUnique({ where: { healthCenterId_year_periodNumber_isQuarter: identity } });
      if (dto.expectedRevision !== undefined && dto.expectedRevision !== (previous?.revision ?? 0)) throw new ConflictException('Period revision changed; refresh before retrying');
      const status = previous?.status ?? PeriodStatus.DRAFT;
      if (action === 'submit' && status !== 'DRAFT' && status !== 'REVISION_REQUIRED') throw new ConflictException('Only DRAFT or REVISION_REQUIRED may be submitted');
      if ((action === 'verify' || action === 'revise') && status !== 'SUBMITTED') throw new ConflictException('Only SUBMITTED may be reviewed');
      if (action === 'submit' || action === 'verify') guardReportingPolicy(year);
      if (action === 'verify' && containsDoSnapshot(previous?.snapshot)) throw new ConflictException('DO_2026_V2 verification is blocked until official category and aggregation policy is confirmed');
      if (action === 'reopen' && status !== 'VERIFIED') throw new ConflictException('Only VERIFIED may be reopened');
      const coveredMonths = monthsFor(dto);
      const invalidatedPeriods: { id: string; status: PeriodStatus; revision: number }[] = [];
      if (action === 'revise' || action === 'reopen') {
        const others = await tx.periodLock.findMany({ where: { healthCenterId, year, status: { in: lockedStatuses }, ...(previous ? { id: { not: previous.id } } : {}) } });
        const affectedMonths = new Set(coveredMonths);
        const dependencies: typeof others = [];
        const included = new Set<string>();
        // A quarter can connect otherwise disjoint monthly periods; scan to a fixed point.
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const period of others) {
            if (included.has(period.id) || !monthsFor(period).some(month => affectedMonths.has(month))) continue;
            included.add(period.id);
            dependencies.push(period);
            monthsFor(period).forEach(month => affectedMonths.add(month));
            expanded = true;
          }
        }
        if (dependencies.length && !dto.cascadeDependencies) throw new ConflictException({ message: `Other submitted or verified periods protect overlapping months; dependency IDs: ${dependencies.map(period => period.id).join(', ')}`, dependencies: dependencies.map(period => ({ id: period.id, isQuarter: period.isQuarter, periodNumber: period.periodNumber, status: period.status, revision: period.revision })) });
        const reason = action === 'reopen' ? dto.reason! : dto.revisionNote!;
        const cascadeOrigin = { id: previous!.id, ...identity, action };
        for (const period of dependencies) {
          const revisionNote = `Invalidated by ${action} of period ${previous!.id}: ${reason}`;
          const invalidated = await tx.periodLock.update({ where: { id: period.id }, data: { status: 'REVISION_REQUIRED', revision: { increment: 1 }, verifiedAt: null, verifiedBy: { disconnect: true }, revisionNote } });
          invalidatedPeriods.push({ id: invalidated.id, status: invalidated.status, revision: invalidated.revision });
          await tx.auditLog.create({ data: { userId: actor.id, actorName: actor.name, healthCenterId, action: 'PERIOD_CASCADE_INVALIDATED', details: json({ id: period.id, healthCenterId, year, periodNumber: period.periodNumber, isQuarter: period.isQuarter, previousStatus: period.status, previousRevision: period.revision, status: invalidated.status, revision: invalidated.revision, reason, revisionNote, cascadeOrigin, previousSnapshot: period.snapshot }) } });
        }
      }
      const now = new Date();
      let snapshot: Prisma.InputJsonValue | undefined;
      if (action === 'submit') {
        const catalogue = await tx.indicator.findMany({ where: { isActive: true, section: { isActive: true } }, orderBy: { id: 'asc' } });
        const indicatorIds = catalogue.map(indicator => indicator.id);
        const targets = await tx.annualTarget.findMany({ where: { healthCenterId, year, indicatorId: { in: indicatorIds } }, orderBy: { indicatorId: 'asc' } });
        const records = await tx.monthlyRecord.findMany({ where: { healthCenterId, year, month: { in: coveredMonths }, indicatorId: { in: indicatorIds } }, orderBy: [{ month: 'asc' }, { indicatorId: 'asc' }] });
        if (await tx.periodRecap.count({ where: { healthCenterId, year, endMonth: { in: coveredMonths } } })) throw new ConflictException({ code: 'DO_POLICY_UNRESOLVED', message: 'Pengajuan resmi dengan rekap DO 2026 belum diaktifkan sampai kebijakan penilaian disahkan.' });
        guardDoSubmission(catalogue, records, coveredMonths);
        if (!catalogue.length || targets.length !== catalogue.length || records.length !== catalogue.length * coveredMonths.length || records.some(record => record.capaianRiilPct === null || record.nilaiKinerja === null)) throw new ConflictException('Submission requires explicit targets and scored monthly records for every active indicator and covered month');
        await tx.annualTarget.updateMany({ where: { healthCenterId, year, isLocked: false }, data: { isLocked: true } });
        const healthCenter = await tx.healthCenter.findUniqueOrThrow({ where: { id: healthCenterId } });
        const sections = await tx.section.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { code: 'asc' }] });
        snapshot = json({ schemaVersion: 1, denominatorMode: 'ANNUAL_DIVIDED_BY_12', period: { ...identity, coveredMonths }, healthCenter, sections, indicators: catalogue, targets: targets.map(target => ({ ...target, isLocked: true })), records, submittedBy: { id: actor.id, name: actor.name, role: actor.role }, submittedAt: now });
      }
      const data: Prisma.PeriodLockUpdateInput = action === 'submit'
        ? { status: 'SUBMITTED', submittedAt: now, submittedBy: { connect: { id: actor.id } }, verifiedAt: null, verifiedBy: { disconnect: true }, revisionNote: null, snapshot }
        : action === 'verify' ? { status: 'VERIFIED', verifiedAt: now, verifiedBy: { connect: { id: actor.id } } }
        : { status: 'REVISION_REQUIRED', revisionNote: action === 'reopen' ? dto.reason : dto.revisionNote, verifiedAt: null, verifiedBy: { disconnect: true } };
      const updated = previous
        ? await tx.periodLock.update({ where: { id: previous.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.periodLock.create({ data: { ...identity, status: 'SUBMITTED', submittedAt: now, submittedById: actor.id, snapshot, revision: 1 } });
      // Core audit intentionally truncates arrays. Historical snapshots must remain complete.
      await tx.auditLog.create({ data: { userId: actor.id, actorName: actor.name, healthCenterId, action: `PERIOD_${action.toUpperCase()}`, details: json({ ...identity, previousStatus: status, status: updated.status, revision: updated.revision, reason: dto.reason, revisionNote: dto.revisionNote, cascadeDependencies: dto.cascadeDependencies ?? false, invalidatedPeriods, previousSnapshot: previous?.snapshot ?? null }) } });
      return { ...updated, invalidatedPeriods };
    }, { timeout: 30000 });
  }

  recommendations(actor: Actor, query: RecommendationQuery) {
    return this.db.recommendation.findMany({ where: { healthCenterId: tenantFor(actor, query.healthCenterId), year: query.year, quarter: query.quarter }, include: { section: true }, orderBy: [{ quarter: 'asc' }, { sectionCode: 'asc' }] });
  }

  feedback(actor: Actor, dto: FeedbackDto) {
    requireRoles(actor, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    return this.db.$transaction(async tx => {
      await lockYear(tx, dto.year);
      if (!await tx.section.findUnique({ where: { code: dto.sectionCode } })) throw new BadRequestException('Unknown section');
      const identity = { healthCenterId, year: dto.year, quarter: dto.quarter, sectionCode: dto.sectionCode };
      const data = { recommendationText: dto.recommendationText, reviewedBy: actor.id };
      const result = await tx.recommendation.upsert({ where: { healthCenterId_year_quarter_sectionCode: identity }, create: { ...identity, ...data }, update: data });
      await audit(tx, actor, healthCenterId, 'RECOMMENDATION_FEEDBACK_UPDATED', { id: result.id, ...identity });
      return result;
    });
  }

  actionPlan(actor: Actor, id: string, dto: ActionPlanDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS);
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    const { analisisPenyebab, actionPlanText, targetPenyelesaian, picName, statusFollowUp } = dto;
    if ([analisisPenyebab, actionPlanText, targetPenyelesaian, picName, statusFollowUp].every(value => value === undefined)) throw new BadRequestException('At least one action-plan field is required');
    return this.db.$transaction(async tx => {
      const existing = await tx.recommendation.findFirst({ where: { id, healthCenterId } });
      if (!existing) throw new NotFoundException('Recommendation not found');
      await lockYear(tx, existing.year);
      const result = await tx.recommendation.update({ where: { id }, data: { analisisPenyebab, actionPlanText, targetPenyelesaian, picName, statusFollowUp } });
      await audit(tx, actor, healthCenterId, 'RECOMMENDATION_ACTION_PLAN_UPDATED', { id, year: existing.year });
      return result;
    });
  }

  async auditLogs(actor: Actor, query: AuditQuery) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = actor.role === Role.DINKES_ADMIN && query.healthCenterId === undefined ? undefined : tenantFor(actor, query.healthCenterId);
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) throw new BadRequestException('from must not be after to');
    const where: Prisma.AuditLogWhereInput = { healthCenterId, createdAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } };
    const [items, total] = await this.db.$transaction([
      this.db.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.db.auditLog.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
}
