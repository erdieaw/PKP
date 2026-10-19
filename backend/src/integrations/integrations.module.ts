import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ExportService } from './export.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationService } from './integrations.service';

@Module({
  imports: [AnalyticsModule], controllers: [IntegrationsController],
  providers: [IntegrationService, ExportService], exports: [IntegrationService],
})
export class IntegrationsModule {}
