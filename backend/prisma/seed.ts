import 'dotenv/config'; // Prisma 7 does not load `.env` itself (same note as prisma.config.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { mariadbPoolConfig } from '../src/prisma/mariadbConfig.js';
import {
  PrismaClient,
  type ItemRarity,
  type Prisma,
  type QuestType,
} from '../src/generated/prisma/client.js';

/**
 * Phase 5 seed: the six starter landmarks of `prisma/fixtures/church_nodes.json`,
 * the six badges from `utils/storage.ts`, and the six items those landmarks
 * reward.
 *
 * The fixture is a *copy* of the frontend's landmark catalogue. The backend
 * keeps its own so it stays self-contained — nothing outside `backend/` is read
 * when seeding. Update the frontend file first (it is what the app renders),
 * then copy it across:
 *   cp frontend/data/church_nodes.json backend/prisma/fixtures/
 *
 * Everything is keyed on the *stable* ids the frontend already uses
 * (`node_01_chapel`, `badge_first_step`, `item_azure_shard`) and every write is
 * an `upsert`, so the seed is idempotent and re-runnable whenever the JSON
 * changes: `npm run prisma:seed`.
 *
 * Order matters — badges and items first, then the nodes that link to them via
 * `QuestNode.rewardBadgeId` / `rewardItemId`, which is exactly how the fixture
 * expresses the rewards (`reward.badgeId`/`itemId`).
 */

/** The JSON's shape (`types/node.ts` `ChurchNode`), narrowed to what we read. */
interface SeedNode {
  id: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  description: string;
  clueHint: string;
  category: string;
  iconName: string;
  puzzle: Record<string, unknown> & { type: string };
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

/** Copy lifted verbatim from `INITIAL_PLAYER_PROGRESS.badges` in `utils/storage.ts`. */
const BADGE_COPY: Record<string, { description: string; category: string }> = {
  badge_first_step: {
    description: 'Discovered your first holy landmark.',
    category: 'exploration',
  },
  badge_cryptographer: {
    description: 'Decoded an ancient church anagram.',
    category: 'wisdom',
  },
  badge_sentinel: {
    description: 'Explored the historic Campanile bell tower.',
    category: 'exploration',
  },
  badge_watchman: {
    description: 'Solved the contemplation mystery in the Garden.',
    category: 'wisdom',
  },
  badge_holy_architect: {
    description: 'Uncovered the secrets of the High Altar mosaic.',
    category: 'mastery',
  },
  badge_scripture_master: {
    description: 'Answered the ancient Greek script question in the Crypt.',
    category: 'mastery',
  },
};

/**
 * `Badge.requirement` payloads (`badge-evaluator.service.ts` understands these).
 *
 * Four badges are explicit-only (`quest_reward`): the landmark that carries
 * `rewardBadgeId` grants them and a rule never can — identical to today's
 * client, which unlocks on `reward.badgeId` alone. The migration plan (§7)
 * additionally wants `badge_cryptographer` and `badge_scripture_master`
 * reachable by rule, so those two carry a `quests_completed` threshold set to
 * their landmark's position in the catalogue (2nd and 6th): a player walking
 * the normal route still unlocks them at their own landmark, and the rule only
 * fires once that many landmarks are done anyway.
 */
const BADGE_RULES: Record<string, Record<string, unknown>> = {
  badge_first_step: { type: 'quest_reward' },
  badge_cryptographer: { type: 'quests_completed', count: 2 },
  badge_sentinel: { type: 'quest_reward' },
  badge_watchman: { type: 'quest_reward' },
  badge_holy_architect: { type: 'quest_reward' },
  badge_scripture_master: { type: 'quests_completed', count: 6 },
};

/** `puzzle.type` (`types/node.ts`) → `QuestType`. */
function questTypeOf(puzzleType: string): QuestType {
  switch (puzzleType) {
    case 'mcq':
      return 'QUIZ';
    case 'unscramble':
      return 'PUZZLE';
    case 'camera_qr':
      return 'CAMERA_QR';
    default:
      return 'LOCATION';
  }
}

/** `reward.itemRarity` (`common|rare|epic|legendary`) → `ItemRarity`. */
function rarityOf(value: string | undefined): ItemRarity {
  const normalised = (value ?? 'common').toUpperCase();
  const known: string[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
  return known.includes(normalised) ? (normalised as ItemRarity) : 'COMMON';
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env first.');
  }

  const nodesUrl = new URL('./fixtures/church_nodes.json', import.meta.url);
  const nodes = JSON.parse(readFileSync(fileURLToPath(nodesUrl), 'utf8')) as SeedNode[];
  if (nodes.length === 0) {
    throw new Error('prisma/fixtures/church_nodes.json contains no nodes.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(mariadbPoolConfig(connectionString)),
  });

  try {
    // 1. Badges (needed before the nodes that reference them).
    const badgeIds = new Map<string, string>();
    for (const node of nodes) {
      const { badgeId, badgeTitle, badgeIcon } = node.reward;
      if (!badgeId) continue;
      const copy = BADGE_COPY[badgeId];
      if (!copy) throw new Error(`No badge copy for "${badgeId}" — add it to BADGE_COPY.`);
      if (!badgeTitle) throw new Error(`Node "${node.id}" has a badgeId but no badgeTitle.`);
      const badge = await prisma.badge.upsert({
        where: { slug: badgeId },
        create: {
          slug: badgeId,
          name: badgeTitle,
          description: copy.description,
          iconUrl: badgeIcon ?? null,
          category: copy.category,
          requirement: (BADGE_RULES[badgeId] ?? { type: 'quest_reward' }) as Prisma.InputJsonValue,
        },
        // `requirement` is deliberately *not* in `update`: this file is the
        // source of truth for rules, and re-seeding should restore them.
        update: {
          name: badgeTitle,
          description: copy.description,
          iconUrl: badgeIcon ?? null,
          category: copy.category,
        },
      });
      badgeIds.set(badgeId, badge.id);
    }

    // 2. Items.
    const itemIds = new Map<string, string>();
    for (const node of nodes) {
      const { itemId, itemTitle, itemDescription, itemRarity } = node.reward;
      if (!itemId) continue;
      if (!itemTitle) throw new Error(`Node "${node.id}" has an itemId but no itemTitle.`);
      const item = await prisma.inventoryItem.upsert({
        where: { slug: itemId },
        create: {
          slug: itemId,
          name: itemTitle,
          description: itemDescription ?? null,
          rarity: rarityOf(itemRarity),
        },
        update: {
          name: itemTitle,
          description: itemDescription ?? null,
          rarity: rarityOf(itemRarity),
        },
      });
      itemIds.set(itemId, item.id);
    }

    // 3. The starter landmarks themselves (the catalogue `GET /quests` serves).
    for (const node of nodes) {
      const data = {
        title: node.title,
        subtitle: node.subtitle,
        description: node.description,
        type: questTypeOf(node.puzzle.type),
        latitude: node.latitude,
        longitude: node.longitude,
        radiusMeters: node.radiusMeters,
        clue: node.clueHint,
        puzzle: node.puzzle as Prisma.InputJsonValue,
        category: node.category,
        iconName: node.iconName,
        xpReward: node.reward.xp,
        isActive: true,
        rewardBadgeId: node.reward.badgeId ? (badgeIds.get(node.reward.badgeId) ?? null) : null,
        rewardItemId: node.reward.itemId ? (itemIds.get(node.reward.itemId) ?? null) : null,
      };
      await prisma.questNode.upsert({
        where: { slug: node.id },
        create: { slug: node.id, ...data },
        update: data,
      });
    }

    const [nodeCount, badgeCount, itemCount] = await Promise.all([
      prisma.questNode.count(),
      prisma.badge.count(),
      prisma.inventoryItem.count(),
    ]);
    console.log(
      `Seeded FaithQuest: ${nodeCount} quest nodes, ${badgeCount} badges, ${itemCount} items.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
