# NOC Alarm Platform — Claude Code Prompt Pack

Place this file in the repository root next to `PLAN.md`, `REQUIREMENTS.md` and `samples/`.
Then start `claude` in that folder and paste **only the Master Prompt** below. Claude Code will
execute Stages 0 → 12 from this file one after another, stopping for your approval between stages
and pausing at the steps only a human can do (Google login, GitHub access).

---

## MASTER PROMPT (paste this once)

```
Read PROMPTS.md, PLAN.md and REQUIREMENTS.md completely before doing anything.

PROMPTS.md contains 13 stages (Stage 0 … Stage 12). Execute them strictly in order, one stage at a time, following these rules:

1. At the start of each stage, print "=== STAGE N: <title> ===" and restate its acceptance criteria.
2. Inside a stage, do the tasks in the listed order. Write the tests named in PLAN.md's Acceptance column BEFORE the implementation. Run the full test suite after every task; everything must stay green.
3. At the end of each stage, print: the task IDs completed, the tests added, the commands I can run to verify, and any deviation from PLAN.md. Update docs/TASKS.md status. Then STOP and wait for me to reply "next" before starting the next stage.
4. If a stage contains a step marked "HUMAN STEP", stop at that point, tell me exactly what to do, and wait until I confirm it is done.
5. Parity rule: implement FR-01…FR-70 and NFR-01…NFR-43 exactly as written in REQUIREMENTS.md. Never add, change or drop a feature. If something is ambiguous, ask me; do not guess.
6. Never commit or print credentials.json, token.json, .env or anything under secrets/. Never force-push or run destructive git commands.
7. If I reply "skip", mark the current stage as skipped in docs/TASKS.md and move to the next one. If I reply "redo", restart the current stage.

Begin with Stage 0 now.
```

---

## Stage 0 — Session setup

```
Create CLAUDE.md for this repository with these standing rules:
- Source of truth is REQUIREMENTS.md. PLAN.md defines tasks, order and acceptance criteria. PROMPTS.md defines the execution stages.
- Parity rule: implement FR-01…FR-70 and NFR-01…NFR-43 exactly as written. Never add, change or drop a feature. If a requirement is ambiguous, stop and ask; do not guess.
- Tests first: for every task, write the tests named in its Acceptance column before the implementation. All existing tests must stay green.
- One task at a time, in PLAN.md §4 order (0 → G → 3 → 4 → 6 → 7).
- Never commit credentials.json, token.json, secrets/ or .env. Never run destructive git commands.
- Stack is fixed: Node 20, pnpm 9.15.9, Next.js 14, Prisma, PostgreSQL 16, Vitest, Playwright, Docker Compose, Debian unrar.

Create docs/TASKS.md listing all 33 tasks from PLAN.md §5 as a checklist with columns: ID, Task, Phase, Status (todo / in progress / done / skipped), Tests.

Acceptance: both files exist; TASKS.md has exactly 33 rows.
```

---

## Stage 1 — Phase 0: decisions and skeleton (P0-T01, P0-T02)

```
P0-T01: create docs/DECISIONS.md recording decisions D-01…D-12 and risks R-01…R-13 from PLAN.md verbatim. Then list the open questions Q-01…Q-11 and ask me each one, one at a time. Record my answers in the same file under "Answers". Do not continue until every question has an answer.

P0-T02: initialize git; add .gitignore (node_modules, .env, .env.*, secrets/, credentials.json, token.json, dist, .next, coverage, playwright-report). Keep samples/ in the repo as test fixtures only. Confirm explicitly that no source code from the old project exists in this repository.

Acceptance: DECISIONS.md signed section present with product owner + tech lead placeholders; git initialized; first commit "chore: repository skeleton and decisions".
```

---

## Stage 2 — Sprint 1: parser and engine (G-T01 → G-T05)

```
Execute G-T01 through G-T05 in order. Ask me for approval between tasks.

G-T01: pnpm 9.15.9 workspace with apps/web, apps/worker, packages/core, packages/db; TypeScript strict; Vitest; ESLint; .env.example; docker-compose.yml with db + migrate; .gitignore; CI stub.
Acceptance: `pnpm install && pnpm test` passes (0 tests); `docker compose up db` healthy; `pnpm --filter` works for all four packages.

G-T02: packages/db — Prisma schema for the 16 tables in REQUIREMENTS.md §5 including SiteMaster.phone, indexes, migrations, idempotent seed (default rules + ADMIN user), repository functions findAlarm, findActiveAlarms, findAlarmByConsec, findOrphanClears, resetWindow, upserts.
Acceptance: migration applies on a fresh DB; seed is idempotent; repository tests run against alarms_test.

G-T03: packages/core/parser — time.ts (ALARM_TZ = Africa/Cairo, DST), HASH subject parser, body parser (neName, consecNbr, timestamps). Port all 26 parser test cases and fixtures from samples/ first, then implement until green.

G-T04: packages/core/classify — category rules engine driven by the rules table, hidden types, site-code extraction. Table-driven tests covering every seed rule; unknown → OTHER.

G-T05: packages/core/engine — dedupe, supersede (consecNbr never supersedes), orphan clears, latest-active fallback, reset window, deterministic reprocess. Port all 31 engine tests, then add "reprocess twice → identical alarms" and the D-05 global-matching test.

Sprint exit criterion: all 57 ported tests green before any UI or Gmail code exists.
```

---

## Stage 3 — Gmail ingestion (G-T06)

```
HUMAN STEP (before coding): I must have a Google Cloud project with Gmail API enabled, an OAuth consent screen, and an OAuth client of type "Desktop app" downloaded as ./secrets/credentials.json. Ask me to confirm the file is in place. Never read its contents aloud or print it.

Then build G-T06:
1. Gmail client with googleapis, OAuth2 desktop flow, scope https://www.googleapis.com/auth/gmail.readonly only. Paths from env: GMAIL_CREDENTIALS_PATH, GMAIL_TOKEN_PATH.
2. One-time script `pnpm gmail:auth`: prints the authorization URL, receives the code on a local loopback port (fallback: paste the code), writes token.json, handles refresh tokens afterwards.
3. Sync: history.list incremental with messages.list fallback on 404; initial backfill INITIAL_BACKFILL_HOURS; max 200 messages per cycle; idempotent writes to raw_messages.
4. Clear startup error when the credentials file is missing.

Tests first, with a mocked Gmail client fed from samples/gmail/ for each path: duplicate message → no new row; 404 on history → fallback path; missing credentials → startup error.

HUMAN STEP (after coding): tell me the exact command to run the one-time authorization and what to expect in the browser. Wait until I confirm token.json exists, then run one sync cycle against the real mailbox and show me the raw_messages count.
```

---

## Stage 4 — Worker (G-T07)

```
G-T07: worker runner — node-cron on WORKER_CRON, skip-if-running, PostgreSQL advisory lock 42, label resolution (GMAIL_LABELS, OFFICE_LABEL_PARENTS, refresh throttle), engine run, system_status updates, reprocess flag, /health on WORKER_HEALTH_PORT returning lastError after a failure, Dockerfile.

Tests first for FR-01, FR-07, FR-08, FR-09; a test proving two concurrent instances result in exactly one run; /health returns 200 with lastError after a forced failure.

Then run the worker locally for one cycle against the real token.json and show me the system_status row.
```

---

## Stage 5 — Web foundation and alarms (G-T08 → G-T11)

```
Execute G-T08, G-T09, G-T10, G-T11 in order. Ask me for approval between tasks.

G-T08: Next.js 14 app shell; NextAuth credentials (bcrypt, JWT 12 h, explicit secret, NEXTAUTH_SECRET required at boot); /api/v1 route layer with zod; uniform error envelope { error: { code, message, details? } }; requireRole + office-scope middleware (?office=* for ADMIN); users CRUD (404 on unknown id, self-demotion blocked); /me/* routes.
Acceptance: table-driven role test over all 23 protected routes × {VIEWER, OPERATOR}; login lockout after 5 failures for 15 minutes; 404 on unknown user; self-demotion blocked.

G-T09: alarms API + pages — active/cleared via ?status=, filters, hidden types, office scope, page/pageSize ≤ 500, alarm names, polling 30/60 s, mobile cards.
Acceptance: integration tests per filter; Playwright at 390 px; counts match a seeded fixture.

G-T10: XLSX export with 50,000-row cap (413); stats/summary; stats/daily (localDay in ALARM_TZ); stats/top-sites; dateParam as local midnight.
Acceptance: golden-file export test; 2026-10-14 → 2026-10-13T21:00:00Z; >50k rows → 413.

G-T11: office/display settings (ADMIN), rules editor with re-classification, notification feed (unread excludes reprocessed alarms), prefs, 20 s polling, web /health with worker freshness via HEALTH_STALE_AFTER_SEC.
Acceptance: per route happy path + 400 + 401 + 403; /health reports stale worker; after reprocess, previously-seen alarms are not unread.
```

---

## Stage 6 — Hourly reports (G-T12 → G-T14)

```
Execute G-T12, G-T13, G-T14 in order. Ask me for approval between tasks. Decision D-10 applies: hourly reports are processed in the browser; the server only streams the attachment and never writes a report to disk.

G-T12: GET /hourly-reports (Gmail label list, pagination by Gmail token); …/{id}/attachment streaming with HOURLY_MAX_RAR_MB / HOURLY_MAX_XLSX_MB; …/{id}/xlsx (server-side unrar for mobile, D-11a); 409 when no attachment; 413 over limit; Debian unrar in the web image.
Acceptance: 200 with correct length; 413 over limit; 409 without attachment; web memory < 150 MB during a 40 MB RAR stream.

G-T13: packages/core/hourly — parse (sheets, column mapping, clockInvalid), enrich from Site Master, normalize, diff. Zero Node imports. Port all hourly unit tests first.
Acceptance: all ported tests green; tsc with lib ["dom"] succeeds.

G-T14: start with a spike of node-unrar-js (WASM) against the real RAR fixtures in samples/ and report RAR5 / multi-volume results to me before building the rest. Then: Web Worker pipeline, SheetJS, IndexedDB reference cache keyed by updatedAt, filters, sheet tabs, export (Excel incl. clockInvalid / table / image), Web Share, compare, 3-report in-memory cap, clear on logout, no-WASM fallback message.
Acceptance: export matches the golden file row for row; second load makes no site-master request; eviction unit tests; timing budget 40k rows < 5 s on laptop.
```

---

## Stage 7 — Site Master and parity gate (G-T15, G-T16)

```
G-T15: Site Master import (upsert by code), list, inline edit of all fields including phone; hourly-normalizations GET/PUT; server-side ADMIN gate on the settings page while API GET stays readable by any user (FR-67).
Acceptance: import idempotent; VIEWER can GET but cannot open the page; editing VIP shows a badge on /alarms.

G-T16: production compose — web service (healthcheck /api/health every 30 s, OAuth files mounted read-only, runs as node); Caddy proxy with tls internal, the only service publishing ports, login rate limit 10 req/min/IP; backup service (daily pg_dump -Fc, 14-day retention) + scripts/restore.sh; docker-compose.dev.yml (bind mounts, next dev, tsx watch); README; RUNBOOK (deploy, upgrade, migrate, backup/restore, Gmail token refresh, reprocess).
Then create docs/PARITY.md: one row per FR-01…FR-70 and every NFR, naming the automated test or manual check that proves it.
Acceptance: checklist 100 % green; backup/restore reproduces the alarms row count; 11th login attempt per minute → 429. Only then tag v1.0.0.

HUMAN STEP: ask me to perform the clean-VM deploy from the docs and confirm it took under 1 hour.
```

---

## Stage 8 — Phase 3: REST API v1 (P3-T07, P3-T03, P3-T08)

```
P3-T07: API tokens — POST /api/v1/auth/tokens (ADMIN), bearer auth path alongside the session cookie, hashed storage, revoke endpoint.
Acceptance: a token can call /alarms; a revoked token gets 401.

P3-T03: generate OpenAPI 3.1 from the zod schemas with zod-to-openapi; serve /api/v1/openapi.json and Swagger UI to ADMIN only.
Acceptance: spec validates; every route appears with its minimum role.

P3-T08: Idempotency-Key on PUT /rules, POST /site-master/import, POST /reprocess; 24-hour window; in-memory map (D-04).
Acceptance: replayed request returns the cached 2xx without re-executing.
```

---

## Stage 9 — Phase 4: coverage and CI (P4-T03, P4-T04)

```
P4-T03: fixture-dependent tests must fail (not skip) when CI=true and samples/ or TEST_DATABASE_URL is missing; locally they skip with a warning.

P4-T04: GitHub Actions workflow on push and pull_request to main: lint, typecheck, unit, integration against a postgres:16 service container (database alarms_test), Playwright smoke, Docker build. Target under 15 minutes. No step may require real Gmail credentials.
Acceptance: workflow file validates; local `act` or dry run passes if available.
```

---

## Stage 10 — Phase 6: documentation (P6-T01, P6-T02)

```
P6-T01: rewrite CLAUDE.md as the "as built" guide: roles, data model, full route list pointing to OpenAPI as the source, location of parseMessage, test counts, env table. Diff it against the code and fix mismatches in the document, not the code.

P6-T02: docs/ARCHITECTURE.md with Mermaid component diagram, request flow, worker cycle, data model, env table, client-side hourly flow. Verify .env.example matches every env variable actually read by the code.
```

---

## Stage 11 — Phase 7: mobile app (P7-T01 → P7-T08)

```
Execute P7-T01 through P7-T08 in order. Ask me for approval between tasks. Scope is strictly login, alarms and hourly reports; admin screens stay web-only. The app consumes /api/v1 with bearer tokens and reuses packages/core unchanged. Hermes has no WebAssembly, so hourly uses the server …/xlsx route (D-11a).

Constraints: JWT only in expo-secure-store, never AsyncStorage; auto-logout on 401; reference data in expo-sqlite synced by updatedAt; export via SheetJS → temp file → expo-sharing with temp files deleted in finally after the share sheet closes; in-memory reports cleared on logout; configurable server URL screen; HTTPS to Caddy or ATS NSAllowsLocalNetworking.
Acceptance: contract test proving alarm counts equal the web counts for the same filters; FileSystem.cacheDirectory holds no report files after share; EAS internal-distribution docs added to the RUNBOOK.

HUMAN STEP: EAS builds need my Expo account; ask me to log in with `eas login` before P7-T01's build step.
```

---

## Stage 12 — Push to GitHub

```
HUMAN STEP: ask me for the remote URL of the empty GitHub repository I created, and confirm my SSH key or `gh auth login` is configured.

Then: add it as origin; verify that credentials.json, token.json, secrets/ and all .env files are ignored and absent from history (`git log --all -- secrets/ credentials.json token.json` must be empty); commit with a conventional message; push main and the v1.0.0 tag. Show me `git status` and the pushed commit hash. Never force-push.
```

---

## Quick reference for your replies

| You type | Claude Code does |
| --- | --- |
| `next` | starts the next stage |
| `redo` | restarts the current stage |
| `skip` | marks the stage skipped and moves on |
| `Parity rule — this is not in REQUIREMENTS.md, remove it.` | removes an out-of-scope addition |
