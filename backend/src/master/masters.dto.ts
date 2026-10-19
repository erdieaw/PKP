import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Polarity } from '@prisma/client';

const Optional = () => ValidateIf((_object, value: unknown) => value !== undefined);
const Nullable = () => ValidateIf((_object, value: unknown) => value !== undefined && value !== null);
const Trim = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value);

export class IndicatorIdParam {
  @ApiProperty() @IsString() @Length(1, 100) @Matches(/^[A-Za-z0-9_.-]+$/) id!: string;
}

export class SectionCodeParam {
  @ApiProperty() @IsString() @Length(3, 100) @Matches(/^[1-5](?:\.[1-9]\d*)+$/) code!: string;
}

export class CreateIndicatorDto extends IndicatorIdParam {
  @ApiProperty() @IsInt() @Min(1) @Max(5) klasterId!: number;
  @ApiProperty() @IsString() @Length(3, 100) @Matches(/^[1-5](?:\.[1-9]\d*)+$/) sectionCode!: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 100) no!: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 4000) kegiatan!: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 4000) indikator!: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 200) satuan!: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 200) targetDisplay!: string;
  @ApiProperty({ minimum: 0, maximum: 99999999.999999 }) @IsNumber({ maxDecimalPlaces: 6, allowNaN: false, allowInfinity: false }) @Min(0) @Max(99999999.999999) targetNumeric!: number;
  @ApiProperty({ minimum: 0, maximum: 9999999999.9999 }) @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }) @Min(0) @Max(9999999999.9999) totalSasaranDefault!: number;
  @ApiProperty({ minimum: 0, maximum: 9999999999.9999 }) @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }) @Min(0) @Max(9999999999.9999) targetSasaranDefault!: number;
  @ApiProperty({ enum: Polarity }) @IsEnum(Polarity) polarity!: Polarity;
  @ApiPropertyOptional({ nullable: true, description: 'Inert metadata; never evaluated' }) @Nullable() @IsString() @MaxLength(4000) formulaRaw?: string | null;
  @ApiPropertyOptional({ nullable: true }) @Nullable() @IsString() @MaxLength(4000) notes?: string | null;
  @ApiPropertyOptional({ default: true }) @Optional() @IsBoolean() isActive?: boolean;
}

export class UpdateIndicatorDto extends PartialType(OmitType(CreateIndicatorDto, ['id'] as const), { skipNullProperties: false }) {
  @ApiPropertyOptional({ description: 'Compare with the current updatedAt before writing' }) @Optional() @IsDateString() expectedUpdatedAt?: string;
}

export class CreateSectionDto extends SectionCodeParam {
  @ApiProperty() @Trim() @IsString() @Length(1, 1000) name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(5) klasterId!: number;
  @ApiPropertyOptional({ nullable: true, description: 'Required immediate parent for nested codes; null for top-level codes' }) @Nullable() @IsString() @Length(3, 100) @Matches(/^[1-5](?:\.[1-9]\d*)+$/) parentCode?: string | null;
  @ApiPropertyOptional({ default: 0 }) @Optional() @IsInt() @Min(0) @Max(2147483647) order?: number;
  @ApiPropertyOptional({ default: true }) @Optional() @IsBoolean() isActive?: boolean;
}

export class UpdateSectionDto extends PartialType(OmitType(CreateSectionDto, ['code', 'klasterId', 'parentCode'] as const), { skipNullProperties: false }) {}
