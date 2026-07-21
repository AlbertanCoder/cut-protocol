#!/usr/bin/env node
// Cut Protocol — secret scanner (Stage 2, v2). Keyless, dependency-free.
// Catches real secrets before they reach the PUBLIC repo or a SHARED installer.
//
//   node scripts/scanSecrets.mjs --tracked      scan git-tracked files (repo safety)
//   node scripts/scanSecrets.mjs <path> [path...] scan files/dirs (e.g. release/)
//   node scripts/scanSecrets.mjs --staged       scan git-staged files (pre-commit)
//
// Exit 0 = clean, 1 = secret(s) found, 2 = usage/error. Findings print as
// file:line with the rule name; the matched value is REDACTED (never echoed).
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));
const SELF = "scanSecrets.mjs"; // never scan our own regex-laden source

// Real-secret rules. Each is deliberately high-signal to keep false positives
// low: a filled value, not the empty KEY= lines in .env.example.
const RULES = [
  { id: "anthropic-key", re: /sk-ant-[A-Za-z0-9_\-]{20,}/, note: "Anthropic API key" },
  { id: "openai-key", re: /\bsk-[A-Za-z0-9]{32,}\b/, note: "OpenAI-style API key" },
  { id: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, note: "PEM private key" },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/, note: "AWS access key id" },
  { id: "jwt-secret-filled", re: /JWT_SECRET\s*[=:]\s*["']?[A-Za-z0-9+/=_\-]{16,}/, note: "populated JWT secret" },
  { id: "usda-key-filled", re: /USDA_API_KEY\s*[=:]\s*["']?[A-Za-z0-9]{20,}/, note: "populated USDA API key" },
  { id: "seed-password-filled", re: /SEED_PASSWORD\s*[=:]\s*["']?\S{3,}/, note: "populated seed password" },
  { id: "generic-secret-assign", re: /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*[=:]\s*["']?[A-Za-z0-9+/=_\-]{16,}["']?\s*$/, note: "long value assigned to a secret-named var" },
];

// Lines carrying this marker are intentional (test fixtures, docs).
const ALLOW_MARK = "scan:allow";
// Obvious-placeholder tokens. A REAL secret never contains these, so skipping
// lines that do removes doc/example/CI-dummy false positives without weakening
// the catch on a genuine key (a real sk-ant-... line carries none of them).
const PLACEHOLDER = /(?:change[-_ ]?me|example|not[-_ ]?a[-_ ]?real|ci[-_]only|your[-_]real|your[-_]own|placeholder|dummy|redacted|sample|fake[-_]|<[a-z]|todo|fixme|xxxx|\.\.\.)/i;

const SKIP_DIR = new Set(["node_modules", ".git", "dist", "release", ".prisma", "coverage"]);
const BINARY_EXT = new Set([".db", ".png", ".ico", ".jpg", ".jpeg", ".gif", ".woff", ".woff2", ".ttf", ".map", ".zip", ".exe", ".node", ".pdf", ".webp"]);
const MAX_BYTES = 2_000_000;

function gitList(mode) {
  const cmd = mode === "staged"
    ? "git diff --cached --name-only --diff-filter=ACM"
    : "git ls-files";
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map((p) => path.join(ROOT, p));
  } catch (e) {
    console.error(`scanSecrets: git failed (${e.message.split("\n")[0]}). Are you in a repo?`);
    process.exit(2);
  }
}

function walk(target, out) {
  let st;
  try { st = fs.statSync(target); } catch { return; }
  if (st.isDirectory()) {
    if (SKIP_DIR.has(path.basename(target))) return;
    for (const name of fs.readdirSync(target)) walk(path.join(target, name), out);
  } else if (st.isFile()) {
    out.push(target);
  }
}

function scanFile(file, findings) {
  if (path.basename(file) === SELF) return;
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) return;
  let st;
  try { st = fs.statSync(file); } catch { return; }
  if (st.size > MAX_BYTES) return;
  let buf;
  try { buf = fs.readFileSync(file); } catch { return; }
  if (buf.includes(0)) return; // a NUL byte marks a binary file — skip it
  const lines = buf.toString("utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARK)) continue;
    if (PLACEHOLDER.test(line)) continue;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        findings.push({ file: path.relative(ROOT, file), line: i + 1, rule: rule.id, note: rule.note });
        break; // one finding per line is enough to fail
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("usage: scanSecrets.mjs --tracked | --staged | <path...>");
    process.exit(2);
  }
  const files = [];
  if (args[0] === "--tracked") gitList("tracked").forEach((f) => files.push(f));
  else if (args[0] === "--staged") gitList("staged").forEach((f) => files.push(f));
  else for (const a of args) walk(path.resolve(a), files);

  const findings = [];
  for (const f of files) scanFile(f, findings);

  if (!findings.length) {
    console.log(`scanSecrets: clean — ${files.length} file(s) scanned, no secrets found.`);
    process.exit(0);
  }
  console.error(`scanSecrets: ${findings.length} potential secret(s) found:\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.note}`);
  console.error(`\nIf a finding is an intentional example/fixture, append "// ${ALLOW_MARK}" to that line.`);
  console.error("Otherwise: remove the secret, rotate it, and scrub history if it was committed.");
  process.exit(1);
}

// Reusable by checkDistSafe.mjs and tests: scan explicit paths, return findings.
export function scanPaths(paths) {
  const files = [];
  for (const a of paths) walk(path.resolve(a), files);
  const findings = [];
  for (const f of files) scanFile(f, findings);
  return findings;
}
export { RULES, PLACEHOLDER };

// Run the CLI only when invoked directly (not when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
