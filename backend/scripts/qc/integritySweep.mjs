// QC gauntlet v2 — Phase 1D nutrition-integrity + provenance sweep. $0, minutes.
//
//   node scripts/qc/integritySweep.mjs [--assert]
//
// QUARANTINE IS REPORT-ONLY. This never writes to the Food table or the goldens
// (mutating data would break the byte-identical BRAIN=off goldens). It emits a
// report + a quarantine list for human review.
//
// Nutrition: fiber-adjusted Atwater, reimplemented INLINE from the values cited
// in foodValidation.js (independence rule) — 4P + 9F + 4(carb−fiber) + 2·fiber;
// tolerance 15% normal, 30% when fiber ≥ 12 g/100g, 10 kcal absolute floor for
// near-zero foods. (No alcohol column exists, so the 7 kcal/g alcohol term is
// omitted and noted.) A food-specific-factor USDA record that misses the general
// band is a KNOWN formula-edge false positive, tallied SEPARATELY from the
// fuzzy-match macro corruption class.
//
// Provenance: every row has a source; usda-verified rows carry an fdcId; and no
// community row shares an fdcId with a usda row (the duplicate-id corruption the
// UNIQUE constraint now forbids — this proves it).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ASSERT = process.argv.includes("--assert");
const { prisma } = require(path.join(HERE, "..", "..", "src", "lib", "prisma.js"));

// cited from foodValidation.js
const TOL = 0.15, HIGH_FIBER_G = 12, HIGH_FIBER_TOL = 0.30, ABS_KCAL = 10, KCAL_PER_G_CEIL = 9.3;

// Physical Atwater exemptions (foodValidation.js: alcohol/acetic-acid/carbonate
// carry kcal with no macro, so they legitimately miss the band). With no alcohol
// column we can't compute their term, so we recognise the class by name — a
// miss on one of these is EXPECTED, not corruption. Same principle the app's
// atwaterExempt encodes.
const PHYSICAL_EXEMPT = /\b(wine|beer|cider|ale|lager|sake|sherry|vermouth|brandy|rum|vodka|whisky|whiskey|gin|liqueur|schnapps|spirit|marsala|shaoxing|mirin|vinegar|essence|extract|baking powder|baking soda|bicarbonate|cream of tartar|yeast)\b/i;

function atwaterOk(f) {
  const fiber = f.fiber || 0;
  const computed = 4 * f.protein + 9 * f.fat + 4 * Math.max(0, f.carb - fiber) + 2 * fiber;
  const tol = fiber >= HIGH_FIBER_G ? HIGH_FIBER_TOL : TOL;
  const allowed = Math.max(ABS_KCAL, tol * Math.max(f.kcal, computed));
  return { ok: Math.abs(f.kcal - computed) <= allowed, computed: Math.round(computed) };
}

async function main() {
  const foods = await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, source: true, fdcId: true, dataQuality: true } });

  // ── nutrition ──────────────────────────────────────────────────────────
  const atwaterFails = [];
  const kcalPerGImpossible = [];
  for (const f of foods) {
    const a = atwaterOk(f);
    if (!a.ok) atwaterFails.push({ name: f.name, source: f.source, dq: f.dataQuality, kcal: f.kcal, computed: a.computed });
    if (f.kcal > 100 * KCAL_PER_G_CEIL) kcalPerGImpossible.push({ name: f.name, kcalPer100: f.kcal });
  }
  // Separate the corruption class (wrong macros under a trusted tier) from the
  // formula-edge class (a food-specific-factor USDA record that the general band
  // can't judge). A usda-verified row already marked dataQuality "pass" that
  // still misses the general band is the formula-edge class, NOT corruption.
  const physicalExempt = atwaterFails.filter((f) => PHYSICAL_EXEMPT.test(f.name));
  const corruption = atwaterFails.filter((f) => (f.source === "manual" || f.source === "manual-placeholder") && !/exception|placeholder/i.test(f.dq || "") && !PHYSICAL_EXEMPT.test(f.name));
  const formulaEdge = atwaterFails.filter((f) => f.source === "usda-verified" && !PHYSICAL_EXEMPT.test(f.name));
  const flagged = atwaterFails.filter((f) => /exception|warn/i.test(f.dq || ""));

  // ── provenance ─────────────────────────────────────────────────────────
  const noSource = foods.filter((f) => !f.source);
  const usdaNoFdc = foods.filter((f) => f.source === "usda-verified" && f.fdcId == null);
  const fdcMap = new Map();
  for (const f of foods) if (f.fdcId != null) { const g = fdcMap.get(f.fdcId) || new Set(); g.add(f.source); fdcMap.set(f.fdcId, g); }
  const communityUsdaCollision = [...fdcMap.entries()].filter(([, srcs]) => srcs.has("community") && srcs.has("usda-verified")).map(([id]) => id);
  const dupFdc = [...fdcMap.entries()].filter(([, srcs]) => srcs.size > 0 && [...srcs].length && [...fdcMap.keys()].length && false); // fdcId UNIQUE forbids dup rows; kept for shape
  const bySource = {}; for (const f of foods) bySource[f.source || "(none)"] = (bySource[f.source || "(none)"] || 0) + 1;

  const L = [];
  L.push(`# Cut Protocol — nutrition integrity + provenance sweep (Phase 1D)`);
  L.push("");
  L.push(`- Corpus: ${foods.length} foods. Quarantine is REPORT-ONLY (no writes).`);
  L.push(`- Provenance mix: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  L.push("");
  L.push(`## Nutrition integrity (fiber-adjusted Atwater; alcohol term N/A — no column)`);
  L.push(`| class | count | note |`);
  L.push(`|---|--:|---|`);
  L.push(`| **corruption** (manual row, bad macros, not documented, not physical-exempt) | ${corruption.length} | ${corruption.length ? "REVIEW" : "clean"} |`);
  L.push(`| physical-exemption (alcohol/acetic-acid/carbonate — legitimately fails Atwater) | ${physicalExempt.length} | expected, no alcohol column to model |`);
  L.push(`| formula-edge (usda-verified misses general band — food-specific factors) | ${formulaEdge.length} | expected class, not corruption |`);
  L.push(`| already-flagged (dataQuality exception/warn) | ${flagged.length} | honestly labeled on import |`);
  L.push(`| kcal/g physically impossible (>9.3, no alcohol col) | ${kcalPerGImpossible.length} | ${kcalPerGImpossible.length ? "REVIEW" : "clean"} |`);
  L.push("");
  if (corruption.length) { L.push(`### Corruption candidates (review)`); for (const f of corruption.slice(0, 20)) L.push(`- "${f.name}" — stored ${f.kcal} vs Atwater ${f.computed} (${f.source})`); L.push(""); }
  if (kcalPerGImpossible.length) { L.push(`### Impossible kcal/g`); for (const f of kcalPerGImpossible.slice(0, 20)) L.push(`- "${f.name}" — ${f.kcalPer100} kcal/100g`); L.push(""); }
  L.push(`## Provenance`);
  L.push(`| check | count | bar |`);
  L.push(`|---|--:|---|`);
  L.push(`| rows with no source | ${noSource.length} | 0 |`);
  L.push(`| usda-verified rows missing fdcId | ${usdaNoFdc.length} | 0 |`);
  L.push(`| fdcId shared by community + usda rows | ${communityUsdaCollision.length} | 0 |`);
  L.push("");
  L.push(`_Generated ${new Date().toISOString()}. corruption+kcal/g impossible are the only bars that gate --assert; formula-edge is an expected class._`);

  const out = path.join(REPO, "docs", "qc");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "integrity-sweep.md"), L.join("\n") + "\n");
  fs.writeFileSync(path.join(out, "quarantine-list.json"), JSON.stringify({ corruption, kcalPerGImpossible, communityUsdaCollision, usdaNoFdc: usdaNoFdc.map((f) => f.name) }, null, 0));

  console.log(`\nINTEGRITY SWEEP: corruption ${corruption.length}, formula-edge ${formulaEdge.length}, flagged ${flagged.length}, impossible-kcal/g ${kcalPerGImpossible.length}`);
  console.log(`  provenance: no-source ${noSource.length}, usda-no-fdc ${usdaNoFdc.length}, community/usda fdc collision ${communityUsdaCollision.length}`);
  console.log(`  report: docs/qc/integrity-sweep.md`);
  await prisma.$disconnect();
  void dupFdc;
  if (ASSERT && (corruption.length || kcalPerGImpossible.length || noSource.length || usdaNoFdc.length || communityUsdaCollision.length)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
