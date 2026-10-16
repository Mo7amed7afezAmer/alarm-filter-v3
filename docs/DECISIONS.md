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

## Approval (PLAN.md §10)

Implementation starts only after both approvals and the answers to Q-01…Q-11 are recorded here.

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product owner (NOC) | mohamed.hafez@docnile.com | ☑ approve ☐ changes | 2026-10-15 |
| Tech lead | mohamed.hafez@docnile.com | ☑ approve ☐ changes | 2026-10-15 |
