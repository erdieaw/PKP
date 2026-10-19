import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Actor, CurrentActor, Public, Roles } from '../core/auth.decorators';
import { BridgeSyncDto, DownloadDto, ExportDto, ScopeDto, UploadDto } from './integrations.dto';
import { ExportService } from './export.service';
import { IntegrationService } from './integrations.service';

@Controller()
export class IntegrationsController {
  constructor(private readonly integration: IntegrationService, private readonly exports: ExportService) {}

  @Post('storage/presigned-upload') @Roles(Role.ADMIN_PUSKESMAS, Role.PIC)
  upload(@CurrentActor() actor: Actor, @Body() body: UploadDto) { return this.integration.presignedUpload(actor, body); }

  @Post('storage/uploads/:id/finalize') @HttpCode(200) @Roles(Role.ADMIN_PUSKESMAS, Role.PIC)
  finalize(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.integration.finalize(actor, id); }

  @Get('storage/presigned-download')
  download(@CurrentActor() actor: Actor, @Query() query: DownloadDto) { return this.integration.presignedDownload(actor, query); }

  @Post('export/excel/sheet7') @HttpCode(202) @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN)
  excel(@CurrentActor() actor: Actor, @Body() body: ExportDto) { return this.exports.create(actor, body, 'xlsx'); }

  @Post('export/pdf/sheet7') @HttpCode(202) @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN)
  pdf(@CurrentActor() actor: Actor, @Body() body: ExportDto) { return this.exports.create(actor, body, 'pdf'); }

  @Get('export/jobs/:id') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN)
  job(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() query: ScopeDto) {
    return this.exports.get(actor, id, query.healthCenterId);
  }

  @Get('bridge/status') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN)
  bridgeStatus(@CurrentActor() actor: Actor, @Query() query: ScopeDto) { return this.integration.bridgeStatus(actor, query.healthCenterId); }

  @Post('bridge/sync-batch') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN)
  bridgeSync(@CurrentActor() actor: Actor, @Body() body: BridgeSyncDto) { return this.integration.bridgeSync(actor, body.healthCenterId); }

  @Public() @Get('health/ready')
  ready() { return this.integration.ready(); }
}
