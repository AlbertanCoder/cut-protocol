// Schema-drift guard — makes a pending migration LOUD instead of silent.
//
// WHY THIS EXISTS. `ensureSchemaCurrent()` in src/lib/desktopBootstrap.js applies
// pending migrations at boot, but it returns immediately unless
// CUT_PROTOCOL_DB_PATH is set — which happens only in a packaged install. So a
// packaged app self-heals and the dev database drifts silently and permanently.
//
// That drift is not cosmetic. Measured on 2026-07-29 with migration
// 20260724203000 pending: 35 of 1,482 backend tests failed, `qc:smoke`,
// `bench:solver:check` and `qc:invariants` could not run at all, `qc:all` executed
// 1 of its 6 lanes (an && chain whose first lane exited 1), and `GET /api/export`
// returned 500 for every account that had data — while the SAME app reported
// "clean" on every check that did still run.
//
// It was also invisible in the worst possible way: a fresh clone has no generated
// Prisma client, so there is nothing to disagree with the database, and the first
// thing a newcomer is told to do — generate one — is the exact action that
// surfaces the failures.
//
// The rule: never let a caller conclude "green" from a database it has not
// checked. This fails CLOSED and names the migration.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const BACKEND = path.resolve(path.join(import.meta.dirname, "..", ".."));
const MIGRATIONS_DIR = path.join(BACKEND, "prisma", "migrations");

/**
 * Resolve the SQLite file the app would use, honouring the same precedence it does.
 * Returns `null` when DATABASE_URL is set to something this guard cannot speak for
 * (a non-`file:` provider). Returning the default `dev.db` in that case — which an
 * earlier revision did — made the guard silently check a DIFFERENT database than the
 * caller was about to use and report it green with no message at all. That is the one
 * outcome the header forbids.
 */
export function resolveDbPath() {
  if (process.env.CUT_PROTOCOL_DB_PATH) return process.env.CUT_PROTOCOL_DB_PATH;
  const url = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
  if (!url) return path.join(BACKEND, "prisma", "dev.db");
  const m = /^file:(.*)$/.exec(url);
  if (!m) return null; // e.g. postgresql:// — not ours to judge
  // Strip query/fragment: `file:./dev.db?connection_limit=1` is a documented Prisma
  // SQLite URL, and treating the query string as part of the FILENAME made the path
  // not exist, which fell through to "no database file yet" and disarmed the guard.
  const p = m[1].split(/[?#]/)[0];
  if (!p) return path.join(BACKEND, "prisma", "dev.db");
  return path.isAbsolute(p) ? p : path.resolve(path.join(BACKEND, "prisma"), p);
}

/**
 * @returns {{ok:boolean, reason?:string, pending:string[], applied:number, onDisk:number, dbPath:string}}
 * `ok:true` with a `reason` means "could not check" (no database yet, no migrations
 * directory) — that is not drift and must not fail a caller.
 */
export function checkSchemaDrift(dbPath = resolveDbPath()) {
  const base = { pending: [], applied: 0, onDisk: 0, dbPath };
  if (dbPath === null) {
    return { ...base, ok: true, reason: "DATABASE_URL is not a file: URL — this guard only speaks for SQLite, so the schema was NOT checked" };
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) return { ...base, ok: true, reason: "no migrations directory" };

  const onDisk = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(MIGRATIONS_DIR, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort();
  if (onDisk.length === 0) return { ...base, ok: true, reason: "no migrations on disk" };
  if (!fs.existsSync(dbPath)) return { ...base, onDisk: onDisk.length, ok: true, reason: "no database file yet" };

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    // `rolled_back_at IS NULL` matters: `prisma migrate resolve --rolled-back` is
    // Prisma's own prescribed recovery from a failed deploy, and it leaves the row
    // present with finished_at SET. Counting it as applied made the guard call the
    // most-drifted state it will ever see clean.
    const rows = db
      .prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
      .all();
    const applied = new Set(rows.map((r) => r.migration_name));
    const pending = onDisk.filter((m) => !applied.has(m));
    return { pending, applied: applied.size, onDisk: onDisk.length, dbPath, ok: pending.length === 0 };
  } catch (e) {
    const msg = e.message.split("\n")[0];
    // A database with NO _prisma_migrations table at all is maximum drift, not an
    // unreadable file: Prisma has never migrated it (`prisma db push`, or a hand-made
    // file). Reporting that as "cannot check" was the worst of the four fail-open
    // paths, because it is the case most likely to be real. Fail CLOSED.
    if (/no such table: _prisma_migrations/i.test(msg)) {
      return {
        ...base, onDisk: onDisk.length, ok: false,
        pending: onDisk,
        reason: "this database has no _prisma_migrations table — Prisma has never migrated it (db push?), so every migration on disk is unapplied",
      };
    }
    // Genuinely unopenable (not a database, zero bytes, locked) is not drift — it is
    // a database this guard cannot speak for. Say so rather than inventing a verdict.
    return { ...base, onDisk: onDisk.length, ok: true, reason: `cannot read _prisma_migrations (${msg})` };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

/** Print and exit(1) on drift. Callers that must not run against a stale schema use this. */
export function assertSchemaCurrent({ label = "schema" } = {}) {
  const r = checkSchemaDrift();
  if (r.ok) {
    if (r.reason) console.log(`[${label}] drift check skipped — ${r.reason}`);
    return r;
  }
  console.error(
    `\n[${label}] SCHEMA DRIFT — ${r.pending.length} migration(s) on disk are NOT applied to this database.\n` +
      `  database : ${r.dbPath}\n` +
      `  applied  : ${r.applied} of ${r.onDisk}\n` +
      r.pending.map((m) => `  PENDING  : ${m}`).join("\n") +
      `\n\n  Every result from here would describe a schema this database does not have.\n` +
      `  Fix it:  npx prisma migrate deploy   (then: npx prisma generate)\n`
  );
  process.exit(1);
}
