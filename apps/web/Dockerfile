# Web image (NFR-33): node:20-bookworm-slim, official unrar from Debian non-free, standalone Next.js,
# healthcheck /api/health every 30 s; runs as the non-root `node` user (NFR-26). Build context: repo root.
FROM node:20-bookworm-slim AS build
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web...
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/web apps/web
RUN pnpm --filter @alarm/db generate
# Build-time placeholders only; the real values come from the environment at run time.
RUN cd apps/web && BUILD_STANDALONE=1 NEXTAUTH_SECRET=build-only DATABASE_URL=postgresql://build@localhost/build pnpm exec next build

FROM node:20-bookworm-slim
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update -y \
 && apt-get install -y --no-install-recommends unrar openssl wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 HOURLY_UNRAR_BIN=/usr/bin/unrar
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
