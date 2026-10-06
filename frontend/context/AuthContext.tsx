'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiNotConfiguredError, isApiConfigured } from '@/lib/api/client';
import { authApi } from '@/lib/api/auth.api';
import { clearSession, readSession, writeSession } from '@/lib/api/session';
import type { AuthUser, LoginInput, RegisterInput } from '@/lib/api/types';

/**
 * Session state for the whole app: who is signed in, and how to sign in/out.
 *
 * Boot reads the persisted token pair and revalidates it against
 * `GET /auth/me`; without `NEXT_PUBLIC_API_URL` (or with no stored session) the
 * context is simply `anonymous`, which is exactly the local-only mode the app
 * already runs in today — nothing here throws during render.
 *
 * Phase 14 wires this session into `GameContext`/`HuntContext`; until then the
 * provider only establishes the session surface the plan asks for (plan §3).
 */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  /** `loading` only during the initial revalidation — gate spinners on it. */
  status: AuthStatus;
  user: AuthUser | null;
  /** False when `NEXT_PUBLIC_API_URL` is unset — sign-in is unavailable. */
  configured: boolean;
  signIn(input: LoginInput): Promise<AuthUser>;
  signUp(input: RegisterInput): Promise<AuthUser>;
  /** Best-effort server revoke, then clears the local session regardless. */
  signOut(): Promise<void>;
  /** Re-reads `/auth/me` (after a profile edit); returns the fresh user. */
  reloadUser(): Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const configured = useMemo(() => isApiConfigured(), []);

  const adopt = useCallback(async (response: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: AuthUser;
  }): Promise<AuthUser> => {
    await writeSession({
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: Date.now() + response.expiresIn * 1000,
      user: response.user,
    });
    setUser(response.user);
    setStatus('authenticated');
    return response.user;
  }, []);

  // Boot: revalidate any persisted session; stay silent when local-only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await readSession();
        if (!session) {
          if (!cancelled) setStatus('anonymous');
          return;
        }
        const me = await authApi.me();
        if (cancelled) return;
        await writeSession({ ...session, user: me });
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        await clearSession();
        setUser(null);
        setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (input: LoginInput): Promise<AuthUser> => {
      if (!configured) throw new ApiNotConfiguredError();
      return adopt(await authApi.login(input));
    },
    [configured, adopt],
  );

  const signUp = useCallback(
    async (input: RegisterInput): Promise<AuthUser> => {
      if (!configured) throw new ApiNotConfiguredError();
      return adopt(await authApi.register(input));
    },
    [configured, adopt],
  );

  const signOut = useCallback(async (): Promise<void> => {
    try {
      const session = await readSession();
      if (configured && session) {
        await authApi.logout(session.refreshToken);
      }
    } catch {
      // Revocation is best-effort — the local session is cleared either way.
    }
    await clearSession();
    setUser(null);
    setStatus('anonymous');
  }, [configured]);

  const reloadUser = useCallback(async (): Promise<AuthUser | null> => {
    if (!configured) return null;
    try {
      const me = await authApi.me();
      const session = await readSession();
      if (session) await writeSession({ ...session, user: me });
      setUser(me);
      setStatus('authenticated');
      return me;
    } catch {
      return user;
    }
  }, [configured, user]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, configured, signIn, signUp, signOut, reloadUser }),
    [status, user, configured, signIn, signUp, signOut, reloadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The auth session. Throws when used outside `AuthProvider`. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}
