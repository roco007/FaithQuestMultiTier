import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/** `POST /api/v1/auth/refresh`. The refresh token is the only input. */
export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token returned by register/login/refresh.' })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

/** `POST /api/v1/auth/logout` — the refresh token to revoke. */
export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'The refresh token to revoke. Omitted, every session for the caller is revoked.',
  })
  @IsOptional()
  @IsString()
  @MinLength(20)
  refreshToken?: string;
}

/** The `user` object returned by the auth endpoints (never a password hash). */
export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() username!: string;
  @ApiProperty() displayName!: string | null;
  @ApiProperty() avatarUrl!: string | null;
  @ApiProperty({ enum: ['USER', 'ADMIN', 'CREATOR'] }) role!: string;
  @ApiProperty() totalXp!: number;
  @ApiProperty() level!: number;
  @ApiProperty() createdAt!: string;
}

/** Response of register / login / refresh. */
export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Access-token lifetime in seconds.' })
  expiresIn!: number;
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}