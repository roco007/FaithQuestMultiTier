import { webStorage } from '../utils/webStorage';
import type { AuthUser } from './types';

/**
 * Where the JWT pair (and the last-known user) live between page loads.
 *
 * Uses `webStorage` (localStorage with a memory fallback) so the module stays
 * importable during server rendering — every read/write is lazy.
 *
 * Security note: access tokens are short-lived (`expiresIn` seconds), and a
 * stolen refresh token only yields a new pair until the server rotates/revokes
 * it. localStorage is acceptable here because the API is same-product CORS and
 * the payload is identity only — no privileged data rides on the token itself.
 */
const STORAGE_KEY = '@faithquest:auth_session';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token (epoch ms) — used to pre-empt 401s. */
  expiresAt: number;
  /** The user as last seen from `/auth/me` — refreshed on next boot. */
  user: AuthUser | null;
}

/** Returns the stored session, or `null` when absent/unreadable/invalid. */
export async function readSession(): Promise<AuthSession | null> {
  try {
    const raw = await webStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string'
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
      user: parsed.user ?? null,
    };
  } catch {
    return null;
  }
}

export async function writeSession(session: AuthSession): Promise<void> {
  await webStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await webStorage.removeItem(STORAGE_KEY);
}
