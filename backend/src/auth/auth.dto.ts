import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(100) username!: string;
  @IsString() @MinLength(1) @MaxLength(1024) password!: string;
  @IsOptional() @IsEnum(Role) role?: Role;
}

export class RefreshDto {
  @IsString() @MaxLength(200)
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i)
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(1024) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
