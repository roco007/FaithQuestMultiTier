import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { XpService, rankFor } from './xp.service.js';
import { DistanceService } from './distance.service.js';
import { BadgeEvaluatorService } from './badge-evaluator.service.js';
import { InventoryAwardService } from './inventory-award.service.js';
import { QuestsService } from '../quests.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CompleteQuestDto, QuestCompletionResultDto } from '../dto/quest.dto.js';

/** Prisma's unique-constraint violation code (MySQL duplicate-key error 1062). */
const UNIQUE_VIOLATION = 'P2002';

/**
 * The authoritative quest completion (rules #12 and #13).
 *
 * The whole point of this service is that the *server* decides whether a quest
 * was completed and what it pays out. The client sends only where it is standing;
 * everything else — the distance check, the XP, the level, the badge, the item
 * and the completion record — is computed here, in one transaction, from the
 * quest row in MySQL.
 */
@Injectable()
export class QuestCompletionService {
  private readonly logger = new Logger(QuestCompletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quests: QuestsService,
    private readonly xp: XpService,
    private readonly distance: DistanceService,
    private readonly badges: BadgeEvaluatorService,
    private readonly inventory: InventoryAwardService,
  ) {}

  async completeQuest(
    userId: string,
    questIdOrSlug: string,
    dto: CompleteQuestDto,
  ): Promise<QuestCompletionResultDto> {
    this.distance.assertPlausible(dto);

    // 1–2. Find the quest and make sure it is playable.
    const quest = await this.quests.findEntityOrFail(questIdOrSlug);
    if (!quest.isActive) {
      throw ApiException.businessRule(
        'QUEST_INACTIVE',
        'This quest is not currently active.',
      );
    }

    // 3. One completion per player per quest — checked here for a clear message,
    //    and enforced again by `@@unique([userId, questNodeId])` below.
    const alreadyCompleted = await this.prisma.questCompletion.findUnique({
      where: { userId_questNodeId: { userId, questNodeId: quest.id } },
      select: { id: true, completedAt: true },
    });
    if (alreadyCompleted) {
      throw ApiException.conflict(
        'QUEST_ALREADY_COMPLETED',
        'You have already completed this quest.',
        { completedAt: alreadyCompleted.completedAt.toISOString() },
      );
    }

    // 4–6. Independently verify the player is actually there.
    const { distanceMeters, withinRadius, effectiveRadiusMeters } =
      this.distance.isWithinRadius(
        { latitude: dto.latitude, longitude: dto.longitude },
        {
          latitude: num(quest.latitude),
          longitude: num(quest.longitude),
          radiusMeters: quest.radiusMeters,
        },
        dto.accuracy,
      );

    if (!withinRadius) {
      throw ApiException.businessRule(
        'OUTSIDE_QUEST_RADIUS',
        `You are ${Math.round(distanceMeters)} m away — get within ${quest.radiusMeters} m of ${quest.title} to discover its clue.`,
        {
          distanceMeters: Math.round(distanceMeters),
          radiusMeters: quest.radiusMeters,
          effectiveRadiusMeters: Math.round(effectiveRadiusMeters),
        },
      );
    }

    // 7–12. Everything persistent happens in one transaction.
    return this.runCompletionTransaction(userId, quest, dto, distanceMeters);
  }

  private async runCompletionTransaction(
    userId: string,
    quest: Prisma.QuestNodeGetPayload<{ include: { rewardBadge: true; rewardItem: true } }>,
    dto: CompleteQuestDto,
    distanceMeters: number,
  ): Promise<QuestCompletionResultDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 7. The completion record itself. The unique constraint on
        //    (userId, questNodeId) is the real anti-duplication guarantee.
        const completion = await tx.questCompletion.create({
          data: {
            userId,
            questNodeId: quest.id,
            status: 'COMPLETED',
            xpEarned: quest.xpReward,
            latitude: new Prisma.Decimal(dto.latitude),
            longitude: new Prisma.Decimal(dto.longitude),
            distanceMeters: Math.round(distanceMeters),
          },
        });

        // 8–10. XP and level, from the persisted state (never from the client).
        const progress = await this.ensureProgress(tx, userId);
        const awarded = this.xp.award(
          {
            // `level` lives on `User`, not `PlayerProgress` — hence `progress.user`.
            totalXp: progress.user.totalXp,
            level: progress.user.level,
            currentXp: progress.currentXp,
            xpForNextLevel: progress.xpForNextLevel,
            rankTitle: progress.rankTitle,
          },
          quest.xpReward,
        );

        const streak = nextStreak(
          progress.currentStreak,
          progress.longestStreak,
          progress.lastActiveAt,
        );

        await tx.playerProgress.update({
          where: { userId },
          data: {
            currentXp: awarded.currentXp,
            xpForNextLevel: awarded.xpForNextLevel,
            rankTitle: awarded.rankTitle,
            currentStreak: streak.currentStreak,
            longestStreak: streak.longestStreak,
            lastActiveAt: new Date(),
          },
        });

        // The leaderboard reads `User`; the HUD reads `PlayerProgress`. Both are
        // written here so they cannot drift.
        await tx.user.update({
          where: { id: userId },
          data: { totalXp: awarded.totalXp, level: awarded.level },
        });

        // 11. Badge evaluation, against freshly counted progress.
        const [completedQuests, completedHunts] = await Promise.all([
          tx.questCompletion.count({ where: { userId, status: 'COMPLETED' } }),
          tx.huntParticipant.count({ where: { userId, completed: true } }),
        ]);

        const unlocked = await this.badges.evaluate(tx, userId, {
          totalXp: awarded.totalXp,
          level: awarded.level,
          completedQuests,
          completedHunts,
          currentStreak: streak.currentStreak,
          rewardBadgeId: quest.rewardBadgeId,
        });

        // 12. Inventory, when the landmark rewards an item.
        const item = quest.rewardItemId
          ? await this.inventory.award(tx, userId, quest.rewardItemId)
          : null;

        const firstBadge = unlocked[0];

        return {
          status: 'COMPLETED',
          questId: quest.slug,
          xpEarned: quest.xpReward,
          totalXp: awarded.totalXp,
          level: awarded.level,
          currentXp: awarded.currentXp,
          xpForNextLevel: awarded.xpForNextLevel,
          rankTitle: awarded.rankTitle,
          leveledUp: awarded.leveledUp,
          ...(firstBadge
            ? {
                newBadge: {
                  id: firstBadge.slug,
                  slug: firstBadge.slug,
                  name: firstBadge.name,
                  icon: firstBadge.iconUrl ?? 'award',
                },
              }
            : {}),
          ...(item
            ? {
                newItem: {
                  id: item.slug,
                  slug: item.slug,
                  name: item.name,
                  description: item.description ?? '',
                  rarity: item.rarity.toLowerCase(),
                },
              }
            : {}),
          distanceMeters: Math.round(distanceMeters),
          completedAt: completion.completedAt.toISOString(),
        } satisfies QuestCompletionResultDto;
      });
    } catch (error) {
      // Two devices completing the same quest at the same instant: the second
      // insert loses the unique constraint. That is the same outcome as the
      // pre-check, so report it identically instead of a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw ApiException.conflict(
          'QUEST_ALREADY_COMPLETED',
          'You have already completed this quest.',
        );
      }
      throw error;
    }
  }

  /** Creates the progress row lazily, for accounts that predate the feature. */
  private async ensureProgress(tx: Prisma.TransactionClient, userId: string) {
    const progress = await tx.playerProgress.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (progress) return progress;

    this.logger.warn(`Backfilled PlayerProgress for user ${userId}`);
    return tx.playerProgress.create({
      data: {
        userId,
        xpForNextLevel: rankFor(1).maxXp,
        rankTitle: rankFor(1).title,
      },
      include: { user: true },
    });
  }
}

/** Read a Prisma Decimal (or number) as a plain number. */
function num(value: unknown): number {
  const decimal = value as { toNumber?: () => number };
  return typeof decimal?.toNumber === 'function' ? decimal.toNumber() : Number(value);
}

/**
 * Streak rule: consecutive calendar days extend the streak, a skipped day resets
 * it to 1, and a second completion on the same day changes nothing.
 */
export function nextStreak(
  currentStreak: number,
  longestStreak: number,
  lastActiveAt: Date | null,
): { currentStreak: number; longestStreak: number } {
  if (!lastActiveAt) {
    return { currentStreak: 1, longestStreak: Math.max(longestStreak, 1) };
  }

  const today = startOfDay(new Date());
  const last = startOfDay(lastActiveAt);
  const daysApart = Math.round((today.getTime() - last.getTime()) / 86_400_000);

  if (daysApart <= 0) {
    // Same day (or a clock that moved backwards): keep the streak as it is.
    return { currentStreak: Math.max(currentStreak, 1), longestStreak };
  }
  if (daysApart === 1) {
    const extended = currentStreak + 1;
    return {
      currentStreak: extended,
      longestStreak: Math.max(longestStreak, extended),
    };
  }
  return { currentStreak: 1, longestStreak };
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}