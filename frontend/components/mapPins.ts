import type { HuntCharacterType } from '../types/hunt';
import { formatDuration } from '../utils/datetime';

/**
 * Marker artwork shared by every map provider.
 *
 * The pins are plain HTML rather than images, which is what lets the quest
 * markers keep their pulsing animation. That works with Leaflet's `divIcon`
 * and with Google's `AdvancedMarkerElement` `content` alike, so both providers
 * draw byte-identical markers and the artwork is defined in exactly one place.
 */

/** Visual state of a quest node pin. */
export type NodePinState = 'active' | 'done' | 'idle';

/** Builds the pin markup for a node marker. */
export function nodePinHtml(state: NodePinState): string {
  const glyph = state === 'done' ? '✓' : '✝';
  const color = state === 'active' ? '#38bdf8' : state === 'done' ? '#10b981' : '#f59e0b';
  const pulse = state === 'active' ? 'animation: fq-pulse 1.8s ease-out infinite;' : '';
  return `
    <div style="position:relative;display:grid;place-items:center;width:38px;height:38px;">
      ${
        state === 'active'
          ? '<div style="position:absolute;inset:0;border-radius:50%;background:#38bdf8;opacity:0.45;' +
            pulse + '"></div>'
          : ''
      }
      <div style="
        position:relative;width:34px;height:34px;border-radius:50%;
        background:${color};border:2.5px solid ${state === 'active' ? '#7dd3fc' : '#ffffff'};
        color:#090d16;font-weight:900;font-size:16px;
        display:grid;place-items:center;
        box-shadow:0 3px 10px rgba(0,0,0,0.6);">
        ${glyph}
      </div>
    </div>`;
}

/** Blue accuracy dot for the player's live position. */
export const userPinHtml = `
  <div style="position:relative;display:grid;place-items:center;width:26px;height:26px;">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(56,189,248,0.3);"></div>
    <div style="position:relative;width:16px;height:16px;border-radius:50%;
      background:#38bdf8;border:2.5px solid #e0f2fe;box-shadow:0 0 12px #38bdf8;"></div>
  </div>`;

/** The draggable character pin on the creator's placement map. */
export function characterPinHtml(glyph: string): string {
  return `<div style="width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:20px;background:#38bdf8;border:2.5px solid #e0f2fe;box-shadow:0 3px 10px rgba(0,0,0,.6)">${glyph}</div>`;
}

/** The creator's own position on the placement map. */
export const creatorPinHtml =
  '<div title="Your current location" style="width:18px;height:18px;border-radius:50%;background:#38bdf8;border:3px solid #fff;box-shadow:0 0 0 2px rgba(56,189,248,.45),0 2px 6px rgba(0,0,0,.5);box-sizing:border-box"></div>';

/**
 * One team on the creator's live map.
 *
 * A coloured dot with the team's initial, coloured per team so two players
 * standing together are still distinguishable. `isStale` greys the whole marker
 * out: a fix the server stamped minutes ago belongs on the map, but it must not
 * be mistaken for somebody standing there right now — the difference between
 * "here" and "was here" is the whole point of showing a time on it.
 *
 * Plain HTML like every other pin here, so both Leaflet's `divIcon` and Google's
 * `AdvancedMarkerElement.content` draw it identically from one definition.
 */
export function playerPinHtml(label: string, color: string, isStale: boolean): string {
  const background = isStale ? '#64748b' : color;
  const ring = isStale ? 'rgba(100,116,139,0.35)' : `${color}59`;
  const faded = isStale ? 'opacity:0.75;' : '';
  // Initial letter, so a name is readable at a glance without a tooltip.
  const initial = escapeHtml(label.trim().charAt(0).toUpperCase() || '?');
  return `
    <div style="position:relative;display:grid;place-items:center;width:30px;height:30px;${faded}">
      <div style="position:absolute;inset:0;border-radius:50%;background:${ring};"></div>
      <div style="
        position:relative;width:24px;height:24px;border-radius:50%;
        background:${background};border:2.5px solid #e0f2fe;color:#090d16;
        font-weight:900;font-size:12px;display:grid;place-items:center;
        box-shadow:0 3px 10px rgba(0,0,0,0.6);">${initial}</div>
    </div>`;
}

/**
 * Team colours, in a fixed order, so a given team keeps the same colour across
 * every refresh — a marker that changed colour on each poll would be unreadable.
 *
 * Kept off `CHARACTER_GLYPHS` deliberately: those identify *locations* on the
 * play map, while these identify *people* on the creator's map, and conflating
 * the two would suggest a team's dot means something about its stops.
 */
export const PLAYER_COLORS = [
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fbbf24',
  '#34d399',
  '#fb7185',
  '#22d3ee',
  '#c084fc',
] as const;

/** Stable colour for a team, derived from its id so it never shifts. */
export function playerColor(participantId: string): string {
  let hash = 0;
  for (let i = 0; i < participantId.length; i += 1) {
    hash = (hash * 31 + participantId.charCodeAt(i)) >>> 0;
  }
  return PLAYER_COLORS[hash % PLAYER_COLORS.length];
}

/** Team label, matching the fallback order the report list uses. */
export function playerLabel(teamName: string | null, isGuest: boolean): string {
  return teamName?.trim() || (isGuest ? 'Guest' : 'Player');
}

/** What the creator's map shows when hovering a team's dot. */
export interface PlayerTooltipModel {
  label: string;
  color: string;
  isGuest: boolean;
  /** Account behind a non-guest, when there is one. */
  accountName: string | null;
  stopsCleared: number;
  totalStops: number;
  /** Where they are up to: the next stop in their own route. */
  currentRoutePosition: number | null;
  currentStopName: string | null;
  completed: boolean;
  /** Whole-round time; null while still playing. */
  totalElapsedMs: number | null;
  /** Recent heartbeat on an unfinished round. */
  isActive: boolean;
  /** True when this fix is old enough that the dot is greyed out. */
  isStale: boolean;
}

/**
 * The hover card for one team on the creator's map.
 *
 * Answers "who is that, and how are they doing" without the creator having to
 * match a coloured initial against the list below — which is the actual problem
 * a hover card solves, since two teams on one map are identified by a single
 * letter each.
 *
 * Ordered by what a creator watching a live hunt actually wants: who, how far,
 * where they are stuck, and whether the dot they are looking at is current. The
 * staleness line is last and deliberately unmissable, because a greyed dot whose
 * card reads like a live one would send somebody running to a team that left
 * an hour ago.
 *
 * Every value is user- or server-supplied and goes through `escapeHtml`: a team
 * name is typed by a guest on a phone keyboard, and this is raw HTML.
 */
export function playerTooltipHtml(model: PlayerTooltipModel): string {
  const {
    label,
    color,
    isGuest,
    accountName,
    stopsCleared,
    totalStops,
    currentRoutePosition,
    currentStopName,
    completed,
    totalElapsedMs,
    isActive,
    isStale,
  } = model;

  const text = escapeHtml(label);
  const progress = `${stopsCleared}/${totalStops}`;

  // Status line: the answer to "is this team actually moving right now".
  let status: string;
  if (completed) {
    status = 'Finished';
  } else if (currentStopName && currentRoutePosition !== null) {
    status = `At stop ${currentRoutePosition}: ${escapeHtml(currentStopName)}`;
  } else {
    status = 'Not started';
  }

  // Secondary line — only the parts that are actually true, so the card never
  // shows an empty row where a fact is missing.
  const facts: string[] = [`${escapeHtml(progress)} stops cleared`];
  if (completed && totalElapsedMs !== null) {
    facts.push(`in ${escapeHtml(formatDuration(totalElapsedMs))}`);
  }
  // "playing now" beside "Not started" reads as a contradiction: `isActive` is a
  // recent heartbeat, which a team earns by opening the app, not by clearing
  // anything. So it only appears once they have actually moved.
  if (isActive && !completed && stopsCleared > 0) {
    facts.push('playing now');
  }
  if (!isGuest && accountName) {
    facts.push(escapeHtml(accountName));
  }

  const freshness = isStale ? 'Last seen — not live' : 'Live position';
  const freshnessColor = isStale ? '#94a3b8' : '#34d399';

  return `
    <div class="playerTooltip" style="--team-color:${escapeHtml(color)}">
      <div class="playerTooltipHead">
        <span class="playerTooltipName">${text}</span>
        ${isGuest ? '<span class="playerTooltipTag">guest</span>' : ''}
      </div>
      <div class="playerTooltipProgress">${escapeHtml(progress)} stops</div>
      <div class="playerTooltipStatus">${status}</div>
      <div class="playerTooltipFacts">${facts.join(' · ')}</div>
      <div class="playerTooltipFresh" style="color:${freshnessColor}">${freshness}</div>
    </div>`;
}

/** Escapes text going into marker HTML — a team name is user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const CHARACTER_GLYPHS: Record<HuntCharacterType, string> = {
  guardian: '🛡',
  angel: '👼',
  monk: '📿',
  flame: '🔥',
  oracle: '🔮',
};

/**
 * Turns pin markup into a DOM element for `AdvancedMarkerElement.content`.
 *
 * Google anchors advanced-marker content by the element's bottom-left corner,
 * so the wrapper is offset by half its own size to centre the artwork on the
 * coordinate — matching the `iconAnchor` Leaflet was given.
 *
 * `pointerEvents` is left enabled by default because node markers are
 * clickable; callers that place a purely decorative dot (the live position)
 * switch it off so it never swallows a tap meant for the map underneath.
 */
export function pinElement(html: string, size: number): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fq-marker';
  el.style.position = 'relative';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.transform = `translate(-${size / 2}px, -${size / 2}px)`;
  el.innerHTML = html;
  return el;
}