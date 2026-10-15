FROM node:20-bookworm-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @alarm/db...
COPY packages/db packages/db
WORKDIR /app/packages/db
CMD ["pnpm", "migrate:deploy"]
