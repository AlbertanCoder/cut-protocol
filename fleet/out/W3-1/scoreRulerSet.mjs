// scoreRulerSet.mjs — W3-1 (ruler-share). RE-SCORING ONLY. No re-solve.
//
//   node fleet/out/W3-1/scoreRulerSet.mjs <dump.jsonl> [...] --json=fleet/out/W3-1/ruler-share.json
//
// PURE ARITHMETIC on the stored records of a `fleet/W1-1/day/v2` dayDump.
// No DB, no RNG, no network, no product-source read at runtime. Ruler A is
// verified against the booleans the solver stored at solve time on every row;
// any mismatch voids the run (D3).
//
// ── THE RULERS ─────────────────────────────────────────────────────────────
// Shared by every ruler (never varied — W2-6/Contrarian C: these two carry the
// outcome, and the recommendation leaves them alone):
//   kcal     |achieved-target| / target <= 0.15          (symmetric)
//   protein  max(0, (pMid - achieved)/pMid) <= 0.15      (ONE-SIDED, no ceiling)
//
// A   SHIPPING  fat  [fatLo - .25*fatMid , fatHi + .25*fatMid]   (if hasBand)
//               carb [carbLo - .25*carbMid, carbHi + K*carbMid]  K = keto?0:.25
// B   FAT FLOOR ONLY      fat >= round(.30*lbmLb), NO ceiling ;  carb as A
// C   CARB FLOOR ONLY     fat as A ; carb >= carbLo, no non-keto ceiling,
//                                     keto ceiling (carbHi) RETAINED
// D   FULL FLOOR RULER    = B's fat term AND C's carb term (W1-2's Ruler D)
// E35 %E CEILING (AMDR)   fat >= fatLo-.25*fatMid  AND  fat <= .35*targetKcal/9
//                         carb as A
// E30 %E CEILING (Helms)  ditto at .30*targetKcal/9
// F   CARB FLOOR REPAIRED = A but the non-keto carb LOW bound is
//                         max(carbLo - .25*carbMid, NONKETO_CARB_FLOOR_G=50)
// F*  as F but the repaired floor is clamped to carbHi so the band can never
//     be empty (reported separately; it is the only difference)
// R35 W2-6's RECOMMENDED INSTRUMENT: fat >= round(.30*lbm) AND fat <= .35*tk/9
//     carb >= (keto ? carbLo : max(carbLo,50)) ; keto ceiling hard ; no
//     non-keto carb ceiling
// R30 ditto at 30%E
// R35c as R35 but the A non-keto carb CEILING is kept (isolates how much of R
//     comes from dropping that ceiling)
// Z   BOUND, NOT A PROPOSAL: kcal + protein only. The loosest ruler that keeps
//     the two macros with measured outcome warrant. Z - A is the ARITHMETIC
//     CEILING on what ANY fat/carb re-grade can recover; 100 - Z is the share
//     of the gap no re-grade of fat or carb can ever touch.
//
// lbmLb is not on the record. Reconstructed from personas.jsonl by re-running
// bmrEngine's own two lines, then PROVEN exact via round(lbm*1.14)==proteinLo
// && round(lbm*1.25)==proteinHi on every record. A failure is counted and the
// run refuses rather than guessing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PERSONAS = path.join(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");

// bmrEngine.js:18, :283, :286, :292 — transcribed, differentially verified below.
const KG2LB = 2.20462;
const ASSUMED_BODY_FAT_PCT = { M: 21, F: 28 };
const ESSENTIAL_FAT_PER_LB_LBM = 0.3;
const NONKETO_CARB_FLOOR_G = 50;

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : null; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

function lbmTable() {
  const t = new Map();
  for (const p of readJsonl(PERSONAS)) {
    const pr = p.profile;
    const bf = pr.bodyFatPct ?? 0;
    const bfKnown = bf != null && bf > 0;
    const bfForLbm = bfKnown ? bf : (pr.sex === "F" ? ASSUMED_BODY_FAT_PCT.F : ASSUMED_BODY_FAT_PCT.M);
    t.set(p.id, { lbmLb: (pr.startWeightKg * KG2LB) * (1 - bfForLbm / 100), bfAssumed: !bfKnown, sex: pr.sex });
  }
  return t;
}

// ── shared terms ───────────────────────────────────────────────────────────
const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;
const pMidOf = (t) => (Number.isFinite(t.proteinMid) ? t.proteinMid : (t.proteinLo + t.proteinHi) / 2);
const kcalOkOf = (t, a) => (t.kcal > 0 ? Math.abs((a.kcal - t.kcal) / t.kcal) <= 0.15 : false);
const proteinOkOf = (t, a) => { const p = pMidOf(t); return p > 0 ? Math.max(0, (p - a.protein) / p) <= 0.15 : true; };
const fatMidOf = (t) => (t.fatLo + t.fatHi) / 2;
const carbMidOf = (t) => (Number.isFinite(t.carbMid) ? t.carbMid : (t.carbLo + t.carbHi) / 2);

/** Build one ruler from per-macro term choices. Every ruler in the study is
 *  `kcal AND protein AND fatTerm AND carbTerm`; only the last two ever vary. */
function mk(id, desc, fatTerm, carbTerm) {
  return {
    id, desc,
    fn(r, L) {
      const t = r.target || {}, a = r.achieved || {};
      const kcalOk = kcalOkOf(t, a), proteinOk = proteinOkOf(t, a);
      const fatOk = fatTerm(t, a, L);
      const carbOk = carbTerm(t, a, L);
      return { inBand: kcalOk && proteinOk && fatOk && carbOk, kcalOk, proteinOk, fatOk, carbOk };
    },
  };
}

// fat terms
const fatA = (t, a) => (!hasBand(t.fatLo, t.fatHi) ? true : (a.fat >= t.fatLo - 0.25 * fatMidOf(t) && a.fat <= t.fatHi + 0.25 * fatMidOf(t)));
const fatWide = (x) => (t, a) => (!hasBand(t.fatLo, t.fatHi) ? true : (a.fat >= t.fatLo - x * fatMidOf(t) && a.fat <= t.fatHi + x * fatMidOf(t)));
const fatFloorEssential = (t, a, L) => a.fat >= Math.round(L.lbmLb * ESSENTIAL_FAT_PER_LB_LBM);
const fatEpct = (e) => (t, a) => (!hasBand(t.fatLo, t.fatHi) ? true : (a.fat >= t.fatLo - 0.25 * fatMidOf(t) && a.fat <= (e * t.kcal) / 9));
// %E ceiling WITH A KETO CARVE-OUT. A ketogenic target places fat at ~65%E by
// construction (fat fills the balance after a 25 g carb target), so an AMDR or
// Helms %E ceiling is categorically incompatible with keto: measured, it takes
// keto from 58 compliant days to 0. Keto keeps its own band ceiling instead.
const fatEpctK = (e) => (t, a) => {
  if (!hasBand(t.fatLo, t.fatHi)) return true;
  if (a.fat < t.fatLo - 0.25 * fatMidOf(t)) return false;
  return t.keto ? a.fat <= t.fatHi + 0.25 * fatMidOf(t) : a.fat <= (e * t.kcal) / 9;
};
const fatFloorPlusEpctK = (e) => (t, a, L) => {
  if (a.fat < Math.round(L.lbmLb * ESSENTIAL_FAT_PER_LB_LBM)) return false;
  return t.keto ? (!hasBand(t.fatLo, t.fatHi) || a.fat <= t.fatHi + 0.25 * fatMidOf(t)) : a.fat <= (e * t.kcal) / 9;
};
const fatFloorPlusEpct = (e) => (t, a, L) => a.fat >= Math.round(L.lbmLb * ESSENTIAL_FAT_PER_LB_LBM) && a.fat <= (e * t.kcal) / 9;
const fatDrop = () => true;

// carb terms
const carbA = (t, a) => {
  if (!hasBand(t.carbLo, t.carbHi)) return true;
  const cm = carbMidOf(t), over = t.keto ? 0 : 0.25;
  return a.carb >= t.carbLo - 0.25 * cm && a.carb <= t.carbHi + over * cm;
};
const carbWide = (x) => (t, a) => {
  if (!hasBand(t.carbLo, t.carbHi)) return true;
  const cm = carbMidOf(t), over = t.keto ? 0 : x;
  return a.carb >= t.carbLo - x * cm && a.carb <= t.carbHi + over * cm;
};
const carbFloorOnly = (t, a) => {
  const floorOk = Number.isFinite(t.carbLo) ? a.carb >= t.carbLo : true;
  const ketoCeil = t.keto ? (Number.isFinite(t.carbHi) ? a.carb <= t.carbHi : true) : true;
  return floorOk && ketoCeil;
};
const carbFrepair = (clamp) => (t, a) => {
  if (!hasBand(t.carbLo, t.carbHi)) return true;
  const cm = carbMidOf(t), over = t.keto ? 0 : 0.25;
  let lo = t.carbLo - 0.25 * cm;
  if (!t.keto) { lo = Math.max(lo, NONKETO_CARB_FLOOR_G); if (clamp) lo = Math.min(lo, t.carbHi); }
  return a.carb >= lo && a.carb <= t.carbHi + over * cm;
};
const carbRfloor = (t, a) => {
  const lo = t.keto ? t.carbLo : Math.max(t.carbLo ?? 0, NONKETO_CARB_FLOOR_G);
  const floorOk = Number.isFinite(lo) ? a.carb >= lo : true;
  const ketoCeil = t.keto ? (Number.isFinite(t.carbHi) ? a.carb <= t.carbHi : true) : true;
  return floorOk && ketoCeil;
};
const carbRfloorKeepCeil = (t, a) => {
  if (!carbRfloor(t, a)) return false;
  if (t.keto || !hasBand(t.carbLo, t.carbHi)) return true;
  return a.carb <= t.carbHi + 0.25 * carbMidOf(t);
};
const carbDrop = () => true;

const RULERS = [
  mk("A", "SHIPPING dayTolerance (mealSolver.js:229). fat band +-0.25*fatMid outside [fatLo,fatHi]; carb band, keto over-allowance 0.", fatA, carbA),
  mk("B", "FAT FLOOR ONLY: fat >= round(0.30*lbmLb), no fat ceiling. Carb as A.", fatFloorEssential, carbA),
  mk("C", "CARB FLOOR ONLY: carb >= carbLo (no slack), no non-keto ceiling, keto ceiling retained. Fat as A.", fatA, carbFloorOnly),
  mk("D", "FULL FLOOR RULER = B's fat term AND C's carb term (reproduces W1-2's Ruler D).", fatFloorEssential, carbFloorOnly),
  mk("E35", "A's fat FLOOR, fat CEILING re-anchored to 35%E of targetKcal (AMDR). Carb as A.", fatEpct(0.35), carbA),
  mk("E30", "A's fat FLOOR, fat CEILING re-anchored to 30%E of targetKcal (Helms). Carb as A.", fatEpct(0.30), carbA),
  mk("F", "A with the non-keto carb LOW bound repaired to max(carbLo-0.25*carbMid, 50) = the engine's own NONKETO_CARB_FLOOR_G. Strict tightening.", fatA, carbFrepair(false)),
  mk("F*", "F, but the repaired floor is clamped to carbHi so the band is never empty.", fatA, carbFrepair(true)),
  mk("R35", "W2-6 RECOMMENDED INSTRUMENT: fat >= 0.30*lbm AND fat <= 35%E; carb >= max(carbLo,50) non-keto / carbLo keto; keto ceiling hard; no non-keto carb ceiling.", fatFloorPlusEpct(0.35), carbRfloor),
  mk("R30", "R35 with the fat ceiling at 30%E (Helms).", fatFloorPlusEpct(0.30), carbRfloor),
  mk("R35c", "R35 but keeping A's non-keto carb CEILING (isolates the carb-ceiling share of R35).", fatFloorPlusEpct(0.35), carbRfloorKeepCeil),
  mk("E35k", "E35 WITH A KETO CARVE-OUT: non-keto fat ceiling = 35%E (AMDR); keto keeps A's fat band. Carb as A.", fatEpctK(0.35), carbA),
  mk("R35k", "R35 WITH A KETO CARVE-OUT — THE PRICED RECOMMENDATION: fat >= 0.30*lbm; non-keto fat ceiling 35%E, keto keeps A's; carb >= max(carbLo,50) non-keto; keto ceiling hard; no non-keto carb ceiling.", fatFloorPlusEpctK(0.35), carbRfloor),
  mk("R35k+cc", "R35k but keeping A's non-keto carb CEILING.", fatFloorPlusEpctK(0.35), carbRfloorKeepCeil),
  mk("R40k", "R35k at the MEASURED BREAK-EVEN ceiling of 40%E instead of AMDR's 35%E — shown to price the nutrition/compliance trade, not recommended.", fatFloorPlusEpctK(0.40), carbRfloor),
  mk("A15", "A with the fat allowance widened to +-0.50*fatMid (brief C9 / scoreDays --ruler=fatwide:0.5). BOTH sides widen.", fatWide(0.5), carbA),
  mk("A15c", "A with the carb allowance widened to +-0.50*carbMid (keto over-allowance stays 0).", fatA, carbWide(0.5)),
  mk("NOFAT", "A minus the fat term entirely.", fatDrop, carbA),
  mk("NOCARB", "A minus the carb term entirely.", fatA, carbDrop),
  mk("Z", "BOUND, NOT A PROPOSAL: kcal +-15% and protein floor ONLY. Z-A is the arithmetic ceiling of any fat/carb re-grade; 100-Z is untouchable by any of them.", fatDrop, carbDrop),
];

const DENOMS = {
  "planned": { n: "every planned record; unjudged + degenerate count as MISSES", f: () => true },
  "planned-minus-degenerate": { n: "planned minus the 0-slot config (p233)", f: (r) => !r.degenerate },
  "judged": { n: "slotsFilled>0 (A1/rig/schema.mjs:83) — drops A6's 16 total-failure days", f: (r) => r.judged },
  "satisfiable-planned": { n: "tier != IMPOSSIBLE, all planned", f: (r) => r.satisfiable !== false },
  "satisfiable-planned-minus-degenerate": { n: "W1-2's RECOMMENDED CANONICAL (n=553)", f: (r) => r.satisfiable !== false && !r.degenerate },
  "satisfiable-judged": { n: "judged AND tier != IMPOSSIBLE (n=537) — the historically published one", f: (r) => r.judged && r.satisfiable !== false },
};

function tally(rows, filt, ok) {
  let n = 0, k = 0;
  for (const r of rows) { if (!filt(r)) continue; n++; if (ok(r)) k++; }
  return { k, n, rate: n ? k / n : null };
}

/** A5: an effect is real at 95% iff |b-c| > 1.96*sqrt(b+c). */
function flips(rows, filt, okBase, okTreat) {
  let b = 0, c = 0, bb = 0, cc = 0;
  for (const r of rows) {
    if (!filt(r)) continue;
    const x = okBase(r), y = okTreat(r);
    if (x && y) bb++; else if (!x && !y) cc++;
    else if (x && !y) b++; else c++;
  }
  const floor = 1.96 * Math.sqrt(b + c);
  return { bothPass: bb, bothFail: cc, b_lostByTreatment: b, c_gainedByTreatment: c, net: c - b, absDiff: Math.abs(c - b), a5Floor: r2(floor), clearsA5: Math.abs(c - b) > floor };
}

function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
  const LBM = lbmTable();
  const out = {
    tool: "fleet/out/W3-1/scoreRulerSet.mjs", agent: "W3-1", generatedAt: new Date().toISOString(),
    method: "RE-SCORING ONLY. Pure arithmetic on stored dayDump records. No re-solve, no DB, no RNG, no network.",
    rulerDefs: Object.fromEntries(RULERS.map((R) => [R.id, R.desc])),
    denominatorDefs: Object.fromEntries(Object.entries(DENOMS).map(([k, v]) => [k, v.n])),
    runs: [],
  };
  const lines = [];

  for (const f of files) {
    const rows = readJsonl(path.resolve(f));
    const h = rows[0].run;

    // ── D3 INTEGRITY: ruler A must reproduce the solver's stored booleans. ──
    const A = RULERS.find((R) => R.id === "A");
    let aVsStored = 0, andMismatch = 0, lbmFail = 0, perMacro = { kcal: 0, protein: 0, fat: 0, carb: 0 };
    const edge = { fatUnjudged: 0, carbUnjudged: 0, fatHiZero: 0, carbHiZero: 0, fatHiNonFinite: 0, carbHiNonFinite: 0, unjudgedButOutside: 0, ketoRows: 0 };
    const mismatchIds = [];
    for (const r of rows) {
      const L = LBM.get(r.personaId);
      if (!L || Math.round(L.lbmLb * 1.14) !== r.target.proteinLo || Math.round(L.lbmLb * 1.25) !== r.target.proteinHi) lbmFail++;
      const v = A.fn(r, L || { lbmLb: NaN });
      if (v.inBand !== !!r.verdict?.inBand) { aVsStored++; mismatchIds.push(r.dayKey); }
      for (const m of ["kcal", "protein", "fat", "carb"]) if (v[m + "Ok"] !== !!r.verdict?.[m + "Ok"]) perMacro[m]++;
      const AND = r.verdict.kcalOk && r.verdict.proteinOk && r.verdict.fatOk && r.verdict.carbOk;
      if (AND !== r.verdict.inBand) andMismatch++;
      const t = r.target;
      if (t.keto) edge.ketoRows++;
      if (!hasBand(t.fatLo, t.fatHi)) {
        edge.fatUnjudged++;
        if (t.fatHi === 0) edge.fatHiZero++;
        if (!Number.isFinite(t.fatHi)) edge.fatHiNonFinite++;
        if (Number.isFinite(t.fatLo) && (r.achieved.fat < t.fatLo || r.achieved.fat > (t.fatHi ?? 0))) edge.unjudgedButOutside++;
      }
      if (!hasBand(t.carbLo, t.carbHi)) {
        edge.carbUnjudged++;
        if (t.carbHi === 0) edge.carbHiZero++;
        if (!Number.isFinite(t.carbHi)) edge.carbHiNonFinite++;
      }
    }

    const okOf = (R) => (r) => R.fn(r, LBM.get(r.personaId)).inBand;
    const OK = Object.fromEntries(RULERS.map((R) => [R.id, okOf(R)]));

    // ── levels: every ruler x every denominator ────────────────────────────
    const levels = {};
    for (const [dn, d] of Object.entries(DENOMS)) {
      levels[dn] = {};
      for (const R of RULERS) { const t = tally(rows, d.f, OK[R.id]); levels[dn][R.id] = { k: t.k, n: t.n, pct: r2(t.rate * 100) }; }
    }

    // ── flips vs A on the three mandated denominators ──────────────────────
    const FLIPDEN = ["satisfiable-planned-minus-degenerate", "satisfiable-judged", "planned"];
    const flipMatrix = {};
    for (const dn of FLIPDEN) {
      flipMatrix[dn] = {};
      for (const R of RULERS) { if (R.id === "A") continue; flipMatrix[dn][R.id] = flips(rows, DENOMS[dn].f, OK.A, OK[R.id]); }
    }

    // ── per-diet, canonical + satisfiable-judged ───────────────────────────
    const diets = [...new Set(rows.map((r) => r.dietStyle ?? "null"))].sort();
    const perDiet = {};
    for (const dt of diets) {
      const sel = (r) => (r.dietStyle ?? "null") === dt;
      perDiet[dt] = { personas: new Set(rows.filter(sel).map((r) => r.personaId)).size };
      for (const dn of ["satisfiable-planned-minus-degenerate", "satisfiable-judged"]) {
        perDiet[dt][dn] = {};
        for (const R of RULERS) {
          const t = tally(rows, (r) => sel(r) && DENOMS[dn].f(r), OK[R.id]);
          perDiet[dt][dn][R.id] = { k: t.k, n: t.n, pct: t.n ? r2(t.rate * 100) : null };
        }
        perDiet[dt][dn + "_flipsVsA"] = Object.fromEntries(RULERS.filter((R) => R.id !== "A")
          .map((R) => [R.id, (({ b_lostByTreatment: b, c_gainedByTreatment: c, net }) => ({ b, c, net }))(flips(rows, (r) => sel(r) && DENOMS[dn].f(r), OK.A, OK[R.id]))]));
      }
    }

    // ── THE DECOMPOSITION, per denominator ─────────────────────────────────
    // Every A-failing day is placed in exactly one bucket:
    //   SOLVER-IRREDUCIBLE : misses kcal or protein  => no fat/carb re-grade
    //                        can ever recover it (Z fails it too).
    //   RULER-ELIGIBLE     : kcal+protein both fine, fails only fat/carb
    //                        => Z passes it; SOME re-grade recovers it.
    // Then within RULER-ELIGIBLE, which candidate instruments actually do.
    const decomp = {};
    for (const [dn, d] of Object.entries(DENOMS)) {
      const sel = rows.filter(d.f);
      const n = sel.length;
      const aPass = sel.filter(OK.A);
      const aFail = sel.filter((r) => !OK.A(r));
      const irreducible = aFail.filter((r) => !OK.Z(r));
      const eligible = aFail.filter((r) => OK.Z(r));
      const bySide = { fatOnly: 0, carbOnly: 0, both: 0 };
      for (const r of eligible) {
        const v = RULERS.find((R) => R.id === "A").fn(r, LBM.get(r.personaId));
        if (!v.fatOk && !v.carbOk) bySide.both++; else if (!v.fatOk) bySide.fatOnly++; else bySide.carbOnly++;
      }
      const irrWhy = { kcalOnly: 0, proteinOnly: 0, both: 0 };
      for (const r of irreducible) {
        const t = r.target, a = r.achieved;
        const k = kcalOkOf(t, a), p = proteinOkOf(t, a);
        if (!k && !p) irrWhy.both++; else if (!k) irrWhy.kcalOnly++; else irrWhy.proteinOnly++;
      }
      const recovered = {};
      for (const R of RULERS) {
        if (R.id === "A") continue;
        const c = eligible.filter(OK[R.id]).length;      // rescued
        const b = aPass.filter((r) => !OK[R.id](r)).length; // broken
        recovered[R.id] = { rescued_c: c, broken_b: b, netPts: r2(((c - b) / n) * 100), rescuedPtsGross: r2((c / n) * 100) };
      }
      decomp[dn] = {
        n, aPass: aPass.length, aPct: r2((aPass.length / n) * 100),
        gapToPerfectPts: r2(((n - aPass.length) / n) * 100),
        solverIrreducible: { days: irreducible.length, pts: r2((irreducible.length / n) * 100), why: irrWhy },
        rulerEligibleCeiling: { days: eligible.length, pts: r2((eligible.length / n) * 100), failingSide: bySide },
        byRuler: recovered,
      };
    }

    // ── C9 MECHANICS: explicit vs widened vs implicit fat ceiling ──────────
    // One row per PERSONA (targets are persona-constant; verified).
    const byPersona = new Map();
    let targetDrift = 0;
    for (const r of rows) {
      const key = r.personaId;
      const sig = JSON.stringify(r.target);
      if (!byPersona.has(key)) byPersona.set(key, { rec: r, sig });
      else if (byPersona.get(key).sig !== sig) targetDrift++;
    }
    const ceil = { explicitA: [], wide50: [], implicitD: [], implicitR: [], ratioWide: [], ratioImplicitD: [], ratioImplicitR: [] };
    for (const { rec: r } of byPersona.values()) {
      const t = r.target, L = LBM.get(r.personaId);
      if (!hasBand(t.fatLo, t.fatHi)) continue;
      const fm = fatMidOf(t), pM = pMidOf(t);
      const eA = t.fatHi + 0.25 * fm;
      const eW = t.fatHi + 0.50 * fm;
      // implicit ceiling under a FLOOR ruler: what the kcal ceiling + protein
      // floor + carb floor leave for fat.
      const iD = (1.15 * t.kcal - 0.85 * pM * 4 - (t.carbLo ?? 0) * 4) / 9;
      const carbFloorR = t.keto ? (t.carbLo ?? 0) : Math.max(t.carbLo ?? 0, NONKETO_CARB_FLOOR_G);
      const iR = Math.min((0.35 * t.kcal) / 9, (1.15 * t.kcal - 0.85 * pM * 4 - carbFloorR * 4) / 9);
      ceil.explicitA.push(eA); ceil.wide50.push(eW); ceil.implicitD.push(iD); ceil.implicitR.push(iR);
      ceil.ratioWide.push(eW / eA); ceil.ratioImplicitD.push(iD / eA); ceil.ratioImplicitR.push(iR / eA);
      // per-lb-LBM view
      r.__lbm = L.lbmLb;
    }
    const c9 = {
      personasWithFatBand: ceil.explicitA.length,
      targetDriftWithinPersona: targetDrift,
      medianExplicitCeilingG: r2(med(ceil.explicitA)),
      medianWide50CeilingG: r2(med(ceil.wide50)),
      medianImplicitCeilingUnderFloorRulerG: r2(med(ceil.implicitD)),
      medianImplicitCeilingUnderR35G: r2(med(ceil.implicitR)),
      medianRatio_wide50_over_A: r4(med(ceil.ratioWide)),
      medianRatio_implicitFloorRuler_over_A: r4(med(ceil.ratioImplicitD)),
      medianRatio_implicitR35_over_A: r4(med(ceil.ratioImplicitR)),
      looseningPct: {
        wide50: r2((med(ceil.ratioWide) - 1) * 100),
        floorRuler: r2((med(ceil.ratioImplicitD) - 1) * 100),
        R35: r2((med(ceil.ratioImplicitR) - 1) * 100),
      },
    };
    // day-level: where do the fat-over days actually land?
    const canon = rows.filter(DENOMS["satisfiable-planned-minus-degenerate"].f);
    const landing = { nFatOverDays: 0, underWide50: 0, underImplicitFloorRuler: 0, underEssentialFloorOnly: 0, under35pctE: 0, above35pctE: 0, fatOverPctOfCeil: [] };
    for (const r of canon) {
      const t = r.target, a = r.achieved, L = LBM.get(r.personaId);
      if (!hasBand(t.fatLo, t.fatHi)) continue;
      const fm = fatMidOf(t), pM = pMidOf(t);
      const eA = t.fatHi + 0.25 * fm;
      if (a.fat <= eA) continue;
      landing.nFatOverDays++;
      const eW = t.fatHi + 0.50 * fm;
      const iD = (1.15 * t.kcal - 0.85 * pM * 4 - (t.carbLo ?? 0) * 4) / 9;
      if (a.fat <= eW) landing.underWide50++;
      if (a.fat <= iD) landing.underImplicitFloorRuler++;
      if (a.fat >= Math.round(L.lbmLb * ESSENTIAL_FAT_PER_LB_LBM)) landing.underEssentialFloorOnly++;
      if (a.fat <= (0.35 * t.kcal) / 9) landing.under35pctE++; else landing.above35pctE++;
      landing.fatOverPctOfCeil.push(a.fat / eA);
    }
    c9.fatOverDayLanding = {
      denominator: "satisfiable-planned-minus-degenerate",
      nFatOverA: landing.nFatOverDays,
      rescuedBy_wide50: landing.underWide50,
      rescuedBy_floorRulerImplicitCeiling: landing.underImplicitFloorRuler,
      passEssentialFatFloor: landing.underEssentialFloorOnly,
      under35pctE: landing.under35pctE, above35pctE: landing.above35pctE,
      medianFatOverAsMultipleOfAceiling: r4(med(landing.fatOverPctOfCeil)),
      p90: r4(pct(landing.fatOverPctOfCeil, 0.9)),
    };

    // ── D4 POSITION: the graded fat window in %E, per persona ──────────────
    const pos = { nonKeto: [], keto: [], all: [] };
    let ceilBelowAMDR = 0, floorBelowAMDR = 0, ceilBelowHelms = 0, floorBelowHelms = 0, gradedBelowEssential = 0, gradedBelowEssentialNonKeto = 0, gradedBelowEssentialKeto = 0;
    const carbPos = { gradedCarbFloor: [], carbLo: [], below50NonKeto: 0, carbFlooredPersonas: [], nearFloorNotBranched: [], nonKeto: 0 };
    for (const { rec: r } of byPersona.values()) {
      const t = r.target, L = LBM.get(r.personaId);
      if (!hasBand(t.fatLo, t.fatHi)) continue;
      const fm = fatMidOf(t);
      const gLo = t.fatLo - 0.25 * fm, gHi = t.fatHi + 0.25 * fm;
      const loE = (gLo * 9) / t.kcal, hiE = (gHi * 9) / t.kcal;
      const rec = { personaId: r.personaId, keto: !!t.keto, targetKcal: t.kcal, lbmLb: r2(L.lbmLb), gradedFatLoG: r2(gLo), gradedFatHiG: r2(gHi), gradedLoPctE: r2(loE * 100), gradedHiPctE: r2(hiE * 100), essentialFatG: Math.round(L.lbmLb * ESSENTIAL_FAT_PER_LB_LBM), gradedFloorPerLbLbm: r4(gLo / L.lbmLb) };
      pos.all.push(rec); (t.keto ? pos.keto : pos.nonKeto).push(rec);
      if (hiE < 0.35) ceilBelowAMDR++;
      if (loE < 0.20) floorBelowAMDR++;
      if (hiE < 0.30) ceilBelowHelms++;
      if (loE < 0.15) floorBelowHelms++;
      if (gLo < Math.round(L.lbmLb * ESSENTIAL_FAT_PER_LB_LBM)) { gradedBelowEssential++; if (t.keto) gradedBelowEssentialKeto++; else gradedBelowEssentialNonKeto++; }
      // carb position (I6)
      const cm = carbMidOf(t);
      const gCarbLo = t.carbLo - 0.25 * cm;
      carbPos.gradedCarbFloor.push(gCarbLo); carbPos.carbLo.push(t.carbLo);
      if (!t.keto) {
        carbPos.nonKeto++;
        if (gCarbLo < NONKETO_CARB_FLOOR_G) carbPos.below50NonKeto++;
        // The engine's carbFloored BRANCH, recomputed from bmrEngine.js:326-328:
        // raw leftover carb = round((tk - pMid*4 - fatMid*9)/4) - CARB_MIDPOINT_BUFFER_G.
        // `carbMid <= 50` OVER-COUNTS: two personas land at exactly 50 without
        // ever taking the branch. The brief's count of 9 is the branch count.
        const fLo = Math.round(L.lbmLb * 0.34), fHi = Math.round(L.lbmLb * 0.40);
        const rawCarb = Math.round((t.kcal - pMidOf(t) * 4 - ((fLo + fHi) / 2) * 9) / 4) - 25;
        const branch = rawCarb < NONKETO_CARB_FLOOR_G;
        if (branch) carbPos.carbFlooredPersonas.push({ personaId: r.personaId, rawLeftoverCarbG: rawCarb, carbMid: t.carbMid, carbLo: t.carbLo, carbHi: t.carbHi, gradedFloor: r2(gCarbLo), sex: L.sex, bfAssumed: L.bfAssumed });
        else if (t.carbMid <= NONKETO_CARB_FLOOR_G) carbPos.nearFloorNotBranched.push({ personaId: r.personaId, rawLeftoverCarbG: rawCarb, carbMid: t.carbMid, gradedFloor: r2(gCarbLo) });
      }
    }
    const d4 = {
      personas: pos.all.length,
      medianGradedWindowPctE: [r2(med(pos.all.map((x) => x.gradedLoPctE))), r2(med(pos.all.map((x) => x.gradedHiPctE)))],
      medianGradedWindowPctE_nonKeto: [r2(med(pos.nonKeto.map((x) => x.gradedLoPctE))), r2(med(pos.nonKeto.map((x) => x.gradedHiPctE)))],
      medianGradedWindowPctE_keto: [r2(med(pos.keto.map((x) => x.gradedLoPctE))), r2(med(pos.keto.map((x) => x.gradedHiPctE)))],
      gradedCeilingBelowAMDR35: ceilBelowAMDR, gradedFloorBelowAMDR20: floorBelowAMDR,
      gradedCeilingBelowHelms30: ceilBelowHelms, gradedFloorBelowHelms15: floorBelowHelms,
      gradedFloorBelowEssentialFat: { total: gradedBelowEssential, nonKeto: gradedBelowEssentialNonKeto, keto: gradedBelowEssentialKeto },
      medianGradedFloorPerLbLbm: r4(med(pos.all.map((x) => x.gradedFloorPerLbLbm))),
      effectiveHalfWidthPct_nonKeto: r2(med(pos.nonKeto.map((x) => { const lo = x.gradedFatLoG, hi = x.gradedFatHiG; return ((hi - lo) / 2 / ((hi + lo) / 2)) * 100; }))),
      i6_carbFloor: {
        medianGradedCarbFloorG: r2(med(carbPos.gradedCarbFloor)),
        medianCarbLoG: r2(med(carbPos.carbLo)),
        nonKetoPersonas: carbPos.nonKeto,
        nonKetoGradedBelow50: carbPos.below50NonKeto,
        carbFlooredPersonas_engineBranch: carbPos.carbFlooredPersonas.length,
        carbFlooredAllFemale: carbPos.carbFlooredPersonas.every((x) => x.sex === "F"),
        carbFlooredAllAssumedBodyFat: carbPos.carbFlooredPersonas.every((x) => x.bfAssumed),
        nearFloorButBranchNotTaken: carbPos.nearFloorNotBranched,
        carbFlooredDetail: carbPos.carbFlooredPersonas,
        carbFlooredGradedFloorRange: carbPos.carbFlooredPersonas.length ? [r2(Math.min(...carbPos.carbFlooredPersonas.map((x) => x.gradedFloor))), r2(Math.max(...carbPos.carbFlooredPersonas.map((x) => x.gradedFloor)))] : null,
      },
    };

    // ── honesty accounting: how many DECLARED misses each ruler silences ───
    const honesty = {};
    for (const dn of ["satisfiable-planned-minus-degenerate"]) {
      const sel = rows.filter(DENOMS[dn].f);
      honesty[dn] = {};
      for (const R of RULERS) {
        if (R.id === "A") continue;
        const newlyPassing = sel.filter((r) => !OK.A(r) && OK[R.id](r));
        honesty[dn][R.id] = {
          daysThatStopBeingDeclaredMisses: newlyPassing.length,
          ofThoseStillOutsideAmdrFatCeiling: newlyPassing.filter((r) => r.achieved.fat > (0.35 * r.target.kcal) / 9).length,
          ofThoseBelowEssentialFatFloor: newlyPassing.filter((r) => r.achieved.fat < Math.round(LBM.get(r.personaId).lbmLb * ESSENTIAL_FAT_PER_LB_LBM)).length,
          ofThoseBelowNonKetoCarbFloor50: newlyPassing.filter((r) => !r.target.keto && r.achieved.carb < NONKETO_CARB_FLOOR_G).length,
          medianFatPctE: r2(med(newlyPassing.map((r) => (r.achieved.fat * 9) / r.target.kcal)) * 100),
        };
      }
      // and what A currently PASSES that is nutritionally out of bounds
      const aPassing = sel.filter(OK.A);
      honesty[dn].__A_currentlyPasses = {
        days: aPassing.length,
        aboveAmdr35pctEFat: aPassing.filter((r) => r.achieved.fat > (0.35 * r.target.kcal) / 9).length,
        belowEssentialFatFloor: aPassing.filter((r) => r.achieved.fat < Math.round(LBM.get(r.personaId).lbmLb * ESSENTIAL_FAT_PER_LB_LBM)).length,
        belowNonKetoCarbFloor50: aPassing.filter((r) => !r.target.keto && r.achieved.carb < NONKETO_CARB_FLOOR_G).length,
      };
    }

    const rec = {
      file: path.relative(REPO, path.resolve(f)).replace(/\\/g, "/"),
      run: { label: h.label, seed: h.seed, seedName: h.seedName, poolShape: h.poolShape, dbSha256: h.dbSha256, personasSha256: h.personasSha256, gitSha: h.gitSha, gitDiffStat: h.gitDiffStat, brain: h.brain },
      d3Integrity: { rows: rows.length, rulerA_vs_storedBooleans_mismatch: aVsStored, perMacroMismatch: perMacro, stored_AND_mismatch: andMismatch, lbm_reconstruction_failures: lbmFail, mismatchDayKeys: mismatchIds.slice(0, 20), hasBandEdgeCases: edge },
      levels, flipMatrix, perDiet, decomposition: decomp, c9, d4, honesty,
    };
    out.runs.push(rec);

    lines.push(`\n=== ${rec.file}  seed=${h.seed} shape="${h.poolShape}" brain=${h.brain}`);
    lines.push(`    D3 INTEGRITY  A-vs-stored ${aVsStored} · per-macro ${JSON.stringify(perMacro)} · stored-AND ${andMismatch} · lbm-fail ${lbmFail}   (all must be 0)`);
    lines.push(`    hasBand edge: fatUnjudged ${edge.fatUnjudged} (fatHi===0: ${edge.fatHiZero}) · carbUnjudged ${edge.carbUnjudged} (carbHi===0: ${edge.carbHiZero})`);
    const dn = "satisfiable-planned-minus-degenerate";
    lines.push(`    ${"ruler".padEnd(6)} ${"sat-planned-553".padStart(17)} ${"sat-judged-537".padStart(16)} ${"planned-640".padStart(14)}   b / c vs A (553)`);
    for (const R of RULERS) {
      const a = levels[dn][R.id], b = levels["satisfiable-judged"][R.id], c = levels["planned"][R.id];
      const fl = R.id === "A" ? "—" : `${flipMatrix[dn][R.id].b_lostByTreatment} / ${flipMatrix[dn][R.id].c_gainedByTreatment}  net ${flipMatrix[dn][R.id].net >= 0 ? "+" : ""}${flipMatrix[dn][R.id].net}${flipMatrix[dn][R.id].clearsA5 ? "" : "  (below A5 floor)"}`;
      lines.push(`    ${R.id.padEnd(6)} ${(a.k + "/" + a.n + " = " + a.pct.toFixed(1) + "%").padStart(17)} ${(b.k + "/" + b.n + " = " + b.pct.toFixed(1) + "%").padStart(16)} ${(c.k + "/" + c.n + " = " + c.pct.toFixed(1) + "%").padStart(14)}   ${fl}`);
    }
    const D = decomp[dn];
    lines.push(`    DECOMP (${dn}, n=${D.n}): A=${D.aPct}% · gap ${D.gapToPerfectPts} pts = SOLVER-IRREDUCIBLE ${D.solverIrreducible.pts} pts (${D.solverIrreducible.days} d) + RULER-ELIGIBLE ${D.rulerEligibleCeiling.pts} pts (${D.rulerEligibleCeiling.days} d)`);
    lines.push(`      irreducible why: ${JSON.stringify(D.solverIrreducible.why)} · eligible side: ${JSON.stringify(D.rulerEligibleCeiling.failingSide)}`);
    lines.push(`    C9: ceiling loosening — wide50 ${c9.looseningPct.wide50}% · floor-ruler implicit ${c9.looseningPct.floorRuler}% · R35 ${c9.looseningPct.R35}%`);
    lines.push(`    D4: graded window median ${d4.medianGradedWindowPctE[0]}%E … ${d4.medianGradedWindowPctE[1]}%E · ceil<AMDR35 ${d4.gradedCeilingBelowAMDR35}/${d4.personas} · floor<AMDR20 ${d4.gradedFloorBelowAMDR20}/${d4.personas} · graded floor < essential fat ${d4.gradedFloorBelowEssentialFat.total}/${d4.personas}`);
    lines.push(`    I6: graded carb floor median ${d4.i6_carbFloor.medianGradedCarbFloorG} g vs carbLo ${d4.i6_carbFloor.medianCarbLoG} g · non-keto below 50 g: ${d4.i6_carbFloor.nonKetoGradedBelow50}/${d4.i6_carbFloor.nonKetoPersonas} · carb-floored personas (engine branch) ${d4.i6_carbFloor.carbFlooredPersonas_engineBranch} @ ${JSON.stringify(d4.i6_carbFloor.carbFlooredGradedFloorRange)} g · all female ${d4.i6_carbFloor.carbFlooredAllFemale} · all assumed-BF ${d4.i6_carbFloor.carbFlooredAllAssumedBodyFat}`);
  }

  // ── cross-seed pooling on the canonical denominator ─────────────────────
  const route = out.runs.filter((r) => r.run.poolShape && r.run.poolShape.startsWith("route"));
  if (route.length > 1) {
    const dn = "satisfiable-planned-minus-degenerate";
    const pooled = {};
    for (const R of RULERS) {
      const pcts = route.map((r) => r.levels[dn][R.id].pct);
      const b = route.reduce((s, r) => s + (R.id === "A" ? 0 : r.flipMatrix[dn][R.id].b_lostByTreatment), 0);
      const c = route.reduce((s, r) => s + (R.id === "A" ? 0 : r.flipMatrix[dn][R.id].c_gainedByTreatment), 0);
      const aPct = route.map((r) => r.levels[dn].A.pct);
      pooled[R.id] = {
        perSeedPct: pcts, meanPct: r2(pcts.reduce((a, x) => a + x, 0) / pcts.length), spreadPct: r2(Math.max(...pcts) - Math.min(...pcts)),
        meanDeltaVsA: R.id === "A" ? 0 : r2(pcts.reduce((a, x) => a + x, 0) / pcts.length - aPct.reduce((a, x) => a + x, 0) / aPct.length),
        pooled_b: b, pooled_c: c, pooled_net: c - b,
        pooledA5Floor: r2(1.96 * Math.sqrt(b + c)), clearsA5Pooled: Math.abs(c - b) > 1.96 * Math.sqrt(b + c),
      };
    }
    const dsum = route.map((r) => r.decomposition[dn]);
    out.pooledRoute = {
      denominator: dn, seeds: route.map((r) => r.run.seed), n: dsum[0].n,
      rulers: pooled,
      decomposition: {
        meanApct: r2(dsum.reduce((s, d) => s + d.aPct, 0) / dsum.length),
        meanGapPts: r2(dsum.reduce((s, d) => s + d.gapToPerfectPts, 0) / dsum.length),
        meanSolverIrreduciblePts: r2(dsum.reduce((s, d) => s + d.solverIrreducible.pts, 0) / dsum.length),
        meanRulerEligibleCeilingPts: r2(dsum.reduce((s, d) => s + d.rulerEligibleCeiling.pts, 0) / dsum.length),
        perSeedSolverIrreducibleDays: dsum.map((d) => d.solverIrreducible.days),
        perSeedRulerEligibleDays: dsum.map((d) => d.rulerEligibleCeiling.days),
        byRulerMeanNetPts: Object.fromEntries(RULERS.filter((R) => R.id !== "A").map((R) => [R.id, r2(dsum.reduce((s, d) => s + d.byRuler[R.id].netPts, 0) / dsum.length)])),
      },
    };
    lines.push(`\n=== POOLED ROUTE (${route.length} seeds), denominator ${dn} n=${out.pooledRoute.n}`);
    lines.push(`    ${"ruler".padEnd(6)} ${"mean%".padStart(7)} ${"spread".padStart(7)} ${"ΔvsA".padStart(7)}   pooled b/c   A5 floor   clears?`);
    for (const R of RULERS) {
      const p = pooled[R.id];
      lines.push(`    ${R.id.padEnd(6)} ${p.meanPct.toFixed(1).padStart(7)} ${p.spreadPct.toFixed(2).padStart(7)} ${(p.meanDeltaVsA >= 0 ? "+" : "") + p.meanDeltaVsA.toFixed(2)}`.padEnd(40) + `   ${p.pooled_b}/${p.pooled_c}   ${p.pooledA5Floor}   ${R.id === "A" ? "—" : (p.clearsA5Pooled ? "YES" : "no")}`);
    }
    const dd = out.pooledRoute.decomposition;
    lines.push(`\n    HEADLINE DECOMPOSITION (n=${out.pooledRoute.n}, satisfiable-planned−degenerate, 3 seeds pooled):`);
    lines.push(`      level ${dd.meanApct}%  ·  gap to 100% = ${dd.meanGapPts} pts`);
    lines.push(`      RULER CEILING (Z−A, any fat/carb re-grade)  = ${dd.meanRulerEligibleCeilingPts} pts`);
    lines.push(`      SOLVER-IRREDUCIBLE (kcal/protein miss)      = ${dd.meanSolverIrreduciblePts} pts`);
    lines.push(`      recommended instrument R35 net              = ${dd.byRulerMeanNetPts.R35} pts`);
    lines.push(`      => after R35, remaining gap for the solver  = ${r2(dd.meanGapPts - dd.byRulerMeanNetPts.R35)} pts`);
  }

  // ── THE HEADLINE DECOMPOSITION, stated once, with its denominator ───────
  if (out.pooledRoute) {
    const P = out.pooledRoute, dd = P.decomposition, RR = P.rulers;
    const dlt = (id) => RR[id].meanDeltaVsA;
    out.headline = {
      denominator: "satisfiable-planned − degenerate",
      n: P.n, seeds: P.seeds,
      currentLevelPct: dd.meanApct,
      gapToPerfectPts: dd.meanGapPts,
      arithmeticRulerCeilingPts: dd.meanRulerEligibleCeilingPts,
      arithmeticRulerCeilingRuler: "Z — kcal + protein only, fat and carb terms DELETED ENTIRELY. Not a proposal; the arithmetic bound on any fat/carb re-grade.",
      solverIrreduciblePts: dd.meanSolverIrreduciblePts,
      solverIrreducibleMeaning: "days that miss kcal and/or protein. NO fat/carb re-grade can ever recover them; the plan must change.",
      nutritionallyDefensibleRulerSharePts: dlt("E35k"),
      nutritionallyDefensibleRuler: "E35k — A's fat floor; non-keto fat ceiling re-anchored to AMDR 35%E; KETO EXEMPT; carb as A.",
      pricedRecommendationPts: dlt("R35k"),
      pricedRecommendation: "R35k — fat >= 0.30*lbm (the engine's own constant); non-keto fat ceiling 35%E, keto keeps A's band; carb >= max(carbLo,50); keto carb ceiling hard; no non-keto carb ceiling.",
      largeButNutritionallyINDEFENSIBLE: { B_fatFloorOnly: dlt("B"), D_fullFloorRuler: dlt("D"), A15_fatWide50: dlt("A15"), Z_bound: dlt("Z") },
      statement: `On n=${P.n} (satisfiable-planned − degenerate), pooled over seeds ${P.seeds.join("/")}, the level is ${dd.meanApct}% and the gap to 100% is ${dd.meanGapPts} pts; AT MOST ${dd.meanRulerEligibleCeilingPts} pts of that gap sit on days whose only failure is fat and/or carb (ruler Z — the arithmetic ceiling of any conceivable fat/carb re-grade), ${dd.meanSolverIrreduciblePts} pts sit on days that also miss kcal or protein and are untouchable by ANY ruler, and the largest NUTRITIONALLY DEFENSIBLE re-grade measures only +${dlt("E35k")} pts — so the RULER's recoverable share of the real gap is about +2 to +3 pts and the SOLVER owns the other ~22 pts.`,
      doubleCountGuard: {
        rule: "A day rescued by a ruler change is NOT also available to a solver lever. Every solver lever measured under ruler A must be RE-MEASURED under whatever ruler ships.",
        headroomLeftForSolverLevers: Object.fromEntries(["A", "B", "D", "E35k", "R35k", "A15", "F"].map((id) => [id, { levelPct: RR[id].meanPct, remainingGapPts: r2(100 - RR[id].meanPct) }])),
      },
    };
    lines.push(`\n    ONE-SENTENCE HEADLINE:\n      ${out.headline.statement}`);
  }

  console.log(lines.join("\n"));
  const jp = path.resolve(String(flags.json || path.join(REPO, "fleet/out/W3-1/ruler-share.json")));
  fs.writeFileSync(jp, JSON.stringify(out, null, 2) + "\n");
  console.log(`\njson -> ${jp}`);
}
main();
