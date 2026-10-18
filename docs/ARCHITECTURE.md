# Architecture

As built on 2026-10-18. Requirements: `REQUIREMENTS.md`; decisions: `docs/DECISIONS.md` (D-01…D-12
and the task clarifications); operations: `docs/RUNBOOK.md`. `tests/ci/docs.test.ts` checks that the
environment table below and `.env.example` match what the code reads.

## Components

One Docker host on the NOC LAN (A-02). Only the proxy publishes ports (NFR-26, D-06).

```mermaid
flowchart LR
  subgraph LAN["NOC LAN"]
    Browser["Browsers<br/>VIEWER / OPERATOR / ADMIN"]
    Mobile["Mobile app (Phase 7)<br/>API token"]
  end
  Gmail[(Gmail API<br/>gmail.readonly)]
  subgraph Host["Docker host (compose project alarm-platform)"]
    Proxy["proxy<br/>Caddy, tls internal<br/>:80 → :443, login 10/min/IP"]
    Web["web<br/>Next.js 14 standalone<br/>pages + /api/v1 + /api/health"]
    Worker["worker<br/>node-cron every minute<br/>/health :4000"]
    Migrate["migrate (one-shot)<br/>prisma migrate deploy + seed"]
    DB[(db<br/>PostgreSQL 16<br/>volume pgdata)]
    Backup["backup<br/>daily pg_dump -Fc<br/>14 days in ./backups"]
  end
  Browser -- HTTPS --> Proxy
  Mobile -- "HTTPS + Bearer" --> Proxy
  Proxy -- "HTTP :3000" --> Web
  Web <--> DB
  Worker <--> DB
  Migrate --> DB
  Backup --> DB
  Worker -- "history.list / messages.list / messages.get / labels.list" --> Gmail
  Web -- "Hourly label: messages.list / get / attachments.get" --> Gmail
```

| Part | Code | Notes |
| --- | --- | --- |
| Core logic | `packages/core` | Parser, classification, matching engine, notifications, hourly processing; no database; `src/hourly` has zero Node imports (runs in the browser) |
| Database access | `packages/db` | Prisma schema, migrations, seed, repository |
| Worker | `apps/worker` | Gmail sync and the matching cycle |
| Web | `apps/web` | UI, `/api/v1` route handlers, OpenAPI, hourly browser pipeline |
| Proxy / backup | `proxy/`, `backup/`, `scripts/restore.sh` | Caddy with the caddy-ratelimit plugin; `pg_dump` loop; restore script |

## Request flow

Every `/api/v1` handler is built with `route()` (`apps/web/lib/api.ts`): authenticate, check the
minimum role, honour `Idempotency-Key` where enabled, validate with zod, run, and map errors to
`{ error: { code, message, details? } }`.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser / script
  participant C as Caddy (proxy)
  participant M as middleware.ts
  participant R as route() in lib/api.ts
  participant H as Route handler
  participant D as PostgreSQL
  B->>C: HTTPS request (session cookie or Authorization: Bearer)
  C->>C: POST /api/auth/callback/credentials: 10/min/IP, else 429 (D-08)
  C->>M: HTTP to web:3000
  alt page without session
    M-->>B: 307 → /login
  else API without session and without bearer token
    M-->>B: 401 UNAUTHORIZED
  end
  M->>R: request
  R->>D: bearer token → api_tokens (SHA-256) → user, or NextAuth session (JWT 12 h)
  alt no user / revoked token
    R-->>B: 401
  else role below the route's minimum
    R-->>B: 403 FORBIDDEN
  end
  opt Idempotency-Key on PUT /rules, POST /site-master/import, POST /reprocess
    R->>R: replay cached 2xx / 409 in flight / 422 other body (24 h, in memory)
  end
  R->>R: zod: query, path, body → 400 with details
  R->>H: typed context (user, query, body, params)
  H->>D: Prisma queries scoped to the office, without hidden types
  H-->>B: JSON (or XLSX / stream)
```

Sign-in goes through NextAuth credentials (`lib/auth.ts`): case-insensitive e-mail, bcrypt, lockout
after 5 failures for 15 minutes (`lib/lockout.ts`, per e-mail, in memory, single replica, D-04).

## Worker cycle

`apps/worker/src/index.ts` runs one cycle at start-up and then on `WORKER_CRON`; a tick is skipped
while the previous one runs. `run.ts` `runOnce`:

```mermaid
flowchart TD
  T[tick] --> S[read system_status]
  S --> RP{reprocessDays set?}
  RP -- yes --> L1{pg_try_advisory_xact_lock 42}
  L1 -- held --> SKIP[outcome locked]
  L1 -- got --> RW["reprocess window: delete / reopen alarms,<br/>re-run raw messages (30 min tx)"] --> CLR[reprocessDays = null]
  RP -- no --> OF
  CLR --> OF["office = officeLabel or first GMAIL_LABELS"]
  OF --> LB["refresh office labels (≤ every 10 min)<br/>→ availableLabels"]
  LB --> L2{lock 42 in the 5 min tx}
  L2 -- held --> SKIP
  L2 -- got --> IN{"lastHistoryId and same office?"}
  IN -- yes --> H["history.list since lastHistoryId<br/>(404 → backfill)"]
  IN -- no --> BF["messages.list after now − INITIAL_BACKFILL_HOURS"]
  H --> F["skip known gmailIds; fetch ≤ MAX_MESSAGES_PER_RUN<br/>5 at a time; stop on quota"]
  BF --> F
  F --> RAW[insert raw_messages, tagged with the office]
  RAW --> E["processBatch: parse → classify → dedupe /<br/>supersede / clear / orphan"]
  E --> ST["system_status: lastRunAt, lastRunMessages,<br/>lastError = null, syncedLabel,<br/>lastHistoryId only when drained and unthrottled"]
  ST --> LOG[one summary line]
  SKIP --> LOG
```

On any error the cycle stores `lastError` (≤ 2000 characters) and the next tick tries again.
`GET /health` on `WORKER_HEALTH_PORT` answers 503 when the last run is older than
`HEALTH_STALE_AFTER_SEC` or the database fails, else 200 (Gmail errors only in the body).

## Data model

```mermaid
erDiagram
  raw_messages ||--o{ orphan_clears : "rawMessageId (cascade)"
  users ||--o{ api_tokens : "userId (cascade)"
  raw_messages {
    int id PK
    string gmailId UK
    string subject
    datetime receivedAt
    string body
    string office
    string parseError
    datetime processedAt
  }
  alarms {
    int id PK
    string alarmKey
    string alarmName
    string site
    enum category
    datetime alarmTime
    enum status
    datetime clearTime
    int durationMin
    enum clearType
    string consecNbr UK
    string cellName
    string device
    string office
    datetime createdAt
  }
  orphan_clears {
    int id PK
    string alarmKey
    string subject
    datetime clearTime
    int rawMessageId FK
    string consecNbr
    string office
  }
  rules {
    int id PK
    string pattern
    enum category
    int priority
  }
  sites {
    string site PK
    string region
    string owner
  }
  users {
    int id PK
    string email UK
    string passwordHash
    enum role
    json notifyPrefs
    datetime notificationsSeenAt
    json displayPrefs
  }
  api_tokens {
    int id PK
    string name
    string tokenHash UK
    int userId FK
    datetime createdAt
    datetime revokedAt
  }
  system_status {
    int id PK
    string lastHistoryId
    datetime lastRunAt
    string lastError
    int lastRunMessages
    int reprocessDays
    string officeLabel
    string syncedLabel
    json availableLabels
    json displayFilter
    datetime referenceUpdatedAt
  }
  site_master {
    string code PK
    string office
    string nodality
    boolean vip
    string siteType
    string powerSource
    string battery
    string phone
    string region
    datetime updatedAt
  }
  hourly_normalizations {
    int id PK
    string field
    string from
    string to
  }
```

`alarms` has no foreign key to `site_master`; list queries join on the site code (last `_` segment of
`site`, FR-32). Matching is global across offices (D-05). `sites` is not read or written. Times are
stored in UTC and shown in `ALARM_TZ` (NFR-29). Hourly alarm rows are never stored (NFR-28, D-10).

## Hourly reports in the browser

D-10: the server only streams the attachment; unrar, parsing, enrichment, filtering and export happen
in the browser, and no report is written to disk anywhere. The mobile app (no WebAssembly in Hermes)
uses `…/xlsx`, where the server extracts the workbook in memory (D-11).

```mermaid
sequenceDiagram
  autonumber
  participant U as Page /hourly/[id]
  participant P as lib/hourly/processor.ts
  participant I as IndexedDB (reference cache)
  participant W as Web Worker lib/hourly/worker.ts
  participant S as web /api/v1
  participant G as Gmail
  U->>P: open report (OPERATOR)
  P->>P: no Worker / WebAssembly / IndexedDB → fallback message
  par attachment
    P->>S: GET /hourly-reports/{id}/attachment
    S->>G: attachments.get
    S-->>P: stream (≤ HOURLY_MAX_RAR_MB, 409 none, 413 too large)
  and reference data
    P->>I: Site Master + normalizations
    alt checked within 30 min
      I-->>P: cached copy, no request
    else older
      P->>S: GET /hourly-reference (If-None-Match: updatedAt)
      S-->>P: 304 keep / 200 new copy → IndexedDB
    end
  end
  P->>W: attachment bytes + reference
  W->>W: RAR → unrar.wasm (node-unrar-js) → one .xlsx (FR-50/51) or plain .xlsx (FR-52)
  W->>W: SheetJS: six hourly sheets → core parse / enrich / normalize / category
  W-->>P: rows + stats
  P->>P: keep in memory, LRU of 3 reports, cleared on logout
  U->>U: sheet tabs, filters in the URL, compare (diff), Excel export (ExcelJS), PNG images, Web Share
```

## Environment variables

Defaults apply when the variable is unset. Compose passes these to the containers (`docker-compose.yml`).

| Variable | Default | Read by | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_USER` | `alarms` | compose (db, backup, restore.sh) | Database user |
| `POSTGRES_PASSWORD` | required | compose (db, backup) | Database password |
| `POSTGRES_DB` | `alarms` | compose (db, backup, restore.sh) | Database name |
| `DATABASE_URL` | built by compose | Prisma (migrate, worker, web) | Connection string |
| `TEST_DATABASE_URL` | — | tests, Playwright, fixture guard | `alarms_test` only (NFR-41) |
| `ADMIN_EMAIL` | — | seed (migrate) | First ADMIN, created once |
| `ADMIN_PASSWORD` | — | seed (migrate) | First ADMIN password (≥ 8, else skipped) |
| `NEXTAUTH_SECRET` | required | web (boot check, NextAuth) | Session signing |
| `NEXTAUTH_URL` | `https://localhost` | NextAuth | Public URL of the web app |
| `SITE_ADDRESS` | `localhost` | proxy (Caddyfile) | Host name or IP for the internal certificate |
| `GOOGLE_CREDENTIALS_PATH` | required (worker) | worker, web | OAuth client file (read-only mount) |
| `GOOGLE_TOKEN_PATH` | required (worker) | worker, web | OAuth token file (read-only mount) |
| `GMAIL_LABELS` | — | worker, web | Office label read when none is selected (first entry) |
| `GMAIL_QUERY` | empty | worker | Extra filter for the backfill listing only |
| `OFFICE_LABEL_PARENTS` | `DN,DS` | worker | Parents of the office labels |
| `WORKER_CRON` | `* * * * *` | worker | Cycle schedule |
| `MAX_MESSAGES_PER_RUN` | `200` | worker | Messages fetched per cycle |
| `INITIAL_BACKFILL_HOURS` | `24` | worker | Backfill window |
| `WORKER_HEALTH_PORT` | `4000` | worker, compose healthcheck | `/health` port |
| `HEALTH_STALE_AFTER_SEC` | `300` | worker | `/health` 503 after this many seconds without a run |
| `ALARM_TZ` | `Africa/Cairo` | worker, web | Alarm time zone (DST-aware) |
| `ALERT_HOURS` | `4` | web | Overdue threshold |
| `WORKER_STALE_SEC` | `300` | web `/api/health` | Worker freshness in the health body |
| `HOURLY_GMAIL_LABEL` | `Hourly Update` | web | Label of the hourly report e-mails |
| `HOURLY_MAX_RAR_MB` | `25` | web (core `limitsFromEnv`) | Attachment size limit (RAR and plain XLSX) |
| `HOURLY_MAX_EXTRACT_MB` | `100` | web (core `limitsFromEnv`) | Declared uncompressed size limit |
| `HOURLY_GMAIL_MOCK_DIR` | — | web | Tests only: hourly reports from a local folder |
| `BACKUP_KEEP_DAYS` | `14` (fixed in compose) | backup | Days of dumps kept |
| `PGHOST` | `db` (fixed in compose) | backup | `pg_dump` connection |
| `PGUSER` | from `POSTGRES_USER` | backup | `pg_dump` connection |
| `PGPASSWORD` | from `POSTGRES_PASSWORD` | backup | `pg_dump` connection |
| `PGDATABASE` | from `POSTGRES_DB` | backup | `pg_dump` connection |
| `CI` | — | Vitest fixture guard | `true`: missing fixtures fail the run (P4-T03) |
| `NODE_ENV` | — | web `lib/db.ts` | Reuse one Prisma client across hot reloads outside production |
| `NEXT_DIST_DIR` | `.next` | `next.config.mjs` | Separate build folder for the e2e servers |
| `BUILD_STANDALONE` | — | `next.config.mjs` | `1` in the web image: standalone output |
| `INIT_CWD` | set by pnpm | worker `auth-cli.ts` (`pnpm gmail:auth`) | Base directory for relative OAuth file paths |
| `OPS_BASE_URL` | — | `tests/ops/stack.test.ts` | Live checks against a running stack |
| `OPS_RESTORE` | — | `tests/ops/stack.test.ts` | `1`: also run backup → restore |
| `OPS_PROJECT` | `alarm-platform` | `tests/ops/stack.test.ts` | Compose project of the live stack |
| `NODE_TLS_REJECT_UNAUTHORIZED` | — | `tests/ops/stack.test.ts` | Set to `0` there for Caddy's self-signed certificate |

Not environment variables in this build: `HOURLY_CACHE_MIN` (REQUIREMENTS §6) is the fixed 30-minute
reference-cache window in `apps/web/lib/hourly/reference.ts`; `HOURLY_UNRAR_BIN` is set in the web
image but not read (D-11: the server extracts with node-unrar-js).
