#!/usr/bin/env node
// Cut Protocol — distribution safety gate (Stage 2, v2). Run BEFORE sharing an
// installer. Scans a built output tree (default: release/) for
//   (a) real SECRETS in any shipped text file (env/config templates), and
//   (b) PERSONAL DATA (email addresses) inside shipped DB/env blobs the secret
//       scanner skips as binary.
// Exit 0 = safe to share · 1 = NOT safe · 2 = no build found.
import { scanPaths } from "./scanSecrets.mjs";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));
const target = path.resolve(process.argv[2] || path.join(ROOT, "release"));

if (!fs.existsSync(target)) {
  console.error(`checkDistSafe: no build at ${path.relative(ROOT, target) || target}. Run a dist build first, then re-check.`);
  process.exit(2);
}

// 1) Secrets in any shipped TEXT file (reuses the scanner's rules).
const secretFindings = scanPaths([target]);

// 2) Personal data (emails) in shipped DB / env / template blobs.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SAFE_EMAIL = /@(?:example|test|localhost|email|sample)\.|noreply@|you@/i;
const IS_DATA = /\.(?:db|sqlite|sqlite3)(?:\.template)?$|\.template$/i;
const redact = (e) => { const [u, d] = e.split("@"); return `${u[0]}***@${d}`; };
const dbFindings = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (name !== "node_modules") walk(p); continue; }
    if (!IS_DATA.test(name)) continue;
    let buf; try { buf = fs.readFileSync(p); } catch { continue; }
    const emails = new Set();
    for (const m of buf.toString("latin1").matchAll(EMAIL)) if (!SAFE_EMAIL.test(m[0])) emails.add(m[0]);
    if (emails.size) dbFindings.push({ file: path.relative(ROOT, p), count: emails.size, sample: [...emails].slice(0, 3).map(redact) });
  }
}
walk(target);

let bad = false;
if (secretFindings.length) {
  bad = true;
  console.error(`checkDistSafe: ${secretFindings.length} SECRET(S) in the shipped build:`);
  for (const f of secretFindings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.note}`);
}
if (dbFindings.length) {
  bad = true;
  console.error(`${secretFindings.length ? "\n" : ""}checkDistSafe: PERSONAL DATA (emails) in shipped data:`);
  for (const f of dbFindings) console.error(`  ${f.file}  ${f.count} address(es), e.g. ${f.sample.join(", ")}`);
}
if (bad) {
  console.error(`\nThis build is NOT safe to share — it carries your keys and/or personal data.`);
  console.error(`It is fine to INSTALL on your own machine. For a shareable build, ship a`);
  console.error(`secretless env (fresh JWT, empty API keys) + a depersonalized seed DB in`);
  console.error(`extraResources, then re-run this check.`);
  process.exit(1);
}
console.log(`checkDistSafe: safe to share — no secrets or personal data in ${path.relative(ROOT, target) || target}.`);
process.exit(0);
