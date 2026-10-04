import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { rankFor } from '../quests/services/xp.service.js';

/**
 * Persistent player progress — the data the Profile screen and the HUD read.
 *
 * `GET /progress` returns the brief's contract; `getSnapshot` additionally
 * exposes the raw XP/level fields so `UsersService` can build a profile without
 * a second query.
 */
export interface ProgressSummary {
  level: number;
  totalXp: number;
  currentXp: number;
  xpForNextLevel: number;
  rankTitle: string;
  currentStreak: number;
  longestStreak: number;
  completedQuests: number;
  completedHunts: number;
  lastActiveAt: string | null;
}

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(userId: string): Promise<ProgressSummary> {
    const [user, progress, completedQuests, completedHunts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { totalXp: true, level: true },
      }),
      this.prisma.playerProgress.findUnique({ where: { userId } }),
      this.prisma.questCompletion.count({ where: { userId, status: 'COMPLETED' } }),
      this.prisma.huntParticipant.count({ where: { userId, completed: true } }),
    ]);

    if (!user) {
      throw ApiException.unauthorized('UNAUTHORIZED', 'Your account no longer exists.');
    }

    // `PlayerProgress` is created with every account; the fallback keeps this
    // readable for rows created before that (or by a direct DB import).
    const rank = rankFor(user.level);

    return {
      level: user.level,
      totalXp: user.totalXp,
      currentXp: progress?.currentXp ?? 0,
      xpForNextLevel: progress?.xpForNextLevel ?? rank.maxXp,
      rankTitle: progress?.rankTitle ?? rank.title,
      currentStreak: progress?.currentStreak ?? 0,
      longestStreak: progress?.longestStreak ?? 0,
      completedQuests,
      completedHunts,
      lastActiveAt: progress?.lastActiveAt?.toISOString() ?? null,
    };
  }
}