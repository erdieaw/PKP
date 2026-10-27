import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ExportService } from './export.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationService } from './integrations.service';
import { ProvinceController } from './province.controller';
import { ProvinceService } from './province.service';
import { ProvinceAdapter } from './province.adapter';

@Module({
  imports: [AnalyticsModule], controllers: [IntegrationsController, ProvinceController],
  providers: [IntegrationService, ExportService, ProvinceService, ProvinceAdapter], exports: [IntegrationService],
})
export class IntegrationsModule {}
