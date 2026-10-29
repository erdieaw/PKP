import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsInt, IsNumber, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { TenantQuery } from '../operations/operations.dto';

export class PeriodRecapQuery extends TenantQuery {
  @ApiProperty({ minimum: 2026, maximum: 9999 }) @Type(() => Number) @IsInt() @Min(2026) @Max(9999)
  declare readonly year: number;

  @ApiProperty({ minimum: 1, maximum: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(12)
  declare readonly endMonth: number;
}

export class SavePeriodRecapDto extends PeriodRecapQuery {
  @ApiProperty() @IsString() @Length(1, 100)
  declare readonly indicatorId: string;

  @ApiProperty({ minimum: 0, maximum: 9999999999.9999 }) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(9999999999.9999)
  declare readonly numerator: number;

  @ApiProperty({ minimum: 0, maximum: 9999999999.9999 }) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(9999999999.9999)
  declare readonly denominator: number;

  @ApiProperty({ description: 'Source and attestation of the January-to-end-month cumulative recap' }) @IsString() @Matches(/\S/) @MaxLength(4000)
  declare readonly notes: string;

  @ApiProperty({ enum: [true] }) @IsBoolean() @Equals(true)
  declare readonly confirmed: true;

  @ApiProperty({ minimum: 0, description: '0 for creation; saved revision for updates' }) @IsInt() @Min(0) @Max(2147483646)
  declare readonly expectedRevision: number;
}
