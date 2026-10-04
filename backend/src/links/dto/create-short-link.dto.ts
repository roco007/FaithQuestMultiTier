import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Hard ceiling on what a short link may store.
 *
 * The column is `TEXT` (65,535 bytes) and an invite carries the whole hunt in
 * its fragment — roughly 870 characters per stop, so a 15-stop hunt is ~13 KB.
 * 40,000 covers a 40-stop hunt with room to spare while leaving MySQL headroom.
 * Past it the honest answer is "share the link as it is", never a truncated
 * invite that decodes to nothing.
 */
export const MAX_TARGET_LENGTH = 40_000;

/**
 * `POST /api/v1/links` — mint a short code for a share link.
 *
 * Deliberately validates only *shape* (a non-empty string of a sane length).
 * Whether the string is a usable invite URL, and what part of it is worth
 * storing, is decided in `ShortLinksService.normaliseTarget` — that is where
 * the open-redirect reasoning lives, so it is argued once rather than split
 * between a decorator and the service.
 */
export class CreateShortLinkDto {
  @ApiProperty({
    example: 'http://localhost:3000/games#join=FQ1%3AeyJpZCI6…',
    description:
      'Absolute http(s) URL of the invite. Only its path, query and fragment ' +
      'are stored: the origin is dropped, so a short link can never redirect ' +
      'off this app.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TARGET_LENGTH)
  target!: string;
}
