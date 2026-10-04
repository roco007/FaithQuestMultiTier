import path from 'node:path';

/**
 * Where the NestJS API actually lives, as seen from this Next.js server.
 *
 * Deliberately **not** `NEXT_PUBLIC_`-prefixed: this value is server-side only,
 * so the browser bundle never learns the backend's host or port. A phone on the
 * same Wi-Fi only ever needs this app's own address.
 *
 * Plain ESM, no TypeScript syntax: `next.config.mjs` is loaded as-is by Node, so
 * `import type` here would be a parse error, not a type annotation.
 */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

const nextConfig = {
  // The production `Dockerfile` runs the pruned standalone server
  // (`.next/standalone/server.js`) instead of the full source tree.
  output: 'standalone',
  // `web/` is its own Git repository nested inside the Expo project, so
  // Turbopack would otherwise walk up to the parent's package-lock.json and
  // warn that it is outside the current repository. Pinning the build root to
  // this directory keeps module resolution scoped to the web app.
  turbopack: {
    root: path.join(import.meta.dirname),
  },
  // Next.js blocks cross-origin requests to dev-only assets (HMR, chunks)
  // unless the requesting hostname is listed here. `localhost` and the
  // hostname the server was started with are always allowed, but that is not
  // how the app is opened while testing the AR camera: on a phone it is the
  // machine's LAN IP (`npm run dev -H 0.0.0.0`) or the HTTPS tunnel printed by
  // `npm run dev:tunnel`, which both need an explicit entry or the phone's
  // browser gets a stale page without HMR. Entries are hostnames only — no
  // scheme and no port. `*` matches exactly one label, so `192.168.*.*` covers
  // any home/office LAN.
  allowedDevOrigins: ['192.168.*.*', '192.168.0.105', '*.local', '*.trycloudflare.com'],

  /**
   * Reverse proxy: every `/api/v1/*` request is forwarded to the backend.
   *
   * Without it the browser has to call the API's absolute origin, and that
   * breaks the moment the app is opened on another device — `localhost:3001`
   * from a phone means *the phone*, so nothing reaches the server and every
   * join is silently invisible to the creator's progress report. Same-origin
   * requests have no such problem: one address works from a laptop, a LAN IP
   * and an HTTPS tunnel alike.
   *
   * A Next.js rewrite rather than a route handler because it is not a relay
   * written by hand: the body streams through without buffering, every verb and
   * header (notably `Authorization`) is preserved by the framework, and a
   * failure surfaces as a real 5xx instead of a half-read body.
   *
   * Ordering: plain `rewrites` are `afterFiles`, so this runs only when no route
   * or file matched. `app/api/places-search` therefore keeps winning its own
   * path, and there is no ambiguity between the two.
   */
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_PROXY_TARGET}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;