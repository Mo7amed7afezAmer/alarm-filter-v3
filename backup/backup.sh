#!/bin/sh
# D-07: daily pg_dump -Fc into /backups (./backups on the host); dumps older than
# BACKUP_KEEP_DAYS (14) days are deleted. `backup.sh once` makes one backup and exits.
# Connection from PGHOST / PGUSER / PGPASSWORD / PGDATABASE.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

backup() {
  file="/backups/alarms-$(date -u +%Y%m%dT%H%M%SZ).dump"
  pg_dump -Fc -f "$file.part"
  mv "$file.part" "$file"
  # -mtime +N matches files older than N+1 whole days.
  find /backups -maxdepth 1 -name 'alarms-*.dump' -mtime +"$((KEEP_DAYS - 1))" -delete
  echo "backup: wrote $file"
}

if [ "${1:-}" = "once" ]; then
  backup
  exit 0
fi

while true; do
  backup || echo "backup: failed" >&2
  sleep 86400
done
