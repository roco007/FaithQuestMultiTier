import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';

/** `PATCH /api/v1/users/me` — only the display fields may be changed here. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Raj', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  displayName?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'avatarUrl must be a full URL.' })
  @MaxLength(2048)
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'player123' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9_]+$/, {
    message: 'Username may only contain letters, numbers and underscores.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  username?: string;
}