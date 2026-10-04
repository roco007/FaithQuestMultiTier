import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { QuestsService } from './quests.service.js';
import { QuestCompletionService } from './services/quest-completion.service.js';
import {
  CompleteQuestDto,
  FindQuestsQueryDto,
  QuestCompletionResultDto,
} from './dto/quest.dto.js';
import { CurrentUser, OptionalAuth, type RequestUser } from '../common/decorators/auth.decorators.js';
import { ApiException } from '../common/exceptions/api.exception.js';

/**
 * `/api/v1/quests`.
 *
 * Reads are `@OptionalAuth()`: the map must render the catalogue before anyone
 * signs in, exactly as it did when the nodes were a static JSON import. The
 * completion endpoint is the opposite — it is the one place the server must know
 * who is asking, so it requires a token.
 */
@ApiTags('quests')
@Controller('quests')
export class QuestsController {
  constructor(
    private readonly quests: QuestsService,
    private readonly completions: QuestCompletionService,
  ) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: 'Quest catalogue (paginated, filterable)' })
  @ApiResponse({ status: 200, description: '{ items, total, page, limit }' })
  findAll(@Query() query: FindQuestsQueryDto) {
    return this.quests.findAll(query);
  }

  @Get(':questId')
  @OptionalAuth()
  @ApiOperation({ summary: 'One quest (accepts the UUID or the catalogue slug)' })
  @ApiParam({ name: 'questId', example: 'node_01_chapel' })
  findOne(@Param('questId') questId: string) {
    return this.quests.findOne(questId);
  }

  @Post(':questId/complete')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Complete a quest — the server verifies the player\'s position and awards the rewards',
  })
  @ApiResponse({ status: 201, type: QuestCompletionResultDto })
  @ApiResponse({ status: 409, description: 'QUEST_ALREADY_COMPLETED' })
  @ApiResponse({ status: 422, description: 'OUTSIDE_QUEST_RADIUS | QUEST_INACTIVE' })
  complete(
    @CurrentUser() user: RequestUser | undefined,
    @Param('questId') questId: string,
    @Body() dto: CompleteQuestDto,
  ): Promise<QuestCompletionResultDto> {
    if (!user) {
      throw ApiException.unauthorized(
        'UNAUTHORIZED',
        'Sign in to record a quest completion.',
      );
    }
    return this.completions.completeQuest(user.id, questId, dto);
  }
}