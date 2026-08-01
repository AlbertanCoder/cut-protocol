// W1-3 — THE TAXONOMY. Pure arithmetic on the pinned day dumps. No re-solve,
// no DB read at runtime (the two side-car JSONs were produced by
// adjusterFoods.mjs / recipeStats.mjs), no network, BRAIN irrelevant.
//
//   node fleet/out/W1-3/taxonomy.mjs
//
// WHAT IT DOES
//   A. buckets every FAILING day by binding miss, reconciled to sum exactly
//   B. the over-side share stated three ways: per failing AXIS / DAY / SLOT
//   C. campaign mix comparison
//   D. B9 accumulation (cumulative fat ratio by slot order + floored-fatTarget)
//   E. B8 by-slot-size table (+ the snack cross-cut)
//   F. B6 closest-miss fallback
//   G. B5 one-sided penalty
//   H. I7 carry-forward ratio blow-out
//   I. D7 classifyBinding disagreement
//
// SLOT TARGET RECONSTRUCTION (the load-bearing step)
// The dump carries per-slot ACHIEVED macros but not the per-slot TARGET the
// solver actually solved against. Those targets are a deterministic function of
// (day target, slot weights, achieved macros in solve order) — weeklyPlanner.js
// solveDay :852-944 — so they are replayed here verbatim:
//   buildSlots         :145-157   weights  meal: M==1?1 : last?1.15 : first?0.9 : 1 ; snack 0.4
//   targetsForSlots    :159-175   nominal share = w / perDayWeight
//   solveDay           :889-931   budgets, then per-slot carry-forward
//   CARRY_CAP_PCT      :111       0.30, kcal + protein clamped INDEPENDENTLY
//   clamp              :294
// The replay is VERIFIED against the product's own strings: the closest-miss
// warning at :664-665 prints Math.round(effective kcalTarget / proteinTarget).
// Every such warning in the corpus is parsed and compared.
//
// PRE-CLOSER MACROS. macroCloser mutates the host slot AFTER every slot is
// resolved (weeklyPlanner.js:951), so the carry-forward replay must use
// pre-closer numbers. Each slot's adjuster rows carry foodId+grams; the ten
// adjuster foods' per-100g macros are in adjuster-foods.json, so the closer's
// contribution is subtracted exactly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ADJ = JSON.parse(fs.readFileSync(path.join(HERE, "adjuster-foods.json"), "utf8"));
const RECIPES = JSON.parse(fs.readFileSync(path.join(HERE, "recipe-stats.json"), "utf8"));
const POOLS = JSON.parse(fs.readFileSync(path.join(REPO, "fleet/out/W1-5/per-diet-pools.json"), "utf8"));

// ── product constants, quoted with their line numbers ───────────────────────
const CARRY_CAP_PCT = 0.30;         // weeklyPlanner.js:111
const KCAL_TOLERANCE_PCT = 0.15;    // weeklyPlanner.js:67   (slot gate)
const PROTEIN_TOLERANCE_PCT = 0.12; // weeklyPlanner.js:74   (slot gate, ONE-SIDED)
// W1-3 CONVENTION, not a product constant: fat/carb have no slot-level bar at
// all, so a slot-level fat/carb miss is declared at 25% of that slot's own
// target — the same 25% the DAY ruler grants outside the band. Named because
// A4 forbids an unnamed denominator, and every table using it says so.
const SLOT_COMP_TOL = 0.25;

const clamp = (v, { min, max }) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);
const bandMidpoint = (lo, hi) => (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > 0) ? null : (lo + hi) / 2);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

// ── slot weights, buildSlots :145-157 ───────────────────────────────────────
function weightsFor(meals, snacks) {
  const w = [];
  for (let i = 0; i < meals; i++) w.push({ slotType: "meal", slotIndex: i, weight: meals === 1 ? 1 : i === meals - 1 ? 1.15 : i === 0 ? 0.9 : 1 });
  for (let i = 0; i < snacks; i++) w.push({ slotType: "snack", slotIndex: i, weight: 0.4 });
  return w;
}

// ── the replay ──────────────────────────────────────────────────────────────
function replaySlotTargets(rec) {
  const t = rec.target;
  const w = weightsFor(rec.mealsPerDay, rec.snacksPerDay);
  const slots = rec.slots || [];
  // Order check: the dump must present slots in buildSlots order.
  const orderOk = slots.length === w.length
    && slots.every((s, i) => s.slotType === w[i].slotType && s.slotIndex === w[i].slotIndex);
  if (!orderOk || !slots.length) return { ok: false, orderOk, slots: [] };

  const proteinMid = (t.proteinLo + t.proteinHi) / 2;
  const fatMid = bandMidpoint(t.fatLo, t.fatHi);
  const carbMid = Number.isFinite(t.carbMid) && bandMidpoint(t.carbLo, t.carbHi) != null ? t.carbMid : bandMidpoint(t.carbLo, t.carbHi);
  const perDayWeight = w.reduce((s, x) => s + x.weight, 0);
  const budgetKcal = Math.max(0, t.kcal);              // no locks in this population (0/250)
  const budgetProtein = Math.max(0, proteinMid);
  const budgetFat = fatMid == null ? null : Math.max(0, fatMid);
  const budgetCarb = carbMid == null ? null : Math.max(0, carbMid);

  // pre-closer achieved macros, per slot
  const pre = slots.map((s) => {
    let k = s.kcal || 0, p = s.protein || 0, f = s.fat || 0, c = s.carb || 0;
    for (const a of s.adjusters || []) {
      const food = ADJ.foods[a.foodId];
      if (!food) return null;
      const g = (a.grams || 0) / 100;
      k -= (food.kcal || 0) * g; p -= (food.protein || 0) * g; f -= (food.fat || 0) * g; c -= (food.carb || 0) * g;
    }
    return { kcal: k, protein: p, fat: f, carb: c };
  });
  if (pre.some((x) => x == null)) return { ok: false, orderOk, slots: [] };

  const nominal = w.map((x) => ({
    ...x,
    kcalTarget: budgetKcal * (x.weight / perDayWeight),
    proteinTarget: budgetProtein * (x.weight / perDayWeight),
    fatShare: budgetFat == null ? null : budgetFat * (x.weight / perDayWeight),
    carbShare: budgetCarb == null ? null : budgetCarb * (x.weight / perDayWeight),
  }));

  let aK = 0, aP = 0, aF = 0, aC = 0;
  const out = [];
  for (let i = 0; i < nominal.length; i++) {
    const nom = nominal[i];
    const remainingWeight = nominal.slice(i).reduce((s, x) => s + x.weight, 0);
    const share = remainingWeight > 0 ? nom.weight / remainingWeight : 1;
    const proposedKcal = (budgetKcal - aK) * share;
    const proposedProtein = (budgetProtein - aP) * share;
    const eff = {
      kcalTarget: clamp(proposedKcal, { min: nom.kcalTarget * (1 - CARRY_CAP_PCT), max: nom.kcalTarget * (1 + CARRY_CAP_PCT) }),
      proteinTarget: clamp(proposedProtein, { min: nom.proteinTarget * (1 - CARRY_CAP_PCT), max: nom.proteinTarget * (1 + CARRY_CAP_PCT) }),
      fatTarget: nom.fatShare == null ? null : Math.max(0, (budgetFat - aF) * share),
      carbTarget: nom.carbShare == null ? null : Math.max(0, (budgetCarb - aC) * share),
    };
    out.push({
      idx: i, slotType: nom.slotType, slotIndex: nom.slotIndex, weight: nom.weight,
      nom, eff,
      achieved: pre[i],
      shipped: { kcal: slots[i].kcal, protein: slots[i].protein, fat: slots[i].fat, carb: slots[i].carb },
      recipeId: slots[i].recipeId, recipeName: slots[i].recipeName,
      warning: slots[i].warning, adjusterCount: slots[i].adjusterCount || 0,
      pinnedLo: slots[i].pinnedLo, pinnedHi: slots[i].pinnedHi,
      filled: !!slots[i].recipeId,
      // the pre-closer achieved *carried forward* (:940-943 carries result.*, pre-closer)
    });
    aK += pre[i].kcal; aP += pre[i].protein; aF += pre[i].fat; aC += pre[i].carb;
  }
  return { ok: true, orderOk: true, slots: out, budgets: { budgetKcal, budgetProtein, budgetFat, budgetCarb }, perDayWeight };
}

const FALLBACK_RE = /^Tried \d+ recipe\(s\) for this slot, none fit within tolerance/;
const WARN_KCAL_RE = /landed (\d+) kcal vs a (\d+) target/;
const WARN_PROT_RE = /delivered (\d+)g protein vs a (\d+)g target/;

// ── day bucket ──────────────────────────────────────────────────────────────
function axesOf(rec) {
  const v = rec.verdict, ax = [];
  if (!v.kcalOk) ax.push({ macro: "kcal", side: v.kcalDeltaPct > 0 ? "over" : "under" });
  if (!v.proteinOk) ax.push({ macro: "protein", side: "short" });
  if (!v.fatOk) ax.push({ macro: "fat", side: v.fatOverPct > 0 ? "over" : "under" });
  if (!v.carbOk) ax.push({ macro: "carb", side: v.carbOverPct > 0 ? "over" : "under" });
  return ax;
}
const AX_KEY = (a) => `${a.macro}-${a.side === "short" ? "short" : a.side}`;

function bucketOf(rec) {
  if (rec.degenerate) return "degenerate";
  if (rec.verdict.inBand) return null;              // not a failing day
  if (rec.slotsFilled === 0) return "empty-slot";
  const ax = axesOf(rec);
  if (!ax.length) return "unclassified";
  if (ax.length === 1) return AX_KEY(ax[0]);
  return `multi:${ax.map(AX_KEY).join("+")}`;
}

function load(p) {
  return fs.readFileSync(path.join(REPO, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ── per-dump analysis ───────────────────────────────────────────────────────
function analyze(file) {
  const recs = load(file);
  const A = {};
  A.file = file;
  A.seed = recs[0].run.seed;
  A.poolShape = recs[0].run.poolShape;
  A.dbSha256 = recs[0].run.dbSha256;
  A.gitSha = recs[0].run.gitSha;

  // replay every day
  const replay = new Map();
  let replayFail = 0, orderFail = 0;
  for (const r of recs) {
    const rp = replaySlotTargets(r);
    if (!rp.ok) { replayFail++; if (!rp.orderOk) orderFail++; }
    replay.set(r.dayKey, rp);
  }
  // VERIFY the replay against the product's own warning strings
  let wK = 0, wKok = 0, wKerr = [], wP = 0, wPok = 0;
  for (const r of recs) {
    const rp = replay.get(r.dayKey); if (!rp.ok) continue;
    for (const s of rp.slots) {
      if (!s.warning || !FALLBACK_RE.test(s.warning)) continue;
      const mk = s.warning.match(WARN_KCAL_RE);
      if (mk) { wK++; const want = Math.round(s.eff.kcalTarget); const got = Number(mk[2]); if (want === got) wKok++; else wKerr.push({ dayKey: r.dayKey, idx: s.idx, want, got }); }
      const mp = s.warning.match(WARN_PROT_RE);
      if (mp) { wP++; const want = Math.round(s.eff.proteinTarget); if (want === Number(mp[2])) wPok++; }
    }
  }
  A.replayCheck = {
    days: recs.length, replayFailures: replayFail, slotOrderFailures: orderFail,
    warningKcalTargets: wK, matched: wKok, mismatchRate: pct(wK - wKok, wK),
    warningProteinTargets: wP, proteinMatched: wPok,
    worstMismatches: wKerr.slice(0, 5),
  };

  // denominators
  const sets = {
    planned: recs,
    "planned-degenerate": recs.filter((r) => !r.degenerate),
    judged: recs.filter((r) => r.judged),
    "satisfiable-planned": recs.filter((r) => r.satisfiable),
    "satisfiable-planned-degenerate": recs.filter((r) => r.satisfiable && !r.degenerate),
    "satisfiable-judged": recs.filter((r) => r.satisfiable && r.judged),
  };
  A.denominators = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length]));
  A.levels = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, { n: v.length, inBand: v.filter((r) => r.verdict.inBand).length, pct: pct(v.filter((r) => r.verdict.inBand).length, v.length) }]));

  // ── A. BUCKETS ────────────────────────────────────────────────────────────
  function buckets(set, label) {
    const inBand = set.filter((r) => r.verdict.inBand).length;
    const fails = set.filter((r) => !r.verdict.inBand);
    const b = new Map();
    for (const r of fails) { const k = bucketOf(r) ?? "IN-BAND?!"; b.set(k, (b.get(k) || 0) + 1); }
    const rows = [...b.entries()].sort((x, y) => y[1] - x[1]);
    const sum = rows.reduce((s, x) => s + x[1], 0);
    return { denominator: label, n: set.length, inBand, failing: fails.length, bucketSum: sum, reconciles: sum === fails.length, buckets: Object.fromEntries(rows) };
  }
  A.buckets = {
    canonical: buckets(sets["satisfiable-planned-degenerate"], "satisfiable-planned−degenerate (553)"),
    satisfiableJudged: buckets(sets["satisfiable-judged"], "satisfiable-judged (537)"),
    planned: buckets(sets.planned, "planned (640)"),
    plannedMinusDegenerate: buckets(sets["planned-degenerate"], "planned−degenerate (639)"),
  };
  // per-diet and per-tier on the canonical set
  const canon = sets["satisfiable-planned-degenerate"];
  const group = (keyFn) => {
    const g = new Map();
    for (const r of canon) { const k = keyFn(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    return Object.fromEntries([...g.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, buckets(v, k)]));
  };
  A.bucketsPerDiet = group((r) => r.dietStyle);
  A.bucketsPerTier = group((r) => r.tier);

  // ── B. OVER-SIDE, THREE FRAMINGS ──────────────────────────────────────────
  function oversideAxes(set) {
    const c = { over: 0, short: 0, byAxis: {} };
    for (const r of set) {
      if (r.verdict.inBand || r.degenerate) continue;
      for (const a of axesOf(r)) {
        const k = AX_KEY(a);
        c.byAxis[k] = (c.byAxis[k] || 0) + 1;
        if (a.side === "over") c.over++; else c.short++;
      }
    }
    c.total = c.over + c.short;
    c.overPct = pct(c.over, c.total);
    const pShort = c.byAxis["protein-short"] || 0;
    c.exProtein = { over: c.over, short: c.short - pShort, total: c.total - pShort, overPct: pct(c.over, c.total - pShort) };
    return c;
  }
  function oversideDays(set) {
    const c = { pureOver: 0, mixed: 0, pureShort: 0, noAxis: 0, total: 0, emptySlotDays: 0 };
    for (const r of set) {
      if (r.verdict.inBand || r.degenerate) continue;
      c.total++;
      if (r.slotsFilled === 0) c.emptySlotDays++;
      const ax = axesOf(r);
      const o = ax.some((a) => a.side === "over"), s = ax.some((a) => a.side !== "over");
      if (!ax.length) c.noAxis++; else if (o && s) c.mixed++; else if (o) c.pureOver++; else c.pureShort++;
    }
    c.pureOverPct = pct(c.pureOver, c.total);
    c.overTouchedPct = pct(c.pureOver + c.mixed, c.total);
    return c;
  }
  function oversideSlots(set) {
    // filled slots only; graded against the slot's own EFFECTIVE target
    const c = {
      slots: 0, filled: 0,
      axisOver: 0, axisShort: 0, byAxis: {},
      gramsOver: { fat: 0, carb: 0, protein: 0 }, gramsShort: { fat: 0, carb: 0, protein: 0 },
      kcalOver: 0, kcalUnder: 0,
    };
    for (const r of set) {
      if (r.degenerate) continue;
      const rp = replay.get(r.dayKey); if (!rp.ok) continue;
      for (const s of rp.slots) {
        c.slots++;
        if (!s.filled) continue;
        c.filled++;
        const a = s.achieved, e = s.eff;
        const bump = (k, side) => { c.byAxis[`${k}-${side}`] = (c.byAxis[`${k}-${side}`] || 0) + 1; if (side === "over") c.axisOver++; else c.axisShort++; };
        if (e.kcalTarget > 0) {
          const d = (a.kcal - e.kcalTarget) / e.kcalTarget;
          if (d > KCAL_TOLERANCE_PCT) { bump("kcal", "over"); c.kcalOver += a.kcal - e.kcalTarget; }
          else if (d < -KCAL_TOLERANCE_PCT) { bump("kcal", "short"); c.kcalUnder += e.kcalTarget - a.kcal; }
        }
        if (e.proteinTarget > 0) {
          const d = (a.protein - e.proteinTarget) / e.proteinTarget;
          if (d < -PROTEIN_TOLERANCE_PCT) bump("protein", "short");
          else if (d > PROTEIN_TOLERANCE_PCT) bump("protein", "over(UNPENALISED)");
        }
        for (const m of ["fat", "carb"]) {
          const tg = m === "fat" ? e.fatTarget : e.carbTarget;
          if (tg == null) continue;
          const av = a[m];
          if (av > tg) c.gramsOver[m] += av - tg; else c.gramsShort[m] += tg - av;
          // relative miss needs a positive divisor; a FLOORED (0) target is
          // reported separately, never divided by.
          if (tg <= 0) { if (av > 0) bump(m, "over"); continue; }
          const d = (av - tg) / tg;
          if (d > SLOT_COMP_TOL) bump(m, "over"); else if (d < -SLOT_COMP_TOL) bump(m, "short");
        }
      }
    }
    c.axisTotal = c.axisOver + c.axisShort;
    c.overPct = pct(c.axisOver, c.axisTotal);
    c.gramsOverPct = { fat: pct(c.gramsOver.fat, c.gramsOver.fat + c.gramsShort.fat), carb: pct(c.gramsOver.carb, c.gramsOver.carb + c.gramsShort.carb) };
    for (const k of ["fat", "carb", "protein"]) { c.gramsOver[k] = Math.round(c.gramsOver[k]); c.gramsShort[k] = Math.round(c.gramsShort[k]); }
    c.kcalOver = Math.round(c.kcalOver); c.kcalUnder = Math.round(c.kcalUnder);
    return c;
  }
  A.overside = {};
  for (const [k, v] of Object.entries(sets)) A.overside[k] = { axes: oversideAxes(v), days: oversideDays(v), slots: oversideSlots(v) };

  // ── D. B9 ACCUMULATION ────────────────────────────────────────────────────
  // cumulative achieved fat / cumulative nominal fat share, by slot position,
  // over the canonical set. Both median-of-day-ratios and pooled Σ/Σ.
  const accum = [];
  const flooredFat = [];
  for (const r of canon) {
    const rp = replay.get(r.dayKey); if (!rp.ok) continue;
    let cf = 0, cs = 0;
    for (const s of rp.slots) {
      cf += s.achieved.fat; cs += s.nom.fatShare ?? 0;
      const pos = s.idx;
      accum[pos] = accum[pos] || { pos: pos + 1, dayRatios: [], sumFat: 0, sumShare: 0, n: 0, slotTypes: {} };
      if (cs > 0) { accum[pos].dayRatios.push(cf / cs); accum[pos].sumFat += cf; accum[pos].sumShare += cs; accum[pos].n++; }
      accum[pos].slotTypes[s.slotType] = (accum[pos].slotTypes[s.slotType] || 0) + 1;
      if (s.filled && s.eff.fatTarget != null && s.eff.fatTarget <= 0) flooredFat.push(s.achieved.fat);
    }
  }
  A.b9 = {
    denominator: "satisfiable-planned−degenerate (553 days)",
    cumulativeFatRatioBySlotOrder: accum.filter(Boolean).map((a) => ({
      slotPosition: a.pos, days: a.n, medianDayRatio: r3(med(a.dayRatios)), pooledRatio: r3(a.sumFat / a.sumShare), slotTypes: a.slotTypes,
    })),
    flooredFatTarget: {
      note: "slots SOLVED (recipe shipped) whose carry-forward fatTarget = max(0, (budgetFat-achieved)*share) had already floored to 0",
      slots: flooredFat.length, medianFatShippedG: r2(med(flooredFat)),
      meanFatShippedG: r2(flooredFat.reduce((s, x) => s + x, 0) / (flooredFat.length || 1)),
      totalFatShippedG: Math.round(flooredFat.reduce((s, x) => s + x, 0)),
      zeroG: flooredFat.filter((x) => x === 0).length,
    },
  };
  // per-slot-position fat over-ratio (not cumulative) — is the LAST slot the worst?
  const perPos = [];
  for (const r of canon) {
    const rp = replay.get(r.dayKey); if (!rp.ok) continue;
    for (const s of rp.slots) {
      perPos[s.idx] = perPos[s.idx] || { pos: s.idx + 1, ratios: [], n: 0, filled: 0 };
      perPos[s.idx].n++;
      if (s.filled && s.nom.fatShare > 0) { perPos[s.idx].ratios.push(s.achieved.fat / s.nom.fatShare); perPos[s.idx].filled++; }
    }
  }
  A.b9.perSlotFatVsNominalShare = perPos.filter(Boolean).map((p) => ({ slotPosition: p.pos, slots: p.n, filled: p.filled, medianRatio: r3(med(p.ratios)) }));

  // ── E. B8 SLOT SIZE ───────────────────────────────────────────────────────
  const BANDS = [[0, 150], [150, 250], [250, 400], [400, 500], [500, 700], [700, Infinity]];
  const bandRow = () => ({ slots: 0, unsolved: 0, snack: 0, meal: 0, snackUnsolved: 0, mealUnsolved: 0, fatOver: [], mealFatOver: [] });
  const byNom = BANDS.map(bandRow), byEff = BANDS.map(bandRow);
  const bandIdx = (k) => BANDS.findIndex(([lo, hi]) => k >= lo && k < hi);
  for (const r of canon) {
    const rp = replay.get(r.dayKey); if (!rp.ok) continue;
    for (const s of rp.slots) {
      for (const [arr, key] of [[byNom, s.nom.kcalTarget], [byEff, s.eff.kcalTarget]]) {
        const i = bandIdx(key); if (i < 0) continue;
        const row = arr[i];
        row.slots++; row[s.slotType]++;
        if (!s.filled) { row.unsolved++; row[`${s.slotType}Unsolved`]++; continue; }
        const tg = s.eff.fatTarget;
        if (tg != null && tg > 0) { row.fatOver.push(s.achieved.fat / tg - 1); if (s.slotType === "meal") row.mealFatOver.push(s.achieved.fat / tg - 1); }
      }
    }
  }
  const fmtBands = (arr) => arr.map((row, i) => ({
    band: BANDS[i][1] === Infinity ? `${BANDS[i][0]}+` : `${BANDS[i][0]}-${BANDS[i][1]}`,
    slots: row.slots, unsolved: row.unsolved, unsolvedPct: pct(row.unsolved, row.slots),
    snackSlots: row.snack, mealSlots: row.meal,
    snackShareOfBand: pct(row.snack, row.slots),
    snackUnsolved: row.snackUnsolved, mealUnsolved: row.mealUnsolved,
    mealOnlyUnsolvedPct: pct(row.mealUnsolved, row.meal),
    snackOnlyUnsolvedPct: pct(row.snackUnsolved, row.snack),
    medianFatOverPctVsEffTarget: row.fatOver.length ? Math.round(med(row.fatOver) * 1000) / 10 : null,
    medianFatOverPctMealsOnly: row.mealFatOver.length ? Math.round(med(row.mealFatOver) * 1000) / 10 : null,
  }));
  A.b8 = { denominator: "all slots of the 553 canonical days", byNominalKcalTarget: fmtBands(byNom), byEffectiveKcalTarget: fmtBands(byEff) };

  // ── F. B6 CLOSEST-MISS FALLBACK ───────────────────────────────────────────
  const fb = { shipped: 0, fallback: 0, fatOverFallback: 0, fatOverOther: 0, fatOverTotal: 0, fbList: [], otherList: [], kcalOverFallback: 0, kcalOverOther: 0 };
  for (const r of canon) {
    const rp = replay.get(r.dayKey); if (!rp.ok) continue;
    for (const s of rp.slots) {
      if (!s.filled) continue;
      fb.shipped++;
      const isFb = !!(s.warning && FALLBACK_RE.test(s.warning));
      const tg = s.eff.fatTarget;
      const over = tg == null ? 0 : Math.max(0, s.achieved.fat - tg);
      const kOver = s.eff.kcalTarget > 0 ? Math.max(0, s.achieved.kcal - s.eff.kcalTarget) : 0;
      fb.fatOverTotal += over;
      if (isFb) { fb.fallback++; fb.fatOverFallback += over; fb.fbList.push(over); fb.kcalOverFallback += kOver; }
      else { fb.fatOverOther += over; fb.otherList.push(over); fb.kcalOverOther += kOver; }
    }
  }
  A.b6 = {
    denominator: "shipped (filled) slots of the 553 canonical days",
    shippedSlots: fb.shipped, fallbackSlots: fb.fallback, fallbackPctOfShipped: pct(fb.fallback, fb.shipped),
    totalFatOverageG: Math.round(fb.fatOverTotal),
    fallbackFatOverageG: Math.round(fb.fatOverFallback),
    fallbackShareOfFatOveragePct: pct(fb.fatOverFallback, fb.fatOverTotal),
    fatOveragePerFallbackSlotG: r2(fb.fatOverFallback / (fb.fallback || 1)),
    fatOveragePerOtherSlotG: r2(fb.fatOverOther / ((fb.shipped - fb.fallback) || 1)),
    medianFatOverageFallbackG: r2(med(fb.fbList)), medianFatOverageOtherG: r2(med(fb.otherList)),
    kcalOveragePerFallbackSlot: Math.round(fb.kcalOverFallback / (fb.fallback || 1)),
    kcalOveragePerOtherSlot: Math.round(fb.kcalOverOther / ((fb.shipped - fb.fallback) || 1)),
  };

  // ── G. B5 ONE-SIDED PENALTY ───────────────────────────────────────────────
  const protRatios = [], fatVs28 = [], fatVsMid = [];
  let over12 = 0, over12Filled = 0, filledDays = 0;
  for (const r of canon) {
    const t = r.target, pMid = (t.proteinLo + t.proteinHi) / 2;
    if (pMid > 0) { const ratio = r.achieved.protein / pMid; protRatios.push(ratio); if (ratio > 1.12) over12++; }
    if (r.slotsFilled > 0) { filledDays++; if (pMid > 0 && r.achieved.protein / pMid > 1.12) over12Filled++; }
    const ask28 = 0.28 * t.kcal / 9;
    if (ask28 > 0) fatVs28.push(r.achieved.fat / ask28 - 1);
    const fm = bandMidpoint(t.fatLo, t.fatHi);
    if (fm > 0) fatVsMid.push(r.achieved.fat / fm - 1);
  }
  // a-priori geometry: for each canonical day, what share of the 910-recipe
  // library has a fat DENSITY (g fat per kcal) below the day's graded low edge,
  // and what share above its graded high edge. Portion scaling cannot move a
  // dish's fat-per-kcal, so this is the geometry the search starts from.
  const dens = RECIPES.recipes.filter((x) => x.kcal > 0).map((x) => x.fat / x.kcal);
  const lowOnly = [], highOnly = [];
  for (const r of canon) {
    const t = r.target;
    const fm = bandMidpoint(t.fatLo, t.fatHi); if (!(fm > 0) || !(t.kcal > 0)) continue;
    const lo = (t.fatLo - 0.25 * fm) / t.kcal, hi = (t.fatHi + 0.25 * fm) / t.kcal;   // D3 graded window
    lowOnly.push(dens.filter((d) => d < lo).length / dens.length);
    highOnly.push(dens.filter((d) => d > hi).length / dens.length);
  }
  A.b5 = {
    denominator: "satisfiable-planned−degenerate (553 days)",
    proteinOver12PctOfMid: { days: over12, n: canon.length, pct: pct(over12, canon.length), pctOfFilledDays: pct(over12Filled, filledDays), filledDays },
    medianProteinVsMidPct: Math.round((med(protRatios) - 1) * 1000) / 10,
    p90ProteinVsMidPct: Math.round((([...protRatios].sort((a, b) => a - b)[Math.floor(protRatios.length * 0.9)]) - 1) * 1000) / 10,
    medianFatVs28pctEAskPct: Math.round(med(fatVs28) * 1000) / 10,
    medianFatVsFatMidPct: Math.round(med(fatVsMid) * 1000) / 10,
    aPrioriGeometry: {
      method: "share of the 910-recipe library whose fat-per-kcal density falls BELOW the day's graded low edge vs ABOVE its graded high edge (D3 window: fatLo-0.25*fatMid .. fatHi+0.25*fatMid), averaged over the 553 days. Library-wide, not per-persona pool.",
      meanShareLowOnlyPct: Math.round((lowOnly.reduce((s, x) => s + x, 0) / lowOnly.length) * 10000) / 100,
      meanShareHighOnlyPct: Math.round((highOnly.reduce((s, x) => s + x, 0) / highOnly.length) * 10000) / 100,
    },
  };

  // ── H. I7 CARRY-FORWARD RATIO ─────────────────────────────────────────────
  // nominal per-slot protein density is CONSTANT within a day (both targets
  // scale by the same share) = pMid/targetKcal. The effective density after the
  // two independent clamps is what resolveSlot actually asks for.
  const poolMax = {};
  const byId = new Map(RECIPES.recipes.map((r) => [r.id, r]));
  for (const [diet, v] of Object.entries(POOLS)) {
    const ds = v.poolIds.map((id) => byId.get(id)).filter((r) => r && r.kcal > 0).map((r) => r.protein / r.kcal);
    ds.sort((a, b) => a - b);
    poolMax[diet] = { n: ds.length, max: ds[ds.length - 1], p99: ds[Math.floor(ds.length * 0.99)] ?? ds[ds.length - 1] };
  }
  const i7 = { slots: 0, ratios: [], aboveMaxSlots: 0, aboveP99Slots: 0, nominalAboveMax: new Set(), carryAboveMax: new Set(), carryAboveP99: new Set(), personas: new Set(), maxRatio: 0, worst: [] };
  for (const r of canon) {
    const rp = replay.get(r.dayKey); if (!rp.ok) continue;
    i7.personas.add(r.personaId);
    const pm = poolMax[r.dietStyle] || poolMax.none;
    const t = r.target, pMid = (t.proteinLo + t.proteinHi) / 2;
    const dNom = t.kcal > 0 ? pMid / t.kcal : 0;
    if (dNom > pm.max) i7.nominalAboveMax.add(r.personaId);
    for (const s of rp.slots) {
      if (!(s.eff.kcalTarget > 0)) continue;
      i7.slots++;
      const dEff = s.eff.proteinTarget / s.eff.kcalTarget;
      const ratio = dNom > 0 ? dEff / dNom : 1;
      i7.ratios.push(ratio);
      if (ratio > i7.maxRatio) i7.maxRatio = ratio;
      if (dEff > pm.max) { i7.aboveMaxSlots++; i7.carryAboveMax.add(r.personaId); }
      if (dEff > pm.p99) { i7.aboveP99Slots++; i7.carryAboveP99.add(r.personaId); }
      if (ratio > 1.5) i7.worst.push({ dayKey: r.dayKey, slot: s.idx, ratio: r3(ratio), dEff: r3(dEff * 100), poolMax: r3(pm.max * 100) });
    }
  }
  const sr = [...i7.ratios].sort((a, b) => a - b);
  A.i7 = {
    denominator: "all slots of the 553 canonical days; personas measured over the 218 satisfiable personas present",
    poolMaxMethod: "max / p99 of (recipe protein g per kcal) over W1-5's per-DIET-STYLE pool (allergen stacking NOT applied, so these bounds are GENEROUS — the real per-persona pool is smaller and the true counts can only be higher)",
    slots: i7.slots,
    ratioEffOverNominalDensity: { median: r3(med(sr)), p90: r3(sr[Math.floor(sr.length * 0.9)]), p99: r3(sr[Math.floor(sr.length * 0.99)]), max: r3(i7.maxRatio), theoreticalMax: r3(1.3 / 0.7) },
    slotsWithRatioAbove1_2: i7.ratios.filter((x) => x > 1.2).length,
    slotsWithRatioAbove1_5: i7.ratios.filter((x) => x > 1.5).length,
    personas: i7.personas.size,
    nominalAskAbovePoolMaxPersonas: i7.nominalAboveMax.size,
    carryAskAbovePoolMaxPersonas: i7.carryAboveMax.size,
    carryAskAbovePoolP99Personas: i7.carryAboveP99.size,
    slotsAbovePoolMax: i7.aboveMaxSlots, slotsAbovePoolP99: i7.aboveP99Slots,
    poolMaxPer100kcal: Object.fromEntries(Object.entries(poolMax).map(([k, v]) => [k, { n: v.n, maxProteinPer100kcal: r2(v.max * 100), p99: r2(v.p99 * 100) }])),
    worstSample: i7.worst.sort((a, b) => b.ratio - a.ratio).slice(0, 5),
  };

  // ── I. D7 classifyBinding ─────────────────────────────────────────────────
  // Per PERSONA (classifyBinding is horizon-level, one key per plan). The
  // `observed` counters it would read are reconstructed from the persona's own
  // day records.
  const byPersona = new Map();
  for (const r of recs) { if (!byPersona.has(r.personaId)) byPersona.set(r.personaId, []); byPersona.get(r.personaId).push(r); }
  const d7 = { personas: 0, days: 0, keyHist: {}, protDensPersonas: 0, protDensDays: 0, lyingPersonas: 0, lyingDays: 0, examples: [], anyMissPersonas: 0, anyMissDays: 0, agreePersonas: 0 };
  for (const [pid, rs] of byPersona) {
    const key = rs[0].horizonBinding?.key ?? null;
    d7.personas++; d7.days += rs.length;
    d7.keyHist[key ?? "null"] = (d7.keyHist[key ?? "null"] || 0) + 1;
    const fatOff = rs.filter((r) => !r.verdict.fatOk).length;
    const carbOff = rs.filter((r) => !r.verdict.carbOk).length;
    const kcalOff = rs.filter((r) => !r.verdict.kcalOk).length;
    const protShort = rs.filter((r) => !r.verdict.proteinOk).length;
    const anyMiss = rs.some((r) => !r.verdict.inBand);
    if (anyMiss) { d7.anyMissPersonas++; d7.anyMissDays += rs.length; }
    if (key === "protein-density") { d7.protDensPersonas++; d7.protDensDays += rs.length; }
    // THE LIE: PROTEIN_DENSITY (mealSolver.js:1121) is returned before the
    // composition branch (:1131) can read `observed`. If the plan's OBSERVED
    // misses are fat/carb-shaped, the composition branch would have fired had
    // the order been the other way round.
    if (key === "protein-density" && (fatOff > 0 || carbOff > 0)) {
      d7.lyingPersonas++; d7.lyingDays += rs.length;
      if (d7.examples.length < 6) d7.examples.push({ personaId: pid, diet: rs[0].dietStyle, days: rs.length, fatOff, carbOff, kcalOff, protShort, emittedKey: key, correctedKey: "macro-composition" });
    }
  }
  A.d7 = {
    denominatorNote: "classifyBinding is HORIZON-level: one key per persona-plan. Reported over personas AND over the days those plans cover.",
    personas: d7.personas, days: d7.days,
    horizonKeyHistogram: d7.keyHist,
    proteinDensityPersonas: d7.protDensPersonas, proteinDensityDays: d7.protDensDays,
    misclassifiedPersonas: d7.lyingPersonas, misclassifiedDays: d7.lyingDays,
    ratePersonasAll: pct(d7.lyingPersonas, d7.personas),
    rateDaysAll: pct(d7.lyingDays, d7.days),
    ratePersonasWithAMiss: pct(d7.lyingPersonas, d7.anyMissPersonas),
    rateDaysOfPlansWithAMiss: pct(d7.lyingDays, d7.anyMissDays),
    plansWithAMiss: d7.anyMissPersonas, daysOfPlansWithAMiss: d7.anyMissDays,
    shareOfProteinDensityPlansThatAreWrong: pct(d7.lyingPersonas, d7.protDensPersonas),
    examples: d7.examples,
  };

  // ── B1 supporting numbers ─────────────────────────────────────────────────
  const b1 = {};
  for (const [name, set] of Object.entries(sets)) {
    const s = { fatOver: 0, fatShort: 0, carbOver: 0, carbShort: 0, kcalOver: 0, kcalShort: 0, proteinShort: 0, fatOnly: 0, fatOnlyOver: 0 };
    for (const r of set) {
      if (r.degenerate) continue;
      const v = r.verdict; if (v.inBand) continue;
      if (!v.fatOk) { if (v.fatOverPct > 0) s.fatOver++; else s.fatShort++; }
      if (!v.carbOk) { if (v.carbOverPct > 0) s.carbOver++; else s.carbShort++; }
      if (!v.kcalOk) { if (v.kcalDeltaPct > 0) s.kcalOver++; else s.kcalShort++; }
      if (!v.proteinOk) s.proteinShort++;
      const ax = axesOf(r);
      if (ax.length === 1 && ax[0].macro === "fat") { s.fatOnly++; if (ax[0].side === "over") s.fatOnlyOver++; }
    }
    b1[name] = s;
  }
  A.b1 = b1;

  // ── B10 headline ──────────────────────────────────────────────────────────
  A.b10 = {
    canonical553: { axes: A.overside["satisfiable-planned-degenerate"].axes, days: A.overside["satisfiable-planned-degenerate"].days, slots: A.overside["satisfiable-planned-degenerate"].slots },
  };
  return A;
}

// ── run ─────────────────────────────────────────────────────────────────────
const FILES = {
  "route-s424242": "fleet/out/W1-2/daydump-route-s424242.jsonl",
  "route-s20260730": "fleet/out/W1-2/daydump-route-s20260730.jsonl",
  "route-s8675309": "fleet/out/W1-2/daydump-route-s8675309.jsonl",
  "rigshape-s424242": "fleet/out/W1-2/daydump-rigshape-s424242.jsonl",
};
const out = { meta: { agent: "W1-3", generatedAt: new Date().toISOString(), inputs: FILES, canonicalDenominator: "satisfiable-planned−degenerate = 553", constants: { CARRY_CAP_PCT, KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT, SLOT_COMP_TOL } }, runs: {} };
for (const [k, f] of Object.entries(FILES)) {
  process.stderr.write(`analyzing ${k}…\n`);
  out.runs[k] = analyze(f);
}
fs.writeFileSync(path.join(HERE, "taxonomy.json"), JSON.stringify(out, null, 1));
console.log(`wrote taxonomy.json`);

// ── console report ──────────────────────────────────────────────────────────
const P = (s) => console.log(s);
const A = out.runs["route-s424242"];
P("\n================ REPLAY VERIFICATION ================");
P(JSON.stringify(A.replayCheck, null, 1));
P("\n================ LEVELS ================");
P(JSON.stringify(A.levels, null, 1));
P("\n================ A. BUCKETS (canonical 553) ================");
P(JSON.stringify(A.buckets.canonical, null, 1));
P("\n---- same, satisfiable-judged 537 ----");
P(JSON.stringify(A.buckets.satisfiableJudged, null, 1));
P("\n---- planned 640 ----");
P(JSON.stringify(A.buckets.planned, null, 1));
P("\n================ B. OVER-SIDE, EVERY DENOMINATOR ================");
for (const [k, v] of Object.entries(A.overside)) {
  P(`\n[${k}]  AXES over ${v.axes.over}/${v.axes.total} = ${v.axes.overPct}%  (ex-protein ${v.axes.exProtein.over}/${v.axes.exProtein.total} = ${v.axes.exProtein.overPct}%)`);
  P(`      DAYS pureOver ${v.days.pureOver}/${v.days.total} = ${v.days.pureOverPct}%  mixed ${v.days.mixed}  pureShort ${v.days.pureShort}  (over-touched ${v.days.overTouchedPct}%)  emptySlotDays ${v.days.emptySlotDays}`);
  P(`      SLOTS over ${v.slots.axisOver}/${v.slots.axisTotal} = ${v.slots.overPct}%   fat g over ${v.slots.gramsOver.fat} vs short ${v.slots.gramsShort.fat} (${v.slots.gramsOverPct.fat}% over)`);
  P(`      axis hist ${JSON.stringify(v.axes.byAxis)}`);
  P(`      slot hist ${JSON.stringify(v.slots.byAxis)}`);
}
P("\n================ RIG SHAPE (W1-6 reconciliation) ================");
const R = out.runs["rigshape-s424242"];
for (const k of ["satisfiable-judged", "satisfiable-planned-degenerate"]) {
  const v = R.overside[k];
  P(`[rig ${k}] axes over ${v.axes.over}/${v.axes.total}=${v.axes.overPct}% (exProt ${v.axes.exProtein.over}/${v.axes.exProtein.total}=${v.axes.exProtein.overPct}%) | days pureOver ${v.days.pureOver}/${v.days.total}=${v.days.pureOverPct}% mixed ${v.days.mixed} pureShort ${v.days.pureShort}`);
  P(`   axis hist ${JSON.stringify(v.axes.byAxis)}`);
}
P("\n================ D. B9 ACCUMULATION ================");
P(JSON.stringify(A.b9, null, 1));
P("\n================ E. B8 SLOT SIZE ================");
P("by NOMINAL kcalTarget:"); console.table(A.b8.byNominalKcalTarget);
P("by EFFECTIVE kcalTarget:"); console.table(A.b8.byEffectiveKcalTarget);
P("\n================ F. B6 FALLBACK ================");
P(JSON.stringify(A.b6, null, 1));
P("\n================ G. B5 ================");
P(JSON.stringify(A.b5, null, 1));
P("\n================ H. I7 ================");
P(JSON.stringify(A.i7, null, 1));
P("\n================ I. D7 ================");
P(JSON.stringify(A.d7, null, 1));
P("\n================ B1 ================");
P(JSON.stringify(A.b1["satisfiable-judged"], null, 1));
P(JSON.stringify(A.b1["satisfiable-planned-degenerate"], null, 1));
P("\n================ PER-DIET BUCKETS (canonical) ================");
for (const [d, v] of Object.entries(A.bucketsPerDiet)) P(`${d.padEnd(14)} n=${String(v.n).padStart(3)} inBand=${String(v.inBand).padStart(3)} fail=${String(v.failing).padStart(3)} sum=${v.bucketSum} ok=${v.reconciles} :: ${JSON.stringify(v.buckets)}`);
P("\n================ PER-TIER BUCKETS (canonical) ================");
for (const [d, v] of Object.entries(A.bucketsPerTier)) P(`${d.padEnd(12)} n=${String(v.n).padStart(3)} inBand=${String(v.inBand).padStart(3)} fail=${String(v.failing).padStart(3)} sum=${v.bucketSum} ok=${v.reconciles} :: ${JSON.stringify(v.buckets)}`);
P("\n================ CROSS-SEED ================");
for (const k of ["route-s424242", "route-s20260730", "route-s8675309"]) {
  const x = out.runs[k], c = x.overside["satisfiable-planned-degenerate"];
  P(`${k}: canonical fail=${x.buckets.canonical.failing} | axes over ${c.axes.overPct}% | days pureOver ${c.days.pureOverPct}% | slots over ${c.slots.overPct}% | top buckets ${JSON.stringify(Object.fromEntries(Object.entries(x.buckets.canonical.buckets).slice(0, 6)))}`);
}
