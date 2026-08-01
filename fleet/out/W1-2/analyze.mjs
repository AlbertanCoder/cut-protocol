// analyze.mjs — W1-2. Denominator census, F1 reconciliation, cross-seed spread.
// Pure arithmetic on the dumps + W1-5's targets.json. No solve, no DB, no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rd = (p) => fs.readFileSync(path.join(REPO, p), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const KG2LB = 2.20462, AB = { M: 21, F: 28 }, EF = 0.3;
const personas = rd("docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");
const LBM = new Map(personas.map((p) => {
  const pr = p.profile, bf = pr.bodyFatPct ?? 0;
  const b = bf > 0 ? bf : (pr.sex === "F" ? AB.F : AB.M);
  return [p.id, (pr.startWeightKg * KG2LB) * (1 - b / 100)];
}));

const rulerA = (r) => {
  const t = r.target, a = r.achieved, pMid = t.proteinMid;
  const fMid = (t.fatLo + t.fatHi) / 2, cMid = (t.carbLo + t.carbHi) / 2;
  const kcalOk = Math.abs((a.kcal - t.kcal) / t.kcal) <= 0.15;
  const proteinOk = Math.max(0, (pMid - a.protein) / pMid) <= 0.15;
  const fatOk = a.fat >= t.fatLo - 0.25 * fMid && a.fat <= t.fatHi + 0.25 * fMid;
  const carbOk = a.carb >= t.carbLo - 0.25 * cMid && a.carb <= t.carbHi + (t.keto ? 0 : 0.25) * cMid;
  return { inBand: kcalOk && proteinOk && fatOk && carbOk, kcalOk, proteinOk, fatOk, carbOk };
};
const rulerD = (r) => {
  const t = r.target, a = r.achieved, pMid = t.proteinMid;
  const kcalOk = Math.abs((a.kcal - t.kcal) / t.kcal) <= 0.15;
  const proteinOk = Math.max(0, (pMid - a.protein) / pMid) <= 0.15;
  const fatOk = a.fat >= Math.round(LBM.get(r.personaId) * EF);
  const carbOk = a.carb >= t.carbLo && (!t.keto || a.carb <= t.carbHi);
  return { inBand: kcalOk && proteinOk && fatOk && carbOk, kcalOk, proteinOk, fatOk, carbOk };
};

const FILES = {
  "route-424242": "fleet/out/W1-2/daydump-route-s424242.jsonl",
  "route-20260730": "fleet/out/W1-2/daydump-route-s20260730.jsonl",
  "route-8675309": "fleet/out/W1-2/daydump-route-s8675309.jsonl",
  "rig-424242": "fleet/out/W1-2/daydump-rigshape-s424242.jsonl",
};
const DUMPS = Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, rd(v)]));
const out = {};

// ── 1. denominator census, exact membership ────────────────────────────────
{
  const rows = DUMPS["route-424242"];
  const c = {
    planned: rows.length,
    degenerate: rows.filter((r) => r.degenerate).length,
    unjudged: rows.filter((r) => !r.judged).length,
    unjudgedSatisfiable: rows.filter((r) => !r.judged && r.satisfiable !== false && !r.degenerate).length,
    judged: rows.filter((r) => r.judged).length,
    impossibleDays: rows.filter((r) => r.satisfiable === false).length,
    satisfiablePlanned: rows.filter((r) => r.satisfiable !== false).length,
    satisfiablePlannedExDegenerate: rows.filter((r) => r.satisfiable !== false && !r.degenerate).length,
    satisfiableJudged: rows.filter((r) => r.satisfiable !== false && r.judged).length,
    personas: new Set(rows.map((r) => r.personaId)).size,
    personasSatisfiable: new Set(rows.filter((r) => r.satisfiable !== false).map((r) => r.personaId)).size,
    personasImpossible: new Set(rows.filter((r) => r.satisfiable === false).map((r) => r.personaId)).size,
  };
  c.arithmeticCheck = {
    "planned = judged + unjudged": c.planned === c.judged + c.unjudged,
    "planned = satisfiablePlanned + impossibleDays": c.planned === c.satisfiablePlanned + c.impossibleDays,
    "satisfiablePlanned = satisfiableJudged + unjudgedSat + degenerate": c.satisfiablePlanned === c.satisfiableJudged + c.unjudgedSatisfiable + c.degenerate,
  };
  out.denominatorCensus = c;
}

// ── 2. cross-seed spread, every cell ───────────────────────────────────────
{
  const cells = {};
  const denoms = {
    planned: () => true,
    "satisfiable-planned": (r) => r.satisfiable !== false,
    "satisfiable-judged": (r) => r.satisfiable !== false && r.judged,
    judged: (r) => r.judged,
  };
  for (const [dn, df] of Object.entries(denoms)) {
    for (const [rn, rf] of Object.entries({ A: rulerA, D: rulerD })) {
      const key = `${rn}/${dn}`;
      const vals = ["route-424242", "route-20260730", "route-8675309"].map((s) => {
        const rows = DUMPS[s].filter(df);
        return { seed: s, k: rows.filter((r) => rf(r).inBand).length, n: rows.length, rate: rows.filter((r) => rf(r).inBand).length / rows.length };
      });
      const rates = vals.map((v) => v.rate * 100);
      cells[key] = { perSeed: vals, spreadPts: Math.max(...rates) - Math.min(...rates), meanPct: rates.reduce((a, b) => a + b, 0) / 3 };
    }
  }
  out.crossSeed = cells;
}

// ── 3. F1 reconciliation against W1-5 ──────────────────────────────────────
{
  const T = JSON.parse(fs.readFileSync(path.join(REPO, "fleet/out/W1-5/targets.json"), "utf8")).personas;
  const byId = new Map(T.map((t) => [t.id, t]));
  const rows = DUMPS["route-424242"];
  const byP = {}; for (const r of rows) (byP[r.personaId] ||= []).push(r);
  const cohort = (pred, label) => {
    const ids = T.filter(pred).map((t) => t.id);
    let days = 0, inA = 0, inD = 0, zeroA = 0;
    for (const id of ids) {
      const rs = byP[id] || []; days += rs.length;
      inA += rs.filter((r) => rulerA(r).inBand).length;
      inD += rs.filter((r) => rulerD(r).inBand).length;
      if (rs.length && !rs.some((r) => rulerA(r).inBand)) zeroA++;
    }
    return { label, personas: ids.length, ids, days, inBandA: inA, inBandD: inD, personasZeroInBandA: zeroA };
  };
  out.f1 = {
    aboveMaxGate: cohort((t) => t.aboveMax_gate, "demanded GATE density (0.85*pMid) > pool single-recipe max"),
    aboveMaxNominal: cohort((t) => t.aboveMax, "demanded NOMINAL density (pMid) > pool single-recipe max"),
    aboveMaxNominalNotImpossible: cohort((t) => t.aboveMax && t.tier !== "IMPOSSIBLE", "nominal>max AND tier!=IMPOSSIBLE"),
    impossibleNotFlagged: cohort((t) => t.tier === "IMPOSSIBLE" && !t.aboveMax_gate, "IMPOSSIBLE tier NOT one-macro-infeasible"),
    impossibleAll: cohort((t) => t.tier === "IMPOSSIBLE", "all IMPOSSIBLE tier"),
    satisfiableAll: cohort((t) => t.tier !== "IMPOSSIBLE", "all satisfiable (tier != IMPOSSIBLE)"),
    denominatorNote: {
      "W1-5 published": "0 of 232",
      "232 is": "250 total personas minus the 18 flagged — the COMPLEMENT of the flagged set, not the satisfiable population",
      "satisfiable population is": T.filter((t) => t.tier !== "IMPOSSIBLE").length,
      "correct statement": `0 of ${T.filter((t) => t.tier !== "IMPOSSIBLE").length}`,
    },
  };
  // failing satisfiable personas, with binding key
  const satFail = [];
  for (const [id, rs] of Object.entries(byP)) {
    const t = byId.get(id); if (!t || t.tier === "IMPOSSIBLE") continue;
    const bad = rs.filter((r) => !rulerA(r).inBand);
    if (!bad.length) continue;
    satFail.push({ id, tier: t.tier, diet: rs[0].dietStyle, days: rs.length, failA: bad.length, failD: rs.filter((r) => !rulerD(r).inBand).length, keys: [...new Set(bad.map((r) => r.bindingMissKey))] });
  }
  satFail.sort((a, b) => b.failA - a.failA);
  out.f1.satisfiablePersonasWithAnyFailure = { count: satFail.length, totalFailingDays: satFail.reduce((s, x) => s + x.failA, 0), detail: satFail };
}

// ── 4. fail-cause census, satisfiable-planned, both rulers ─────────────────
{
  const rows = DUMPS["route-424242"].filter((r) => r.satisfiable !== false);
  const cause = (rf) => {
    const h = {};
    for (const r of rows) {
      const v = rf(r);
      if (v.inBand) continue;
      const k = [!v.kcalOk && "kcal", !v.proteinOk && "protein", !v.fatOk && "fat", !v.carbOk && "carb"].filter(Boolean).join("+") || "?";
      h[k] = (h[k] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]));
  };
  out.failCauseSatisfiablePlanned = { rulerA: cause(rulerA), rulerD: cause(rulerD), n: rows.length };
  // unjudged (zero-filled) days are counted as failures on the planned denominators
  out.unjudgedDetail = DUMPS["route-424242"].filter((r) => !r.judged)
    .map((r) => ({ dayKey: r.dayKey, tier: r.tier, diet: r.dietStyle, degenerate: !!r.degenerate, slotsTotal: r.slotsTotal, poolAfterStack: r.poolCounts?.afterStack }));
}

// ── 5. rig vs route, paired, at the same seed ──────────────────────────────
{
  const b = DUMPS["route-424242"], t = DUMPS["rig-424242"];
  const bm = new Map(b.map((r) => [r.dayKey, r]));
  const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.run; delete c.solveMs; return JSON.stringify(c); };
  let ident = 0, bb = 0, cc = 0;
  for (const r of t) { const o = bm.get(r.dayKey); if (!o) continue; if (strip(o) === strip(r)) ident++; const bi = rulerA(o).inBand, ti = rulerA(r).inBand; if (bi && !ti) bb++; else if (!bi && ti) cc++; }
  out.rigVsRoute = { byteIdenticalRecords: ident, of: t.length, changedRecords: t.length - ident, discordant_b: bb, discordant_c: cc, deltaPlannedPts: ((t.filter((r) => rulerA(r).inBand).length - b.filter((r) => rulerA(r).inBand).length) / t.length) * 100 };
}

// ── 6. A3 — stored-baseline reuse test vs W1-1's dumps ─────────────────────
{
  const res = {};
  for (const [k, f] of Object.entries({ "route-424242": "fleet/out/W1-1/daydump-route-s424242.jsonl", "route-20260730": "fleet/out/W1-1/daydump-route-s20260730.jsonl", "route-8675309": "fleet/out/W1-1/daydump-route-s8675309.jsonl", "rig-424242": "fleet/out/W1-1/daydump-rigshape-s424242.jsonl" })) {
    const old = rd(f), mine = DUMPS[k];
    const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.run; delete c.solveMs; return JSON.stringify(c); };
    const m = new Map(old.map((r) => [r.dayKey, strip(r)]));
    let ident = 0, flip = 0;
    const vm = new Map(old.map((r) => [r.dayKey, !!r.verdict.inBand]));
    for (const r of mine) { if (m.get(r.dayKey) === strip(r)) ident++; if (vm.get(r.dayKey) !== !!r.verdict.inBand) flip++; }
    res[k] = { identical: ident, of: mine.length, verdictFlips: flip, w11git: old[0].run.gitSha.slice(0, 12), w11diff: old[0].run.gitDiffStat, w12git: mine[0].run.gitSha.slice(0, 12), w12diff: mine[0].run.gitDiffStat };
  }
  out.a3StoredBaselineReuse = res;
}

fs.writeFileSync(path.join(REPO, "fleet/out/W1-2/analysis.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({
  denominatorCensus: out.denominatorCensus,
  crossSeedSpread: Object.fromEntries(Object.entries(out.crossSeed).map(([k, v]) => [k, { perSeedPct: v.perSeed.map((x) => +(x.rate * 100).toFixed(1)), n: v.perSeed[0].n, spreadPts: +v.spreadPts.toFixed(2) }])),
  f1: Object.fromEntries(Object.entries(out.f1).filter(([k]) => k !== "satisfiablePersonasWithAnyFailure").map(([k, v]) => [k, v.ids ? { personas: v.personas, days: v.days, inBandA: v.inBandA, inBandD: v.inBandD, personasZeroInBandA: v.personasZeroInBandA } : v])),
  satFailPersonas: { count: out.f1.satisfiablePersonasWithAnyFailure.count, days: out.f1.satisfiablePersonasWithAnyFailure.totalFailingDays },
  failCause: out.failCauseSatisfiablePlanned,
  rigVsRoute: out.rigVsRoute,
  a3: out.a3StoredBaselineReuse,
}, null, 2));
console.log("\nanalysis -> fleet/out/W1-2/analysis.json");
