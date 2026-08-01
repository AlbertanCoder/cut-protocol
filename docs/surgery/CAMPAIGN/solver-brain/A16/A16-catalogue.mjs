// A16-catalogue.mjs — build the SIMULATED enrichment catalogue.
//
// Integrity rule 5 ("do not invent nutrition data") is enforced structurally,
// not promised:
//   · every synthetic recipe is composed of REAL `Food` rows read from the DB;
//   · its cached kcal/protein/fat/carb are the SUM of those rows' stored macros
//     x grams/100 — the same arithmetic oracle.mjs uses. Nothing is authored.
//   · the eligible ingredient set is restricted to foods the EXISTING 910-recipe
//     library already cooks with (>= MIN_USES ingredient rows), so the generator
//     cannot reach exotic rows (Squirrel, Owl, Sea cucumber — see C13) that no
//     human would author with.
//
// The recipes are IDEALISED: each is aimed directly at the corner's own measured
// target macro-ratio centroid, which no human author would hit on purpose. The
// resulting curve is therefore an UPPER BOUND on what authoring buys.
//
//   node A16-catalogue.mjs --baseline=<abs baseline.jsonl>

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
const PER_CORNER = 80;       // the top of the curve
const MEAL_KCAL = [380, 700];
const SNACK_KCAL = [140, 320];

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ── 1. the corner's OWN target ratio centroid, measured from the baseline run ──
function targetCentroids(baselinePath) {
  const rows = fs.readFileSync(baselinePath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const by = new Map();
  for (const r of rows) {
    if (!r.judged || r.satisfiable === false) continue;
    const t = r.target; if (!t || !t.kcal) continue;
    const p = ((t.proteinLo + t.proteinHi) / 2) / t.kcal * 100;
    const f = ((t.fatLo + t.fatHi) / 2) / t.kcal * 100;
    const c = ((t.carbLo + t.carbHi) / 2) / t.kcal * 100;
    const k = r.dietStyle || "none";
    if (!by.has(k)) by.set(k, { p: [], f: [], c: [] });
    by.get(k).p.push(p); by.get(k).f.push(f); by.get(k).c.push(c);
  }
  const out = {};
  for (const [k, v] of by) out[k] = { p: median(v.p), f: median(v.f), c: median(v.c), n: v.p.length };
  // the population centroid, for the "all styles" variant
  const all = { p: [], f: [], c: [] };
  for (const v of by.values()) { all.p.push(...v.p); all.f.push(...v.f); all.c.push(...v.c); }
  out.__all = { p: median(all.p), f: median(all.f), c: median(all.c), n: all.p.length };
  return out;
}

async function main() {
  const baselinePath = path.resolve(String(argv.baseline));
  const centroids = targetCentroids(baselinePath);
  console.log("[A16] measured target ratio centroids (g per 100 kcal, satisfiable-only days):");
  for (const [k, v] of Object.entries(centroids)) {
    console.log(`   ${k.padEnd(14)} n=${String(v.n).padStart(4)}  P ${v.p.toFixed(2)}  F ${v.f.toFixed(2)}  C ${v.c.toFixed(2)}`);
  }

  const foods = await prisma.food.findMany({ select: { ...gate.FOOD_GATE_SELECT, fiber: true } });
  const uses = await prisma.recipeIngredient.groupBy({ by: ["foodId"], _count: { foodId: true } });
  const useCount = new Map(uses.map((u) => [u.foodId, u._count.foodId]));

  const catalogue = {};
  const report = [];

  for (const corner of CORNERS) {
    const style = corner === "none" ? null : corner;
    const profile = { dietaryStyle: style, excludedFoods: [] };
    const pool = foods.filter((f) =>
      (useCount.get(f.id) || 0) >= MIN_USES &&
      f.kcal > 0 && f.protein != null && f.fat != null && f.carb != null &&
      !foodVal.macroTrustIssue(f) &&
      !gate.isExcluded(f, profile));

    const dens = (f) => ({ p: (f.protein / f.kcal) * 100, f: (f.fat / f.kcal) * 100, c: (f.carb / f.kcal) * 100 });
    const anchors = pool.filter((f) => dens(f).p >= 6 && f.kcal >= 40).sort((a, b) => dens(b).p - dens(a).p).slice(0, 40);
    const bases = pool.filter((f) => dens(f).c >= 8 && dens(f).f <= 3.5 && f.kcal >= 40).sort((a, b) => dens(b).c - dens(a).c).slice(0, 30);
    const vegs = pool.filter((f) => f.kcal > 0 && f.kcal <= 60 && dens(f).f <= 2.5).sort((a, b) => a.kcal - b.kcal).slice(0, 8);

    const tgt = centroids[corner] || centroids.__all;
    // distance in g-per-100-kcal units, protein weighted hardest (A11: protein is
    // the scarcest ratio; fat is merely the tightest band).
    const dist = (p, f) => Math.sqrt(4 * (p - tgt.p) ** 2 + (f - tgt.f) ** 2);

    const GA = [30, 60, 90, 120, 150, 200, 250];
    const GB = [0, 30, 60, 90, 120, 150, 200];
    const GV = [0, 100];

    const cands = [];
    for (const a of anchors) {
      for (const b of bases) {
        if (b.id === a.id) continue;
        for (const v of vegs) {
          if (v.id === a.id || v.id === b.id) continue;
          let best = null;
          for (const ga of GA) for (const gb of GB) for (const gv of GV) {
            const kcal = (a.kcal * ga + b.kcal * gb + v.kcal * gv) / 100;
            if (kcal < SNACK_KCAL[0] || kcal > MEAL_KCAL[1]) continue;
            const P = (a.protein * ga + b.protein * gb + v.protein * gv) / 100;
            const F = (a.fat * ga + b.fat * gb + v.fat * gv) / 100;
            const C = (a.carb * ga + b.carb * gb + v.carb * gv) / 100;
            const d = dist((P / kcal) * 100, (F / kcal) * 100);
            if (!best || d < best.d) best = { d, ga, gb, gv, kcal, P, F, C };
          }
          if (best) cands.push({ a, b, v, ...best });
        }
      }
    }
    cands.sort((x, y) => x.d - y.d || x.a.name.localeCompare(y.a.name) || x.b.name.localeCompare(y.b.name));

    // greedy pick with variety caps — the solver's repeat cap is 2/week, so a
    // catalogue of near-identical rows would not be usable even if it scored well
    const perAnchor = new Map(), perBase = new Map();
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= PER_CORNER) break;
      if ((perAnchor.get(c.a.id) || 0) >= 3) continue;
      if ((perBase.get(c.b.id) || 0) >= 4) continue;
      perAnchor.set(c.a.id, (perAnchor.get(c.a.id) || 0) + 1);
      perBase.set(c.b.id, (perBase.get(c.b.id) || 0) + 1);
      chosen.push(c);
    }

    const recipes = chosen.map((c, i) => {
      const slotType = c.kcal <= SNACK_KCAL[1] ? "snack" : "meal";
      const ings = [
        { foodId: c.a.id, baseGrams: c.ga, role: "protein", food: c.a },
        c.gb > 0 ? { foodId: c.b.id, baseGrams: c.gb, role: "carb", food: c.b } : null,
        c.gv > 0 ? { foodId: c.v.id, baseGrams: c.gv, role: "veg", food: c.v } : null,
      ].filter(Boolean).map((x, j) => ({ id: `A16-syn-${corner}-${i}-i${j}`, recipeId: `A16-syn-${corner}-${i}`, scalable: true, ...x }));
      const nm = [c.a.name, c.gb > 0 ? c.b.name : null, c.gv > 0 ? c.v.name : null].filter(Boolean).join(" with ");
      return {
        id: `A16-syn-${corner}-${i}`,
        name: `${nm} [A16 ${corner} #${i}]`,
        description: null,
        steps: [],
        slotType, cuisine: null, prepTimeMin: 20, source: "curated", mealCategory: null,
        kcal: c.kcal, protein: c.P, fat: c.F, carb: c.C,
        tasteTier: null, tasteTierSource: null, userRatingAvg: null, userRatingCount: null,
        costPerServing: null, difficulty: null, filterProvenance: null,
        aiFingerprint: null, aiVerifiedAt: null, createdAt: new Date(0).toISOString(), createdByUserId: null,
        ingredients: ings,
        _a16: { corner, rank: i, ratioDist: c.d, pDen: (c.P / c.kcal) * 100, fDen: (c.F / c.kcal) * 100, cDen: (c.C / c.kcal) * 100 },
      };
    });

    catalogue[corner] = recipes;
    const pd = recipes.map((r) => r._a16.pDen), fd = recipes.map((r) => r._a16.fDen);
    report.push({ corner, poolFoods: pool.length, anchors: anchors.length, bases: bases.length, vegs: vegs.length,
      target: tgt, emitted: recipes.length, meals: recipes.filter((r) => r.slotType === "meal").length,
      medianPDen: median(pd), medianFDen: median(fd),
      top5: recipes.slice(0, 5).map((r) => `${r.name} :: ${r.kcal.toFixed(0)}kcal P${r.protein.toFixed(1)} F${r.fat.toFixed(1)} C${r.carb.toFixed(1)} (P/100k ${r._a16.pDen.toFixed(2)})`) });
  }

  const out = path.join(HERE, "A16-catalogue.json");
  fs.writeFileSync(out, JSON.stringify({ generator: "A16-catalogue.mjs", baseline: baselinePath, minUses: MIN_USES, perCorner: PER_CORNER, centroids, catalogue }, null, 1));
  fs.writeFileSync(path.join(HERE, "A16-catalogue-report.json"), JSON.stringify(report, null, 2));
  for (const r of report) {
    console.log(`\n[A16] ${r.corner}: eligible foods ${r.poolFoods} (anchors ${r.anchors} / bases ${r.bases} / vegs ${r.vegs}) -> ${r.emitted} recipes (${r.meals} meal, ${r.emitted - r.meals} snack)`);
    console.log(`      target P ${r.target.p.toFixed(2)} F ${r.target.f.toFixed(2)} · catalogue median P ${r.medianPDen.toFixed(2)} F ${r.medianFDen.toFixed(2)} g/100kcal`);
    for (const t of r.top5) console.log(`        ${t}`);
  }
  console.log(`\n[A16] -> ${out}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
