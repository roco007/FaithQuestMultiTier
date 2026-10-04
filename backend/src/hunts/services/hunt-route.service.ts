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