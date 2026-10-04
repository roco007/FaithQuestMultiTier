/**
 * Fail-fast environment validation.
 *
 * Runs before the Nest application is created (`main.ts`) so a misconfigured
 * deployment dies at boot with a readable message instead of failing later with
 * an opaque `PrismaClientInitializationError` or a 401 that looks like a bug.
 *
 * Kept dependency-free on purpose: the required list is short, and a schema
 * library would be one more moving part for no gain.
 */
const REQUIRED_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

/** Values that are obviously placeholder secrets — refused outside development. */
const PLACEHOLDER_PATTERN = /(change[-_]?me|do[-_]?not[-_]?reuse|example|secret123)/i;

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_VARS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy backend/.env.example to backend/.env and fill them in.',
    );
  }

  // Database URLs must be MySQL: the Prisma datasource is fixed to mysql, and a
  // leftover Postgres (or sqlite) URL here would only fail much later, mid-query.
  if (!/^mysql:\/\//i.test(env.DATABASE_URL as string)) {
    throw new Error(
      'DATABASE_URL must be a MySQL connection string (mysql://…).',
    );
  }

  if (env.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (PLACEHOLDER_PATTERN.test(env[key] as string)) {
        throw new Error(
          `${key} still looks like the example placeholder. Generate a real secret ` +
            'with `openssl rand -base64 48` before deploying.',
        );
      }
      if ((env[key] as string).length < 24) {
        throw new Error(`${key} must be at least 24 characters in production.`);
      }
    }

    if ((env.CORS_ORIGIN ?? '').split(',').some((origin) => origin.trim() === '*')) {
      throw new Error(
        'CORS_ORIGIN must not contain "*" in production — list the frontend origin(s) instead.',
      );
    }
  }
}