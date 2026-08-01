// D3 part 2 — SAFETY of any candidate-pool widening. READ-ONLY on the D3 copy.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const LIB = "C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/";
const { PrismaClient } = require("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules/@prisma/client");
const { explainExclusion, FOOD_GATE_SELECT, isExcluded } = require(LIB + "exclusionGate.js");
const { macroTrustIssue } = require(LIB + "foodValidation.js");
const prisma = new PrismaClient({ datasources: { db: { url: "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D3/d3.db" } } });
const out = []; const P = (...a) => { const s = a.join(" "); out.push(s); console.log(s); };

// ── A. Are allergenTags / mayContain REALLY empty, or just shaped oddly?
const raw = await prisma.$queryRawUnsafe(
  "SELECT COUNT(*) n, SUM(CASE WHEN allergenTags IS NULL THEN 1 ELSE 0 END) tagsNull," +
  " SUM(CASE WHEN mayContain IS NULL THEN 1 ELSE 0 END) mcNull," +
  " SUM(CASE WHEN fdcCategory IS NULL THEN 1 ELSE 0 END) catNull FROM Food"
);
P("=== A. ALLERGEN METADATA COLUMNS, RAW SQL ===");
P(JSON.stringify(raw, (k, v) => (typeof v === "bigint" ? Number(v) : v)));
const distinctTags = await prisma.$queryRawUnsafe("SELECT DISTINCT allergenTags t FROM Food LIMIT 10");
P("distinct allergenTags sample:", JSON.stringify(distinctTags));
const distinctMc = await prisma.$queryRawUnsafe("SELECT DISTINCT mayContain t FROM Food LIMIT 10");
P("distinct mayContain sample:", JSON.stringify(distinctMc));

// ── B. The 11 harsh-gate survivors: do they survive a DAIRY / vegetarian / vegan wall,
//      and what evidence does the gate actually have on them?
const all = await prisma.food.findMany({ select: FOOD_GATE_SELECT });
const harsh = { dietaryStyle: "vegan", excludedFoods: ["soy", "legumes", "gluten", "nuts", "sesame"] };
const survivors = all.filter((f) => f.protein >= 40 && !macroTrustIssue(f) && !isExcluded(f, harsh)).sort((a, b) => b.protein - a.protein);
P("\n=== B. THE 11 HIGH-PROTEIN HARSH-GATE SURVIVORS, PROBED AGAINST OTHER WALLS ===");
const probes = {
  "dairy wall": { dietaryStyle: null, excludedFoods: ["dairy"] },
  "milk wall": { dietaryStyle: null, excludedFoods: ["milk"] },
  "whey wall": { dietaryStyle: null, excludedFoods: ["whey"] },
  "egg wall": { dietaryStyle: null, excludedFoods: ["egg"] },
  "vegan style": { dietaryStyle: "vegan", excludedFoods: [] },
  "vegetarian style": { dietaryStyle: "vegetarian", excludedFoods: [] },
};
for (const f of survivors) {
  P(`\n  ${f.name}`);
  P(`    P=${f.protein} F=${f.fat} C=${f.carb} kcal=${f.kcal} src=${f.source} fdcId=${f.fdcId} cat=${JSON.stringify(f.fdcCategory)}`);
  P(`    allergenTags=${JSON.stringify(f.allergenTags)} mayContain=${JSON.stringify(f.mayContain)}`);
  const verdicts = Object.entries(probes).map(([label, p]) => {
    const v = explainExclusion(f, p);
    return `${label}=${v.excluded ? "BLOCKED" : "ALLOWED"}`;
  });
  P(`    ${verdicts.join("  ")}`);
}

// ── C. If the pool were widened by NUMERIC PROPERTY alone, what gets in?
//      Count the top-N-by-protein rows and how many are recognisably animal-derived
//      by fdcCategory (the only metadata probe that is populated at all).
P("\n=== C. WHAT A NAIVE NUMERIC WIDENING WOULD ADMIT (protein >= 40, harsh gate, trusted) ===");
const catCount = new Map();
for (const f of all.filter((x) => x.protein >= 40 && !macroTrustIssue(x))) {
  const k = f.fdcCategory || "(null)";
  catCount.set(k, (catCount.get(k) || 0) + 1);
}
P("  fdcCategory distribution across all trusted protein>=40 rows:");
for (const [k, v] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) P(`    ${String(v).padStart(3)}  ${k}`);

// ── D. LEAN-CARB widening plausibility — is the top of the numeric list edible-as-a-side?
P("\n=== D. LEAN-CARB CANDIDATES BY CATEGORY (carb>=60, fat<=3, trusted, harsh gate) ===");
const lean = all.filter((f) => f.carb >= 60 && f.fat <= 3 && !macroTrustIssue(f) && !isExcluded(f, harsh));
const leanCat = new Map();
for (const f of lean) { const k = f.category || "(null)"; leanCat.set(k, (leanCat.get(k) || 0) + 1); }
P(`  n=${lean.length}`, JSON.stringify([...leanCat.entries()].sort((a, b) => b[1] - a[1])));
const sugary = lean.filter((f) => f.carb >= 95);
P(`  of those, carb>=95 g/100g (essentially pure sugar/starch): ${sugary.length}`);

// ── E. What the CURRENT ten names cost in provenance terms
P("\n=== E. PROVENANCE OF THE TEN CURRENT CANDIDATES ===");
const NAMES = ["Olive Oil", "Butter", "Avocado", "White rice, cooked", "Potatoes", "Oats",
  "Chicken breast, cooked, skinless", "Greek Yogurt", "Tofu", "Lentils"];
const hit = await prisma.food.findMany({ where: { name: { in: NAMES } }, select: FOOD_GATE_SELECT });
for (const f of hit) {
  P(`  ${f.name.padEnd(34)} src=${(f.source || "").padEnd(14)} fdcId=${String(f.fdcId ?? "null").padStart(8)} dq=${JSON.stringify((f.dataQuality || "").slice(0, 90))}`);
}

// ── F. how many rows in the whole table would a role-tagged widening have to classify?
P("\n=== F. TABLE SHAPE ===");
P(`  total rows: ${all.length}`);
P(`  trusted (macroTrustIssue === null): ${all.filter((f) => !macroTrustIssue(f)).length}`);
P(`  quarantined: ${all.filter((f) => macroTrustIssue(f)?.code === "quarantined").length}`);
P(`  placeholder: ${all.filter((f) => macroTrustIssue(f)?.code === "placeholder").length}`);
P(`  unverified-provenance: ${all.filter((f) => macroTrustIssue(f)?.code === "unverified-provenance").length}`);

await prisma.$disconnect();
require("node:fs").writeFileSync("C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D3/d3-safety.out.txt", out.join("\n"));
