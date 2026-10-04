import { HuntGame } from '../types/hunt';
import { encodeGameShareCode } from './gameRepository';

/**
 * Builds a deep link that drops a player straight onto the hunt they were sent,
 * with the whole hunt embedded in the URL fragment.
 *
 * The payload rides in the fragment (`#join=…`) rather than the query string for
 * two reasons: there is no backend, so the link itself must carry the hunt, and
 * a fragment is never sent to the server or leaked through `Referer` headers —
 * important for a link that gets shared through messaging apps. Reading it is
 * therefore a client-side concern (see `app/games/page.tsx`).
 */
export function buildGameJoinUrl(game: HuntGame, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/games#join=${encodeURIComponent(encodeGameShareCode(game))}`;
}

/** Best-effort page origin, for links built in the browser. */
export function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/**
 * The short form of an invite: the origin plus `/g/{code}`, where the backend
 * keeps the mapping to the full link (see `api/links.api.ts`).
 *
 * Built here rather than at the call site so the shape of a short link lives
 * beside the shape of the long one it replaces — the two must always point at
 * the same place, because a share sheet swaps between them without asking.
 */
export function buildShortJoinUrl(origin: string, code: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/g/${encodeURIComponent(code)}`;
}

/**
 * Builds the message a creator shares with players. It contains the hunt
 * number plus the self-contained share code, so players on any device can
 * join without a backend — they simply paste the whole message (or just the
 * code) into the Join field.
 *
 * `shortUrl`, when supplied, replaces the join link: the same destination in a
 * handful of characters, so a message that would otherwise run to tens of KB of
 * URL stays readable. The pasted code below is left intact — it is the fallback
 * for a device that cannot open a link at all, and shortening it would mean
 * resolving a code on the server, which is exactly what a guest without a
 * backend cannot do.
 */
export function buildGameShareMessage(
  game: HuntGame,
  origin = '',
  shortUrl?: string | null,
): string {
  const code = encodeGameShareCode(game);
  const anyKey = game.characters.some(character => character.key?.trim());
  const joinUrl = shortUrl ?? (origin ? buildGameJoinUrl(game, origin) : '');
  return [
    `⛪ FaithQuest treasure hunt: "${game.title}"`,
    game.description ? game.description : '',
    ``,
    `Hunt number: ${game.id}`,
    `Locations: ${game.characters.length} — every team is dealt its own order`,
    anyKey
      ? 'Keys belong to locations: each team is given the key to the first location of its own route in-app when the hunt opens.'
      : '',
    joinUrl ? `Open this link to join (it asks first, then adds you to the hunt):` : '',
    joinUrl ? joinUrl : '',
    ``,
    `To join, open FaithQuest → Hunts → paste this code:`,
    code,
  ]
    .filter(line => line !== undefined)
    .join('\n');
}

/** Short text for the share dialog title/subject. */
export function getShareSubject(game: HuntGame): string {
  return `Join my FaithQuest hunt: ${game.title} (${game.id})`;
}
