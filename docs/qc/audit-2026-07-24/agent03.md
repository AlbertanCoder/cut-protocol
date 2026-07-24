# Agent 03 — Packaged-build bootability

**VERDICT: A fresh install would likely boot. An UPGRADE over any existing install is DEAD — every `/api` call returns 500. The `effect` bug is off the boot path but its root cause is unfixed. `node:sqlite` is NOT a risk (proven).**

No build was run. Static config analysis + the existing `release/` (2026-07-21) + live Electron 43 runtime probes.

## 1. P0 — first-boot migration fails on every upgrading install (reproduced)

Copied the shipped `backend/prisma/dev.db.template` and ran the real `ensureSchemaCurrent()` under `node_modules/electron/dist/electron.exe`:

```
[desktopBootstrap] Applying 3 schema migration(s); backup at ...
[desktopBootstrap] applied 20260721201641_food_scale_micros_provenance (8 statements)
UPGRADE FAILED: schema migration failed: UNIQUE constraint failed: Food.fdcId
```

`20260722045659_fdcid_unique_and_mode_flags` creates a UNIQUE index on `Food.fdcId` with **no dedup step**; the shipped library has **140 duplicate fdcId groups** (worst: fdcId 170160 ×8). The runner rolls back correctly, but `backend/server.js:38-45` gates all `/api` on `schemaReady` — the window opens, every request 500s. Fresh installs escape only if `backend/prisma/dev.db` is already deduped when `predist` regenerates the template (**UNVERIFIED** — rule 4, dev.db not opened).

## 2. P1 — the `effect` root cause is latent, not fixed

No `spawn`/`execFile` of Prisma remains (`electron/`, `backend/src/`), so `@prisma/config` is never loaded at boot — the 2026-07-19 failure mode is dead code. But `asarUnpack` is unchanged: `@prisma/**` unpacks while `effect` (+`c12`, `deepmerge-ts`, `empathic`) stay inside `app.asar` (all four verified present in the Jul-21 asar, 142 backend modules). Any future require of `@prisma/config` from the unpacked tree fails identically.

## 3. CLEARED — `node:sqlite` on Electron 43

Real Electron main process: `{"node":"24.18.0","electron":"43.1.1"}`, `DatabaseSync` works flag-free, `pragma_foreign_keys`=1 default. Not a blocker.

## 4. Gates

`predist` = buildTemplateDb + `distPrecheck.mjs` (blocks secrets/personal rows/`.env`/`dev.db` in config). `dist:check` = `checkDistSafe.mjs`, post-build scan of `release/`. The Jul-21 asar contains **no** `.env`, **no** `dev.db` — CLAUDE.md's "deliberately ships the real .env and dev.db" is **stale**; config already excludes both. Neither gate checks bootability or migration applicability.
