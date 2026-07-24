# Agent 02 handoff — Wave 1, finding `schema-model-1` (P0)

Scope: migration runner FK no-op. Owned files only:
`backend/src/lib/desktopBootstrap.js`, `backend/tests/migrationRunner.test.js` (new),
`backend/tests/bootstrapResilience.test.js` (unchanged in the end).
No migration was added — `backend/prisma/migrations/**` untouched.

## Verdict: finding was OPEN. Now closed.

| # | Property | As found | Proof |
|---|---|---|---|
| a | single dedicated connection | **PARTIAL** | DDL ran inside `prisma.$transaction` (one connection), but the bookkeeping INSERT at `desktopBootstrap.js:213` ran on a *pooled* connection outside it. |
| b | `PRAGMA foreign_keys=OFF` outside the transaction | **OPEN** | The pragma only ever existed *inside* the migration files, executed inside the txn. Measured through the real Prisma path: inside `$transaction`, after `PRAGMA foreign_keys=OFF`, `pragma_foreign_keys` still reads **1**. |
| c | `foreign_key_check` before commit | **OPEN** | String absent from the entire repo. |
| d | bookkeeping inside the DDL transaction | **OPEN** | `desktopBootstrap.js:210-216` — `$transaction` closed, *then* the INSERT. |

Real-data impact (measured, not argued): replaying the pre-fix algorithm over a
Prisma `RedefineTables` block with a cascade parent went `Doc rows: 3 → 0` and
**committed with no error**. Shipped migrations `DROP TABLE "User"` and
`DROP TABLE "Recipe"`; the schema has 10 `onDelete: Cascade` relations
(MealLog, BrainConversation, LlmUsage, CartItem, RecipeRating, training tree…).

## Requests for the orchestrator (files I do not own)

1. **`backend/scripts/runTests.mjs` — raise the tripwire floors.**
   `MIN_TEST_FILES = 62` was measured before this wave; my new file makes 63,
   and other agents are adding more. The floor is a *minimum* so nothing fails
   today, but the file's own comment says to raise it deliberately. Please
   re-measure and bump `MIN_TEST_FILES` / `MIN_TESTS` once the fleet has landed.
   My file adds **9** tests.

2. **`node:sqlite` prints an `ExperimentalWarning` on stderr** the first time
   the migration path loads it. It is `require`d lazily, so it only appears on a
   packaged boot that actually has pending migrations — never in dev, never on
   an already-current boot. If that line in the log bothers anyone, the only
   clean suppression is a runtime flag from `electron/main.cjs`
   (`process.noDeprecation` does not cover it). I judged the noise acceptable
   versus adding `better-sqlite3` as a native dependency that would then need
   electron-rebuild + asar unpacking. Flagging, not requesting.

3. **Invariant to preserve in `backend/server.js` / `electron/main.cjs`:**
   `ensureSchemaCurrent()` now opens its own SQLite write connection and no
   longer touches `src/lib/prisma.js`. Today this is safe because `PrismaClient`
   connects lazily and every `/api` request awaits `schemaReady`. If anyone ever
   makes a route file or a lib run a Prisma query at module-load time, it would
   race the migration for the write lock. Worth a comment if that pattern shows
   up.

## Verified in the real runtime

Electron **43.1.1 / Node 24.18.0 main process** (where `backend/server.js` is
required in-process per `electron/main.cjs:238`): `require("node:sqlite")`
loads and `PRAGMA foreign_keys=OFF` outside a transaction reads back `0`.
So the fix works on the shipping runtime, not just on the dev Node.
