// QC gauntlet v2 — Phase 1D allergen sweep. Deterministic, minutes, $0.
//
//   node scripts/qc/sweep14k.mjs         # report to docs/qc/allergen-sweep.md
//   node scripts/qc/sweep14k.mjs --assert # exit 1 if any leak candidate remains
//
// For every allergen category × every food name in the corpus, cross the app's
// own exclusion matcher against the QC oracle's INDEPENDENT curated list:
//   · independent says "is allergen X" but app does NOT exclude  -> LEAK candidate
//     (the TVP->soy class: a real allergen the app's list doesn't name).
//   · independent says "clearly safe" but app DOES exclude       -> FALSE-EXCLUSION
//     (over-broad synonym; own ZERO bar, checked against a held-out safe list).
// Also crosses recipe ingredient lists (the real transitive depth in this flat
// schema: recipe -> ingredient -> food) so a leak is reported at recipe level too.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ASSERT = process.argv.includes("--assert");

const { matchesExclusionTerm } = require(path.join(HERE, "..", "..", "src", "lib", "dietaryFilter.js"));
const { prisma } = require(path.join(HERE, "..", "..", "src", "lib", "prisma.js"));
const O = await import("./oracle.mjs");

const CATS = ["gluten", "shellfish", "dairy", "soy", "nuts", "eggs", "fish", "kiwi", "peanuts", "sesame"];

// Held-out KNOWN-SAFE near-misses: the app must NOT exclude these (false-exclusion
// bar). Each is a plant/analog look-alike of the category's trigger word.
const KNOWN_SAFE = {
  dairy: ["Coconut milk, raw", "Almond milk, unsweetened", "Soy milk", "Oat milk", "Butter beans, canned", "Cocoa butter", "Peanut butter, smooth"],
  nuts: ["Water chestnut, raw", "Nutmeg, ground", "Butternut squash, cooked"],
  gluten: ["Buckwheat groats", "Rice flour", "Corn tortilla"],
  peanuts: ["Tree nut mix (no peanut)"],
};

function independentSays(name, cat) {
  const audit = O.AUDIT_ALLERGENS[cat] || [cat];
  return O.hitsAny(name, audit, cat === "dairy");
}

async function main() {
  const foods = await prisma.food.findMany({ select: { id: true, name: true, source: true } });
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: { select: { name: true } } } } } });

  const leaks = {}, falseExcl = {};
  for (const c of CATS) { leaks[c] = new Map(); falseExcl[c] = []; }

  // food-level cross
  for (const f of foods) {
    for (const c of CATS) {
      const ind = independentSays(f.name, c);
      const app = matchesExclusionTerm(f.name, c);
      if (ind && !app) leaks[c].set(f.name, (leaks[c].get(f.name) || 0) + 1);
    }
  }
  // held-out false-exclusion bar
  for (const c of CATS) {
    for (const safe of KNOWN_SAFE[c] || []) {
      if (matchesExclusionTerm(safe, c)) falseExcl[c].push(safe);
    }
  }
  // recipe-level: any recipe whose ingredient leaks for a category (the food the
  // solver would ship), reported so Phase-4 fixes can see blast radius.
  const recipeLeaks = {};
  for (const c of CATS) recipeLeaks[c] = 0;
  for (const r of recipes) {
    for (const c of CATS) {
      if ((r.ingredients || []).some((ing) => independentSays(ing.food?.name || "", c) && !matchesExclusionTerm(ing.food?.name || "", c))) recipeLeaks[c]++;
    }
  }

  const L = [];
  L.push(`# Cut Protocol — 14k allergen sweep (Phase 1D)`);
  L.push("");
  L.push(`- Corpus: ${foods.length} foods · ${recipes.length} recipes · 10 allergen categories.`);
  L.push(`- Method: app matcher (dietaryFilter) vs the QC oracle's INDEPENDENT curated list.`);
  L.push("");
  let totalLeak = 0, totalFalse = 0;
  L.push(`## Leak candidates — a real allergen the app's list does NOT exclude (P0)`);
  L.push(`| category | distinct foods | recipes affected | examples |`);
  L.push(`|---|--:|--:|---|`);
  for (const c of CATS) {
    const n = leaks[c].size; totalLeak += n;
    const ex = [...leaks[c].keys()].slice(0, 3).map((x) => x.slice(0, 40)).join(" · ");
    if (n) L.push(`| **${c}** | ${n} | ${recipeLeaks[c]} | ${ex} |`);
  }
  if (!totalLeak) L.push(`| _(none)_ | 0 | 0 | every corpus food an allergen is correctly excluded |`);
  L.push("");
  L.push(`## False exclusions — a known-safe food the app WRONGLY excludes (own ZERO bar)`);
  for (const c of CATS) { if (falseExcl[c].length) { totalFalse += falseExcl[c].length; L.push(`- **${c}**: ${falseExcl[c].join(", ")}`); } }
  if (!totalFalse) L.push(`None — every held-out known-safe near-miss survived.`);
  L.push("");
  L.push(`_Generated ${new Date().toISOString()}. Leak candidates are oracle-flagged; each needs a same-day human confirm before a synonym fix (the oracle list can over-claim)._`);

  const out = path.join(REPO, "docs", "qc");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "allergen-sweep.md"), L.join("\n") + "\n");

  // full leak detail for triage
  const detail = [];
  for (const c of CATS) for (const [name, n] of leaks[c]) detail.push({ category: c, food: name, count: n });
  fs.writeFileSync(path.join(out, "allergen-sweep-detail.json"), JSON.stringify(detail, null, 0));

  console.log(`\nALLERGEN SWEEP: ${totalLeak} leak-candidate food×category pairs, ${totalFalse} false-exclusions.`);
  for (const c of CATS) if (leaks[c].size) console.log(`  ${c}: ${leaks[c].size} foods, ${recipeLeaks[c]} recipes`);
  console.log(`  report: docs/qc/allergen-sweep.md`);
  await prisma.$disconnect();
  if (ASSERT && totalLeak > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
