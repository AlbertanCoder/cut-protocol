// A1/rig/dbcopy.mjs — DB ISOLATION. Every solver-brain agent calls this before
// it touches prisma.
//
// The failure mode this exists to prevent (BRIEF.md, "Infrastructure contract"):
// agents share node_modules, so a RELATIVE DATABASE_URL silently resolves back to
// the shared backend/prisma/dev.db and poisons every other agent's run. This
// helper only ever emits an ABSOLUTE file: URL, and refuses to emit one that
// points at the shared DB.
//
// Usage (module):
//   import { prepareAgentDb } from ".../A1/rig/dbcopy.mjs";
//   const { url } = prepareAgentDb("A7");        // copies + sets process.env.DATABASE_URL
//   const { prisma } = require("backend/src/lib/prisma.js");  // AFTER the line above
//
// Usage (CLI, prints the URL for a shell export):
//   node A1/rig/dbcopy.mjs A7
//
// SQLite runs in WAL mode here (backend/src/lib/prisma.js: "PRAGMA
// journal_mode=WAL"), so the -wal and -shm sidecars are copied alongside the
// main file when they exist. Copying dev.db alone can drop recently-committed
// pages that are still living in the WAL.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = <repo>/docs/surgery/CAMPAIGN/solver-brain/A1/rig
export const REPO = path.resolve(HERE, "..", "..", "..", "..", "..", "..");
export const FLEET_DIR = path.resolve(REPO, "docs/surgery/CAMPAIGN/solver-brain");
export const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");

const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

/** sha256 of a file, first 16 hex chars — used to prove the copy matches the source. */
export function fileHash(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
}

/**
 * Copy the shared dev.db into <solver-brain>/<agentId>/dev.db and return the
 * absolute DATABASE_URL for it.
 *
 * @param {string} agentId        e.g. "A7"
 * @param {object} [opts]
 * @param {boolean} [opts.force]  re-copy even if the agent copy already exists
 * @param {boolean} [opts.setEnv] also assign process.env.DATABASE_URL (default true)
 */
export function prepareAgentDb(agentId, opts = {}) {
  const { force = false, setEnv = true } = opts;
  if (!/^[A-Za-z0-9_-]+$/.test(String(agentId || ""))) {
    throw new Error(`prepareAgentDb: agentId must be a plain id like "A7", got ${JSON.stringify(agentId)}`);
  }
  if (!fs.existsSync(SHARED_DB)) throw new Error(`prepareAgentDb: shared DB not found at ${SHARED_DB}`);

  const dir = path.resolve(FLEET_DIR, agentId);
  const dbPath = path.resolve(dir, "dev.db");

  // Refuse, loudly, to hand back the shared DB under any circumstances.
  if (norm(dbPath) === norm(SHARED_DB)) throw new Error("prepareAgentDb: refusing — resolved to the SHARED dev.db");

  fs.mkdirSync(dir, { recursive: true });
  const fresh = force || !fs.existsSync(dbPath);
  if (fresh) {
    fs.copyFileSync(SHARED_DB, dbPath);
    // WAL sidecars, when present. Absent sidecars are normal and not an error.
    for (const ext of ["-wal", "-shm"]) {
      const src = SHARED_DB + ext;
      if (fs.existsSync(src)) fs.copyFileSync(src, dbPath + ext);
      else if (fs.existsSync(dbPath + ext)) fs.rmSync(dbPath + ext);
    }
  }

  // Prisma wants forward slashes even on Windows: file:C:/path/to/dev.db
  const url = `file:${dbPath.replace(/\\/g, "/")}`;
  if (!path.isAbsolute(dbPath)) throw new Error("prepareAgentDb: produced a relative path — refusing");
  if (setEnv) process.env.DATABASE_URL = url;

  return {
    agentId, url, dbPath, dir, copied: fresh,
    sourceHash: fileHash(SHARED_DB),
    copyHash: fileHash(dbPath),
  };
}

/**
 * Guard for the top of any script that will run prisma. Throws if DATABASE_URL
 * is missing, relative, or aimed at the shared DB. Cheap insurance: call it
 * immediately before the first prisma import.
 */
export function assertIsolated(agentId) {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("file:")) throw new Error(`assertIsolated: DATABASE_URL is not a file: URL (${url || "unset"})`);
  const p = url.slice("file:".length);
  if (!path.isAbsolute(p)) throw new Error(`assertIsolated: DATABASE_URL is RELATIVE (${url}) — it will resolve to the shared DB`);
  if (norm(p) === norm(SHARED_DB)) throw new Error("assertIsolated: DATABASE_URL points at the SHARED backend/prisma/dev.db — the fleet is read-only to it");
  if (agentId && !norm(p).includes(`/solver-brain/${String(agentId).toLowerCase()}/`)) {
    throw new Error(`assertIsolated: DATABASE_URL (${url}) is not inside solver-brain/${agentId}/`);
  }
  return p;
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) {
  const id = process.argv[2];
  if (!id) { console.error("usage: node dbcopy.mjs <AGENT-ID> [--force]"); process.exit(2); }
  const r = prepareAgentDb(id, { force: process.argv.includes("--force"), setEnv: false });
  console.error(`[dbcopy] ${r.copied ? "copied" : "reused"} ${r.dbPath}`);
  console.error(`[dbcopy] source sha256:16 ${r.sourceHash}  copy ${r.copyHash}  ${r.sourceHash === r.copyHash ? "MATCH" : "*** MISMATCH ***"}`);
  console.log(r.url); // stdout = just the URL, so: DATABASE_URL="$(node dbcopy.mjs A7)"
}
