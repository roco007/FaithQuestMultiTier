/**
 * Response shapes of the NestJS backend (`/api/v1`), mirrored as plain types so
 * the frontend never stringly-types an API payload.
 *
 * These intentionally track the backend DTOs 1:1 (see `backend/src/**` for the
 * authoritative definitions); UI-facing mappings live next to the calls that
 * need them (e.g. `toChurchNode` in `quests.api.ts`).
 */

export type UserRole = 'USER' | 'CREATOR' | 'ADMIN';

/** The `user` object returned by auth endpoints and `GET /users/me`. */
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole | string;
  totalXp: number;
  level: number;
  createdAt: string;
}

/** Response of `POST /auth/register` | `/auth/login` | `/auth/refresh`. */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: AuthUser;
}

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** `GET /progress` — the player's live summary (also embedded in the profile). */
export interface ProgressSummary {
  level: number;
  totalXp: number;
  currentXp: number;
  xpForNextLevel: number;
  rankTitle: string;
  currentStreak: number;
  longestStreak: number;
  completedQuests: number;
  completedHunts: number;
  lastActiveAt: string | null;
}

/** `GET | PATCH /users/me`. */
export interface UserProfile extends AuthUser {
  progress: ProgressSummary;
}

export interface UpdateProfileInput {
  displayName?: string;
  avatarUrl?: string | null;
  username?: string;
}

/** Every backend collection endpoint returns this envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** `GET /badges` — the catalogue plus the caller's unlock state (bare array). */
export interface BadgeEntry {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  category: string | null;
  isUnlocked: boolean;
  unlockedAt?: string;
}

/** `GET /inventory` — items held (bare array). */
export interface InventoryEntry {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: string;
  quantity: number;
  obtainedAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  totalXp: number;
  level: number;
}

/** Reward block attached to every quest node (`QuestNode.reward`). */
export interface NodeRewardDto {
  xp: number;
  badgeId?: string;
  badgeTitle?: string;
  badgeIcon?: string;
  itemId?: string;
  itemTitle?: string;
  itemDescription?: string;
  itemRarity?: string;
}

/** `GET /quests` / `GET /quests/:id` — the server-side quest catalogue row. */
export interface QuestNodeDto {
  /** Catalogue id (`node_01_chapel`) — what the completion endpoint accepts. */
  id: string;
  /** The UUID primary key in MySQL (clients never need to send it). */
  serverId: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  type: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  clueHint: string;
  /** Parsed puzzle payload — shaped like the frontend's `Puzzle` union. */
  puzzle: unknown;
  category: string | null;
  iconName: string | null;
  xpReward: number;
  isActive: boolean;
  reward: NodeRewardDto;
}

/** Response of `POST /quests/:id/complete` — everything the celebration UI needs. */
export interface QuestCompletionResult {
  status: string;
  questId: string;
  xpEarned: number;
  totalXp: number;
  level: number;
  currentXp: number;
  xpForNextLevel: number;
  rankTitle: string;
  leveledUp: boolean;
  newBadge?: { id: string; slug: string; name: string; icon: string };
  newItem?: {
    id: string;
    slug: string;
    name: string;
    description: string;
    rarity: string;
  };
  distanceMeters: number;
  completedAt: string;
}

/** One stop of a hunt as served by the backend (mirrors `hunt.mapper.ts`). */
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

/** A hunt with its stops in authored order — superset of the frontend `HuntGame`. */
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
  /** This team's dealt stop order (present once the hunt was published). */
  route?: string[];
  shareCode: string;
  status: string;
}

/** Per-player round state — matches the frontend `HuntProgress` contract. */
export interface HuntProgressDto {
  gameId: string;
  joinedAt: string;
  discoveredCharacterIds: string[];
  route?: string[];
  /**
   * Team name (or guest username) chosen at join. Nullable on the server — a
   * participant that predates the join prompt never supplied one.
   */
  teamName?: string | null;
  status: 'active' | 'completed';
  completedAt?: string | null;
}

/**
 * `POST /hunts/join` — the hunt, plus a guest's handle on their own round.
 *
 * A signed-in join is exactly `HuntDto`; only a guest sees `guestToken`, which
 * they must store and present on every later `progress`/`discover` call.
 */
export type HuntJoinDto = HuntDto & {
  /** 64 hex chars. Present only when the join was not authenticated. */
  guestToken?: string;
};

/** One stop a player cleared, with the clock on it. */
export interface HuntCheckpointDto {
  /** 1-based position in *this player's* shuffled route. */
  routePosition: number;
  nodeId: string;
  /** Authored order — shown alongside routePosition. */
  nodeOrder: number;
  stopName: string;
  /** UTC ISO-8601. Format for display with `formatIst` — never at the source. */
  reachedAt: string;
  /** Milliseconds from this player's join. */
  elapsedMs: number;
}

/** One player's whole round, as the creator's report shows it. */
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
  /** Recent heartbeat on an unfinished round — the "playing now" dot. */
  isActive: boolean;
  completed: boolean;
  completedAt: string | null;
  /** Whole-round time; null while still playing. */
  totalElapsedMs: number | null;

  stopsCleared: number;
  totalStops: number;
  /** Where they are stuck: the next stop in their own route. */
  currentNodeId: string | null;
  currentStopName: string | null;
  currentRoutePosition: number | null;

  /**
   * Last reported position, all three null when there is nothing to show.
   *
   * Null covers three cases the creator must not read as one: the player never
   * consented to share, they consented but have not pinged yet, or the fix has
   * gone stale. `locationAt` is the server's timestamp, so the map can grey out
   * an old fix instead of presenting a parked player as if they were live.
   */
  latitude: number | null;
  longitude: number | null;
  locationAt: string | null;

  checkpoints: HuntCheckpointDto[];
}

/** `GET /hunts/:huntId/players` — a page of players plus the hunt totals. */
export interface HuntPlayersDto {
  items: HuntPlayerDto[];
  total: number;
  page: number;
  limit: number;
  /** Totals across every player of the hunt, not just this page. */
  summary: {
    totalJoined: number;
    playingNow: number;
    completed: number;
    inProgress: number;
  };
}

/**
 * `POST /links` and `GET /links/:code` — a 6-character short code and the
 * invite it opens.
 */
export interface ShortLinkDto {
  /** e.g. `MQ7X91` — the code, not the whole URL. */
  code: string;
  /**
   * Path + fragment of the invite (`/games#join=…`), never an absolute URL:
   * the server drops the origin so a short link cannot redirect off this app.
   */
  target: string;
}


