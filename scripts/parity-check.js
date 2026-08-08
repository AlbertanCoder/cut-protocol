#!/usr/bin/env node
/**
 * parity-check.js — the DONE claim has to be provable in real source.
 *
 * 1. Parse every F-ID out of MIGRATION/INVENTORY.md.
 * 2. Fail on duplicate IDs.
 * 3. Fail if any inventory ID is missing from MIGRATION/PROGRESS.md.
 * 4. For every ID marked DONE in PROGRESS.md, confirm a matching
 *    `@feature F-XXX` comment actually exists under the source directory.
 *
 * Exit 0 on pass, 1 on fail, printing which IDs failed and why.
 *
 * Deliberately uses `git grep` (not a hand-rolled walk) so the search covers
 * exactly what is TRACKED — a DONE marker sitting in an untracked scratch file
 * is not shipped code and must not satisfy the gate.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const INVENTORY = path.join(REPO, "MIGRATION", "INVENTORY.md");
const PROGRESS = path.join(REPO, "MIGRATION", "PROGRESS.md");
const SRC_DIR = "frontend/src";

const ID_RE = /\bF-\d{3,}\b/g;

function die(msg) {
  console.error(`parity-check: ${msg}`);
  process.exit(1);
}

function read(file, label) {
  if (!fs.existsSync(file)) die(`${label} not found at ${file}`);
  return fs.readFileSync(file, "utf8");
}

// ── 1. inventory IDs, in table rows only ──────────────────────────────────
// Only rows that actually look like inventory rows count. A prose mention of
// an F-ID (the "Known gaps" section names a few) must not be read as a row,
// or it registers as a duplicate of the real one.
const inventoryText = read(INVENTORY, "INVENTORY.md");
const inventoryIds = [];
for (const line of inventoryText.split(/\r?\n/)) {
  const m = /^\|\s*(F-\d{3,})\s*\|/.exec(line.trim());
  if (m) inventoryIds.push(m[1]);
}

if (inventoryIds.length === 0) die("no F-IDs found in INVENTORY.md — the table shape changed");

// ── 2. duplicates ─────────────────────────────────────────────────────────
const seen = new Map();
const duplicates = [];
for (const id of inventoryIds) {
  seen.set(id, (seen.get(id) || 0) + 1);
}
for (const [id, n] of seen) if (n > 1) duplicates.push(`${id} (${n}×)`);

// ── 3. every inventory ID present in PROGRESS.md ──────────────────────────
const progressText = read(PROGRESS, "PROGRESS.md");
const progressStatus = new Map(); // id -> STATUS
for (const line of progressText.split(/\r?\n/)) {
  const m = /^\|\s*(F-\d{3,})\s*\|\s*([A-Z_-]+)\s*\|/.exec(line.trim());
  if (m) progressStatus.set(m[1], m[2]);
}

const missingFromProgress = [...seen.keys()].filter((id) => !progressStatus.has(id));

// A PROGRESS row for an ID the inventory does not have is also a defect: it
// means an ID was renumbered or invented, which constraint 1 forbids.
const orphanedInProgress = [...progressStatus.keys()].filter((id) => !seen.has(id));

// ── 4. DONE must be provable in tracked source ────────────────────────────
function trackedSourceMentions(id) {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-l", "--fixed-strings", `@feature ${id}`, "--", SRC_DIR],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return []; // git grep exits 1 when there are no matches
  }
}

const doneIds = [...progressStatus.entries()]
  .filter(([, status]) => status === "DONE")
  .map(([id]) => id);

const unprovenDone = [];
for (const id of doneIds) {
  if (trackedSourceMentions(id).length === 0) unprovenDone.push(id);
}

// ── report ────────────────────────────────────────────────────────────────
const failures = [];
if (duplicates.length) {
  failures.push(`duplicate IDs in INVENTORY.md: ${duplicates.join(", ")}`);
}
if (missingFromProgress.length) {
  failures.push(
    `${missingFromProgress.length} inventory ID(s) missing from PROGRESS.md: ${missingFromProgress.join(", ")}`
  );
}
if (orphanedInProgress.length) {
  failures.push(
    `${orphanedInProgress.length} ID(s) in PROGRESS.md that INVENTORY.md does not have: ${orphanedInProgress.join(", ")}`
  );
}
if (unprovenDone.length) {
  failures.push(
    `${unprovenDone.length} ID(s) marked DONE with no "@feature <id>" comment in tracked ${SRC_DIR}: ${unprovenDone.join(", ")}`
  );
}

const counts = {};
for (const s of progressStatus.values()) counts[s] = (counts[s] || 0) + 1;
const summary = Object.entries(counts)
  .sort()
  .map(([k, v]) => `${k} ${v}`)
  .join(" · ");

if (failures.length) {
  console.error("PARITY CHECK FAILED\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n  inventory rows: ${inventoryIds.length} · progress rows: ${progressStatus.size}`);
  process.exit(1);
}

console.log("PARITY CHECK PASSED");
console.log(`  ${inventoryIds.length} capabilities, no duplicates, all present in PROGRESS.md`);
console.log(`  status: ${summary || "(none)"}`);
if (doneIds.length) {
  console.log(`  ${doneIds.length} DONE, each proven by an "@feature" comment in tracked ${SRC_DIR}`);
}
process.exit(0);
