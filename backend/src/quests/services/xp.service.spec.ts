import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XpService, XP_RANKS, rankFor, type XpState } from './xp.service.js';

const fresh = (overrides: Partial<XpState> = {}): XpState => ({
  totalXp: 0,
  level: 1,
  currentXp: 0,
  xpForNextLevel: 300,
  rankTitle: 'Novice Seeker',
  ...overrides,
});

describe('XpService — parity with the frontend RANKS table', () => {
  it('reproduces GameContext.RANKS exactly (levels, titles, thresholds)', () => {
    assert.deepEqual(
      XP_RANKS.map((r) => [r.level, r.title, r.maxXp]),
      [
        [1, 'Novice Seeker', 300],
        [2, 'Faith Pilgrim', 450],
        [3, 'Sacred Acolyte', 600],
        [4, 'Temple Guardian', 800],
        [5, 'Champion of Truth', 1000],
      ],
    );
  });

  it('grows Archon levels at round(previous × 1.3)', () => {
    assert.equal(rankFor(6).maxXp, 1300);
    assert.equal(rankFor(6).title, 'Archon Level 6');
    assert.equal(rankFor(7).maxXp, 1690);
  });
});

describe('XpService.award', () => {
  it('adds XP below the threshold without levelling', () => {
    const result = new XpService().award(fresh(), 150);
    assert.equal(result.level, 1);
    assert.equal(result.currentXp, 150);
    assert.equal(result.totalXp, 150);
    assert.equal(result.leveledUp, false);
    assert.equal(result.rankTitle, 'Novice Seeker');
  });

  it('levels up exactly at the threshold and keeps the remainder', () => {
    const result = new XpService().award(fresh(), 300);
    assert.equal(result.level, 2);
    assert.equal(result.currentXp, 0);
    assert.equal(result.xpForNextLevel, 450);
    assert.equal(result.rankTitle, 'Faith Pilgrim');
    assert.equal(result.leveledUp, true);
  });

  it('crosses multiple thresholds in one award (the documented improvement)', () => {
    // 800 XP from level 1: −300 → L2 (500 left), −450 → L3 (50 left), stops.
    const result = new XpService().award(fresh(), 800);
    assert.equal(result.level, 3);
    assert.equal(result.currentXp, 50);
    assert.equal(result.xpForNextLevel, 600);
    assert.equal(result.rankTitle, 'Sacred Acolyte');
    assert.equal(result.levelsGained, 2);
  });

  it('never awards negative XP', () => {
    const result = new XpService().award(fresh({ totalXp: 400, currentXp: 100 }), -999);
    assert.equal(result.totalXp, 400);
    assert.equal(result.currentXp, 100);
    assert.equal(result.level, 1);
  });
});

describe('XpService.resolve', () => {
  const xp = new XpService();

  it('derives level state from a raw total', () => {
    assert.equal(xp.resolve(150).level, 1);
    assert.equal(xp.resolve(150).currentXp, 150);
    assert.equal(xp.resolve(300).level, 2);
    assert.equal(xp.resolve(300).currentXp, 0);
    assert.equal(xp.resolve(300 + 450 + 75).level, 3);
    assert.equal(xp.resolve(300 + 450 + 75).currentXp, 75);
  });
});
