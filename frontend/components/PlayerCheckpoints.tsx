import type { HuntPlayerDto } from '../api/types';
import { formatDuration, formatIstPrecise, legDurationMs } from '../utils/datetime';

/**
 * One player's checkpoint timeline — the table a creator opens to see when each
 * stop was reached and how long it took.
 *
 * Shared by the report dialog (`HuntPlayersPanel`) and the whole-screen live map
 * (`app/hunts/live-map`), which present the same data in two places. One
 * component rather than two, so the columns, the IST formatting and the
 * took-vs-elapsed distinction cannot drift apart between the views.
 *
 * Every time here is stored as UTC and rendered in IST (see `utils/datetime`).
 * The app is India-facing, so +05:30 is the only zone that makes sense to read;
 * because IST has no daylight saving, a fixed offset stays correct all year.
 *
 * Two durations per stop, and the distinction matters: "Took" is how long *this
 * stop* took (the gap from the previous one — what you compare between
 * players), while "Elapsed" is how far into the round they were. Showing only
 * the cumulative figure would make a fast player look slow.
 *
 * No `'use client'` of its own: it holds no state and no effects, and both
 * consumers are already client components (this one is also imported by a
 * server-rendered page's client island, so the boundary stays where it is).
 */
export function Checkpoints({ player }: { player: HuntPlayerDto }) {
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