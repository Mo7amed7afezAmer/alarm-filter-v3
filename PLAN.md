# NOC Alarm Platform — Standalone Project Plan

Status: FINAL (2026-10-15). Source of truth: `REQUIREMENTS.md`.

## 1. Executive summary

The new project is a **standalone repository** that rebuilds the alarm platform from `REQUIREMENTS.md` with **functional parity**: every FR-01…FR-70 and NFR-01…NFR-43 as implemented today, nothing added, nothing removed. The old code base is not a dependency; it is only a reference for parsing edge cases and test fixtures.

Estimate: **75–95 person-days** including the mobile app (**62–78** without it), one senior full-stack engineer. The core job — Gmail ingestion → matching engine → alarm views → hourly reports — is rebuilt module by module, tests first, in Phase G; the REST API v1, CI, docs and mobile app follow on the shared phases.

What the new project delivers, in order:

1. **Decisions + repository skeleton** (Phase 0) — a clean pnpm monorepo, nothing inherited.
2. **Functional parity** (Phase G) — all 70 FRs rebuilt correctly the first time, with deployability (compose, Caddy, backups, README/RUNBOOK) and client-side hourly processing from day one.
3. **REST API v1** (Phase 3) — OpenAPI spec, API tokens, idempotency keys on top of the `/api/v1` layer built in G.
4. **Coverage & CI** (Phase 4) — fixture-dependent tests fail in CI; GitHub Actions pipeline.
5. **Documentation** (Phase 6) — CLAUDE.md written for the new repo, architecture doc.
6. **React Native mobile app** (Phase 7, optional) — login, alarms, hourly reports, sharing `packages/core`.

## 2. Scope and parity rule

**Source of truth:** `REQUIREMENTS.md` (reverse-engineered 2026-10-14). The new repository is built *to* it; the old repository is consulted only for parsing edge cases and fixtures, never copied wholesale.

**Parity rule:** preserve every FR-01…FR-70 and NFR-01…NFR-43 as implemented. No feature is added, changed or dropped. Where code and CLAUDE.md disagree, the as-built behaviour (31 engine tests, 26 parser tests, hourly suites) is the specification.

**Independence rule:** no runtime, build or data dependency on the old project — new repository, new database, new OAuth files, new compose stack. Cut-over is a one-week side-by-side run on the same mailbox (R-13), then the old stack is stopped.

Functional scope rebuilt, by area:

| Area | Requirements | What is rebuilt |
| --- | --- | --- |
| Ingestion | FR-01–FR-09, NFR-10–12 | Gmail `history.list` / `messages.list` fallback, 200 msg/cycle, advisory lock 42, idempotent `raw_messages` |
| Engine | FR-10–FR-24, NFR-13 | HASH subject parser, classification rules, dedupe, supersede, orphan clears, deterministic reprocess |
| Auth | FR-25–FR-29, NFR-17–20 | Credentials login, JWT 12 h, VIEWER / OPERATOR / ADMIN |
| Views & API | FR-30–FR-46 | Active/cleared lists, export, stats, office scope, hidden types, notifications |
| Hourly reports | FR-47–FR-64 | Gmail label list, RAR/XLSX validation, parse/enrich/normalize, filters, export, diff, images — processed on the client (D-10) |
| Site Master & normalizations | FR-65–FR-68 | Import, list, inline edit incl. phone column |
| Ops | FR-69–FR-70, NFR-26–36 | Worker `/health`, web `/health`, compose with proxy + web + worker + db + backup |
| Mobile | CLAUDE.md §13 | Expo app: login, alarms, hourly reports (Phase 7) |

## 3. Architectural decisions (applied from day one)

All decisions are already taken; the new repository starts with them built in, so there is no later migration step.

| ID | Decision | Applied as |
| --- | --- | --- |
| D-01 | API hosting | Next.js Route Handlers under `/api/v1` (option a); no separate `apps/api` |
| D-02 | API versioning | `/api/v1` from the first commit; no legacy `/api/*` alias exists |
| D-03 | Scheduler | In-process `node-cron`; advisory lock 42 guarantees a single run |
| D-04 | Shared cache / rate limiting | **No Redis.** Single `web` replica; login counters and idempotency keys in memory |
| D-05 | Office scoping of matching | **Keep global matching** (decided 2026-10-15); cross-office test documents the decision |
| D-06 | Reverse proxy | **Caddy with `tls internal`** (self-signed); NOC devices trust the root CA once |
| D-07 | Backups | Compose `backup` service: daily `pg_dump -Fc`, 14-day retention, restore script |
| D-08 | Login protection | Rate limit at Caddy (10 req/min/IP) + in-app per-email lockout (5 fails / 15 min) |
| D-10 | Hourly-report processing | **Client-side**: server streams the attachment only; browser does unrar (WASM) + parse + export; no file on disk anywhere |
| D-11 | RAR extraction on React Native | Server unrars and streams the XLSX (`…/xlsx` route); Hermes has no WebAssembly |
| D-12 | Mobile framework | Expo SDK (latest stable), TypeScript, pnpm workspace `apps/mobile`, EAS build |

**Stack:** Node 20, pnpm 9.15.9, Next.js 14, Prisma, PostgreSQL 16, Vitest, Playwright, Docker Compose, Debian `unrar` (NFR-33, NFR-36). Target host: 2 vCPU / 4 GB / 40 GB SSD.

## 4. Phases and milestones

Execution order: **0 → G → 3 → 4 → 6 → 7**. Milestone MG is reached when the parity checklist (G-T16) is fully green; Phase 7 needs only M3 (`/api/v1` + bearer tokens) and the attachment routes (G-T12).

| Phase | Milestone | Exit criterion | Est. days |
| --- | --- | --- | --- |
| 0 | **M0 — Decisions + repo skeleton** | `docs/DECISIONS.md` signed; empty monorepo boots (`pnpm test`, `docker compose up db`) | 1 |
| G | **MG — Functional parity** | FR-01…FR-70 rebuilt module by module, tests first; deployable stack (proxy + web + worker + db + backup); README + RUNBOOK; parity checklist 100 % green; clean-VM deploy from docs in < 1 h | 30–38 |
| 3 | **M3 — REST API v1** | OpenAPI 3.1 spec served (ADMIN); API tokens for scripts/mobile; `Idempotency-Key` on mutating routes | 4–5 |
| 4 | **M4 — Coverage & CI** | Fixture-dependent tests fail (not skip) in CI; GitHub Actions: lint, typecheck, unit, integration, Playwright, Docker build < 15 min | 2–3 |
| 6 | **M6 — Docs** | CLAUDE.md written for the new repo; `docs/ARCHITECTURE.md` reviewed; `.env.example` matches code | 2–3 |
| 7 | **M7 — Mobile app v1** | Expo app on iOS/Android: login, active/cleared alarms, hourly reports (parse/export/share/auto-delete temp files) against `/api/v1` | 10–13 |
| — | Buffer / reviews | — | 15–18 |

## 5. Detailed tasks

Legend — **Pri:** P0 blocker · P1 must · P2 should · P3 nice. **Effort** in person-days. **Trace** cites FR/NFR items. Every task includes "existing tests remain green" as an implicit acceptance criterion.

### Phase 0 — Decisions and skeleton

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| P0-T01 | Record D-01…D-12 and R-01…R-13 in `docs/DECISIONS.md` of the new repository; collect answers to Q-01…Q-11 | — | §3, §7 | Document signed by product owner + tech lead | 0.5 | P0 |
| P0-T02 | Create the new repository and remote; import test fixtures (`samples`) and the seed data as files only | P0-T01 | NFR-41 | Fixtures present; no source code imported | 0.5 | P0 |

### Phase G — Greenfield build

Rules for every G task: build to `REQUIREMENTS.md`; write the tests named in the row **before** the implementation; the old repository may be consulted for parsing edge cases and fixtures, nothing else; business rules must match FR/NFR text exactly.

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| G-T01 | Monorepo skeleton: pnpm 9.15.9 workspace, `apps/web` (Next.js 14), `apps/worker`, `packages/core`, `packages/db`, TypeScript strict, Vitest, ESLint, `.env.example`, `docker-compose.yml` with `db` + `migrate`, `.gitignore`, CI stub | P0-T02 | NFR-40, NFR-32–34 | `pnpm install && pnpm test` passes (0 tests); `docker compose up db` healthy; `pnpm --filter` works for all four packages | 1 | P0 |
| G-T02 | `packages/db`: Prisma schema for the 16 tables in REQUIREMENTS §5 (incl. `SiteMaster.phone`), indexes, migrations, seed (default rules, ADMIN user), repository functions `findAlarm`, `findActiveAlarms`, `findAlarmByConsec`, `findOrphanClears`, `resetWindow`, upserts | G-T01 | §5, FR-16 seed | Migration applies on fresh DB; seed idempotent; repository tests against `alarms_test` | 2.5 | P0 |
| G-T03 | `packages/core/parser`: `time.ts` (`ALARM_TZ`, DST), HASH subject parser, body parser (`neName`, `consecNbr`, timestamps) | G-T01 | FR-10–FR-13, NFR-29 | Port the 26 parser test cases and the fixtures; all green | 2 | P0 |
| G-T04 | `packages/core/classify`: category rules engine driven by the `rules` table, hidden types, site-code extraction | G-T03 | FR-14–FR-17 | Table-driven tests covering every seed rule; unknown → OTHER | 1 | P0 |
| G-T05 | `packages/core/engine`: dedupe, supersede (consecNbr never supersedes), orphan clears, latest-active fallback, reset window, deterministic reprocess | G-T02, G-T04 | FR-18–FR-24, NFR-13 | Port the 31 engine tests; add "reprocess twice → identical alarms" and the D-05 global-matching test | 3 | P0 |
| G-T06 | Gmail client + sync: OAuth2 desktop client from `credentials.json` + `token.json` (`GMAIL_CREDENTIALS_PATH`/`GMAIL_TOKEN_PATH`, one-time `pnpm gmail:auth`), `history.list` incremental with `messages.list` fallback on 404, initial backfill `INITIAL_BACKFILL_HOURS`, 200 msgs/cycle, idempotent `raw_messages` | G-T02 | FR-02–FR-06, NFR-11–12 | Tests with a mocked Gmail client fed from `samples/gmail/` for each path; duplicate message → no new row; missing credentials file → clear startup error | 2.5 | P0 |
| G-T07 | Worker runner: node-cron `WORKER_CRON`, skip-if-running, advisory lock 42, label resolution (`GMAIL_LABELS`, `OFFICE_LABEL_PARENTS`, refresh throttle), engine run, `system_status`, reprocess flag, `/health` on `WORKER_HEALTH_PORT`, Dockerfile | G-T05, G-T06 | FR-01, FR-07–FR-09, FR-24, FR-69, NFR-10, NFR-15 | Worker tests for FR-01/07/08/09; `/health` 200 with `lastError` after a forced failure; two instances → one runs | 2 | P0 |
| G-T08 | Web foundation: Next.js app shell, NextAuth credentials (bcrypt, JWT 12 h, explicit `secret`, `NEXTAUTH_SECRET` required at boot), `/api/v1` route layer with zod, uniform error envelope `{ error: { code, message, details? } }`, `requireRole` + office-scope middleware (`?office=*` for ADMIN), users CRUD (404 on unknown id, self-demotion blocked), `/me/*` | G-T02 | FR-25–FR-29, FR-42, FR-45, NFR-17–20, NFR-23 | Table-driven role test (23 protected routes × {VIEWER, OPERATOR}); login lockout 5 fails/15 min; 404 on unknown user; self-demotion blocked | 3 | P0 |
| G-T09 | Alarms API + pages: active/cleared (`?status=`), filters, hidden types, office scope, page/pageSize ≤ 500, alarm names, polling 30/60 s, mobile cards | G-T08, G-T05 | FR-30–FR-34, FR-40–FR-43, NFR-06, NFR-37 | Integration tests per filter; Playwright at 390 px; counts match a seeded fixture | 3 | P0 |
| G-T10 | Export + stats: XLSX export with 50,000-row cap (413), `stats/summary`, `stats/daily` (localDay in `ALARM_TZ`), `stats/top-sites`, `dateParam` as local midnight | G-T09 | FR-35–FR-38, NFR-09, NFR-29 | Golden-file export test; `2026-10-14` → `2026-10-13T21:00:00Z`; >50k → 413 | 1.5 | P1 |
| G-T11 | Settings + notifications: office/display settings (ADMIN), rules editor with re-classification, notification feed (unread excludes reprocessed alarms), prefs, 20 s polling, `/health` (web, worker freshness via `HEALTH_STALE_AFTER_SEC`) | G-T09 | FR-39, FR-44–FR-46, FR-70, FR-17 | Tests per route: happy path + 400 + 401 + 403; `/health` reports stale worker; after reprocess, previously-seen alarms are not unread | 2 | P1 |
| G-T12 | Hourly server side: `GET /hourly-reports` (Gmail label list, pagination by Gmail token), `…/{id}/attachment` streaming with `HOURLY_MAX_RAR_MB` / `HOURLY_MAX_XLSX_MB`, `…/{id}/xlsx` (server unrar for mobile, D-11a), 409/413, `unrar` in the web image | G-T08 | FR-47–FR-52, NFR-09 | 200 + correct length; 413 over limit; 409 when no attachment; `web` memory < 150 MB during a 40 MB RAR stream | 1.5 | P0 |
| G-T13 | `packages/core/hourly`: parse (sheets, column mapping, `clockInvalid`), enrich from Site Master, normalize, diff — zero Node imports | G-T03 | FR-53–FR-56, FR-61 | Port all hourly unit tests; `tsc` with `lib: ["dom"]` succeeds | 2 | P0 |
| G-T14 | Hourly client pipeline (browser): Web Worker, `node-unrar-js` WASM, SheetJS, IndexedDB reference cache with `updatedAt` ETag, filters, sheet tabs, export (Excel incl. `clockInvalid` / table / image), Web Share, compare, 3-report in-memory cap, clear on logout, no-WASM fallback message | G-T12, G-T13 | FR-57–FR-64, NFR-08, NFR-38 | 40k-row report < 15 s on mid-range Android, < 5 s on laptop; export matches golden file row-for-row; second load makes no site-master request; eviction unit tests; manual test on Safari iOS 16 | 4 | P0 |
| G-T15 | Site Master + normalizations: import (upsert by code), list, inline edit of all fields (nodality, VIP, power source, battery, notes, phone), `hourly-normalizations` GET/PUT, server-side ADMIN gate on the settings page (API GET stays readable by any user, FR-67) | G-T08 | FR-65–FR-68 | Import idempotent; VIEWER can GET, cannot open page; edit VIP → badge on `/alarms` | 1.5 | P1 |
| G-T16 | Parity + ops: `web` service (healthcheck `/api/health` 30 s, OAuth files read-only, runs as `node`), Caddy `proxy` (`tls internal`, only service publishing ports, login rate limit 10 req/min/IP), `backup` service + `scripts/restore.sh`, `docker-compose.dev.yml` (bind mounts, `next dev`, `tsx watch`), README, RUNBOOK (deploy, upgrade, migrate, backup/restore, Gmail token refresh, reprocess), release tag `v1.0.0`, **parity checklist**: one row per FR-01…FR-70 and NFR with the test or manual check that proves it | G-T07, G-T14, G-T15 | FR-69–70, NFR-26, NFR-30, NFR-32–34, NFR-38, §7 traceability | Checklist 100 % green; clean-VM deploy from docs < 1 h; backup/restore reproduces `alarms` row count; 11th login attempt/min → 429; Web Share works in a secure context | 3 | P0 |

### Phase 3 — REST API v1 (on top of G-T08)

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| P3-T03 | Generate OpenAPI 3.1 from zod schemas (`zod-to-openapi`); serve `/api/v1/openapi.json` + Swagger UI (ADMIN only) | G-T08 | NFR-23 | Spec validates; every route appears with its min role | 1.5 | P2 |
| P3-T07 | API tokens for scripts/mobile (`POST /api/v1/auth/tokens`, ADMIN; bearer auth path; hashed storage; revoke) | G-T08 | CLAUDE.md §13 | Token can call `/alarms`; revoked token → 401 | 1.5 | P1 |
| P3-T08 | `Idempotency-Key` on `PUT /rules`, `POST /site-master/import`, `POST /reprocess` (24 h window, in-memory map per D-04) | G-T08 | FR-17, FR-24, FR-65 | Replayed request returns cached 2xx without re-executing | 1 | P3 |

### Phase 4 — Coverage & CI

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| P4-T03 | Make fixture-dependent tests fail (not skip) in CI when `samples` / `TEST_DATABASE_URL` are missing; keep skip locally | G-T16 | NFR-41 | CI job fails on missing fixtures; local run skips with warning | 0.5 | P1 |
| P4-T04 | CI pipeline (GitHub Actions): lint, typecheck, unit, integration against Postgres service (`alarms_test`), Playwright smoke, Docker build | P4-T03 | NFR-41–43 | Green pipeline on main; < 15 min | 1.5 | P1 |

### Phase 6 — Documentation

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| P6-T01 | Write CLAUDE.md for the new repository: roles, data model, full route list (OpenAPI is the source), `parseMessage` location, test counts, "as built" section | P3-T03 | — | Review diff against code | 1 | P1 |
| P6-T02 | `docs/ARCHITECTURE.md` (component diagram, request flow, worker cycle, data model, env table, client-side hourly flow) | G-T16 | §1, §5, §6 | Reviewed by second engineer | 1 | P2 |

### Phase 7 — React Native mobile app (`apps/mobile`)

Scope: login, alarms and hourly reports; admin screens stay web-only. The app consumes `/api/v1` with bearer tokens and reuses `packages/core` unchanged.

| ID | Task | Depends | Trace | Acceptance | Effort | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| P7-T01 | Scaffold `apps/mobile` (Expo, TypeScript, pnpm workspace, Metro config for `packages/core`); EAS preview builds in CI | P3-T07 | CLAUDE.md §13 | `pnpm --filter mobile start` runs; `@alarm/core` resolves; EAS preview build on both OSs | 1.5 | P1 |
| P7-T02 | Auth: login screen → `POST /auth/login` → JWT in `expo-secure-store`; auto-logout on 401; office label shown | P7-T01 | FR-25–FR-27, NFR-20 | Token never in AsyncStorage; expired token → login screen; VIEWER sees no admin entry points | 1.5 | P1 |
| P7-T03 | Alarms: active/cleared lists with filters, 30 s/60 s polling, site badges (VIP/nodality), notification badge | P7-T02 | FR-30–FR-34, FR-43–FR-46, NFR-06 | Same counts as web for the same filters (contract test); offline shows last data + stale banner | 2.5 | P1 |
| P7-T04 | Hourly: list from `/hourly-reports`; fetch `…/xlsx` into memory; SheetJS + `packages/core/hourly` parse/enrich on device (chunked, off the UI frame); filters, sheet tabs | P7-T01, G-T12, G-T13 | FR-47–FR-58 | 40k rows < 20 s on mid-range Android; no network after fetch; row values identical to web | 3 | P1 |
| P7-T05 | Reference data in `expo-sqlite` (Site Master, normalizations) with `updatedAt` sync | P7-T04 | FR-56, FR-66, FR-68 | Works offline after first sync | 1 | P2 |
| P7-T06 | Export & share & cleanup: Excel via SheetJS → temp file → `expo-sharing`; image via `react-native-view-shot`; on-device compare; temp files deleted in `finally` after the share sheet closes; in-memory reports cleared on logout | P7-T04 | FR-59–FR-64 | `FileSystem.cacheDirectory` holds no report files after share; export matches web golden file | 2 | P1 |
| P7-T07 | LAN networking: HTTPS to Caddy (D-06) or ATS `NSAllowsLocalNetworking`; configurable server URL screen | P7-T02 | NFR-38 | App connects on the NOC LAN on both OSs | 0.5 | P1 |
| P7-T08 | Distribution docs: EAS internal distribution (Android APK + iOS ad-hoc/TestFlight); runbook section | P7-T06 | — | A NOC phone installs the build from the documented link | 1 | P2 |

## 6. Dependency graph and critical path

```
P0-T01/T02 ─ G-T01 ─ G-T02 ─┬─ G-T03 ─ G-T04 ─ G-T05 ─┐
                            ├─ G-T06 ─────────────────┴─ G-T07 ─┐
                            ├─ G-T08 ─┬─ G-T09 ─ G-T10 / G-T11 ─┤
                            │         ├─ G-T15 ─────────────────┤
                            │         └─ G-T12 ─┐               │
                            └─ (G-T03) ─ G-T13 ─┴─ G-T14 ───────┴─ G-T16 (MG)
G-T16 ─ P3-T03 / P3-T07 / P3-T08 ─ P4-T03 ─ P4-T04 ─ P6-T01 / P6-T02
P3-T07 + G-T12 + G-T13 ─ P7-T01 ─ P7-T02 ─ P7-T03 / P7-T04 ─ P7-T05 / P7-T06 ─ P7-T07 ─ P7-T08
```

Critical path: **P0-T01 → G-T01 → G-T02 → G-T08 → G-T12 → G-T14 → G-T16 → P3-T07 → P7-T01**. Core (parser → classify → engine) and Worker run in parallel with Web; the Hourly lane needs both the parser (G-T03) and the web foundation (G-T08). Nothing in Phases 3–7 starts before the parity gate G-T16 except the OpenAPI generator, which can begin once G-T08 is stable.

## 7. Risks, assumptions, open questions

### Risks

| ID | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R-13 | Rebuild drifts from as-built behaviour in untested corners (DST edges, subject variants) | High | G-T16 parity checklist per FR/NFR; port every existing test and fixture before writing new code; run both systems side by side on the same mailbox for one week before cut-over |
| R-01 | Global matching (D-05): a cross-office false clear goes unnoticed | Medium | G-T05 test documents the scenario; log a line when a Clear matches an alarm in another office |
| R-04 | Gmail OAuth token expiry / quota during initial backfill | Medium | FR-05/FR-06 handling; runbook step for token refresh (G-T16) |
| R-05 | Caddy TLS on a LAN without public DNS | Low | Internal CA / self-signed with trust install; documented in RUNBOOK |
| R-06 | `unrar` from Debian non-free in the image | Low | Confirm acceptable; `node-unrar-js` fallback exists (FR-51) |
| R-07 | Single `web` replica assumption (lockout counters, idempotency map) | Low | Documented constraint; a second replica would move the two maps to PostgreSQL tables, not Redis |
| R-09 | Client-side parsing on weak phones may be slow or crash on very large RARs | Medium | Web Worker + chunked parsing; size caps on the server (G-T12); laptop fallback message (G-T14); mobile uses server-unrarred XLSX (D-11a) |
| R-10 | Each user re-processes the same report → N× attachment downloads | Low | Attachments are MBs on a LAN; Gmail quota far above NOC usage; monitor via worker status |
| R-11 | `node-unrar-js` WASM compatibility (RAR5, multi-volume, Safari iOS) | Medium | Spike in G-T14 against real NOC fixtures; server `/xlsx` route is the fallback |
| R-12 | Mobile app maintenance (two OS builds, store policies) | Medium | Expo/EAS; admin features stay web-only |
| R-08 | Test DB (`alarms_test`) not available in CI | Medium | P4-T04 provisions a Postgres service container |

### Assumptions

- A-01 One engineer, full-time; estimates are engineering effort only (no PM/QA overhead beyond the buffer).
- A-02 Production runs on one Docker host on the NOC LAN; no cloud, no Kubernetes.
- A-03 The old repository's uncommitted changes (`SiteMaster.phone`, per-category images) are part of the specification.
- A-04 Tested as-built behaviour (31 engine tests, 26 parser tests, hourly suites) is the specification; where code and CLAUDE.md disagree, code wins unless a decision says otherwise.
- A-05 `ALARM_TZ` stays `Africa/Cairo`; DST handling in `time.ts` is reproduced from the 26 parser tests.
- A-06 The new project runs its own database; no data is migrated from the old one (initial backfill repopulates from Gmail).

### Open questions (collect at P0-T01)

| ID | Question | Needed for |
| --- | --- | --- |
| Q-01 | Is cross-office matching intended (closed as "keep global", D-05) — confirm with NOC | G-T05 |
| Q-02 | Non-browser API consumers besides the mobile app (scripts, dashboards)? | P3-T07 |
| Q-03 | Who owns the Docker host; TLS trust-install procedure on NOC devices? | G-T16 |
| Q-04 | Backup retention and off-host copy requirement? | G-T16 |
| Q-05 | Should `RECTIFIER` map to POWER in the seed? | G-T04 |
| Q-06 | Is the 50,000-row export cap and 500 page size acceptable? | G-T10 |
| Q-07 | Will more than one NOC office use the system concurrently? | G-T09, D-05 |
| Q-08 | Access to a production `raw_messages` sample for the side-by-side parity run? | R-13 |
| Q-09 | Which phones does the NOC use (Android/iOS, model/year)? | G-T14, P7-T04 |
| Q-10 | Mobile distribution: internal (APK/TestFlight) or public stores? Apple developer account? | P7-T08 |
| Q-11 | Must the mobile app work with the server unreachable (true offline unrar → D-11b)? | D-11 |

## 8. Effort summary and first sprint

| Phase | Tasks | P0 | P1 | P2 | P3 | Est. days |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 2 | 2 | — | — | — | 1 |
| G | 16 | 12 | 4 | — | — | 35.5 |
| 3 | 3 | — | 1 | 1 | 1 | 4 |
| 4 | 2 | — | 2 | — | — | 2 |
| 6 | 2 | — | 1 | 1 | — | 2 |
| 7 | 8 | — | 6 | 2 | — | 13 |
| **Total** | **33** |  |  |  |  | **≈ 57.5 + 20 % buffer → 75–95 (without Phase 7: 62–78)** |

**Suggested first sprint (10 days):** P0-T01, P0-T02, G-T01, G-T02, G-T03, G-T04, G-T05 → parser and engine at parity with all 57 ported tests green before any UI or Gmail code is written.

## 9. Out of scope / backlog

Listed for traceability only; none of these is built.

- PWA manifest, service worker, web push, `PushSubscription` / `NotificationPref` models, `cloudflared` tunnel.
- Redis in any form (D-04); a multi-replica `web` would use PostgreSQL tables instead.
- Gmail push notifications (Pub/Sub watch) replacing the 1-minute poll.
- Persisting body fields `neName`, `startTime`, `alarmNumber`, `kind` and populating the `sites` table — no requirement consumes them.
- Data migration from the old database — the new stack repopulates from Gmail (A-06).

## 10. Approval

Implementation starts only after both approvals and the answers to Q-01…Q-11 are recorded in `docs/DECISIONS.md`.

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product owner (NOC) |  | ☐ approve ☐ changes |  |
| Tech lead |  | ☐ approve ☐ changes |  |
