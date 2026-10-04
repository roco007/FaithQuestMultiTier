import { Injectable } from '@nestjs/common';

/**
 * XP and level maths — the server-side authority (rule #11).
 *
 * `XP_RANKS` and the `Math.round(previous × 1.3)` growth *exactly* reproduce the
 * table the frontend used before the migration (`context/GameContext.tsx`
 * `RANKS`), so every existing player keeps the level and rank title they had.
 * The constants are duplicated there only as the offline fallback and are
 * commented as such; this file is the source of truth.
 *
 * One deliberate difference: the old client code could level up at most once per
 * solve, leaving `currentXp` above the bar's maximum after a large award. This
 * implementation keeps consuming thresholds until the award is spent, which is
 * what makes the HUD's percentage meaningful. Thresholds are identical, so no
 * player's level changes.
 */
export interface XpRank {
  level: number;
  title: string;
  /** XP required to move from this level to the next. */
  maxXp: number;
}

export const XP_RANKS: readonly XpRank[] = [
  { level: 1, title: 'Novice Seeker', maxXp: 300 },
  { level: 2, title: 'Faith Pilgrim', maxXp: 450 },
  { level: 3, title: 'Sacred Acolyte', maxXp: 600 },
  { level: 4, title: 'Temple Guardian', maxXp: 800 },
  { level: 5, title: 'Champion of Truth', maxXp: 1000 },
];

/** Growth factor applied beyond the named ranks (matches the old client). */
const ARCHON_GROWTH = 1.3;

/** Rank definition for any level, including the `Archon Level N` overflow. */
export function rankFor(level: number): XpRank {
  const known = XP_RANKS.find((rank) => rank.level === level);
  if (known) return known;

  let maxXp = XP_RANKS[XP_RANKS.length - 1].maxXp;
  for (let current = XP_RANKS.length + 1; current <= level; current += 1) {
    maxXp = Math.round(maxXp * ARCHON_GROWTH);
  }
  return { level, title: `Archon Level ${level}`, maxXp };
}

/** Mutable XP/level state — the fields `PlayerProgress` persists. */
export interface XpState {
  totalXp: number;
  level: number;
  currentXp: number;
  xpForNextLevel: number;
  rankTitle: string;
}

export interface XpAwardResult extends XpState {
  level: number;
  levelsGained: number;
  leveledUp: boolean;
}

/**
 * Adds XP to a player's state and resolves every threshold it crosses.
 *
 * Pure and synchronous, so it can be unit-tested without a database — which is
 * exactly how the "a player must not receive XP twice" rule is verified end to
 * end (§16).
 */
@Injectable()
export class XpService {
  /** Applies an award to the given state and returns the new state. */
  award(state: XpState, xpGained: number): XpAwardResult {
    const gained = Math.max(0, Math.trunc(xpGained));

    let level = state.level;
    let currentXp = state.currentXp + gained;
    let xpForNextLevel = state.xpForNextLevel || rankFor(level).maxXp;
    let rankTitle = state.rankTitle || rankFor(level).title;
    let levelsGained = 0;

    while (currentXp >= xpForNextLevel) {
      currentXp -= xpForNextLevel;
      level += 1;
      levelsGained += 1;
      const nextRank = rankFor(level);
      xpForNextLevel = nextRank.maxXp;
      rankTitle = nextRank.title;
    }

    return {
      totalXp: state.totalXp + gained,
      level,
      currentXp,
      xpForNextLevel,
      rankTitle,
      levelsGained,
      leveledUp: levelsGained > 0,
    };
  }

  /** Level and remainder for a raw XP total (used when seeding/back-filling). */
  resolve(totalXp: number): XpState {
    return this.award(
      { totalXp: 0, level: 1, currentXp: 0, xpForNextLevel: rankFor(1).maxXp, rankTitle: rankFor(1).title },
      totalXp,
    );
  }
}