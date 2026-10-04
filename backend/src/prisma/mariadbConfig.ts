import type { PoolConfig } from 'mariadb';

/**
 * Turns the CLI's `DATABASE_URL` into the MariaDB driver's pool settings.
 *
 * The driver does not parse a URL at all: it takes an options object, and it
 * understands Node-TLS-style options (`ssl`), not the MySQL client's URL
 * parameters (`ssl-mode`). Passing the raw string through would therefore drop
 * the `?ssl-mode=REQUIRED` that Aiven's managed endpoint requires and connect in
 * cleartext. The URL is parsed here and translated, one parameter at a time, so
 * `DATABASE_URL` stays the single source of truth for both the CLI
 * (`prisma.config.ts`) and the runtime client.
 */
export function mariadbPoolConfig(connectionString: string | undefined): PoolConfig {
  if (!connectionString) {
    // `validateEnvironment` already enforces this before the app is created; the
    // guard keeps the type honest for the paths that bypass it (tests, scripts).
    throw new Error(
      'DATABASE_URL is not set — copy backend/.env.example to backend/.env first.',
    );
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  if (url.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL must be a MySQL connection string (mysql://…).');
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL is missing a database name.');
  }

  // MySQL's own `ssl-mode` semantics, mapped onto the driver's `ssl` option:
  //  * DISABLED / PREFERRED — leave `ssl` unset. The driver then negotiates TLS
  //    only when the server demands it, which is what keeps a TLS-less local
  //    MySQL (docker-compose `db`) working. PREFERRED is also the `mysql` client's
  //    default, and what an absent parameter is treated as below.
  //  * REQUIRED — encrypt, but do not verify the chain: Aiven's server cert is
  //    signed by a CA this process need not carry, so `rejectUnauthorized: false`
  //    is the only setting that connects.
  //  * VERIFY_CA / VERIFY_IDENTITY — encrypt and verify against the system store.
  const sslMode = (
    url.searchParams.get('ssl-mode') ??
    url.searchParams.get('sslmode') ??
    'PREFERRED'
  ).toUpperCase();

  let ssl: PoolConfig['ssl'];
  if (sslMode === 'REQUIRED') {
    ssl = { rejectUnauthorized: false };
  } else if (sslMode === 'VERIFY_CA' || sslMode === 'VERIFY_IDENTITY') {
    ssl = { rejectUnauthorized: true };
  } else if (sslMode !== 'DISABLED' && sslMode !== 'PREFERRED') {
    throw new Error(
      `DATABASE_URL has an unknown ssl-mode "${sslMode}" — use DISABLED, ` +
        'PREFERRED, REQUIRED, VERIFY_CA or VERIFY_IDENTITY.',
    );
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ...(ssl ? { ssl } : {}),
  };
}