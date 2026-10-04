'use client';

import { useState } from 'react';
import { Users, Clock, CheckCircle2, PlayCircle, AlertTriangle } from 'lucide-react';
import type { HuntPlayerDto } from '../api/types';
import { useHuntPlayers } from '../hooks/useHuntPlayers';
import { formatDuration, formatIst, formatIstPrecise, legDurationMs } from '../utils/datetime';

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

  return (
    <section className="reportPanel" aria-label="Player progress">
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

/**
 * One player's checkpoint timeline.
 *
 * Two durations per stop, and the distinction matters: "Took" is how long *this
 * stop* took (the gap from the previous one — what you compare between
 * players), while "Elapsed" is how far into the round they were. Showing only
 * the cumulative figure would make a fast player look slow.
 */
function Checkpoints({ player }: { player: HuntPlayerDto }) {
  if (player.checkpoints.length === 0) {
    return <p className="reportMuted">No checkpoints cleared yet.</p>;
  }

  return (
    <table className="reportTable">
      <caption className="srOnly">Checkpoint timeline, times in IST</caption>
      <thead>
        <tr>
          <th scope="col">Stop</th>
          <th scope="col">Place</th>
          <th scope="col">Reached (IST)</th>
          <th scope="col">Took</th>
          <th scope="col">Elapsed</th>
        </tr>
      </thead>
      <tbody>
        {player.checkpoints.map((checkpoint, index) => (
          <tr key={checkpoint.nodeId}>
            <td>{checkpoint.routePosition}</td>
            <td>{checkpoint.stopName}</td>
            <td>{formatIstPrecise(checkpoint.reachedAt)}</td>
            <td>{formatDuration(legDurationMs(player.checkpoints, index))}</td>
            <td>{formatDuration(checkpoint.elapsedMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
