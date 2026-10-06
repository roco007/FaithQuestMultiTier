import { clearSession, readSession, writeSession } from './session';
import type { AuthResponse } from './types';

/** Every backend route is mounted under this prefix, behind the API origin. */
export const API_PREFIX = '/api/v1';

/**
 * Origin the browser uses for API calls.
 *
 * **Empty string means "same origin".** That is the default, and the whole
 * point of the reverse proxy in `next.config.mjs`: `/api/v1/*` is forwarded to
 * the backend from this server, so the browser only ever needs *this* app's
 * address. That is what makes a phone work — `localhost:3001` typed into a
 * phone's browser means the phone itself, so an absolute API origin silently
 * stops reaching the server on every device except the one serving it, and each
 * join goes unrecorded.
 *
 * `NEXT_PUBLIC_API_URL` remains as an escape hatch for talking to a backend on a
 * *different* origin (a deployed API, say). Leave it unset for normal use.
 *
 * Read as a plain `process.env.NEXT_PUBLIC_…` reference (never destructured) so
 * Next.js can inline it at build time.
 */
export function getApiBaseUrl(): string {
  // When proxying to a local backend, return '' so browser calls go same-origin
  // through the Next.js proxy to localhost:3001 (crucial for phone/LAN testing).
  if (process.env.API_PROXY_TARGET && /localhost|127\.0\.0\.1/.test(process.env.API_PROXY_TARGET)) {
    return '';
  }
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

/**
 * True when API calls can go somewhere real.
 *
 * This no longer means "an API origin is configured": the proxy is always
 * mounted, so calls work same-origin with no env var at all. Gating the remote
 * repository on that old definition would have silently switched the app into
 * local-only mode — losing joins, short links and the creator's progress report
 * — so it now means only "the proxy has not been switched off".
 *
 * Set `NEXT_PUBLIC_API_PROXY=off` to run with no backend at all, which is what
 * this check is for.
 */
export function isApiConfigured(): boolean {
  return process.env.NEXT_PUBLIC_API_PROXY !== 'off';
}

/**
 * Absolute backend origin for calls made **by this server** (server components
 * and route handlers).
 *
 * These must not be relative — `fetch` on the server has no ambient origin to
 * resolve against — and they should not hop through this app's own proxy
 * either, which would be a pointless round trip to ourselves. So they go
 * straight to `API_PROXY_TARGET`, the same value `next.config.mjs` rewrites to.
 *
 * Server-only by construction: `API_PROXY_TARGET` carries no `NEXT_PUBLIC_`
 * prefix, so it is absent from the browser bundle entirely.
 */
export function getServerApiBaseUrl(): string {
  const target =
    process.env.API_PROXY_TARGET ??
    process.env.NEXT_PUBLIC_API_URL ??
    'https://faithquestmultitier.onrender.com';
  return target.replace(/\/+$/, '');
}


/** Any non-2xx response, carrying the backend's error-envelope code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown when a call is attempted without `NEXT_PUBLIC_API_URL` — catch it to fall back. */
export class ApiNotConfiguredError extends Error {
  constructor() {
    super('API not configured (NEXT_PUBLIC_API_URL is unset) — local-only mode.');
    this.name = 'ApiNotConfiguredError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Retry once after a transparent token refresh when the API answers 401.
   * Auth endpoints (login/register/refresh/logout) set this to `false` — a
   * wrong password must surface as 401, not trigger a refresh of another session.
   */
  refreshOn401?: boolean;
}

/** Rotates the stored token pair; `null` when refresh is impossible or rejected. */
async function refreshSession(): Promise<boolean> {
  if (!isApiConfigured()) return false;
  const base = getApiBaseUrl();
  const session = await readSession();
  if (!session) return false;
  // Relative by default — the proxy forwards it, exactly as `apiRequest` does.
  const url = `${base}${API_PREFIX}/auth/refresh`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as AuthResponse;
    await writeSession({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
      user: data.user ?? session.user,
    });
    return true;
  } catch {
    return false;
  }
}

/** Turns a failed response into an `ApiError` with the envelope's code/message. */
async function toApiError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = res.statusText || `Request failed with status ${res.status}.`;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    if (body?.error?.code) {
      code = body.error.code;
      message = body.error.message ?? message;
    }
  } catch {
    // Non-JSON body (proxy error page etc.) — keep the generic message.
  }
  return new ApiError(res.status, code, message);
}

/**
 * The single place the frontend talks to the backend.
 *
 * Responsibilities: base URL + `/api/v1` prefix, JSON serialisation, attaching
 * the stored access token, one transparent refresh-and-retry on 401, and
 * unwrapping the unified error envelope into a typed `ApiError`.
 * Components never call `fetch` directly (plan §2).
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (!isApiConfigured()) throw new ApiNotConfiguredError();

  const { method = 'GET', body, query, refreshOn401 = true } = options;
  const url = buildApiUrl(path, query);

  const send = async (): Promise<Response> => {
    const session = await readSession();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (session) headers['authorization'] = `Bearer ${session.accessToken}`;
    return fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let res = await send();
  if (res.status === 401 && refreshOn401) {
    if (await refreshSession()) {
      res = await send(); // second attempt picks the rotated token up
    } else {
      await clearSession(); // stale/revoked session — next caller sees "signed out"
    }
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Builds the URL an `apiRequest` should hit.
 *
 * Returns a **relative** path (`/api/v1/hunts?limit=20`) when no explicit API
 * origin is set, which is the proxy default. `URL` cannot be used to assemble
 * one — it throws on a path with no origin, and inventing a dummy origin would
 * have `fetch` try to reach it — so the query is encoded with `URLSearchParams`
 * and the string is concatenated. The browser resolves the relative path
 * against the current page, and `next.config.mjs` rewrites it to the backend.
 */
function buildApiUrl(path: string, query?: RequestOptions['query']): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  const target = `${API_PREFIX}${path}${qs ? `?${qs}` : ''}`;

  const base = getApiBaseUrl();
  return base ? `${base}${target}` : target;
}
