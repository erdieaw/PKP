import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Actor, CurrentActor, Roles } from '../core/auth.decorators';
import { CreateIndicatorDto, CreateSectionDto, IndicatorIdParam, SectionCodeParam, UpdateIndicatorDto, UpdateSectionDto } from './masters.dto';
import { MastersService } from './masters.service';

@ApiTags('Shared masters')
@Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN)
@Controller('master')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Post('indicators')
  @ApiOperation({ summary: 'Create a global indicator affecting all tenants' })
  createIndicator(@CurrentActor() actor: Actor, @Body() dto: CreateIndicatorDto) { return this.masters.createIndicator(actor, dto); }

  @Patch('indicators/:id')
  @ApiOperation({ summary: 'Update a global indicator; protected snapshots remain unchanged' })
  updateIndicator(@CurrentActor() actor: Actor, @Param() params: IndicatorIdParam, @Body() dto: UpdateIndicatorDto) { return this.masters.updateIndicator(actor, params.id, dto); }

  @Delete('indicators/:id')
  @ApiOperation({ summary: 'Archive globally; historical records remain, draft reports may change' })
  archiveIndicator(@CurrentActor() actor: Actor, @Param() params: IndicatorIdParam) { return this.masters.archiveIndicator(actor, params.id); }

  @Post('sections')
  @ApiOperation({ summary: 'Create a global section affecting all tenants' })
  createSection(@CurrentActor() actor: Actor, @Body() dto: CreateSectionDto) { return this.masters.createSection(actor, dto); }

  @Patch('sections/:code')
  @ApiOperation({ summary: 'Update global section metadata or active state; hierarchy is immutable' })
  updateSection(@CurrentActor() actor: Actor, @Param() params: SectionCodeParam, @Body() dto: UpdateSectionDto) { return this.masters.updateSection(actor, params.code, dto); }

  @Delete('sections/:code')
  @ApiOperation({ summary: 'Archive an empty global section; historical records remain' })
  archiveSection(@CurrentActor() actor: Actor, @Param() params: SectionCodeParam) { return this.masters.archiveSection(actor, params.code); }
}
