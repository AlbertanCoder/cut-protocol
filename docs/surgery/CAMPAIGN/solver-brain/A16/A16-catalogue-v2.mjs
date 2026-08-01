// A16-catalogue-v2.mjs — SIMULATED enrichment catalogue, v2.
//
// v1 (A16-catalogue.mjs, kept on disk unchanged — docs/surgery/CAMPAIGN is
// create-only) produced degenerate rows: "Soy Sauce with Allspice", 90 g of
// ground allspice as a carbohydrate base. Every ingredient was a real Food row
// used by >= 2 real recipes, so the "real rows only" rule was satisfied and the
// output was still nonsense. The rule was necessary and not sufficient.
//
// v2 adds the missing constraint, taken from the library's own authoring
// precedent rather than from my judgement:
//
//   NO SYNTHETIC RECIPE MAY USE A FOOD AT MORE GRAMS THAN THE EXISTING
//   910-RECIPE LIBRARY ALREADY USES IT AT, and a food whose MEDIAN real use is
//   under MIN_MEDIAN_G is a seasoning, not a bulk ingredient, and cannot be an
//   anchor or a base.
//
// That one rule removes allspice-as-bulk and soy-sauce-as-protein without a
// hand-curated allowlist. Everything else is unchanged from v1:
//   · ingredients are REAL Food rows; macros are the SUM of their stored values
//     x grams/100 (oracle.mjs's arithmetic). Nothing is authored.
//   · recipes are aimed at the corner's OWN measured target ratio centroid, so
//     the curve they produce is an UPPER BOUND on real authoring.
//
//   node A16-catalogue-v2.mjs --baseline=<abs baseline.jsonl>

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareAgentDb, assertIsolated, REPO } from "../A1/rig/dbcopy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

prepareAgentDb("A16");
assertIsolated("A16");

const require = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const gate = require(path.join(B, "src/lib/exclusionGate.js"));
const foodVal = require(path.join(B, "src/lib/foodValidation.js"));
const { prisma } = require(path.join(B, "src/lib/prisma.js"));

const CORNERS = ["vegetarian", "vegan", "none"];
const MIN_USES = 2;          // food must already appear in >= 2 library recipes
const MIN_MEDIAN_G = 25;     // below this a food is a seasoning, not a bulk row
const PER_CORNER = 80;
const MEAL_KCAL = [380, 750];
const SNACK_KCAL = [140, 330];
const MEAL_SHARE = 0.75;     // personas run ~3 meals : 1 snack

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function targetCentroids(baselinePath) {
  const rows = fs.readFileSync(baselinePath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const by = new Map();
  for (const r of rows) {
    if (!r.judged || r.satisfiable === false) continue;
    const t = r.target; if (!t || !t.kcal) continue;
    const k = r.dietStyle || "none";
    if (!by.has(k)) by.set(k, { p: [], f: [], c: [] });
    by.get(k).p.push(((t.proteinLo + t.proteinHi) / 2) / t.kcal * 100);
    by.get(k).f.push(((t.fatLo + t.fatHi) / 2) / t.kcal * 100);
    by.get(k).c.push(((t.carbLo + t.carbHi) / 2) / t.kcal * 100);
  }
  const out = {};
  for (const [k, v] of by) out[k] = { p: median(v.p), f: median(v.f), c: median(v.c), n: v.p.length };
  const all = { p: [], f: [], c: [] };
  for (const v of by.values()) { all.p.push(...v.p); all.f.push(...v.f); all.c.push(...v.c); }
  out.__all = { p: median(all.p), f: median(all.f), c: median(all.c), n: all.p.length };
  return out;
}

async function main() {
  const baselinePath = path.resolve(String(argv.baseline));
  const centroids = targetCentroids(baselinePath);

  const foods = await prisma.food.findMany({ select: { ...gate.FOOD_GATE_SELECT, fiber: true } });
  // Real authoring precedent, per food: how many recipes use it and at what grams.
  const ingRows = await prisma.recipeIngredient.findMany({ select: { foodId: true, baseGrams: true } });
  const useG = new Map();
  for (const r of ingRows) { if (!useG.has(r.foodId)) useG.set(r.foodId, []); useG.get(r.foodId).push(r.baseGrams); }
  const usage = new Map();
  for (const [id, gs] of useG) usage.set(id, { n: gs.length, med: median(gs), max: Math.max(...gs) });

  const catalogue = {};
  const report = [];

  for (const corner of CORNERS) {
    const style = corner === "none" ? null : corner;
    const profile = { dietaryStyle: style, excludedFoods: [] };
    const pool = foods.filter((f) => {
      const u = usage.get(f.id);
      if (!u || u.n < MIN_USES) return false;
      if (!(f.kcal > 0) || f.protein == null || f.fat == null || f.carb == null) return false;
      if (foodVal.macroTrustIssue(f)) return false;
      if (gate.isExcluded(f, profile)) return false;
      return true;
    });
    const bulk = pool.filter((f) => usage.get(f.id).med >= MIN_MEDIAN_G);

    const dens = (f) => ({ p: (f.protein / f.kcal) * 100, f: (f.fat / f.kcal) * 100, c: (f.carb / f.kcal) * 100 });
    const anchors = bulk.filter((f) => dens(f).p >= 6 && f.kcal >= 40).sort((a, b) => dens(b).p - dens(a).p).slice(0, 40);
    const bases = bulk.filter((f) => dens(f).c >= 8 && dens(f).f <= 3.5 && f.kcal >= 40).sort((a, b) => dens(b).c - dens(a).c).slice(0, 30);
    const vegs = pool.filter((f) => f.kcal > 0 && f.kcal <= 60 && dens(f).f <= 2.5 && usage.get(f.id).med >= 20)
      .sort((a, b) => a.kcal - b.kcal).slice(0, 10);

    const tgt = centroids[corner] || centroids.__all;
    // protein weighted hardest (A11: protein is the scarcest ratio), carbs kept
    // in the objective because dayTolerance() grades all four macros.
    const dist = (p, f, c) => Math.sqrt(4 * (p - tgt.p) ** 2 + (f - tgt.f) ** 2 + 0.5 * (c - tgt.c) ** 2);
    const GRID = [20, 30, 45, 60, 80, 100, 125, 150, 200, 250, 300];
    const capped = (f) => { const m = usage.get(f.id).max; return GRID.filter((g) => g <= m); };

    const cands = [];
    for (const a of anchors) {
      const GA = capped(a); if (!GA.length) continue;
      for (const b of bases) {
        if (b.id === a.id) continue;
        const GB = [0, ...capped(b)];
        for (const v of vegs) {
          if (v.id === a.id || v.id === b.id) continue;
          const GV = [0, ...capped(v).filter((g) => g <= 150)];
          for (const band of [["meal", MEAL_KCAL], ["snack", SNACK_KCAL]]) {
            let best = null;
            for (const ga of GA) for (const gb of GB) for (const gv of GV) {
              const kcal = (a.kcal * ga + b.kcal * gb + v.kcal * gv) / 100;
              if (kcal < band[1][0] || kcal > band[1][1]) continue;
              const P = (a.protein * ga + b.protein * gb + v.protein * gv) / 100;
              const F = (a.fat * ga + b.fat * gb + v.fat * gv) / 100;
              const C = (a.carb * ga + b.carb * gb + v.carb * gv) / 100;
              const d = dist((P / kcal) * 100, (F / kcal) * 100, (C / kcal) * 100);
              if (!best || d < best.d) best = { d, ga, gb, gv, kcal, P, F, C, slotType: band[0] };
            }
            if (best) cands.push({ a, b, v, ...best });
          }
        }
      }
    }
    cands.sort((x, y) => x.d - y.d || x.a.name.localeCompare(y.a.name) || x.b.name.localeCompare(y.b.name));

    const perAnchor = new Map(), perBase = new Map(), seenNames = new Set();
    const wantMeal = Math.round(PER_CORNER * MEAL_SHARE);
    let nMeal = 0, nSnack = 0;
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= PER_CORNER) break;
      if (c.slotType === "meal" && nMeal >= wantMeal) continue;
      if (c.slotType === "snack" && nSnack >= PER_CORNER - wantMeal) continue;
      if ((perAnchor.get(c.a.id) || 0) >= 4) continue;
      if ((perBase.get(c.b.id) || 0) >= 5) continue;
      // dedupe on the ingredient NAME set — "Allspice" and "Ground Allspice" are
      // two rows for one food and must not become two recipes.
      const key = [c.a.name, c.gb > 0 ? c.b.name : "", c.gv > 0 ? c.v.name : "", c.slotType]
        .map((s) => s.toLowerCase().replace(/\b(ground|raw|cooked|dried|fresh|whole)\b/g, "").replace(/[^a-z]/g, "")).sort().join("|");
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      perAnchor.set(c.a.id, (perAnchor.get(c.a.id) || 0) + 1);
      perBase.set(c.b.id, (perBase.get(c.b.id) || 0) + 1);
      if (c.slotType === "meal") nMeal++; else nSnack++;
      chosen.push(c);
    }

    const recipes = chosen.map((c, i) => {
      const ings = [
        { foodId: c.a.id, baseGrams: c.ga, role: "protein", food: c.a },
        c.gb > 0 ? { foodId: c.b.id, baseGrams: c.gb, role: "carb", food: c.b } : null,
        c.gv > 0 ? { foodId: c.v.id, baseGrams: c.gv, role: "veg", food: c.v } : null,
      ].filter(Boolean).map((x, j) => ({ id: `A16-syn-${corner}-${i}-i${j}`, recipeId: `A16-syn-${corner}-${i}`, scalable: true, ...x }));
      const nm = [c.a.name, c.gb > 0 ? c.b.name : null, c.gv > 0 ? c.v.name : null].filter(Boolean).join(" with ");
      return {
        id: `A16-syn-${corner}-${i}`,
        name: `${nm} [A16 ${corner} #${i}]`,
        description: null, steps: [],
        slotType: c.slotType, cuisine: null, prepTimeMin: 20, source: "curated", mealCategory: null,
        kcal: c.kcal, protein: c.P, fat: c.F, carb: c.C,
        tasteTier: null, tasteTierSource: null, userRatingAvg: null, userRatingCount: null,
        costPerServing: null, difficulty: null, filterProvenance: null,
        aiFingerprint: null, aiVerifiedAt: null, createdAt: new Date(0).toISOString(), createdByUserId: null,
        ingredients: ings,
        _a16: { corner, rank: i, ratioDist: c.d, pDen: (c.P / c.kcal) * 100, fDen: (c.F / c.kcal) * 100, cDen: (c.C / c.kcal) * 100 },
      };
    });

    catalogue[corner] = recipes;
    report.push({
      corner, poolFoods: pool.length, bulkFoods: bulk.length, anchors: anchors.length, bases: bases.length, vegs: vegs.length,
      target: tgt, emitted: recipes.length, meals: recipes.filter((r) => r.slotType === "meal").length,
      medianPDen: median(recipes.map((r) => r._a16.pDen)), medianFDen: median(recipes.map((r) => r._a16.fDen)),
      medianCDen: median(recipes.map((r) => r._a16.cDen)),
      anchorNames: [...new Set(recipes.map((r) => r.ingredients[0].food.name))],
      top8: recipes.slice(0, 8).map((r) => `${r.slotType.padEnd(5)} ${r.name} :: ${r.kcal.toFixed(0)}kcal P${r.protein.toFixed(1)} F${r.fat.toFixed(1)} C${r.carb.toFixed(1)} (P/100k ${r._a16.pDen.toFixed(2)} F ${r._a16.fDen.toFixed(2)})`),
    });
  }

  const out = path.join(HERE, "A16-catalogue-v2.json");
  fs.writeFileSync(out, JSON.stringify({ generator: "A16-catalogue-v2.mjs", baseline: baselinePath, minUses: MIN_USES, minMedianG: MIN_MEDIAN_G, perCorner: PER_CORNER, centroids, catalogue }, null, 1));
  fs.writeFileSync(path.join(HERE, "A16-catalogue-v2-report.json"), JSON.stringify(report, null, 2));
  for (const r of report) {
    console.log(`\n[A16] ${r.corner}: eligible ${r.poolFoods} -> bulk ${r.bulkFoods} (anchors ${r.anchors}/bases ${r.bases}/vegs ${r.vegs}) -> ${r.emitted} recipes (${r.meals} meal, ${r.emitted - r.meals} snack)`);
    console.log(`      target P ${r.target.p.toFixed(2)} F ${r.target.f.toFixed(2)} C ${r.target.c.toFixed(2)} · catalogue median P ${r.medianPDen.toFixed(2)} F ${r.medianFDen.toFixed(2)} C ${r.medianCDen.toFixed(2)}`);
    console.log(`      distinct anchors: ${r.anchorNames.slice(0, 12).join(", ")}`);
    for (const t of r.top8) console.log(`        ${t}`);
  }
  console.log(`\n[A16] -> ${out}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
