import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ShortLinksService } from './short-links.service.js';
import { CreateShortLinkDto } from './dto/create-short-link.dto.js';
import {
  CurrentUser,
  OptionalAuth,
  Public,
  type RequestUser,
} from '../common/decorators/auth.decorators.js';

/**
 * `/api/v1/links` — minting and resolving share-link short codes.
 *
 * The two routes are asymmetric on purpose:
 *
 *  * `POST /links` is `@OptionalAuth`. Shortening is a convenience, not a
 *    capability that needs an account — a guest sharing a hunt they are
 *    playing locally should get a short link too. A signed-in caller is
 *    recorded on the row; an anonymous one is not an error.
 *  * `GET /links/:code` is `@Public`. It is hit by a browser that has never
 *    seen this app, before any sign-in could possibly have happened, and it
 *    returns a path rather than any hunt data — there is nothing here to
 *    protect.
 */
@ApiTags('links')
@Controller('links')
export class ShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  @Post()
  @OptionalAuth()
  // Documented at the method, not the class: minting may carry a token, but the
  // resolve route below is public and must not advertise one.
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Shorten a share link — returns a 6-character code' })
  create(@CurrentUser() user: RequestUser | undefined, @Body() dto: CreateShortLinkDto) {
    return this.links.mint(dto.target, user?.id);
  }

  @Get(':code')
  @Public()
  @ApiOperation({ summary: 'The stored target for a short code (drives /g/:code)' })
  resolve(@Param('code') code: string) {
    return this.links.resolve(code);
  }
}
