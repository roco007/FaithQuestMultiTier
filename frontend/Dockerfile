# ── FaithQuest frontend (Next.js 16 standalone) ──────────────────────────────
# Multi-stage build: full install + `next build` in the builder, then the
# minimal standalone server (`output: 'standalone'` must be enabled in
# next.config.ts for `.next/standalone/server.js` to exist).
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# NEXT_PUBLIC_* vars are inlined at build time — this must be supplied when the
# image is built, not when it runs (`--build-arg` / compose `args:`).
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY . ./
RUN npm run build

# ── Production image ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
