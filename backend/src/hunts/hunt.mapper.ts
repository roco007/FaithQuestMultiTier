import type { Prisma } from '../generated/prisma/client.js';

/**
 * Maps a `Hunt` row into the **existing** frontend `HuntGame` contract
 * (`types/hunt.ts`) so `HuntPlay`, `HuntARCamera`, `ShareLink` and the hunts
 * screen keep working unchanged.
 *
 * `characters` is the hunt's stops in authored order (`sequence`), each carrying
 * everything a `HuntCharacter` reads: the place (from the linked `QuestNode`),
 * the clue (H), the key (K), the question gate (Q) and the presentation fields.
 * `route` is the dealt order of stop ids, so a team joining from the server gets
 * exactly the order the hunt was published with.
 */
export interface HuntCharacterDto {
  id: string;
  order: number;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  radiusMeters: number;
  characterType: string;
  characterAssetId?: string;
  sponsorBannerId?: string | null;
  hint: string;
  key?: string;
  questions?: unknown;
  isTreasure?: boolean;
}

export interface HuntDto {
  id: string;
  title: string;
  description: string;
  creatorName: string;
  createdAt: string;
  updatedAt: string;
  endAnnouncement: string;
  endCharacterAssetId?: string | null;
  characters: HuntCharacterDto[];
  route?: string[];
  /** Server-only extras: the join code and lifecycle status. */
  shareCode: string;
  status: string;
}

export interface HuntProgressDto {
  gameId: string;
  joinedAt: string;
  discoveredCharacterIds: string[];
  route?: string[];
  /**
   * The team name (or guest username) the player entered when joining. Nullable:
   * participants created before this column existed never answered the prompt.
   */
  teamName?: string | null;
  status: 'active' | 'completed';
  completedAt?: string | null;
}

/**
 * `POST /hunts/join` returns the hunt plus, for a guest, the token that becomes
 * their handle on this round.
 *
 * Spread rather than a subclass so a signed-in join is byte-for-byte the
 * `HuntDto` it always was — the frontend's existing join path keeps working, and
 * only a guest ever sees the extra key.
 */
export type HuntJoinDto = HuntDto & {
  /** 64 hex chars. Present only when the join was not authenticated. */
  guestToken?: string;
};

export type HuntWithStops = Prisma.HuntGetPayload<{
  include: {
    creator: { select: { username: true; displayName: true } };
    nodes: { include: { questNode: true } };
  };
}>;

export function toHuntDto(hunt: HuntWithStops): HuntDto {
  const nodes = [...hunt.nodes].sort((a, b) => a.sequence - b.sequence);
  const route = Array.isArray(hunt.route)
    ? (hunt.route as unknown[]).filter((id): id is string => typeof id === 'string')
    : undefined;

  return {
    id: hunt.id,
    title: hunt.title,
    description: hunt.description ?? '',
    creatorName: hunt.creator.displayName ?? hunt.creator.username,
    createdAt: hunt.createdAt.toISOString(),
    updatedAt: hunt.updatedAt.toISOString(),
    endAnnouncement: hunt.endAnnouncement,
    endCharacterAssetId: hunt.endCharacterAssetId,
    characters: nodes.map((node) => toHuntCharacterDto(node)),
    ...(route && route.length > 0 ? { route } : {}),
    shareCode: hunt.shareCode,
    status: hunt.status,
  };
}

function toHuntCharacterDto(
  node: Prisma.HuntNodeGetPayload<{ include: { questNode: true } }>,
): HuntCharacterDto {
  return {
    id: node.id,
    order: node.sequence,
    name: node.questNode.title,
    subtitle: node.questNode.subtitle,
    latitude: toNumber(node.questNode.latitude),
    longitude: toNumber(node.questNode.longitude),
    altitudeMeters: node.altitudeMeters,
    radiusMeters: node.questNode.radiusMeters,
    characterType: node.characterType,
    ...(node.characterAssetId ? { characterAssetId: node.characterAssetId } : {}),
    sponsorBannerId: node.sponsorBannerId,
    hint: node.questNode.clue ?? '',
    ...(node.key ? { key: node.key } : {}),
    ...(node.questions ? { questions: node.questions } : {}),
    ...(node.isTreasure ? { isTreasure: true } : {}),
  };
}

export function toHuntProgressDto(
  participant: Prisma.HuntParticipantGetPayload<Record<string, never>>,
  huntId: string,
): HuntProgressDto {
  const discovered = Array.isArray(participant.discoveredNodeIds)
    ? (participant.discoveredNodeIds as unknown[]).filter(
        (id): id is string => typeof id === 'string',
      )
    : [];
  const route = Array.isArray(participant.route)
    ? (participant.route as unknown[]).filter((id): id is string => typeof id === 'string')
    : undefined;

  return {
    gameId: huntId,
    joinedAt: participant.joinedAt.toISOString(),
    discoveredCharacterIds: discovered,
    ...(route && route.length > 0 ? { route } : {}),
    ...(participant.teamName ? { teamName: participant.teamName } : {}),
    status: participant.completed ? 'completed' : 'active',
    completedAt: participant.completedAt?.toISOString() ?? null,
  };
}

function toNumber(value: unknown): number {
  const decimal = value as { toNumber?: () => number };
  return typeof decimal?.toNumber === 'function' ? decimal.toNumber() : Number(value);
}

// ---------------------------------------------------------------------------
// Creator dashboard — one player's whole round
// ---------------------------------------------------------------------------

/** A player counts as "playing now" within this many minutes of the clock. */
export const ACTIVE_WINDOW_MINUTES = 5;

/**
 * Whether `lastSeenAt` is recent enough to call the player live.
 *
 * Null-safe by construction: `lastSeenAt` is null for rows written before
 * heartbeats existed, and comparing `NaN` would silently read as "not active"
 * rather than as missing data.
 */
export function isSeenRecently(lastSeenAt: Date | null, now: Date): boolean {
  if (!lastSeenAt) return false;
  const ageMs = now.getTime() - lastSeenAt.getTime();
  // `ageMs >= 0` rejects a clock that jumped forward and stamped a future time.
  return ageMs >= 0 && ageMs <= ACTIVE_WINDOW_MINUTES * 60 * 1000;
}

/** One stop a player cleared, with the clock on it. */
export interface HuntCheckpointDto {
  /** 1-based position in *this player's* shuffled route. */
  routePosition: number;
  /** The `HuntNode` cleared, so the UI can name the stop. */
  nodeId: string;
  /** Authored order (`HuntNode.sequence`) — shown alongside routePosition. */
  nodeOrder: number;
  stopName: string;
  /**
   * UTC ISO-8601. Deliberately *not* pre-formatted: the browser renders it in
   * the viewer's zone, and the dashboard asks for IST explicitly. Baking a zone
   * into the payload would make every other locale wrong, and ambiguous across
   * daylight-saving changes.
   */
  reachedAt: string;
  /** Milliseconds from this player's `joinedAt`. */
  elapsedMs: number;
}

/** Rows the dashboard reads; kept here so the two mappers cannot drift. */
export type ParticipantWithCheckpoints = Prisma.HuntParticipantGetPayload<{
  include: {
    user: { select: { username: true; displayName: true } };
    checkpoints: true;
  };
}>;

/** `HuntNode` lookup for naming stops: id → authored order + title. */
export interface StopIndex {
  order: number;
  title: string;
}

/** One player's complete record for a hunt. */
export interface HuntPlayerDto {
  participantId: string;
  teamName: string | null;
  /** True when no account is attached — the row a guest produced. */
  isGuest: boolean;
  /** Present only for a linked account, which is how the UI marks the two. */
  accountUsername: string | null;
  accountDisplayName: string | null;

  joinedAt: string;
  lastSeenAt: string | null;
  /** `lastSeenAt` inside the active window — the "playing now" dot. */
  isActive: boolean;
  completed: boolean;
  completedAt: string | null;
  /** Whole-round time. Null while still playing (so the UI shows "so far"). */
  totalElapsedMs: number | null;

  /** Stops cleared against the route length — reads as "3 of 12". */
  stopsCleared: number;
  totalStops: number;
  /** Where they are stuck: the next stop in their own route. */
  currentNodeId: string | null;
  currentStopName: string | null;
  currentRoutePosition: number | null;

  checkpoints: HuntCheckpointDto[];
}

/** `GET /hunts/:huntId/players` — the page of players plus the hunt totals. */
export interface HuntPlayersDto {
  items: HuntPlayerDto[];
  total: number;
  page: number;
  limit: number;
  /** Totals across *every* player of the hunt, not just this page. */
  summary: {
    totalJoined: number;
    playingNow: number;
    completed: number;
    inProgress: number;
  };
}

/**
 * A `HuntParticipant` plus its stops, into a creator-facing row.
 *
 * The two headline questions — "how many are playing right now" and "who is
 * stuck where" — are answered here rather than in the service, so the meanings
 * of *active* and *stuck* are defined in exactly one place.
 */
export function toHuntPlayerDto(
  participant: ParticipantWithCheckpoints,
  stops: Map<string, StopIndex>,
  totalStops: number,
  now: Date,
): HuntPlayerDto {
  const discovered = new Set(
    Array.isArray(participant.discoveredNodeIds)
      ? (participant.discoveredNodeIds as unknown[]).filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
  );
  const route = Array.isArray(participant.route)
    ? (participant.route as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];

  // The next stop in *their* route — the same rule the gate enforces, so the
  // dashboard and the player's own screen can never disagree about where they are.
  const nextRouteIndex = route.findIndex((id) => !discovered.has(id));
  const currentNodeId = nextRouteIndex === -1 ? null : (route[nextRouteIndex] ?? null);

  const joinedAtMs = participant.joinedAt.getTime();
  const finishedMs = participant.completedAt?.getTime() ?? null;

  return {
    participantId: participant.id,
    teamName: participant.teamName,
    isGuest: participant.userId === null,
    accountUsername: participant.user?.username ?? null,
    accountDisplayName: participant.user?.displayName ?? null,

    joinedAt: participant.joinedAt.toISOString(),
    lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
    // A finished round is never "live", however recent its last heartbeat is —
    // the heartbeat is stamped by the very discover that completed the hunt.
    // This must agree with the `summary.playingNow` count, which filters on
    // `completed: false`; deriving both from this one predicate is what keeps
    // the row and the headline number from contradicting each other.
    isActive: !participant.completed && isSeenRecently(participant.lastSeenAt, now),
    completed: participant.completed,
    completedAt: participant.completedAt?.toISOString() ?? null,
    totalElapsedMs: finishedMs === null ? null : finishedMs - joinedAtMs,

    stopsCleared: discovered.size,
    totalStops,
    currentNodeId,
    currentStopName: currentNodeId ? (stops.get(currentNodeId)?.title ?? null) : null,
    currentRoutePosition: currentNodeId === null ? null : nextRouteIndex + 1,

    // Sorted by route position rather than arrival order: a replayed or backfilled
    // event should still read as "stop 4" instead of shifting everything after it.
    checkpoints: [...participant.checkpoints]
      .sort((a, b) => a.routePosition - b.routePosition)
      .map((event) => {
        const stop = stops.get(event.nodeId);
        return {
          routePosition: event.routePosition,
          nodeId: event.nodeId,
          nodeOrder: stop?.order ?? 0,
          stopName: stop?.title ?? 'Unknown stop',
          reachedAt: event.reachedAt.toISOString(),
          elapsedMs: event.elapsedMs,
        };
      }),
  };
}