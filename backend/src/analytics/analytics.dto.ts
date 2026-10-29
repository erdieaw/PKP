import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AnalyticsQuery {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100)
  year!: number;

  @IsOptional() @IsUUID()
  healthCenterId?: string;
}

export class Sheet7Query extends AnalyticsQuery {
  @Transform(({ value }) => value === 'ANNUAL' ? value : Number(value)) @IsIn([1, 2, 3, 4, 'ANNUAL'])
  quarter: number | 'ANNUAL' = 'ANNUAL';
}

export class TrendQuery extends AnalyticsQuery {
  @Type(() => Number) @IsInt() @Min(0) @Max(5)
  klasterId = 0;
}

export class PeriodRecapQuery extends AnalyticsQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(12)
  endMonth!: number;
}

export class DashboardQuery extends Sheet7Query {
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsIn([true, false])
  compare = false;
}
