import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import {
  HuntRouteService,
  REORDER_REJECTION_MESSAGES,
  validateReorder,
} from './services/hunt-route.service.js';
import { HuntGateService } from './services/hunt-gate.service.js';
import {
  ACTIVE_WINDOW_MINUTES,
  isSeenRecently,
  toHuntDto,
  toHuntPlayerDto,
  toHuntProgressDto,
  type HuntDto,
  type HuntJoinDto,
  type HuntPlayerDto,
  type HuntPlayersDto,
  type HuntProgressDto,
  type StopIndex,
} from './hunt.mapper.js';
import type {
  CreateHuntDto,
  FindHuntsQueryDto,
  ReorderHuntStopsDto,
  UpdateHuntDto,
} from './dto/hunt.dto.js';
import type { DiscoverHuntStopDto, JoinHuntDto, ReportLocationDto } from './dto/join-hunt.dto.js';
import type { Paginated, PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { RequestUser } from '../common/decorators/auth.decorators.js';
import { Prisma } from '../generated/prisma/client.js';
import { randomShortCode } from '../common/utils/short-code.js';
import { isGuestToken, issueGuestToken } from './guest-identity.js';

const UNIQUE_VIOLATION = 'P2002';

/** Shared include: everything `toHuntDto` reads. */
export const HUNT_INCLUDE = {
  creator: { select: { username: true, displayName: true } },
  nodes: { include: { questNode: true } },
  // `id` is needed by `getProgress` (to find the caller's own row); the rest is
  // exactly what `toHuntDto` reads.
  participants: { select: { id: true, userId: true } },
} satisfies Prisma.HuntInclude;

/**
 * Hunts: authoring, publishing, membership and the served stop gate.
 *
 * The frontend's `GameRepository` interface was written to be swapped for a REST
 * implementation, and this module is that implementation: it speaks the same
 * `HuntGame` / `HuntProgress` shapes (`hunt.mapper.ts`), so no screen changes.
 *
 * Authoring is open to any signed-in player (the existing creator screen has no
 * notion of roles); the first hunt a player creates promotes them to `CREATOR`,
 * which is what the `roles` column is then for — see `backend/README.md`.
 */
@Injectable()
export class HuntsService {
  private readonly logger = new Logger(HuntsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: HuntRouteService,
    private readonly gate: HuntGateService,
  ) {}

  /** `/hunts` — created or joined, always just the caller's own hunts. */
  async findAll(userId: string, query: FindHuntsQueryDto): Promise<Paginated<HuntDto>> {
    const where: Prisma.HuntWhereInput = query.joined
      ? { participants: { some: { userId } } }
      : { creatorId: userId };

    const [total, hunts] = await Promise.all([
      this.prisma.hunt.count({ where }),
      this.prisma.hunt.findMany({
        where,
        include: HUNT_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    return {
      items: hunts.map(toHuntDto),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * `/hunts/:huntId` — the author or a participant may read it.
   *
   * A hunt is *not* world-readable: stops carry their discovery keys, so being
   * able to read one is the same as being able to cheat at it.
   */
  async findOne(huntId: string, userId: string): Promise<HuntDto> {
    const hunt = await this.findEntityOrFail(huntId);
    const isOwner = hunt.creatorId === userId;
    const isParticipant = hunt.participants.some((row) => row.userId === userId);
    if (!isOwner && !isParticipant) {
      throw ApiException.forbidden(
        'FORBIDDEN',
        'Join this hunt before viewing its stops.',
      );
    }
    return toHuntDto(hunt);
  }

  /** `POST /hunts` — creates a DRAFT (or publishes straight away). */
  async create(userId: string, dto: CreateHuntDto): Promise<HuntDto> {
    const stops = await this.resolveStops(userId, dto.stops, dto.nodeIds);

    const hunt = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hunt.create({
        data: {
          title: dto.title,
          description: dto.description?.trim() || null,
          shareCode: await this.allocateShareCode(tx),
          creatorId: userId,
          endAnnouncement: dto.endAnnouncement?.trim() ?? '',
          endCharacterAssetId: dto.endCharacterAssetId?.trim() || null,
          status: dto.publish ? 'PUBLISHED' : 'DRAFT',
          ...(dto.publish ? { publishedAt: new Date() } : {}),
          nodes: {
            create: stops.map((stop, index) => ({
              questNodeId: stop.questNodeId,
              sequence: index + 1,
              characterType: stop.characterType,
              characterAssetId: stop.characterAssetId ?? null,
              sponsorBannerId: stop.sponsorBannerId ?? null,
              altitudeMeters: stop.altitudeMeters,
              key: stop.key ?? null,
              questions: (stop.questions ?? null) as Prisma.InputJsonValue,
              isTreasure: stop.isTreasure,
            })),
          },
        },
        include: HUNT_INCLUDE,
      });

      // A player who authors a hunt is a creator from now on.
      await tx.user.updateMany({
        where: { id: userId, role: 'USER' },
        data: { role: 'CREATOR' },
      });

      return created;
    });

    // Publishing deals the first route — see `publish`.
    return dto.publish ? this.publish(userId, hunt.id) : toHuntDto(hunt);
  }

  /** `PATCH /hunts/:huntId` — author-only. Replacing stops discards the route. */
  async update(userId: string, huntId: string, dto: UpdateHuntDto): Promise<HuntDto> {
    const hunt = await this.findEntityOrFail(huntId);
    this.assertOwner(hunt.creatorId, userId);

    const stops = dto.stops ? await this.resolveStops(userId, dto.stops, undefined) : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (stops) {
        // Replacing the stop list invalidates the dealt order (a route can only
        // name stops that exist) and any progress pinned to it.
        await tx.huntNode.deleteMany({ where: { huntId } });
        await tx.hunt.update({ where: { id: huntId }, data: { route: Prisma.JsonNull } });
        await tx.huntParticipant.updateMany({
          where: { huntId },
          data: { route: Prisma.JsonNull, discoveredNodeIds: [] },
        });
        await tx.huntNode.createMany({
          data: stops.map((stop, index) => ({
            huntId,
            questNodeId: stop.questNodeId,
            sequence: index + 1,
            characterType: stop.characterType,
            characterAssetId: stop.characterAssetId ?? null,
            sponsorBannerId: stop.sponsorBannerId ?? null,
            altitudeMeters: stop.altitudeMeters,
            key: stop.key ?? null,
            questions: (stop.questions ?? null) as Prisma.InputJsonValue,
            isTreasure: stop.isTreasure,
          })),
        });
      }

      return tx.hunt.update({
        where: { id: huntId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.endAnnouncement !== undefined
            ? { endAnnouncement: dto.endAnnouncement.trim() }
            : {}),
          ...(dto.endCharacterAssetId !== undefined
            ? { endCharacterAssetId: dto.endCharacterAssetId.trim() || null }
            : {}),
        },
        include: HUNT_INCLUDE,
      });
    });

    return toHuntDto(updated);
  }

  /**
   * `PATCH /hunts/:huntId/stops/order` — the author reorders their own stops.
   *
   * This is the server *deciding* an order rather than mirroring one. Previously
   * the only way to move a stop was to resend the whole `stops` list via
   * `update()`, which `deleteMany`s every `HuntNode` and recreates the lot — so
   * a reorder also churned every stop id, discarded the hunt's dealt route, and
   * wiped each participant's pinned route and progress. That is a very large
   * blast radius for "swap stops 2 and 3", and it is why the client had to map
   * ids **positionally** (`remoteGameRepository.ts`): stop ids were never stable,
   * so position was the only correspondence available.
   *
   * Here the stops are the *same rows* — only `sequence` moves — so ids stay
   * stable and the client's id mapping survives a reorder untouched.
   *
   * Two deliberate behaviours:
   *
   * 1. **A published hunt keeps its dealt route.** Reordering is an *authoring*
   *    change to the stop list, not a re-publish. Rule 2 (see `resolve`) exists
   *    so a creator editing mid-hunt cannot move the stops a team is walking —
   *    discarding `Hunt.route` here would break the promise that the share link
   *    a player already holds still describes the hunt they joined. The next
   *    explicit `publish` deals a fresh route from the new order.
   * 2. **Participants are never touched.** Their pinned `route` and
   *    `discoveredNodeIds` reference node ids, which this endpoint does not
   *    change, so a live round keeps both its order and its progress.
   *
   * The write is **two-phase** because `HuntNode` carries
   * `@@unique([huntId, sequence])`. Writing the new positions directly would
   * collide the instant two stops swap: moving `a` from 1→2 while `b` still sits
   * at 2 is a duplicate the index refuses. So every stop is first parked at a
   * negative sequence (impossible under the 1..n invariant, so it can never
   * collide), and only then given its final position.
   */
  async reorderStops(
    userId: string,
    huntId: string,
    dto: ReorderHuntStopsDto,
  ): Promise<HuntDto> {
    const hunt = await this.findEntityOrFail(huntId);
    this.assertOwner(hunt.creatorId, userId);

    const requested = dto.nodeIds.map(id => id.trim()).filter(id => id.length > 0);
    const currentIds = hunt.nodes.map(node => node.id);

    const rejection = validateReorder(currentIds, requested);
    if (rejection) {
      throw ApiException.businessRule('VALIDATION_ERROR', REORDER_REJECTION_MESSAGES[rejection]);
    }

    await this.prisma.$transaction(async (tx) => {
      // Phase 1 — park every stop outside the 1..n range. Negatives cannot
      // collide with a live position, so this phase is safe in any order. The
      // exact value does not matter, only that all are distinct and negative.
      for (const [index, node] of hunt.nodes.entries()) {
        await tx.huntNode.update({
          where: { id: node.id },
          data: { sequence: -(index + 1) },
        });
      }

      // Phase 2 — every stop now sits at a unique negative, so any target
      // 1..n is free by the time its owner claims it.
      for (const [index, nodeId] of requested.entries()) {
        await tx.huntNode.update({
          where: { id: nodeId },
          data: { sequence: index + 1 },
        });
      }

      // Touch the hunt so `updatedAt` moves — the creator list sorts by it, and
      // a reorder that does not surface there looks like the press did nothing.
      await tx.hunt.update({ where: { id: huntId }, data: { updatedAt: new Date() } });
    });

    // Re-read rather than mutating the `hunt` we already hold: `toHuntDto`
    // sorts `characters` by `sequence`, so the caller gets the order the database
    // actually holds, not the order that was merely requested.
    const reordered = await this.findEntityOrFail(huntId);
    return toHuntDto(reordered);
  }

  /** `DELETE /hunts/:huntId` — author-only; stops and participants cascade. */
  async remove(userId: string, huntId: string): Promise<{ success: true }> {
    const hunt = await this.findEntityOrFail(huntId);
    this.assertOwner(hunt.creatorId, userId);
    await this.prisma.hunt.delete({ where: { id: huntId } });
    return { success: true };
  }

  /**
   * `POST /hunts/:huntId/publish` — the author flips the hunt live.
   *
   * Every publish deals a fresh route and stores it on the hunt, exactly like
   * the existing "Publish / Save Changes deals a new order" rule. Teams already
   * playing keep the order pinned on their own participant row, so re-publishing
   * never moves a stop under someone's feet.
   */
  async publish(userId: string, huntId: string): Promise<HuntDto> {
    const hunt = await this.findEntityOrFail(huntId);
    this.assertOwner(hunt.creatorId, userId);
    if (hunt.nodes.length === 0) {
      throw ApiException.businessRule(
        'HUNT_NOT_PUBLISHED',
        'Add at least one stop before publishing this hunt.',
      );
    }

    const dealt = this.routes.deal(
      hunt.nodes.map((node) => ({ id: node.id, isTreasure: node.isTreasure })),
    );

    const published = await this.prisma.hunt.update({
      where: { id: huntId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        route: dealt.map((stop) => stop.id),
      },
      include: HUNT_INCLUDE,
    });

    return toHuntDto(published);
  }

  /**
   * `POST /hunts/join` — idempotent membership.
   *
   * Joining twice is not an error: the existing player is returned with the
   * route they already pinned, which is what makes "open the invite link again"
   * safe. The route is dealt once, here, and stored on the participant.
   *
   * Every join asks for a team name (or a guest's username) on the client, so
   * `dto.teamName` normally carries one; a client that predates the prompt
   * falls back to the player's own username, and a re-join that presents a new
   * name updates it — the route and progress are deliberately left alone, since
   * a name is cosmetic and the round under it is not.
   */
  /**
   * `POST /hunts/join` — idempotent, and open to guests.
   *
   * A signed-in player is identified by `user.id`; a guest by the opaque
   * `guestToken` they present, or by a freshly issued one when they present
   * none. The token comes back in the response and is the guest's only handle on
   * their round — which is exactly why it is never derived from anything about
   * the device (see `guest-identity.ts`).
   *
   * Re-joining never moves the round: only a freshly supplied name is written,
   * and the route, progress and completion are left alone, because a name is
   * cosmetic and the round under it is not.
   */
  async join(user: RequestUser | undefined, dto: JoinHuntDto): Promise<HuntJoinDto> {
    const hunt = dto.shareCode
      ? await this.prisma.hunt.findUnique({
          where: { shareCode: dto.shareCode.trim().toUpperCase() },
          include: HUNT_INCLUDE,
        })
      : await this.prisma.hunt.findUnique({
          where: { id: dto.huntId as string },
          include: HUNT_INCLUDE,
        });

    if (!hunt) {
      throw ApiException.notFound(
        'NOT_FOUND',
        'No hunt matches that code. Ask the creator to resend it.',
      );
    }
    if (hunt.status === 'DRAFT' || hunt.status === 'ARCHIVED') {
      throw ApiException.businessRule(
        'HUNT_NOT_PUBLISHED',
        'This hunt has not been published yet.',
      );
    }
    if (hunt.nodes.length === 0) {
      throw ApiException.businessRule(
        'HUNT_NOT_PUBLISHED',
        'This hunt has no stops yet.',
      );
    }

    // A signed-in player is never identified by a guest token, so presenting one
    // alongside a session cannot borrow someone else's round.
    const guestToken = user ? null : (dto.guestToken ?? issueGuestToken());
    const teamName = dto.teamName?.trim() || user?.username || 'Guest';

    const identity: Prisma.HuntParticipantWhereUniqueInput = user
      ? { huntId_userId: { huntId: hunt.id, userId: user.id } }
      : // Non-null asserted by construction: `guestToken` is `null` only when `user`
        // is set, and that is the branch above.
        { huntId_guestToken: { huntId: hunt.id, guestToken: guestToken! } };

    const existing = await this.prisma.huntParticipant.findUnique({ where: identity });
    if (existing) {
      // Already in — only a freshly supplied name and the heartbeat are written.
      await this.prisma.huntParticipant.update({
        where: { id: existing.id },
        data: {
          ...(dto.teamName?.trim() ? { teamName } : {}),
          lastSeenAt: new Date(),
        },
      });
      return { ...toHuntDto(hunt), ...(guestToken ? { guestToken } : {}) };
    }

    // Pin the order now: the hunt's published route when it has one, otherwise a
    // fresh deal (hunts authored before routes existed).
    const publishedRoute = Array.isArray(hunt.route)
      ? (hunt.route as unknown[]).filter((id): id is string => typeof id === 'string')
      : null;
    const route = this.routes
      .resolve(
        hunt.nodes.map((node) => ({ id: node.id, isTreasure: node.isTreasure })),
        null,
        publishedRoute,
      )
      .map((stop) => stop.id);

    try {
      await this.prisma.huntParticipant.create({
        data: {
          huntId: hunt.id,
          userId: user?.id ?? null,
          guestToken,
          teamName,
          route,
          discoveredNodeIds: [],
          lastSeenAt: new Date(),
        },
      });
    } catch (error) {
      // Losing a race with another join of the same hunt is the same as having
      // joined — the unique constraint did its job. The token still has to come
      // back: it is the guest's handle, and they have no other way to get it.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== UNIQUE_VIOLATION
      ) {
        throw error;
      }
    }

    return { ...toHuntDto(hunt), ...(guestToken ? { guestToken } : {}) };
  }

  /**
   * `GET /hunts/:huntId/progress` — the caller's own round.
   *
   * Open to guests too: `guestToken` addresses the row just as a session
   * addresses one, so a guest's own progress screen works with no account.
   */
  async getProgress(
    user: RequestUser | undefined,
    huntId: string,
    guestToken?: string,
  ): Promise<HuntProgressDto> {
    const hunt = await this.findEntityOrFail(huntId);
    const participant = await this.resolveParticipant(hunt.id, user, guestToken);
    if (!participant) {
      throw ApiException.forbidden(
        'HUNT_NOT_JOINED',
        'Join this hunt before tracking its progress.',
      );
    }
    return toHuntProgressDto(participant, hunt.id);
  }

  /**
   * `POST /hunts/:huntId/location` — record this player's current position.
   *
   * Written as a single overwritten slot (`latitude` / `longitude` /
   * `locationAt`) rather than an append, so the database never holds a trail of
   * where somebody walked. A creator asking "where is each team right now" does
   * not need, and cannot get, the path they took to get there.
   *
   * `locationAt` is the **server's** clock. A client-supplied timestamp would let
   * a player backdate a fix to look live hours later, or forward-date one to look
   * fresh — and the creator's map reads staleness off exactly this value.
   *
   * Reported unconditionally while a round is in progress: every player is on the
   * creator's map, and there is no per-player flag to disagree with the
   * coordinates stored beside it.
   */
  async reportLocation(
    user: RequestUser | undefined,
    huntId: string,
    dto: ReportLocationDto,
  ): Promise<HuntProgressDto> {
    const hunt = await this.findEntityOrFail(huntId);
    if (hunt.status === 'DRAFT' || hunt.status === 'ARCHIVED') {
      throw ApiException.businessRule(
        'HUNT_NOT_PUBLISHED',
        'This hunt has not been published yet.',
      );
    }

    const participant = await this.resolveParticipant(hunt.id, user, dto.guestToken);
    if (!participant) {
      throw ApiException.forbidden(
        'HUNT_NOT_JOINED',
        'Join this hunt before reporting your location.',
      );
    }

    const updated = await this.prisma.huntParticipant.update({
      where: { id: participant.id },
      data: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        locationAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    return toHuntProgressDto(updated, hunt.id);
  }

  /**
   * Finds the participant row addressed by this request.
   *
   * A session wins over a guest token, always. That ordering is the security
   * property: presenting someone else's `guestToken` while signed in as yourself
   * lands on *your* row, so a stolen token can never expose or advance a round
   * that is not already yours. A guest is only ever matched on the token, and
   * only within the one hunt it was issued for — `huntId` is always part of the
   * lookup, so the token carries no authority anywhere else.
   */
  private async resolveParticipant(
    huntId: string,
    user: RequestUser | undefined,
    guestToken?: string,
  ): Promise<Prisma.HuntParticipantGetPayload<Record<string, never>> | null> {
    if (user) {
      return this.prisma.huntParticipant.findUnique({
        where: { huntId_userId: { huntId, userId: user.id } },
      });
    }
    if (!guestToken || !isGuestToken(guestToken)) return null;
    return this.prisma.huntParticipant.findUnique({
      where: { huntId_guestToken: { huntId, guestToken } },
    });
  }

  /**
   * `GET /hunts/:huntId/players` — the creator's progress report.
   *
   * Author-only, and enforced by `assertOwnsHunt` before a single participant row
   * is read: this is the one endpoint that exposes other people's rounds, so a
   * signed-in non-creator gets a 403 rather than an empty list that would look
   * like "nobody has played yet".
   *
   * The counts in `summary` are computed over every player rather than this
   * page, so "12 playing now" does not silently become "3 playing now" on page 2.
   */
  async listPlayers(
    userId: string,
    huntId: string,
    query: PaginationQueryDto,
  ): Promise<HuntPlayersDto> {
    const hunt = await this.findEntityOrFail(huntId);
    this.assertOwnsHunt(hunt.creatorId, userId, 'Only the creator can see who is playing.');

    const now = new Date();
    const include = {
      user: { select: { username: true, displayName: true } },
      // Route order, oldest first: the report reads as a timeline.
      checkpoints: { orderBy: { routePosition: 'asc' as const } },
    } satisfies Prisma.HuntParticipantInclude;

    const [total, players, completed, active, recent] = await Promise.all([
      this.prisma.huntParticipant.count({ where: { huntId: hunt.id } }),
      this.prisma.huntParticipant.findMany({
        where: { huntId: hunt.id },
        include,
        // Newest joiner first, then by name — a stable, human order rather than
        // an arbitrary one that would reshuffle between pages.
        orderBy: [{ joinedAt: 'desc' }, { teamName: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.huntParticipant.count({ where: { huntId: hunt.id, completed: true } }),
      // Two cheap counts stand in for a scan of every row: the heartbeat window
      // is the only thing that decides "playing now".
      this.prisma.huntParticipant.count({ where: { huntId: hunt.id, completed: false } }),
      this.prisma.huntParticipant.count({
        where: {
          huntId: hunt.id,
          completed: false,
          lastSeenAt: { gte: new Date(now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000) },
        },
      }),
    ]);

    const stops = new Map<string, StopIndex>(
      hunt.nodes.map((node) => [
        node.id,
        { order: node.sequence, title: node.questNode.title },
      ]),
    );

    return {
      items: players.map((player) => toHuntPlayerDto(player, stops, hunt.nodes.length, now)),
      total,
      page: query.page,
      limit: query.limit,
      summary: {
        totalJoined: total,
        playingNow: recent,
        completed,
        inProgress: active,
      },
    };
  }

  /** The creator-only gate used by the endpoints that expose player data. */
  private assertOwnsHunt(creatorId: string, userId: string, message: string): void {
    if (creatorId !== userId) {
      throw ApiException.forbidden('FORBIDDEN', message);
    }
  }

  /**
   *
   * The client's own gate (key + questions, offline) is unchanged; this endpoint
   * exists so the *persisted* state can only be advanced through the real rules.
   * Order is enforced as well: a team may only clear the next stop in their own
   * route, which is what makes tailgating another team useless.
   */
  async discover(
    user: RequestUser | undefined,
    huntId: string,
    dto: DiscoverHuntStopDto,
  ): Promise<HuntProgressDto> {
    const hunt = await this.findEntityOrFail(huntId);
    if (hunt.status === 'DRAFT' || hunt.status === 'ARCHIVED') {
      throw ApiException.businessRule(
        'HUNT_NOT_PUBLISHED',
        'This hunt has not been published yet.',
      );
    }

    const participant = await this.resolveParticipant(hunt.id, user, dto.guestToken);
    if (!participant) {
      throw ApiException.forbidden(
        'HUNT_NOT_JOINED',
        'Join this hunt before discovering its stops.',
      );
    }
    if (participant.completed) {
      throw ApiException.businessRule(
        'HUNT_COMPLETED',
        'You have already finished this hunt.',
      );
    }

    const discovered = asStringArray(participant.discoveredNodeIds);
    const publishedRoute = asStringArray(hunt.route);
    const pinnedRoute = asStringArray(participant.route);
    const route = this.routes.resolve(
      hunt.nodes.map((node) => ({ id: node.id, isTreasure: node.isTreasure })),
      pinnedRoute.length > 0 ? pinnedRoute : null,
      publishedRoute.length > 0 ? publishedRoute : null,
    );

    // The next stop in *this team's* route — never the authored order.
    const nextStop = route.find((stop) => !discovered.includes(stop.id));
    if (!nextStop) {
      throw ApiException.businessRule(
        'HUNT_COMPLETED',
        'There are no stops left in your route.',
      );
    }
    if (nextStop.id !== dto.nodeId) {
      throw ApiException.businessRule(
        'OUT_OF_ORDER_DISCOVERY',
        'That is not your next stop — follow your own route.',
        { expectedNodeId: nextStop.id },
      );
    }

    const stop = hunt.nodes.find((node) => node.id === nextStop.id);
    if (!stop) {
      throw ApiException.notFound('NOT_FOUND', 'That stop is no longer part of this hunt.');
    }

    const verdict = this.gate.evaluate(
      { key: stop.key, questions: stop.questions },
      dto.key,
      dto.answers,
    );
    if (!verdict.ok) {
      if (verdict.reason === 'INVALID_KEY') {
        throw ApiException.businessRule(
          'INVALID_KEY',
          "That key doesn't match. Use the key on screen — it is the one handed over for this location.",
        );
      }
      throw ApiException.businessRule(
        'WRONG_ANSWER',
        "Not quite — answer this stop's questions to continue.",
        verdict.questionId ? { questionId: verdict.questionId } : undefined,
      );
    }

    const updatedIds = [...discovered, stop.id];
    const isComplete = updatedIds.length >= route.length;
    const reachedAt = new Date();
    // Position in *their* route, which the creator's report shows as "stop N".
    // `route` is the full dealt order and this stop is in it, so the index is
    // always defined; the fallback keeps a hypothetical future reordering of
    // `discover` from writing a misleading 0 rather than throwing.
    const routePosition = route.findIndex((stop) => stop.id === nextStop.id) + 1;

    // One transaction: a checkpoint without the progress it describes (or the
    // reverse) would leave the creator's report disagreeing with the player's
    // own screen.
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.huntParticipant.update({
        where: { id: participant.id },
        data: {
          discoveredNodeIds: updatedIds,
          currentNode: updatedIds.length,
          completed: isComplete,
          completedAt: isComplete ? reachedAt : null,
          lastSeenAt: reachedAt,
        },
      });

      try {
        await tx.huntCheckpointEvent.create({
          data: {
            participantId: participant.id,
            huntId: hunt.id,
            nodeId: stop.id,
            routePosition,
            reachedAt,
            // Clamped at zero: a clock that stepped backwards mid-round must not
            // record a negative duration for a stop.
            elapsedMs: Math.max(0, reachedAt.getTime() - participant.joinedAt.getTime()),
          },
        });
      } catch (error) {
        // The offline queue can re-send a stop that already landed. The unique
        // index makes the duplicate a no-op instead of a second timeline entry.
        if (!isUniqueViolation(error)) throw error;
      }

      return row;
    });

    return toHuntProgressDto(updated, hunt.id);
  }

  /**
   * Normalises the two accepted request shapes into stop rows.
   *
   * `stops` (the creator screen's rich form) wins; a bare `nodeIds` list — the
   * shape the brief documents — produces default stops. Each id is resolved
   * against the catalogue, so a typo is a 404 naming the id rather than a
   * foreign-key error.
   */
  private async resolveStops(
    creatorId: string,
    stops: CreateHuntDto['stops'],
    nodeIds: string[] | undefined,
  ) {
    const input = stops?.length
      ? stops.map((stop) => ({
          ...stop,
          isTreasure: stop.isTreasure ?? false,
        }))
      : (nodeIds ?? []).map((questNodeId) => ({
          questNodeId,
          characterType: 'guardian',
          altitudeMeters: 0,
          isTreasure: false,
        }));

    if (input.length === 0) {
      throw ApiException.badRequest(
        'VALIDATION_ERROR',
        'A hunt needs at least one stop (send `stops` or `nodeIds`).',
      );
    }

    const ids = input.map((stop) => stop.questNodeId);
    const questNodes = await this.prisma.questNode.findMany({
      where: { OR: [{ id: { in: ids } }, { slug: { in: ids } }] },
      select: { id: true, slug: true },
    });
    const byKey = new Map<string, string>();
    for (const node of questNodes) {
      byKey.set(node.id, node.id);
      byKey.set(node.slug, node.id);
    }

    // A stop the catalogue does not know is a creator-placed location, not an
    // error: register it so the hunt can be stored at all. Done up front (and
    // deduplicated) so a hunt that reuses one place twice registers it once.
    const custom = new Map<string, string>();
    for (const stop of input) {
      if (byKey.has(stop.questNodeId) || custom.has(stop.questNodeId)) continue;
      custom.set(stop.questNodeId, await this.registerCreatorPlace(creatorId, stop));
    }

    const resolved = input.map((stop) => {
      const questNodeId = byKey.get(stop.questNodeId) ?? custom.get(stop.questNodeId);
      if (!questNodeId) {
        throw ApiException.notFound(
          'NOT_FOUND',
          `No quest matches "${stop.questNodeId}" — add it to the catalogue first.`,
        );
      }
      return {
        questNodeId,
        characterType: stop.characterType ?? 'guardian',
        characterAssetId: stop.characterAssetId?.trim() || undefined,
        sponsorBannerId: stop.sponsorBannerId?.trim() || undefined,
        altitudeMeters: stop.altitudeMeters ?? 0,
        // Keys are stored normalised so the gate's comparison is exact.
        key: stop.key ? this.gate.normaliseKey(stop.key) : undefined,
        questions: Array.isArray(stop.questions) ? stop.questions : undefined,
        isTreasure: stop.isTreasure,
      };
    });

    // A hunt may tag at most one treasure stop. When none is tagged, the last
    // stop is the end, so a bare `nodeIds` list behaves like the published form.
    if (!resolved.some((stop) => stop.isTreasure)) {
      resolved[resolved.length - 1].isTreasure = true;
    }
    return resolved;
  }

  /**
   * Registers a creator-placed location as a `QuestNode`, and returns its id.
   *
   * A `HuntNode` cannot exist without a `QuestNode` — that row is where the
   * place's coordinates, radius and clue live, and they are what tell a player
   * they have arrived. So a hunt built on an arbitrary location used to be
   * unstorable: `POST /hunts` answered 404 and the hunt stayed on the device,
   * invisible to the creator's own progress report. Registering the place fixes
   * that at the only level that can.
   *
   * Three deliberate choices:
   *
   * 1. **`isActive: false`.** These are hunt locations, not public quests, so
   *    they stay out of `GET /quests` (which filters on it by default) and out
   *    of the standalone "complete this quest" flow. Nothing in the hunt path
   *    consults it — `HuntGateService` gates on the stop's own key and questions.
   * 2. **A slug namespaced by creator.** The client's id is a device-local
   *    `char_…`, and two creators could independently generate the same one;
   *    a bare slug would let one silently overwrite the other's place. The
   *    creator prefix makes an upsert safe, and idempotent for the same
   *    creator re-saving the same hunt.
   * 3. **Coordinates are required.** Without them there is no place to register,
   *    and guessing one would put players' pins in the wrong spot — so the
   *    original, clearer 404 stands.
   */
  private async registerCreatorPlace(
    creatorId: string,
    stop: NonNullable<CreateHuntDto['stops']>[number],
  ): Promise<string> {
    const { latitude, longitude } = stop;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw ApiException.notFound(
        'NOT_FOUND',
        `No quest matches "${stop.questNodeId}" — add it to the catalogue first, or ` +
          'send the place\'s latitude and longitude so it can be registered.',
      );
    }

    // The client's id is not trusted as a slug: it is trimmed to a safe charset
    // and prefixed, so a hostile value cannot become an arbitrary catalog key.
    const localPart = stop.questNodeId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'place';
    const slug = `creator_${creatorId.slice(0, 8)}_${localPart}`;

    const node = await this.prisma.questNode.upsert({
      where: { slug },
      create: {
        slug,
        title: stop.title?.trim() || 'Untitled location',
        subtitle: stop.subtitle?.trim() || '',
        description: '',
        // HUNT_STOP has no puzzle payload; the stop's own key + questions are the
        // gate, so nothing here is ever played as a standalone quest.
        type: 'LOCATION',
        latitude,
        longitude,
        radiusMeters: stop.radiusMeters ?? 50,
        clue: stop.clue?.trim() || null,
        category: 'creator',
        xpReward: 0,
        isActive: false,
      },
      update: {
        // Re-saving the same place updates it in place, so a creator who moved a
        // location sees the move rather than accumulating dead copies.
        ...(stop.title?.trim() ? { title: stop.title.trim() } : {}),
        ...(stop.subtitle?.trim() !== undefined ? { subtitle: stop.subtitle?.trim() ?? '' } : {}),
        latitude,
        longitude,
        radiusMeters: stop.radiusMeters ?? 50,
        ...(stop.clue !== undefined ? { clue: stop.clue?.trim() || null } : {}),
      },
      select: { id: true },
    });

    this.logger.log(`Registered creator location "${slug}" for hunt creation`);
    return node.id;
  }

  /**
   * Allocates a join code that is unique across the table.
   *
   * Retried a handful of times against `Hunt.shareCode @unique`: with a 32-char
   * alphabet and 6 characters there are ~1e9 codes, so a collision is vanishingly
   * rare, but "vanishingly rare" and "handled" are different things.
   */
  private async allocateShareCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = randomShortCode();
      const clash = await tx.hunt.findUnique({
        where: { shareCode: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
      this.logger.warn(`Share-code collision on ${candidate}, retrying`);
    }
    throw ApiException.conflict(
      'CONFLICT',
      'Could not allocate a hunt code — please try again.',
    );
  }

  /** Preview a published hunt by its 6-character share code (public/unauthenticated). */
  async findByShareCode(code: string): Promise<HuntDto> {
    const hunt = await this.prisma.hunt.findUnique({
      where: { shareCode: code.trim().toUpperCase() },
      include: HUNT_INCLUDE,
    });
    if (!hunt || (hunt.status !== 'PUBLISHED' && hunt.status !== 'ACTIVE')) {
      throw ApiException.notFound('NOT_FOUND', 'No published hunt matches that code.');
    }
    return toHuntDto(hunt);
  }

  /** Shared lookup used by every method above. */
  private async findEntityOrFail(huntId: string) {
    const trimmed = huntId.trim();
    const isShareCode = /^[A-Za-z0-9]{6}$/.test(trimmed);
    const hunt = isShareCode
      ? await this.prisma.hunt.findUnique({
          where: { shareCode: trimmed.toUpperCase() },
          include: HUNT_INCLUDE,
        })
      : await this.prisma.hunt.findUnique({
          where: { id: trimmed },
          include: HUNT_INCLUDE,
        });
    if (!hunt) {
      throw ApiException.notFound('NOT_FOUND', 'That hunt does not exist.');
    }
    return hunt;
  }

  private assertOwner(creatorId: string, userId: string): void {
    if (creatorId !== userId) {
      throw ApiException.forbidden(
        'FORBIDDEN',
        "Only the hunt's creator can change it.",
      );
    }
  }
}

/** `Json?` columns come back as `unknown`; this narrows them to string arrays. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * True when Prisma reported a unique-constraint violation.
 *
 * Shared by every "write, and tolerate losing the race" path in this service —
 * the join, and the checkpoint write inside `discover`. A collision there always
 * means the same thing: somebody else got there first, and the existing row is
 * the correct answer.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION
  );
}