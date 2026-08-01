// D1 — independent re-derivation of scaleRecipe's portioning math.
//
// INDEPENDENCE RULE: the linear solve here is done by MY OWN Gaussian
// elimination + a brute-force grid check. It does NOT call scaleRecipe to
// decide what the answer should be. scaleRecipe is only invoked at the END,
// to check that the SHIPPED grams agree with my independently-computed
// clamped scales.  (Verification-shape warning in the brief.)
//
// READ-ONLY: opens a COPY of dev.db. Never writes.

import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
process.env.DATABASE_URL = "file:C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D1/dev.db";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const wp = require("./src/lib/weeklyPlanner.js");

// ── my own primitives (deliberately NOT the module's) ────────────────────
const MACROS = ["kcal", "protein", "fat", "carb"];
function myBundle(ings) {
  const acc = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  for (const i of ings) for (const m of MACROS) acc[m] += (i.food[m] || 0) * (i.baseGrams / 100);
  return acc;
}
// 2x2 solve by Gaussian elimination with partial pivoting (NOT Cramer).
function gauss2(a11, a12, a21, a22, b1, b2) {
  let A = [[a11, a12, b1], [a21, a22, b2]];
  if (Math.abs(A[1][0]) > Math.abs(A[0][0])) A = [A[1], A[0]];
  if (A[0][0] === 0) return null;
  const f = A[1][0] / A[0][0];
  const r1 = A[1][1] - f * A[0][1];
  const r2 = A[1][2] - f * A[0][2];
  if (r1 === 0) return null;
  const y = r2 / r1;
  const x = (A[0][2] - A[0][1] * y) / A[0][0];
  return [x, y];
}
const myClamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
// my own practical rounding, re-derived from the stated rule (not imported)
const myPractical = (g) => (!(g > 0) ? 0 : g >= 20 ? Math.round(g / 5) * 5 : Math.max(1, Math.round(g)));

const LO = 0.5, HI = 2;

async function main() {
  const recipes = await prisma.recipe.findMany({
    include: { ingredients: { include: { food: true } } },
  });
  const out = {};
  out.recipeRows = recipes.length;

  // ── 0. structural census ────────────────────────────────────────────────
  const roleCounts = {}, scalableCounts = { true: 0, false: 0 };
  let ingRows = 0;
  for (const r of recipes) for (const i of r.ingredients) {
    ingRows++;
    roleCounts[String(i.role)] = (roleCounts[String(i.role)] || 0) + 1;
    scalableCounts[String(!!i.scalable)]++;
  }
  out.ingredientRows = ingRows;
  out.roleCounts = roleCounts;
  out.scalableCounts = scalableCounts;

  // ── 1. branch census + cached-macro drift ───────────────────────────────
  let noProteinRole = 0, detDegen = 0, oneKnob = 0, hasFixed = 0, allFixed = 0, noScalable = 0;
  let cachedDriftOver1pct = 0, maxCachedDrift = 0;
  const perRecipe = [];
  for (const r of recipes) {
    const fixed = myBundle(r.ingredients.filter((i) => !i.scalable));
    const scal = r.ingredients.filter((i) => i.scalable);
    const P = myBundle(scal.filter((i) => i.role === "protein"));
    const S = myBundle(scal.filter((i) => i.role !== "protein"));
    const pIngs = scal.filter((i) => i.role === "protein").length;
    const det = P.protein * S.kcal - S.protein * P.kcal;
    const degen = pIngs === 0 || Math.abs(det) < 1e-6;
    if (pIngs === 0) noProteinRole++;
    if (pIngs > 0 && Math.abs(det) < 1e-6) detDegen++;
    if (degen) oneKnob++;
    if (fixed.kcal > 0) hasFixed++;
    if (scal.length === 0) { noScalable++; if (r.ingredients.length) allFixed++; }
    const sumKcal = fixed.kcal + P.kcal + S.kcal;
    const drift = sumKcal > 0 ? Math.abs((r.kcal || 0) - sumKcal) / sumKcal : 0;
    if (drift > 0.01) cachedDriftOver1pct++;
    if (drift > maxCachedDrift) maxCachedDrift = drift;
    perRecipe.push({ r, fixed, P, S, pIngs, det, degen, sumKcal });
  }
  out.branch = {
    total: recipes.length, noProteinRole, detDegenWithProtein: detDegen,
    oneKnobTotal: oneKnob, oneKnobPct: +(100 * oneKnob / recipes.length).toFixed(2),
    recipesWithFixedKcal: hasFixed, recipesWithNoScalableIng: noScalable, recipesAllFixed: allFixed,
  };
  out.cachedMacro = { recipesDriftGt1pct: cachedDriftOver1pct, maxDrift: +maxCachedDrift.toFixed(4) };

  // ── 2. INDEPENDENT verification of the closed form ──────────────────────
  // For non-degenerate recipes: Gaussian elimination on
  //   [P.protein  S.protein] [p]   [proteinTarget - fixed.protein]
  //   [P.kcal     S.kcal   ] [s] = [kcalTarget    - fixed.kcal   ]
  // must reproduce the module's Cramer expressions to fp tolerance.
  const rng = mulberry(20260731);
  let cramerChecked = 0, cramerMaxRelDiff = 0, cramerFails = 0;
  let gridChecked = 0, gridMaxResid = 0;
  const sample = perRecipe.filter((x) => !x.degen);
  for (let k = 0; k < 400; k++) {
    const x = sample[Math.floor(rng() * sample.length)];
    const kt = 300 + rng() * 900;
    const pt = 15 + rng() * 60;
    const rk = kt - x.fixed.kcal, rp = pt - x.fixed.protein;
    // module's Cramer (transcribed from weeklyPlanner.js:413-414)
    const cp = (rp * x.S.kcal - x.S.protein * rk) / x.det;
    const cs = (x.P.protein * rk - rp * x.P.kcal) / x.det;
    // my Gaussian
    const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, rp, rk);
    if (!g) continue;
    cramerChecked++;
    const rel = Math.max(
      Math.abs(g[0] - cp) / Math.max(1e-9, Math.abs(cp)),
      Math.abs(g[1] - cs) / Math.max(1e-9, Math.abs(cs))
    );
    if (rel > cramerMaxRelDiff) cramerMaxRelDiff = rel;
    if (rel > 1e-6) cramerFails++;
    // brute check: the UNCLAMPED continuous mix hits both targets exactly
    const mk = x.fixed.kcal + cp * x.P.kcal + cs * x.S.kcal;
    const mp = x.fixed.protein + cp * x.P.protein + cs * x.S.protein;
    const resid = Math.max(Math.abs(mk - kt) / kt, Math.abs(mp - pt) / pt);
    gridChecked++;
    if (resid > gridMaxResid) gridMaxResid = resid;
  }
  out.closedFormCheck = {
    pairsChecked: cramerChecked, maxRelDiffVsGaussian: cramerMaxRelDiff.toExponential(2),
    disagreements: cramerFails,
    unclampedExactHit_pairs: gridChecked, maxRelResidual: gridMaxResid.toExponential(2),
  };

  // ── 3. does my independent pipeline reproduce scaleRecipe's SHIPPED grams? ──
  let shipChecked = 0, shipMismatch = 0, shipMaxKcalDiff = 0;
  const rng2 = mulberry(424242);
  for (let k = 0; k < 600; k++) {
    const x = perRecipe[Math.floor(rng2() * perRecipe.length)];
    const kt = 200 + rng2() * 1000;
    const pt = 10 + rng2() * 70;
    let p, s;
    if (x.pIngs === 0 || Math.abs(x.det) < 1e-6) {
      const raw = (x.r.kcal > 0) ? kt / x.r.kcal : 1;
      p = s = myClamp(raw, LO, HI);
    } else {
      const rk = kt - x.fixed.kcal, rp = pt - x.fixed.protein;
      const g = gauss2(x.P.protein, x.S.protein, x.P.kcal, x.S.kcal, rp, rk);
      p = myClamp(g[0], LO, HI); s = myClamp(g[1], LO, HI);
    }
    // my own grams, from the stated rule
    const mine = x.r.ingredients.map((i) => myPractical(i.baseGrams * (!i.scalable ? 1 : i.role === "protein" ? p : s)));
    const got = wp.scaleRecipe(x.r, kt, pt);
    shipChecked++;
    const theirs = got.ingredients.map((i) => i.grams);
    if (mine.length !== theirs.length || mine.some((g2, j) => g2 !== theirs[j])) shipMismatch++;
    let mk = 0;
    x.r.ingredients.forEach((i, j) => { mk += (i.food.kcal || 0) * mine[j] / 100; });
    const d = Math.abs(mk - got.kcal);
    if (d > shipMaxKcalDiff) shipMaxKcalDiff = d;
  }
  out.shippedGramsCheck = { pairsChecked: shipChecked, gramVectorMismatches: shipMismatch, maxKcalDiff: shipMaxKcalDiff.toExponential(2) };

  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
