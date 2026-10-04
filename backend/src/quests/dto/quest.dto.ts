import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

/** `GET /api/v1/quests` query. */
export class FindQuestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['LOCATION', 'PUZZLE', 'QUIZ', 'AR', 'CAMERA_QR'] })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(['LOCATION', 'PUZZLE', 'QUIZ', 'AR', 'CAMERA_QR'])
  type?: string;

  @ApiPropertyOptional({ example: 'chapel' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Include quests with isActive=false.', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  includeInactive?: boolean;
}

/**
 * `POST /api/v1/quests/:questId/complete`.
 *
 * Intentionally minimal (rule #13): the only things a client may send are the
 * coordinates it measured. `xp`, `level`, `badgeId`, `itemId` and `completed`
 * are *not* fields here, and `ValidationPipe` runs with `forbidNonWhitelisted`,
 * so sending them is a 400 rather than a silent lie.
 *
 * `accuracy` is optional and only ever widens the radius by the device's own
 * reported uncertainty (see `DistanceService.isWithinRadius`).
 */
export class CompleteQuestDto {
  @ApiProperty({ example: 19.076001, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 72.877701, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({
    description: 'The GPS fix accuracy in meters, when the device reports it.',
    minimum: 0,
    maximum: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  accuracy?: number;
}

/** Response of a successful completion — everything the UI needs to celebrate. */
export class QuestCompletionResultDto {
  @ApiProperty({ example: 'COMPLETED' }) status!: string;
  @ApiProperty() questId!: string;
  @ApiProperty() xpEarned!: number;
  @ApiProperty() totalXp!: number;
  @ApiProperty() level!: number;
  @ApiProperty() currentXp!: number;
  @ApiProperty() xpForNextLevel!: number;
  @ApiProperty() rankTitle!: string;
  @ApiProperty() leveledUp!: boolean;
  @ApiPropertyOptional() newBadge?: { id: string; slug: string; name: string; icon: string };
  @ApiPropertyOptional()
  newItem?: { id: string; slug: string; name: string; description: string; rarity: string };
  @ApiProperty() distanceMeters!: number;
  @ApiProperty() completedAt!: string;
}