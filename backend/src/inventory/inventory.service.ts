import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The player's backpack.
 *
 * Returns items in the shape `app/inventory/page.tsx` already renders — the
 * `InventoryItem` interface from `types/inventory.ts` (`name`, `description`,
 * `icon`, `rarity`, `obtainedAt`) — plus the catalogue `slug` as `id`, which is
 * the id the frontend's local progress used before the migration.
 */
export interface InventoryItemDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: string;
  quantity: number;
  obtainedAt: string;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllFor(userId: string): Promise<InventoryItemDto[]> {
    const rows = await this.prisma.userInventory.findMany({
      where: { userId },
      include: { item: true },
      orderBy: { obtainedAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.item.slug,
      slug: row.item.slug,
      name: row.item.name,
      description: row.item.description ?? '',
      icon: row.item.iconUrl ?? 'sparkles',
      rarity: row.item.rarity.toLowerCase(),
      quantity: row.quantity,
      obtainedAt: row.obtainedAt.toISOString(),
    }));
  }
}