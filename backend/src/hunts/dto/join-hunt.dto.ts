import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * `POST /api/v1/hunts/join`.
 *
 * Exactly one of `shareCode` / `huntId` is required — `@ValidateIf` enforces that
 * at the DTO layer so the service never has to guess which one the caller meant.
 */
export class JoinHuntDto {
  @ApiPropertyOptional({ example: 'MQ7X91', description: 'The hunt\'s short share code.' })
  @ValidateIf((dto: JoinHuntDto) => !dto.huntId)
  @IsString()
  @MinLength(4)
  @MaxLength(24)
  shareCode?: string;

  @ApiPropertyOptional({ description: 'The hunt UUID.' })
  @ValidateIf((dto: JoinHuntDto) => !dto.shareCode)
  @IsString()
  @MinLength(1)
  huntId?: string;

  /**
   * The team name a signed-in player wants to walk this hunt under — or the
   * username a guest picked on the join screen. Optional at the API layer so a
   * client that predates the prompt still joins cleanly; the service then falls
   * back to the player's own name. The UI always asks for it.
   */
  @ApiPropertyOptional({
    example: 'The Pilgrims',
    description: 'Team name (or guest username) for this hunt.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  teamName?: string;

  /**
   * The guest credential, on a join that is *not* signed in.
   *
   * Omit it to start a fresh guest round (the server issues one and returns it);
   * send it back on a re-join so the same device lands on its existing row
   * instead of a second one. Ignored when the request carries a token — a
   * signed-in player is identified by their account, never by this.
   */
  @ApiPropertyOptional({
    description: 'Existing guest token, to re-join as the same guest.',
    minLength: 64,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'guestToken must be 64 lowercase hex characters.',
  })
  guestToken?: string;
}

/**
 * `POST /api/v1/hunts/:huntId/location` — report this player's current position.
 *
 * Sent on a timer while a round is in progress (see `useLocationPing`), and
 * written as a **single overwritten slot** on the participant rather than an
 * append: the creator's map needs "where is each team right now", and a trail
 * would retain far more about a player's movements than that purpose needs.
 *
 * A fix the server refuses (hunt over, never joined) is simply not sent again —
 * the ping loop is fire-and-forget, so this endpoint deliberately returns the
 * round's own progress rather than anything about other players.
 */
export class ReportLocationDto {
  @ApiProperty({
    example: 37.774929,
    description: 'WGS84 latitude of the player right now.',
  })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({
    example: -122.419416,
    description: 'WGS84 longitude of the player right now.',
  })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  /** Which guest is pinging, when the caller has no account. */
  @ApiPropertyOptional({
    description: 'Guest token, when the caller has no account.',
    minLength: 64,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'guestToken must be 64 lowercase hex characters.',
  })
  guestToken?: string;
}

/** One submitted answer for a stop's reveal questions. */
export class HuntAnswerDto {
  @ApiPropertyOptional({ description: 'Question id being answered.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  questionId?: string;

  @ApiPropertyOptional({ description: 'Tapped MCQ option id.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  selectedOptionId?: string;

  @ApiPropertyOptional({ description: 'Typed short answer.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  text?: string;
}

/**
 * `POST /api/v1/hunts/:huntId/discover` — the server-side stop gate.
 *
 * Additive on purpose: the client already runs its own key + question gate
 * offline (`utils/keys.ts`, `utils/huntQuestions.ts`), and that keeps working.
 * When the API is reachable, this endpoint re-checks the same rules against the
 * stored key and answers, so the *persisted* progress cannot be advanced by a
 * modified client.
 *
 * Discoverable without an account so a guest's round is recorded server-side;
 * `guestToken` identifies which guest (see `guest-identity.ts`).
 */
export class DiscoverHuntStopDto {
  @ApiProperty({ description: 'The HuntNode id (the stop being cleared).' })
  @IsString()
  @MinLength(1)
  nodeId!: string;

  @ApiPropertyOptional({ description: 'The discovery key presented to this stop.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string;

  @ApiPropertyOptional({ type: [HuntAnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => HuntAnswerDto)
  answers?: HuntAnswerDto[];

  /** Which guest is clearing this stop, when the caller is not signed in. */
  @ApiPropertyOptional({
    description: 'Guest token, when the caller has no account.',
    minLength: 64,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'guestToken must be 64 lowercase hex characters.',
  })
  guestToken?: string;
}