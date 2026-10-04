import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Decides which badges a player has just earned.
 *
 * Two mechanisms, because the existing game already has both:
 *  1. **Explicit quest reward** — the landmark's own `reward.badgeId` (that is
 *     how all six existing badges are currently granted). Passed in as
 *     `rewardBadgeId`.
 *  2. **Achievement rules** — `Badge.requirement` JSON evaluated against the
 *     player's fresh counters, so a badge can be granted for progress rather
 *     than for one specific landmark.
 *
 * Runs inside the quest-completion transaction, so a badge can never be recorded
 * without the completion that earned it. `@@unique([userId, badgeId])` makes a
 * double unlock impossible even if two requests race.
 */
export interface BadgeEvaluationContext {
  totalXp: number;
  level: number;
  completedQuests: number;
  completedHunts: number;
  currentStreak: number;
  /** `Badge.id` granted explicitly by the completed quest, when it has one. */
  rewardBadgeId?: string | null;
}

export interface UnlockedBadge {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  category: string | null;
}

/** A `Badge.requirement` payload. Unknown shapes simply never fire. */
type BadgeRequirement =
  | { type: 'quest_reward' }
  | { type: 'quests_completed'; count: number }
  | { type: 'hunts_completed'; count: number }
  | { type: 'level'; value: number }
  | { type: 'streak'; days: number };

@Injectable()
export class BadgeEvaluatorService {
  private readonly logger = new Logger(BadgeEvaluatorService.name);

  /**
   * Returns the badges newly unlocked by this event. Already-held badges are
   * skipped, so calling this repeatedly for the same event is harmless.
   */
  async evaluate(
    tx: Prisma.TransactionClient,
    userId: string,
    context: BadgeEvaluationContext,
  ): Promise<UnlockedBadge[]> {
    const [catalogue, held] = await Promise.all([
      tx.badge.findMany({ orderBy: { createdAt: 'asc' } }),
      tx.userBadge.findMany({ where: { userId }, select: { badgeId: true } }),
    ]);
    const heldIds = new Set(held.map((row) => row.badgeId));

    const toUnlock = catalogue.filter((badge) => {
      if (heldIds.has(badge.id)) return false;
      if (context.rewardBadgeId && badge.id === context.rewardBadgeId) return true;
      return this.matches(badge.requirement, context);
    });

    if (toUnlock.length === 0) return [];

    // `skipDuplicates` plus the unique constraint: if a concurrent request won
    // the race for a badge, this insert is silently ignored rather than erroring.
    await tx.userBadge.createMany({
      data: toUnlock.map((badge) => ({ userId, badgeId: badge.id })),
      skipDuplicates: true,
    });

    return toUnlock.map((badge) => ({
      id: badge.id,
      slug: badge.slug,
      name: badge.name,
      description: badge.description,
      iconUrl: badge.iconUrl,
      category: badge.category,
    }));
  }

  /** Evaluates one `Badge.requirement` payload against the context. */
  private matches(requirement: unknown, context: BadgeEvaluationContext): boolean {
    if (!requirement || typeof requirement !== 'object') return false;
    const rule = requirement as BadgeRequirement;

    switch (rule.type) {
      case 'quest_reward':
        // Explicit-only: never granted by a rule, or every quest would grant it.
        return false;
      case 'quests_completed':
        return isCount(rule.count) && context.completedQuests >= rule.count;
      case 'hunts_completed':
        return isCount(rule.count) && context.completedHunts >= rule.count;
      case 'level':
        return isCount(rule.value) && context.level >= rule.value;
      case 'streak':
        return isCount(rule.days) && context.currentStreak >= rule.days;
      default:
        this.logger.warn(`Unknown badge requirement: ${JSON.stringify(rule)}`);
        return false;
    }
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}