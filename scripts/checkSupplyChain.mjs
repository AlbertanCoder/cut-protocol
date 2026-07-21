#!/usr/bin/env node
// Cut Protocol — Stage S / S3 supply-chain guard (v2). Keyless, dependency-free.
// Blocks the two supply-chain footguns that let arbitrary third-party code in:
//   (1) a dependency pinned to a git/http/file/github URL or a wildcard
//       (*/latest/x) — these can pull unreviewed code on any install;
//   (2) a workspace with no lockfile — installs aren't reproducible.
// Normal registry ranges (^, ~, exact) are fine and NOT flagged. Known-vuln
// scanning (`npm audit`) runs in CI where the network is available (see ci.yml).
// A finding = red = STOP.
//
//   node scripts/checkSupplyChain.mjs        exit 0 clean · 1 finding(s)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.join(import.meta.dirname, ".."));
const MANIFESTS = ["package.json", "backend/package.json", "frontend/package.json"];
// A spec that can fetch code from outside the registry, or an unbounded wildcard.
const DANGEROUS = /^(?:git\+|git:|git@|https?:|file:|github:|gitlab:|bitbucket:|link:|portal:)|:\/\/|^[*x]$|^latest$/i;

const findings = [];
let deps = 0;
for (const m of MANIFESTS) {
  const abs = path.join(ROOT, m);
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(abs, "utf8")); } catch { findings.push(`${m}: unreadable/missing package.json`); continue; }

  // (2) lockfile present next to the manifest?
  const lock = path.join(path.dirname(abs), "package-lock.json");
  if (!fs.existsSync(lock)) findings.push(`${m}: no package-lock.json (installs not reproducible)`);

  // (1) dangerous specifiers
  for (const grp of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[grp] || {})) {
      deps++;
      if (typeof spec === "string" && DANGEROUS.test(spec.trim())) findings.push(`${m}: ${name} => "${spec}" (off-registry / wildcard source)`);
    }
  }
}

if (!findings.length) {
  console.log(`supply-chain: clean — ${deps} dependencies across ${MANIFESTS.length} manifests, all registry-pinned with lockfiles.`);
  process.exit(0);
}
console.error(`supply-chain: ${findings.length} finding(s):\n`);
for (const f of findings) console.error(`  ${f}`);
console.error(`\nPin the dependency to a registry version (^/~/exact), commit a package-lock.json, and re-run.`);
process.exit(1);
