/**
 * Join-identity checks, run with `npm run test:join`.
 *
 * The rule under test (`rekeyCollidingLocalId` in `context/HuntContext.tsx`): a
 * hunt that arrives as a share payload carries the **creator's** device-local
 * id, which is meaningless on the receiving device and routinely collides with a
 * hunt already there. Left alone, that clash does not merely duplicate a row —
 * it re-points the entire join at the wrong hunt:
 *
 *   - `saveGame` overwrites the phone's own hunt;
 *   - `pushGame` finds the id already in the sync map, resolves it to the phone's
 *     OWN server UUID, and treats the friend's stops as an edit to it;
 *   - `shadowSync` then joins `reference.huntId` — again the phone's own hunt.
 *
 * The friend's creator then watches an empty report while the player walks a hunt
 * that does not exist on their side, and nothing anywhere reports an error. That
 * is the whole failure this guards.
 *
 * These drive the helper against a stubbed device-local store, so they assert the
 * id space rather than any one screen's behaviour.
 */
import assert from 'node:assert/strict';
import { rekeyCollidingLocalId } from '../context/HuntContext';
import { webStorage } from '../utils/webStorage';
import type { HuntCharacter, HuntGame } from '../types/hunt';

/** The store key `localGameRepository` reads hunts from (see gameRepository.ts). */
const HUNTS_KEY = '@faithquest:hunt_games';

const character = (id: string, order: number): HuntCharacter => ({
  id,
  order,
  name: id,
  subtitle: `${id} subtitle`,
  latitude: 10 + order,
  longitude: 20 + order,
  altitudeMeters: order,
  radiusMeters: 12,
  characterType: 'guardian',
  hint: `${id} clue`,
  key: `KEY${id}`,
});

const hunt = (id: string, title: string, shareCode?: string): HuntGame => ({
  id,
  title,
  description: '',
  creatorName: 'Someone',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  endAnnouncement: 'done',
  endCharacterAssetId: 'found-hidden-treasure',
  characters: [character('L1', 1), character('L2', 2)],
  ...(shareCode ? { shareCode } : {}),
});

/**
 * Runs `body` with the device's hunt store seeded to `stored`.
 *
 * `rekeyCollidingLocalId` reads through `localGameRepository`, which is backed by
 * `webStorage` — and that falls back to an in-memory map when there is no
 * `window`, i.e. under Node. So seeding the store is just writing the same key
 * the repository reads, and the previous contents are restored afterwards.
 */
async function withDeviceHunts(stored: HuntGame[], body: () => Promise<void>): Promise<void> {
  const previous = await webStorage.getItem(HUNTS_KEY);
  await webStorage.setItem(
    HUNTS_KEY,
    JSON.stringify(Object.fromEntries(stored.map((g) => [g.id, g])))
  );
  try {
    await body();
  } finally {
    if (previous === null) await webStorage.removeItem(HUNTS_KEY);
    else await webStorage.setItem(HUNTS_KEY, previous);
  }
}

/**
 * The cases, in one async body.
 *
 * Wrapped rather than left at the top level because `tsx` compiles this file to
 * CJS here, where top-level `await` is a parse error — and every case needs it,
 * since the store is read asynchronously.
 */
async function main(): Promise<void> {
  // --- the reported failure: a payload whose id is taken by a different hunt -

  await withDeviceHunts([hunt('0', "Phone's own hunt", 'AAAA11')], async () => {
    const rekeyed = await rekeyCollidingLocalId(hunt('0', "Friend's hunt", 'ZZZZ99'));

    assert.notEqual(
      rekeyed.id,
      '0',
      'a payload must not land on an id this device already uses for another hunt'
    );
    assert.match(rekeyed.id, /^\d+$/, 'the replacement id is a local hunt number');
    assert.equal(rekeyed.title, "Friend's hunt", "the friend's hunt is what gets stored");
    assert.equal(rekeyed.shareCode, 'ZZZZ99', 'its server identity travels with it');
  });

  // --- re-opening the same invite link must not fork a duplicate -------------

  await withDeviceHunts(
    [hunt('0', "Phone's own hunt", 'AAAA11'), hunt('7', "Friend's hunt", 'ZZZZ99')],
    async () => {
      const rekeyed = await rekeyCollidingLocalId(hunt('0', "Friend's hunt", 'ZZZZ99'));
      assert.equal(
        rekeyed.id,
        '7',
        'a hunt already joined under a re-keyed id is matched by shareCode and reused'
      );
    }
  );

  // --- a payload that collides with nothing is left exactly as it was ---------

  await withDeviceHunts([hunt('0', "Phone's own hunt", 'AAAA11')], async () => {
    const rekeyed = await rekeyCollidingLocalId(hunt('12', "Friend's hunt", 'ZZZZ99'));
    assert.equal(rekeyed.id, '12', 'a free id is kept, so the common case is unchanged');
  });

  // --- two hunts from two different creators, both arriving as id "0" --------

  await withDeviceHunts([hunt('0', 'First friend', 'AAAA11')], async () => {
    const second = await rekeyCollidingLocalId(hunt('0', 'Second friend', 'BBBB22'));
    assert.equal(second.id, '1', 'the next free number, as nextGameId allocates');
    assert.equal(second.shareCode, 'BBBB22');
  });

  // --- a device-local hunt (no shareCode) must not be clobbered --------------

  await withDeviceHunts([hunt('0', 'Device-local hunt')], async () => {
    const rekeyed = await rekeyCollidingLocalId(hunt('0', 'Device-local payload'));
    assert.notEqual(rekeyed.id, '0', 'with no shareCode to match on, the id still yields');
  });

  // --- an empty device keeps the payload id (first join on a fresh phone) -----

  await withDeviceHunts([], async () => {
    const rekeyed = await rekeyCollidingLocalId(hunt('0', "Friend's hunt", 'ZZZZ99'));
    assert.equal(rekeyed.id, '0', 'nothing to collide with on a fresh device');
  });

  console.log('join identity ok — a payload re-keying keeps a phone join on the right hunt');
}

void main();
