import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeaderboardService, type LeaderboardEntryDto } from './leaderboard.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CurrentUser, OptionalAuth, type RequestUser } from '../common/decorators/auth.decorators.js';
import { ApiException } from '../common/exceptions/api.exception.js';

/** `/api/v1/leaderboard` — paginated standings, plus the caller's own rank. */
@ApiTags('leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: 'Paginated standings, ranked by total XP' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.leaderboard.findAll(query.page, query.limit);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The caller\'s standing' })
  findMe(@CurrentUser() user: RequestUser | undefined): Promise<LeaderboardEntryDto> {
    if (!user) {
      throw ApiException.unauthorized('UNAUTHORIZED', 'Sign in to see your standing.');
    }
    return this.leaderboard.findMe(user.id).then((entry) => {
      if (!entry) {
        throw ApiException.notFound('NOT_FOUND', "That player isn't on the board.");
      }
      return entry;
    });
  }
}