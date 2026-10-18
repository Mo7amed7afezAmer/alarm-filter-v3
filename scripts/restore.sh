#!/bin/sh
# D-07: restore one backup made by the backup service into the running db container.
# Usage: scripts/restore.sh [--yes] backups/alarms-YYYYMMDDTHHMMSSZ.dump
# Stops web and worker, replaces the database contents with the dump (pg_restore --clean, one
# transaction), then starts web and worker again. Run from any directory on the Docker host.
set -eu

yes=0
if [ "${1:-}" = "--yes" ]; then
  yes=1
  shift
fi
dump="${1:-}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "usage: scripts/restore.sh [--yes] <backup file>" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
user="${POSTGRES_USER:-$(sed -n 's/^POSTGRES_USER=//p' .env 2>/dev/null)}"
db="${POSTGRES_DB:-$(sed -n 's/^POSTGRES_DB=//p' .env 2>/dev/null)}"
user="${user:-alarms}"
db="${db:-alarms}"

if [ "$yes" -ne 1 ]; then
  printf 'This replaces every table in database "%s" with %s. Type "restore" to continue: ' "$db" "$dump"
  read -r answer
  [ "$answer" = "restore" ] || { echo "aborted"; exit 1; }
fi

docker compose stop web worker
docker compose cp "$dump" db:/tmp/restore.dump
status=0
docker compose exec -T db pg_restore -U "$user" -d "$db" --clean --if-exists --no-owner --single-transaction /tmp/restore.dump || status=$?
docker compose exec -T db rm -f /tmp/restore.dump
docker compose start web worker
[ "$status" -eq 0 ] && echo "restore: done" || echo "restore: pg_restore failed ($status)" >&2
exit "$status"
