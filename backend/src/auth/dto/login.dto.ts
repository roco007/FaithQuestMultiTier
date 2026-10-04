import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** `POST /api/v1/auth/login`. */
export class LoginDto {
  @ApiProperty({ example: 'pilgrim@example.com' })
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  @MaxLength(72)
  password!: string;
}