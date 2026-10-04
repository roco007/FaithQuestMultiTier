# ── FaithQuest backend (NestJS 12 + Prisma 7) ─────────────────────────────────
# Multi-stage build: dependencies + Prisma client generation + NestJS build in
# the builder, then a minimal production image that runs migrations and starts
# the API. Node 22 is required (NestJS 12 is ESM-only; engines >= 20).
FROM node:22-alpine AS builder
WORKDIR /app

# Install first for a stable layer cache (rebuilds only when deps change).
COPY package.json package-lock.json ./
RUN npm ci

# Prisma schema + migrations must be present before `generate`, and the client
# must exist before `nest build` compiles `src/generated/prisma`.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Production image ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# `prisma migrate deploy` runs inside the container at startup, so the CLI is
# needed at runtime (not just a devDependency for the builder).
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Fail fast when required secrets are missing (see src/config/validation.ts).
# Provide values via environment or an env_file — never bake them into the image.
ENV PORT=3001

EXPOSE 3001

# Apply pending migrations, then start the API. The seed is intentionally NOT
# run here: it upserts the starter catalogue and is run once by an operator
# (`npm run prisma:seed` / `prisma db seed`) after the first deploy.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
