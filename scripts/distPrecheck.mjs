#!/usr/bin/env node
// Doc 2 Stage 1 — the PERMANENT dist precheck (the M4 gate). Runs before every
// `npm run dist` (via predist) and FAILS the build loudly if the installer would
// carry secrets or personal data. Keyless, dependency-free.
//   - the shipped template DB must exist, hold ZERO personal rows / no emails
//   - the RESOLVED payload (electron-builder's own matcher, run against the real
//     tree) must carry no env file, no database, no keygen, no build junk — and
//     must still carry everything the app needs to boot
//   - no stale build artifacts may be sitting on disk waiting to be swept in
//   - no secret may sit in the code that ships
import { scanPaths } from "./scanSecrets.mjs";
import { resolvePackagedFiles } from "./resolvePackagedFiles.mjs";
import { findArtifacts } from "./cleanBuildArtifacts.mjs";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));
const fail = [];
const ok = (m) => console.log("  ok   " + m);

// 1) shipped template DB: present, zero personal rows, no real emails/keys.
const tpl = path.join(ROOT, "backend/prisma/dev.db.template");
if (!fs.existsSync(tpl)) {
  fail.push("no clean template at backend/prisma/dev.db.template — run `node backend/scripts/buildTemplateDb.mjs`");
} else {
  const txt = fs.readFileSync(tpl).toString("latin1");
  // real emails only: lowercase domain + local <=40, so cuid byte-noise like
  // "...@P.fffff" (uppercase domain, 60-char local) is NOT flagged.
  const EMAIL = /\b[A-Za-z0-9._%+-]{1,40}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,10}\b/g;
  const SAFE = /@(?:example|test|localhost|email|sample)\.|noreply@|you@/i;
  const candidates = [...new Set([...txt.matchAll(EMAIL)].map((m) => m[0]))].filter((e) => !SAFE.test(e));

  // Scanning a SQLite file as latin1 text reads the raw page bytes, so a match
  // can straddle the boundary between a legitimate value and the binary noise
  // next to it. That is not hypothetical: this gate blocked a build on
  // "themealdb-import@p.fffff", which is the real Recipe.source value
  // "themealdb-import" abutting cuid noise that happened to read as "@p.fffff".
  // The lowercase-domain/short-local guard above was written for exactly this
  // hazard and still let it through, because "p.fffff" is lowercase and "fffff"
  // is a plausible-looking 5-letter TLD.
  //
  // So confirm each candidate against the DB as DATA rather than as bytes: a
  // string that appears in no text column of any table cannot be personal data
  // the installer would carry. This makes the gate MORE accurate, not weaker —
  // a genuine address stored in a column still fails the build, and anything
  // unverifiable is reported rather than silently dropped.
  let emails = candidates;
  if (candidates.length) {
    try {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(tpl, { readOnly: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();
      const inColumns = (needle) => {
        for (const { name } of tables) {
          for (const col of db.prepare(`PRAGMA table_info("${name}")`).all()) {
            try {
              const hit = db
                .prepare(`SELECT 1 FROM "${name}" WHERE CAST("${col.name}" AS TEXT) LIKE ? LIMIT 1`)
                .get(`%${needle}%`);
              if (hit) return `${name}.${col.name}`;
            } catch { /* non-text column — skip */ }
          }
        }
        return null;
      };
      const confirmed = [];
      for (const e of candidates) {
        const where = inColumns(e);
        if (where) confirmed.push(`${e} (in ${where})`);
        else console.log(`  note byte-noise match ignored, present in no column: ${e}`);
      }
      db.close();
      emails = confirmed;
    } catch (err) {
      // Never let a verification failure downgrade the gate — fail closed.
      fail.push(`could not verify template emails against columns (${err.message}); treating as findings: ${candidates.slice(0, 3).join(", ")}`);
      emails = [];
    }
  }
  if (emails.length) fail.push(`template DB holds personal email(s): ${emails.slice(0, 3).join(", ")}`);
  else ok("template DB present, no personal emails");
  if (/sk-ant-[A-Za-z0-9]{10}/.test(txt)) fail.push("template DB contains an Anthropic key");
}

// 2) extraResources ships neither the real .env nor the real dev.db.
const pkg = require(path.join(ROOT, "package.json"));
const extra = (pkg.build && pkg.build.extraResources) || [];
let extraBad = false;
for (const e of extra) {
  const from = (typeof e === "string" ? e : e.from) || "";
  if (from === "backend/.env" || /(^|[\\/])\.env/.test(from)) { fail.push(`extraResources ships an env file (${from})`); extraBad = true; }
  if (/(^|[\\/])dev\.db$/.test(from)) { fail.push(`extraResources ships the real dev.db (${from})`); extraBad = true; }
}
if (!extraBad) ok("extraResources ships no env file / real dev.db");

// 3) THE PAYLOAD ITSELF — not the spelling of the patterns.
//
// The previous version of this check asserted that build.files CONTAINED the
// strings "!backend/.env" and "!backend/prisma/dev.db". Both were present the
// day the installer shipped backend/.env.qc and a 10-user dev.db snapshot,
// and the gate said PASS. Asserting on a denylist's contents cannot detect the
// file the denylist never heard of.
//
// So resolve what electron-builder would ACTUALLY package (its own matcher,
// against the real working tree — see resolvePackagedFiles.mjs) and assert on
// the resulting paths. A new .env.<anything> or .db.<anything> now fails here
// the moment it exists, whatever it is called.
const resolved = resolvePackagedFiles();
if (!resolved.available) {
  // Never silently downgrade — say the gate is weaker and why.
  console.log(`  note payload could not be resolved (${resolved.reason}); falling back to pattern-shape checks only`);
  const files = (pkg.build && pkg.build.files) || [];
  if (!files.some((p) => !p.startsWith("!"))) fail.push("build.files has no positive pattern — it is a denylist, and a denylist cannot be trusted");
  if (files.includes("backend/**/*")) fail.push('build.files ships all of backend/ ("backend/**/*") — enumerate what the app needs instead');
} else {
  // A name ending in a source/asset extension is code, not data — Prisma ships
  // runtime modules literally called `query_engine_bg.sqlite.js`.
  const IS_CODE = /\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|json|md|txt|wasm|map|node|html|css|svg)$/i;
  const BAD = [
    { re: /(^|\/)\.env|\.env($|[.\-])/i, why: "an environment file (secrets)" },
    { re: /\.(?:db|sqlite3|sqlite)(?=[^A-Za-z0-9]|$)/i, skipIfCode: true, why: "a database file (personal data)" },
    { re: /\.node\.tmp[0-9]*$/i, why: "an abandoned prisma engine temp copy (21 MB of dead weight)" },
    { re: /(^|\/)licenseTool\.cjs$/i, why: "the license KEYGEN — shipping it hands out the ability to mint licenses" },
    { re: /(^|\/)dev\.db\./i, why: "a database backup/snapshot" },
  ];
  const offenders = [];
  for (const f of resolved.files) {
    for (const b of BAD) {
      if (!b.re.test(f)) continue;
      if (b.skipIfCode && IS_CODE.test(f)) continue;
      offenders.push(`${f} — ${b.why}`);
      break;
    }
  }
  if (offenders.length) {
    for (const o of offenders.slice(0, 10)) fail.push(`packaged payload carries ${o}`);
    if (offenders.length > 10) fail.push(`…and ${offenders.length - 10} more file(s) of the same kind`);
  } else {
    ok(`packaged payload clean — ${resolved.files.length} files, ${(resolved.bytes / 1048576).toFixed(1)} MB, no env/db/keygen/temp-engine files`);
  }

  // The other half of an allowlist: it silently drops things too. Anything the
  // app needs at runtime that stops matching is a black-screen crash on a
  // stranger's machine, so name the required files explicitly.
  const shipped = new Set(resolved.files);
  const REQUIRED = [
    "package.json",
    "electron/main.cjs",
    "electron/preload.cjs",
    "backend/package.json",
    "backend/server.js",
    "backend/src/lib/desktopBootstrap.js",
    "backend/prisma/schema.prisma",
    "backend/prisma/migrations/migration_lock.toml",
    "backend/data/foodOverrides.json",
    "backend/data/ingredientCosts.json",
    "backend/node_modules/.prisma/client/index.js",
    "backend/node_modules/@prisma/client/default.js",
  ];
  const missing = REQUIRED.filter((f) => !shipped.has(f));
  if (missing.length) fail.push(`the app needs these at runtime and the payload does not carry them: ${missing.join(", ")}`);

  // Every migration on disk must ship — a half-shipped migration set means a
  // fresh install boots against a schema the code does not expect.
  const migRoot = path.join(ROOT, "backend/prisma/migrations");
  const onDisk = fs.existsSync(migRoot)
    ? fs.readdirSync(migRoot).filter((n) => fs.existsSync(path.join(migRoot, n, "migration.sql")))
    : [];
  const shippedMigrations = onDisk.filter((n) => shipped.has(`backend/prisma/migrations/${n}/migration.sql`));
  if (onDisk.length !== shippedMigrations.length) {
    fail.push(`${onDisk.length - shippedMigrations.length} of ${onDisk.length} migration(s) would not be packaged`);
  } else if (onDisk.length) {
    ok(`all ${onDisk.length} migrations packaged`);
  }

  // The electron/ allowlist is enumerated file by file (so the keygen can
  // never ride along). That is only safe if a NEW electron source file makes
  // this fail loudly instead of vanishing from the build.
  const electronDir = path.join(ROOT, "electron");
  if (fs.existsSync(electronDir)) {
    const src = fs.readdirSync(electronDir).filter((n) => /\.(cjs|js|mjs|html)$/i.test(n) && n !== "licenseTool.cjs");
    const unshipped = src.filter((n) => !shipped.has(`electron/${n}`));
    if (unshipped.length) fail.push(`electron/ source not in the build.files allowlist (add it, or the packaged app will crash): ${unshipped.join(", ")}`);
    else ok(`all ${src.length} electron/ source files packaged (licenseTool.cjs correctly excluded)`);
  }
}

// 4) no stale build artifacts left on disk to be swept into a future build.
const stale = findArtifacts();
if (stale.length) {
  fail.push(`${stale.length} stale build artifact(s) on disk (${(stale.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1)} MB) — run \`node scripts/cleanBuildArtifacts.mjs\``);
} else {
  ok("no stale build artifacts on disk");
}

// 5) no secret in the code that will ship.
const findings = scanPaths([path.join(ROOT, "backend/src"), path.join(ROOT, "electron"), path.join(ROOT, "backend/prisma/schema.prisma")]);
if (findings.length) for (const f of findings) fail.push(`secret in shipping code: ${f.file}:${f.line} [${f.rule}]`);
else ok("no secrets in shipping source");

if (fail.length) {
  console.error(`\ndistPrecheck: BUILD BLOCKED — ${fail.length} issue(s):`);
  for (const f of fail) console.error("  x  " + f);
  console.error("\nThe M4 gate: no secret or personal data ships. Fix the above before packaging.");
  process.exit(1);
}
console.log("\ndistPrecheck: PASS — safe to package.");
