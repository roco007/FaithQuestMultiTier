import { randomBytes } from 'node:crypto';

/**
 * Guest identity for a hunt round.
 *
 * Most players arrive from a share link with no account, and before this existed
 * they left no server trace at all — the creator's player list was silently
 * incomplete. A guest is therefore given an opaque token at join and presents it
 * on every later call, which makes their row addressable without an account.
 *
 * The token is deliberately *not* derived from anything about the device (no
 * fingerprint, no IP, no user-agent): it is 32 bytes of CSPRNG output, so it can
 * only be replayed by whoever already holds it, and it is scoped to a single
 * hunt — presenting it to another hunt matches nothing. Nothing here is personal
 * data; the team name is the only thing a guest tells us about themselves, and
 * they type it themselves.
 *
 * 64 hex chars matches the `@db.VarChar(64)` column exactly — a longer value
 * would be truncated into a *different, valid-looking* token rather than
 * rejected, which is why `isGuestToken` guards on shape before any lookup.
 */
const GUEST_TOKEN_BYTES = 32;

/** A freshly issued guest token. Never `Math.random` — this is a credential. */
export function issueGuestToken(): string {
  return randomBytes(GUEST_TOKEN_BYTES).toString('hex');
}

/**
 * True when `value` could be one of our tokens. Checked before every lookup so
 * a malformed value is a clean 400 instead of a database data-truncation error.
 */
export function isGuestToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
