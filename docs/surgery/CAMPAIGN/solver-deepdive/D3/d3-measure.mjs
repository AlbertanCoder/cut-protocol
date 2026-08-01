// D3 — adjuster / macroCloser reachability measurement. READ-ONLY against a COPY of dev.db.
// Everything here selects by NUMERIC PROPERTY (g per 100 g), never by name (C22 lesson).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const LIB = "C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/";
const { PrismaClient } = require("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules/@prisma/client");
const { isExcluded, FOOD_GATE_SELECT, explainExclusion } = require(LIB + "exclusionGate.js");
const { macroTrustIssue } = require(LIB + "foodValidation.js");

const prisma = new PrismaClient({
  datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D3/d3.db" } },
});

// verbatim copy of planContext.js:167-178
const ADJUSTER_CANDIDATES = [
  { name: "Olive Oil", role: "fat" },
  { name: "Butter", role: "fat" },
  { name: "Avocado", role: "fat" },
  { name: "White rice, cooked", role: "carb" },
  { name: "Potatoes", role: "carb" },
  { name: "Oats", role: "carb" },
  { name: "Chicken breast, cooked, skinless", role: "protein" },
  { name: "Greek Yogurt", role: "protein" },
  { name: "Tofu", role: "protein" },
  { name: "Lentils", role: "protein" },
];
const MAX_GRAMS = { fat: 25, carb: 160, protein: 180 };

const STYLES = ["none", "mediterranean", "vegetarian", "vegan", "paleo", "keto", "carnivore", "halal", "kosher"];
const WALLS = {
  "no walls": [],
  "dairy": ["dairy"],
  "vegan+soy+legumes": ["soy", "legumes"],
  "vegan+soy+legumes+gluten+nuts+sesame": ["soy", "legumes", "gluten", "nuts", "sesame"],
};

const out = [];
const P = (...a) => { const s = a.join(" "); out.push(s); console.log(s); };

// ── 1. Does the hardcoded name list actually resolve? (exact-name, as the code does)
const rows = await prisma.food.findMany({
  where: { name: { in: ADJUSTER_CANDIDATES.map((a) => a.name) } },
  select: FOOD_GATE_SELECT,
});
const byLower = new Map();
for (const f of rows) { const k = f.name.trim().toLowerCase(); if (!byLower.has(k)) byLower.set(k, f); }

P("\n=== 1. NAME RESOLUTION (planContext.loadAdjusterFoods, exact `name in [...]`) ===");
P("rows returned by the `in` query:", rows.length, "| distinct lowercased keys:", byLower.size);
for (const c of ADJUSTER_CANDIDATES) {
  const f = byLower.get(c.name.trim().toLowerCase());
  const dupes = rows.filter((r) => r.name.trim().toLowerCase() === c.name.trim().toLowerCase()).length;
  if (!f) { P(`  MISSING  ${c.role.padEnd(7)} "${c.name}"`); continue; }
  const trust = macroTrustIssue(f);
  P(`  ok       ${c.role.padEnd(7)} "${c.name}" -> id=${f.id} dupes=${dupes} kcal=${f.kcal} P=${f.protein} F=${f.fat} C=${f.carb} src=${f.source} trust=${trust ? trust.code : "OK"}`);
  if (trust) P(`             TRUST-REJECT: ${trust.detail}`);
}

// ── 2. survivors per (style x wall) — the exact loadAdjusters() logic
P("\n=== 2. SURVIVORS PER PERSONA (loadAdjusters: name-hit && !macroTrustIssue && !isExcluded) ===");
P("style".padEnd(15), "wall".padEnd(40), "fat", "carb", "prot", " names");
const survivorCache = new Map();
for (const style of STYLES) {
  for (const [wname, wall] of Object.entries(WALLS)) {
    const profile = { dietaryStyle: style === "none" ? null : style, excludedFoods: wall };
    const kept = [];
    for (const cand of ADJUSTER_CANDIDATES) {
      const food = byLower.get(cand.name.trim().toLowerCase());
      if (!food) continue;
      if (macroTrustIssue(food)) continue;
      if (isExcluded(food, profile)) continue;
      kept.push({ role: cand.role, food });
    }
    const n = (r) => kept.filter((k) => k.role === r).length;
    survivorCache.set(`${style}|${wname}`, kept);
    P(style.padEnd(15), wname.padEnd(40), String(n("fat")).padStart(3), String(n("carb")).padStart(4), String(n("protein")).padStart(4),
      " ", kept.map((k) => k.food.name).join(", ") || "(none)");
  }
}

// ── 3. max macro the closer can deliver per persona (ceiling arithmetic)
P("\n=== 3. MAX CLOSER DELIVERY per persona (best single food x MAX_GRAMS) ===");
for (const style of ["vegan", "vegetarian", "none", "keto", "carnivore"]) {
  for (const wname of Object.keys(WALLS)) {
    const kept = survivorCache.get(`${style}|${wname}`) || [];
    const best = (role) => {
      const c = kept.filter((k) => k.role === role);
      if (!c.length) return 0;
      return Math.max(...c.map((k) => (k.food[role] || 0) * (MAX_GRAMS[role] / 100)));
    };
    P(`  ${style.padEnd(14)} ${wname.padEnd(40)} maxProteinG=${best("protein").toFixed(1)}  maxFatG=${best("fat").toFixed(1)}  maxCarbG=${best("carb").toFixed(1)}`);
  }
}

// ── 4. THE REACHABILITY WALL — by NUMERIC PROPERTY only
P("\n=== 4. REACHABILITY BY NUMERIC PROPERTY (never by name) ===");
const all = await prisma.food.findMany({ select: FOOD_GATE_SELECT });
P("Food rows total:", all.length);
const reachableIds = new Set(rows.map((r) => r.id));

const buckets = [
  ["protein >= 60 g/100g", (f) => f.protein >= 60],
  ["protein >= 40 g/100g", (f) => f.protein >= 40],
  ["protein >= 25 g/100g", (f) => f.protein >= 25],
  ["protein >= 25 AND fat <= 5 (lean protein)", (f) => f.protein >= 25 && f.fat <= 5],
  ["fat >= 50 g/100g", (f) => f.fat >= 50],
  ["fat >= 80 g/100g (near-pure fat)", (f) => f.fat >= 80],
  ["carb >= 60 AND fat <= 3 (lean carb)", (f) => f.carb >= 60 && f.fat <= 3],
  ["carb >= 70 g/100g", (f) => f.carb >= 70],
];
P("\nbucket".padEnd(45), "rows", " reachable-today");
for (const [label, pred] of buckets) {
  const hits = all.filter(pred);
  P(label.padEnd(45), String(hits.length).padStart(5), String(hits.filter((h) => reachableIds.has(h.id)).length).padStart(8));
}

// ── 5. of the high-protein rows, how many are USABLE (trust + vegan-hostile persona gate)
P("\n=== 5. HIGH-PROTEIN ROWS THAT PASS TRUST + THE HARSHEST PERSONA GATE ===");
const harsh = { dietaryStyle: "vegan", excludedFoods: ["soy", "legumes", "gluten", "nuts", "sesame"] };
const veganOnly = { dietaryStyle: "vegan", excludedFoods: [] };
const tiers = [
  ["protein >= 60", (f) => f.protein >= 60],
  ["protein >= 40", (f) => f.protein >= 40],
  ["protein >= 25 && fat <= 5", (f) => f.protein >= 25 && f.fat <= 5],
];
for (const [label, pred] of tiers) {
  const hits = all.filter(pred);
  const trusted = hits.filter((f) => !macroTrustIssue(f));
  const vegan = trusted.filter((f) => !isExcluded(f, veganOnly));
  const harshOk = trusted.filter((f) => !isExcluded(f, harsh));
  P(`${label.padEnd(28)} total=${String(hits.length).padStart(4)} trusted=${String(trusted.length).padStart(4)} vegan-clean=${String(vegan.length).padStart(4)} harshest-persona-clean=${String(harshOk.length).padStart(4)}`);
}

// ── 6. top rows by protein that pass the harshest gate + trust — the C22 verification
P("\n=== 6. TOP 30 BY PROTEIN/100g THAT PASS TRUST AND THE HARSHEST VEGAN PERSONA ===");
const c22 = all
  .filter((f) => f.protein >= 40 && !macroTrustIssue(f) && !isExcluded(f, harsh))
  .sort((a, b) => b.protein - a.protein)
  .slice(0, 30);
for (const f of c22) {
  P(`  P=${f.protein.toFixed(1).padStart(5)} F=${String(f.fat).padStart(5)} C=${String(f.carb).padStart(5)} kcal=${String(f.kcal).padStart(5)} | src=${(f.source || "").padEnd(14)} fdcId=${String(f.fdcId ?? "null").padStart(7)} | ${f.name}`);
  P(`        dataQuality=${JSON.stringify((f.dataQuality || "").slice(0, 110))}`);
}

// ── 7. same, WITHOUT trust filter — what trust alone is costing
P("\n=== 7. TOP 15 BY PROTEIN PASSING THE HARSHEST GATE BUT FAILING macroTrustIssue ===");
const untrusted = all
  .filter((f) => f.protein >= 40 && macroTrustIssue(f) && !isExcluded(f, harsh))
  .sort((a, b) => b.protein - a.protein).slice(0, 15);
for (const f of untrusted) {
  P(`  P=${f.protein.toFixed(1).padStart(5)} src=${(f.source || "").padEnd(14)} issue=${macroTrustIssue(f).code.padEnd(22)} | ${f.name}`);
}

// ── 8. lean-carb and pure-fat reachability under the harshest gate
P("\n=== 8. TOP 12 LEAN-CARB (carb>=60, fat<=3) AND TOP 12 FAT (fat>=80) UNDER HARSHEST GATE + TRUST ===");
for (const [label, pred, key] of [["LEAN CARB", (f) => f.carb >= 60 && f.fat <= 3, "carb"], ["FAT", (f) => f.fat >= 80, "fat"]]) {
  P(` -- ${label}`);
  const hits = all.filter((f) => pred(f) && !macroTrustIssue(f) && !isExcluded(f, harsh)).sort((a, b) => b[key] - a[key]).slice(0, 12);
  P(`    count passing all three: ${all.filter((f) => pred(f) && !macroTrustIssue(f) && !isExcluded(f, harsh)).length}`);
  for (const f of hits) P(`    ${key}=${String(f[key]).padStart(5)} kcal=${String(f.kcal).padStart(5)} src=${(f.source || "").padEnd(13)} | ${f.name}`);
}

// ── 9. provenance distribution of the reachable set vs the candidate set
P("\n=== 9. PROVENANCE (source) DISTRIBUTION ===");
const dist = new Map();
for (const f of all) dist.set(f.source, (dist.get(f.source) || 0) + 1);
P("  whole table:", [...dist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
const hp = all.filter((f) => f.protein >= 40);
const dist2 = new Map();
for (const f of hp) dist2.set(f.source, (dist2.get(f.source) || 0) + 1);
P("  protein>=40:", [...dist2.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));

// ── 10. what the closer's protein ceiling means per candidate row (does 180g clear a floor?)
P("\n=== 10. PROTEIN DELIVERED AT MAX_GRAMS.protein = 180 g, top rows under harshest gate ===");
for (const f of c22.slice(0, 12)) {
  P(`  ${(f.protein * 1.8).toFixed(1).padStart(6)} g protein  (+${(f.kcal * 1.8).toFixed(0).padStart(5)} kcal, +${(f.fat * 1.8).toFixed(1)} g fat, +${(f.carb * 1.8).toFixed(1)} g carb) | ${f.name}`);
}

// ── 11. allergen metadata coverage on the candidate pool (safety for any widening)
P("\n=== 11. ALLERGEN METADATA COVERAGE (what a widened gate would be relying on) ===");
const withTags = all.filter((f) => f.allergenTags && String(f.allergenTags).trim() && String(f.allergenTags) !== "[]").length;
const withMayContain = all.filter((f) => f.mayContain && String(f.mayContain).trim() && String(f.mayContain) !== "[]").length;
const withCat = all.filter((f) => f.fdcCategory && String(f.fdcCategory).trim()).length;
P(`  rows with allergenTags: ${withTags}/${all.length} (${(withTags / all.length * 100).toFixed(1)}%)`);
P(`  rows with mayContain:   ${withMayContain}/${all.length} (${(withMayContain / all.length * 100).toFixed(1)}%)`);
P(`  rows with fdcCategory:  ${withCat}/${all.length} (${(withCat / all.length * 100).toFixed(1)}%)`);
const hpTags = hp.filter((f) => f.allergenTags && String(f.allergenTags).trim() && String(f.allergenTags) !== "[]").length;
const hpCat = hp.filter((f) => f.fdcCategory && String(f.fdcCategory).trim()).length;
P(`  protein>=40 with allergenTags: ${hpTags}/${hp.length}   with fdcCategory: ${hpCat}/${hp.length}`);

await prisma.$disconnect();
const fs = require("node:fs");
fs.writeFileSync("C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D3/d3-measure.out.txt", out.join("\n"));
