'use client';

import { useCallback, useEffect, useState } from 'react';
import { huntsApi } from '../api/hunts.api';
import { ApiError, isApiConfigured } from '../api/client';
import { serverIdFor } from '../services/remoteGameRepository';
import type { HuntPlayersDto } from '../api/types';

/** One page of the creator's report, plus its loading and error state. */
export interface UseHuntPlayers {
  data: HuntPlayersDto | null;
  isLoading: boolean;
  /** Set when the report could not be read — a 403, a 401, or no backend. */
  error: string | null;
  /** False when there is nothing to show yet (no hunt, or no backend). */
  hasHunt: boolean;
  page: number;
  setPage: (page: number) => void;
  reload: () => void;
}

/**
 * The creator's progress report for one hunt.
 *
 * Refreshes on a timer because the report's whole point is "who is playing
 * *right now*", and a figure that only updates on manual reload stops being
 * live within seconds. Polling is deliberately modest (every 15s, and only
 * while the tab is visible) because the endpoint exposes other people's rounds
 * and there is no reason to hammer it.
 *
 * Never throws: a failed read renders an explanation instead of an empty table,
 * so "nobody has played yet" and "we could not ask" can never look alike.
 */
export function useHuntPlayers(huntId: string | null): UseHuntPlayers {
  const [data, setData] = useState<HuntPlayersDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (!huntId || !isApiConfigured()) {
      setData(null);
      setError(
        isApiConfigured()
          ? null
          : 'No backend is configured, so there is no progress to report yet.',
      );
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const load = async () => {
      try {
        // `huntId` arrives as a *local* id ("0", "12"…) because the creator
        // screen works in `HuntGame` terms. The server keys hunts by UUID, so
        // the local id has to be crossed over first — sending "0" verbatim
        // 404s against a hunt that exists. Resolved on every load rather than
        // once in an effect, because the sync map is written *after* a save and
        // this panel can mount before that lands.
        const serverId = await serverIdFor(huntId);
        if (cancelled) return;

        // No mapping means this hunt was never accepted by the server, so the
        // report genuinely does not exist. Saying that plainly beats a bare 404:
        // a creator who placed a location the catalogue does not have would
        // otherwise just see "not found" and assume the players are missing.
        if (serverId === huntId) {
          setData(null);
          setError(
            'This game is saved on this device only — the server rejected it, so there is no ' +
              'progress to show yet. Open the game and check that every location is one from the ' +
              'catalogue.',
          );
          return;
        }

        const result = await huntsApi.players(serverId, { page, limit: 50 });
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setData(null);
        setError(describeError(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    const timer = setInterval(() => {
      // A hidden tab is not a place to spend the creator's data.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void load();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [huntId, page, nonce]);

  return { data, isLoading, error, hasHunt: Boolean(huntId), page, setPage, reload };
}

/** How often the report refreshes itself. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Turns a failure into something a creator can act on.
 *
 * The 403 case is called out specifically because it is the one that looks like
 * an empty game: the report is author-only, so a creator who followed a stale
 * link would otherwise be told nobody has played.
 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'Only the creator of this game can see who is playing it.';
    }
    if (error.status === 401) {
      return 'Sign in to see who is playing this game.';
    }
    return error.message || 'The progress report could not be loaded.';
  }
  return 'The progress report could not be loaded. Check your connection and try again.';
}
