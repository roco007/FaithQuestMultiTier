import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadgeEvaluatorService, type BadgeEvaluationContext } from './badge-evaluator.service.js';

interface BadgeRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  category: string | null;
  requirement: unknown;
}

const CATALOGUE: BadgeRow[] = [
  { id: 'badge_first_step', slug: 'badge_first_step', name: 'The Awakening Pilgrim', description: '', iconUrl: null, category: 'exploration', requirement: { type: 'quest_reward' } },
  { id: 'badge_cryptographer', slug: 'badge_cryptographer', name: 'Cipher Novice', description: '', iconUrl: null, category: 'mastery', requirement: { type: 'quests_completed', count: 2 } },
  { id: 'badge_level2', slug: 'badge_level2', name: 'Rising Light', description: '', iconUrl: null, category: 'mastery', requirement: { type: 'level', value: 2 } },
  { id: 'badge_streak3', slug: 'badge_streak3', name: 'Faithful Flame', description: '', iconUrl: null, category: 'speed', requirement: { type: 'streak', days: 3 } },
  { id: 'badge_broken', slug: 'badge_broken', name: 'Unknown Rule', description: '', iconUrl: null, category: null, requirement: { type: 'made_up_rule', count: 1 } },
];

/** Minimal stand-in for the Prisma transaction client the evaluator touches. */
function fakeTx(heldIds: string[]) {
  const created: { userId: string; badgeId: string }[] = [];
  const tx = {
    badge: { findMany: async () => CATALOGUE },
    userBadge: {
      findMany: async () => heldIds.map((badgeId) => ({ badgeId })),
      createMany: async (args: { data: { userId: string; badgeId: string }[]; skipDuplicates: boolean }) => {
        assert.equal(args.skipDuplicates, true);
        created.push(...args.data);
        return { count: args.data.length };
      },
    },
  };
  return { tx: tx as never, created };
}

const context = (overrides: Partial<BadgeEvaluationContext> = {}): BadgeEvaluationContext => ({
  totalXp: 0,
  level: 1,
  completedQuests: 0,
  completedHunts: 0,
  currentStreak: 0,
  rewardBadgeId: null,
  ...overrides,
});

const evaluator = new BadgeEvaluatorService();

describe('BadgeEvaluatorService.evaluate', () => {
  it('grants the explicit quest reward even though its rule is quest_reward', async () => {
    const { tx, created } = fakeTx([]);
    const unlocked = await evaluator.evaluate(tx, 'user-1', context({ rewardBadgeId: 'badge_first_step' }));
    assert.deepEqual(unlocked.map((b) => b.id), ['badge_first_step']);
    assert.deepEqual(created, [{ userId: 'user-1', badgeId: 'badge_first_step' }]);
  });

  it('never grants a quest_reward badge by rule alone', async () => {
    const { tx, created } = fakeTx([]);
    const unlocked = await evaluator.evaluate(tx, 'user-1', context({ completedQuests: 6 }));
    assert.ok(!unlocked.some((b) => b.id === 'badge_first_step'));
    assert.ok(!created.some((c) => c.badgeId === 'badge_first_step'));
  });

  it('fires quests_completed at the threshold, not below it', async () => {
    const below = await evaluator.evaluate(fakeTx([]).tx, 'u', context({ completedQuests: 1 }));
    assert.ok(!below.some((b) => b.id === 'badge_cryptographer'));

    const at = await evaluator.evaluate(fakeTx([]).tx, 'u', context({ completedQuests: 2 }));
    assert.ok(at.some((b) => b.id === 'badge_cryptographer'));
  });

  it('fires the level and streak rules from the fresh counters', async () => {
    const unlocked = await evaluator.evaluate(
      fakeTx([]).tx,
      'u',
      context({ level: 2, currentStreak: 3 }),
    );
    const ids = unlocked.map((b) => b.id);
    assert.ok(ids.includes('badge_level2'));
    assert.ok(ids.includes('badge_streak3'));
  });

  it('skips badges the player already holds', async () => {
    const { tx, created } = fakeTx(['badge_cryptographer']);
    const unlocked = await evaluator.evaluate(tx, 'u', context({ completedQuests: 5 }));
    assert.ok(!unlocked.some((b) => b.id === 'badge_cryptographer'));
    assert.ok(!created.some((c) => c.badgeId === 'badge_cryptographer'));
  });

  it('ignores unknown requirement shapes instead of throwing', async () => {
    const unlocked = await evaluator.evaluate(fakeTx([]).tx, 'u', context());
    assert.ok(!unlocked.some((b) => b.id === 'badge_broken'));
  });
});
