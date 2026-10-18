FROM node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
# Flaky registry links (G-T16): pnpm retries each tarball; the pnpm store and Prisma engine downloads
# live in BuildKit cache mounts, so a rebuild after a dropped connection fetches only what is missing.
ENV npm_config_fetch_retries=5 npm_config_fetch_retry_mintimeout=20000 npm_config_fetch_retry_maxtimeout=120000
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store --mount=type=cache,id=prisma-engines,target=/root/.cache/prisma pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @alarm/db...
COPY packages/db packages/db
WORKDIR /app/packages/db
RUN --mount=type=cache,id=prisma-engines,target=/root/.cache/prisma pnpm generate
CMD ["sh", "-c", "pnpm migrate:deploy && pnpm seed"]
