import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HuntGateService } from './hunt-gate.service.js';
import { HuntRouteService, validateReorder } from './hunt-route.service.js';

const gate = new HuntGateService();

const MCQ_STOP = {
  key: 'ALPHA',
  questions: [
    {
      id: 'q1',
      type: 'mcq',
      prompt: 'Where was it written?',
      options: [
        { id: 'a', text: 'Rome', isCorrect: false },
        { id: 'b', text: 'Jerusalem', isCorrect: true },
      ],
    },
  ],
};

const TEXT_STOP = {
  key: null,
  questions: [
    { id: 'q2', type: 'text', prompt: 'Name the mountain', answers: ['Mount Sinai'] },
  ],
};

describe('HuntGateService.keyMatches', () => {
  it('normalises trim, inner spaces and case (mirrors utils/keys.ts)', () => {
    assert.equal(gate.keyMatches('  al pha  ', 'ALPHA'), true);
    assert.equal(gate.keyMatches('ALPHA', 'ALPHA'), true);
    assert.equal(gate.keyMatches('beta', 'ALPHA'), false);
    assert.equal(gate.keyMatches(undefined, 'ALPHA'), false);
    assert.equal(gate.keyMatches('', 'ALPHA'), false);
  });

  it('accepts everything when the stop has no key (legacy stops)', () => {
    assert.equal(gate.keyMatches(undefined, null), true);
    assert.equal(gate.keyMatches('anything', null), true);
  });
});

describe('HuntGateService.evaluate', () => {
  it('rejects a wrong key before looking at answers', () => {
    const verdict = gate.evaluate(MCQ_STOP, 'WRONG', [
      { questionId: 'q1', selectedOptionId: 'b' },
    ]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'INVALID_KEY');
  });

  it('opens a key-only stop with the right key', () => {
    assert.deepEqual(gate.evaluate({ key: 'ALPHA', questions: [] }, 'alpha', undefined), {
      ok: true,
    });
  });

  it('accepts the correct MCQ selection', () => {
    const verdict = gate.evaluate(MCQ_STOP, 'ALPHA', [
      { questionId: 'q1', selectedOptionId: 'b' },
    ]);
    assert.equal(verdict.ok, true);
  });

  it('rejects the wrong MCQ selection, naming the question', () => {
    const verdict = gate.evaluate(MCQ_STOP, 'ALPHA', [
      { questionId: 'q1', selectedOptionId: 'a' },
    ]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'WRONG_ANSWER');
    assert.equal(verdict.questionId, 'q1');
  });

  it('fuzzy-matches typed answers at ≥ 80 % similarity (Levenshtein)', () => {
    const close = gate.evaluate(TEXT_STOP, undefined, [
      { questionId: 'q2', text: 'mount sinai' },
    ]);
    assert.equal(close.ok, true);

    const wrong = gate.evaluate(TEXT_STOP, undefined, [
      { questionId: 'q2', text: 'Mount Everest' },
    ]);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, 'WRONG_ANSWER');
  });

  it('treats omitted answers as the client attesting the stop (plan §6)', () => {
    // The AR UI ran the local gate offline and sends only the key.
    assert.equal(gate.evaluate(MCQ_STOP, 'ALPHA', undefined).ok, true);
    assert.equal(gate.evaluate(TEXT_STOP, undefined, undefined).ok, true);
  });

  it('stays strict once an answers array is supplied — even an empty one', () => {
    const empty = gate.evaluate(MCQ_STOP, 'ALPHA', []);
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, 'WRONG_ANSWER');
  });

  it('rejects an unanswered question in the list', () => {
    const verdict = gate.evaluate(MCQ_STOP, 'ALPHA', [
      { questionId: 'some_other_id', selectedOptionId: 'b' },
    ]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.questionId, 'q1');
  });
});

describe('HuntRouteService.resolve', () => {
  const routes = new HuntRouteService();
  const nodes = [
    { id: 'a', isTreasure: false },
    { id: 'b', isTreasure: false },
    { id: 'c', isTreasure: true },
  ];

  it('never duplicates the treasure even though the stored deal holds it', () => {
    // Every published deal ends with the treasure id; resolving must treat it
    // as the end marker, not as a walkable stop to append the end to again.
    const resolved = routes.resolve(nodes, ['a', 'b'], ['b', 'a', 'c']);
    assert.deepEqual(
      resolved.map((node) => node.id),
      ['a', 'b', 'c'],
    );
    const fromPublished = routes.resolve(nodes, [], ['b', 'a', 'c']);
    assert.equal(fromPublished.length, 3);
    assert.equal(fromPublished[fromPublished.length - 1]?.id, 'c');
  });
});

describe('validateReorder', () => {
  const CURRENT = ['a', 'b', 'c', 'd'];

  it('accepts any permutation of the hunt’s own stops', () => {
    assert.equal(validateReorder(CURRENT, ['a', 'b', 'c', 'd']), null);
    assert.equal(validateReorder(CURRENT, ['d', 'c', 'b', 'a']), null); // full reverse
    assert.equal(validateReorder(CURRENT, ['b', 'a', 'd', 'c']), null); // two swaps
    // A rotation: the exact shape the creator's "move earlier"/"move later"
    // buttons produce, and the one a naive unique-index write would trip on.
    assert.equal(validateReorder(CURRENT, ['b', 'c', 'd', 'a']), null);
  });

  it('accepts a single adjacent swap unchanged', () => {
    // Pressing an arrow at the end of the list is often a no-op; the client may
    // still send it, and re-sending the current order must not be an error.
    assert.equal(validateReorder(['a', 'b'], ['a', 'b']), null);
  });

  it('rejects a repeated stop', () => {
    // [a, a, b, d] has the right length and only known ids, so a naive
    // "same size + all known" check would pass it — while quietly dropping c.
    assert.equal(validateReorder(CURRENT, ['a', 'a', 'b', 'd']), 'DUPLICATE_ID');
    assert.equal(validateReorder(CURRENT, ['a', 'a', 'a', 'a']), 'DUPLICATE_ID');
  });

  it('rejects a stop from another hunt', () => {
    assert.equal(validateReorder(CURRENT, ['a', 'b', 'c', 'zz']), 'UNKNOWN_ID');
    assert.equal(validateReorder(CURRENT, ['a', 'b', 'c', 'd', 'e']), 'UNKNOWN_ID');
  });

  it('rejects a partial list — the “I only sent the ones I moved” mistake', () => {
    // Accepting this would strand the unlisted stops at their old positions,
    // leaving duplicate `sequence` values for `@@unique([huntId, sequence])`,
    // or renumbering stops the caller never mentioned.
    assert.equal(validateReorder(CURRENT, ['b', 'a']), 'COUNT_MISMATCH');
    assert.equal(validateReorder(CURRENT, ['a', 'b', 'c']), 'COUNT_MISMATCH');
    assert.equal(validateReorder(CURRENT, []), 'COUNT_MISMATCH');
  });

  it('rejects a list longer than the hunt even when every id is known twice', () => {
    assert.equal(validateReorder(['a', 'b'], ['a', 'b', 'a', 'b']), 'DUPLICATE_ID');
  });

  it('reports the same verdict for a hunt with a single stop', () => {
    assert.equal(validateReorder(['only'], ['only']), null);
    assert.equal(validateReorder(['only'], []), 'COUNT_MISMATCH');
    assert.equal(validateReorder(['only'], ['other']), 'UNKNOWN_ID');
  });
});

describe('two-phase reorder write', () => {
  /**
   * Mirrors the parking strategy in `HuntsService.reorderStops`, and asserts the
   * invariant that makes it necessary: `HuntNode` carries
   * `@@unique([huntId, sequence])`, so writing the final positions one row at a
   * time collides on any swap unless every row is first moved out of range.
   */
  it('never reuses a live sequence at any point in a rotation', () => {
    const before = { a: 1, b: 2, c: 3, d: 4 };
    const wanted = ['b', 'c', 'd', 'a'];
    const rows = new Map(Object.entries(before));

    const collides = () => new Set(rows.values()).size !== rows.size;

    // A direct write does collide — this is the bug the two phases exist for.
    const naive = new Map(rows);
    let collided = false;
    for (const [index, id] of wanted.entries()) {
      naive.set(id, index + 1);
      if (new Set(naive.values()).size !== naive.size) collided = true;
    }
    assert.equal(collided, true, 'a direct write is expected to violate the unique index');

    // Phase 1: park every row at a distinct negative. Safe in any order.
    let index = 0;
    for (const id of rows.keys()) rows.set(id, -(index++ + 1));
    assert.equal(collides(), false);

    // Phase 2: claim the final 1..n. Safe because every live value is negative.
    for (const [i, id] of wanted.entries()) rows.set(id, i + 1);
    assert.equal(collides(), false);

    // …and the end state is the requested order, with no negative residue.
    assert.deepEqual(
      [...rows.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id),
      wanted,
    );
    assert.equal([...rows.values()].every((v) => v >= 1), true);
  });
});
