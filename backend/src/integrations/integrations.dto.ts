import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { MAX_UPLOAD_BYTES } from './storage.validation';

export class ScopeDto {
  @IsOptional() @IsUUID() healthCenterId?: string;
}

export class UploadDto extends ScopeDto {
  @IsString() @MaxLength(512) filename!: string;
  @IsString() @IsIn(['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) mimeType!: string;
  @IsInt() @Min(1) @Max(MAX_UPLOAD_BYTES) fileSizeBytes!: number;
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
}

export class DownloadDto extends ScopeDto {
  @ValidateIf(o => o.uploadId !== undefined || o.objectKey === undefined) @IsUUID() uploadId?: string;
  @ValidateIf(o => o.objectKey !== undefined || o.uploadId === undefined) @IsString() @MaxLength(1024) objectKey?: string;
}

export class ExportDto extends ScopeDto {
  @IsInt() @Min(2000) @Max(2100) year!: number;
  @IsIn([1, 2, 3, 4, 'ANNUAL']) quarter!: number | 'ANNUAL';
}

export class BridgeSyncDto extends ScopeDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}
