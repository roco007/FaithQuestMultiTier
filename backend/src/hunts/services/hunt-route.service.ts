import { Injectable } from '@nestjs/common';

/**
 * Route dealing — the server-side mirror of `utils/huntRoute.ts`.
 *
 * The rule the existing game depends on: **the deal happens when the hunt is
 * published**, the treasure location is held back and appended last, and a round
 * already in progress keeps the order it joined with (so a creator re-publishing
 * mid-hunt cannot move the stops under a team's feet).
 *
 * `utils/huntRoute.ts` remains in the frontend as the offline fallback and is
 * commented as such; this implementation is the authority for anything the
 * server persists.
 */
export interface Dealable<T> {
  id: string;
  isTreasure: boolean;
}

/**
 * Why a reorder request was refused, or null when it is a valid permutation.
 *
 * Returned rather than thrown so the check is a pure function of its inputs and
 * can be unit-tested without a database; `HuntsService.reorderStops` turns a
 * non-null result into the 422.
 */
export type ReorderRejection = 'DUPLICATE_ID' | 'UNKNOWN_ID' | 'COUNT_MISMATCH';

/**
 * Checks that `requestedIds` is an exact permutation of `currentIds`.
 *
 * This is the whole safety argument for the reorder endpoint, so it is
 * deliberately strict rather than lenient:
 *
 * - **Exact permutation required.** Not "a prefix", not "a subset". A partial
 *   list would either strand stops at their old positions (leaving duplicate
 *   `sequence` values the unique index refuses) or silently renumber stops the
 *   caller never mentioned — and a stop that moves without being named is
 *   exactly the "moved a stop under a team's feet" outcome rule 2 forbids.
 * - **Checked against this hunt's own stops.** An id from another hunt (or a
 *   `QuestNode` id, or a guess) fails `UNKNOWN_ID`, so the endpoint can never
 *   reorder one hunt using another hunt's stops.
 * - **Duplicates rejected explicitly.** `[a, a, b]` would pass a naive
 *   "same size, all known" check while leaving `b` out of the new order; naming
 *   the fault is what lets the caller fix it.
 *
 * Order of checks is the order a caller most likely needs to hear about: a
 * repeated id is a client bug, an unknown id is a stale id, and a short list is
 * the common "I only sent the ones I moved" mistake.
 */
export function validateReorder(
  currentIds: readonly string[],
  requestedIds: readonly string[],
): ReorderRejection | null {
  const current = new Set(currentIds);

  if (new Set(requestedIds).size !== requestedIds.length) return 'DUPLICATE_ID';

  const unknown = requestedIds.filter(id => !current.has(id));
  if (unknown.length > 0) return 'UNKNOWN_ID';

  // With duplicates and unknown ids already excluded, equal length is enough to
  // prove nothing was left out — but saying so explicitly keeps this correct if
  // the checks above are ever reordered.
  if (requestedIds.length !== current.size) return 'COUNT_MISMATCH';

  return null;
}

/** Human-facing text for each rejection, thrown as a 422 by the service. */
export const REORDER_REJECTION_MESSAGES: Record<ReorderRejection, string> = {
  DUPLICATE_ID: 'The same stop is listed twice — send each stop exactly once.',
  UNKNOWN_ID: 'That list names a stop this hunt does not have.',
  COUNT_MISMATCH: 'Reordering must list every stop of the hunt, not just the ones moved.',
};

@Injectable()
export class HuntRouteService {
  /** Freshly dealt order: walkable stops shuffled, treasure last. */
  deal<T extends Dealable<unknown>>(nodes: T[]): T[] {
    const treasure = nodes.find((node) => node.isTreasure) ?? null;
    const walkable = nodes.filter((node) => !node.isTreasure);
    const shuffled = this.shuffle(walkable);
    return treasure ? [...shuffled, treasure] : shuffled;
  }

  /**
   * The order a specific team plays.
   *
   * Precedence: the participant's pinned route → the hunt's published route →
   * a fresh deal. Everything added to the hunt since the team joined is appended
   * before the treasure, exactly like `dealStops` in the frontend.
   *
   * Stale, duplicated and treasure ids in either stored route are ignored (the
   * treasure always closes the route, so it is appended rather than read from
   * the stored order) — mirroring `stopsFromIds` in `utils/huntRoute.ts`. A
   * previous revision kept the treasure inside `stops` and appended it again,
   * handing every team a duplicated final stop.
   */
  resolve<T extends Dealable<unknown>>(
    nodes: T[],
    pinnedRouteIds?: string[] | null,
    publishedRouteIds?: string[] | null,
  ): T[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const treasure = nodes.find((node) => node.isTreasure) ?? null;
    const walkable = nodes.filter((node) => !node.isTreasure);

    const fromIds = (ids?: string[] | null): T[] => {
      if (!ids) return [];
      const stops: T[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        const node = byId.get(id);
        if (!node || seen.has(node.id) || node.isTreasure) continue;
        stops.push(node);
        seen.add(node.id);
      }
      return stops;
    };

    const fromPinned = fromIds(pinnedRouteIds);
    const fromPublished = fromIds(publishedRouteIds);
    const stops =
      fromPinned.length > 0
        ? fromPinned
        : fromPublished.length > 0
          ? fromPublished
          : [...walkable];

    const known = new Set(stops.map((node) => node.id));
    const added = nodes.filter((node) => !node.isTreasure && !known.has(node.id));

    // The treasure always closes the route; a hunt that tags none simply ends on
    // the last location its dealt order produced.
    return treasure ? [...stops, ...added, treasure] : [...stops, ...added];
  }

  /**
   * Fisher–Yates with `Math.random`.
   *
   * Deliberately not cryptographically seeded: this decides walking order, not
   * security, and an unpredictable-but-unfair-proof deal is not needed. It does
   * mean the same hunt can be dealt differently on two servers, which is why the
   * dealt order is *stored* (on `Hunt.route`) rather than recomputed per request.
   */
  private shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}