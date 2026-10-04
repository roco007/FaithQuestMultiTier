import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `POST /api/v1/auth/register`.
 *
 * Every rule here mirrors a database constraint or a bcrypt limit, so a request
 * that passes validation cannot fail on an obscure database error:
 *  * username — `User.username @unique`, restricted to the alphabet the app's
 *    share/join screens accept;
 *  * password — bcrypt only considers the first 72 bytes, so anything longer is
 *    rejected rather than silently truncated.
 */
export class RegisterDto {
  @ApiProperty({ example: 'pilgrim@example.com' })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'player123', minLength: 3, maxLength: 24 })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters.' })
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9_]+$/, {
    message: 'Username may only contain letters, numbers and underscores.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  username!: string;

  @ApiProperty({ example: 'securePassword123', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(72, { message: 'Password must be at most 72 characters.' })
  password!: string;

  @ApiProperty({ example: 'Raj', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  displayName?: string;
}