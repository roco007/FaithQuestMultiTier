import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HuntGateService } from './hunt-gate.service.js';
import { HuntRouteService } from './hunt-route.service.js';

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
