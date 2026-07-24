// Desktop-packaging bootstrap for the SQLite database.
//
// Context: when this app is packaged as an Electron desktop app, the Electron
// main process sets two env vars BEFORE requiring backend/server.js:
//   - CUT_PROTOCOL_DB_PATH: absolute path to the live SQLite file inside the
//     OS user-data folder, e.g.
//     C:\Users\<user>\AppData\Roaming\Cut Protocol\cutprotocol.db
//   - DATABASE_URL: a Prisma connection string pointing at that same path
//     (e.g. "file:C:\\Users\\<user>\\AppData\\Roaming\\Cut Protocol\\cutprotocol.db")
// Because dotenv (`require("dotenv/config")` in server.js) never overwrites
// an already-set env var, that DATABASE_URL wins over the dev-mode
// `backend/.env` value and Prisma connects to the user-data path instead of
// the repo-relative `./dev.db`.
//
// On a genuinely fresh install, nothing exists at CUT_PROTOCOL_DB_PATH yet —
// no file, no schema. Bundling the full Prisma CLI/migration engine just to
// run migrations once on first launch is heavy and fragile for a solo-user
// desktop tool, so instead we ship a pre-built SQLite file (with the current
// schema already applied) as a packaged resource and copy it into place on
// first run. Every subsequent launch finds the file already there and is a
// no-op.
//
// This module must be required and ensureDatabaseReady() must be called
// BEFORE anything requires src/lib/prisma.js (which constructs the
// PrismaClient at module-load time and resolves DATABASE_URL then). See
// server.js — the call happens as the very first thing, before the route
// files are required.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Filename of the packaged template DB resource, relative to the resources
// root. The packaging-config agent (electron-builder `extraResources`) needs
// to copy backend/prisma/dev.db into the packaged app's resources directory
// under this exact name.
const TEMPLATE_DB_FILENAME = "dev.db.template";

/**
 * Resolve the path to the packaged template database file.
 *
 * ASSUMPTION (document this clearly for cross-checking with the
 * electron-builder config / electron/main.cjs agents): electron-builder's
 * `extraResources` copies files into `process.resourcesPath` by default
 * (e.g. `<install-dir>/resources/` in a packaged Windows app), preserving
 * whatever relative path was configured. This function assumes the template
 * was placed directly at `<resourcesPath>/dev.db.template` — i.e. the
 * packaging config's `extraResources` entry has `to: "dev.db.template"` (or
 * no subfolder). If the packaging agent instead nests it (e.g. under a
 * `resources/db/` subfolder, or keeps the original name `dev.db`), this is
 * the one line to change.
 *
 * Only meaningful when running inside a packaged Electron app, where
 * `process.resourcesPath` is defined. Returns null if that's not available
 * (e.g. running bare `node server.js` outside Electron).
 */
function getTemplateDbPath() {
  if (!process.resourcesPath) return null;
  return path.join(process.resourcesPath, TEMPLATE_DB_FILENAME);
}

/**
 * Ensure the packaged app's SQLite database file exists before Prisma is
 * ever constructed. Safe to call in any context (dev, bare node, packaged
 * Electron) — it only acts when CUT_PROTOCOL_DB_PATH is set.
 *
 * Behavior:
 *   - CUT_PROTOCOL_DB_PATH not set          -> normal dev mode, no-op.
 *   - CUT_PROTOCOL_DB_PATH set, file exists -> already initialized, no-op
 *     (never overwrites the user's real data).
 *   - CUT_PROTOCOL_DB_PATH set, file missing -> first launch: create the
 *     parent directory, then copy the packaged template DB into place.
 *   - CUT_PROTOCOL_DB_PATH set, file missing, no template resource found
 *     -> log a one-line warning and return without crashing (e.g. bare
 *     `node server.js` run outside a packaged Electron app with the env
 *     var set manually for testing).
 */
// A real SQLite database starts with the 16-byte "SQLite format 3\0" magic
// and is at least one 512-byte page. Stage-C fix (M6): Prisma creates a 0-byte
// file at a missing DATABASE_URL path, and a failed/partial template copy
// (disk full, AV interference, crash) leaves a truncated file — both used to
// be treated as "initialized" by a bare existsSync, bricking every launch.
function isValidSqlite(filePath) {
  try {
    if (fs.statSync(filePath).size < 512) return false;
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(16);
      fs.readSync(fd, header, 0, 16, 0);
      return header.toString("latin1").startsWith("SQLite format 3");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function ensureDatabaseReady() {
  const dbPath = process.env.CUT_PROTOCOL_DB_PATH;
  if (!dbPath) return; // normal dev mode, nothing to do

  if (fs.existsSync(dbPath)) {
    if (isValidSqlite(dbPath)) return; // already initialized, don't touch it
    // A file exists but isn't a valid SQLite DB — a failed/partial first-run
    // copy. Preserve it (never delete possible user data) under a .corrupt
    // name and re-initialize from the template below, so the install self-heals.
    const backup = `${dbPath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(dbPath, backup);
      console.warn(`[desktopBootstrap] Invalid database at ${dbPath} (0-byte or truncated); moved to ${backup} and re-initializing from template.`);
    } catch (e) {
      console.error(`[desktopBootstrap] Invalid database at ${dbPath} and could not move it aside: ${e.message}`);
      return;
    }
  }

  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const templatePath = getTemplateDbPath();
  if (!templatePath || !fs.existsSync(templatePath)) {
    console.warn(
      `[desktopBootstrap] CUT_PROTOCOL_DB_PATH is set (${dbPath}) but no template database was found at ` +
        `${templatePath || "(process.resourcesPath is undefined)"}. Skipping DB initialization — Prisma will ` +
        `likely fail to find tables until a database is placed at this path.`
    );
    return;
  }

  fs.copyFileSync(templatePath, dbPath);
  console.log(`[desktopBootstrap] Initialized database at ${dbPath} from packaged template.`);
}

// M2 fix: schema migration for installed apps. A reinstalled/updated app used
// to boot the new code against the user's OLD database file and 500 on any
// table added since that install was packaged. Now, on packaged boot, any
// shipped Prisma migrations the user DB hasn't applied are executed
// IN-PROCESS, with an automatic timestamped backup of the DB first.
// In-process on purpose: an earlier version spawned the packaged Prisma CLI
// as a child, which cannot resolve its dependencies out of app.asar (child
// processes read the archive as an opaque file).
//
// ── HARDENED 2026-07-23 (fleet finding schema-model-1, P0) ───────────────
// The previous version ran the migration SQL through the shared PrismaClient
// inside `prisma.$transaction`. That is unsafe in two compounding ways, both
// measured, not theorised:
//
//   1. SQLite SILENTLY IGNORES `PRAGMA foreign_keys` inside a transaction
//      ("this pragma is a no-op within a transaction"). Every Prisma
//      RedefineTables block opens with `PRAGMA foreign_keys=OFF`, so running
//      that block transactionally means the OFF never lands. Measured through
//      the real Prisma path: inside `$transaction`, after
//      `$executeRawUnsafe("PRAGMA foreign_keys=OFF")`, `pragma_foreign_keys`
//      still reads 1. `defer_foreign_keys` does work there, but it only
//      DEFERS the constraint CHECK to COMMIT — it does not stop FK ACTIONS.
//      A `DROP TABLE "X"` with enforcement live performs an implicit
//      `DELETE FROM X`, and ON DELETE CASCADE children are deleted for real.
//      Shipped migrations DROP "User" and DROP "Recipe"; the schema has 10
//      cascade relations hanging off them (MealLog, BrainConversation,
//      LlmUsage, CartItem, …). Upgrading across those migrations silently
//      ate that data.
//   2. PRAGMAs are per-connection state, and PrismaClient is a POOL — a
//      pragma issued outside the transaction can land on a different physical
//      connection than the transaction that needs it.
//
// So the runner now owns ONE dedicated connection (`node:sqlite`, a Node core
// module — nothing native to rebuild, nothing to resolve out of app.asar;
// present in the Electron 43 / Node 24 runtime this app ships on) and drives
// the sequence SQLite actually honours:
//
//   open → PRAGMA foreign_keys=OFF (outside any txn, read back to prove it)
//        → BEGIN → DDL → _prisma_migrations row → PRAGMA foreign_key_check
//        → COMMIT (or ROLLBACK on any violation/throw) → foreign_keys=ON
//        → close
//
// Bookkeeping is INSIDE the transaction with the DDL, so a crash can never
// leave the DB migrated-but-unrecorded (next boot replays DDL onto an
// already-migrated schema) or recorded-but-unmigrated. Bookkeeping content
// still matches `prisma migrate deploy`: applied names + sha256 checksums in
// `_prisma_migrations`.

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, "..", "..", "prisma", "migrations");

// Prisma-generated SQLite migrations terminate every statement with ";" at
// end-of-line and use only `--` line comments — split on that shape.
// (Hand-verify this holds if a future migration embeds a ";" inside a string
// literal spanning a line end; none of the current files do.)
function splitSqlStatements(sql) {
  const statements = [];
  let current = [];
  for (const line of sql.split(/\r?\n/)) {
    const t = line.trim();
    if (current.length === 0 && (!t || t.startsWith("--"))) continue;
    current.push(line);
    if (t.endsWith(";")) {
      statements.push(current.join("\n").replace(/;\s*$/, ""));
      current = [];
    }
  }
  if (current.length && current.join("").trim()) statements.push(current.join("\n"));
  return statements;
}

// `PRAGMA foreign_keys` is the one statement we must own ourselves. Prisma
// writes it into every RedefineTables block, where it is a guaranteed no-op
// (see the note above), and a stray `PRAGMA foreign_keys=ON` mid-run would be
// actively dangerous if it ever did land. Strip both directions and set the
// pragma from the runner, outside the transaction, where SQLite honours it.
// `defer_foreign_keys` is deliberately left in place: it genuinely works
// inside a transaction and is harmlessly inert while enforcement is off.
function isForeignKeysPragma(stmt) {
  return /^\s*PRAGMA\s+foreign_keys\s*=/i.test(stmt);
}

function readForeignKeysPragma(db) {
  return Number(db.prepare("SELECT foreign_keys AS v FROM pragma_foreign_keys").get().v);
}

// File-level snapshot taken before the first statement of the first pending
// migration. Any outstanding WAL is folded back into the main file first so
// the copy is self-contained; the sidecars are copied too as belt and braces.
// Restoring = copy this file back over the live path.
function backupDatabaseFile(dbPath) {
  const backupPath = `${dbPath}.backup-pre-migrate-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(dbPath, backupPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(`${dbPath}${suffix}`)) fs.copyFileSync(`${dbPath}${suffix}`, `${backupPath}${suffix}`);
  }
  return backupPath;
}

// One migration, one transaction. DDL + bookkeeping + the FK audit all commit
// together or none of them do.
function applyOneMigration(db, migrationsDir, name) {
  const sql = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");
  // Checksum is of the RAW file, exactly as `prisma migrate deploy` records it.
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  const statements = splitSqlStatements(sql).filter((s) => !isForeignKeysPragma(s));
  const startedAt = new Date().toISOString();

  db.exec("BEGIN");
  try {
    for (const stmt of statements) db.exec(stmt);

    // Bookkeeping INSIDE the transaction, on purpose — see the header note.
    db.prepare(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)"
    ).run(crypto.randomUUID(), checksum, new Date().toISOString(), name, startedAt, statements.length);

    // Last gate before the point of no return. Enforcement is off for the
    // whole migration, which is what makes table rebuilds possible — and also
    // what lets a bad migration strand orphaned rows with no error at all.
    // Any row here means committing would corrupt the user's data.
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      const sample = violations.slice(0, 5)
        .map((v) => `${v.table} rowid=${v.rowid} -> ${v.parent} (fk #${v.fkid})`).join("; ");
      throw new Error(
        `${name} would leave ${violations.length} orphaned foreign-key row(s) — rolled back, nothing applied. First: ${sample}`
      );
    }

    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction — already unwound */ }
    throw e;
  }
  return statements.length;
}

/**
 * Bring the database at `dbPath` up to the shipped migration set.
 *
 * @param {object} [options]
 * @param {string} [options.dbPath]        defaults to process.env.CUT_PROTOCOL_DB_PATH
 * @param {string} [options.migrationsDir] defaults to backend/prisma/migrations
 *
 * Both options exist so tests can drive the real runner against a throwaway
 * database; server.js calls it with no arguments and gets the packaged
 * behaviour. Resolves when the DB is current (a no-op in dev, where
 * CUT_PROTOCOL_DB_PATH is unset). Rejects — loudly, with the backup path in
 * the message — rather than ever letting boot continue on a half-migrated DB.
 */
async function ensureSchemaCurrent(options = {}) {
  const dbPath = options.dbPath || process.env.CUT_PROTOCOL_DB_PATH;
  if (!dbPath || !fs.existsSync(dbPath)) return; // dev mode / nothing to migrate

  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  if (!fs.existsSync(migrationsDir)) return;
  const shipped = fs.readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  if (shipped.length === 0) return;

  // Required lazily so a dev boot (which returns above) never loads it or
  // prints its ExperimentalWarning.
  const { DatabaseSync } = require("node:sqlite");

  let db = null;
  let backupPath = null;
  try {
    // THE dedicated connection. Opened with FK enforcement on (node:sqlite's
    // default) precisely so the explicit OFF below has something to prove.
    db = new DatabaseSync(dbPath, { timeout: 15000 });

    let applied;
    try {
      const rows = db.prepare(
        "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"
      ).all();
      applied = new Set(rows.map((r) => r.migration_name));
    } catch (e) {
      // No bookkeeping table — this DB didn't come from `prisma migrate` and
      // guessing would risk data. Refuse loudly and leave it untouched.
      throw new Error(`cannot read _prisma_migrations (${e.message}) — database left untouched`);
    }

    const pending = shipped.filter((n) => !applied.has(n));
    if (pending.length === 0) return;

    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* not in WAL mode */ }
    backupPath = backupDatabaseFile(dbPath);
    console.log(`[desktopBootstrap] Applying ${pending.length} schema migration(s); backup at ${backupPath}`);

    // OUTSIDE the transaction — the only place SQLite honours this — and then
    // read back, because a silently-ignored pragma here is the entire bug
    // class this runner was rewritten to eliminate.
    db.exec("PRAGMA foreign_keys=OFF");
    if (readForeignKeysPragma(db) !== 0) {
      throw new Error(
        "could not disable foreign-key enforcement on the migration connection — refusing to run table-rebuild migrations with constraints live"
      );
    }

    for (const name of pending) {
      const count = applyOneMigration(db, migrationsDir, name);
      console.log(`[desktopBootstrap] applied ${name} (${count} statements)`);
    }

    db.exec("PRAGMA foreign_keys=ON");
  } catch (e) {
    const where = backupPath
      ? `\nDB backup (copy this file back over ${dbPath} to undo): ${backupPath}`
      : "\nNo migration was started — the database was not modified.";
    const detail = `${e.message}${where}`;
    try { fs.writeFileSync(`${dbPath}.migrate-error.log`, `${new Date().toISOString()}\n${detail}\n`); } catch { /* best effort */ }
    throw new Error(`schema migration failed: ${detail}`);
  } finally {
    try { if (db) db.close(); } catch { /* already closed */ }
  }
}

module.exports = {
  ensureDatabaseReady,
  ensureSchemaCurrent,
  getTemplateDbPath,
  TEMPLATE_DB_FILENAME,
  isValidSqlite,
  splitSqlStatements,
  DEFAULT_MIGRATIONS_DIR,
};
