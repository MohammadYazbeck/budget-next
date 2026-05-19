# Production Deployment

This project is ready to run as a Docker deployment behind the server's existing Traefik proxy with:

- `web`: Next.js production server
- `db`: PostgreSQL 17
- persistent PostgreSQL Docker volume
- backup folder
- automatic Prisma migration on app startup
- DB-aware `/api/health`
- Traefik TLS routing for `eco.ozmo.media`
- static username/password protection inside the Next.js app

The app does not include database users or a session system. Public access is protected by app-level HTTP Basic Auth using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env.production`.

## Files

- `Dockerfile`: production app image
- `docker/entrypoint.sh`: applies Prisma migrations, then starts Next.js
- `docker-compose.prod.yml`: production app + database stack
- `.env.production.example`: production environment template
- `scripts/backup-postgres.sh`: creates PostgreSQL dump backups
- `scripts/restore-postgres.sh`: restores a dump backup

## Server Prerequisites

On the server:

- Docker Engine
- Docker Compose plugin
- an existing external Docker network named `web`
- a deployment folder, for example `/srv/projects/budget-next`
- a backup folder, for example `/srv/budget-next/backups`
- DNS record for `eco.ozmo.media` pointing to the server

## First Deploy

Copy or clone the project to the server, then create production env:

```sh
cp .env.production.example .env.production
```

Edit `.env.production`:

```env
POSTGRES_USER=budget_admin
POSTGRES_PASSWORD=replace_with_a_long_random_password
POSTGRES_DB=budget_app
DATABASE_URL=postgresql://budget_admin:replace_with_a_long_random_password@db:5432/budget_app?schema=public
APP_TIME_ZONE=Asia/Damascus
APP_DOMAIN=eco.ozmo.media
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace_with_a_strong_static_password
BACKUP_DIR=/srv/budget-next/backups
RUN_DB_MIGRATIONS=true
```

If the database password contains special characters, URL-encode it inside `DATABASE_URL`.

Create the backup folder:

```sh
sudo mkdir -p /srv/budget-next/backups
sudo chown -R "$USER:$USER" /srv/budget-next
```

PostgreSQL data is stored in the Docker named volume `budget-next-db-data`.

## Static Login

Set the static login credentials directly in `.env.production`:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose_a_strong_password
```

In production, the app returns `503` if these credentials are missing. Local development does not require them unless you set them in `.env`.

Start:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Check:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl https://eco.ozmo.media/api/health
```

Open:

```txt
https://eco.ozmo.media
```

## Update Deploy

After pulling or copying new code:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

The app container runs `prisma migrate deploy` before starting.

## Backups

Create a backup:

```sh
sh scripts/backup-postgres.sh
```

Restore a backup:

```sh
sh scripts/restore-postgres.sh /srv/budget-next/backups/budget_app_YYYYMMDDTHHMMSSZ.dump
```

Recommended minimum schedule:

```cron
15 2 * * * cd /srv/projects/budget-next && sh scripts/backup-postgres.sh >> /srv/budget-next/backups/backup.log 2>&1
```

Keep backup copies outside the server as well. A local server backup is not enough if the disk fails.

## Traefik Routing

The production compose follows the existing server pattern:

- joins the external Docker network `web`
- routes `Host(eco.ozmo.media)`
- uses the `websecure` entrypoint
- uses the `lets` certificate resolver
- forwards to app port `3000`

If the server uses different Traefik entrypoint or certificate resolver names, update the labels in `docker-compose.prod.yml`.
