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

module.exports = { ensureDatabaseReady, getTemplateDbPath, TEMPLATE_DB_FILENAME, isValidSqlite };
