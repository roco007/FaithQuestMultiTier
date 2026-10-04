import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProgressService, type ProgressSummary } from './progress.service.js';
import { CurrentUser, type RequestUser } from '../common/decorators/auth.decorators.js';

/** `/api/v1/progress` — the authenticated player's persistent progress. */
@ApiTags('progress')
@ApiBearerAuth()
@Controller('progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get()
  @ApiOperation({ summary: 'Current level, XP, streak and completion counts' })
  @ApiResponse({
    status: 200,
    description:
      '{ level, totalXp, currentXp, xpForNextLevel, rankTitle, currentStreak, longestStreak, completedQuests, completedHunts }',
  })
  get(@CurrentUser() user: RequestUser): Promise<ProgressSummary> {
    return this.progress.getSummary(user.id);
  }
}