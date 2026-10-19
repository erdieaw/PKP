import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Indicator, Prisma, Role } from '@prisma/client';
import { calculateScore, SCORING_VERSION } from '../analytics/scoring';
import { audit } from '../core/audit';
import { Actor } from '../core/auth.decorators';
import { DbService } from '../core/db.service';
import { requireRoles } from '../core/tenant';
import { CreateIndicatorDto, CreateSectionDto, UpdateIndicatorDto, UpdateSectionDto } from './masters.dto';

const indicatorFields = ['klasterId', 'sectionCode', 'no', 'kegiatan', 'indikator', 'satuan', 'targetDisplay', 'targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault', 'polarity', 'formulaRaw', 'notes', 'isActive'] as const;
const protectedFields = ['klasterId', 'sectionCode', 'targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault', 'polarity'] as const;
const decimalFields = ['targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault'] as const;

@Injectable()
export class MastersService {
  constructor(private readonly db: DbService) {}

  private mutate<T>(actor: Actor, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // Both administrator roles intentionally edit the GLOBAL catalogue, never a tenant copy.
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    return this.db.$transaction(async tx => {
      // Same lock order as year-scoped writes/submission, acquired before reading the catalogue.
      await tx.$queryRaw`SELECT "year" FROM "year_periods" ORDER BY "year" ASC FOR UPDATE`;
      // Also serialize master mutations when no year exists yet.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(2026, 190001)::text`;
      return operation(tx);
    }, { maxWait: 10000, timeout: 30000 }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException('Master key already exists, including archived entries; use PATCH to restore');
        if (['P2003', 'P2034', 'P2028'].includes(error.code)) throw new ConflictException('Concurrent catalogue change; refresh and retry');
      }
      throw error;
    });
  }

  private async log(tx: Prisma.TransactionClient, actor: Actor, action: string, key: string, fields: string[]) {
    await audit(tx, actor, actor.healthCenterId, action, {
      key, fields, scope: 'GLOBAL_ALL_TENANTS', draftReportsMayChange: true, protectedSnapshotsUnchanged: true,
    });
  }

  private async activeSection(tx: Prisma.TransactionClient, code: string, klasterId: number) {
    const section = await tx.section.findUnique({ where: { code } });
    if (!section?.isActive || section.klasterId !== klasterId) throw new BadRequestException('Section must be active and belong to the same cluster');
  }

  createIndicator(actor: Actor, dto: CreateIndicatorDto) {
    return this.mutate(actor, async tx => {
      await this.activeSection(tx, dto.sectionCode, dto.klasterId);
      // The calculator itself is the authority on supported ID-specific tiered rules.
      calculateScore({ id: dto.id, polarity: dto.polarity, targetNumeric: dto.targetNumeric, scoringVersion: SCORING_VERSION }, 0, 0, 0);
      const data = Object.fromEntries(indicatorFields.filter(field => dto[field] !== undefined).map(field => [field, dto[field]]));
      const indicator = await tx.indicator.create({ data: { ...data, id: dto.id, scoringVersion: SCORING_VERSION } as Prisma.IndicatorUncheckedCreateInput });
      await this.log(tx, actor, 'MASTER_INDICATOR_CREATED', dto.id, ['id', ...Object.keys(data), 'scoringVersion']);
      return indicator;
    });
  }

  updateIndicator(actor: Actor, id: string, dto: UpdateIndicatorDto) {
    return this.mutate(actor, async tx => {
      const previous = await tx.indicator.findUnique({ where: { id } });
      if (!previous) throw new NotFoundException('Indicator not found');
      if (dto.expectedUpdatedAt !== undefined && new Date(dto.expectedUpdatedAt).getTime() !== previous.updatedAt.getTime()) throw new ConflictException('Indicator changed; refresh before editing');
      const fields = indicatorFields.filter(field => {
        const value = dto[field];
        if (value === undefined) return false;
        if ((decimalFields as readonly string[]).includes(field)) return !(previous[field] as Prisma.Decimal).equals(value as number);
        return previous[field] !== value;
      });
      if (!indicatorFields.some(field => dto[field] !== undefined)) throw new BadRequestException('At least one editable field is required');
      if (fields.some(field => (protectedFields as readonly string[]).includes(field)) && await tx.monthlyRecord.findFirst({ where: { indicatorId: id }, select: { id: true } })) {
        throw new ConflictException('Calculation, denominator, and hierarchy fields with monthly records cannot change; create a new indicator version');
      }
      const next = { ...previous, ...Object.fromEntries(fields.map(field => [field, dto[field]])) } as Indicator;
      if (fields.includes('polarity') || fields.includes('targetNumeric') || (fields.includes('isActive') && next.isActive)) {
        calculateScore({ ...next, scoringVersion: SCORING_VERSION }, 0, 0, 0);
      }
      if (fields.includes('sectionCode') || fields.includes('klasterId') || (fields.includes('isActive') && next.isActive)) await this.activeSection(tx, next.sectionCode, next.klasterId);
      if (!fields.length) return previous;
      const indicator = await tx.indicator.update({ where: { id }, data: Object.fromEntries(fields.map(field => [field, dto[field]])) });
      await this.log(tx, actor, dto.isActive === false && previous.isActive ? 'MASTER_INDICATOR_ARCHIVED' : 'MASTER_INDICATOR_UPDATED', id, fields);
      return indicator;
    });
  }

  archiveIndicator(actor: Actor, id: string) { return this.updateIndicator(actor, id, { isActive: false }); }

  createSection(actor: Actor, dto: CreateSectionDto) {
    return this.mutate(actor, async tx => {
      const parts = dto.code.split('.');
      const expectedParent = parts.length > 2 ? parts.slice(0, -1).join('.') : null;
      if (Number(parts[0]) !== dto.klasterId || (dto.parentCode ?? null) !== expectedParent) throw new BadRequestException('Code must match cluster and parentCode must be its immediate parent');
      if (expectedParent) await this.activeSection(tx, expectedParent, dto.klasterId);
      const section = await tx.section.create({ data: { code: dto.code, name: dto.name, klasterId: dto.klasterId, parentCode: expectedParent, order: dto.order, isActive: dto.isActive } });
      await this.log(tx, actor, 'MASTER_SECTION_CREATED', section.code, ['code', 'name', 'klasterId', 'parentCode', 'order', 'isActive']);
      return section;
    });
  }

  updateSection(actor: Actor, code: string, dto: UpdateSectionDto) {
    return this.mutate(actor, async tx => {
      const previous = await tx.section.findUnique({ where: { code } });
      if (!previous) throw new NotFoundException('Section not found');
      const allowed = ['name', 'order', 'isActive'] as const;
      if (!allowed.some(field => dto[field] !== undefined)) throw new BadRequestException('At least one editable field is required');
      const fields = allowed.filter(field => dto[field] !== undefined && dto[field] !== previous[field]);
      if (dto.isActive === false) {
        const descendants = { OR: [{ code }, { code: { startsWith: `${code}.` } }] };
        if (await tx.section.findFirst({ where: { isActive: true, code: { startsWith: `${code}.` } }, select: { code: true } }) ||
          await tx.indicator.findFirst({ where: { isActive: true, section: descendants }, select: { id: true } })) {
          throw new ConflictException('Archive active child sections and indicators before archiving this section');
        }
      }
      if (dto.isActive === true && previous.parentCode) await this.activeSection(tx, previous.parentCode, previous.klasterId);
      if (!fields.length) return previous;
      const section = await tx.section.update({ where: { code }, data: Object.fromEntries(fields.map(field => [field, dto[field]])) });
      await this.log(tx, actor, dto.isActive === false && previous.isActive ? 'MASTER_SECTION_ARCHIVED' : 'MASTER_SECTION_UPDATED', code, fields);
      return section;
    });
  }

  archiveSection(actor: Actor, code: string) { return this.updateSection(actor, code, { isActive: false }); }
}
