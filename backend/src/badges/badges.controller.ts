import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BadgesService, type BadgeDto } from './badges.service.js';
import { CurrentUser, OptionalAuth, type RequestUser } from '../common/decorators/auth.decorators.js';

/**
 * `/api/v1/badges`.
 *
 * `@OptionalAuth()`: signed in, each badge carries `isUnlocked`/`unlockedAt`;
 * signed out, the full catalogue is returned with everything locked, which is
 * what the Profile screen shows before sign-in.
 */
@ApiTags('badges')
@Controller('badges')
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: 'Badge catalogue with the caller\'s unlock state' })
  findAll(@CurrentUser() user: RequestUser | undefined): Promise<BadgeDto[]> {
    return this.badges.findAllFor(user?.id);
  }
}