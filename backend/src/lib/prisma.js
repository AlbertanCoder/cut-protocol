const { PrismaClient } = require("@prisma/client");

// Reuse a single client across nodemon/hot-reload restarts in dev.
const globalForPrisma = globalThis;
const prisma = globalForPrisma.__prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;

// ── Write-ahead logging ──────────────────────────────────────────────────
// This database shipped in SQLite's default `journal_mode=delete`, where a
// writer takes an EXCLUSIVE lock on the whole file and every reader blocks
// behind it (and vice versa). That is the wrong mode for this app's actual
// shape: boot runs a ~1 s full-library data audit, the Foods tab issues a
// multi-hundred-ms read of the whole Food table, and both compete with
// ordinary writes against a 5 s busy timeout. Under `delete`, one of them
// waits; under WAL, readers and the single writer proceed concurrently.
// Measured on a copy of dev.db, the 889-recipe ingredient fetch: 33.1 ms in
// delete mode vs 7.8 ms in WAL, uncontended — the concurrency win is on top.
//
// WHY IT IS SET HERE AND NOT IN A MIGRATION: `PRAGMA journal_mode=WAL` is one
// of the few statements SQLite refuses to honour inside a transaction, and the
// in-process migration runner (src/lib/desktopBootstrap.js) wraps every
// migration in BEGIN/COMMIT. Put it in a .sql migration and it silently does
// nothing — the same class of no-op that made the FK-enforcement bug a P0.
//
// WHY FIRE-AND-FORGET IS SAFE: journal_mode is a property of the DATABASE FILE
// (bytes 18/19 of the header), not of a connection. It has to be set exactly
// once, ever; every later call is a no-op that just reads back "wal". So there
// is no ordering requirement against the first query — if a query happens to
// win the race, it runs in the old mode and everything from the next one on is
// WAL. Nothing waits on this. Verified: the promise resolves in <0.5 s and
// leaves no handle that would keep a process (or a test run) alive.
//
// Failure is non-fatal on purpose. WAL requires shared memory and cannot be
// enabled on a network share or some restricted filesystems; SQLite reports
// that by returning the UNCHANGED mode rather than raising. Either way the app
// keeps working in `delete` mode — degraded, not broken — so this must never
// throw into boot. `walReady` is exported so a test can await the outcome
// instead of racing it; nothing in the app needs to.
//
// PACKAGING NOTE for whoever owns desktopBootstrap.js: WAL creates `-wal` and
// `-shm` sidecars next to the DB. They are removed on a clean close, so a
// normally-shut-down app leaves a single self-contained file and the existing
// first-run `copyFileSync(template, dbPath)` stays correct. The migration
// runner's own backup path is already WAL-aware (it checkpoints TRUNCATE first
// and copies both sidecars). The two places that are NOT yet: the RESTORE
// instruction in its error message ("copy this file back over <dbPath>"), which
// under WAL must also remove any stale `<dbPath>-wal`/`-shm` or SQLite will
// replay them over the restored file; and scripts/buildTemplateDb.mjs, which
// copies dev.db with a plain copyFileSync and would miss a hot WAL if the dev
// server were running. Both are outside this file.
const walReady = prisma
  .$queryRawUnsafe("PRAGMA journal_mode=WAL")
  .then((rows) => rows?.[0]?.journal_mode ?? null)
  .catch((e) => {
    console.warn(`[prisma] could not enable WAL journal mode (continuing in the existing mode): ${e.message}`);
    return null;
  });

module.exports = { prisma, walReady };
