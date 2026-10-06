import { apiRequest } from './client';
import type {
  HuntDto,
  HuntJoinDto,
  HuntPlayersDto,
  HuntProgressDto,
  Paginated,
} from './types';

/** One authored stop (`POST /hunts` rich shape — see backend `HuntStopDto`). */
export interface HuntStopInput {
  questNodeId: string;
  characterType?: string;
  characterAssetId?: string;
  sponsorBannerId?: string;
  altitudeMeters?: number;
  /** Discovery key for this stop (uppercased server-side). */
  key?: string;
  questions?: Record<string, unknown>[];
  isTreasure?: boolean;

  /**
   * Place details for a creator-placed location — one that is not in the shared
   * catalogue. The server registers it as a `QuestNode` so the hunt can be
   * stored at all; without these the request is refused.
   *
   * Ignored by the server when `questNodeId` does resolve to a catalogue place,
   * so sending them unconditionally is safe and keeps this mapper dumb.
   */
  title?: string;
  subtitle?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  clue?: string;
}

export interface CreateHuntInput {
  title: string;
  description?: string;
  /** Bare quest-node ids/slugs in order (the brief's shape). */
  nodeIds?: string[];
  /** Full stop details (the creator screen's shape) — wins over `nodeIds`. */
  stops?: HuntStopInput[];
  endAnnouncement?: string;
  endCharacterAssetId?: string;
  /** Publish immediately instead of leaving the hunt a DRAFT. */
  publish?: boolean;
}

/** `PATCH /hunts/:huntId` — every field optional; `stops` replaces the list. */
export interface UpdateHuntInput {
  title?: string;
  description?: string;
  endAnnouncement?: string;
  endCharacterAssetId?: string;
  stops?: HuntStopInput[];
}

/** One submitted answer for a stop's reveal questions (server-side gate). */
export interface HuntAnswerInput {
  questionId?: string;
  selectedOptionId?: string;
  text?: string;
}

export interface DiscoverStopInput {
  nodeId: string;
  /** The discovery key — required for keyed stops, validated server-side. */
  key?: string;
  answers?: HuntAnswerInput[];
}

/**
 * `/hunts*` — CRUD, publish, join, round progress and the server-side stop gate.
 *
 * Every call needs a session (the global JWT guard enforces it); list filters
 * select hunts the caller created (`mine`) or joined (`joined`).
 */
export const huntsApi = {
  list(
    query: { mine?: boolean; joined?: boolean; page?: number; limit?: number } = {},
  ): Promise<Paginated<HuntDto>> {
    return apiRequest<Paginated<HuntDto>>('/hunts', { query });
  },

  create(input: CreateHuntInput): Promise<HuntDto> {
    return apiRequest<HuntDto>('/hunts', { method: 'POST', body: input });
  },

  /** Hunt + stops; only the author or a participant may read it. */
  get(huntId: string): Promise<HuntDto> {
    return apiRequest<HuntDto>(`/hunts/${encodeURIComponent(huntId)}`);
  },

  /** Preview a published hunt by its 6-character share code (unauthenticated). */
  findByShareCode(code: string): Promise<HuntDto> {
    return apiRequest<HuntDto>(`/hunts/by-code/${encodeURIComponent(code)}`);
  },

  update(huntId: string, patch: UpdateHuntInput): Promise<HuntDto> {
    return apiRequest<HuntDto>(`/hunts/${encodeURIComponent(huntId)}`, {
      method: 'PATCH',
      body: patch,
    });
  },

  /**
   * PATCH /hunts/:huntId/stops/order — reorder the hunt's stops.
   *
   * `nodeIds` must be **every** `HuntNode` id of this hunt in the wanted order;
   * the server rejects a partial or duplicated list with 422 rather than moving
   * only what it was given.
   *
   * This mutates stop *positions* only — the stop rows keep their ids, so a
   * team's pinned route and progress are unaffected, and a hunt that is already
   * published keeps the route its share link advertised. Use `publish` to deal a
   * fresh route from the new order.
   */
  reorderStops(huntId: string, nodeIds: string[]): Promise<HuntDto> {
    return apiRequest<HuntDto>(
      `/hunts/${encodeURIComponent(huntId)}/stops/order`,
      { method: 'PATCH', body: { nodeIds } },
    );
  },

  remove(huntId: string): Promise<{ success: true }> {
    return apiRequest<{ success: true }>(`/hunts/${encodeURIComponent(huntId)}`, {
      method: 'DELETE',
    });
  },

  /** DRAFT → PUBLISHED; deals a fresh route and returns the updated hunt. */
  publish(huntId: string): Promise<HuntDto> {
    return apiRequest<HuntDto>(`/hunts/${encodeURIComponent(huntId)}/publish`, {
      method: 'POST',
      body: {},
    });
  },

  /**
   * Idempotent: joining twice returns the same hunt without erroring.
   *
   * Works signed-out too — an unauthenticated join returns a `guestToken`, which
   * the caller must keep and present on later `progress`/`discover` calls.
   */
  join(input: {
    shareCode?: string;
    huntId?: string;
    teamName?: string;
    /** An existing guest token, so a re-join lands on the same round. */
    guestToken?: string;
  }): Promise<HuntJoinDto> {
    return apiRequest<HuntJoinDto>('/hunts/join', { method: 'POST', body: input });
  },

  /**
   * The caller's own round: dealt route, discovered stops, active/completed.
   *
   * `guestToken` identifies a guest; ignored when a session is attached, because
   * the server always prefers the account.
   */
  progress(huntId: string, guestToken?: string): Promise<HuntProgressDto> {
    return apiRequest<HuntProgressDto>(
      `/hunts/${encodeURIComponent(huntId)}/progress`,
      guestToken ? { query: { guestToken } } : {},
    );
  },

  /**
   * Clear the next stop in the route. The server re-runs the key/question gate;
   * offline callers keep using the local gate in `utils/keys.ts` /
   * `utils/huntQuestions.ts` (the local result is never persisted as authority).
   */
  discover(
    huntId: string,
    input: DiscoverStopInput & { guestToken?: string },
  ): Promise<HuntProgressDto> {
    return apiRequest<HuntProgressDto>(
      `/hunts/${encodeURIComponent(huntId)}/discover`,
      { method: 'POST', body: input },
    );
  },

  /**
   * POST /hunts/:huntId/location — report the caller's position.
   *
   * Sent on a 3 s timer while a round is in progress (see `useLocationPing`).
   * Fire-and-forget, so it resolves to the round's own progress rather than
   * anything about other players.
   */
  reportLocation(
    huntId: string,
    input: { latitude: number; longitude: number; guestToken?: string },
  ): Promise<HuntProgressDto> {
    return apiRequest<HuntProgressDto>(
      `/hunts/${encodeURIComponent(huntId)}/location`,
      { method: 'POST', body: input },
    );
  },

  /**
   * The creator's progress report: every player with their checkpoint timeline.
   *
   * Author-only — the server answers 403 for anyone else, 401 signed-out.
   */
  players(
    huntId: string,
    query: { page?: number; limit?: number } = {},
  ): Promise<HuntPlayersDto> {
    return apiRequest<HuntPlayersDto>(
      `/hunts/${encodeURIComponent(huntId)}/players`,
      { query },
    );
  },
};
