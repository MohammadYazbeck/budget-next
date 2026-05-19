#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: sh scripts/restore-postgres.sh path/to/backup.dump" >&2
  exit 1
fi

backup_file="$1"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [ ! -f "$backup_file" ]; then
  echo "Backup file not found: $backup_file" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
. "./$ENV_FILE"
set +a

POSTGRES_USER="${POSTGRES_USER:-budget_admin}"
POSTGRES_DB="${POSTGRES_DB:-budget_app}"

echo "Restoring $backup_file into $POSTGRES_DB. This replaces matching database objects." >&2

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$backup_file"
