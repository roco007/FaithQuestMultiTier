import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Grants the item a completed landmark rewards (`reward.itemId`).
 *
 * Also the home of the generic "give the player an item" operation, so the
 * inventory rules live in one place. Runs inside the caller's transaction: an
 * item is never recorded without the completion that earned it.
 */
export interface AwardedItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rarity: string;
  iconUrl: string | null;
  quantity: number;
  obtainedAt: string;
}

@Injectable()
export class InventoryAwardService {
  /**
   * Adds one unit of `itemId` to the player's inventory.
   *
   * `quantity` increments rather than resetting, because the same item can be
   * earned from more than one landmark; `@@unique([userId, itemId])` keeps a
   * single row per item, and `upsert` is what makes that safe under a race.
   */
  async award(
    tx: Prisma.TransactionClient,
    userId: string,
    itemId: string,
  ): Promise<AwardedItem | null> {
    const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) return null; // Reward points at a deleted catalogue entry: skip it.

    const row = await tx.userInventory.upsert({
      where: { userId_itemId: { userId, itemId } },
      create: { userId, itemId, quantity: 1 },
      update: { quantity: { increment: 1 } },
    });

    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      description: item.description,
      rarity: item.rarity,
      iconUrl: item.iconUrl,
      quantity: row.quantity,
      obtainedAt: row.obtainedAt.toISOString(),
    };
  }
}