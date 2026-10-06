'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import type { HuntPlayerDto } from '@/lib/api/types';
import { playerColor, playerLabel, playerPinHtml, playerTooltipHtml } from './mapPins';

/** OpenStreetMap standard tiles — see the note in `LeafletGameMap`. */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * A fix older than this is drawn greyed out rather than dropped.
 *
 * Three times the reporting interval, so a fix that misses one or two ticks — a
 * tunnel, a locked screen, one flaky request — is still shown as live. Past that
 * the marker is honest about being a "last seen" rather than presenting a player
 * who closed their tab as standing still forever.
 */
export const STALE_AFTER_MS = 3 * 3_000;

export interface PlayerLocationsMapProps {
  /** One entry per team; entries without a fix are simply not drawn. */
  players: HuntPlayerDto[];
  /** Current epoch ms, supplied by the parent so freshness is measured once. */
  now: number;
  /** Zoom used when the map frames itself around the players. */
  initialZoom?: number;
  /**
   * `panel` is the fixed-height map inside the report dialog; `full` stretches to
   * fill its container, for the standalone page where the map is the whole view.
   *
   * Height comes from CSS rather than a prop because the two cases size
   * themselves differently — the panel is a fixed strip in a scrollable sheet,
   * while the full page map is `100%` of a viewport-anchored flex child.
   */
  variant?: 'panel' | 'full';
}

/**
 * The creator's live view of where each team is, on one map.
 *
 * Leaflet + OpenStreetMap specifically rather than the `GameMap` dispatcher:
 * this map has no quest nodes, no own-player dot and no follow-mode, and it is
 * only ever rendered where a Google Maps key is *not* required. Leaflet touches
 * `window` at import time, so it is loaded with a dynamic `import()` inside an
 * effect — importing it at module scope would break server rendering.
 *
 * Markers are **reused** across refreshes rather than torn down and rebuilt.
 * That is what lets Leaflet animate `setLatLng` between positions: a team
 * visibly slides to where it moved instead of teleporting, which is the whole
 * difference between a live map and a slideshow of dots. Rebuilding every 3 s
 * would also leak DOM nodes and drop a tooltip the creator may be reading.
 *
 * The viewport is fitted to the players **once**, then left alone. Re-fitting on
 * every poll would yank the map out from under a creator who has panned
 * somewhere to look, and with one team there is never anything new to frame.
 */
export function PlayerLocationsMap({
  players,
  now,
  initialZoom = 15,
  variant = 'panel',
}: PlayerLocationsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  /** False until the creator has been auto-framed, so polling never re-frames. */
  const hasFramedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  // Create the map once.
  useEffect(() => {
    let disposed = false;

    void (async () => {
      const L = await import('leaflet');
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [20, 0],
        zoom: initialZoom,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      LRef.current = L;
      setMapReady(true);
    })();

    return () => {
      disposed = true;
      setMapReady(false);
      markersRef.current.clear();
      hasFramedRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      LRef.current = null;
    };
  }, [initialZoom]);

  // Draw / move every marker. Re-runs on each poll, and the marker layer is
  // diffed so only teams whose state actually changed are touched.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    const positioned = players.filter(hasPosition);
    const live = new Set(positioned.map(player => player.participantId));

    // Drop markers for teams no longer on this page — otherwise a marker would
    // linger at its last coordinates after its player disappeared from the report.
    for (const [id, marker] of markersRef.current) {
      if (!live.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const player of positioned) {
      // Non-null by `hasPosition`; the casts localise that narrowing here.
      const latLng: [number, number] = [player.latitude as number, player.longitude as number];
      const label = playerLabel(player.teamName, player.isGuest);
      const isStale = now - new Date(player.locationAt as string).getTime() > STALE_AFTER_MS;
      const color = playerColor(player.participantId);
      // Rebuilt every poll, because "at stop 2" is exactly the kind of fact that
      // changes while a creator is watching — a card frozen at join time would be
      // worse than no card at all.
      const tooltip = playerTooltipHtml({
        label,
        color,
        isGuest: player.isGuest,
        accountName: player.accountDisplayName ?? player.accountUsername,
        stopsCleared: player.stopsCleared,
        totalStops: player.totalStops,
        currentRoutePosition: player.currentRoutePosition,
        currentStopName: player.currentStopName,
        completed: player.completed,
        totalElapsedMs: player.totalElapsedMs,
        isActive: player.isActive,
        isStale,
      });

      const existing = markersRef.current.get(player.participantId);
      if (existing) {
        existing.setLatLng(latLng);
        existing.setTooltipContent(tooltip);
        // The pin carries the initial and the staleness state, so its artwork is
        // refreshed as well as its position when either of those changes.
        const icon = (existing as Marker & { _icon?: HTMLElement })._icon;
        if (icon) icon.innerHTML = playerPinHtml(label, color, isStale);
      } else {
        const marker = L.marker(latLng, {
          icon: L.divIcon({
            html: playerPinHtml(label, color, isStale),
            className: 'fq-marker',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          // Interactive, so hovering a dot opens its stats card. The pin is only
          // 30px and carries no click handler, so it cannot swallow a drag; a
          // creator panning the map starts well clear of any dot.
          interactive: true,
          keyboard: false,
        })
          .addTo(map)
          // `permanent: false` + no `sticky` — the card is a hover affordance, not
          // something left on screen competing with the map underneath. The
          // offset lifts it clear of the 30px pin it belongs to.
          .bindTooltip(tooltip, {
            direction: 'top',
            offset: [0, -16],
            className: 'playerTooltipShell',
            opacity: 1,
          });
        markersRef.current.set(player.participantId, marker);
      }
    }

    // Frame every team once, the first time there is anything to frame.
    if (!hasFramedRef.current && positioned.length > 0) {
      hasFramedRef.current = true;
      const bounds = L.latLngBounds(
        positioned.map(player => [player.latitude as number, player.longitude as number]),
      );
      if (positioned.length === 1) {
        map.setView(bounds.getCenter(), initialZoom);
      } else {
        map.fitBounds(bounds.pad(0.25), { maxZoom: initialZoom });
      }
    }
  }, [players, now, initialZoom, mapReady]);

  const shown = players.filter(hasPosition).length;

  return (
    <div
      ref={containerRef}
      className={`playerMap${variant === 'full' ? ' playerMapFull' : ''}`}
      role="img"
      aria-label={`Live map showing ${shown} team${shown === 1 ? '' : 's'} and where they are now`}
    />
  );
}

/**
 * True when this player has a complete, drawable fix.
 *
 * All three fields or none: a coordinate without its server timestamp is a
 * half-written slot, and drawing it would mean showing a position whose age
 * nobody can judge.
 */
function hasPosition(player: HuntPlayerDto): boolean {
  return (
    player.latitude !== null && player.longitude !== null && player.locationAt !== null
  );
}
