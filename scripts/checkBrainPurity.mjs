#!/usr/bin/env node
// Cut Protocol — Stage S / S1 brain-purity guard (v2). Keyless, dependency-free.
// The brain reaches the model ONLY through the Anthropic SDK in llm.js; it must
// contain NO web/shell/file-write/eval capability (Laws 5 & 6 — the toolset can
// read app data and call the model, nothing else). This statically asserts that
// over backend/src/lib/brain/**. A finding = red = STOP (never auto-suppress).
//
//   node scripts/checkBrainPurity.mjs        exit 0 clean · 1 finding(s)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));
const BRAIN = path.join(ROOT, "backend", "src", "lib", "brain");
const SELF = "checkBrainPurity.mjs";

// Forbidden capabilities inside the brain. Network, shell, code-eval, raw
// sockets, and file WRITES. (Reading a data file — foodOverrides/citations —
// is fine and lives in lib/, not brain/; the brain does no fs at all today.)
const RULES = [
  { id: "dangerous-require", re: /require\(\s*["'](?:child_process|net|dgram|dns|tls|http|https|vm|cluster|worker_threads|repl|inspector)["']\s*\)/, note: "require of a network/shell/vm core module" },
  { id: "dynamic-import-danger", re: /import\(\s*["'](?:child_process|net|http|https|vm|worker_threads)["']/, note: "dynamic import of a dangerous core module" },
  { id: "eval", re: /\beval\s*\(/, note: "eval()" },
  { id: "new-function", re: /new\s+Function\s*\(/, note: "new Function()" },
  { id: "shell-exec", re: /\b(?:execSync|execFileSync|exec|execFile|spawnSync|spawn|fork)\s*\(/, note: "shell/child-process execution" },
  { id: "raw-fetch", re: /(?<![.\w])fetch\s*\(/, note: "direct network fetch() (the model goes through the SDK in llm.js only)" },
  { id: "websocket", re: /\bnew\s+WebSocket\b/, note: "raw WebSocket" },
  { id: "fs-write", re: /\bfs\.(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|createWriteStream)\b/, note: "filesystem write" },
];
// Lines with this marker are intentional exceptions (there are none today).
const ALLOW = "purity:allow";

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && (e.name.endsWith(".js") || e.name.endsWith(".mjs")) && !e.name.endsWith(".test.js")) out.push(p);
  }
}

const files = [];
walk(BRAIN, files);
const findings = [];
for (const f of files) {
  if (path.basename(f) === SELF) continue;
  const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW)) continue;
    const code = line.replace(/\/\/.*$/, ""); // ignore line comments
    for (const r of RULES) if (r.re.test(code)) { findings.push({ file: path.relative(ROOT, f), line: i + 1, rule: r.id, note: r.note }); break; }
  }
}

if (!findings.length) {
  console.log(`brain-purity: clean — ${files.length} brain file(s), no web/shell/file-write/eval capability.`);
  process.exit(0);
}
console.error(`brain-purity: ${findings.length} FORBIDDEN capability(ies) in the brain (Laws 5/6):\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.note}`);
console.error(`\nThe brain must reach the model ONLY via the SDK in llm.js. Remove the capability, or (if truly intentional) append "// ${ALLOW}" with a reviewed reason.`);
process.exit(1);
