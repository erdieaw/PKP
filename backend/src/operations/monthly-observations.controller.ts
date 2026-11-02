import { Body, Controller, Get, Put, Query, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Actor, CurrentActor, Roles } from '../core/auth.decorators';
import { MonthlyObservationQuery, SaveMonthlyObservationsDto } from './monthly-observations.dto';
import { MonthlyObservationsService } from './monthly-observations.service';
import { WorkflowConflictFilter } from './workflow-conflict.filter';

@ApiTags('Monthly Observations')
@ApiBearerAuth()
@Controller('records/monthly-observations')
@UseFilters(WorkflowConflictFilter)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transformOptions: { enableImplicitConversion: false } }))
export class MonthlyObservationsController {
  constructor(private readonly observations: MonthlyObservationsService) {}

  @Get()
  @ApiOperation({ summary: 'Read persisted monthly observations only; no scores, formulas, or synthesized missing rows' })
  list(@CurrentActor() actor: Actor, @Query() query: MonthlyObservationQuery) { return this.observations.list(actor, query); }

  @Put() @Roles(Role.ADMIN_PUSKESMAS, Role.PIC)
  @ApiOperation({ summary: 'Atomically replace monthly declarations in the current tenant', description: 'All active indicator identities are supported independent of scoring profiles/annual targets. Payload fields omitted are cleared except evidenceId, which is preserved on omission and cleared on null. No arithmetic or scoring. Revision 0 creates; stale revisions return 409. Binary64 JSON numbers round-trip without decimal-place rounding, range 0..1e12.' })
  save(@CurrentActor() actor: Actor, @Body() dto: SaveMonthlyObservationsDto) { return this.observations.save(actor, dto); }
}
