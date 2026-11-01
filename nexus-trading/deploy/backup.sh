#!/bin/sh
# Daily compressed pg_dump with retention. Restore:
#   gunzip -c backups/nexus-YYYYmmdd-HHMM.sql.gz | docker compose exec -T db psql -U nexus -d nexus
set -eu
while true; do
  f="/backups/nexus-$(date -u +%Y%m%d-%H%M).sql.gz"
  if pg_dump -h db -U nexus -d nexus | gzip > "$f.tmp"; then
    mv "$f.tmp" "$f"; echo "backup ok: $f"
  else
    rm -f "$f.tmp"; echo "backup FAILED" >&2
  fi
  find /backups -name 'nexus-*.sql.gz' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  sleep 86400
done
