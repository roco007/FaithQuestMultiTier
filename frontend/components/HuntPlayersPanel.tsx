'use client';

import { useEffect, useState } from 'react';
import { Users, Clock, CheckCircle2, PlayCircle, AlertTriangle } from 'lucide-react';
import type { HuntPlayerDto } from '@/lib/api/types';
import { useHuntPlayers } from '../hooks/useHuntPlayers';
import { formatDuration, formatIst } from '../utils/datetime';
import { PlayerLocationsMap, STALE_AFTER_MS } from './PlayerLocationsMap';
import { Checkpoints } from './PlayerCheckpoints';

/**
 * How often the report — and so the map — refreshes.
 *
 * 3 s, matching the interval players report their position on
 * (`LOCATION_PING_INTERVAL_MS`): the creator sees each fix within one interval of
 * it being taken, and never sees a gap the players' own reporting could not
 * have filled either.
 */
const POLL_INTERVAL_MS = 3_000;

/**
 * The creator's view of who is playing their game.
 *
 * Every time here is stored as UTC and rendered in IST (see `utils/datetime`).
 * The app is India-facing, so +05:30 is the only zone that makes sense to read;
 * because IST has no daylight saving, a fixed offset stays correct all year.
 */
export function HuntPlayersPanel({ huntId }: { huntId: string }) {
  const { data, isLoading, error, page, setPage } = useHuntPlayers(huntId);
  // Which player's checkpoint timeline is open. Null = the list only, so the
  // panel stays scannable when a hunt has fifty players on it.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A marker only turns grey when its fix *ages past* the threshold, which no
  // amount of polling would notice on its own: two fetches 3 s apart can both
  // land inside the window. This ticks so staleness is re-evaluated in real time.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  if (error) {
    return (
      <div className="reportNotice">
        <AlertTriangle size={16} aria-hidden />
        <span>{error}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="reportMuted">{isLoading ? 'Loading players…' : 'No report yet.'}</p>
    );
  }

  const { summary, items, total, limit } = data;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  // Only players with a complete fix can be drawn, so the caption and the map
  // agree on the same number.
  const withPosition = items.filter(hasPosition);

  return (
    <section className="reportPanel" aria-label="Player progress">
      {/* Hovering a dot opens a card of that team's stats. The stats are also in
          the list below, which is the keyboard- and screen-reader-accessible path:
          Leaflet markers are not focusable here, so this card is an enhancement
          for pointer users rather than the only way to reach the information. */}
      <PlayerLocationsMap players={items} now={now} />
      <p className="mapCaption">
        {withPosition.length === 0
          ? 'No team has reported a position yet. Teams appear here as soon as they start playing — only their last position is ever kept, never the route they walked.'
          : `Showing ${withPosition.length} of ${items.length} team${
              items.length === 1 ? '' : 's'
            } on this page. Updates every ${POLL_INTERVAL_MS / 1000}s; a grey dot is a position more than ${
              STALE_AFTER_MS / 1000
            }s old.`}
      </p>

      <header className="reportSummary">
        <Stat icon={<Users size={16} aria-hidden />} label="Joined" value={summary.totalJoined} />
        <Stat
          icon={<PlayCircle size={16} aria-hidden />}
          label="Playing now"
          value={summary.playingNow}
          // The live figure is the one that goes stale; say so rather than let a
          // number quietly freeze and mislead.
          hint="seen in the last 5 minutes"
        />
        <Stat icon={<Clock size={16} aria-hidden />} label="Still going" value={summary.inProgress} />
        <Stat
          icon={<CheckCircle2 size={16} aria-hidden />}
          label="Finished"
          value={summary.completed}
        />
      </header>

      {items.length === 0 ? (
        <p className="reportMuted">
          Nobody has joined this game yet. Share the link — everyone who opens it, with or
          without an account, will appear here.
        </p>
      ) : (
        <ul className="reportList">
          {items.map(player => (
            <PlayerRow
              key={player.participantId}
              player={player}
              isExpanded={expandedId === player.participantId}
              onToggle={() =>
                setExpandedId(expandedId === player.participantId ? null : player.participantId)
              }
            />
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="reportPager" aria-label="Report pages">
          <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1}>
            Previous
          </button>
          <span>
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage(page + 1)}
            disabled={page >= pageCount}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

/** One headline number with its label. */
function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="reportStat">
      <span className="reportStatIcon">{icon}</span>
      <span className="reportStatValue">{value}</span>
      <span className="reportStatLabel">{label}</span>
      {hint && <span className="reportStatHint">{hint}</span>}
    </div>
  );
}

/**
 * True when this player has a complete, drawable fix — all three fields or none.
 *
 * Duplicated from `PlayerLocationsMap` rather than imported so the caption under
 * the map and the map itself cannot disagree about who is counted.
 */
function hasPosition(player: HuntPlayerDto): boolean {
  return (
    player.latitude !== null && player.longitude !== null && player.locationAt !== null
  );
}

/** A player: the summary line, plus their timeline when expanded. */
function PlayerRow({
  player,
  isExpanded,
  onToggle,
}: {
  player: HuntPlayerDto;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // A guest is identified only by the name they typed, so fall back to something
  // honest rather than blank: "Unnamed player" reads as a data gap, "Guest" is
  // what the row actually is.
  const name = player.teamName?.trim() || (player.isGuest ? 'Guest' : 'Unnamed player');

  return (
    <li className="reportRow">
      <button
        type="button"
        className="reportRowHead"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span className="reportName">
          {name}
          {player.isGuest ? (
            <span className="reportBadge" title="Played without an account">
              guest
            </span>
          ) : (
            <span
              className="reportBadgeAccount"
              title="Linked to an account"
            >
              {player.accountDisplayName || player.accountUsername}
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

          {player.isActive && <span className="reportLive">playing now</span>}

          <span className="reportJoined">joined {formatIst(player.joinedAt)}</span>
        </span>
      </button>

      {isExpanded && <Checkpoints player={player} />}
    </li>
  );
}
