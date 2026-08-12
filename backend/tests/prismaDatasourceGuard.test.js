// REGRESSION SUITE — Railway deploy-gap 2 (WAL PRAGMA fired on Postgres).
//
// src/lib/prisma.js fires `PRAGMA journal_mode=WAL` at module load. PRAGMA is
// SQLite-only: on the Railway/Postgres deploy the statement errors, and the
// fire-and-forget's catch logged a scary "[prisma] could not enable WAL"
// warning on every cloud boot. The fix keys the pragma on DATABASE_URL's
// protocol (`file:` = SQLite) — never on NODE_ENV, which is "production" on
// both the packaged desktop app and the cloud and so cannot tell the engines
// apart. This suite pins three properties:
//
//   1. the protocol-detection helper's truth table (pure strings in, bool out),
//   2. a postgres:// datasource skips the pragma SILENTLY — walReady resolves
//      null and NOTHING scary reaches stderr,
//   3. a file: datasource still gets WAL — the desktop concurrency win the
//      pragma exists for must survive the guard.
//
// Every require of src/lib/prisma.js happens in a CHILD process against a
// controlled DATABASE_URL. Requiring it in-process would connect this test
// run to the real backend/prisma/dev.db (same isolation pattern, and same
// reason, as schemaIndexes.test.js's WAL test).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");

/** Require prisma.js in a child with the given DATABASE_URL and return
 *  { status, stdout, stderr, result } where result is the parsed RESULT: JSON. */
function probe(databaseUrl, childJs) {
  const r = spawnSync(process.execPath, ["-e", childJs], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const m = (r.stdout || "").match(/RESULT:(\{.*\})/);
  return { ...r, result: m ? JSON.parse(m[1]) : null };
}

// The child evaluates the truth table itself (so undefined/null/number cases
// need no JSON round-trip) and reports walReady's outcome alongside.
const CHILD_JS = `
const { isSqliteDatasource, walReady } = require("./src/lib/prisma.js");
const table = {
  relFile:   isSqliteDatasource("file:./dev.db"),
  absFile:   isSqliteDatasource("file:C:/Users/x/AppData/Roaming/Cut Protocol/cutprotocol.db"),
  caps:      isSqliteDatasource("FILE:./caps.db"),
  padded:    isSqliteDatasource("  file:./padded.db"),
  postgres:  isSqliteDatasource("postgres://user:pass@db.host:5432/postgres"),
  pooler:    isSqliteDatasource("postgresql://u:p@aws-0-ca-central-1.pooler.supabase.com:5432/postgres"),
  empty:     isSqliteDatasource(""),
  nul:       isSqliteDatasource(null),
  number:    isSqliteDatasource(42),
  envFallback: isSqliteDatasource(),
};
walReady.then((mode) => {
  console.log("RESULT:" + JSON.stringify({ table, mode }));
  process.exit(0);
});
`;

test("isSqliteDatasource: file: URLs and only file: URLs are SQLite", (t) => {
  // A throwaway file: URL so the module-load pragma touches only scratch.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-dsguard-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const url = `file:${path.join(dir, "scratch.db").replace(/\\/g, "/")}`;

  const r = probe(url, CHILD_JS);
  assert.equal(r.status, 0, `child exited ${r.status}\nSTDERR:${r.stderr}`);
  assert.ok(r.result, `no RESULT line in: ${r.stdout}`);

  assert.deepEqual(r.result.table, {
    relFile: true,     // dev: backend/.env's file:./dev.db
    absFile: true,     // packaged desktop: absolute path from electron/main.cjs
    caps: true,        // protocol match is case-insensitive
    padded: true,      // tolerate accidental leading whitespace in an env var
    postgres: false,   // plain postgres:// scheme
    pooler: false,     // the actual Supabase session-pooler shape Railway gets
    empty: false,
    nul: false,
    number: false,
    envFallback: true, // no-arg call reads process.env.DATABASE_URL (file: here)
  });
});

test("a postgres:// datasource skips the WAL pragma silently — walReady null, no scary log", () => {
  // No live Postgres anywhere near this: the guard must decide from the URL
  // string alone, before any query is attempted.
  const r = probe("postgresql://user:pass@localhost:5432/nope?sslmode=require", CHILD_JS);
  assert.equal(r.status, 0, `child exited ${r.status}\nSTDERR:${r.stderr}`);
  assert.ok(r.result, `no RESULT line in: ${r.stdout}`);

  assert.equal(r.result.mode, null, "walReady must resolve null without touching the datasource");
  assert.equal(r.result.table.envFallback, false, "the no-arg env fallback must read the postgres URL as non-SQLite");
  assert.doesNotMatch(r.stderr || "", /could not enable WAL|\[prisma\]/,
    "REGRESSION: the cloud boot logged the WAL warning again — the pragma must be skipped, not attempted-and-caught");
});

test("a file: datasource still gets WAL — the guard must not cost the desktop its journal mode", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-dsguard-wal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const url = `file:${path.join(dir, "wal.db").replace(/\\/g, "/")}`;

  const r = probe(url, CHILD_JS);
  assert.equal(r.status, 0, `child exited ${r.status}\nSTDERR:${r.stderr}`);
  assert.equal(r.result && r.result.mode, "wal",
    "REGRESSION: walReady no longer reports wal on a SQLite datasource — the guard over-blocks");
});
