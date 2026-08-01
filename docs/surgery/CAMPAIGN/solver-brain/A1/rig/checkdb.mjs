// A1/rig/checkdb.mjs — verify YOUR agent's dev.db copy is the current one.
//
// Why this exists: prepareAgentDb() REUSES an existing <agent>/dev.db instead of
// re-copying (re-copying a 22 MB file on every run is wasteful). That is fine
// until an agent directory still holds a copy from an earlier campaign — then
// the agent silently measures stale nutrition data and its numbers are not
// comparable with anyone else's. BRIEF.md integrity rule 7: beware your own
// tooling.
//
//   node checkdb.mjs A7          # exits 0 when the copy matches the source
//   node checkdb.mjs A7 --fix    # re-copies from backend/prisma/dev.db
//
// Run it once before your first measured run. If it reports a MISMATCH, re-copy
// (--fix) and discard any results produced before that point.

import path from "node:path";
import fs from "node:fs";
import { prepareAgentDb, fileHash, SHARED_DB, FLEET_DIR } from "./dbcopy.mjs";

const id = process.argv[2];
const fix = process.argv.includes("--fix");
if (!id) { console.error("usage: node checkdb.mjs <AGENT-ID> [--fix]"); process.exit(2); }

const dbPath = path.resolve(FLEET_DIR, id, "dev.db");
const existed = fs.existsSync(dbPath);
const before = existed ? fileHash(dbPath) : null;
const source = fileHash(SHARED_DB);

if (existed && before !== source && !fix) {
  console.error(`MISMATCH  ${id}/dev.db is NOT a copy of the current backend/prisma/dev.db`);
  console.error(`  source ${source}`);
  console.error(`  copy   ${before}`);
  console.error(`  -> re-run with --fix, and discard results produced from the old copy.`);
  process.exit(1);
}

const r = prepareAgentDb(id, { force: fix, setEnv: false });
const okNow = r.sourceHash === r.copyHash;
console.log(`${okNow ? "OK" : "MISMATCH"}  ${r.dbPath}`);
console.log(`  source sha256:16 ${r.sourceHash}   copy ${r.copyHash}   ${r.copied ? "(copied now)" : "(reused existing)"}`);
console.log(`  DATABASE_URL ${r.url}`);
process.exit(okNow ? 0 : 1);
