# Deploying Phase A to Railway

Account creation and billing are yours to do — here's the exact runbook.

## 1. Switch the database from SQLite (dev) to Postgres (prod)

The Prisma **models** are portable, but the generated migration SQL is
provider-specific, so this isn't a pure one-line change — it's a few
commands:

```
cd backend
```

Edit `prisma/schema.prisma`, change:
```
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```
to:
```
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then regenerate migrations against Postgres (do this once you have a
Postgres `DATABASE_URL` from step 3 below — point `backend/.env` at it
temporarily):
```
rm -rf prisma/migrations
npx prisma migrate dev --name init
```
Commit the new `prisma/migrations/` folder — that's what `migrate deploy`
runs in the Docker container on every deploy.

## 2. Create the Railway project

1. Sign up at https://railway.app (GitHub login is easiest).
2. New Project → Deploy from GitHub repo → point it at this repo (push it
   to GitHub first if it isn't already — `git init` / `git remote add` / `git push`).
3. Railway will detect `Dockerfile` + `railway.json` automatically.

## 3. Add a Postgres database

In the Railway project: New → Database → Add PostgreSQL. Railway
auto-injects a `DATABASE_URL` env var into your service — copy that value
locally for step 1's migration regen, then let Railway keep managing it
in production (don't hardcode it anywhere).

## 4. Set environment variables on the Railway service

In the service's Variables tab, set (values from `backend/.env` — pick a
**new** random `JWT_SECRET` for production, don't reuse the dev one):

```
JWT_SECRET=<generate fresh: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
NODE_ENV=production
```

(`DATABASE_URL` is already set by the Postgres addon; `PORT` is set by
Railway automatically — don't override it.)

## 5. Deploy

Push to the connected branch — Railway builds the Dockerfile and runs
`prisma migrate deploy && node server.js` automatically per `railway.json`.

## 6. Seed your login

Railway gives you a shell into the running container (or use `railway run`
locally against the production `DATABASE_URL`):
```
SEED_EMAIL=you@example.com SEED_PASSWORD=your-real-password npm run seed
```

## 7. Get a domain

Railway → Settings → Networking → Generate Domain. That URL is what you
open on your phone.
