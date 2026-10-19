import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { UserStatus } from '@prisma/client';

// Optional fields reject null unless the API explicitly supports clearing a value.
const Optional = () => ValidateIf((_object, value: unknown) => value !== undefined);

export class TenantQuery {
  @ApiPropertyOptional({ format: 'uuid' }) @Optional() @IsUUID() healthCenterId?: string;
}

export class PaginationQuery extends TenantQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @Optional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @ApiPropertyOptional({ default: 50, maximum: 500 }) @Optional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 50;
}

export class ArchiveQuery {
  @ApiPropertyOptional({ default: false }) @Optional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() includeArchived?: boolean;
}

export class IndicatorQuery extends ArchiveQuery {
  @ApiPropertyOptional({ description: '0 means all clusters' }) @Optional() @Type(() => Number) @IsInt() @Min(0) @Max(99) klasterId?: number;
  @ApiPropertyOptional() @Optional() @IsString() @Length(1, 100) section?: string;
  @ApiPropertyOptional() @Optional() @IsString() @Length(1, 100) subKlasterCode?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(200) search?: string;
  @ApiPropertyOptional({ minimum: 1 }) @Optional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page?: number;
  @ApiPropertyOptional({ maximum: 500 }) @Optional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

export class YearParam {
  @ApiProperty({ minimum: 1, maximum: 9999 }) @Type(() => Number) @IsInt() @Min(1) @Max(9999) year!: number;
}

export class IdParam {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}

export class YearQuery extends TenantQuery {
  @ApiProperty({ minimum: 1, maximum: 9999 }) @Type(() => Number) @IsInt() @Min(1) @Max(9999) year!: number;
}

export class MonthlyQuery extends YearQuery {
  @ApiProperty({ minimum: 1, maximum: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @ApiPropertyOptional({ description: '0 means all clusters' }) @Optional() @Type(() => Number) @IsInt() @Min(0) @Max(99) klasterId?: number;
}

export class CreateHealthCenterDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{1,50}$/) code!: string;
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiProperty() @IsString() @Length(1, 200) district!: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(1000) address?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(200) headName?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) headNip?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @Optional() @IsEmail() @MaxLength(254) email?: string;
}

export class CreateYearDto extends YearParam {
  @ApiPropertyOptional({ default: 10 }) @Optional() @Type(() => Number) @IsInt() @Min(1) @Max(31) cutoffDay?: number;
}

export class LockYearDto {
  @ApiPropertyOptional() @Optional() @IsBoolean() isLocked?: boolean;
  @ApiPropertyOptional() @Optional() @Type(() => Number) @IsInt() @Min(1) @Max(31) cutoffDay?: number;
}

export class UpdateHealthCenterDto {
  @ApiPropertyOptional() @Optional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @Optional() @IsString() @Length(1, 200) district?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(1000) address?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(200) headName?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) headNip?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @Optional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @Optional() @IsBoolean() isActive?: boolean;
}

export class ResetPasswordDto extends TenantQuery {
  @ApiProperty({ minLength: 12, maxLength: 256, writeOnly: true }) @IsString() @Length(12, 256) newPassword!: string;
  @ApiProperty({ minLength: 1, maxLength: 1000 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 1000) reason!: string;
}

export class CreateUserDto extends TenantQuery {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9._-]{3,100}$/) username!: string;
  @ApiProperty({ minLength: 12, writeOnly: true }) @IsString() @MinLength(12) @MaxLength(256) password!: string;
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) nip?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @Optional() @IsEmail() @MaxLength(254) email?: string;
}

export class UpdateUserDto extends TenantQuery {
  @ApiPropertyOptional() @Optional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) nip?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @Optional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ enum: UserStatus }) @Optional() @IsEnum(UserStatus) status?: UserStatus;
}

export class AnnualTargetDto {
  @ApiProperty() @IsString() @Length(1, 100) indicatorId!: string;
  @ApiProperty({ minimum: 0 }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }) @Min(0) @Max(999999999) targetPct!: number;
  @ApiProperty({ minimum: 0 }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }) @Min(0) @Max(999999999) totalSasaran!: number;
  @ApiPropertyOptional({ description: 'Must equal totalSasaran * targetPct / 100, rounded to four decimals' }) @Optional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }) @Min(0) @Max(9999999999) targetSasaran?: number;
}

export class BulkTargetsDto extends TenantQuery {
  @ApiProperty({ type: [AnnualTargetDto], maxItems: 2000 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @ArrayUnique((item: AnnualTargetDto) => item.indicatorId) @ValidateNested({ each: true }) @Type(() => AnnualTargetDto) targets!: AnnualTargetDto[];
}

export class AssignmentDto extends YearQuery {
  @ApiProperty({ format: 'uuid' }) @IsUUID() picUserId!: string;
  @ApiPropertyOptional({ type: [String], maxItems: 2000 }) @Optional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @ArrayUnique() @IsString({ each: true }) @Length(1, 100, { each: true }) indicatorIds?: string[];
  @ApiPropertyOptional({ description: 'Exact section or dot-delimited descendants' }) @Optional() @IsString() @Length(1, 100) sectionCode?: string;
}

export class MonthlyRecordDto {
  @ApiProperty() @IsString() @Length(1, 100) indicatorId!: string;
  @ApiProperty({ minimum: 0, maximum: 999999999 }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false }) @Min(0) @Max(999999999) pencapaianRiil!: number;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(4000) notes?: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) @ValidateIf((_object, value: unknown) => value !== undefined && value !== null) @IsUUID() evidenceId?: string | null;
}

export class BulkMonthlyDto extends YearQuery {
  @ApiProperty({ minimum: 1, maximum: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @ApiProperty({ type: [MonthlyRecordDto], maxItems: 2000 }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @ArrayUnique((item: MonthlyRecordDto) => item.indicatorId) @ValidateNested({ each: true }) @Type(() => MonthlyRecordDto) records!: MonthlyRecordDto[];
}

export class WorkflowDto extends YearQuery {
  @ApiProperty({ minimum: 1, maximum: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(12) periodNumber!: number;
  @ApiProperty({ description: 'Quarter covers January through quarter * 3; month covers one month' }) @IsBoolean() isQuarter!: boolean;
  @ApiPropertyOptional() @Optional() @IsString() @Length(1, 4000) revisionNote?: string;
  @ApiPropertyOptional() @Optional() @IsString() @Length(1, 4000) reason?: string;
  @ApiPropertyOptional({ minimum: 0 }) @Optional() @Type(() => Number) @IsInt() @Min(0) @Max(2147483646) expectedRevision?: number;
  @ApiPropertyOptional({ default: false, description: 'Explicitly invalidate the transitive closure of overlapping protected periods on reopen/revise' }) @Optional() @IsBoolean() cascadeDependencies?: boolean = false;
}

export class ReviewWorkflowDto extends WorkflowDto {
  @ApiProperty({ minimum: 0 }) @ValidateIf(() => true) @Type(() => Number) @IsInt() @Min(0) @Max(2147483646) declare expectedRevision: number;
}

export class RecommendationQuery extends YearQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 4 }) @Optional() @Type(() => Number) @IsInt() @Min(1) @Max(4) quarter?: number;
}

export class FeedbackDto extends YearQuery {
  @ApiProperty({ minimum: 1, maximum: 4 }) @Type(() => Number) @IsInt() @Min(1) @Max(4) quarter!: number;
  @ApiProperty() @IsString() @Length(1, 100) sectionCode!: string;
  @ApiProperty() @IsString() @Length(1, 10000) recommendationText!: string;
}

export enum FollowUpStatus { PENDING = 'PENDING', IN_PROGRESS = 'IN_PROGRESS', RESOLVED = 'RESOLVED' }

export class ActionPlanDto extends TenantQuery {
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(10000) analisisPenyebab?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(10000) actionPlanText?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(200) targetPenyelesaian?: string;
  @ApiPropertyOptional() @Optional() @IsString() @MaxLength(200) picName?: string;
  @ApiPropertyOptional({ enum: FollowUpStatus }) @Optional() @IsEnum(FollowUpStatus) statusFollowUp?: FollowUpStatus;
}

export class AuditQuery extends PaginationQuery {
  @ApiPropertyOptional({ format: 'date-time' }) @Optional() @IsDateString({ strict: true }) from?: string;
  @ApiPropertyOptional({ format: 'date-time' }) @Optional() @IsDateString({ strict: true }) to?: string;
}
