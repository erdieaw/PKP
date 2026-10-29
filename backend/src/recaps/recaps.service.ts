import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { PeriodRecap } from '@prisma/client';
import { getDoProfile } from '../analytics/do2026/profiles';
import { DO_SCORING_VERSION, scoreDo2026 } from '../analytics/do2026/scorer';
import { audit } from '../core/audit';
import type { Actor } from '../core/auth.decorators';
import { DbService } from '../core/db.service';
import { assertWritable, lockYear } from '../core/period';
import { requireRoles, tenantFor } from '../core/tenant';
import type { PeriodRecapQuery, SavePeriodRecapDto } from './recaps.dto';
import { validateDoInput } from '../analytics/do2026/input-validation';

function auditValue(recap: PeriodRecap) {
  return {
    ...recap, numerator: recap.numerator.toString(), denominator: recap.denominator.toString(),
    createdAt: recap.createdAt.toISOString(), updatedAt: recap.updatedAt.toISOString(),
  };
}

@Injectable()
export class RecapsService {
  constructor(private readonly db: DbService) {}

  async list(actor: Actor, query: PeriodRecapQuery) {
    const healthCenterId = tenantFor(actor, query.healthCenterId);
    const { year, endMonth } = query;
    const items = await this.db.periodRecap.findMany({
      where: { healthCenterId, year, endMonth }, orderBy: { indicatorId: 'asc' },
    });
    return { healthCenterId, year, endMonth, items };
  }

  save(actor: Actor, dto: SavePeriodRecapDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const healthCenterId = tenantFor(actor, dto.healthCenterId);
    const { year, endMonth, indicatorId } = dto;
    return this.db.$transaction(async tx => {
      await lockYear(tx, year);
      for (let month = 1; month <= endMonth; month++) await assertWritable(tx, healthCenterId, year, month);
      const indicator = await tx.indicator.findFirst({ where: { id: indicatorId, isActive: true, section: { isActive: true } } });
      if (!indicator) throw new BadRequestException('Unknown or inactive indicator');
      if (actor.role === Role.PIC) {
        const assignment = await tx.picAssignment.findUnique({
          where: { healthCenterId_indicatorId_year: { healthCenterId, indicatorId, year } },
        });
        if (assignment?.picUserId !== actor.id) throw new ForbiddenException('PIC may only write assigned indicators');
      }
      if (getDoProfile(indicatorId)?.status !== 'IMPLEMENTED') throw new BadRequestException('A supported DO_2026_V2 profile is required');
      validateDoInput(indicatorId, { numerator: dto.numerator, denominator: dto.denominator });
      scoreDo2026(indicatorId, { numerator: dto.numerator, denominator: dto.denominator });
      const identity = { healthCenterId, indicatorId, year, endMonth };
      const where = { healthCenterId_indicatorId_year_endMonth: identity };
      const previous = await tx.periodRecap.findUnique({ where });
      if (dto.expectedRevision !== (previous?.revision ?? 0)) throw new ConflictException('Recap revision changed; refresh before retrying');
      const data = {
        numerator: dto.numerator, denominator: dto.denominator, notes: dto.notes.trim(), confirmed: dto.confirmed,
        scoringVersion: DO_SCORING_VERSION, updatedBy: actor.id, revision: dto.expectedRevision + 1,
      };
      const saved = previous
        ? await tx.periodRecap.update({ where, data })
        : await tx.periodRecap.create({ data: { ...identity, ...data } });
      await audit(tx, actor, healthCenterId, 'PERIOD_RECAP_SAVED', {
        previous: previous ? auditValue(previous) : null, value: auditValue(saved),
      });
      return saved;
    }, { timeout: 30000 });
  }
}
