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

   The mobile app (P7-T07) uses the same trust: on Android it accepts the installed CA certificate
   (its network security config trusts user CAs, clear text off); on iOS the profile must be
   enabled under Certificate Trust Settings. In the app, enter `https://<SITE_ADDRESS>` on the
   Server screen; it is checked with `/api/health` before it is saved.

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

## 8. Mobile app (EAS internal distribution)

The NOC phones get the app from EAS internal distribution (Q-10): an Android APK and an iOS ad-hoc
build from the `preview` profile, or TestFlight from the `testflight` profile. Nothing goes to the
public stores. The app only reaches the server on the NOC LAN, over HTTPS (D-06, P7-T07).

### One-time setup

1. Install the CLI on a workstation and sign in with the NOC Expo account:
   `npm install -g eas-cli`, then `eas login`.
2. In `apps/mobile`, link the project: `eas init`. It writes `expo.extra.eas.projectId` (and the
   owner) into `app.json`; commit that change.
3. Create an Expo access token (expo.dev → Account settings → Access tokens) and store it as the
   GitHub repository secret `EXPO_TOKEN`. Only the `eas-preview` workflow uses it; `ci.yml` has no
   secrets.
4. iOS ad-hoc builds install only on registered devices. Register each NOC iPhone before its
   first build: `eas device:create`, then open the link it prints on the iPhone and install the
   profile. `eas device:list` shows the registered devices.
5. iOS signing: the first iOS build asks for the Apple developer account and lets EAS create and
   keep the certificate and provisioning profile. Run that first build from the workstation
   (`eas build --profile preview --platform ios`) so the questions can be answered; later builds,
   including the workflow, reuse the stored credentials.

### Build

- **From GitHub:** run the `eas-preview` workflow (Actions → eas-preview → Run workflow), or push a
  `v*` tag. It runs `eas build --profile preview --platform all --non-interactive --no-wait`: the
  builds run on EAS and the job ends once they are queued.
- **From a workstation:** `eas build --profile preview --platform all` in `apps/mobile`.
- Follow the builds on expo.dev (project `noc-alarms` → Builds) or with `eas build:list`. Each
  finished build has an install page with a link and a QR code; send that link to the NOC phones.

After adding an iPhone with `eas device:create`, build iOS again: an ad-hoc build only installs on
the devices that were registered when it was built.

### Install on Android

1. Open the build's install link on the phone (or scan its QR code) and download the APK.
2. Allow the browser to install unknown apps when Android asks (Settings → Apps → the browser →
   Install unknown apps), then install.
3. Install the NOC root certificate once (step 8 of section 1, "TLS trust"): Settings → Security →
   Install a certificate → CA certificate.

### Install on iOS (ad-hoc)

1. Open the build's install link in Safari on a registered iPhone and tap Install.
2. iOS 16 and later: turn on Developer Mode (Settings → Privacy & Security → Developer Mode), let the
   phone restart and confirm. Ad-hoc builds do not open without it.
3. Install and enable the NOC root certificate once (section 1, "TLS trust"): install the profile,
   then Settings → General → About → Certificate Trust Settings → turn it on.

### iOS through TestFlight

For iPhones that should not be registered one by one:

1. `eas build --profile testflight --platform ios` (store signing; the build number goes up by one
   each time, so commit the `ios.buildNumber` change in `app.json`).
2. `eas submit --platform ios --latest` uploads it to App Store Connect. The first submit asks for the
   Apple ID and creates the app record.
3. In App Store Connect → TestFlight, add the NOC staff as internal testers. They install TestFlight
   and accept the invitation. Internal testers need no App Review.
4. The NOC root certificate is needed as for ad-hoc (step 3 above). Developer Mode is not.

### First start

1. On the **Server** screen, enter `https://<SITE_ADDRESS>`. The app checks `/api/health` before it
   saves the address. "Cannot reach" means the phone is not on the NOC Wi-Fi or does not trust the
   NOC root certificate.
2. Sign in with the user's e-mail and password (same lockout as the web). The app keeps an API token
   named `mobile` for that user. Signing out revokes it.

### Updates

- Raise `expo.version` in `app.json` for a release, then build again (workflow or `v*` tag). Phones
  install the new build from its install link over the old one. Data on the phone is kept: the
  server address, the session and the hourly reference data.
- A new iPhone needs `eas device:create` and a new iOS ad-hoc build, or a TestFlight invitation.
- A lost phone: revoke the user's `mobile` tokens on the Docker host (the web has no token list).
  Every phone of that user has to sign in again:
  ```bash
  docker compose exec db psql -U alarms -d alarms -c "UPDATE api_tokens SET \"revokedAt\" = now() WHERE name = 'mobile' AND \"revokedAt\" IS NULL AND \"userId\" = (SELECT id FROM users WHERE email = 'user@example.com')"
  ```
  Deleting the user (`DELETE /api/v1/users/{id}`, ADMIN) also removes all of the user's tokens.
