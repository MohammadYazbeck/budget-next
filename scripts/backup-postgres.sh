#!/bin/sh
set -eu

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
. "./$ENV_FILE"
set +a

BACKUP_DIR="${BACKUP_DIR:-./deploy-data/backups}"
POSTGRES_USER="${POSTGRES_USER:-budget_admin}"
POSTGRES_DB="${POSTGRES_DB:-budget_app}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/budget_app_$timestamp.dump"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$backup_file"

echo "$backup_file"
