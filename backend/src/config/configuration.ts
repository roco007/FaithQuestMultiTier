/**
 * Typed view over the process environment.
 *
 * Everything the application needs is read exactly once, here, so the rest of
 * the code never touches `process.env` directly (see `validation.ts` for the
 * fail-fast checks that run first).
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  frontendOrigin: string;
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
}

/** Splits `CORS_ORIGIN` ("a,b") into a trimmed list. `["*"]` means "any origin". */
function parseOrigins(raw: string | undefined, fallback: string[]): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // "*" is preserved, not stripped: it is a deliberate, loudly-warned opt-in (see
  // `main.ts`), and a config value the app quietly ignores is worse than one it
  // honours with a warning. Any mix of "*" with real origins also means "any" —
  // there is no narrower reading of a wildcard plus a list.
  return origins.length > 0 ? origins : fallback;
}

export default function configuration(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const defaultOrigins = ['http://localhost:3000'];

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3001),
    corsOrigins: parseOrigins(process.env.CORS_ORIGIN, defaultOrigins),
    frontendOrigin: process.env.FRONTEND_ORIGIN?.trim() || 'http://localhost:3000',
    databaseUrl: process.env.DATABASE_URL ?? '',
    jwt: {
      accessSecret: process.env.JWT_SECRET ?? '',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    },
  };
}