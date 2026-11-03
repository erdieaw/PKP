import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { MonthlyObservation, Prisma, Role } from '@prisma/client';
import { Actor } from '../core/auth.decorators';
import { DbService } from '../core/db.service';
import { assertWritable, lockYear } from '../core/period';
import { requireRoles, tenantFor } from '../core/tenant';
import { MonthlyObservationInput, MonthlyObservationQuery, SaveMonthlyObservationsDto } from './monthly-observations.dto';

const meaningful = (text: string | null | undefined) => Boolean(text && /[^\s\u200B-\u200D\uFEFF]/u.test(text));

export function observationPayload(input: MonthlyObservationInput) {
  const data = { kind: input.kind, status: input.status, value: input.value ?? null,
    denominator: input.denominator ?? null, documentAvailable: input.documentAvailable ?? null,
    unit: input.unit ?? null, notes: input.notes ?? null, sourceReference: input.sourceReference ?? null };
  if (data.status !== 'RECORDED') {
    if (!meaningful(data.notes) || data.value !== null || data.denominator !== null || data.documentAvailable !== null) {
      throw new BadRequestException('NOT_DUE and NOT_AVAILABLE require notes and no numeric/document values');
    }
  } else {
    if (data.kind === 'NOTE' && !meaningful(data.notes)) throw new BadRequestException('NOTE requires meaningful notes');
    if (['NUMBER', 'RATIO'].includes(data.kind) && (data.value === null || !meaningful(data.unit))) throw new BadRequestException('Numeric observations require a value and explicit unit');
    if (data.kind === 'RATIO' && data.denominator === null) throw new BadRequestException('RATIO requires an explicit denominator');
    if (data.kind === 'DOCUMENT' && data.documentAvailable === null) throw new BadRequestException('DOCUMENT requires an explicit boolean');
  }
  if ((data.kind !== 'RATIO' && data.denominator !== null) ||
      (!['NUMBER', 'RATIO'].includes(data.kind) && (data.value !== null || data.unit !== null)) ||
      (data.kind !== 'DOCUMENT' && data.documentAvailable !== null)) throw new BadRequestException('Fields do not match observation kind');
  return data;
}

// Explicit projection keeps internal attribution out of the public storage contract.
export function observationView(row: MonthlyObservation) {
  const { id, healthCenterId, indicatorId, year, month, revision, kind, status, value, denominator,
    documentAvailable, unit, notes, sourceReference, evidenceId, updatedAt } = row;
  return { id, healthCenterId, indicatorId, year, month, revision, kind, status, value, denominator,
    documentAvailable, unit, notes, sourceReference, evidenceId, updatedAt: updatedAt.toISOString() };
}

@Injectable()
export class MonthlyObservationsService {
  constructor(private readonly db: DbService) {}

  async list(actor: Actor, query: MonthlyObservationQuery) {
    const healthCenterId = tenantFor(actor, query.healthCenterId);
    const rows = await this.db.monthlyObservation.findMany({ where: { healthCenterId, year: query.year, month: query.month }, orderBy: { indicatorId: 'asc' } });
    return { items: rows.map(observationView) };
  }

  save(actor: Actor, dto: SaveMonthlyObservationsDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const healthCenterId = tenantFor(actor);
    const { year, month } = dto;
    const payloads = dto.records.map(observationPayload);
    const indicatorIds = dto.records.map(record => record.indicatorId);
    if (new Set(indicatorIds).size !== indicatorIds.length) throw new BadRequestException('Duplicate indicator IDs');
    return this.db.$transaction(async tx => {
      // Serializes with year settings, assignment writers, and workflow locks, including first creates.
      await lockYear(tx, year);
      await assertWritable(tx, healthCenterId, year, month);
      if (!await tx.healthCenter.findFirst({ where: { id: healthCenterId, isActive: true } })) throw new ForbiddenException('Active health center required');
      if (await tx.indicator.count({ where: { id: { in: indicatorIds }, isActive: true, section: { isActive: true } } }) !== indicatorIds.length) throw new BadRequestException('Unknown or inactive indicator');
      if (actor.role === Role.PIC && await tx.picAssignment.count({ where: { healthCenterId, year, picUserId: actor.id, indicatorId: { in: indicatorIds } } }) !== indicatorIds.length) throw new ForbiddenException('PIC may only write assigned indicators');
      const items = [];
      for (const [index, record] of dto.records.entries()) {
        const identity = { healthCenterId, indicatorId: record.indicatorId, year, month };
        const previous = await tx.monthlyObservation.findUnique({ where: { healthCenterId_indicatorId_year_month: identity } });
        if (record.revision !== (previous?.revision ?? 0)) throw new ConflictException('Observation revision changed; refresh before retrying');
        const evidenceId = record.evidenceId === undefined ? previous?.evidenceId ?? null : record.evidenceId;
        if (evidenceId !== null) {
          // Lock before attachment so cleanup cannot remove a READY upload between validation and linking.
          await tx.$queryRaw`SELECT id FROM uploads WHERE id = ${evidenceId}::uuid FOR UPDATE`;
          const evidence = await tx.upload.findFirst({ where: { id: evidenceId, healthCenterId, year, month,
            status: { in: ['READY', 'ATTACHED'] }, ...(actor.role === Role.PIC && evidenceId !== previous?.evidenceId ? { userId: actor.id } : {}) } });
          if (!evidence?.etag) throw new BadRequestException('Evidence must be finalized and same tenant/year/month; new or replacement attachments must be owned by the PIC');
          if (evidence.status === 'READY') await tx.upload.update({ where: { id: evidenceId }, data: { status: 'ATTACHED' } });
        }
        const data = { ...payloads[index]!, evidenceId, updatedBy: actor.id, revision: record.revision + 1 };
        const saved = previous
          ? await tx.monthlyObservation.update({ where: { id: previous.id, revision: record.revision }, data })
          : await tx.monthlyObservation.create({ data: { ...identity, ...data } });
        // Generic audit sanitization truncates long strings/arrays; raw observation history must be lossless.
        await tx.auditLog.create({ data: { userId: actor.id, actorName: actor.name, healthCenterId,
          action: 'MONTHLY_OBSERVATION_SAVED', details: JSON.parse(JSON.stringify({ previous: previous ?? null, value: saved })) as Prisma.InputJsonValue } });
        items.push(observationView(saved));
      }
      return { items };
    }, { timeout: 30000 });
  }
}
