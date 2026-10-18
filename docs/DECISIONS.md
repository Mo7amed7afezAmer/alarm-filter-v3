# Decisions — NOC Alarm Platform (standalone rebuild)

Task: P0-T01. Source: `PLAN.md` §3 (decisions) and §7 (risks, open questions). Source of truth for behaviour: `REQUIREMENTS.md`.

Every row below is final. Reopening a decision requires a new row with a date.

## Architectural decisions (PLAN.md §3)

| ID | Decision | Applied as | Date |
| --- | --- | --- | --- |
| D-01 | API hosting | Next.js Route Handlers under `/api/v1` (option a); no separate `apps/api` | 2026-10-15 |
| D-02 | API versioning | `/api/v1` from the first commit; no legacy `/api/*` alias exists | 2026-10-15 |
| D-03 | Scheduler | In-process `node-cron`; advisory lock 42 guarantees a single run | 2026-10-15 |
| D-04 | Shared cache / rate limiting | **No Redis.** Single `web` replica; login counters and idempotency keys in memory | 2026-10-15 |
| D-05 | Office scoping of matching | **Keep global matching** (decided 2026-10-15); cross-office test documents the decision | 2026-10-15 |
| D-06 | Reverse proxy | **Caddy with `tls internal`** (self-signed); NOC devices trust the root CA once | 2026-10-15 |
| D-07 | Backups | Compose `backup` service: daily `pg_dump -Fc`, 14-day retention, restore script | 2026-10-15 |
| D-08 | Login protection | Rate limit at Caddy (10 req/min/IP) + in-app per-email lockout (5 fails / 15 min) | 2026-10-15 |
| D-09 | — | Not defined in PLAN.md §3 (the numbering skips it) | — |
| D-10 | Hourly-report processing | **Client-side**: server streams the attachment only; browser does unrar (WASM) + parse + export; no file on disk anywhere | 2026-10-15 |
| D-11 | RAR extraction on React Native | Server unrars and streams the XLSX (`…/xlsx` route); Hermes has no WebAssembly | 2026-10-15 |
| D-12 | Mobile framework | Expo SDK (latest stable), TypeScript, pnpm workspace `apps/mobile`, EAS build | 2026-10-15 |

**Stack:** Node 20, pnpm 9.15.9, Next.js 14, Prisma, PostgreSQL 16, Vitest, Playwright, Docker Compose, Debian `unrar` (NFR-33, NFR-36). Target host: 2 vCPU / 4 GB / 40 GB SSD.

## Risks (PLAN.md §7)

R-02 and R-03 are not defined in PLAN.md §7.

| ID | Risk | Impact | Mitigation | Accepted by | Date |
| --- | --- | --- | --- | --- | --- |
| R-01 | Global matching (D-05): a cross-office false clear goes unnoticed | Medium | G-T05 test documents the scenario; log a line when a Clear matches an alarm in another office | mohamed.hafez@docnile.com | 2026-10-15 |
| R-04 | Gmail OAuth token expiry / quota during initial backfill | Medium | FR-05/FR-06 handling; runbook step for token refresh (G-T16) | mohamed.hafez@docnile.com | 2026-10-15 |
| R-05 | Caddy TLS on a LAN without public DNS | Low | Internal CA / self-signed with trust install; documented in RUNBOOK | mohamed.hafez@docnile.com | 2026-10-15 |
| R-06 | `unrar` from Debian non-free in the image | Low | Confirm acceptable; `node-unrar-js` fallback exists (FR-51) | mohamed.hafez@docnile.com | 2026-10-15 |
| R-07 | Single `web` replica assumption (lockout counters, idempotency map) | Low | Documented constraint; a second replica would move the two maps to PostgreSQL tables, not Redis | mohamed.hafez@docnile.com | 2026-10-15 |
| R-08 | Test DB (`alarms_test`) not available in CI | Medium | P4-T04 provisions a Postgres service container | mohamed.hafez@docnile.com | 2026-10-15 |
| R-09 | Client-side parsing on weak phones may be slow or crash on very large RARs | Medium | Web Worker + chunked parsing; size caps on the server (G-T12); laptop fallback message (G-T14); mobile uses server-unrarred XLSX (D-11a) | mohamed.hafez@docnile.com | 2026-10-15 |
| R-10 | Each user re-processes the same report → N× attachment downloads | Low | Attachments are MBs on a LAN; Gmail quota far above NOC usage; monitor via worker status | mohamed.hafez@docnile.com | 2026-10-15 |
| R-11 | `node-unrar-js` WASM compatibility (RAR5, multi-volume, Safari iOS) | Medium | Spike in G-T14 against real NOC fixtures; server `/xlsx` route is the fallback | mohamed.hafez@docnile.com | 2026-10-15 |
| R-12 | Mobile app maintenance (two OS builds, store policies) | Medium | Expo/EAS; admin features stay web-only | mohamed.hafez@docnile.com | 2026-10-15 |
| R-13 | Rebuild drifts from as-built behaviour in untested corners (DST edges, subject variants) | High | G-T16 parity checklist per FR/NFR; port every existing test and fixture before writing new code; run both systems side by side on the same mailbox for one week before cut-over | mohamed.hafez@docnile.com | 2026-10-15 |

## Open questions (PLAN.md §7)

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

## Answers

| ID | Answer | Answered by / date |
| --- | --- | --- |
| Q-01 | Yes — global matching confirmed (D-05 stands) | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-02 | No — the mobile app is the only non-browser consumer | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-03 | NOC team owns the host and installs the Caddy root CA manually on each device | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-04 | 14 days (D-07 default); no off-host copy | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-05 | ~~No — RECTIFIER stays OTHER (no POWER rule)~~ Superseded 2026-10-15: seed follows FR-16 as written (RECTIFIER → POWER, 13 rules) | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-06 | Yes — 50,000-row cap and 500 page size accepted | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-07 | Yes — more than one NOC office will use the system concurrently | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-08 | Yes — a production `raw_messages` sample is available | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-09 | Android and iOS | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-10 | Internal distribution (APK + TestFlight/ad-hoc); an Apple developer account exists | mohamed.hafez@docnile.com / 2026-10-15 |
| Q-11 | No — D-11 stands (server unrars; no on-device unrar) | mohamed.hafez@docnile.com / 2026-10-15 |

## Clarifications (2026-10-15)

| Topic | Decision | By / date |
| --- | --- | --- |
| G-T02 table count | PLAN.md says "16 tables"; REQUIREMENTS.md §5 lists 9 models. The schema implements exactly the 9 models in §5. | mohamed.hafez@docnile.com / 2026-10-15 |
| G-T02 seed scope | Seed default rules (FR-16) and the initial ADMIN (FR-29) only. The hourly-normalizations seed (NFR-31) waits until the default list is supplied under `samples/seed/`. | mohamed.hafez@docnile.com / 2026-10-15 |
| G-T07 lock 42 | Two worker instances: `pg_try_advisory_xact_lock(42)` — the second instance logs and skips the cycle (D-03), instead of waiting as `pg_advisory_xact_lock` would (NFR-10 wording). | mohamed.hafez@docnile.com / 2026-10-15 |
| G-T07 health grace | FR-69 start-up grace = `HEALTH_STALE_AFTER_SEC` (default 300 s): no 503 for staleness during the first 300 s after the worker starts. | mohamed.hafez@docnile.com / 2026-10-15 |
| G-T08 role test | One route → minimum-role table (NFR-18) drives the role test; G-T08 tests the routes it builds and each later task adds its routes to the same table. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T08 `?office=*` | Not built. Every view is scoped to the selected office (FR-40); the PLAN item is dropped. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T08 self-demotion | FR-28 as written: an ADMIN cannot set their own role to VIEWER or delete themselves; self → OPERATOR is allowed. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T08 users API | `GET`/`POST /api/v1/users`; `PATCH`/`DELETE /api/v1/users/{id}`, 404 for an unknown id. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T09 region | Region = last 2 characters of the site code (FR-32 `siteCodeOf`), as for hourly rows; the `sites` table is not read. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T09 no office | With no office selected, views are scoped to the first `GMAIL_LABELS` entry (the label the worker reads, FR-07). | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T10 export columns | Active: Alarm, Category, Site, Site code, Cell, Device, CONSEC_NBR, Region, VIP, Nodality, Battery, Phone, Site type, Power source, Alarm time, Age (min). Cleared: the same to Alarm time, then Clear time, Duration (min), Clear type. Times `YYYY-MM-DD HH:mm:ss` in ALARM_TZ. Checked against expected cell values (JSON) instead of a binary golden.xlsx. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T10 stats scope | Summary orphan/parse-error counts are office-scoped; daily and top-sites windows and day buckets use alarmTime; hidden types are excluded from every count. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T11 bell polling | The notification feed is polled every 30 s (FR-46, NFR-06); PLAN's "20 s" is not used. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T11 health path | Web health stays public at `GET /api/health` (FR-70, G-T16 healthcheck): the one exception to D-02. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T11 worker freshness | Web `/api/health` judges the worker stale with `WORKER_STALE_SEC` (default 300 s), as FR-70 states. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T11 reprocess and unread | Fixes gap 23: when reprocess recreates an alarm that existed before (same consecNbr, or same key + alarmTime) it keeps the original `createdAt`, so seen alarms do not become unread again. | mohamed.hafez@docnile.com / 2026-10-16 |
| G-T12 server unrar | `…/xlsx` (D-11) extracts in memory with node-unrar-js (WebAssembly); FR-51 checks run on the RAR headers; no temp files (D-10). Debian `unrar` is still installed in the web image (NFR-33). | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T12 hourly roles | `GET /hourly-reports`: VIEWER. `…/attachment` and `…/xlsx` (downloading = processing): OPERATOR, as FR-49 / FR-64 had it. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T12 40 MB memory test | The 40 MB RAR is generated during the test with WinRAR / `rar` from random data; skipped where `rar` is not installed. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T12 cache bits | FR-47 "cache status" and FR-58's VIEWER 409 belonged to the server cache removed by D-10; both dropped. 409 now means "no attachment". | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T13 hourly row | Row fields: sheet, technologies[], alarmNumber, alarmType, alarmTime, clockInvalid, alarmText, alarmName, supplementaryInfo, dn, objectClass, siteName, siteCode, siteAddress, diagnosticInfo, userInfo + office, nodality, vip, siteType, powerSource, battery, phone, region, category. alarmTime = wall-clock text `YYYY-MM-DD HH:mm:ss` (Excel serial rounded to the second, no time zone). | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T13 normalization | Base normalization + rules apply to alarmName, alarmText, supplementaryInfo, siteName, office, siteType, nodality, powerSource; no default rules (DEFAULT_HOURLY_NORMALIZATIONS is not in REQUIREMENTS). Pipeline: parse → enrich → normalize → category. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T14 spike | node-unrar-js (WASM) in a Web Worker extracts RAR5, RAR4 and solid archives; multi-volume and header-encrypted archives are rejected (BAD_ARCHIVE). 40k rows ≈ 4.0–5.2 s in headless Chromium with SheetJS `cellText/cellHTML/cellNF/cellStyles: false` and only the six hourly sheets. Proceed. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T14 reference cache | Site Master + normalizations are kept in IndexedDB and reused without any request for 30 min (HOURLY_CACHE_MIN) after the last check; after that one conditional request with If-None-Match (updatedAt); 304 keeps the cache. Until G-T15 the endpoint is mocked in tests. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T14 office fills | A fixed palette of 8 light fills assigned to the offices of the rows in alphabetical order (repeating after 8); no fill for rows without an office. Used by the Excel export and the on-screen table. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T14 export columns | Default columns: Sheet, Alarm time, Alarm name, Site name, Site code, Office, Region, Category, VIP, Nodality, Battery, Phone, Clock invalid (YES / blank); every other row field can be chosen. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T14 report cap | The browser keeps the 3 most recently used processed reports (LRU), no time-based expiry; all are cleared on logout. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T14 timing | The 40k-row budget is checked as the median of three warm runs (< 5 s) against a production build (`next build` + `next start` on :3201) in `pnpm e2e`. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T15 reference role | `GET /api/v1/hourly-reference` (Site Master + normalizations for in-browser processing): OPERATOR, like `…/attachment`. `GET`/`PUT /hourly-normalizations` stay ADMIN (FR-68); `GET /site-master` stays VIEWER (FR-67). | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T15 reference ETag | New column `system_status.referenceUpdatedAt`, set by Site Master import, Site Master edit and normalization PUT; it is the hourly-reference `updatedAt` / ETag. Replaces FR-65 / FR-68 "the hourly cache is cleared" under D-10. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T15 import fixture | The Site Master `.xlsx` for the route tests is generated inside the tests from `samples/hourly/site-master.json` plus invalid rows; nothing is written to `samples/`. The original `tests/fixtures/SiteMaster_KafrElDawar.xlsx` is also parsed in a core test (136 sites / 2 skipped, FR-65). | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T15 import columns | Headers are matched ignoring case, spaces and punctuation: Code (or Site Code), Site Name, Office, Nodality, VIP, Site Type, Power Source, Battery, Notes; phone from Guard Number / Guard Phone / Phone / Phone Number / Mobile / Contact (FR-66). A skipped row is an invalid code, a code already seen in the file, or an empty office (samples/hourly: 136 inserted / 2 skipped, as FR-65). | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T15 phone | A numeric cell gets the leading 0 back (Excel only drops it from numbers); a text cell is split on `/ , ;` and new lines; repeated numbers are dropped; numbers are joined with " / ". | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T15 normalizations UI | Normalizations are edited through the API only (FR-68 names the route, no page). | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T16 rate limit | D-08's 10 req/min/IP login limit runs in Caddy with the `github.com/mholt/caddy-ratelimit` plugin (pinned, built with xcaddy into the `proxy` image) on `POST /api/auth/callback/credentials`. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T16 backups | Daily `pg_dump -Fc` into `./backups` on the host (bind mount, gitignored); files older than 14 days are deleted; `scripts/restore.sh <file>` restores one. | mohamed.hafez@docnile.com / 2026-10-17 |
| G-T16 parity rows | An FR changed or dropped by a recorded decision is green in `docs/PARITY.md` when its row names the decision and the test of the behaviour that replaced it. | mohamed.hafez@docnile.com / 2026-10-17 |
| P3-T07 token owner | An ADMIN creates a token for any existing user (`POST /api/v1/auth/tokens` `{ userId, name }`); a request with `Authorization: Bearer <token>` acts as that user with the user's current role and office scope; deleting the user deletes their tokens. A bearer token is the only credential of the request (no fallback to the session cookie). | mohamed.hafez@docnile.com / 2026-10-18 |
| P3-T07 lifetime | No expiry; a token is valid until revoked (`DELETE /api/v1/auth/tokens/{id}`, 204, row kept with `revokedAt`). No list endpoint. Stored as SHA-256 of 32 random bytes (table `api_tokens`); the token is returned once. | mohamed.hafez@docnile.com / 2026-10-18 |
| P3-T07 mobile login | P7-T02's `POST /auth/login` is decided at Stage 11, not built in P3-T07. | mohamed.hafez@docnile.com / 2026-10-18 |
| P3-T03 spec | `GET /api/v1/openapi.json` (ADMIN) is generated with zod-to-openapi from the query / path / body schemas each route passes to `route()`; the operations are the role table (`lib/routes.ts`) plus public `GET /api/health`; each has `x-min-role`, security session cookie or bearer token, and the error envelope for 400 / 401 / 403. Response bodies are not described (routes have no response schemas). Swagger UI (`swagger-ui-react`) is the ADMIN-only page `/api-docs` (server-side gate, no menu entry). | mohamed.hafez@docnile.com / 2026-10-18 |
| P3-T08 behaviour | `Idempotency-Key` (optional header, 1–255 visible ASCII, else 400) on `PUT /rules`, `POST /site-master/import`, `POST /reprocess`. Scope: user + method + path. Same key + same body (SHA-256 of the raw bytes; for multipart, of the field names, file names and contents, so a retry with a new boundary matches) within 24 h → the cached 2xx (status, body, content type) with `Idempotent-Replayed: true`, nothing runs. Same key + different body → 422 `IDEMPOTENCY_KEY_REUSED`, nothing runs. Same key while the first is running → 409 `IDEMPOTENCY_IN_PROGRESS`. Non-2xx responses are not cached and release the key. In-memory map (D-04), entries expire 24 h after they are stored. | mohamed.hafez@docnile.com / 2026-10-18 |
| P4-T03 guard | Every package's `vitest.config.ts` calls `guardFixtures` (`vitest.fixtures.ts`). With `CI=true`, a missing `TEST_DATABASE_URL` (db, worker, web), `samples/` or `tests/fixtures/` stops the run at start-up. Locally it prints a warning; DB suites keep their `skipIf`, and test files that read a missing fixture directory (directly or through relative imports, comments ignored) are excluded. The `rar` tool (40 MB RAR / 40k timing tests) is not a fixture and still skips where absent. | mohamed.hafez@docnile.com / 2026-10-18 |
| P4-T04 jobs | `.github/workflows/ci.yml`: four parallel jobs (`check` lint + typecheck; `test` unit (core) + integration (db, worker, web, tests/ops compose, tests/ci) on a postgres:16 service `alarms_test`, with RarLab `rar` installed so the 40 MB RAR memory test runs; `e2e` Playwright against `alarms_test`, without `rar`, so the laptop-only 40k timing test skips; `docker` `docker compose --env-file .env.example build` with placeholder passwords), each `timeout-minutes: 15`. No secrets, no Gmail files. | mohamed.hafez@docnile.com / 2026-10-18 |
| Stage 8 before G-T16 | Phase 3 started while G-T16's manual checks, clean-VM deploy and v1.0.0 tag are pending (deviation from PLAN.md §6, product owner's choice). | mohamed.hafez@docnile.com / 2026-10-18 |

## Approval (PLAN.md §10)

Implementation starts only after both approvals and the answers to Q-01…Q-11 are recorded here.

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product owner (NOC) | mohamed.hafez@docnile.com | ☑ approve ☐ changes | 2026-10-15 |
| Tech lead | mohamed.hafez@docnile.com | ☑ approve ☐ changes | 2026-10-15 |
