# Local Database

This project can run a dedicated local PostgreSQL database without Docker by using the PostgreSQL 16 binaries already installed on this machine.

The local dev database uses:

- Host: `127.0.0.1`
- Port: `55432`
- User: `budget_admin`
- Database: `budget_app`
- Data directory: `.local/postgres-data`

The `.local/` directory is ignored by Git. It is only for local development data.

## Start PostgreSQL

Open one terminal:

```powershell
npm.cmd run db:local:start
```

Keep that terminal open while developing.

## Create, Migrate, And Seed

Open a second terminal:

```powershell
npm.cmd run db:local:setup
```

This command creates `budget_app` if needed, applies Prisma migrations, seeds the prototype demo data, and prints table counts.

## Run The App

With the database terminal still open:

```powershell
npm.cmd run dev
```

## Stop PostgreSQL

Press `Ctrl+C` in the terminal running `db:local:start`.

## Production Note

This native local database is for development. On the server, use PostgreSQL with a proper persistent volume and a strong password.
