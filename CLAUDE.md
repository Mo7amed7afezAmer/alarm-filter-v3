# NOC Alarm Platform

Read this file before any work in this repository. Part 1 holds the standing rules; part 2 describes
the system as built (checked against the code by `tests/ci/docs.test.ts`).

# Part 1 — Standing rules

## Documents
- **`REQUIREMENTS.md`** is the source of truth (FR-01…FR-70, NFR-01…NFR-43).
- **`PLAN.md`** defines the tasks, their order and their acceptance criteria.
- **`PROMPTS.md`** defines the execution stages (Stage 0 … Stage 12).
- **`docs/DECISIONS.md`** records decisions D-01…D-12, risks, the answers to Q-01…Q-11 and every
  later clarification (one row per task decision).
- **`docs/TASKS.md`** is the task checklist and status. **`docs/PARITY.md`** maps every FR/NFR to its proof.
- **`docs/ARCHITECTURE.md`** has the diagrams, flows and the full environment table.

## Rules
- **Parity rule:** implement FR-01…FR-70 and NFR-01…NFR-43 exactly as written. Never add, change or drop a feature. If a requirement is ambiguous, stop and ask; do not guess.
- **Tests first:** for every task, write the tests named in its Acceptance column before the implementation. All existing tests must stay green.
- **One task at a time,** in PLAN.md §4 order (0 → G → 3 → 4 → 6 → 7).
- **Secrets:** Never commit credentials.json, token.json, secrets/ or .env. Never run destructive git commands.
- **Stack is fixed:** Node 20, pnpm 9.15.9, Next.js 14, Prisma, PostgreSQL 16, Vitest, Playwright, Docker Compose, Debian unrar.

# Part 2 — As built (2026-10-18)

## What it does
The worker reads alarm e-mails from one Gmail label every minute, stores every message in
`raw_messages`, parses and classifies it, and pairs alarms with their `CLEARED_` e-mails in `alarms`.
The web app shows active and cleared alarms, statistics, notifications and the hourly Nokia reports,
which are processed in the browser (D-10). Staff sign in on the LAN behind Caddy (D-06).

## Repository map
| Path | Contents |
| --- | --- |
| `packages/core` | Pure logic, no database. `parser/` (subject, body, `message.ts`, `time.ts`), `classify/` (rules, site code, display filter), `engine/` (dedupe, supersede, clears, orphans, reprocess), `notify/`, `hourly/` (validate, extract, parse, enrich, normalize, filter, diff, Site Master parse, LRU cache; browser-safe, zero Node imports) |
| `packages/db` | Prisma schema and migrations, seed (13 rules + first ADMIN), repository functions |
| `apps/worker` | Gmail client and sync (`gmail.ts`, `ingest.ts`), label directory, cycle (`run.ts`), cron ticker, `/health`, one-time `pnpm gmail:auth` (`auth-cli.ts`) |
| `apps/web` | Next.js 14: pages under `app/(app)`, route handlers under `app/api`, route layer `lib/api.ts`, role table `lib/routes.ts`, OpenAPI `lib/openapi.ts`, hourly browser pipeline `lib/hourly/` (Web Worker, IndexedDB reference cache, export, images) |
| `apps/mobile` | Expo SDK 58 app (Phase 7): Expo Router screens in `app/`, logic in `src/` (session in expo-secure-store, API client with bearer token, roles); bundles `packages/core` unchanged (Metro stubs the server-only `node-unrar-js`) |
| `proxy/`, `backup/`, `scripts/restore.sh` | Caddy (TLS internal, login rate limit), daily `pg_dump`, restore |
| `samples/`, `tests/fixtures/` | Test fixtures only |
| `tests/ops`, `tests/ci` | Compose and live-stack checks; CI fixture guard, workflow and documentation checks |

`parseMessage` (subject + body → parsed message) is in `packages/core/src/parser/message.ts`; the
HASH subject parser is `parser/subject.ts`, the body parser `parser/body.ts`, Cairo time `parser/time.ts`.

## Roles
`VIEWER` < `OPERATOR` < `ADMIN` (FR-27), checked on the server by `route()` in `apps/web/lib/api.ts`.
- **VIEWER:** alarms, cleared, dashboard, stats, export, notifications, own display and notification prefs, hourly report list, Site Master list.
- **OPERATOR:** also downloads hourly reports (`…/attachment`, `…/xlsx`) and the hourly reference data, i.e. processes reports.
- **ADMIN:** also users, office, hidden types, rules, reprocess, Site Master import/edit, normalizations, API tokens, OpenAPI / Swagger UI.

Sign-in: NextAuth credentials, bcrypt (12 rounds), JWT 12 h, lockout after 5 failures for 15 min
(`lib/lockout.ts`, in memory, D-04/D-08); Caddy limits login posts to 10/min/IP. Scripts and the
mobile app use API tokens (`Authorization: Bearer`, P3-T07), which act as their user.

## Data model (`packages/db/prisma/schema.prisma`)
| Table | Purpose |
| --- | --- |
| `raw_messages` | Every Gmail message (gmailId unique, subject, receivedAt, body ≤ 20,000, office, parseError, processedAt); source of truth for reprocess |
| `alarms` | One row per alarm occurrence: alarmKey, alarmName, site, category, alarmTime, status ACTIVE/CLEARED, clearTime, durationMin, clearType EMAIL/AUTO_SUPERSEDED, consecNbr (unique), cellName, device, office, createdAt |
| `orphan_clears` | Clears that arrived before their alarm (→ raw message, cascade) |
| `rules` | Classification rules: pattern, category DOWN/POWER/OTHER, priority |
| `sites` | Region/owner per site, kept from REQUIREMENTS §5; nothing reads or writes it (the region filter uses the site code's last 2 characters) |
| `users` | email, bcrypt hash, role, notification prefs, notificationsSeenAt, display prefs |
| `api_tokens` | P3-T07: name, SHA-256 token hash, user (cascade), createdAt, revokedAt |
| `system_status` | Single row: Gmail history id, last run / error / message count, reprocess request, office, synced label, available labels, hidden types, referenceUpdatedAt |
| `site_master` | Site reference data by code: office, nodality, VIP, site type, power source, battery, phone, region, notes, updatedAt |
| `hourly_normalizations` | Hourly normalization rules (field, from, to) |

Migrations: `20261015000000_init`, `20261017000000_reference_updated_at`, `20261018000000_api_tokens`.

## Routes
The machine-readable source is the OpenAPI 3.1 document at `/api/v1/openapi.json` (ADMIN; Swagger UI
at `/api-docs`), generated from the routes' zod schemas. Every protected route, with its minimum role
(the same table drives `test/route-table.test.ts`):

| Method | Path | Minimum role |
| --- | --- | --- |
| GET | `/api/v1/users` | ADMIN |
| POST | `/api/v1/users` | ADMIN |
| PATCH | `/api/v1/users/{id}` | ADMIN |
| DELETE | `/api/v1/users/{id}` | ADMIN |
| GET | `/api/v1/me/display` | VIEWER |
| PUT | `/api/v1/me/display` | VIEWER |
| GET | `/api/v1/me/notification-prefs` | VIEWER |
| PUT | `/api/v1/me/notification-prefs` | VIEWER |
| GET | `/api/v1/alarms` | VIEWER |
| GET | `/api/v1/alarm-names` | VIEWER |
| GET | `/api/v1/export` | VIEWER |
| GET | `/api/v1/stats/summary` | VIEWER |
| GET | `/api/v1/stats/daily` | VIEWER |
| GET | `/api/v1/stats/top-sites` | VIEWER |
| GET | `/api/v1/settings/office` | ADMIN |
| PUT | `/api/v1/settings/office` | ADMIN |
| GET | `/api/v1/settings/display` | ADMIN |
| PUT | `/api/v1/settings/display` | ADMIN |
| GET | `/api/v1/rules` | ADMIN |
| PUT | `/api/v1/rules` | ADMIN |
| POST | `/api/v1/reprocess` | ADMIN |
| GET | `/api/v1/notifications` | VIEWER |
| POST | `/api/v1/notifications/read` | VIEWER |
| GET | `/api/v1/hourly-reports` | VIEWER |
| GET | `/api/v1/hourly-reports/{id}/attachment` | OPERATOR |
| GET | `/api/v1/hourly-reports/{id}/xlsx` | OPERATOR |
| GET | `/api/v1/site-master` | VIEWER |
| POST | `/api/v1/site-master/import` | ADMIN |
| PUT | `/api/v1/site-master/{code}` | ADMIN |
| GET | `/api/v1/hourly-normalizations` | ADMIN |
| PUT | `/api/v1/hourly-normalizations` | ADMIN |
| GET | `/api/v1/hourly-reference` | OPERATOR |
| POST | `/api/v1/auth/tokens` | ADMIN |
| DELETE | `/api/v1/auth/tokens/{id}` | ADMIN |
| POST | `/api/v1/auth/logout` | VIEWER |
| GET | `/api/v1/openapi.json` | ADMIN |

Public: `/api/health` (FR-70), `POST /api/v1/auth/login` (mobile sign-in → API token, same lockout
as the web, Caddy 10/min/IP) and NextAuth under `/api/auth/*`. `PUT /api/v1/rules`,
`POST /api/v1/site-master/import` and `POST /api/v1/reprocess` accept `Idempotency-Key` (P3-T08).
Errors always use `{ error: { code, message, details? } }`; invalid input is 400 with zod details.

Pages: `/login`, `/alarms`, `/cleared`, `/dashboard`, `/hourly`, `/hourly/[id]`, `/hourly/compare`,
`/me`, `/settings` (ADMIN), `/settings/site-master` (ADMIN), `/api-docs` (ADMIN).

## Tests (2026-10-18)
| Suite | Command | Count |
| --- | --- | --- |
| `packages/core` (pure) | `pnpm --filter @alarm/core test` | 363 |
| `packages/db` (alarms_test) | `pnpm --filter @alarm/db test` | 25 |
| `apps/worker` (mock Gmail from samples/, alarms_test) | `pnpm --filter worker test` | 84 |
| `apps/web` (route handlers on alarms_test, UI helpers) | `pnpm --filter web test` | 402 |
| `tests/ops/compose.test.ts`, `tests/ci` | part of `pnpm test` | 43 |
| Playwright smoke | `pnpm e2e` | 14 |
| Live stack | `OPS_BASE_URL=https://<host> OPS_RESTORE=1 pnpm ops:test` | 5 |

`pnpm test` runs all Vitest suites; DB tests need `TEST_DATABASE_URL` → `alarms_test` (NFR-41). With
`CI=true`, missing fixtures or database fail the run; locally they are skipped with a warning (P4-T03).
`pnpm lint` = ESLint + `prettier --check`; `pnpm typecheck` = `tsc` in every package.
CI: `.github/workflows/ci.yml` (lint + typecheck, unit + integration on postgres:16, Playwright, Docker build).

## Environment
Configuration is read from the environment; copy `.env.example` to `.env`. Full table with defaults
and readers: `docs/ARCHITECTURE.md` → "Environment variables".

| Variable | Used by | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Database credentials |
| `DATABASE_URL` / `TEST_DATABASE_URL` | Prisma / tests | Database / `alarms_test` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seed | First ADMIN (once) |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | web | Session signing (required) / public URL |
| `SITE_ADDRESS` | proxy | Host name or IP with a Caddy internal certificate |
| `GOOGLE_CREDENTIALS_PATH` / `GOOGLE_TOKEN_PATH` | worker, web | Gmail OAuth files (read-only mounts) |
| `GMAIL_LABELS`, `GMAIL_QUERY`, `OFFICE_LABEL_PARENTS` | worker (`GMAIL_LABELS` also web) | Default office, backfill filter, office label parents |
| `WORKER_CRON`, `MAX_MESSAGES_PER_RUN`, `INITIAL_BACKFILL_HOURS` | worker | Cycle schedule and limits |
| `WORKER_HEALTH_PORT`, `HEALTH_STALE_AFTER_SEC` | worker | `/health` port and staleness |
| `ALARM_TZ`, `ALERT_HOURS`, `WORKER_STALE_SEC` | web (`ALARM_TZ` also worker) | Time zone, overdue threshold, worker freshness |
| `HOURLY_GMAIL_LABEL`, `HOURLY_MAX_RAR_MB`, `HOURLY_MAX_EXTRACT_MB`, `HOURLY_GMAIL_MOCK_DIR` | web | Hourly report label, size limits, local mock folder (tests) |

## Operations
Production: `docker compose up -d --build` (db, migrate, worker, web, proxy, backup; only the proxy
publishes ports). Development: `docker-compose.dev.yml`. Deploy, upgrade, migrations, backup/restore,
Gmail token refresh and reprocess: `docs/RUNBOOK.md`.
