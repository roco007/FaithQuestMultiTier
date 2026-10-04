/**
 * India Standard Time, as a fixed offset.
 *
 * IST is UTC+05:30 with **no daylight saving** — India has not observed DST
 * since 1995 — so a constant is correct year-round and never drifts. Storing a
 * formatted local time instead would be ambiguous across that history and wrong
 * for anyone reading the report from another timezone.
 */
const IST_OFFSET_MINUTES = 330;

/** e.g. `04 Oct, 14:32` — the compact form used in report tables. */
const IST_DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** e.g. `04 Oct 2026, 14:32:10` — the long form, with seconds. */
const IST_DATE_TIME_PRECISE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Formats a UTC ISO timestamp as an IST wall-clock time.
 *
 * `Intl` does the zone conversion, so the arithmetic is never hand-rolled (and
 * cannot be off by 30 minutes). An unparseable value renders as an em dash
 * rather than `Invalid Date`, which in a table of numbers reads as a missing
 * measurement instead of a bug.
 */
export function formatIst(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return IST_DATE_TIME.format(date);
}

/** As `formatIst`, but with the year and seconds — for a timeline. */
export function formatIstPrecise(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return IST_DATE_TIME_PRECISE.format(date);
}

/**
 * Renders a duration as `1h 04m`, `12m 30s` or `48s`.
 *
 * Milliseconds are dropped on purpose: sub-second precision on a walk between
 * real-world locations is noise, and rounding *down* would report a stop as
 * having taken less time than it did.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * The gap between two consecutive checkpoints — "how long this stop took",
 * which is the number a creator actually compares between players.
 *
 * Derived rather than stored: the elapsed time *since joining* is what the
 * database keeps, and the leg time is the difference between neighbours.
 */
export function legDurationMs(
  checkpoints: { elapsedMs: number }[],
  index: number,
): number {
  if (index <= 0) return 0;
  const previous = checkpoints[index - 1]?.elapsedMs;
  const current = checkpoints[index]?.elapsedMs;
  if (typeof previous !== 'number' || typeof current !== 'number') return 0;
  return Math.max(0, current - previous);
}
