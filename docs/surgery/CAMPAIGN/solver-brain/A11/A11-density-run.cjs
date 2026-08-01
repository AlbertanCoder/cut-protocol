// A11 · Pool density — is each diet corner POOL-LIMITED or SOLVER-LIMITED?
// Imports the PRODUCT exclusion gate read-only. No reimplementation.
const fs = require("fs");
const path = require("path");
module.paths.push("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules");
const { PrismaClient } = require("@prisma/client");
const { filterRecipes, RECIPE_GATE_SELECT } = require("../../../../../backend/src/lib/exclusionGate.js");
const { computeEnergy, deriveTarget, computeMacros } = require("../../../../../backend/src/lib/bmrEngine.js");

const OUT = __dirname;
const prisma = new PrismaClient();

// ── tolerance constants, read from mealSolver's own source (no re-derivation) ──
const TOL = { kcal: 0.15, protein: 0.15, fat: 0.25, carb: 0.25 };

const q = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { n: 0 };
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const med = q(s, 0.5);
  return {
    n, min: s[0], q1: q(s, 0.25), med, q3: q(s, 0.75), max: s[n - 1], mean, sd,
    p05: q(s, 0.05), p95: q(s, 0.95),
    // Pearson second skewness coefficient — shape, not just centre.
    skew: sd > 0 ? (3 * (mean - med)) / sd : 0,
  };
};
const r4 = (x) => (x == null ? "" : Math.round(x * 10000) / 10000);
const r2 = (x) => (x == null ? "" : Math.round(x * 100) / 100);

// Feasible day-macro box, in GRAMS, for a chosen day kcal K.
// Straight from dayTolerance(): protein has no upper miss, keto has zero carb
// upward allowance.
function box(dt, K) {
  const pMid = (dt.proteinLo + dt.proteinHi) / 2;
  const fMid = (dt.fatLo + dt.fatHi) / 2;
  const cMid = (dt.carbLo + dt.carbHi) / 2;
  return {
    pLo: pMid * (1 - TOL.protein), pHi: Infinity,
    fLo: Math.max(0, dt.fatLo - TOL.fat * fMid), fHi: dt.fatHi + TOL.fat * fMid,
    cLo: Math.max(0, dt.carbLo - TOL.carb * cMid),
    cHi: dt.carbHi + (dt.keto ? 0 : TOL.carb * cMid),
    K,
  };
}
// A ratio point (g per kcal) sits in the box iff ratio*K lands in the gram box.
const ptInBox = (v, b) =>
  v.p * b.K >= b.pLo && v.f * b.K >= b.fLo && v.f * b.K <= b.fHi && v.c * b.K >= b.cLo && v.c * b.K <= b.cHi;

// Distance from a ratio point to the box, in BAND UNITS (each axis scaled by
// its own half-width) so "0" means feasible and "1" means one band off.
function distToBox(v, b) {
  const hF = Math.max(1e-9, (b.fHi - b.fLo) / 2);
  const hC = Math.max(1e-9, (b.cHi - b.cLo) / 2);
  const hP = Math.max(1e-9, b.pLo * 0.3);
  const p = v.p * b.K, f = v.f * b.K, c = v.c * b.K;
  const dp = p < b.pLo ? (b.pLo - p) / hP : 0;
  const df = f < b.fLo ? (b.fLo - f) / hF : f > b.fHi ? (f - b.fHi) / hF : 0;
  const dc = c < b.cLo ? (b.cLo - c) / hC : c > b.cHi ? (c - b.cHi) / hC : 0;
  return { d2: dp * dp + df * df + dc * dc, dp, df, dc };
}

// Frank-Wolfe: min over the CONVEX HULL of the survivor ratio points of the
// squared distance to the box. A day's macro-per-kcal vector is exactly a
// kcal-weighted convex combination of its slots' vectors, so the hull IS the
// achievable set (relaxing slot count, 0.5-2x scale bounds and slotType).
function hullDist(points, b, iters = 400) {
  if (!points.length) return { d2: Infinity, dp: Infinity, df: Infinity, dc: Infinity };
  const hF = Math.max(1e-9, (b.fHi - b.fLo) / 2);
  const hC = Math.max(1e-9, (b.cHi - b.cLo) / 2);
  const hP = Math.max(1e-9, b.pLo * 0.3);
  const sc = (v) => [(v.p * b.K) / hP, (v.f * b.K) / hF, (v.c * b.K) / hC];
  const lo = [b.pLo / hP, b.fLo / hF, b.cLo / hC];
  const hi = [Infinity, b.fHi / hF, b.cHi / hC];
  const P = points.map(sc);
  let x = P[0].slice();
  const clampBox = (y) => y.map((v, i) => Math.min(Math.max(v, lo[i]), hi[i]));
  for (let t = 0; t < iters; t++) {
    const cx = clampBox(x);
    const g = [2 * (x[0] - cx[0]), 2 * (x[1] - cx[1]), 2 * (x[2] - cx[2])];
    let best = 0, bv = Infinity;
    for (let i = 0; i < P.length; i++) {
      const val = g[0] * P[i][0] + g[1] * P[i][1] + g[2] * P[i][2];
      if (val < bv) { bv = val; best = i; }
    }
    const gamma = 2 / (t + 2);
    x = [x[0] + gamma * (P[best][0] - x[0]), x[1] + gamma * (P[best][1] - x[1]), x[2] + gamma * (P[best][2] - x[2])];
  }
  const cx = clampBox(x);
  const dp = Math.max(0, lo[0] - x[0]);
  const df = x[1] < lo[1] ? lo[1] - x[1] : x[1] > hi[1] ? x[1] - hi[1] : 0;
  const dc = x[2] < lo[2] ? lo[2] - x[2] : x[2] > hi[2] ? x[2] - hi[2] : 0;
  return { d2: (x[0] - cx[0]) ** 2 + (x[1] - cx[1]) ** 2 + (x[2] - cx[2]) ** 2, dp, df, dc };
}

const K_GRID = [];
for (let k = 0.85; k <= 1.1501; k += 0.025) K_GRID.push(Math.round(k * 1000) / 1000);

(async () => {
  const library = await prisma.recipe.findMany({ select: RECIPE_GATE_SELECT });
  const rawCount = (await prisma.$queryRawUnsafe("SELECT COUNT(*) c FROM Recipe"))[0].c;
  const foodCount = (await prisma.$queryRawUnsafe("SELECT COUNT(*) c FROM Food"))[0].c;
  console.log(`INSTRUMENT: raw Recipe rows=${rawCount} loaded=${library.length} Food=${foodCount}`);
  if (Number(rawCount) !== library.length) throw new Error("library/raw mismatch");
  if (Number(rawCount) < 900) throw new Error(`recipe count ${rawCount} is not the real ~910 library — STOP`);

  const ratioOf = (r) => (r.kcal > 0 ? { p: r.protein / r.kcal, f: r.fat / r.kcal, c: r.carb / r.kcal } : null);

  const personas = fs
    .readFileSync(path.join(__dirname, "../../qa/qa-fleet-20260729-2032/personas.jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));

  const STYLES = ["none", "vegan", "vegetarian", "keto", "paleo", "kosher", "halal", "mediterranean", "carnivore"];

  // ── pass 1: pure-style corners (no allergens) — one survivor CSV each ──
  const styleRows = [];
  const poolCache = new Map();
  const poolFor = (style, ex) => {
    const key = `${style}|${[...ex].sort().join(",")}`;
    if (poolCache.has(key)) return poolCache.get(key);
    const survivors = filterRecipes(library, { dietaryStyle: style, excludedFoods: ex });
    const pts = [], rows = [];
    let zeroKcal = 0;
    for (const r of survivors) {
      const v = ratioOf(r);
      if (!v) { zeroKcal++; continue; }
      pts.push(v);
      rows.push(r);
    }
    const out = { survivors, pts, rows, zeroKcal, key };
    if (poolCache.size < 400) poolCache.set(key, out);
    return out;
  };

  for (const style of STYLES) {
    const { pts, rows, zeroKcal } = poolFor(style, []);
    const sf = stats(pts.map((v) => v.f * 100));
    const sp = stats(pts.map((v) => v.p * 100));
    const scb = stats(pts.map((v) => v.c * 100));
    const bySlot = {};
    for (const r of rows) bySlot[r.slotType || "null"] = (bySlot[r.slotType || "null"] || 0) + 1;
    styleRows.push({ style, n: pts.length, pct: (100 * pts.length) / library.length, zeroKcal, sf, sp, scb, bySlot });

    const lines = ["recipe_id,name,slot_type,kcal,protein_g,fat_g,carb_g,fat_g_per_100kcal,protein_g_per_100kcal,carb_g_per_100kcal,fat_kcal_share"];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], v = pts[i];
      lines.push([
        r.id, JSON.stringify(String(r.name || "")), r.slotType || "", r2(r.kcal), r2(r.protein), r2(r.fat), r2(r.carb),
        r2(v.f * 100), r2(v.p * 100), r2(v.c * 100), r4(v.f * 9),
      ].join(","));
    }
    fs.writeFileSync(path.join(OUT, `A11-survivors-${style}.csv`), lines.join("\n"));
  }

  const sl = ["style,survivors,pct_of_910,zero_kcal_rows,fat_min,fat_q1,fat_med,fat_q3,fat_max,fat_mean,fat_sd,fat_skew,prot_min,prot_q1,prot_med,prot_q3,prot_max,carb_min,carb_q1,carb_med,carb_q3,carb_max,slot_breakdown"];
  for (const s of styleRows) {
    sl.push([
      s.style, s.n, r2(s.pct), s.zeroKcal,
      r2(s.sf.min), r2(s.sf.q1), r2(s.sf.med), r2(s.sf.q3), r2(s.sf.max), r2(s.sf.mean), r2(s.sf.sd), r2(s.sf.skew),
      r2(s.sp.min), r2(s.sp.q1), r2(s.sp.med), r2(s.sp.q3), r2(s.sp.max),
      r2(s.scb.min), r2(s.scb.q1), r2(s.scb.med), r2(s.scb.q3), r2(s.scb.max),
      JSON.stringify(Object.entries(s.bySlot).map(([k, v]) => `${k}:${v}`).join(" ")),
    ].join(","));
  }
  fs.writeFileSync(path.join(OUT, "A11-style-density.csv"), sl.join("\n"));
  console.log("pure-style corners written");

  // ── pass 2: the 250 REAL persona corners (diet x allergen stack) ──
  const pl = ["persona_id,tier,style,allergen_stack,n_walls,survivors,pct_of_910,target_kcal,lbm_lb,fat_lo,fat_hi,carb_lo,carb_hi,prot_lo,prot_hi,keto,tgt_fat_per_100kcal,tgt_prot_per_100kcal,tgt_carb_per_100kcal,pool_fat_min,pool_fat_med,pool_fat_max,pool_prot_med,pool_carb_med,n_recipes_all4_in_band,pct_all4_in_band,n_fat_in_band,n_prot_in_band,n_carb_in_band,hull_feasible,hull_gap_bandunits,gap_axis,verdict"];
  const byStyleVerdict = {};

  for (const per of personas) {
    const prof = per.profile;
    const style = prof.dietaryStyle || "none";
    const ex = Array.isArray(prof.excludedFoods) ? prof.excludedFoods : [];
    const { pts } = poolFor(style, ex);

    const wKg = prof.startWeightKg;
    const energy = computeEnergy(prof, wKg);
    const dtg = deriveTarget(prof, energy.tdee, energy.rmr);
    const dt = computeMacros(prof, wKg, dtg.target);

    const K0 = dt.kcal;
    const fMidR = ((dt.fatLo + dt.fatHi) / 2) / K0;
    const pMidR = ((dt.proteinLo + dt.proteinHi) / 2) / K0;
    const cMidR = ((dt.carbLo + dt.carbHi) / 2) / K0;

    // Density: how many survivors sit, on their OWN ratio, inside the day box
    // at some admissible day-kcal. This is the number the solver gets to pick from.
    let all4 = 0, fIn = 0, pIn = 0, cIn = 0;
    const boxes = K_GRID.map((k) => box(dt, K0 * k));
    for (const v of pts) {
      let a = false, f = false, p = false, c = false;
      for (const b of boxes) {
        if (v.f * b.K >= b.fLo && v.f * b.K <= b.fHi) f = true;
        if (v.p * b.K >= b.pLo) p = true;
        if (v.c * b.K >= b.cLo && v.c * b.K <= b.cHi) c = true;
        if (ptInBox(v, b)) a = true;
      }
      if (a) all4++;
      if (f) fIn++;
      if (p) pIn++;
      if (c) cIn++;
    }

    // Hull feasibility: only needs computing when no single recipe already sits
    // in the box (if one does, the corner is trivially not ratio-limited).
    let feasible = all4 > 0, gap = 0, axis = "";
    if (!feasible && pts.length) {
      let best = { d2: Infinity };
      for (const b of boxes) {
        const h = hullDist(pts, b);
        if (h.d2 < best.d2) best = h;
      }
      gap = Math.sqrt(best.d2);
      feasible = gap < 1e-6;
      const ax = [["protein", best.dp], ["fat", best.df], ["carb", best.dc]].filter(([, d]) => d > 1e-6);
      axis = ax.sort((a, b) => b[1] - a[1]).map(([n]) => n).join("+");
    }

    const fArr = pts.map((v) => v.f * 100).sort((a, b) => a - b);
    const pArr = pts.map((v) => v.p * 100).sort((a, b) => a - b);
    const cArr = pts.map((v) => v.c * 100).sort((a, b) => a - b);

    const verdict = pts.length === 0 ? "POOL-LIMITED (empty pool)"
      : !feasible ? "POOL-LIMITED (ratio unreachable)"
      : all4 === 0 ? "SOLVER-LIMITED (hull-only, 0 single-recipe matches)"
      : (100 * all4) / pts.length < 5 ? "SOLVER-LIMITED (thin: <5% in band)"
      : "SOLVER-LIMITED";

    (byStyleVerdict[style] ||= []).push({ verdict, all4, n: pts.length, pctIn: pts.length ? (100 * all4) / pts.length : 0, feasible });

    pl.push([
      per.id, per.tier, style, JSON.stringify(ex.join("|")), (per.walls || []).length,
      pts.length, r2((100 * pts.length) / library.length), dt.kcal, r2(dt.lbmLb),
      dt.fatLo, dt.fatHi, dt.carbLo, dt.carbHi, dt.proteinLo, dt.proteinHi, dt.keto ? 1 : 0,
      r2(fMidR * 100), r2(pMidR * 100), r2(cMidR * 100),
      r2(fArr[0]), r2(q(fArr, 0.5)), r2(fArr[fArr.length - 1]), r2(q(pArr, 0.5)), r2(q(cArr, 0.5)),
      all4, r2(pts.length ? (100 * all4) / pts.length : 0), fIn, pIn, cIn,
      feasible ? 1 : 0, r2(gap), JSON.stringify(axis), JSON.stringify(verdict),
    ].join(","));
  }
  fs.writeFileSync(path.join(OUT, "A11-persona-corners.csv"), pl.join("\n"));

  // ── roll-up ──
  const rl = ["style,personas,mean_survivors,mean_pct_all4_in_band,min_pct_all4_in_band,n_pool_limited,n_solver_limited,n_zero_single_match"];
  const summary = [];
  for (const style of STYLES) {
    const g = byStyleVerdict[style] || [];
    if (!g.length) continue;
    const meanN = g.reduce((a, b) => a + b.n, 0) / g.length;
    const meanPct = g.reduce((a, b) => a + b.pctIn, 0) / g.length;
    const minPct = Math.min(...g.map((x) => x.pctIn));
    const npl = g.filter((x) => !x.feasible).length;
    const nzero = g.filter((x) => x.all4 === 0).length;
    rl.push([style, g.length, r2(meanN), r2(meanPct), r2(minPct), npl, g.length - npl, nzero].join(","));
    summary.push({ style, n: g.length, meanN: Math.round(meanN), meanPct: r2(meanPct), minPct: r2(minPct), npl, nzero });
  }
  fs.writeFileSync(path.join(OUT, "A11-style-verdicts.csv"), rl.join("\n"));
  console.table(summary);
  console.table(styleRows.map((s) => ({
    style: s.style, survivors: s.n, pct: r2(s.pct),
    fat_min: r2(s.sf.min), fat_q1: r2(s.sf.q1), fat_med: r2(s.sf.med), fat_q3: r2(s.sf.q3), fat_max: r2(s.sf.max), fat_skew: r2(s.sf.skew),
    prot_med: r2(s.sp.med), carb_med: r2(s.scb.med),
  })));
  await prisma.$disconnect();
})();
