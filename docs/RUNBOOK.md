# Runbook

Operations guide for the production stack in `docker-compose.yml`. Run every command from the
repository folder on the Docker host. Services: `db`, `migrate` (one-shot), `worker`, `web`, `proxy`
(Caddy, ports 80/443) and `backup`.

## 1. First deployment

Target: under 1 hour on a clean host.

1. **Host.** Use Linux with Docker Engine 24+ and the Compose plugin. Ports 80 and 443 must be
   reachable from the NOC LAN, and nothing else needs to be.
2. **Code.** `git clone <repository> alarm-platform && cd alarm-platform`
3. **Gmail OAuth client.** In Google Cloud:
   - Create a project and enable the Gmail API.
   - Set up an OAuth consent screen.
   - Create an OAuth client of type *Desktop app*.
   - Download it as `secrets/credentials.json` (`mkdir -p secrets`).
4. **Gmail token.** Do this once, on a machine with a browser (a laptop with Node 20 and pnpm is
   fine):
   ```bash
   pnpm install
   pnpm gmail:auth
   ```
   - Open the printed URL and sign in with the NOC mailbox. Grant read-only access
     (`gmail.readonly`).
   - The browser returns to a local page, or you paste the code back.
   - `secrets/token.json` is written. Copy it to the host's `secrets/`.
   - Both files are git-ignored, mounted read-only (NFR-21) and must never be committed.
5. **Configuration.** Run `cp .env.example .env`, then set:

   | Variable | Value |
   | --- | --- |
   | `POSTGRES_PASSWORD` | a long random password |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 48` (the web app refuses to start without it) |
   | `SITE_ADDRESS` | the host name or IP the NOC devices use, e.g. `noc-alarms.lan` or `10.0.0.20` |
   | `NEXTAUTH_URL` | `https://<SITE_ADDRESS>` |
   | `GMAIL_LABELS` | the default office label, e.g. `DN/Kafr ElDawar` |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the first ADMIN (created once, password ≥ 8 characters) |

   Leave `HOURLY_GMAIL_MOCK_DIR`, `DATABASE_URL` and `TEST_DATABASE_URL` as they are. Compose
   builds its own database URL.
6. **Start.** Run `mkdir -p backups && docker compose up -d --build`. The first build takes 5–10
   minutes. `migrate` applies the migrations and seeds the 13 rules and the ADMIN.
7. **Check.** Run `docker compose ps`:
   - `db`, `worker`, `web`, `proxy` and `backup` are up, and `web` and `worker` show *healthy*
     after about a minute.
   - `migrate` shows *exited (0)*.
   - `curl -k https://<SITE_ADDRESS>/api/health` returns 200.
   - On a slow disk the first database initialisation can outlast the `db` healthcheck, and
     `up` reports *dependency db failed to start*. Wait until `docker compose ps` shows `db`
     *healthy*, then run `docker compose up -d` again.
8. **TLS trust (D-06).** Copy Caddy's root certificate out of the proxy and install it once on
   every NOC device:
   ```bash
   docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
   ```
   - Windows: double-click → Install Certificate → Local Machine → *Trusted Root Certification
     Authorities*.
   - macOS: Keychain Access → System → import, then *Always Trust*.
   - Android: Settings → Security → Install a certificate → CA certificate.
   - iOS: AirDrop or e-mail the file → install the profile → Settings → General → About →
     Certificate Trust Settings → enable it.

   The certificate lives in the `caddy-data` volume. Keep that volume, or every device has to
   trust a new CA.
9. **First sign-in.** Open `https://<SITE_ADDRESS>` and sign in as the ADMIN. In **Settings**:
   - Choose the office. The list fills after the worker's first label refresh.
   - Under **Settings → Site Master**, import the Site Master workbook.
10. **Optional live check.** Run `OPS_BASE_URL=https://<SITE_ADDRESS> pnpm ops:test` from a
    machine with the repository and Node.

## 2. Upgrade

```bash
git pull
docker compose up -d --build
```

`migrate` runs again before `web` and `worker` start, so new migrations are applied first. Check
`docker compose ps` and `/api/health` afterwards. To roll back, check out the previous tag
(`git checkout v1.0.0`), then run `docker compose up -d --build`. If the newer release added a
migration, restore the backup taken before the upgrade (§4).

## 3. Migrations

- Migrations live in `packages/db/prisma/migrations` and are applied by the `migrate` service on
  every `up`.
- Run them by hand with `docker compose run --rm migrate`.
- Show the state with `docker compose run --rm migrate sh -c "pnpm exec prisma migrate status"`.
- The seed is idempotent: rules are added only when the table is empty, and the ADMIN is never
  overwritten (NFR-31).

## 4. Backup and restore (D-07)

- **Schedule:** the `backup` service writes `backups/alarms-<UTC time>.dump` (`pg_dump -Fc`) when
  it starts and then every 24 hours. Dumps older than 14 days are deleted.
- **Off-host copies** are not part of the deployment (Q-04).
- **Backup now:** `docker compose exec backup backup.sh once`
- **List backups:** `ls -lh backups/`
- **Restore:**
  ```bash
  scripts/restore.sh backups/alarms-20261017T020000Z.dump
  ```
  The script asks you to type `restore`. It then stops `web` and `worker`, replaces every table
  with the dump in one transaction (`pg_restore --clean --if-exists --single-transaction`), and
  starts `web` and `worker` again. Use `--yes` to skip the question.
- **Check:** `docker compose exec db psql -U alarms -d alarms -c "SELECT count(*) FROM alarms"`
  matches the count at backup time.
- **Restore on a new host:** deploy (§1), stop `worker`, run `scripts/restore.sh <file>`, then
  `docker compose up -d`.

## 5. Gmail token refresh

The worker refreshes the access token on its own. A new `token.json` is needed only when Google
revokes the refresh token, for example after a password change, after the access is removed in
the Google account, or after 7 days if the consent screen is in *Testing* mode. When that
happens:

- The worker's `lastError`, shown in the dashboard sync bar and in `curl -k https://<SITE_ADDRESS>/api/health`,
  shows `invalid_grant`.
- `/health` stays 200 on Gmail errors (NFR-15), so the container is not restarted.

To fix it:

1. On a machine with a browser, run `pnpm gmail:auth` (§1 step 4). It writes a new
   `secrets/token.json`.
2. Copy the file to the host's `secrets/token.json`.
3. Run `docker compose restart worker web`.
4. The next cycle (≤ 1 minute) clears `lastError`.

## 6. Reprocess

Reprocessing rebuilds alarms from the stored `raw_messages` for the last *N* days (1–90, default 7,
FR-24). It is idempotent.

- **UI:** sign in as ADMIN → **Settings → Reprocess** → choose the days → *Reprocess*.
- **API:** `POST /api/v1/reprocess` with `{"days": 7}` (ADMIN session).
- The worker runs it on its next cycle, inside the advisory lock, with a 30-minute timeout.
  Progress shows in `docker compose logs -f worker`.

## 7. Day-to-day

| Task | Command |
| --- | --- |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f worker` (one summary line per cycle, NFR-35), `docker compose logs -f web` |
| Worker health | `docker compose exec worker wget -qO- http://127.0.0.1:4000/health` |
| Web health | `curl -k https://<SITE_ADDRESS>/api/health` |
| Restart one service | `docker compose restart web` |
| Stop everything (data kept) | `docker compose down` (never add `-v`: it deletes `pgdata` and the Caddy CA) |
