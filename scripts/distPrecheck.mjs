#!/usr/bin/env node
// Doc 2 Stage 1 — the PERMANENT dist precheck (the M4 gate). Runs before every
// `npm run dist` (via predist) and FAILS the build loudly if the installer would
// carry secrets or personal data. Keyless, dependency-free.
//   - the shipped template DB must exist, hold ZERO personal rows / no emails
//   - the build config must ship NO real .env and NO real dev.db
//   - no secret may sit in the code that ships
import { scanPaths } from "./scanSecrets.mjs";
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
  const emails = [...new Set([...txt.matchAll(EMAIL)].map((m) => m[0]))].filter((e) => !SAFE.test(e));
  if (emails.length) fail.push(`template DB holds personal email(s): ${emails.slice(0, 3).join(", ")}`);
  else ok("template DB present, no personal emails");
  if (/sk-ant-[A-Za-z0-9]{10}/.test(txt)) fail.push("template DB contains an Anthropic key");
}

// 2) build config ships neither the real .env nor the real dev.db.
const pkg = require(path.join(ROOT, "package.json"));
const extra = (pkg.build && pkg.build.extraResources) || [];
let extraBad = false;
for (const e of extra) {
  const from = (typeof e === "string" ? e : e.from) || "";
  if (from === "backend/.env" || /(^|[\\/])\.env$/.test(from)) { fail.push(`extraResources ships the real .env (${from})`); extraBad = true; }
  if (from === "backend/prisma/dev.db") { fail.push(`extraResources ships the real dev.db (${from})`); extraBad = true; }
}
const files = (pkg.build && pkg.build.files) || [];
for (const req of ["!backend/.env", "!backend/prisma/dev.db"]) {
  if (!files.includes(req)) fail.push(`build.files is missing the exclusion "${req}"`);
}
if (!extraBad) ok("build config ships no real .env / dev.db");

// 3) no secret in the code that will ship.
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
