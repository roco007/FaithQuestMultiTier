import 'dotenv/config'; // Prisma 7 no longer loads .env automatically (see prisma-upgrade-v7/env-variables).
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the connection URL lives here (not in `schema.prisma`), the CLI
 * does not auto-load `.env`, and `migrate dev` no longer runs `generate` or the
 * seed automatically — the npm scripts in `package.json` chain them explicitly.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `npm run prisma:seed` is preferred (it is also what `prisma db seed` runs).
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});