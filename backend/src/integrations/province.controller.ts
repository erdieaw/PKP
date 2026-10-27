import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Actor, CurrentActor, Roles } from '../core/auth.decorators';
import { ProvinceConfigDto, ProvinceLogsQueryDto, ProvinceMappingsDto, ProvincePreviewDto } from './province.dto';
import { ProvinceService } from './province.service';

@Controller('bridge')
@Roles(Role.ADMIN_PUSKESMAS)
export class ProvinceController {
  constructor(private readonly province: ProvinceService) {}
  @Get('logs') logs(@CurrentActor() actor: Actor, @Query() query: ProvinceLogsQueryDto) { return this.province.logs(actor, query); }
  @Get('config') config(@CurrentActor() actor: Actor) { return this.province.config(actor); }
  @Put('config') saveConfig(@CurrentActor() actor: Actor, @Body() body: ProvinceConfigDto) { return this.province.saveConfig(actor, body); }
  @Post('test') @HttpCode(200) test(@CurrentActor() actor: Actor) { return this.province.test(actor); }
  @Get('catalog') catalog(@CurrentActor() actor: Actor) { return this.province.catalog(actor); }
  @Get('mappings') mappings(@CurrentActor() actor: Actor) { return this.province.mappings(actor); }
  @Put('mappings') saveMappings(@CurrentActor() actor: Actor, @Body() body: ProvinceMappingsDto) { return this.province.saveMappings(actor, body); }
  @Post('preview') @HttpCode(200) preview(@CurrentActor() actor: Actor, @Body() body: ProvincePreviewDto) { return this.province.preview(actor, body); }
}
