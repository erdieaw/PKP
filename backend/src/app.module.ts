import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module';
import { Public } from './core/auth.decorators';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, RateLimitGuard, RolesGuard } from './auth/auth.guards';
import { OperationsModule } from './operations/operations.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { MastersModule } from './master/masters.module';

@Controller()
class HealthController {
  @Public() @Get('health')
  health() { return { status: 'ok' }; }
}

@Module({
  imports: [CoreModule, AuthModule, OperationsModule, AnalyticsModule, IntegrationsModule, MastersModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
