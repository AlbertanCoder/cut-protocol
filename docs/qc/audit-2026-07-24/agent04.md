# Agent 04 — upgrade path on REAL old databases

**VERDICT: schema-model-1 fix CONFIRMED — zero rows lost on real old DBs, and the pre-fix loss reproduced independently at 44 real rows (worse than the reported 3). But the upgrade still FAILS on every real old DB: a NEW P0, duplicate `Food.fdcId`, halts migration at 22/24 and 500s every `/api` request.**

Copies only; live paths never opened for write.

## F1 (P0, NEW) — upgrade dies on `20260722045659_fdcid_unique_and_mode_flags`
`CREATE UNIQUE INDEX "Food_fdcId_key"` → `UNIQUE constraint failed: Food.fdcId`.
Real live installed DB (`AppData/Roaming/Cut Protocol/cutprotocol.db`, 13/24 applied) has **194 duplicate fdcId groups / 409 excess rows** (939 of 973 foods carry an fdcId). Repro'd identically on `dev.db.backup-phase3-premigration` (11/24). Current `dev.db` has 0 dups, which is why `prisma migrate dev` passed and nobody saw it.
Consequence: runner rejects → `server.js:38-44` fails every `/api` request with "Database schema update failed". App bricked on upgrade. Nulling the 409 dup fdcIds on a copy → all 24 migrations apply, 0 loss, integrity ok.

## F2 — cascade-deletion P0 independently reproduced, and the fix holds
Forced replay of `20260717183855` (DROP User/Recipe) on `dev.db.backup-preIntegration` (real rows):
| | pre-fix runner (`ca56345`) | current runner |
|---|---|---|
| MealLog | 39 → **0** | 39 → 39 |
| LlmUsage | 12 → **8** | 12 → 12 |
| CartItem | 1 → **0** | 1 → 1 |
Pre-fix: silent, exit 0, `_prisma_migrations` recorded success. Fixed runner: 0 loss, `foreign_key_check` clean.

## F3 — census, real installed DB 13 → 24 migrations (current runner)
CartItem 0→0 · Food 973→973 · GroceryList 1→1 · Plan 2→2 · PlanSlot 63→63 · Profile 1→1 · Recipe 634→634 · RecipeIngredient 6224→6224 · TrainingExercise 72→72 · TrainingPlan 1→1 · TrainingSession 12→12 · TrainingWeek 4→4 · User 1→1 · Weighin 0→0. **Zero loss. `foreign_key_check` 0 rows, `integrity_check` ok.**

## F4 — durability (all pass)
- Backup: written pre-first-statement, **byte-identical** to source (sha match), restores to exact census, opens clean.
- SIGKILL at 16 delays (1–70 ms): 3 landed mid-run (15/19/20 applied). No stray `new_*` tables, no migrated-but-unrecorded rows, integrity ok, no loss; resume completed the rest. Leaves a hot `-journal` SQLite recovers on open.
- No `_prisma_migrations`: refuses, file byte-identical, writes `.migrate-error.log`.
- Already-current DB: true no-op, no backup spam.

## F5 (LOW) — "10 cascade children" is overstated
9 of the 10 cascade tables are created by migrations *later* than the only User/Recipe drop, so on a genuine pre-2026-07-17 install only **CartItem** was ever at risk. F2's larger loss required forcing a replay. No surviving backup predates that migration.
