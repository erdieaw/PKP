import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class ProvinceLogsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class ProvinceConfigDto {
  @IsInt() @Min(0) revision!: number;
  @IsString() @MinLength(1) @MaxLength(200) username!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(1024) password?: string;
  @IsString() @MinLength(1) @MaxLength(100) provinceHealthCenterCode!: string;
}

export class ProvinceMappingItemDto {
  @IsString() @MinLength(1) @MaxLength(200) indicatorId!: string;
  @IsString() @MinLength(1) @MaxLength(200) provinceCode!: string;
}

export class ProvinceMappingsDto {
  @IsInt() @Min(0) revision!: number;
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => ProvinceMappingItemDto)
  items!: ProvinceMappingItemDto[];
}

export class ProvincePreviewDto {
  @IsIn(['TARGETS', 'MONTHLY']) operation!: 'TARGETS' | 'MONTHLY';
  @IsOptional() @IsInt() @Min(1) @Max(12) month?: number;
}
