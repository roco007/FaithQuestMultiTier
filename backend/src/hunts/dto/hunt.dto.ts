import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

/** Roster archetypes — mirrors `HuntCharacterType` in `types/hunt.ts`. */
export const HUNT_CHARACTER_TYPES = [
  'guardian',
  'angel',
  'monk',
  'flame',
  'oracle',
] as const;

/**
 * One stop of a hunt.
 *
 * The brief's `POST /hunts` body only carries `nodeIds`, and that still works
 * (see `CreateHuntDto`). This richer shape exists so the **existing creator
 * screen** — which authors a hint, a discovery key, a character and question
 * gate per stop — can be mirrored without losing gameplay: everything a
 * `HuntCharacter` needs is carried here, and the place itself is a reference to
 * a `QuestNode`.
 */
export class HuntStopDto {
  @ApiProperty({
    description:
      'QuestNode UUID or catalogue slug of the place. When this matches nothing in ' +
      'the catalogue, the stop is treated as a creator-placed location and the ' +
      'place fields below are used to register one.',
  })
  @IsString()
  @MinLength(1)
  questNodeId!: string;

  /**
   * Place details, sent only for a creator-placed location (one that is not in
   * the shared catalogue). Ignored when `questNodeId` does resolve — the
   * catalogue is authoritative there, so a client cannot rewrite a shared
   * landmark by sending different coordinates for it.
   *
   * These exist because `HuntNode` requires a `QuestNode` (latitude, longitude
   * and radius are what tell a player they have arrived). Without them a custom
   * location simply cannot be stored, which is what used to force every hunt to
   * be built from the six seeded places.
   */
  @ApiPropertyOptional({ description: 'Place name for a creator-placed location.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ default: 50, minimum: 5, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(5000)
  radiusMeters?: number;

  @ApiPropertyOptional({ description: 'The clue (hint) shown for this place.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  clue?: string;

  @ApiPropertyOptional({ enum: HUNT_CHARACTER_TYPES, default: 'guardian' })
  @IsOptional()
  @IsIn(HUNT_CHARACTER_TYPES as unknown as string[])
  characterType?: string;

  @ApiPropertyOptional({ description: 'ID from public/characters/manifest.json.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  characterAssetId?: string;

  @ApiPropertyOptional({ description: 'ID from public/marketing/manifest.json.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sponsorBannerId?: string;

  @ApiPropertyOptional({ default: 0, description: 'Character height above ground (m).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  altitudeMeters?: number;

  @ApiPropertyOptional({ description: 'The discovery key a team presents here.' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  key?: string;

  @ApiPropertyOptional({ description: 'The reveal questions asked at this stop.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  questions?: Record<string, unknown>[];

  @ApiPropertyOptional({ description: 'Marks the treasure location (dealt last).' })
  @IsOptional()
  @IsBoolean()
  isTreasure?: boolean;
}

/**
 * `POST /api/v1/hunts`.
 *
 * `nodeIds` (the brief's shape) and `stops` (the creator screen's shape) are
 * interchangeable: `stops` wins when both are sent, and bare `nodeIds` produces
 * default stops — so the documented contract and the real UI both work.
 */
export class CreateHuntDto {
  @ApiProperty({ example: 'Mumbai Faith Quest', minLength: 3, maxLength: 80 })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @ApiPropertyOptional({ example: 'Explore historic churches around Mumbai' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'QuestNode ids or slugs, in order.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  nodeIds?: string[];

  @ApiPropertyOptional({ type: [HuntStopDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HuntStopDto)
  stops?: HuntStopDto[];

  @ApiPropertyOptional({ description: 'Spoken/shown when the treasure is cleared.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  endAnnouncement?: string;

  @ApiPropertyOptional({ description: 'Character shown with the end announcement.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  endCharacterAssetId?: string;

  @ApiPropertyOptional({ description: 'Publish immediately (otherwise the hunt is a DRAFT).' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/** `PATCH /api/v1/hunts/:huntId` — same fields, all optional. */
export class UpdateHuntDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  endAnnouncement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  endCharacterAssetId?: string;

  @ApiPropertyOptional({ type: [HuntStopDto], description: 'Replaces the whole stop list.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HuntStopDto)
  stops?: HuntStopDto[];
}

/** `GET /api/v1/hunts` filters. */
export class FindHuntsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only hunts created by the caller.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  mine?: boolean;

  @ApiPropertyOptional({ description: 'Only hunts the caller has joined.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  joined?: boolean;
}