import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Paginated } from '../common/dto/pagination-query.dto.js';

/**
 * Field standings — replaces the hard-coded `LEADERBOARD_DATA` array that
 * `app/profile/page.tsx` shipped with.
 *
 * Ranked by `User.totalXp`, which the completion transaction keeps in step with
 * `PlayerProgress`. Public (no token) so the standings can be shown before
 * sign-in; `/me` is the caller's own row and rank.
 */
export interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  totalXp: number;
  level: number;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: number, limit: number): Promise<Paginated<LeaderboardEntryDto>> {
    const [total, users] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        orderBy: [{ totalXp: 'desc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          totalXp: true,
          level: true,
        },
      }),
    ]);

    return {
      items: users.map((user, index) => ({
        rank: (page - 1) * limit + index + 1,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        totalXp: user.totalXp,
        level: user.level,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * The caller's own entry.
   *
   * `rank` is a count of the players strictly ahead, plus one — computed in the
   * database rather than by fetching the whole board.
   */
  async findMe(userId: string): Promise<LeaderboardEntryDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        totalXp: true,
        level: true,
      },
    });
    if (!user) return null;

    const ahead = await this.prisma.user.count({
      where: { totalXp: { gt: user.totalXp } },
    });

    return {
      rank: ahead + 1,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      totalXp: user.totalXp,
      level: user.level,
    };
  }
}