# Tasks

Source: `PLAN.md` §5. Status: todo / in progress / done / skipped.

| ID | Task | Phase | Status | Tests |
| --- | --- | --- | --- | --- |
| P0-T01 | Record D-01…D-12 and R-01…R-13 in `docs/DECISIONS.md` of the new repository; collect answers to Q-01…Q-11 | 0 | done | — |
| P0-T02 | Create the new repository and remote; import test fixtures (`samples`) and the seed data as files only | 0 | done | — |
| G-T01 | Monorepo skeleton: pnpm 9.15.9 workspace, `apps/web` (Next.js 14), `apps/worker`, `packages/core`, `packages/db`, TypeScript strict, Vitest, ESLint, `.env.example`, `docker-compose.yml` with `db` + `migrate`, `.gitignore`, CI stub | G | done | 0 tests (lint, typecheck, test green) |
| G-T02 | `packages/db`: Prisma schema for the 16 tables in REQUIREMENTS §5 (incl. `SiteMaster.phone`), indexes, migrations, seed (default rules, ADMIN user), repository functions `findAlarm`, `findActiveAlarms`, `findAlarmByConsec`, `findOrphanClears`, `resetWindow`, upserts | G | done | 24 (packages/db: migration 5, seed 8, repository 11) |
| G-T03 | `packages/core/parser`: `time.ts` (`ALARM_TZ`, DST), HASH subject parser, body parser (`neName`, `consecNbr`, timestamps) | G | done | 26 (packages/core parser: 25 sample cases + case count) |
| G-T04 | `packages/core/classify`: category rules engine driven by the `rules` table, hidden types, site-code extraction | G | done | 66 (packages/core classify: rules 34, site code 24, display filter 8; seed rules from packages/db) |
| G-T05 | `packages/core/engine`: dedupe, supersede (consecNbr never supersedes), orphan clears, latest-active fallback, reset window, deterministic reprocess | G | done | 68 (packages/core engine: 32 sample cases, 32 reprocess-twice, D-05 ×3, case count) |
| G-T06 | Gmail client + sync: OAuth2 desktop client from `credentials.json` + `token.json` (`GMAIL_CREDENTIALS_PATH`/`GMAIL_TOKEN_PATH`, one-time `pnpm gmail:auth`), `history.list` incremental with `messages.list` fallback on 404, initial backfill `INITIAL_BACKFILL_HOURS`, 200 msgs/cycle, idempotent `raw_messages` | G | done | 45 (apps/worker: gmail 19, ingest 12, client/config 13, db 1); real sync: 113 raw_messages |
| G-T07 | Worker runner: node-cron `WORKER_CRON`, skip-if-running, advisory lock 42, label resolution (`GMAIL_LABELS`, `OFFICE_LABEL_PARENTS`, refresh throttle), engine run, `system_status`, reprocess flag, `/health` on `WORKER_HEALTH_PORT`, Dockerfile | G | done | 31 (apps/worker: ticker 4, labels 5, config 6, cycle on alarms_test 16); real cycle in Docker: 109 fetched, 124 alarms |
| G-T08 | Web foundation: Next.js app shell, NextAuth credentials (bcrypt, JWT 12 h, explicit `secret`, `NEXTAUTH_SECRET` required at boot), `/api/v1` route layer with zod, uniform error envelope `{ error: { code, message, details? } }`, `requireRole` + office-scope middleware (`?office=*` for ADMIN), users CRUD (404 on unknown id, self-demotion blocked), `/me/*` | G | done | 89 (apps/web: api 13, lockout 5, auth 8, middleware 7, role table 25, users 15, me 7; core notify 9) |
| G-T09 | Alarms API + pages: active/cleared (`?status=`), filters, hidden types, office scope, page/pageSize ≤ 500, alarm names, polling 30/60 s, mobile cards | G | done | 42 (apps/web: alarms/alarm-names on alarms_test 32, UI helpers 5, role table +5) + 3 Playwright at 390 px |
| G-T10 | Export + stats: XLSX export with 50,000-row cap (413), `stats/summary`, `stats/daily` (localDay in `ALARM_TZ`), `stats/top-sites`, `dateParam` as local midnight | G | todo | — |
| G-T11 | Settings + notifications: office/display settings (ADMIN), rules editor with re-classification, notification feed (unread excludes reprocessed alarms), prefs, 20 s polling, `/health` (web, worker freshness via `HEALTH_STALE_AFTER_SEC`) | G | todo | — |
| G-T12 | Hourly server side: `GET /hourly-reports` (Gmail label list, pagination by Gmail token), `…/{id}/attachment` streaming with `HOURLY_MAX_RAR_MB` / `HOURLY_MAX_XLSX_MB`, `…/{id}/xlsx` (server unrar for mobile, D-11a), 409/413, `unrar` in the web image | G | todo | — |
| G-T13 | `packages/core/hourly`: parse (sheets, column mapping, `clockInvalid`), enrich from Site Master, normalize, diff — zero Node imports | G | todo | — |
| G-T14 | Hourly client pipeline (browser): Web Worker, `node-unrar-js` WASM, SheetJS, IndexedDB reference cache with `updatedAt` ETag, filters, sheet tabs, export (Excel incl. `clockInvalid` / table / image), Web Share, compare, 3-report in-memory cap, clear on logout, no-WASM fallback message | G | todo | — |
| G-T15 | Site Master + normalizations: import (upsert by code), list, inline edit of all fields (nodality, VIP, power source, battery, notes, phone), `hourly-normalizations` GET/PUT, server-side ADMIN gate on the settings page (API GET stays readable by any user, FR-67) | G | todo | — |
| G-T16 | Parity + ops: `web` service (healthcheck `/api/health` 30 s, OAuth files read-only, runs as `node`), Caddy `proxy` (`tls internal`, only service publishing ports, login rate limit 10 req/min/IP), `backup` service + `scripts/restore.sh`, `docker-compose.dev.yml` (bind mounts, `next dev`, `tsx watch`), README, RUNBOOK (deploy, upgrade, migrate, backup/restore, Gmail token refresh, reprocess), release tag `v1.0.0`, **parity checklist**: one row per FR-01…FR-70 and NFR with the test or manual check that proves it | G | todo | — |
| P3-T03 | Generate OpenAPI 3.1 from zod schemas (`zod-to-openapi`); serve `/api/v1/openapi.json` + Swagger UI (ADMIN only) | 3 | todo | — |
| P3-T07 | API tokens for scripts/mobile (`POST /api/v1/auth/tokens`, ADMIN; bearer auth path; hashed storage; revoke) | 3 | todo | — |
| P3-T08 | `Idempotency-Key` on `PUT /rules`, `POST /site-master/import`, `POST /reprocess` (24 h window, in-memory map per D-04) | 3 | todo | — |
| P4-T03 | Make fixture-dependent tests fail (not skip) in CI when `samples` / `TEST_DATABASE_URL` are missing; keep skip locally | 4 | todo | — |
| P4-T04 | CI pipeline (GitHub Actions): lint, typecheck, unit, integration against Postgres service (`alarms_test`), Playwright smoke, Docker build | 4 | todo | — |
| P6-T01 | Write CLAUDE.md for the new repository: roles, data model, full route list (OpenAPI is the source), `parseMessage` location, test counts, "as built" section | 6 | todo | — |
| P6-T02 | `docs/ARCHITECTURE.md` (component diagram, request flow, worker cycle, data model, env table, client-side hourly flow) | 6 | todo | — |
| P7-T01 | Scaffold `apps/mobile` (Expo, TypeScript, pnpm workspace, Metro config for `packages/core`); EAS preview builds in CI | 7 | todo | — |
| P7-T02 | Auth: login screen → `POST /auth/login` → JWT in `expo-secure-store`; auto-logout on 401; office label shown | 7 | todo | — |
| P7-T03 | Alarms: active/cleared lists with filters, 30 s/60 s polling, site badges (VIP/nodality), notification badge | 7 | todo | — |
| P7-T04 | Hourly: list from `/hourly-reports`; fetch `…/xlsx` into memory; SheetJS + `packages/core/hourly` parse/enrich on device (chunked, off the UI frame); filters, sheet tabs | 7 | todo | — |
| P7-T05 | Reference data in `expo-sqlite` (Site Master, normalizations) with `updatedAt` sync | 7 | todo | — |
| P7-T06 | Export & share & cleanup: Excel via SheetJS → temp file → `expo-sharing`; image via `react-native-view-shot`; on-device compare; temp files deleted in `finally` after the share sheet closes; in-memory reports cleared on logout | 7 | todo | — |
| P7-T07 | LAN networking: HTTPS to Caddy (D-06) or ATS `NSAllowsLocalNetworking`; configurable server URL screen | 7 | todo | — |
| P7-T08 | Distribution docs: EAS internal distribution (Android APK + iOS ad-hoc/TestFlight); runbook section | 7 | todo | — |
