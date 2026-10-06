import { notFound, redirect } from 'next/navigation';
import { resolveShortLink } from '@/lib/api/links.api';

/**
 * `/{g}/{code}` — the short form of a share link.
 *
 * A lookup and a redirect, and nothing else: the invite itself still arrives at
 * `/games` in the fragment, where the existing `#join=` handler reads it. This
 * route is the only new thing a short link adds, which is why a short link and
 * a long one are interchangeable everywhere in the app.
 *
 * Forced dynamic — the target comes from the database on every open, and a
 * redirect resolved at build time would be wrong the moment the row changed.
 */
export const dynamic = 'force-dynamic';

export default async function ShortLinkPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const target = await resolveShortLink(code);
  if (!target) notFound();
  // Relative by construction (the server stores no origin), so this can only
  // ever land back on this app — see `normaliseTarget` in the backend.
  redirect(target);
}
