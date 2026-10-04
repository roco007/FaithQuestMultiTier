import type { Prisma } from '../generated/prisma/client.js';

/**
 * Shapes a `QuestNode` row into the *existing* frontend `ChurchNode` contract
 * (`types/node.ts`) so `ClueModal`, `RadarHUD`, `XPProgressBar` and the map
 * render the seeded catalogue without a single component change.
 *
 * Two ids are exposed deliberately:
 *  * `id` — the JSON's original slug (`node_01_chapel`). The frontend already
 *    keys `progress.completedNodeIds` by this value, so keeping it means
 *    progress saved before the migration still lines up.
 *  * `serverId` — the UUID any API call should use. The quest completion
 *    endpoint accepts either, so old local state cannot produce a 404.
 */
export interface QuestNodeDto {
  id: string;
  serverId: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  type: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  clueHint: string;
  puzzle: unknown;
  category: string | null;
  iconName: string | null;
  xpReward: number;
  isActive: boolean;
  reward: {
    xp: number;
    badgeId?: string;
    badgeTitle?: string;
    badgeIcon?: string;
    itemId?: string;
    itemTitle?: string;
    itemDescription?: string;
    itemRarity?: string;
  };
}

type QuestNodeWithRewards = Prisma.QuestNodeGetPayload<{
  include: { rewardBadge: true; rewardItem: true };
}>;

/** Decimal → number; Prisma returns Decimals for the coordinate columns. */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  // Prisma's Decimal exposes `toNumber()`; `Number(...)` covers strings too.
  const decimal = value as { toNumber?: () => number };
  return typeof decimal.toNumber === 'function' ? decimal.toNumber() : Number(value);
}

export function toQuestNodeDto(node: QuestNodeWithRewards): QuestNodeDto {
  return {
    id: node.slug,
    serverId: node.id,
    slug: node.slug,
    title: node.title,
    subtitle: node.subtitle,
    description: node.description,
    type: node.type,
    latitude: toNumber(node.latitude),
    longitude: toNumber(node.longitude),
    radiusMeters: node.radiusMeters,
    clueHint: node.clue ?? '',
    puzzle: node.puzzle,
    category: node.category,
    iconName: node.iconName,
    xpReward: node.xpReward,
    isActive: node.isActive,
    reward: {
      xp: node.xpReward,
      ...(node.rewardBadge
        ? {
            badgeId: node.rewardBadge.slug,
            badgeTitle: node.rewardBadge.name,
            badgeIcon: node.rewardBadge.iconUrl ?? 'award',
          }
        : {}),
      ...(node.rewardItem
        ? {
            itemId: node.rewardItem.slug,
            itemTitle: node.rewardItem.name,
            itemDescription: node.rewardItem.description ?? '',
            itemRarity: node.rewardItem.rarity.toLowerCase(),
          }
        : {}),
    },
  };
}