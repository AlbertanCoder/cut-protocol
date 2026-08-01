// W1-3 addendum — the framing sweeps the headline needed.
//   1. B10: which framing/denominator produces the prompt block's 74.2%?
//   2. B5:  which framing produces the brief's 50.9% and +74.5%?
//   3. slot-level over-side restricted to FAILING days
//   4. D7 broadened beyond the PROTEIN_DENSITY branch
//   5. C: mix vs the lab (weeklyPlanner.js:227-230, campaign qa-fleet-20260729-2032)
// Pure arithmetic on the pinned dumps. No re-solve, no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const load = (p) => fs.readFileSync(path.join(REPO, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const bandMidpoint = (lo, hi) => (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > 0) ? null : (lo + hi) / 2);

const FILES = {
  "route-s424242": "fleet/out/W1-2/daydump-route-s424242.jsonl",
  "route-s20260730": "fleet/out/W1-2/daydump-route-s20260730.jsonl",
  "route-s8675309": "fleet/out/W1-2/daydump-route-s8675309.jsonl",
  "rigshape-s424242": "fleet/out/W1-2/daydump-rigshape-s424242.jsonl",
};

function axesOf(r) {
  const v = r.verdict, ax = [];
  if (!v.kcalOk) ax.push({ macro: "kcal", side: v.kcalDeltaPct > 0 ? "over" : "under" });
  if (!v.proteinOk) ax.push({ macro: "protein", side: "short" });
  if (!v.fatOk) ax.push({ macro: "fat", side: v.fatOverPct > 0 ? "over" : "under" });
  if (!v.carbOk) ax.push({ macro: "carb", side: v.carbOverPct > 0 ? "over" : "under" });
  return ax;
}

const OUT = { note: "W1-3 addendum — framing sweeps", framings: [], b5: {}, d7broad: {}, mixVsLab: {} };

// ── 1. THE 74.2% HUNT ───────────────────────────────────────────────────────
for (const [runName, file] of Object.entries(FILES)) {
  const recs = load(file);
  const sets = {
    "planned(640)": recs,
    "planned−degen(639)": recs.filter((r) => !r.degenerate),
    "judged(623)": recs.filter((r) => r.judged),
    "sat-planned(554)": recs.filter((r) => r.satisfiable),
    "sat-planned−degen(553)": recs.filter((r) => r.satisfiable && !r.degenerate),
    "sat-judged(537)": recs.filter((r) => r.satisfiable && r.judged),
  };
  for (const [sn, set] of Object.entries(sets)) {
    const fails = set.filter((r) => !r.verdict.inBand && !r.degenerate);
    let over = 0, short = 0, pShort = 0;
    let pureOver = 0, mixed = 0, pureShort = 0;
    for (const r of fails) {
      const ax = axesOf(r);
      for (const a of ax) { if (a.side === "over") over++; else { short++; if (a.macro === "protein") pShort++; } }
      const o = ax.some((a) => a.side === "over"), s = ax.some((a) => a.side !== "over");
      if (o && s) mixed++; else if (o) pureOver++; else if (s) pureShort++;
    }
    OUT.framings.push({
      run: runName, set: sn, failingDays: fails.length,
      "AXES over%": pct(over, over + short),
      "AXES over% ex-protein": pct(over, over + short - pShort),
      "DAYS pure-over%": pct(pureOver, fails.length),
      "DAYS over-touched%": pct(pureOver + mixed, fails.length),
      "DAYS over-vs-short (mixed dropped)%": pct(pureOver, pureOver + pureShort),
    });
  }
}
OUT.candidates74 = OUT.framings.filter((f) => Math.abs(f["AXES over%"] - 74.2) < 2.5 || Math.abs(f["AXES over% ex-protein"] - 74.2) < 2.5
  || Math.abs(f["DAYS pure-over%"] - 74.2) < 2.5 || Math.abs(f["DAYS over-touched%"] - 74.2) < 2.5);

// ── 2/3/5. per-run deep numbers on the primary dump ─────────────────────────
const recs = load(FILES["route-s424242"]);
const canon = recs.filter((r) => r.satisfiable && !r.degenerate);
const canonFail = canon.filter((r) => !r.verdict.inBand);

// B5 framing sweep — "50.9% of days over protein by >12%"
const refs = {
  "vs proteinMid (closer's target, macroCloser.js:124)": (t) => (t.proteinLo + t.proteinHi) / 2,
  "vs proteinLo": (t) => t.proteinLo,
  "vs proteinHi": (t) => t.proteinHi,
  "vs the GRADED floor 0.85*proteinMid (D3)": (t) => 0.85 * (t.proteinLo + t.proteinHi) / 2,
};
OUT.b5.proteinOvershoot = {};
for (const [label, f] of Object.entries(refs)) {
  for (const [setLabel, set] of [["all 553 canonical days", canon], ["the 138 failing days", canonFail], ["all 640 planned", recs]]) {
    const n = set.filter((r) => f(r.target) > 0).length;
    const k = set.filter((r) => f(r.target) > 0 && r.achieved.protein > 1.12 * f(r.target)).length;
    OUT.b5.proteinOvershoot[`${label} | ${setLabel}`] = { k, n, pct: pct(k, n) };
  }
}
// slot level
{
  // reuse the replay from taxonomy.mjs via its JSON? simpler: recount from the
  // dump's own per-slot protein against the NOMINAL share (no carry-forward),
  // which is the framing that needs no replay.
  let k = 0, n = 0;
  for (const r of canon) {
    const t = r.target, pMid = (t.proteinLo + t.proteinHi) / 2;
    const meals = r.mealsPerDay, snacks = r.snacksPerDay;
    const w = [];
    for (let i = 0; i < meals; i++) w.push(meals === 1 ? 1 : i === meals - 1 ? 1.15 : i === 0 ? 0.9 : 1);
    for (let i = 0; i < snacks; i++) w.push(0.4);
    const tot = w.reduce((s, x) => s + x, 0);
    (r.slots || []).forEach((s, i) => { if (!s.recipeId) return; const tg = pMid * (w[i] / tot); if (tg > 0) { n++; if (s.protein > 1.12 * tg) k++; } });
  }
  OUT.b5.proteinOvershoot["vs NOMINAL slot protein share | filled slots"] = { k, n, pct: pct(k, n) };
}
// "median fat vs a 28%E ask"
OUT.b5.fatVsAsk = {};
const askVariants = {
  "28%E of targetKcal / 9  (literal reading)": (t) => 0.28 * t.kcal / 9,
  "fatMid (the engine's own ask)": (t) => bandMidpoint(t.fatLo, t.fatHi),
  "fatLo": (t) => t.fatLo,
  "the engine's own fat ask expressed as %E of target": (t) => bandMidpoint(t.fatLo, t.fatHi),
};
for (const [label, f] of Object.entries(askVariants)) {
  for (const [setLabel, set] of [["553 canonical", canon], ["138 failing", canonFail], ["640 planned", recs]]) {
    const v = set.map((r) => { const a = f(r.target); return a > 0 ? r.achieved.fat / a - 1 : null; }).filter((x) => x != null);
    OUT.b5.fatVsAsk[`${label} | ${setLabel}`] = { medianPct: Math.round(med(v) * 1000) / 10, n: v.length };
  }
}
// what %E does the engine actually ask for?
{
  const e = canon.map((r) => (bandMidpoint(r.target.fatLo, r.target.fatHi) * 9) / r.target.kcal).filter(Number.isFinite);
  const a = canon.map((r) => (r.achieved.fat * 9) / r.target.kcal).filter(Number.isFinite);
  OUT.b5.fatEnergyShare = { medianAskPctE: Math.round(med(e) * 1000) / 10, medianAchievedPctE: Math.round(med(a) * 1000) / 10, note: "if the ask really were 28%E the achieved median would be BELOW it, not above" };
}

// ── 3. slot-level over-side restricted to failing days ─────────────────────
// (uses taxonomy.json's numbers for all-slots; here the failing-day subset)
OUT.slotOnFailingDays = { note: "computed in taxonomy.mjs for all slots; this subset restricted to the 138 failing canonical days is in taxonomy.json's per-set slot block via `satisfiable-*` sets" };

// ── 4. D7 broadened ─────────────────────────────────────────────────────────
{
  const byP = new Map();
  for (const r of recs) { if (!byP.has(r.personaId)) byP.set(r.personaId, []); byP.get(r.personaId).push(r); }
  const POOLKEYS = new Set(["snack-pool", "meal-pool", "pool-depth", "variety-cap", "max-prep", "filter-cap", "dietary-rules"]);
  let poolKeyNoEmpty = 0, poolKeyNoEmptyComp = 0, plansWithMiss = 0, protDens = 0, protDensWrong = 0, totalWrong = 0, keyed = 0;
  const rows = [];
  for (const [pid, rs] of byP) {
    const key = rs[0].horizonBinding?.key ?? null;
    if (key) keyed++;
    const anyMiss = rs.some((r) => !r.verdict.inBand);
    if (anyMiss) plansWithMiss++;
    const emptySlots = rs.reduce((s, r) => s + r.slotsEmpty, 0);
    const comp = rs.filter((r) => !r.verdict.fatOk || !r.verdict.carbOk).length;
    if (key === "protein-density") { protDens++; if (comp > 0) { protDensWrong++; totalWrong++; rows.push({ pid, key, why: "composition observed, PROTEIN_DENSITY returned first (:1121 before :1131)" }); } }
    else if (POOLKEYS.has(key) && emptySlots === 0) {
      poolKeyNoEmpty++;
      if (comp > 0) { poolKeyNoEmptyComp++; totalWrong++; rows.push({ pid, key, why: "pool-shortage key returned but ZERO slots came back empty; the observed misses are composition" }); }
    }
  }
  OUT.d7broad = {
    plans: byP.size, plansWithAKey: keyed, plansWithAMiss: plansWithMiss,
    proteinDensityPlans: protDens, proteinDensityWrong: protDensWrong,
    poolKeyPlansWithZeroEmptySlots: poolKeyNoEmpty, ofThoseWithCompositionMisses: poolKeyNoEmptyComp,
    totalStructurallyWrongKeys: totalWrong,
    rates: {
      "wrong / plans with a key": pct(totalWrong, keyed),
      "wrong / plans with a miss": pct(totalWrong, plansWithMiss),
      "PROTEIN_DENSITY-only wrong / plans with a key": pct(protDensWrong, keyed),
      "PROTEIN_DENSITY-only wrong / plans with a miss": pct(protDensWrong, plansWithMiss),
      "PROTEIN_DENSITY-only wrong / plans emitting PROTEIN_DENSITY": pct(protDensWrong, protDens),
    },
    rows: rows.slice(0, 12),
  };
}

// ── 5. MIX vs the LAB (weeklyPlanner.js:227-230) ────────────────────────────
function mix(set, label) {
  const fails = set.filter((r) => !r.verdict.inBand && !r.degenerate);
  const fatInvolved = fails.filter((r) => !r.verdict.fatOk);
  const fatOnly = fails.filter((r) => { const ax = axesOf(r); return ax.length === 1 && ax[0].macro === "fat"; });
  const fatOnlyOver = fatOnly.filter((r) => r.verdict.fatOverPct > 0);
  const overMid = fatOnly.map((r) => { const m = bandMidpoint(r.target.fatLo, r.target.fatHi); return m > 0 ? (r.achieved.fat - m) / m : null; }).filter((x) => x != null);
  const carbInvolved = fails.filter((r) => !r.verdict.carbOk);
  const kcalInvolved = fails.filter((r) => !r.verdict.kcalOk);
  const protInvolved = fails.filter((r) => !r.verdict.proteinOk);
  return {
    denominator: label, failing: fails.length,
    fatInvolvedDays: fatInvolved.length, fatInvolvedPct: pct(fatInvolved.length, fails.length),
    carbInvolvedPct: pct(carbInvolved.length, fails.length),
    kcalInvolvedPct: pct(kcalInvolved.length, fails.length),
    proteinInvolvedPct: pct(protInvolved.length, fails.length),
    fatOnlyDays: fatOnly.length, fatOnlyOver: fatOnlyOver.length,
    fatOnlyMedianOverMidPct: overMid.length ? Math.round(med(overMid) * 1000) / 10 : null,
  };
}
OUT.mixVsLab = {
  lab: { source: "weeklyPlanner.js:227-230, campaign qa-fleet-20260729-2032, 275 customers", fatShareOfFailingDays: 59, fatOnlyDays: 74, fatOnlyAllOver: true, fatOnlyMedianOverMidPct: 49 },
  now: {
    canonical553: mix(canon, "satisfiable-planned−degenerate (553)"),
    satJudged537: mix(recs.filter((r) => r.satisfiable && r.judged), "satisfiable-judged (537)"),
    planned640: mix(recs, "planned (640)"),
  },
};
for (const k of ["route-s20260730", "route-s8675309"]) {
  const rr = load(FILES[k]);
  OUT.mixVsLab.now[`canonical553@${k}`] = mix(rr.filter((r) => r.satisfiable && !r.degenerate), `canonical 553 ${k}`);
}

fs.writeFileSync(path.join(HERE, "addendum.json"), JSON.stringify(OUT, null, 1));
console.log("wrote addendum.json\n");
console.log("=========== 74.2% FRAMING SWEEP (every run x every denominator) ===========");
console.table(OUT.framings);
console.log("\n=========== CANDIDATES within 2.5 pts of 74.2 ===========");
console.table(OUT.candidates74);
console.log("\n=========== B5 protein overshoot framings ===========");
console.table(OUT.b5.proteinOvershoot);
console.log("\n=========== B5 fat vs ask framings ===========");
console.table(OUT.b5.fatVsAsk);
console.log(JSON.stringify(OUT.b5.fatEnergyShare, null, 1));
console.log("\n=========== D7 broadened ===========");
console.log(JSON.stringify(OUT.d7broad, null, 1));
console.log("\n=========== C. MIX vs LAB ===========");
console.log(JSON.stringify(OUT.mixVsLab, null, 1));
