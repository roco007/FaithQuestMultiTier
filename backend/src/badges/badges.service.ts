import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The badge catalogue plus this player's unlock state.
 *
 * Returns the **catalogue** (not just the held badges) because the existing
 * Profile screen renders locked badges too — it maps over
 * `progress.badges` and draws a padlock for `isUnlocked === false`.
 */
export interface BadgeDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  category: string | null;
  isUnlocked: boolean;
  unlockedAt?: string;
}

@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every badge, flagged with whether `userId` holds it (anonymous ⇒ none held). */
  async findAllFor(userId?: string): Promise<BadgeDto[]> {
    const [badges, held] = await Promise.all([
      this.prisma.badge.findMany({ orderBy: { createdAt: 'asc' } }),
      userId
        ? this.prisma.userBadge.findMany({
            where: { userId },
            select: { badgeId: true, unlockedAt: true },
          })
        : Promise.resolve<Array<{ badgeId: string; unlockedAt: Date }>>([]),
    ]);

    // `as const` gives the tuple the `Map` constructor wants (a bare `[a, b]`
    // widens to `any[]`, which `Map` rejects).
    const heldById = new Map(
      held.map((row) => [row.badgeId, row.unlockedAt] as const),
    );

    return badges.map((badge) => {
      const unlockedAt = heldById.get(badge.id);
      return {
        id: badge.slug,
        slug: badge.slug,
        // `name` is the display title in the catalogue (`The Awakening Pilgrim`).
        title: badge.name,
        description: badge.description,
        icon: badge.iconUrl ?? 'award',
        category: badge.category,
        isUnlocked: unlockedAt !== undefined,
        ...(unlockedAt ? { unlockedAt: unlockedAt.toISOString() } : {}),
      };
    });
  }
}