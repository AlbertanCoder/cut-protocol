// Regression guard for the PACKAGING safety gate (2026-07-24).
//
// An installer went out that carried backend/.env.qc (JWT secret, USDA key, the
// owner's seed email and a cleartext password) and a 10-user database snapshot,
// and `npm run dist:check` printed "safe to share" over it. Three independent
// blind spots let that happen; there is one test below for each, plus one for
// the rule that would have caught the snapshot regardless of any of them.
//
// These are repo-root ESM scripts; this backend CJS test dynamic-imports them.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const REPO = path.resolve(__dirname, "../..");
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

// A filled-in secret, assembled at runtime so this SOURCE file never contains
// one. The scan:allow marks are belt-and-braces for the repo-wide scan.
const FILLED_JWT = "JWT_SECRET=" + "a1b2c3d4".repeat(8); // scan:allow (constructed fixture)
const FILLED_SEED = "SEED_PASSWORD=" + "hunter2hunter2"; // scan:allow (constructed fixture)

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cp-dist-"));
  const release = path.join(root, "release");
  fs.mkdirSync(path.join(release, "resources", "backend"), { recursive: true });
  fs.writeFileSync(path.join(release, "resources", "backend", ".env.qc"), `${FILLED_JWT}\n${FILLED_SEED}\n`);
  return { root, release };
}

// ── blind spot 1: the scanner refused to scan the directory it was asked to ──

test("scanPaths: an explicitly-passed root named 'release' IS scanned", async () => {
  const { scanPaths } = await load("scripts/scanSecrets.mjs");
  const { root, release } = tmpTree();
  try {
    const findings = scanPaths([release]);
    assert.ok(findings.length >= 1, "a dirty release/ tree must produce findings — this returned 0 before the fix, which is how a leaking installer was certified safe");
    assert.ok(findings.some((f) => f.rule === "jwt-secret-filled"), "the JWT secret must be named");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("scanPaths: a DESCENDANT release/ is still pruned (the optimisation survives)", async () => {
  const { scanPaths } = await load("scripts/scanSecrets.mjs");
  const { root } = tmpTree();
  try {
    assert.equal(scanPaths([root]).length, 0, "walking a parent must still skip build output below it");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── blind spot 2: the data walk keyed on a filename ENDING in .db ────────────

test("isDataName: matches a database whatever follows the extension", async () => {
  const { isDataName } = await load("scripts/checkDistSafe.mjs");
  for (const name of [
    "dev.db",
    "dev.db.template",
    "dev.db-journal",
    "dev.db.backup-20260721",
    "dev.db.snapshot-agentcontam-20260721-212858", // the file that shipped
    "app.sqlite",
    "app.sqlite3",
    "app.sqlite3-wal",
  ]) assert.ok(isDataName(name), `${name} must be treated as a data file`);

  for (const name of [
    "query_engine_bg.sqlite.js", // Prisma really ships this
    "query_compiler_bg.sqlite.wasm",
    "notes.dbeaver",
    "index.js",
  ]) assert.ok(!isDataName(name), `${name} is code, not data`);
});

// ── the load-bearing rule: a shipped database must have no users ─────────────

test("countUserRows: counts real rows, and 0 when the table is empty", async () => {
  const { countUserRows, isSqliteFile } = await load("scripts/checkDistSafe.mjs");
  const { DatabaseSync } = require("node:sqlite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-db-"));
  try {
    const dirty = path.join(dir, "renamed-to-hide-it.bin");
    let db = new DatabaseSync(dirty);
    db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT)');
    db.exec(`INSERT INTO "User" VALUES ('a','someone@realdomain.com'), ('b','other@realdomain.com')`);
    db.close();
    assert.ok(isSqliteFile(dirty), "a database is recognised by its header, not its name");
    assert.equal(countUserRows(dirty), 2);

    const clean = path.join(dir, "template.db");
    db = new DatabaseSync(clean);
    db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT)');
    db.close();
    assert.equal(countUserRows(clean), 0, "a depersonalized template must read as 0");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDist: a database with User rows fails even when named nothing like a database", async () => {
  const { checkDist } = await load("scripts/checkDistSafe.mjs");
  const { DatabaseSync } = require("node:sqlite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-dist2-"));
  try {
    const f = path.join(dir, "assets.pak");
    const db = new DatabaseSync(f);
    db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT)');
    db.exec(`INSERT INTO "User" VALUES ('a','someone@realdomain.com')`);
    db.close();
    const { dataFindings } = checkDist(dir);
    assert.ok(dataFindings.some((d) => /row\(s\) in User/.test(d.detail)), "the User-row rule must fire regardless of filename");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── blind spot 3: nothing looked inside app.asar ─────────────────────────────
//
// @electron/asar is a transitive dev dependency of electron-builder at the repo
// root. CI installs backend/ only, so this test is skipped there rather than
// failing — the checker itself degrades the same way (raw byte scan).
function hasAsar() {
  try { require.resolve("@electron/asar", { paths: [REPO] }); return true; } catch { return false; }
}

test("checkDist: finds a secret sealed inside an .asar", { skip: hasAsar() ? false : "@electron/asar not installed (root devDeps absent)" }, async () => {
  const asar = require(require.resolve("@electron/asar", { paths: [REPO] }));
  const { checkDist } = await load("scripts/checkDistSafe.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-asar-"));
  try {
    const src = path.join(dir, "src", "backend");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, ".env.qc"), `${FILLED_JWT}\n${FILLED_SEED}\n`);
    fs.writeFileSync(path.join(src, "server.js"), "module.exports = {};\n");
    const out = path.join(dir, "resources");
    fs.mkdirSync(out, { recursive: true });
    await asar.createPackageWithOptions(path.join(dir, "src"), path.join(out, "app.asar"), {});

    const { secretFindings } = checkDist(out);
    assert.ok(secretFindings.some((f) => f.rule === "jwt-secret-filled" && /app\.asar!/.test(f.file)),
      "a secret inside app.asar must be reported with the entry path — the archive is >2 MB and full of NUL bytes, so the plain file scanner never sees it");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDist: the raw fallback still finds it when @electron/asar is unavailable", { skip: hasAsar() ? false : "@electron/asar not installed (root devDeps absent)" }, async () => {
  const asar = require(require.resolve("@electron/asar", { paths: [REPO] }));
  const { checkDist } = await load("scripts/checkDistSafe.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-asar2-"));
  const prev = process.env.CUT_PROTOCOL_NO_ASAR_LIB;
  try {
    const src = path.join(dir, "src", "backend");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, ".env.qc"), `${FILLED_JWT}\n${FILLED_SEED}\n`);
    const out = path.join(dir, "resources");
    fs.mkdirSync(out, { recursive: true });
    await asar.createPackageWithOptions(path.join(dir, "src"), path.join(out, "app.asar"), {});

    process.env.CUT_PROTOCOL_NO_ASAR_LIB = "1";
    const { secretFindings } = checkDist(out);
    assert.ok(secretFindings.some((f) => f.rule === "jwt-secret-filled"), "the fallback byte scan must still fail the build");
  } finally {
    if (prev === undefined) delete process.env.CUT_PROTOCOL_NO_ASAR_LIB;
    else process.env.CUT_PROTOCOL_NO_ASAR_LIB = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── the packaging config is an allowlist, and it holds ───────────────────────

function hasBuilder() {
  try { require.resolve("app-builder-lib/out/fileMatcher.js", { paths: [REPO] }); return true; } catch { return false; }
}

test("build.files: no env file, database or keygen can reach the installer", { skip: hasBuilder() ? false : "app-builder-lib not installed (root devDeps absent)" }, async () => {
  const { resolvePackagedFiles } = await load("scripts/resolvePackagedFiles.mjs");
  const res = resolvePackagedFiles();
  assert.ok(res.available, "the payload must be resolvable when app-builder-lib is present");

  const IS_CODE = /\.(?:js|mjs|cjs|json|md|txt|wasm|map|node|html|css|svg)$/i;
  const offenders = res.files.filter((f) =>
    /(^|\/)\.env|\.env($|[.\-])/i.test(f) ||
    (/\.(?:db|sqlite3|sqlite)(?=[^A-Za-z0-9]|$)/i.test(f) && !IS_CODE.test(f)) ||
    /licenseTool\.cjs$/.test(f) ||
    /\.node\.tmp[0-9]*$/i.test(f));
  assert.deepEqual(offenders, [], "these would ship to a stranger");

  // …and it still ships what the app needs to boot.
  for (const need of [
    "electron/main.cjs",
    "backend/server.js",
    "backend/package.json",
    "backend/src/lib/desktopBootstrap.js",
    "backend/prisma/schema.prisma",
    "backend/prisma/migrations/migration_lock.toml",
    "backend/node_modules/.prisma/client/index.js",
  ]) assert.ok(res.files.includes(need), `${need} must still be packaged`);
});

test("build.files: the OLD denylist would fail this same check", { skip: hasBuilder() ? false : "app-builder-lib not installed (root devDeps absent)" }, async () => {
  const { resolvePackagedFiles } = await load("scripts/resolvePackagedFiles.mjs");
  // Verbatim history. Kept as a fixture so nobody can quietly go back to it.
  const OLD = [
    "electron/**/*", "backend/**/*", "frontend/dist/**/*", "CutProtocol.ico",
    "!electron/licenseTool.cjs",
    "!backend/prisma/dev.db", "!backend/prisma/dev.db-journal", "!backend/prisma/dev.db.template",
    "!backend/prisma/dev.db.backup-*", "!backend/prisma/*.db.backup*",
    "!backend/.env", "!backend/.env.local",
    "!backend/tests/**/*", "!backend/scripts/**/*", "!backend/data/*.backup*",
    "!**/*.test.js", "!**/*.map", "!**/*.backup-*",
    "!AUDIT.md", "!PABLO_REVIEW.md", "!CLAUDE*.md", "!PROGRESS.md",
    "!docs/**/*", "!release/**/*", "!.agent/**/*",
    "!**/node_modules/.cache/**/*", "!**/.git/**/*",
  ];
  const res = resolvePackagedFiles(OLD);
  assert.ok(res.available);
  // Only meaningful while the offending files still exist in the working tree;
  // if they have since been deleted there is nothing to prove and nothing to
  // leak, so assert on whichever of them is actually present.
  const present = ["backend/.env.qc", "backend/prisma/dev.db.snapshot-agentcontam-20260721-212858"]
    .filter((f) => fs.existsSync(path.join(REPO, f)));
  for (const f of present) {
    assert.ok(res.files.includes(f), `the old denylist must be shown to leak ${f} — that is why it was replaced`);
  }
});
