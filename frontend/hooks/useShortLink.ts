'use client';

import { useEffect, useState } from 'react';
import { mintShortLink } from '../api/links.api';
import { buildShortJoinUrl, currentOrigin } from '../services/shareGame';

/**
 * The short form of `target`, or `null` while it is being minted — and for
 * good, if one can never be had.
 *
 * Returning `null` rather than a placeholder is deliberate: every caller
 * already has the full link, so `shortUrl ?? fullUrl` degrades to exactly
 * today's behaviour with no error state to render and no empty field to guard
 * against. The swap is silent, and both forms open the same invite.
 *
 * The effect re-runs whenever `target` changes (opening a different hunt's
 * share sheet) and clears the previous code first, so a link minted for one
 * hunt can never be shown under another's.
 */
export function useShortLink(target: string): string | null {
  const [shortUrl, setShortUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setShortUrl(null);
      return;
    }
    let cancelled = false;
    setShortUrl(null);
    void mintShortLink(target).then(result => {
      if (cancelled || !result) return;
      setShortUrl(buildShortJoinUrl(currentOrigin(), result.code));
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  return shortUrl;
}
