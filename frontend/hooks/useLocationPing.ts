'use client';

import { useEffect, useRef } from 'react';
import { huntsApi } from '../api/hunts.api';
import { isApiConfigured } from '../api/client';
import { readGuestToken, serverIdFor } from '../services/remoteGameRepository';
import type { LocationCoordinates } from '../types/game';

/**
 * How often the player's position is reported.
 *
 * 3 s is the cadence the creator's map refreshes on, so a fix is never more than
 * one interval old by the time it is drawn. Reporting faster would cost battery
 * and data without making the map any more truthful — the map cannot show motion
 * between two fixes anyway, only where the player was.
 */
export const LOCATION_PING_INTERVAL_MS = 3_000;

/**
 * Reports this player's position to the hunt, so the creator can see them on
 * their map.
 *
 * Unconditional while a round is in progress: every player is on the map, and
 * there is no setting to find or toggle. The loop still stops on its own
 * whenever reporting would be meaningless — no backend, a hunt that never
 * reached the server, no GPS fix yet, or a round that has finished.
 *
 * Mounted by the play screen only, so pinging follows the round rather than the
 * app's lifetime. A closed tab stops reporting, and the creator's map greys the
 * fix out as it goes stale.
 *
 * Never throws. A failed ping is dropped and the next tick retries, because a
 * location feature is never worth interrupting someone's treasure hunt over.
 */
export function useLocationPing(options: {
  /** Local hunt id, as the UI knows it — resolved to the server's UUID here. */
  huntId: string | null;
  /** Live position from the app-wide GPS watch; null while it has no fix. */
  location: LocationCoordinates | null;
  /** A finished round stops reporting — the hunt is over. */
  isFinished: boolean;
}): void {
  const { huntId, location, isFinished } = options;

  // Read inside the interval without re-arming it on every fix — the GPS watch
  // produces ~1/s and re-creating a 3 s timer on each one would mean it never
  // fires at all.
  const latest = useRef({ huntId, location });
  latest.current = { huntId, location };

  useEffect(() => {
    // Nothing to report: no backend, no hunt, or the round is done.
    if (!huntId || isFinished || !isApiConfigured()) return;

    let cancelled = false;
    // Only one ping in flight at a time. On a slow connection a second request
    // would be queued behind the first, and the writes would then land out of
    // order — leaving the server holding an *older* fix than it already had.
    let inFlight = false;

    const ping = async () => {
      const { huntId: currentHuntId, location: fix } = latest.current;
      if (inFlight || cancelled || !currentHuntId || !fix) return;
      inFlight = true;
      try {
        const serverId = await serverIdFor(currentHuntId);
        if (cancelled) return;
        const looksDeviceLocal = /^\d+$/.test(currentHuntId);
        if (looksDeviceLocal && serverId === currentHuntId) return; // never synced — nothing to report to
        const guestToken =
          (await readGuestToken(serverId)) ??
          (await readGuestToken(currentHuntId)) ??
          undefined;
        await huntsApi.reportLocation(serverId, {
          latitude: fix.latitude,
          longitude: fix.longitude,
          ...(guestToken ? { guestToken } : {}),
        });
      } catch (err) {
        // Deliberately silent per-ping: the next tick retries, and a transient
        // failure is not something the player mid-hunt needs to be told about.
        console.warn('[hunts] location ping skipped:', err);
      } finally {
        inFlight = false;
      }
    };

    // One immediately, so the creator's map is not blank for a whole interval
    // after a round opens.
    void ping();
    const timer = setInterval(() => {
      // A backgrounded tab has no business spending the player's battery.
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void ping();
      }
    }, LOCATION_PING_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [huntId, isFinished]);
}
