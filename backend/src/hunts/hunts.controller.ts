import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HuntsService } from './hunts.service.js';
import { CreateHuntDto, FindHuntsQueryDto, UpdateHuntDto } from './dto/hunt.dto.js';
import { DiscoverHuntStopDto, JoinHuntDto } from './dto/join-hunt.dto.js';
import { CurrentUser, OptionalAuth, type RequestUser } from '../common/decorators/auth.decorators.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';

/**
 * `/api/v1/hunts` — the REST implementation of the frontend's `GameRepository`
 * interface.
 *
 * Authoring, publishing and the creator's player report all require a signed-in
 * player: a hunt carries its discovery keys, so anonymous read access would be
 * anonymous cheating.
 *
 * Joining, a player's own progress and the stop gate are `@OptionalAuth` instead:
 * most players arrive from a share link with no account, and requiring one left
 * the creator's player list silently missing exactly the people a hunt is
 * advertised to. Those three identify a guest by their `guestToken`, which is
 * scoped to the single hunt it was issued for.
 */
@ApiTags('hunts')
@ApiBearerAuth()
@Controller('hunts')
export class HuntsController {
  constructor(private readonly hunts: HuntsService) {}

  @Get()
  @ApiOperation({ summary: 'Hunts created by (?mine) or joined by (?joined) the caller' })
  findAll(@CurrentUser() user: RequestUser, @Query() query: FindHuntsQueryDto) {
    return this.hunts.findAll(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a hunt (stops from `nodeIds` or full `stops` details)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateHuntDto) {
    return this.hunts.create(user.id, dto);
  }

  /**
   * `POST /hunts/join` must be declared before `GET /:huntId` is not enough —
   * Nest matches in declaration order, so the literal route is listed first to
   * keep `/hunts/join` from ever being read as a hunt id.
   */
  @Post('join')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Join a published hunt by share code or id (idempotent, guests allowed)',
  })
  join(@CurrentUser() user: RequestUser | undefined, @Body() dto: JoinHuntDto) {
    return this.hunts.join(user, dto);
  }

  @Get(':huntId')
  @ApiOperation({ summary: 'One hunt with its stops (author or participant only)' })
  findOne(@CurrentUser() user: RequestUser, @Param('huntId') huntId: string) {
    return this.hunts.findOne(huntId, user.id);
  }

  @Patch(':huntId')
  @ApiOperation({ summary: 'Update a hunt (author only)' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('huntId') huntId: string,
    @Body() dto: UpdateHuntDto,
  ) {
    return this.hunts.update(user.id, huntId, dto);
  }

  @Delete(':huntId')
  @ApiOperation({ summary: 'Delete a hunt (author only)' })
  remove(@CurrentUser() user: RequestUser, @Param('huntId') huntId: string) {
    return this.hunts.remove(user.id, huntId);
  }

  @Post(':huntId/publish')
  @ApiOperation({ summary: 'Publish a hunt — deals a fresh route and returns the share code' })
  publish(@CurrentUser() user: RequestUser, @Param('huntId') huntId: string) {
    return this.hunts.publish(user.id, huntId);
  }

  /**
   * The creator's progress report. Declared before `:huntId`'s sibling routes so
   * the literal segment is matched by Nest in declaration order.
   */
  @Get(':huntId/players')
  @ApiOperation({
    summary: "Every player of this hunt with their checkpoint timeline (author only)",
  })
  listPlayers(
    @CurrentUser() user: RequestUser,
    @Param('huntId') huntId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.hunts.listPlayers(user.id, huntId, query);
  }

  @Get(':huntId/progress')
  @OptionalAuth()
  @ApiOperation({ summary: "The caller's own round: route, discovered stops, status" })
  progress(
    @CurrentUser() user: RequestUser | undefined,
    @Param('huntId') huntId: string,
    @Query('guestToken') guestToken?: string,
  ) {
    return this.hunts.getProgress(user, huntId, guestToken);
  }

  @Post(':huntId/discover')
  @OptionalAuth()
  @ApiOperation({ summary: 'Clear the next stop in your route (server-side key + question gate)' })
  discover(
    @CurrentUser() user: RequestUser | undefined,
    @Param('huntId') huntId: string,
    @Body() dto: DiscoverHuntStopDto,
  ) {
    return this.hunts.discover(user, huntId, dto);
  }
}