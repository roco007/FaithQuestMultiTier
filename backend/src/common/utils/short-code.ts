/**
 * The alphabet every short code in the product is drawn from: the hunt's join
 * code (`Hunt.shareCode`) and the share-link code (`ShortLink.code`) share one
 * generator so the two never drift apart in length or in the symbols they use.
 *
 * 32 symbols with `0`/`O` and `1`/`I`/`L` dropped — a code gets read aloud and
 * re-typed from a screenshot as often as it gets tapped, so the pairs that are
 * mistyped for one another are the ones left out. Six characters over 32
 * symbols is ~1.07e9 codes, so a collision is handled by retry rather than
 * designed away (see `HuntsService.allocateShareCode`).
 */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SHORT_CODE_LENGTH = 6;

/** A fresh, unambiguous 6-character code (e.g. `MQ7X91`). */
export function randomShortCode(): string {
  let out = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return out;
}
