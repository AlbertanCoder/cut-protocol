# Agent 01 — new-user happy path over real HTTP

VERDICT: PARTIAL

Harness: `server.js` required in-process, `app.listen(0)`, real `fetch`, throwaway DB in temp. `BRAIN=off`, `ANTHROPIC_API_KEY=""`. Profile used: 34F/165cm/74→63kg/nurse — not the owner's.

## 1 (P0) Every /api route 500s on a DB built from the SHIPPED template

`backend/prisma/dev.db.template` is byte-identical (sha256 `042e4f70ceef…`) to the one inside `release/win-unpacked/resources/`. It holds 21 of the 24 migrations at HEAD and **140 duplicate `fdcId` groups** (e.g. `170160` × 8). HEAD's `ensureSchemaCurrent()` therefore tries `20260722045659_fdcid_unique_and_mode_flags`, whose last line is `CREATE UNIQUE INDEX "Food_fdcId_key" ON "Food"("fdcId")` — no de-dupe step anywhere in `prisma/migrations/`; the repair only ever existed as `backend/scripts/repairFoodProvenance.mjs`, which is excluded from the package (`!backend/scripts/**/*`).

Verbatim, step 1 of the happy path:

```
[desktopBootstrap] schema migration failed: UNIQUE constraint failed: Food.fdcId
STEP1 GET /api/auth/status -> 500 {"error":"Database schema update failed: schema migration failed: UNIQUE constraint failed: Food.fdcId … Your data was not modified."}
```

All 13 subsequent calls returned the same 500. The user never reaches the register screen.

Blast radius: (a) every existing v1.0.0 install upgrading to HEAD — their live DB descends from this template; (b) any build that skips `predist`. `package.json:16` `"release"` has **no `prerelease` hook**, so `npm run release` packages the stale template as-is. `scripts/distPrecheck.mjs` only checks presence/personal-data, never migratability.

The shipped 1.0.0 installer itself is self-consistent (asar carries 21 migrations) — this is a HEAD-vs-installed-base break, not a break in what's already out.

## 2 (works) Same path on a current template

Template rebuilt as `buildTemplateDb.mjs` does (0 users, 14,122 foods, 889 recipes):

| step | result |
|---|---|
| GET /auth/status | 200 `{"needsSetup":true}` |
| POST /auth/register | 201, cookie set; `/auth/me` 200 immediately; status flips `needsSetup:false` |
| PUT /profile | 200 |
| target | `targetKcal 1719`, floor 1377, `floored:false`, rmr 1449 / tdee 2219 — sane, floor-respecting |
| POST /plans/generate | 200, 374 ms, **28/28 slots filled**, matchPct 94–96, pool 889→812 |
| POST grocery-list | 200, 73–86 items, $116–152 CAD |
| GET /weighins/summary | 200, honest `confidence: insufficient / formula-only` |

## 3 (P2) Reload silently drops plan honesty + grocery cost

```
STEP6e RELOAD GET /api/plans/current -> 200 meta=ABSENT groceryList keys=id,planId,items,createdAt
       groceryList.totalEstimatedCostCad=undefined bySection=ABSENT
```

`meta` (matchPct, per-day `miss`, `diagnosis`) is response-only — the week's honest self-report exists for one render and is gone on reload. `GroceryList` (schema.prisma:333) has no cost column, so `totalEstimatedCostCad` / `costCoverageNote` vanish too. `PlanTab.jsx:646` does fall back for `bySection`, so only cost + diagnosis are lost.

## 4 (P2) Empty library returns a 200 plan of 28 empty slots, misdiagnosed

Migrations-only DB (0 recipes): `/plans/generate` → 200, `slots with a recipe: 0/28`, day 0 `0 kcal`. Grocery list → 200 with `items=0`. `meta.diagnosis` blames the user: *"Your dietary style + allergy rules exclude every recipe in the library"* while `poolCounts={"raw":0,…}` — raw 0 means the library is empty, which the M10 "true binding constraint" logic doesn't distinguish (`plans.js:140`).

## 5 (P3) `POST /api/profile` → 404 `{"error":"not found"}`

Only `PUT` exists (`profile.js:130`). The shipped client uses `putProfile`, so no user impact; noted because the task named POST.

No step required a field the client can't know. `GET /profile` before setup returns `200 null` (SetupWizard handles it).

Repro: `scratchpad/happypath.js migrations | template | file <db>`.
