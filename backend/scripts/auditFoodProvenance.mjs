#!/usr/bin/env node
// Report duplicate-fdcId corruption in the Food table. READ ONLY — it never
// writes to the database. scripts/repairFoodProvenance.mjs applies the fixes,
// using the same decision engine (scripts/lib/provenanceAudit.js) so the
// report and the repair can never disagree.
//
//   node scripts/auditFoodProvenance.mjs             human-readable report
//   node scripts/auditFoodProvenance.mjs --json      machine-readable
//   node scripts/auditFoodProvenance.mjs --all       include non-duplicate rows
//   node scripts/auditFoodProvenance.mjs --fixture   use the committed samples
//
// Exit code is 1 when any row still claims an unverified fdcId, so CI can gate
// on it.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeLocalPrisma } = require("./lib/prismaLocal.js");
const { buildMatchIndex } = require("./lib/fdcMatch.js");
const { auditFoods } = require("./lib/provenanceAudit.js");
const { loadFoodOverrides } = require("../src/lib/foodOverrides.js");
const { CACHE_DIR } = require("./lib/fdcDataset.js");

const asJson = process.argv.includes("--json");
const showAll = process.argv.includes("--all");
const fixture = process.argv.includes("--fixture");

const indexFile = path.join(CACHE_DIR, fixture ? "fdc-index.fixture.json" : "fdc-index.json");
if (!fs.existsSync(indexFile)) {
  console.error(`Missing ${path.relative(process.cwd(), indexFile)}.\nRun: node scripts/downloadFdcDatasets.mjs && node scripts/buildFdcIndex.mjs${fixture ? " --fixture" : ""}`);
  process.exit(2);
}
const idx = JSON.parse(fs.readFileSync(indexFile, "utf8"));
const byFdcId = new Map(idx.records.map((r) => [r.fdcId, r]));
const matchIndex = buildMatchIndex(idx.records);

const prisma = makeLocalPrisma();
const foods = await prisma.food.findMany({ orderBy: { name: "asc" } });
const { decisions, duplicateGroups, summary } = auditFoods(foods, byFdcId, matchIndex, loadFoodOverrides());
await prisma.$disconnect();

if (asJson) {
  console.log(JSON.stringify({ summary, duplicateGroups, decisions: showAll ? decisions : undefined }, null, 2));
  process.exit(summary.all.downgraded ? 1 : 0);
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + "%" : "—");

console.log("=".repeat(78));
console.log("FOOD PROVENANCE AUDIT");
console.log("=".repeat(78));
console.log(`FDC reference: ${idx.records.length} records from ${idx.datasets.map((d) => d.key).join(", ")}${idx.fixture ? "  [FIXTURE SAMPLE]" : ""}`);
console.log(`Foods in table: ${summary.foods}   claiming an fdcId: ${summary.withFdcId}`);
console.log("");
console.log(`Duplicate fdcId groups : ${summary.duplicateGroupCount} groups covering ${summary.duplicateRowCount} rows`);
console.log(`  ...spanning >1 category (near-certain mismatches): ${summary.categorySpanningGroups}`);
console.log("");
console.log("VERDICTS (every row that claims an fdcId)");
const order = ["verified", "rematched", "curated", "downgraded"];
const label = {
  verified: "verified    name genuinely denotes its FDC record",
  rematched: "rematched   re-derived from the one FDC record this name denotes",
  curated: "curated     macros owned by data/foodOverrides.json",
  downgraded: "downgraded  provenance removed, macros retained but marked unverified",
};
for (const k of order) {
  const n = summary.all[k] || 0;
  console.log(`  ${String(n).padStart(4)}  ${pct(n, summary.withFdcId).padStart(6)}  ${label[k]}`);
}
console.log(`  (of the verified rows, ${summary.stateRelaxed} matched with a preparation word FDC states and the app name leaves implicit)`);
console.log("");
console.log("  in duplicate groups :", JSON.stringify(summary.inDuplicateGroups));
console.log("  singleton fdcIds    :", JSON.stringify(summary.singletons));
console.log("");

console.log("=".repeat(78));
console.log("DUPLICATE fdcId GROUPS");
console.log("=".repeat(78));
for (const g of duplicateGroups) {
  const flag = g.spansCategories ? "  ** SPANS CATEGORIES **" : "";
  console.log(`\nfdcId ${g.fdcId} — "${g.description ?? "(not in FDC datasets)"}" [${g.dataType ?? "?"}]${flag}`);
  console.log(`  ${g.members.length} rows, categories: ${g.categories.join(", ")}`);
  for (const m of g.members) {
    const mark = { verified: "  KEEP ", rematched: "  FIX  ", downgraded: "  DROP ", curated: "  CURATED", untouched: "  --   " }[m.verdict] || "  ?    ";
    console.log(`  ${mark} ${m.name}  (${m.kcal} kcal, ${m.category})`);
    console.log(`          ${m.reason}`);
  }
}

if (showAll) {
  const singles = decisions.filter((d) => d.fdcId != null && !duplicateGroups.some((g) => g.fdcId === d.fdcId));
  console.log("\n" + "=".repeat(78));
  console.log("SINGLETON fdcId ROWS");
  console.log("=".repeat(78));
  for (const d of singles.filter((s) => s.verdict !== "verified")) {
    console.log(`  [${d.verdict}] ${d.name} — fdcId ${d.fdcId} "${d.fdcDescription ?? "?"}"`);
    console.log(`          ${d.reason}`);
  }
}

console.log("\n" + "=".repeat(78));
const bad = summary.all.downgraded || 0;
if (bad) {
  console.log(`RESULT: ${bad} row(s) carry an fdcId that cannot be verified.`);
  console.log("Run: node scripts/repairFoodProvenance.mjs --apply");
} else {
  console.log("RESULT: every fdcId in the table is verified against real FDC data.");
}
process.exit(bad ? 1 : 0);
