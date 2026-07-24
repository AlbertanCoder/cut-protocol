// Migration-runner safety tests — fleet finding schema-model-1 (P0).
//
// The runner in src/lib/desktopBootstrap.js is the only thing standing between
// an app update and the user's real database. Its four load-bearing properties
// are asserted here, each with a test that FAILS against the pre-fix runner:
//
//   (a) everything happens on ONE dedicated connection (PRAGMAs are
//       per-connection; a pool can hand the transaction a different one)
//   (b) `PRAGMA foreign_keys=OFF` is issued OUTSIDE the transaction — SQLite
//       silently ignores it inside one
//   (c) `PRAGMA foreign_key_check` runs after the DDL and BEFORE the commit,
//       and any row aborts the migration
//   (d) the `_prisma_migrations` row is written INSIDE the DDL transaction, so
//       a crash can never leave the DB migrated-but-unrecorded
//
// Every test builds its own throwaway .db under the OS temp dir. Nothing here
// opens backend/prisma/dev.db.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  ensureSchemaCurrent,
  splitSqlStatements,
  DEFAULT_MIGRATIONS_DIR,
} = require("../src/lib/desktopBootstrap.js");

// ── harness ──────────────────────────────────────────────────────────────

// Prisma's own bookkeeping table, verbatim shape.
const PRISMA_MIGRATIONS_DDL = `
CREATE TABLE "_prisma_migrations" (
  "id"                  TEXT PRIMARY KEY NOT NULL,
  "checksum"            TEXT NOT NULL,
  "finished_at"         DATETIME,
  "migration_name"      TEXT NOT NULL,
  "logs"                TEXT,
  "rolled_back_at"      DATETIME,
  "started_at"          DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
);`;

// A parent with cascading children — the exact shape that made this a P0.
// The real schema has 10 `onDelete: Cascade` relations and shipped migrations
// that DROP TABLE "User" and DROP TABLE "Recipe".
const SEED_DDL = `
CREATE TABLE "Owner" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "Doc" (
  "id"      TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  CONSTRAINT "Doc_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE
);
INSERT INTO "Owner" ("id") VALUES ('o1'), ('o2');
INSERT INTO "Doc" ("id","ownerId") VALUES ('d1','o1'), ('d2','o1'), ('d3','o2');`;

function makeSandbox(t, { seed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-migrate-"));
  const dbPath = path.join(dir, "cutprotocol.db");
  const migrationsDir = path.join(dir, "migrations");
  fs.mkdirSync(migrationsDir);

  const db = new DatabaseSync(dbPath);
  db.exec(PRISMA_MIGRATIONS_DDL);
  if (seed) {
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(SEED_DDL);
  }
  db.close();

  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ } });
  return { dir, dbPath, migrationsDir };
}

function addMigration(migrationsDir, name, sql) {
  fs.mkdirSync(path.join(migrationsDir, name));
  fs.writeFileSync(path.join(migrationsDir, name, "migration.sql"), sql);
}

// Read-only probe of a database file; always closes.
function inspect(dbPath, fn) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}

const rows = (db, sql) => db.prepare(sql).all();
const one = (db, sql) => db.prepare(sql).get();
const tableExists = (db, name) =>
  one(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='${name}'`).n === 1;
const columnNames = (db, table) => rows(db, `PRAGMA table_info("${table}")`).map((c) => c.name);
const backupsIn = (dir) => fs.readdirSync(dir).filter((f) => f.includes(".backup-pre-migrate-"));

async function expectRejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  assert.fail("expected ensureSchemaCurrent to reject, but it resolved");
}

// A Prisma-shaped table rebuild: this is what `RedefineTables` emits, pragmas
// and all. The two `PRAGMA foreign_keys` lines are dead weight inside a
// transaction — the runner has to make them real from outside.
const REDEFINE_OWNER_SQL = `-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Owner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT
);
INSERT INTO "new_Owner" ("id") SELECT "id" FROM "Owner";
DROP TABLE "Owner";
ALTER TABLE "new_Owner" RENAME TO "Owner";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
`;

// ── (c) foreign_key_check gate ───────────────────────────────────────────

test("a migration that would orphan a FK row is REJECTED and the DB is left at the pre-migration state", async (t) => {
  const { dir, dbPath, migrationsDir } = makeSandbox(t);
  // With enforcement off (as it must be for table rebuilds), this DELETE is
  // accepted silently and strands d1/d2 pointing at a vanished owner.
  addMigration(migrationsDir, "20260101000000_orphans_rows", `-- AlterTable
DELETE FROM "Owner" WHERE "id" = 'o1';
`);

  const err = await expectRejection(ensureSchemaCurrent({ dbPath, migrationsDir }));
  assert.match(err.message, /orphaned foreign-key row/, `error names the FK audit: ${err.message}`);
  assert.match(err.message, /Doc/, "error names the offending table");
  assert.match(err.message, /backup-pre-migrate-/, "error says where the backup is");

  inspect(dbPath, (db) => {
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM "Owner"`).n, 2, "the deleted owner is back — the transaction rolled back");
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM "Doc"`).n, 3, "no document was lost");
    assert.equal(rows(db, "PRAGMA foreign_key_check").length, 0, "the DB has no dangling references");
    assert.equal(rows(db, `SELECT * FROM "_prisma_migrations"`).length, 0, "a rejected migration is NOT recorded");
  });

  // The failure is legible on disk, not just in a promise nobody awaited.
  const log = path.join(dir, "cutprotocol.db.migrate-error.log");
  assert.ok(fs.existsSync(log), "a .migrate-error.log was written next to the DB");
  assert.match(fs.readFileSync(log, "utf8"), /orphaned foreign-key row/);

  // ...and the backup is a real pre-migration snapshot, not an empty file.
  const backups = backupsIn(dir);
  assert.equal(backups.length, 1, "exactly one backup was taken");
  inspect(path.join(dir, backups[0]), (db) => {
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM "Owner"`).n, 2);
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM "Doc"`).n, 3);
  });
});

// ── (d) bookkeeping is inside the DDL transaction ────────────────────────

test("a crash between the DDL and the bookkeeping row leaves NO partial state", async (t) => {
  const { dir, dbPath, migrationsDir } = makeSandbox(t);

  // Force the bookkeeping INSERT — and only that — to blow up, which is
  // exactly the window a crash would land in. If the DDL were committed
  // separately (the pre-fix ordering), "Widget" would survive as an
  // unrecorded schema change and the next boot would replay the migration
  // onto an already-migrated database.
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TRIGGER "simulate_crash" BEFORE INSERT ON "_prisma_migrations"
BEGIN SELECT RAISE(ABORT, 'simulated crash between DDL and bookkeeping'); END;`);
  db.close();

  addMigration(migrationsDir, "20260101000000_add_widget", `-- CreateTable
CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);
`);

  const err = await expectRejection(ensureSchemaCurrent({ dbPath, migrationsDir }));
  assert.match(err.message, /simulated crash/, `the real cause is surfaced, not swallowed: ${err.message}`);

  inspect(dbPath, (db2) => {
    assert.equal(tableExists(db2, "Widget"), false, "the DDL rolled back with the failed bookkeeping — no migrated-but-unrecorded DB");
    assert.equal(rows(db2, `SELECT * FROM "_prisma_migrations"`).length, 0, "and nothing was recorded either");
    assert.equal(one(db2, `SELECT COUNT(*) AS n FROM "Doc"`).n, 3, "user data untouched");
  });
  assert.equal(backupsIn(dir).length, 1, "the pre-migration backup is still there to restore from");
});

// ── (a) + (b) the pragma is real, on the connection that runs the DDL ────

test("foreign_keys reads 0 on the migration connection AT DDL TIME (pragma issued outside the transaction)", async (t) => {
  const { dbPath, migrationsDir } = makeSandbox(t);
  // The migration itself records the live FK state, so the assertion is about
  // the connection that actually executed the DDL — not a re-read afterwards.
  addMigration(migrationsDir, "20260101000000_probe_pragma", `-- CreateTable
CREATE TABLE "FkProbe" ("v" INTEGER NOT NULL);
INSERT INTO "FkProbe" ("v") SELECT foreign_keys FROM pragma_foreign_keys;
`);

  await ensureSchemaCurrent({ dbPath, migrationsDir });

  inspect(dbPath, (db) => {
    assert.equal(
      one(db, `SELECT "v" FROM "FkProbe"`).v, 0,
      "FK enforcement was OFF while the migration ran; a 1 here means the pragma was a no-op inside the transaction"
    );
    // And enforcement is handed back on afterwards, not left off for the app.
    assert.equal(rows(db, "PRAGMA foreign_key_check").length, 0);
  });
});

test("REGRESSION (schema-model-1): a Prisma table rebuild does NOT cascade-delete the parent's children", async (t) => {
  const { dbPath, migrationsDir } = makeSandbox(t);
  addMigration(migrationsDir, "20260101000000_redefine_owner", REDEFINE_OWNER_SQL);

  await ensureSchemaCurrent({ dbPath, migrationsDir });

  inspect(dbPath, (db) => {
    // The pre-fix runner ran this block with enforcement live, so
    // DROP TABLE "Owner" performed an implicit DELETE and ON DELETE CASCADE
    // wiped every Doc. Measured: 3 -> 0.
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM "Doc"`).n, 3, "children survived the parent rebuild");
    assert.equal(one(db, `SELECT COUNT(*) AS n FROM "Owner"`).n, 2, "parents were copied across");
    assert.ok(columnNames(db, "Owner").includes("label"), "the rebuild actually happened (new column present)");
    assert.equal(tableExists(db, "new_Owner"), false, "the scratch table was renamed away");
    assert.equal(rows(db, "PRAGMA foreign_key_check").length, 0);
  });
});

// ── happy path + bookkeeping shape ───────────────────────────────────────

test("a happy-path migration records exactly one _prisma_migrations row", async (t) => {
  const { dir, dbPath, migrationsDir } = makeSandbox(t);
  const sql = `-- CreateTable
CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);
`;
  addMigration(migrationsDir, "20260101000000_add_widget", sql);

  await ensureSchemaCurrent({ dbPath, migrationsDir });

  inspect(dbPath, (db) => {
    const recorded = rows(db, `SELECT * FROM "_prisma_migrations"`);
    assert.equal(recorded.length, 1, "exactly one row");
    assert.equal(recorded[0].migration_name, "20260101000000_add_widget");
    assert.ok(recorded[0].finished_at, "finished_at is set — a later run treats it as applied");
    assert.equal(recorded[0].rolled_back_at, null);
    // Checksum is over the RAW file, matching `prisma migrate deploy`.
    const expected = require("node:crypto").createHash("sha256").update(sql).digest("hex");
    assert.equal(recorded[0].checksum, expected);
    assert.equal(tableExists(db, "Widget"), true);
  });

  // Second boot: already current, so nothing runs and no second backup is cut.
  await ensureSchemaCurrent({ dbPath, migrationsDir });
  assert.equal(backupsIn(dir).length, 1, "an already-current DB is a true no-op — no re-run, no new backup");
  inspect(dbPath, (db) => {
    assert.equal(rows(db, `SELECT * FROM "_prisma_migrations"`).length, 1, "still exactly one row");
  });
});

// ── refusal paths ────────────────────────────────────────────────────────

test("a database with no _prisma_migrations table is refused, not guessed at", async (t) => {
  const { dir, dbPath, migrationsDir } = makeSandbox(t);
  const db = new DatabaseSync(dbPath);
  db.exec(`DROP TABLE "_prisma_migrations"`);
  db.close();
  addMigration(migrationsDir, "20260101000000_add_widget", `CREATE TABLE "Widget" ("id" TEXT NOT NULL PRIMARY KEY);\n`);

  const err = await expectRejection(ensureSchemaCurrent({ dbPath, migrationsDir }));
  assert.match(err.message, /_prisma_migrations/);
  assert.match(err.message, /left untouched|not modified/i);
  assert.equal(backupsIn(dir).length, 0, "nothing was even backed up — no write was attempted");
  inspect(dbPath, (db2) => assert.equal(tableExists(db2, "Widget"), false));
});

test("a mid-run failure aborts the whole run: later migrations do not apply", async (t) => {
  const { dbPath, migrationsDir } = makeSandbox(t);
  addMigration(migrationsDir, "20260101000000_first_ok", `CREATE TABLE "First" ("id" TEXT NOT NULL PRIMARY KEY);\n`);
  addMigration(migrationsDir, "20260102000000_broken", `CREATE TABLE "Broken" ("id" TEXT NOT NULL PRIMARY KEY);\nINSERT INTO "NoSuchTable" ("id") VALUES ('x');\n`);
  addMigration(migrationsDir, "20260103000000_third", `CREATE TABLE "Third" ("id" TEXT NOT NULL PRIMARY KEY);\n`);

  const err = await expectRejection(ensureSchemaCurrent({ dbPath, migrationsDir }));
  assert.match(err.message, /schema migration failed/);

  inspect(dbPath, (db) => {
    assert.equal(tableExists(db, "First"), true, "the migration that fully succeeded stays applied");
    assert.equal(tableExists(db, "Broken"), false, "the failing migration left nothing behind");
    assert.equal(tableExists(db, "Third"), false, "and the run stopped instead of ploughing on");
    const recorded = rows(db, `SELECT migration_name FROM "_prisma_migrations"`).map((r) => r.migration_name);
    assert.deepEqual(recorded, ["20260101000000_first_ok"], "bookkeeping matches the schema exactly");
  });
});

// ── the real shipped migration set ───────────────────────────────────────

test("every shipped migration replays cleanly from an empty database", async (t) => {
  const { dbPath, migrationsDir: unused } = makeSandbox(t, { seed: false });
  void unused;
  const shipped = fs.readdirSync(DEFAULT_MIGRATIONS_DIR)
    .filter((n) => fs.existsSync(path.join(DEFAULT_MIGRATIONS_DIR, n, "migration.sql")));
  assert.ok(shipped.length >= 20, `expected the real migration set, found ${shipped.length}`);

  await ensureSchemaCurrent({ dbPath, migrationsDir: DEFAULT_MIGRATIONS_DIR });

  inspect(dbPath, (db) => {
    const recorded = rows(db, `SELECT migration_name FROM "_prisma_migrations"`).map((r) => r.migration_name);
    assert.equal(recorded.length, shipped.length, "every shipped migration recorded exactly once");
    assert.deepEqual([...recorded].sort(), [...shipped].sort());
    assert.equal(rows(db, "PRAGMA foreign_key_check").length, 0, "the resulting schema has no dangling references");
    for (const t2 of ["User", "Profile", "Recipe", "Food", "PlanSlot"]) {
      assert.equal(tableExists(db, t2), true, `${t2} exists after replay`);
    }
  });
});

// ── splitter ─────────────────────────────────────────────────────────────

test("splitSqlStatements keeps every statement of every shipped migration", () => {
  for (const name of fs.readdirSync(DEFAULT_MIGRATIONS_DIR)) {
    const file = path.join(DEFAULT_MIGRATIONS_DIR, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    const statements = splitSqlStatements(sql);
    const semicolons = (sql.match(/;\s*$/gm) || []).length;
    assert.equal(statements.length, semicolons, `${name}: ${statements.length} statements vs ${semicolons} terminators`);
    for (const s of statements) assert.ok(s.trim().length > 0, `${name}: empty statement`);
  }
});
