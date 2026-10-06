'use client';


import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { ChurchNode } from '../types/node';
import { PlayerProgress, LocationCoordinates, ProximityState } from '../types/game';
import { InventoryItem } from '../types/inventory';
import churchNodesData from '../data/church_nodes.json';
import { evaluateProximity } from '../utils/geo';
import { loadPlayerProgress, savePlayerProgress, clearPlayerProgress, INITIAL_PLAYER_PROGRESS } from '../utils/storage';
import { playSoundEffect, triggerHaptic } from '../utils/sound';
import { ApiError, isApiConfigured } from '@/lib/api/client';
import { questsApi } from '@/lib/api/quests.api';
import { progressApi } from '@/lib/api/progress.api';
import { badgesApi } from '@/lib/api/badges.api';
import { inventoryApi } from '@/lib/api/inventory.api';
import type {
  BadgeEntry,
  InventoryEntry,
  ProgressSummary,
  QuestCompletionResult,
} from '@/lib/api/types';
import { useAuth } from './AuthContext';

interface SolveResult {
  xpGained: number;
  leveledUp: boolean;
  newBadge?: string;
  newItem?: string;
}

interface GameContextType {
  nodes: ChurchNode[];
  progress: PlayerProgress;
  userLocation: LocationCoordinates | null;
  isLocating: boolean;
  locationError: string | null;
  activeTargetNode: ChurchNode | null;
  proximity: ProximityState | null;
  setUserLocation: (coords: LocationCoordinates) => void;
  setActiveTargetNode: (node: ChurchNode | null) => void;
  solveNode: (nodeId: string) => Promise<SolveResult>;
  resetProgress: () => Promise<void>;
  updateLocationFromGPS: (coords: LocationCoordinates) => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

const RANKS = [
  { level: 1, title: 'Novice Seeker', maxXP: 300 },
  { level: 2, title: 'Faith Pilgrim', maxXP: 450 },
  { level: 3, title: 'Sacred Acolyte', maxXP: 600 },
  { level: 4, title: 'Temple Guardian', maxXP: 800 },
  { level: 5, title: 'Champion of Truth', maxXP: 1000 },
];

/** Server rarity values (enum-ish strings) → the UI's four-value union. */
function normaliseRarity(raw: string): InventoryItem['rarity'] {
  const value = raw.toLowerCase();
  if (value === 'common' || value === 'rare' || value === 'epic' || value === 'legendary') {
    return value;
  }
  return value === 'uncommon' ? 'rare' : 'common';
}

/**
 * Folds the server's boot snapshot (`GET /progress` + `/badges` + `/inventory`)
 * into the local cache: server totals win outright; badges and items union in
 * so nothing the player holds locally is ever lost. Completed node ids are not
 * part of the API contract, so the cache's list is preserved as-is.
 */
function mergeServerSnapshot(
  saved: PlayerProgress,
  summary: ProgressSummary,
  badgeRows: BadgeEntry[],
  itemRows: InventoryEntry[],
): PlayerProgress {
  const badges = saved.badges.map((badge) => {
    const remote = badgeRows.find((row) => row.id === badge.id);
    if (!remote || badge.isUnlocked || !remote.isUnlocked) return badge;
    return {
      ...badge,
      isUnlocked: true,
      unlockedAt: badge.unlockedAt ?? remote.unlockedAt ?? new Date().toISOString(),
    };
  });

  const held = new Set(saved.inventory.map((item) => item.id));
  const extras = itemRows
    .filter((row) => !held.has(row.id))
    .map<InventoryItem>((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon || 'sparkles',
      rarity: normaliseRarity(row.rarity),
      obtainedAt: row.obtainedAt,
      // The server's inventory rows carry no source-node column (plan §6).
      nodeId: '',
    }));

  return {
    ...saved,
    level: summary.level,
    totalXp: summary.totalXp,
    currentXp: summary.currentXp,
    xpForNextLevel: summary.xpForNextLevel,
    rankTitle: summary.rankTitle,
    badges,
    inventory: [...saved.inventory, ...extras],
    lastActiveDate: summary.lastActiveAt ?? saved.lastActiveDate,
  };
}

/**
 * Applies an authoritative `POST /quests/:id/complete` result to the local
 * cache: server XP/level/rank replace the local numbers, the awarded badge and
 * item are merged in, and the node is marked completed — so the UI state after
 * a server completion is indistinguishable from a local one.
 */
function applyServerCompletion(
  progress: PlayerProgress,
  target: ChurchNode,
  result: QuestCompletionResult,
): PlayerProgress {
  const badges = progress.badges.map((badge) =>
    result.newBadge && badge.id === result.newBadge.id && !badge.isUnlocked
      ? { ...badge, isUnlocked: true, unlockedAt: new Date().toISOString() }
      : badge,
  );

  let inventory = progress.inventory;
  const newItem = result.newItem;
  if (newItem && !inventory.some((item) => item.id === newItem.id)) {
    inventory = [
      ...inventory,
      {
        id: newItem.id,
        name: newItem.name,
        description: newItem.description,
        icon: 'sparkles',
        rarity: normaliseRarity(newItem.rarity),
        obtainedAt: new Date().toISOString(),
        nodeId: target.id,
      },
    ];
  }

  return {
    ...progress,
    level: result.level,
    currentXp: result.currentXp,
    xpForNextLevel: result.xpForNextLevel,
    totalXp: result.totalXp,
    rankTitle: result.rankTitle,
    completedNodeIds: Array.from(new Set([...progress.completedNodeIds, target.id])),
    badges,
    inventory,
    lastActiveDate: new Date().toISOString(),
  };
}

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [nodes] = useState<ChurchNode[]>(churchNodesData as ChurchNode[]);
  const [progress, setProgress] = useState<PlayerProgress>(INITIAL_PLAYER_PROGRESS);
  // Starts as null: the app never invents a position. Until the device's
  // first real fix arrives, screens show a "waiting for a position" state.
  const [userLocation, setUserLocationState] = useState<LocationCoordinates | null>(null);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [activeTargetNode, setActiveTargetNode] = useState<ChurchNode | null>(null);

  // Session + backend availability gate every server-authoritative path; on a
  // local-only install (no NEXT_PUBLIC_API_URL) `apiReady` is always false and
  // nothing below ever calls fetch — today's behaviour, byte for byte.
  const { status: authStatus } = useAuth();
  const apiReady = isApiConfigured() && authStatus === 'authenticated';

  // Load saved progress on boot. The local cache applies first (instant UI,
  // offline-first); when signed in against a configured backend the
  // server-authoritative fields (XP, level, rank, badges, items) are refreshed
  // and cached too. `GET /progress` reports counts rather than completed node
  // ids (plan §6 has no such endpoint), so `completedNodeIds` stays a local
  // cache concern — the server still rejects re-completions with 409.
  useEffect(() => {
    if (authStatus === 'loading') return;
    let cancelled = false;
    (async () => {
      const saved = await loadPlayerProgress();
      if (cancelled) return;
      setProgress(saved);
      if (!apiReady) return;
      try {
        const [summary, badgeRows, itemRows] = await Promise.all([
          progressApi.get(),
          badgesApi.list(),
          inventoryApi.list(),
        ]);
        if (cancelled) return;
        const merged = mergeServerSnapshot(saved, summary, badgeRows, itemRows);
        setProgress(merged);
        await savePlayerProgress(merged);
      } catch (err) {
        console.warn('[progress] server refresh skipped:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, apiReady]);

  // Default active target to the first incomplete node
  useEffect(() => {
    if (!activeTargetNode && nodes.length > 0) {
      const firstIncomplete = nodes.find(n => !progress.completedNodeIds.includes(n.id));
      setActiveTargetNode(firstIncomplete || nodes[0]);
    }
  }, [nodes, progress.completedNodeIds, activeTargetNode]);

  // Compute live proximity to the active target
  const proximity = useMemo<ProximityState | null>(() => {
    if (!userLocation || !activeTargetNode) return null;
    return evaluateProximity(userLocation, activeTargetNode);
  }, [userLocation, activeTargetNode]);

  // Feedback fires on the *transition* into range. The active target defaults to
  // the first node, which can already be where the player stands on boot, so
  // without this edge check every page load would buzz + play the arrival tone.
  const wasInRadiusRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const isInRange = proximity?.isWithinRadius ?? false;
    if (isInRange && wasInRadiusRef.current === false) {
      triggerHaptic('success');
      playSoundEffect('in_range');
    }
    wasInRadiusRef.current = isInRange;
  }, [proximity?.isWithinRadius]);

  const setUserLocation = useCallback((coords: LocationCoordinates) => {
    setUserLocationState(coords);
  }, []);

  /**
   * Applies a fix read from the device's Geolocation API. Separate from
   * `setUserLocation` so the GPS watch is the only thing that can move the
   * player around by itself — no other code can fake a position.
   */
  const updateLocationFromGPS = useCallback((coords: LocationCoordinates) => {
    setUserLocationState(coords);
  }, []);

  const solveNode = useCallback(
    async (nodeId: string): Promise<SolveResult> => {
      const target = nodes.find(n => n.id === nodeId);
      if (!target) {
        throw new Error('Node not found');
      }

      // Server-authoritative path (plan §7): with a backend configured and a
      // session live, the server validates the radius, awards XP/badges/items
      // and rejects duplicates — its answer is the one that gets cached. The
      // local logic below stays as the offline/logged-out fallback.
      if (apiReady && userLocation) {
        try {
          const result = await questsApi.complete(target.id, {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            accuracy: (userLocation as { accuracy?: number }).accuracy,
          });
          const updated = applyServerCompletion(progress, target, result);
          setProgress(updated);
          await savePlayerProgress(updated);
          if (result.leveledUp) {
            triggerHaptic('heavy');
            playSoundEffect('level_up');
          } else {
            triggerHaptic('success');
            playSoundEffect('correct');
          }
          return {
            xpGained: result.xpEarned,
            leveledUp: result.leveledUp,
            newBadge: result.newBadge?.name,
            newItem: result.newItem?.name,
          };
        } catch (err) {
          if (err instanceof ApiError && err.code === 'QUEST_ALREADY_COMPLETED') {
            // Another device already claimed it: record it here, award nothing.
            const updated: PlayerProgress = {
              ...progress,
              completedNodeIds: Array.from(new Set([...progress.completedNodeIds, nodeId])),
              lastActiveDate: new Date().toISOString(),
            };
            setProgress(updated);
            await savePlayerProgress(updated);
            return { xpGained: 0, leveledUp: false };
          }
          if (
            err instanceof ApiError &&
            err.status >= 400 &&
            err.status < 500 &&
            err.status !== 401 &&
            err.status !== 403
          ) {
            // A real verdict (OUTSIDE_QUEST_RADIUS, QUEST_INACTIVE, …): the
            // server is the authority, so surface it instead of awarding locally.
            throw new Error(err.message);
          }
          // Unreachable, signed out, or 5xx — fall through to local logic.
          console.warn('[quests] API completion unavailable, using local logic:', err);
        }
      }

      const reward = target.reward;
      const xpGained = reward.xp;
      let newTotalXp = progress.totalXp + xpGained;
      let newCurrentXp = progress.currentXp + xpGained;
      let currentLevel = progress.level;
      let xpForNext = progress.xpForNextLevel;
      let rankTitle = progress.rankTitle;
      let leveledUp = false;

      // Handle Level Up
      if (newCurrentXp >= xpForNext) {
        leveledUp = true;
        newCurrentXp -= xpForNext;
        currentLevel += 1;
        const currentRankConfig = RANKS.find(r => r.level === currentLevel) || {
          title: `Archon Level ${currentLevel}`,
          maxXP: Math.round(xpForNext * 1.3),
        };
        xpForNext = currentRankConfig.maxXP;
        rankTitle = currentRankConfig.title;
      }

      // Check Badges
      let newBadge: string | undefined;
      const updatedBadges = progress.badges.map(b => {
        if (b.id === reward.badgeId && !b.isUnlocked) {
          newBadge = b.title;
          return {
            ...b,
            isUnlocked: true,
            unlockedAt: new Date().toISOString(),
          };
        }
        return b;
      });

      // Check Inventory Items
      let newItem: string | undefined;
      const updatedInventory = [...progress.inventory];
      if (reward.itemId && !updatedInventory.some(i => i.id === reward.itemId)) {
        newItem = reward.itemTitle;
        const item: InventoryItem = {
          id: reward.itemId,
          name: reward.itemTitle || 'Holy Relic',
          description: reward.itemDescription || 'A sacred artifact discovered on church grounds.',
          icon: 'sparkles',
          rarity: reward.itemRarity || 'rare',
          obtainedAt: new Date().toISOString(),
          nodeId: target.id,
        };
        updatedInventory.push(item);
      }

      const updatedCompletedNodeIds = Array.from(
        new Set([...progress.completedNodeIds, nodeId])
      );

      const updatedProgress: PlayerProgress = {
        ...progress,
        level: currentLevel,
        currentXp: newCurrentXp,
        xpForNextLevel: xpForNext,
        totalXp: newTotalXp,
        rankTitle,
        completedNodeIds: updatedCompletedNodeIds,
        badges: updatedBadges,
        inventory: updatedInventory,
        lastActiveDate: new Date().toISOString(),
      };

      setProgress(updatedProgress);
      await savePlayerProgress(updatedProgress);

      if (leveledUp) {
        triggerHaptic('heavy');
        playSoundEffect('level_up');
      } else {
        triggerHaptic('success');
        playSoundEffect('correct');
      }

      return {
        xpGained,
        leveledUp,
        newBadge,
        newItem,
      };
    },
    [nodes, progress, apiReady, userLocation]
  );

  // Local-only reset: the API contract (plan §6) offers no server-side reset,
  // so a signed-in player's server totals are re-merged from the snapshot on
  // the next boot — resetting clears this device's cache, not the account.
  const resetProgress = useCallback(async () => {
    await clearPlayerProgress();
    setProgress(INITIAL_PLAYER_PROGRESS);
    if (nodes.length > 0) {
      setActiveTargetNode(nodes[0]);
    }
  }, [nodes]);

  return (
    <GameContext.Provider
      value={{
        nodes,
        progress,
        userLocation,
        isLocating,
        locationError,
        activeTargetNode,
        proximity,
        setUserLocation,
        updateLocationFromGPS,
        setActiveTargetNode,
        solveNode,
        resetProgress,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = (): GameContextType => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};
