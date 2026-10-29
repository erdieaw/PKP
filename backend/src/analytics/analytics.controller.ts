import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Actor, CurrentActor } from '../core/auth.decorators';
import { requireRoles, tenantFor } from '../core/tenant';
import { DashboardQuery, PeriodRecapQuery, Sheet7Query, TrendQuery } from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transformOptions: { enableImplicitConversion: false } }))
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics/period-recap')
  periodRecap(@CurrentActor() actor: Actor, @Query() query: PeriodRecapQuery) {
    return this.analytics.periodRecap(tenantFor(actor, query.healthCenterId), query.year, query.endMonth);
  }

  @Get('analytics/sheet7')
  sheet7(@CurrentActor() actor: Actor, @Query() query: Sheet7Query) {
    return this.analytics.sheet7(tenantFor(actor, query.healthCenterId), query.year, query.quarter);
  }

  @Get('analytics/annual-trend')
  annualTrend(@CurrentActor() actor: Actor, @Query() query: TrendQuery) {
    return this.analytics.annualTrend(tenantFor(actor, query.healthCenterId), query.year, query.klasterId);
  }

  @Get('analytics/indicator-trends')
  indicatorTrends(@CurrentActor() actor: Actor, @Query() query: TrendQuery) {
    return this.analytics.indicatorTrends(tenantFor(actor, query.healthCenterId), query.year, query.klasterId);
  }

  @Get(['dashboard/summary', 'analytics/dashboard/summary'])
  dashboard(@CurrentActor() actor: Actor, @Query() query: DashboardQuery) {
    if (query.compare) requireRoles(actor, Role.DINKES_ADMIN);
    return this.analytics.dashboard(tenantFor(actor, query.healthCenterId), query.year, query.quarter, query.compare);
  }
}
