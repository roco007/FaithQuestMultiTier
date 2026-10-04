import { API_PREFIX, apiRequest, getServerApiBaseUrl, isApiConfigured } from './client';
import type { ShortLinkDto } from './types';

/**
 * Asks the backend for a short code standing in for `target`.
 *
 * Never throws: no backend configured, signed out, offline, or a target the
 * server refuses are all reasons a share sheet should keep working rather than
 * fall over — the caller just keeps the full link. That makes this safe to call
 * unconditionally from a "share" affordance.
 */
export async function mintShortLink(target: string): Promise<ShortLinkDto | null> {
  if (!isApiConfigured() || !target) return null;
  try {
    return await apiRequest<ShortLinkDto>('/links', { method: 'POST', body: { target } });
  } catch {
    return null;
  }
}

/**
 * Server-side lookup behind the `/g/[code]` route. Returns the stored path, or
 * `null` when there is no such link (or no backend to ask).
 *
 * A plain `fetch` rather than `apiRequest` because this runs during a redirect,
 * before any browser storage exists: the endpoint is public by design, and
 * `apiRequest` would try to attach and refresh a session that cannot be there.
 * `null` is also the answer for anything that does not look like a path on this
 * app, so a misbehaving API cannot turn our redirect into someone else's.
 *
 * Uses `getServerApiBaseUrl`, not the browser's: this runs on the server, where
 * a relative path has no origin to resolve against and this app's own proxy
 * would be a pointless round trip to ourselves. It goes straight to the backend.
 */
export async function resolveShortLink(code: string): Promise<string | null> {
  const base = getServerApiBaseUrl();
  if (!base || !/^[A-Za-z0-9]{1,8}$/.test(code)) return null;
  try {
    const res = await fetch(`${base}${API_PREFIX}/links/${encodeURIComponent(code)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ShortLinkDto>;
    return typeof data.target === 'string' && data.target.startsWith('/') ? data.target : null;
  } catch {
    return null;
  }
}
