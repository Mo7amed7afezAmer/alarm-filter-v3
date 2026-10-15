# Worker image (NFR-33 base, NFR-26 non-root). Build context: repository root.
FROM node:20-bookworm-slim
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter worker...
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/worker apps/worker
RUN pnpm --filter @alarm/db generate && chown -R node:node /app
USER node
WORKDIR /app/apps/worker
ENV NODE_ENV=production
CMD ["node", "--import", "tsx", "src/index.ts"]
