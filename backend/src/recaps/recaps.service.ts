import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, Role } from '@prisma/client';
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
import { assertStructuredCounts, evaluateStructuredInput, structuredInputKindFor } from '../analytics/do2026/structured-input';

function auditValue(recap: PeriodRecap) {
  let structuredInput = recap.structuredInput;
  if (structuredInput != null) {
    if (!structuredInputKindFor(recap.indicatorId)) throw new BadRequestException({ code: 'INVALID_STRUCTURED_INPUT', message: 'Stored structuredInput is unexpected for this profile; it must not be overwritten.' });
    // Validate the stored schema before wrapping it, without normalizing away historical values.
    const derived = evaluateStructuredInput(recap.indicatorId, structuredInput, recap.year, recap.endMonth);
    assertStructuredCounts(derived, recap);
    const sha256 = createHash('sha256').update(JSON.stringify(structuredInput, (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value)).digest('hex');
    structuredInput = {
      format: 'RECAP_LEDGER_CHUNKS_V1', sha256, complete: true,
      ledger: Object.fromEntries(Object.entries(structuredInput).map(([key, value]) => [key, Array.isArray(value)
        ? { count: value.length, chunks: Array.from({ length: Math.ceil(value.length / 100) }, (_, i) => value.slice(i * 100, (i + 1) * 100)) }
        : value])),
    };
  }
  return {
    ...recap, structuredInput, numerator: recap.numerator.toString(), denominator: recap.denominator.toString(),
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
      const profile = getDoProfile(indicatorId);
      if (!profile || !['IMPLEMENTED', 'CONTEXTUAL', 'SOURCE_INPUT_ONLY'].includes(profile.status)) throw new BadRequestException('A supported DO_2026_V2 input contract is required');
      const structuredKind = structuredInputKindFor(indicatorId);
      const sourceAssessment = structuredKind === 'DO_SOURCE_ASSESSMENT';
      if (sourceAssessment && dto.confirmed !== true) throw new BadRequestException({ code: 'SOURCE_ASSESSMENT_REQUIRED', message: 'Asesmen sumber wajib dikonfirmasi.' });
      if (((structuredKind && !sourceAssessment) || profile.annualRecapOnly) && (endMonth !== 12 || dto.confirmed !== true)) throw new BadRequestException({ code: 'ANNUAL_RECAP_REQUIRED', message: 'Profil ini memerlukan rekap tahunan Januari sampai Desember yang dikonfirmasi.' });
      if (!structuredKind && dto.structuredInput !== undefined) throw new BadRequestException('Indikator ini tidak menerima structuredInput');
      const derived = structuredKind ? evaluateStructuredInput(indicatorId, dto.structuredInput, year, endMonth) : undefined;
      if (derived) {
        assertStructuredCounts(derived, dto);
        if (typeof dto.notes !== 'string' || !dto.notes.trim()) throw new BadRequestException('Sumber dan attestasi rekap, termasuk ledger kosong, wajib dicatat.');
      }
      validateDoInput(indicatorId, { numerator: dto.numerator, denominator: dto.denominator });
      scoreDo2026(indicatorId, { numerator: dto.numerator, denominator: dto.denominator, annualRecapConfirmed: (structuredKind !== undefined || profile.annualRecapOnly) && endMonth === 12 && dto.confirmed === true, sourceAssessmentConfirmed: sourceAssessment && dto.confirmed === true, endMonth, year, ...(derived ? { structuredInput: derived.structuredInput } : {}) });
      const identity = { healthCenterId, indicatorId, year, endMonth };
      const where = { healthCenterId_indicatorId_year_endMonth: identity };
      const previous = await tx.periodRecap.findUnique({ where });
      if (dto.expectedRevision !== (previous?.revision ?? 0)) throw new ConflictException('Recap revision changed; refresh before retrying');
      const previousAudit = previous ? auditValue(previous) : null;
      const data = {
        numerator: derived?.numerator ?? dto.numerator, denominator: derived?.denominator ?? dto.denominator, notes: dto.notes.trim(), confirmed: dto.confirmed,
        structuredInput: derived ? derived.structuredInput as Prisma.InputJsonValue : Prisma.DbNull,
        scoringVersion: DO_SCORING_VERSION, updatedBy: actor.id, revision: dto.expectedRevision + 1,
      };
      const saved = previous
        ? await tx.periodRecap.update({ where, data })
        : await tx.periodRecap.create({ data: { ...identity, ...data } });
      await audit(tx, actor, healthCenterId, 'PERIOD_RECAP_SAVED', {
        previous: previousAudit, value: auditValue(saved),
      });
      return saved;
    }, { timeout: 30000 });
  }
}
