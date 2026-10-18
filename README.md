# NOC Alarm Platform

Reads mobile-network alarm e-mails from one Gmail mailbox, pairs every alarm with its clear, and
shows active alarms, cleared alarms and statistics to NOC staff on the LAN. Hourly Nokia reports
are processed in the browser. The requirements are in [REQUIREMENTS.md](REQUIREMENTS.md), and the
build plan is in [PLAN.md](PLAN.md).

| Part | What it does |
| --- | --- |
| `apps/worker` | Polls Gmail every minute, stores `raw_messages` and runs the matching engine (`/health` on :4000) |
| `apps/web` | Next.js 14 pages and the `/api/v1` API; hourly reports are processed in the browser (D-10) |
| `packages/core` | Parsing, classification, matching engine, hourly pipeline (browser-safe) |
| `packages/db` | Prisma schema, migrations, seed, repository |
| `proxy` | Caddy: HTTPS with `tls internal`, login rate limit; the only service publishing ports |
| `backup` | Daily `pg_dump -Fc` into `./backups`, 14-day retention |

## Deploy (production)

You need a Linux host with Docker Engine and the Compose plugin (2 vCPU, 4 GB RAM and 40 GB SSD are
enough). You also need the Gmail OAuth files described in the [RUNBOOK](docs/RUNBOOK.md#1-first-deployment).

```bash
git clone <repository> alarm-platform && cd alarm-platform
cp .env.example .env        # then edit: passwords, NEXTAUTH_SECRET, SITE_ADDRESS, NEXTAUTH_URL, GMAIL_LABELS, ADMIN_*
mkdir -p secrets backups    # put credentials.json and token.json into secrets/
docker compose up -d --build
```

Open `https://<SITE_ADDRESS>` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The
[RUNBOOK](docs/RUNBOOK.md) is the step-by-step guide. It covers TLS trust, upgrades, migrations,
backup/restore, Gmail token refresh and reprocessing.

## Develop

Requirements: Node 20, pnpm 9.15.9 (`corepack enable`), Docker.

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # Postgres on 127.0.0.1:5432
pnpm --filter @alarm/db migrate:deploy && pnpm --filter @alarm/db seed
pnpm --filter web dev                                                     # http://localhost:3000
```

Or run everything in containers with reload on save (`next dev`, `tsx watch`, sources
bind-mounted):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Test

| Command | What |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | ESLint, TypeScript strict |
| `pnpm test` | Vitest unit and integration tests (DB tests need `TEST_DATABASE_URL` → `alarms_test`) plus the static compose checks |
| `pnpm e2e` | Playwright: alarms at 390 px, hourly reports in the browser, Site Master |
| `OPS_BASE_URL=https://localhost pnpm ops:test` | Live checks against a running stack: HTTPS, 429 on the 11th login, non-root containers, backup retention (`OPS_RESTORE=1` adds backup → restore) |

[docs/PARITY.md](docs/PARITY.md) maps every FR / NFR to the test or manual check that proves it.
