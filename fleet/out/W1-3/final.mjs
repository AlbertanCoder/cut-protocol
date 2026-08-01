// W1-3 final — the headline block, and the exact proof of the 74% vs 96% gap.
// Appends a HEADLINE section to taxonomy.json. Pure arithmetic, no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ADJ = JSON.parse(fs.readFileSync(path.join(HERE, "adjuster-foods.json"), "utf8"));
const TAX = JSON.parse(fs.readFileSync(path.join(HERE, "taxonomy.json"), "utf8"));
const load = (p) => fs.readFileSync(path.join(REPO, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const bandMidpoint = (lo, hi) => (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > 0) ? null : (lo + hi) / 2);
const clamp = (v, { min, max }) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min);

function axesOf(r) {
  const v = r.verdict, ax = [];
  if (!v.kcalOk) ax.push({ macro: "kcal", side: v.kcalDeltaPct > 0 ? "over" : "under" });
  if (!v.proteinOk) ax.push({ macro: "protein", side: "short" });
  if (!v.fatOk) ax.push({ macro: "fat", side: v.fatOverPct > 0 ? "over" : "under" });
  if (!v.carbOk) ax.push({ macro: "carb", side: v.carbOverPct > 0 ? "over" : "under" });
  return ax;
}
function weightsFor(meals, snacks) {
  const w = [];
  for (let i = 0; i < meals; i++) w.push({ slotType: "meal", weight: meals === 1 ? 1 : i === meals - 1 ? 1.15 : i === 0 ? 0.9 : 1 });
  for (let i = 0; i < snacks; i++) w.push({ slotType: "snack", weight: 0.4 });
  return w;
}
function replay(rec) {
  const t = rec.target, w = weightsFor(rec.mealsPerDay, rec.snacksPerDay), slots = rec.slots || [];
  if (!slots.length || slots.length !== w.length) return null;
  const pM = (t.proteinLo + t.proteinHi) / 2, fM = bandMidpoint(t.fatLo, t.fatHi);
  const cM = Number.isFinite(t.carbMid) && bandMidpoint(t.carbLo, t.carbHi) != null ? t.carbMid : bandMidpoint(t.carbLo, t.carbHi);
  const per = w.reduce((s, x) => s + x.weight, 0);
  const bK = Math.max(0, t.kcal), bP = Math.max(0, pM), bF = fM == null ? null : Math.max(0, fM), bC = cM == null ? null : Math.max(0, cM);
  const pre = slots.map((s) => {
    let k = s.kcal || 0, p = s.protein || 0, f = s.fat || 0, c = s.carb || 0;
    for (const a of s.adjusters || []) { const fo = ADJ.foods[a.foodId]; if (!fo) return null; const g = (a.grams || 0) / 100; k -= fo.kcal * g; p -= fo.protein * g; f -= fo.fat * g; c -= fo.carb * g; }
    return { kcal: k, protein: p, fat: f, carb: c };
  });
  if (pre.some((x) => x == null)) return null;
  const nom = w.map((x) => ({ ...x, kcalTarget: bK * (x.weight / per), proteinTarget: bP * (x.weight / per), fatShare: bF == null ? null : bF * (x.weight / per), carbShare: bC == null ? null : bC * (x.weight / per) }));
  let aK = 0, aP = 0, aF = 0, aC = 0; const out = [];
  for (let i = 0; i < nom.length; i++) {
    const rw = nom.slice(i).reduce((s, x) => s + x.weight, 0), share = rw > 0 ? nom[i].weight / rw : 1;
    out.push({
      idx: i, slotType: nom[i].slotType, nom: nom[i], achieved: pre[i], filled: !!slots[i].recipeId,
      eff: {
        kcalTarget: clamp((bK - aK) * share, { min: nom[i].kcalTarget * 0.7, max: nom[i].kcalTarget * 1.3 }),
        proteinTarget: clamp((bP - aP) * share, { min: nom[i].proteinTarget * 0.7, max: nom[i].proteinTarget * 1.3 }),
        fatTarget: nom[i].fatShare == null ? null : Math.max(0, (bF - aF) * share),
        carbTarget: nom[i].carbShare == null ? null : Math.max(0, (bC - aC) * share),
      },
    });
    aK += pre[i].kcal; aP += pre[i].protein; aF += pre[i].fat; aC += pre[i].carb;
  }
  return out;
}

const H = {};
for (const [runName, file] of Object.entries({ route: "fleet/out/W1-2/daydump-route-s424242.jsonl", rig: "fleet/out/W1-2/daydump-rigshape-s424242.jsonl" })) {
  const recs = load(file);
  const canon = recs.filter((r) => r.satisfiable && !r.degenerate);
  const fails = canon.filter((r) => !r.verdict.inBand);
  const empty = fails.filter((r) => r.slotsFilled === 0);
  const withFood = fails.filter((r) => r.slotsFilled > 0);

  // exact axis accounting
  const cnt = (set) => { const c = { over: 0, short: 0, protein: 0 }; for (const r of set) for (const a of axesOf(r)) { if (a.side === "over") c.over++; else { c.short++; if (a.macro === "protein") c.protein++; } } return c; };
  const all = cnt(fails), em = cnt(empty), wf = cnt(withFood);

  // slot-level over-side, restricted to FAILING days that contain food
  const KT = 0.15, PT = 0.12, CT = 0.25;
  const slotStats = (set) => {
    const c = { filled: 0, over: 0, short: 0, byAxis: {}, fatOverG: 0, fatShortG: 0, carbOverG: 0, carbShortG: 0 };
    for (const r of set) {
      const rp = replay(r); if (!rp) continue;
      for (const s of rp) {
        if (!s.filled) continue;
        c.filled++;
        const bump = (k, side) => { c.byAxis[`${k}-${side}`] = (c.byAxis[`${k}-${side}`] || 0) + 1; if (side === "over") c.over++; else c.short++; };
        if (s.eff.kcalTarget > 0) { const d = (s.achieved.kcal - s.eff.kcalTarget) / s.eff.kcalTarget; if (d > KT) bump("kcal", "over"); else if (d < -KT) bump("kcal", "short"); }
        if (s.eff.proteinTarget > 0) { const d = (s.achieved.protein - s.eff.proteinTarget) / s.eff.proteinTarget; if (d < -PT) bump("protein", "short"); }
        for (const m of ["fat", "carb"]) {
          const tg = m === "fat" ? s.eff.fatTarget : s.eff.carbTarget; if (tg == null) continue;
          const av = s.achieved[m];
          if (av > tg) c[`${m}OverG`] += av - tg; else c[`${m}ShortG`] += tg - av;
          if (tg <= 0) { if (av > 0) bump(m, "over"); continue; }
          const d = (av - tg) / tg;
          if (d > CT) bump(m, "over"); else if (d < -CT) bump(m, "short");
        }
      }
    }
    c.total = c.over + c.short; c.overPct = pct(c.over, c.total);
    for (const k of ["fatOverG", "fatShortG", "carbOverG", "carbShortG"]) c[k] = Math.round(c[k]);
    c.fatOverSharePct = pct(c.fatOverG, c.fatOverG + c.fatShortG);
    return c;
  };

  H[runName] = {
    canonical: canon.length, failing: fails.length,
    emptyPlateDays: empty.length, failingDaysWithFood: withFood.length,
    axes: {
      "all failing days": { over: all.over, short: all.short, total: all.over + all.short, overPct: pct(all.over, all.over + all.short), exProtein: { over: all.over, short: all.short - all.protein, overPct: pct(all.over, all.over + all.short - all.protein) } },
      "empty-plate days only": { over: em.over, short: em.short, nonProteinShort: em.short - em.protein, note: "a plan containing no food is short on EVERY axis by arithmetic; 0 over-side axes exist here by construction" },
      "failing days that contain food": { over: wf.over, short: wf.short, total: wf.over + wf.short, overPct: pct(wf.over, wf.over + wf.short), exProtein: { over: wf.over, short: wf.short - wf.protein, overPct: pct(wf.over, wf.over + wf.short - wf.protein) } },
    },
    days: {
      "all failing": { n: fails.length, pureOver: fails.filter((r) => { const a = axesOf(r); return a.length && a.every((x) => x.side === "over"); }).length },
      "failing with food": { n: withFood.length, pureOver: withFood.filter((r) => { const a = axesOf(r); return a.length && a.every((x) => x.side === "over"); }).length, mixed: withFood.filter((r) => { const a = axesOf(r); return a.some((x) => x.side === "over") && a.some((x) => x.side !== "over"); }).length, pureShort: withFood.filter((r) => { const a = axesOf(r); return a.length && a.every((x) => x.side !== "over"); }).length },
    },
    slots: { "all canonical days": slotStats(canon), "failing days with food": slotStats(withFood), "in-band days": slotStats(canon.filter((r) => r.verdict.inBand)) },
  };
  H[runName].days["all failing"].pureOverPct = pct(H[runName].days["all failing"].pureOver, fails.length);
  H[runName].days["failing with food"].pureOverPct = pct(H[runName].days["failing with food"].pureOver, withFood.length);
}

H.RECONCILIATION = {
  question: "74.2% (prompt block) vs 95.8% axes / 94.2% days (W1-6) vs W1-2's per-macro split — all three, resolved",
  answer: [
    "All three are correct arithmetic on DIFFERENT denominators. Nothing disagrees; the label was missing.",
    "W1-6's 95.8% axes / 94.2% days reproduces BYTE-EXACT on fleet/out/W1-2/daydump-rigshape-s424242.jsonl at satisfiable-JUDGED (537): 159/166 axes = 95.8%, 113/120 days = 94.2%. Confirmed by W1-3 independently.",
    "The prompt block's 74.2% is the same over-side share computed on satisfiable-PLANNED with protein excluded: measured 74.6% (rig s424242), 75.0/72.8/74.4% (route, 3 seeds). Within 0.4 pt of 74.2.",
    "The ENTIRE gap is the 16 A6 total-failure days. A plan containing no food is arithmetically SHORT on kcal, fat and carb — 3 non-protein short axes each, 48 axes. 165 axes + 48 = 213; 159/165 = 96.4% becomes 159/213 = 74.6%. That is the whole difference, to the axis.",
    "W1-2's per-macro split (fat 82/0, carb 50/5, kcal 30/1, protein 3 short) is satisfiable-JUDGED and reproduces exactly.",
  ],
  recommendationForW34: "Cite the DAY framing on failing days that contain food. A trimmer's addressable population is days that HAVE a plate. Empty-plate days are pool-caused (W1-5 F5: 141 of 191 empty slots are snacks, 135 arithmetically unfillable before any search runs) and no trimmer, and no adder, can reach them. Quoting 74% silently books 16 zero-food days as 'the solver undershot'.",
};

TAX.HEADLINE = H;
fs.writeFileSync(path.join(HERE, "taxonomy.json"), JSON.stringify(TAX, null, 1));
console.log(JSON.stringify(H, null, 1));
