'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Users, Maximize2, Minimize2 } from 'lucide-react';
import { PlayerLocationsMap, STALE_AFTER_MS } from '../../../components/PlayerLocationsMap';
import { Checkpoints } from '../../../components/PlayerCheckpoints';
import { useHuntPlayers } from '../../../hooks/useHuntPlayers';
import { playerColor, playerLabel } from '../../../components/mapPins';
import { localGameRepository } from '../../../services/gameRepository';
import { formatAgo, formatDuration } from '../../../utils/datetime';
import type { HuntPlayerDto } from '@/lib/api/types';

/**
 * `/hunts/live-map` — the creator's whole-screen live map.
 *
 * The report dialog on "Your hunts" shows the same map in a strip, which is right
 * for a glance but wrong for a hunt with teams spread across a city: a 320px
 * inset is too small to see where anybody actually is. This is the same data on
 * the whole screen, for a creator who has put the map on a second monitor or
 * shared it with a co-host.
 *
 * The hunt is addressed by its **local** id in the query string (`?hunt=`),
 * because that is the only id the creator's own list knows — the server's UUID
 * lives behind the sync map, and the device-local id is what every other screen
 * passes around. `useHuntPlayers` performs the same crossover it does in the
 * dialog, so the two views can never disagree about which hunt they are showing.
 *
 *
 * The page deliberately renders **no chrome at all**: neither the app's `TopNav`
 * (opted out of via `BARE_ROUTES` in that component) nor any header of its own.
 * The ask was a bare map — the nav ribbon and the "< Hunts" back link were both
 * removed, leaving the map, the team roster, and a single floating fullscreen
 * button over the map. Nothing here scrolls but the roster, so the whole view is
 * the viewport.
 */
function LiveMapInner() {
  const searchParams = useSearchParams();
  const huntId = searchParams.get('hunt');
  const { data, isLoading, error } = useHuntPlayers(huntId);
  const [now, setNow] = useState(() => Date.now());

  // The hunt's name. `?hunt=` carries a device-local id ("0", "12"), which is
  // meaningless as a label — it read "Hunt 0" — so the title is looked up from
  // the same local store the creator's hunt list is rendered from. A URL shared
  // to another device would have no local record to read and falls back to the
  // id; passing the title in the query string is the fix for that case.
  //
  // It heads the roster rather than the page: the header ribbon is gone, and this
  // page exists to be read at a glance on a second monitor, where knowing *which*
  // hunt is on screen still matters. It is deliberately not a full-width banner —
  // that is exactly the chrome that was just removed.
  const [huntTitle, setHuntTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!huntId) {
      setHuntTitle(null);
      return;
    }
    let cancelled = false;
    void localGameRepository
      .getGame(huntId)
      .then(game => {
        if (!cancelled) setHuntTitle(game?.title ?? null);
      })
      .catch(() => {
        // A missing title costs a heading, never the map.
      });
    return () => {
      cancelled = true;
    };
  }, [huntId]);

  // Fullscreen is tracked from the document, not from the click. The browser
  // also leaves fullscreen on Escape and on the tablet swipe-away, and a
  // click-only flag would leave the button claiming "enter" while the map was
  // already expanded — and offering no way back out. `fullscreenchange` is the
  // only event that tells the truth about the current state.
  const [isFullscreen, setIsFullscreen] = useState(false);

  /**
   * Which teams' checkpoint timelines are open — empty = the roster only.
   *
   * A set, so each row toggles on its own: opening one team never closes another.
   * Comparing two teams' times is the reason the timelines are here at all, and
   * collapsing the first one to open the second defeats it.
   *
   * Held by participant id, which is stable across the 3 s poll — an index into
   * `ordered` would change as teams overtake each other, and a table would jump
   * to a different team while being read.
   */
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * Opens one team's timeline, or closes it if it is already open.
   *
   * Toggled against the previous set rather than the rendered `expandedIds`, so
   * two rows cannot lose an update by reading the same snapshot.
   */
  const toggleExpanded = useCallback((participantId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }, []);
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // iOS Safari refuses element fullscreen, and a rejected promise here
      // would be an unhandled rejection. The map is already nearly a full
      // screen, so the worst case is a button that does nothing.
    }
  }, []);

  // Staleness is a function of elapsed time, not of polling: a fix inside the
  // window now can be outside it 3 s later without the data changing at all, so
  // the sidebar greys out on this tick rather than on the fetch.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const positioned = useMemo(
    () => (data?.items ?? []).filter(hasPosition),
    [data],
  );

  // Sorted best-first: a creator watching a screen wants the teams nearest the
  // end at the top, and alphabetical-by-typo is not that.
  const ordered = useMemo(() => sortForDisplay(data?.items ?? []), [data]);

  return (
    <div className="liveMapPage">
      {error ? (
        <div className="liveMapBody">
          <div className="reportNotice">
            <Users size={16} aria-hidden />
            <span>{error}</span>
          </div>
        </div>
      ) : (
        <>
          {/* The map takes the whole remaining viewport; the roster sits in a
              sidebar beside it on a wide screen and above it on a phone. */}
          <div className="liveMapSplit">
            <div className="liveMapCanvas">
              <PlayerLocationsMap players={data?.items ?? []} now={now} variant="full" />
              {/* Floated over the map rather than sitting in a header row: with
                  the ribbon gone this is the only control on the page, and the
                  map deserves the height a title and a back link were taking.
                  The label and the icon are the affordance — a button that still
                  read "Full screen" while the page was already full screen
                  offered no way back. Escape always works regardless; this makes
                  the same thing reachable with the mouse. */}
              <button
                type="button"
                className="btnGhost liveMapFloatBtn"
                onClick={toggleFullscreen}
                aria-pressed={isFullscreen}
                title={isFullscreen ? 'Leave full screen (Esc)' : 'Show this map full screen'}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                {isFullscreen ? 'Exit full screen' : 'Full screen'}
              </button>
            </div>

            <aside className="liveMapRoster" aria-label="Teams on this map">
              {/* Which hunt this screen is showing. It lives inside the roster
                  rather than in a page banner so it costs the map no height,
                  and it truncates — an author-written title can be arbitrarily
                  long, and a wrapped heading would push teams off the list. */}
              <h2 className="liveMapRosterTitle" title={huntTitle ?? undefined}>
                {huntTitle ?? 'Live map'}
              </h2>
              {isLoading && !data ? (
                <p className="reportMuted">Loading teams…</p>
              ) : ordered.length === 0 ? (
                <p className="reportMuted">
                  Nobody has joined this hunt yet. Teams appear here — and on the map — as soon
                  as they start playing.
                </p>
              ) : (
                <ul className="reportList">
                  {ordered.map(player => (
                    <RosterRow
                      key={player.participantId}
                      player={player}
                      now={now}
                      isExpanded={expandedIds.has(player.participantId)}
                      onToggle={() => toggleExpanded(player.participantId)}
                    />
                  ))}
                </ul>
              )}
            </aside>
          </div>

          <p className="liveMapFootnote">
            {positioned.length === 0
              ? 'No team has reported a position yet. Only a team’s last position is ever kept, never the route they walked.'
              : `${positioned.length} of ${data?.items.length ?? 0} team${
                  (data?.items.length ?? 0) === 1 ? '' : 's'
                } on the map. A grey dot is a position more than ${
                  STALE_AFTER_MS / 1000
                }s old. Hover a dot for that team’s stats.`}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * One team in the sidebar: the same facts the hover card shows, at rest.
 *
 * A disclosure row that opens independently of every other team — the timelines
 * are for comparing teams against each other, so several can be open at once and
 * closing one is never a side effect of opening another.
 */
function RosterRow({
  player,
  now,
  isExpanded,
  onToggle,
}: {
  player: HuntPlayerDto;
  now: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const label = playerLabel(player.teamName, player.isGuest);
  const color = playerColor(player.participantId);
  const hasFix = hasPosition(player);
  const isStale =
    hasFix && now - new Date(player.locationAt as string).getTime() > STALE_AFTER_MS;

  return (
    <li className="reportRow">
      {/* The row is the disclosure control, exactly as in the report dialog, so
          the two views behave identically: one click per team, `aria-expanded`
          for assistive tech, and the checkpoint table beneath. The swatch and
          name stay outside the button's text flow only visually — they are the
          first thing in it, so the control is announced by the team's name. */}
      <button
        type="button"
        className="reportRowHead"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span className="reportName">
          {/* Swatch + name tie this row to the dot on the map. */}
          <span
            className="liveMapSwatch"
            style={{ background: isStale || !hasFix ? '#64748b' : color }}
            aria-hidden
          />
          <span className="reportNameText">{label}</span>
          {player.isGuest && (
            <span className="reportBadge" title="Played without an account">
              guest
            </span>
          )}
        </span>

        <span className="reportMeta">
          <span className="reportProgress">
            {player.stopsCleared}/{player.totalStops}
          </span>
          {player.completed ? (
            <span className="reportDone">
              Finished in {formatDuration(player.totalElapsedMs)}
            </span>
          ) : (
            <span className="reportStuck">
              {player.currentStopName
                ? `At stop ${player.currentRoutePosition}: ${player.currentStopName}`
                : 'Not started'}
            </span>
          )}
          {/* One of these three is always shown, so "no live signal" is never
              mistaken for "no progress". "Last seen" carries the age: a grey dot
              from 20 s ago and one from this morning are the same word otherwise,
              and a creator deciding whether to chase a team needs the
              difference. */}
          {!hasFix ? (
            <span className="reportJoined">No position yet</span>
          ) : isStale ? (
            <span className="reportJoined">
              Last seen {formatAgo(player.locationAt, now)}
            </span>
          ) : player.isActive && !player.completed && player.stopsCleared > 0 ? (
            <span className="reportLive">playing now</span>
          ) : null}
          {/* The affordance, so the row reads as expandable rather than as a row
              that happens to be a button. */}
          <span className="reportToggle" aria-hidden>
            {isExpanded ? 'Hide times' : 'Times'}
          </span>
        </span>
      </button>

      {isExpanded && <Checkpoints player={player} />}
    </li>
  );
}

/**
 * Best-first: finished teams, then teams furthest along, then the rest by name.
 *
 * A live view is scanned for "who is close to finishing", so that order leads.
 * Ties break on name so two teams at the same stop do not swap places between
 * polls and make the whole list flicker every 3 s.
 */
function sortForDisplay(players: HuntPlayerDto[]): HuntPlayerDto[] {
  return [...players].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? -1 : 1;
    if (a.stopsCleared !== b.stopsCleared) return b.stopsCleared - a.stopsCleared;
    return playerLabel(a.teamName, a.isGuest).localeCompare(
      playerLabel(b.teamName, b.isGuest),
    );
  });
}

/** All three fields or none — the same rule the map and the report both use. */
function hasPosition(player: HuntPlayerDto): boolean {
  return (
    player.latitude !== null && player.longitude !== null && player.locationAt !== null
  );
}

/**
 * `useSearchParams` opts this page into client-side rendering, so Next needs a
 * Suspense boundary to prerender the shell — mirroring `app/creator/page.tsx`.
 */
export default function LiveMapPage() {
  return (
    <Suspense fallback={<div className="liveMapBody" />}>
      <LiveMapInner />
    </Suspense>
  );
}
