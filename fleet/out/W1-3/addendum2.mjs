// W1-3 addendum 2 — the remaining reconciliations.
//   1. B9 on every denominator + restricted to failing days + by day shape
//   2. floored-fatTarget count on 640 as well as 553
//   3. B5's decisive test: is the fat asymmetry SEARCH-created or PANTRY-inherited?
//      Same test applied to (a) a blind draw from the library and (b) the recipes
//      the search actually shipped — identical statistic, so the two are comparable.
//   4. B1 fat-only census on every denominator
// Pure arithmetic on the pinned dumps + recipe-stats.json. No re-solve, no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ADJ = JSON.parse(fs.readFileSync(path.join(HERE, "adjuster-foods.json"), "utf8"));
const RECIPES = JSON.parse(fs.readFileSync(path.join(HERE, "recipe-stats.json"), "utf8"));
const POOLS = JSON.parse(fs.readFileSync(path.join(REPO, "fleet/out/W1-5/per-diet-pools.json"), "utf8"));
const byId = new Map(RECIPES.recipes.map((r) => [r.id, r]));

const load = (p) => fs.readFileSync(path.join(REPO, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const bandMidpoint = (lo, hi) => (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > 0) ? null : (lo + hi) / 2);
const clamp = (v, { min, max }) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);
const CARRY_CAP_PCT = 0.30;

function weightsFor(meals, snacks) {
  const w = [];
  for (let i = 0; i < meals; i++) w.push({ slotType: "meal", slotIndex: i, weight: meals === 1 ? 1 : i === meals - 1 ? 1.15 : i === 0 ? 0.9 : 1 });
  for (let i = 0; i < snacks; i++) w.push({ slotType: "snack", slotIndex: i, weight: 0.4 });
  return w;
}
function replay(rec) {
  const t = rec.target, w = weightsFor(rec.mealsPerDay, rec.snacksPerDay), slots = rec.slots || [];
  if (!slots.length || slots.length !== w.length) return null;
  const proteinMid = (t.proteinLo + t.proteinHi) / 2;
  const fatMid = bandMidpoint(t.fatLo, t.fatHi);
  const carbMid = Number.isFinite(t.carbMid) && bandMidpoint(t.carbLo, t.carbHi) != null ? t.carbMid : bandMidpoint(t.carbLo, t.carbHi);
  const per = w.reduce((s, x) => s + x.weight, 0);
  const bK = Math.max(0, t.kcal), bP = Math.max(0, proteinMid);
  const bF = fatMid == null ? null : Math.max(0, fatMid), bC = carbMid == null ? null : Math.max(0, carbMid);
  const pre = slots.map((s) => {
    let k = s.kcal || 0, p = s.protein || 0, f = s.fat || 0, c = s.carb || 0;
    for (const a of s.adjusters || []) { const fo = ADJ.foods[a.foodId]; if (!fo) return null; const g = (a.grams || 0) / 100; k -= fo.kcal * g; p -= fo.protein * g; f -= fo.fat * g; c -= fo.carb * g; }
    return { kcal: k, protein: p, fat: f, carb: c };
  });
  if (pre.some((x) => x == null)) return null;
  const nom = w.map((x) => ({ ...x, kcalTarget: bK * (x.weight / per), proteinTarget: bP * (x.weight / per), fatShare: bF == null ? null : bF * (x.weight / per), carbShare: bC == null ? null : bC * (x.weight / per) }));
  let aK = 0, aP = 0, aF = 0, aC = 0; const out = [];
  for (let i = 0; i < nom.length; i++) {
    const rw = nom.slice(i).reduce((s, x) => s + x.weight, 0);
    const share = rw > 0 ? nom[i].weight / rw : 1;
    out.push({
      idx: i, slotType: nom[i].slotType, nom: nom[i],
      eff: {
        kcalTarget: clamp((bK - aK) * share, { min: nom[i].kcalTarget * 0.7, max: nom[i].kcalTarget * 1.3 }),
        proteinTarget: clamp((bP - aP) * share, { min: nom[i].proteinTarget * 0.7, max: nom[i].proteinTarget * 1.3 }),
        fatTarget: nom[i].fatShare == null ? null : Math.max(0, (bF - aF) * share),
        carbTarget: nom[i].carbShare == null ? null : Math.max(0, (bC - aC) * share),
      },
      achieved: pre[i], filled: !!slots[i].recipeId, recipeId: slots[i].recipeId,
    });
    aK += pre[i].kcal; aP += pre[i].protein; aF += pre[i].fat; aC += pre[i].carb;
  }
  return out;
}

const recs = load("fleet/out/W1-2/daydump-route-s424242.jsonl");
const SETS = {
  "planned(640)": recs,
  "planned−degen(639)": recs.filter((r) => !r.degenerate),
  "judged(623)": recs.filter((r) => r.judged),
  "sat-planned−degen(553) CANONICAL": recs.filter((r) => r.satisfiable && !r.degenerate),
  "sat-judged(537)": recs.filter((r) => r.satisfiable && r.judged),
  "FAILING days of the canonical 553 (138)": recs.filter((r) => r.satisfiable && !r.degenerate && !r.verdict.inBand),
  "IN-BAND days of the canonical 553 (415)": recs.filter((r) => r.satisfiable && !r.degenerate && r.verdict.inBand),
};
const OUT = { b9: {}, flooredFat: {}, b5decisive: {}, b1: {} };

// ── 1/2. B9 across denominators ─────────────────────────────────────────────
for (const [name, set] of Object.entries(SETS)) {
  const acc = [], perPos = [], floored = [];
  for (const r of set) {
    const rp = replay(r); if (!rp) continue;
    let cf = 0, cs = 0;
    for (const s of rp) {
      cf += s.achieved.fat; cs += s.nom.fatShare ?? 0;
      acc[s.idx] = acc[s.idx] || { pos: s.idx + 1, ratios: [], sf: 0, ss: 0, n: 0 };
      if (cs > 0) { acc[s.idx].ratios.push(cf / cs); acc[s.idx].sf += cf; acc[s.idx].ss += cs; acc[s.idx].n++; }
      perPos[s.idx] = perPos[s.idx] || { pos: s.idx + 1, ratios: [], meal: [], snack: [] };
      if (s.filled && s.nom.fatShare > 0) { const q = s.achieved.fat / s.nom.fatShare; perPos[s.idx].ratios.push(q); perPos[s.idx][s.slotType].push(q); }
      if (s.filled && s.eff.fatTarget != null && s.eff.fatTarget <= 0) floored.push(s.achieved.fat);
    }
  }
  OUT.b9[name] = {
    cumulative: acc.filter(Boolean).slice(0, 8).map((a) => ({ pos: a.pos, days: a.n, medianDayRatio: r3(med(a.ratios)), pooled: r3(a.sf / a.ss) })),
    perSlot: perPos.filter(Boolean).slice(0, 8).map((p) => ({ pos: p.pos, n: p.ratios.length, median: r3(med(p.ratios)), mealMedian: r3(med(p.meal)), snackMedian: r3(med(p.snack)), meals: p.meal.length, snacks: p.snack.length })),
  };
  OUT.flooredFat[name] = { slots: floored.length, medianG: r3(med(floored)), meanG: r3(floored.reduce((s, x) => s + x, 0) / (floored.length || 1)) };
}

// ── 3. B5's DECISIVE TEST — search-created or pantry-inherited? ─────────────
// Statistic: for a day whose graded fat window (D3) is [fatLo-0.25*fatMid,
// fatHi+0.25*fatMid], a dish's fat DENSITY (g fat per kcal) either lands the day
// inside, above or below that window when portioned to the day's calories.
// Portion scaling cannot move fat-per-kcal, so this is a property of the DISH.
//   A-PRIORI  = share of the (per-diet-style) pool above / below.
//   SHIPPED   = the same classification applied to the dishes the search chose.
// Identical statistic on both sides ⇒ directly comparable.
{
  const poolDens = {};
  for (const [d, v] of Object.entries(POOLS)) poolDens[d] = v.poolIds.map((id) => byId.get(id)).filter((r) => r && r.kcal > 0).map((r) => r.fat / r.kcal);
  const canon = SETS["sat-planned−degen(553) CANONICAL"];
  let apHi = 0, apLo = 0, apIn = 0, shHi = 0, shLo = 0, shIn = 0, shN = 0;
  const apShareHi = [], apShareLo = [];
  for (const r of canon) {
    const t = r.target, fm = bandMidpoint(t.fatLo, t.fatHi); if (!(fm > 0) || !(t.kcal > 0)) continue;
    const lo = (t.fatLo - 0.25 * fm) / t.kcal, hi = (t.fatHi + 0.25 * fm) / t.kcal;
    const ds = poolDens[r.dietStyle] || poolDens.none;
    const nHi = ds.filter((d) => d > hi).length, nLo = ds.filter((d) => d < lo).length;
    apHi += nHi; apLo += nLo; apIn += ds.length - nHi - nLo;
    apShareHi.push(nHi / ds.length); apShareLo.push(nLo / ds.length);
    for (const s of r.slots || []) {
      if (!s.recipeId) continue;
      const rec = byId.get(s.recipeId); if (!rec || !(rec.kcal > 0)) continue;
      const d = rec.fat / rec.kcal; shN++;
      if (d > hi) shHi++; else if (d < lo) shLo++; else shIn++;
    }
  }
  OUT.b5decisive = {
    statistic: "share of dishes whose fat-per-kcal density puts a day ABOVE / INSIDE / BELOW the D3 graded fat window, per-diet-style pool",
    aPriori: { above: pct(apHi, apHi + apLo + apIn), inside: pct(apIn, apHi + apLo + apIn), below: pct(apLo, apHi + apLo + apIn), overShortRatio: r3(apHi / apLo), poolDrawsCounted: apHi + apLo + apIn },
    aPrioriMeanPerDay: { abovePct: Math.round((apShareHi.reduce((s, x) => s + x, 0) / apShareHi.length) * 1000) / 10, belowPct: Math.round((apShareLo.reduce((s, x) => s + x, 0) / apShareLo.length) * 1000) / 10 },
    shipped: { above: pct(shHi, shN), inside: pct(shIn, shN), below: pct(shLo, shN), overShortRatio: r3(shHi / shLo), slots: shN },
    verdict: "if SHIPPED's above/below ratio is no worse than A-PRIORI's, the asymmetry is inherited from the library, not manufactured by the search",
  };
  // library-wide fat energy share, for the record
  const fe = RECIPES.recipes.filter((r) => r.kcal > 0).map((r) => (r.fat * 9) / r.kcal);
  OUT.b5decisive.libraryFatPctE = { median: Math.round(med(fe) * 1000) / 10, n: fe.length };
}

// ── 4. B1 fat census on every denominator ───────────────────────────────────
function axesOf(r) {
  const v = r.verdict, ax = [];
  if (!v.kcalOk) ax.push({ macro: "kcal", side: v.kcalDeltaPct > 0 ? "over" : "under" });
  if (!v.proteinOk) ax.push({ macro: "protein", side: "short" });
  if (!v.fatOk) ax.push({ macro: "fat", side: v.fatOverPct > 0 ? "over" : "under" });
  if (!v.carbOk) ax.push({ macro: "carb", side: v.carbOverPct > 0 ? "over" : "under" });
  return ax;
}
for (const [name, set] of Object.entries(SETS)) {
  const fails = set.filter((r) => !r.verdict.inBand && !r.degenerate);
  const fatFail = fails.filter((r) => !r.verdict.fatOk);
  const fatOnly = fails.filter((r) => { const a = axesOf(r); return a.length === 1 && a[0].macro === "fat"; });
  OUT.b1[name] = {
    failing: fails.length,
    fatFailingDays: fatFail.length, over: fatFail.filter((r) => r.verdict.fatOverPct > 0).length, short: fatFail.filter((r) => r.verdict.fatOverPct <= 0).length,
    fatOnlyMisses: fatOnly.length, fatOnlyOver: fatOnly.filter((r) => r.verdict.fatOverPct > 0).length,
    fatOnlyMedianOverMidPct: fatOnly.length ? Math.round(med(fatOnly.map((r) => { const m = bandMidpoint(r.target.fatLo, r.target.fatHi); return (r.achieved.fat - m) / m; })) * 1000) / 10 : null,
  };
}

fs.writeFileSync(path.join(HERE, "addendum2.json"), JSON.stringify(OUT, null, 1));
console.log("wrote addendum2.json\n");
console.log("========= B9 CUMULATIVE FAT RATIO BY SLOT ORDER =========");
for (const [n, v] of Object.entries(OUT.b9)) { console.log(`\n[${n}] cumulative:`); console.table(v.cumulative); }
console.log("\n========= B9 PER-SLOT (non-cumulative) fat / nominal share =========");
for (const [n, v] of Object.entries(OUT.b9)) { console.log(`\n[${n}] per-slot:`); console.table(v.perSlot); }
console.log("\n========= FLOORED fatTarget =========");
console.table(OUT.flooredFat);
console.log("\n========= B5 DECISIVE =========");
console.log(JSON.stringify(OUT.b5decisive, null, 1));
console.log("\n========= B1 =========");
console.table(OUT.b1);
