import { Controller, Get, Module, NotFoundException, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CoreModule } from '../core/core.module';
import { DbService } from '../core/db.service';
import { getDoProfile } from '../analytics/do2026/profiles';
import { DO_SCORING_VERSION } from '../analytics/do2026/scorer';

class DefinitionQuery {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year = 2026;
}

@ApiTags('Operational definitions')
@ApiBearerAuth()
@Controller('master/indicators')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class DefinitionsController {
  constructor(private readonly db: DbService) {}

  @Get(':id/definition')
  async definition(@Param('id') id: string, @Query() query: DefinitionQuery) {
    const row = await this.db.operationalDefinition.findFirst({
      where: { indicatorId: id, year: query.year, version: DO_SCORING_VERSION },
    });
    if (!row) throw new NotFoundException('Definisi operasional untuk indikator dan tahun ini belum tersedia.');
    const profile = getDoProfile(id);
    return {
      definitionId: row.definitionId, indicatorId: row.indicatorId, version: row.version, year: row.year,
      definition: row.definition, calculation: row.calculation, dataSource: row.dataSource,
      notes: row.notes, targetDisplay: row.targetDisplay, sourceRef: row.sourceRef,
      sourceHash: row.sourceHash, sourceFile: row.sourceFile,
      implementationStatus: profile?.status ?? 'UNRESOLVED_RULE',
      approvalStatus: 'PROVISIONAL_SOURCE_RULE', reason: profile?.reason ?? null,
      storage: 'DATABASE',
    };
  }
}

@Module({ imports: [CoreModule], controllers: [DefinitionsController] })
export class DefinitionsModule {}
