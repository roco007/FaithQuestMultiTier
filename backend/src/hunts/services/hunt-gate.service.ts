import { Injectable } from '@nestjs/common';

/**
 * The stop gate — the server-side mirror of the two pure modules the AR camera
 * uses offline: `utils/keys.ts` (the discovery key) and `utils/huntQuestions.ts`
 * (the reveal questions).
 *
 * The constants are copied deliberately rather than shared: the two apps deploy
 * separately, and the rule that a *typed* answer needs 80 % similarity is a game
 * rule that must not silently drift. Both files name each other in a comment.
 */
const MIN_SIMILARITY = 0.8;

export interface GateQuestion {
  id?: string;
  type?: string;
  prompt?: string;
  answers?: unknown;
  options?: unknown;
}

export interface GateAnswer {
  questionId?: string;
  selectedOptionId?: string;
  text?: string;
}

export interface GateResult {
  ok: boolean;
  /** Which rule refused, for the error code/message. */
  reason?: 'INVALID_KEY' | 'WRONG_ANSWER';
  questionId?: string;
}

@Injectable()
export class HuntGateService {
  /** Trim, drop inner whitespace, uppercase — matches `normaliseKey`. */
  normaliseKey(raw: string | undefined | null): string {
    return (raw ?? '').replace(/\s+/g, '').toUpperCase();
  }

  /** True when no key is stored (legacy stops) or the presented key matches. */
  keyMatches(presented: string | undefined, expected: string | null): boolean {
    if (!expected) return true;
    const a = this.normaliseKey(presented);
    const b = this.normaliseKey(expected);
    return a.length > 0 && a === b;
  }

  /**
   * Evaluates the whole gate for one stop: the key first (it is what unlocks the
   * questions), then every question.
   */
  evaluate(
    stop: { key: string | null; questions: unknown },
    presentedKey: string | undefined,
    answers: GateAnswer[] | undefined,
  ): GateResult {
    if (!this.keyMatches(presentedKey, stop.key)) {
      return { ok: false, reason: 'INVALID_KEY' };
    }

    // `answers` is optional by contract (plan §6): a client that omits it ran
    // the local question gate offline (`utils/huntQuestions.ts` in the web app)
    // and is attesting the stop — while order, join state and the key checked
    // above remain the server's to decide. Sending an `answers` array (even an
    // empty one) opts into the strict re-validation below, so a client that has
    // the answers is always checked against them.
    if (answers === undefined) {
      return { ok: true };
    }

    const questions = toQuestions(stop.questions);
    for (const question of questions) {
      const submitted = (answers ?? []).find(
        (answer) => answer.questionId === question.id,
      );
      if (!submitted) {
        return { ok: false, reason: 'WRONG_ANSWER', questionId: question.id };
      }
      if (
        !isQuestionCorrect(
          question,
          submitted.selectedOptionId ?? null,
          submitted.text ?? '',
        )
      ) {
        return { ok: false, reason: 'WRONG_ANSWER', questionId: question.id };
      }
    }

    // A stop with no questions is opened by its key alone (legacy behaviour).
    return { ok: true };
  }
}

/** Normalises the stored `questions` JSON into the shape the gate reads. */
export function toQuestions(raw: unknown): GateQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (question): question is GateQuestion =>
      typeof question === 'object' && question !== null,
  );
}

/** True when the submission satisfies one question. */
export function isQuestionCorrect(
  question: GateQuestion,
  selectedOptionId: string | null,
  typedText: string,
): boolean {
  if (question.type === 'mcq') {
    const options = Array.isArray(question.options) ? question.options : [];
    const selected = options.find(
      (option) =>
        typeof option === 'object' &&
        option !== null &&
        (option as { id?: string }).id === selectedOptionId,
    );
    return (selected as { isCorrect?: boolean } | undefined)?.isCorrect === true;
  }

  const typed = normaliseAnswer(typedText);
  if (!typed) return false;
  const accepted = Array.isArray(question.answers) ? question.answers : [];
  return accepted.some(
    (answer) =>
      typeof answer === 'string' &&
      similarity(typed, normaliseAnswer(answer)) >= MIN_SIMILARITY,
  );
}

function normaliseAnswer(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 1 − editDistance / longerLength (identical strings score 1). */
function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return a === b ? 1 : 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}