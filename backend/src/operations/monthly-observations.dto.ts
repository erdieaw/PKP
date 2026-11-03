import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { YearQuery } from './operations.dto';

export const observationKinds = ['NOTE', 'NUMBER', 'RATIO', 'DOCUMENT'] as const;
export const observationStatuses = ['RECORDED', 'NOT_DUE', 'NOT_AVAILABLE'] as const;
export const MAX_OBSERVATION_NUMBER = 1_000_000_000_000;

export class MonthlyObservationQuery extends YearQuery {
  @ApiProperty({ minimum: 1, maximum: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
}

export class MonthlyObservationInput {
  @ApiProperty() @IsString() @Length(1, 100) indicatorId!: string;
  @ApiProperty({ description: '0 creates; the current positive revision updates', minimum: 0 }) @IsInt() @Min(0) @Max(2147483646) revision!: number;
  @ApiProperty({ enum: observationKinds }) @IsIn(observationKinds) kind!: typeof observationKinds[number];
  @ApiProperty({ enum: observationStatuses }) @IsIn(observationStatuses) status!: typeof observationStatuses[number];
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: MAX_OBSERVATION_NUMBER }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(MAX_OBSERVATION_NUMBER) value?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: MAX_OBSERVATION_NUMBER }) @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(MAX_OBSERVATION_NUMBER) denominator?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) @IsOptional() @IsBoolean() documentAvailable?: boolean | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) unit?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 4000 }) @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) sourceReference?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Omitted preserves existing evidence; null clears it' }) @IsOptional() @IsUUID() evidenceId?: string | null;
}

export class SaveMonthlyObservationsDto {
  @ApiProperty({ minimum: 1, maximum: 9999 }) @IsInt() @Min(1) @Max(9999) year!: number;
  @ApiProperty({ minimum: 1, maximum: 12 }) @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty({ type: [MonthlyObservationInput], maxItems: 500 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique((record: MonthlyObservationInput) => record?.indicatorId) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => MonthlyObservationInput) records!: MonthlyObservationInput[];
}
