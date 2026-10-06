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
  const code = game.shareCode ? encodeURIComponent(game.shareCode) : encodeURIComponent(encodeGameShareCode(game));
  return `${base}/games#join=${code}`;
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
 * number or share code, so players on any device can join.
 */
export function buildGameShareMessage(
  game: HuntGame,
  origin = '',
  shortUrl?: string | null,
): string {
  const code = game.shareCode ?? encodeGameShareCode(game);
  const anyKey = game.characters.some(character => character.key?.trim());
  const joinUrl = shortUrl ?? (origin ? buildGameJoinUrl(game, origin) : '');
  return [
    `⛪ FaithQuest treasure hunt: "${game.title}"`,
    game.description ? game.description : '',
    ``,
    `Hunt code: ${game.shareCode ?? game.id}`,
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
  return `Join my FaithQuest hunt: ${game.title} (${game.shareCode ?? game.id})`;
}
