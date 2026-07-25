#!/usr/bin/env node
// Cut Protocol — distribution safety gate (Stage 2, v3). Run BEFORE sharing an
// installer. Scans a built output tree (default: release/) for
//   (a) real SECRETS in any shipped text file, INCLUDING files sealed inside
//       app.asar, and
//   (b) PERSONAL DATA in shipped SQLite/env blobs the secret scanner skips as
//       binary — emails, and (the hard rule) any User row at all.
// Exit 0 = safe to share · 1 = NOT safe · 2 = no build found.
//
// ── why v3 exists ──────────────────────────────────────────────────────────
// v2 printed "safe to share" over an installer that shipped backend/.env.qc
// (JWT secret, USDA key, the owner's seed email + cleartext password) and a
// 10-user dev.db snapshot. Three independent blind spots, all fixed here:
//
//   1. scanPaths([target]) scanned ZERO files, because "release" is in the
//      scanner's SKIP_DIR and that check fired on the passed root itself.
//      Fixed in scanSecrets.mjs (roots are never pruned).
//   2. the personal-data walk keyed on a filename ENDING in .db/.sqlite, so
//      "dev.db.snapshot-20260721-212858" was invisible. Now .db/.sqlite is
//      matched ANYWHERE in the name at a non-alphanumeric boundary — AND
//      every file is sniffed for the SQLite magic header, so a database
//      renamed to anything at all is still caught.
//   3. nothing looked inside app.asar. scanFile skips files >2 MB and files
//      containing NUL bytes, which describes every asar ever built, so the
//      archive was a blind spot the size of the whole application.
//
// The load-bearing rule is now #4 below: a shipped SQLite file must have ZERO
// rows in User. That one would have caught the snapshot whatever it was named,
// wherever it sat, however it got there.
import { scanPaths, scanText, SKIP_DIR } from "./scanSecrets.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));

// Real emails only: lowercase domain + local <=40, so cuid byte-noise like
// "...@P.fffff" (uppercase domain, 60-char local) inside a SQLite blob is not
// a false positive.
const EMAIL = /\b[A-Za-z0-9._%+-]{1,40}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,10}\b/g;
const SAFE_EMAIL = /@(?:example|test|localhost|email|sample)\.|noreply@|you@/i;
// .db / .sqlite / .sqlite3 ANYWHERE in the name, followed by a non-alphanumeric
// boundary or end-of-name. Catches dev.db, dev.db.template, dev.db-journal,
// dev.db.backup-2026…, dev.db.snapshot-agentcontam-20260721-212858. Does NOT
// catch innocuous names where the letters continue (foo.dbeaver, x.sqlitery).
const IS_DATA = /(?:\.(?:db|sqlite3|sqlite)(?=[^A-Za-z0-9]|$))|\.template$/i;
// …but a name that ENDS in a source/asset extension is code, not data. Prisma
// really does ship modules called `query_engine_bg.sqlite.js`. This only
// affects the NAME heuristic — an actual database is still caught by the magic
// header below no matter what someone called it.
const IS_CODE = /\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|json|md|txt|wasm|map|node|html|css|svg)$/i;
const isDataName = (name) => IS_DATA.test(name) && !IS_CODE.test(name);
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
// Same ceiling the secret scanner uses for on-disk files, applied to asar
// entries so the two agree about what counts as "text".
const MAX_TEXT_BYTES = 2_000_000;
// A database that big inside a build is a problem on its own; don't try to
// extract it to temp just to count rows — report it and let a human look.
const MAX_EXTRACT_BYTES = 400_000_000;

const redact = (e) => { const [u, d] = e.split("@"); return `${u[0]}***@${d}`; };
const rel = (p) => path.relative(ROOT, p) || p;

// ── SQLite inspection ──────────────────────────────────────────────────────

function openDb(file) {
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(file, { readOnly: true });
}

function isSqliteFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const b = Buffer.alloc(16);
    return fs.readSync(fd, b, 0, 16, 0) === 16 && b.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    try { if (fd !== undefined) fs.closeSync(fd); } catch { /* already closed */ }
  }
}

// RULE 4 — the one that does not depend on a filename, a directory, or an
// archive format: a SQLite file that ships must contain no users. A build
// carrying even one User row is carrying somebody's account, profile, weigh-ins
// and food logs. Returns a row count, or null when the count cannot be taken
// (which is itself a finding — fail closed).
function countUserRows(file) {
  let db;
  try {
    db = openDb(file);
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='User'").get();
    if (!has) return 0; // no User table at all — nothing personal to leak here
    return Number(db.prepare('SELECT COUNT(*) AS c FROM "User"').get().c);
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// Scanning a SQLite file as latin1 text reads raw page bytes, so an email match
// can straddle a legitimate value and the binary noise beside it. Real case that
// wrongly failed a build: "themealdb-import@p.fffff" — the true Recipe.source
// value "themealdb-import" abutting cuid noise reading as "@p.fffff". Confirm
// each candidate is really stored in a column before calling it personal data.
// This tightens the gate rather than loosening it: a genuine address in a column
// still fails, and anything unverifiable is kept as a finding (fail closed).
function confirmedInDb(file, candidates) {
  if (!candidates.size) return candidates;
  let db;
  try {
    db = openDb(file);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const kept = new Set();
    for (const email of candidates) {
      let found = false;
      for (const { name } of tables) {
        for (const col of db.prepare(`PRAGMA table_info("${name}")`).all()) {
          try {
            if (db.prepare(`SELECT 1 FROM "${name}" WHERE CAST("${col.name}" AS TEXT) LIKE ? LIMIT 1`).get(`%${email}%`)) { found = true; break; }
          } catch { /* non-text column */ }
        }
        if (found) break;
      }
      if (found) kept.add(email);
    }
    return kept;
  } catch {
    return candidates; // cannot verify -> keep the finding
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// Full personal-data check on one on-disk file. `label` is what gets printed
// (differs from the path when the file was extracted out of an .asar).
function checkDataFile(file, label, findings) {
  const sqlite = isSqliteFile(file);
  if (sqlite) {
    const users = countUserRows(file);
    if (users === null) findings.push({ file: label, detail: "SQLite file could not be opened to count User rows (treated as unsafe)" });
    else if (users > 0) findings.push({ file: label, detail: `${users} row(s) in User — a shipped database must have ZERO` });
  }
  let buf;
  try { buf = fs.readFileSync(file); } catch { return; }
  const emails = new Set();
  for (const m of buf.toString("latin1").matchAll(EMAIL)) if (!SAFE_EMAIL.test(m[0])) emails.add(m[0]);
  const real = sqlite ? confirmedInDb(file, emails) : emails;
  if (real.size) findings.push({ file: label, detail: `${real.size} email address(es), e.g. ${[...real].slice(0, 3).map(redact).join(", ")}` });
}

// ── asar inspection ────────────────────────────────────────────────────────

// @electron/asar is a TRANSITIVE dependency of electron-builder and is NOT
// declared in package.json, so it can legitimately be absent (a lean install, a
// future hoisting change). Resolve it defensively; when it is missing, fall
// back to a raw chunked scan of the archive bytes so the asar is never a blind
// spot again — worse resolution, never silence.
// CUT_PROTOCOL_NO_ASAR_LIB=1 forces the fallback path so it can be exercised
// on a machine where the library IS present — otherwise the fallback is dead
// code that nobody finds out is broken until the day it is the only thing left.
function loadAsar() {
  if (process.env.CUT_PROTOCOL_NO_ASAR_LIB === "1") return null;
  try { return require("@electron/asar"); } catch { return null; }
}

// Flatten the asar header into {path, size, unpacked, offset} records. Files
// marked `unpacked` live beside the archive in app.asar.unpacked/ and are
// already covered by the directory walk, so they carry offset null.
function asarIndex(archive, asar) {
  const raw = asar.getRawHeader(archive);
  const dataStart = 8 + raw.headerSize;
  const out = [];
  const walkNode = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) { walkNode(child, p); continue; }
      out.push({
        path: p,
        size: Number(child.size ?? 0),
        unpacked: !!child.unpacked,
        offset: child.unpacked ? null : dataStart + Number(child.offset),
      });
    }
  };
  walkNode(raw.header, "");
  return out;
}

// True when any directory segment of an in-archive path is one the on-disk
// scanner prunes (node_modules, .git, dist, …).
function skippedDir(entryPath) {
  const parts = entryPath.split("/");
  for (let i = 0; i < parts.length - 1; i++) if (SKIP_DIR.has(parts[i])) return true;
  return false;
}

function scanAsar(archive, secretFindings, dataFindings) {
  const asar = loadAsar();
  if (!asar) return rawAsarFallback(archive, secretFindings, dataFindings);
  let entries;
  try { entries = asarIndex(archive, asar); } catch (e) {
    console.error(`checkDistSafe: could not read ${rel(archive)} as an asar (${e.message}); falling back to a raw byte scan.`);
    return rawAsarFallback(archive, secretFindings, dataFindings);
  }

  const fd = fs.openSync(archive, "r");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-asar-"));
  // readSync is allowed to return short. A truncated read of an entry would
  // silently turn a leaked secret into unscanned padding, so loop to full.
  const readExact = (size, offset) => {
    const buf = Buffer.alloc(size);
    let got = 0;
    while (got < size) {
      const n = fs.readSync(fd, buf, got, size - got, offset + got);
      if (n <= 0) break;
      got += n;
    }
    return got === size ? buf : buf.subarray(0, got);
  };
  let extracted = 0;
  try {
    for (const e of entries) {
      if (e.unpacked || e.size === 0) continue; // unpacked entries are on disk already
      const label = `${rel(archive)}!${e.path}`;
      const name = path.basename(e.path);

      const head = readExact(Math.min(16, e.size), e.offset);
      const looksSqlite = head.length === 16 && head.equals(SQLITE_MAGIC);

      // A database sealed inside the asar: extract it and run the full check.
      if (looksSqlite || isDataName(name)) {
        if (e.size > MAX_EXTRACT_BYTES) {
          dataFindings.push({ file: label, detail: `${e.size} byte data file inside the archive — too large to verify automatically` });
          continue;
        }
        const tmp = path.join(tmpDir, `${extracted++}-${path.basename(e.path)}`);
        fs.writeFileSync(tmp, readExact(e.size, e.offset));
        checkDataFile(tmp, label, dataFindings);
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
        continue;
      }

      // Text entries: same size/NUL policy — and the same SKIP_DIR policy —
      // the on-disk scanner uses, so the two agree about what "a secret in a
      // shipped text file" means. Without this, four vendored dotenv READMEs
      // whose examples open a PEM private-key block fail every build forever,
      // and a gate that cries wolf gets ignored. Note the DATA
      // check above runs BEFORE this and is deliberately not pruned: a
      // database hidden under node_modules still fails.
      if (skippedDir(e.path)) continue;
      if (e.size > MAX_TEXT_BYTES) continue;
      const buf = readExact(e.size, e.offset);
      if (buf.includes(0)) continue;
      for (const f of scanText(buf.toString("utf8"), label)) secretFindings.push(f);
    }
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// No asar reader available: scan the archive as raw bytes in overlapping
// chunks. Line numbers are meaningless here, so findings are reported against
// the archive itself; that is enough to fail the build and point a human at it.
function rawAsarFallback(archive, secretFindings, dataFindings) {
  const CHUNK = 4 * 1024 * 1024;
  const OVERLAP = 4096; // a secret straddling a chunk boundary is still seen
  let fd;
  try { fd = fs.openSync(archive, "r"); } catch { return; }
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(CHUNK);
    const seen = new Set();
    let pos = 0;
    let embeddedDbs = 0;
    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      const slice = buf.subarray(0, n);
      let at = 0;
      while ((at = slice.indexOf(SQLITE_MAGIC, at)) !== -1) { embeddedDbs++; at += SQLITE_MAGIC.length; }
      for (const f of scanText(slice.toString("latin1"), rel(archive))) {
        const key = `${f.rule}`;
        if (seen.has(key)) continue;
        seen.add(key);
        secretFindings.push({ ...f, line: 0 });
      }
      pos += Math.max(1, n - OVERLAP);
    }
    if (embeddedDbs) dataFindings.push({ file: rel(archive), detail: `${embeddedDbs} embedded SQLite header(s) found by raw scan — install @electron/asar to verify their contents` });
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

// ── the run ────────────────────────────────────────────────────────────────

export function checkDist(targetPath) {
  const target = path.resolve(targetPath);
  const secretFindings = scanPaths([target]);
  const dataFindings = [];

  const visitFile = (p) => {
    const name = path.basename(p);
    if (name.toLowerCase().endsWith(".asar")) { scanAsar(p, secretFindings, dataFindings); return; }
    // Name match OR magic sniff: a database renamed to hide it is still a
    // database. The sniff is a 16-byte read, cheap enough for a build tree.
    if (!isDataName(name) && !isSqliteFile(p)) return;
    checkDataFile(p, rel(p), dataFindings);
  };

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (name !== "node_modules") walk(p); continue; }
      visitFile(p);
    }
  };

  // Accept a directory OR a single file (e.g. the template DB) as the target.
  if (fs.statSync(target).isDirectory()) walk(target);
  else visitFile(target);

  return { target, secretFindings, dataFindings };
}

function main() {
  const target = path.resolve(process.argv[2] || path.join(ROOT, "release"));
  if (!fs.existsSync(target)) {
    console.error(`checkDistSafe: no build at ${rel(target)}. Run a dist build first, then re-check.`);
    process.exit(2);
  }
  const { secretFindings, dataFindings } = checkDist(target);

  let bad = false;
  if (secretFindings.length) {
    bad = true;
    console.error(`checkDistSafe: ${secretFindings.length} SECRET(S) in the shipped build:`);
    for (const f of secretFindings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.note}`);
  }
  if (dataFindings.length) {
    bad = true;
    console.error(`${secretFindings.length ? "\n" : ""}checkDistSafe: PERSONAL DATA in shipped data files:`);
    for (const f of dataFindings) console.error(`  ${f.file}  ${f.detail}`);
  }
  if (bad) {
    console.error(`\nThis build is NOT safe to share — it carries your keys and/or personal data.`);
    console.error(`It is fine to INSTALL on your own machine. For a shareable build, ship a`);
    console.error(`secretless env (fresh JWT, empty API keys) + a depersonalized seed DB in`);
    console.error(`extraResources, then re-run this check.`);
    process.exit(1);
  }
  console.log(`checkDistSafe: safe to share — no secrets or personal data in ${rel(target)}.`);
  process.exit(0);
}

export { IS_DATA, IS_CODE, isDataName, SQLITE_MAGIC, countUserRows, isSqliteFile, scanAsar };

// Run the CLI only when invoked directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
