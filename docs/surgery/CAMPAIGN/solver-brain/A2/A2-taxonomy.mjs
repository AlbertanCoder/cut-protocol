/**
 * A2 · Failure taxonomy over the 173 missed days of qa-fleet-20260729-2032.
 *
 * Reads ONLY the prior run's artifacts (results.jsonl for the graded per-day
 * verdicts, raw/pNNN.json for the per-slot proteinScale/sidesScale that
 * results.jsonl does not carry). Touches no DB, starts no server, builds no
 * new harness.
 *
 * Instrument check first: every persona's raw dump must reproduce the graded
 * run's per-day claimed kcal, or the two files are describing different plans.
 */
import fs from "node:fs";
import path from "node:path";

const RUN = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032";
const OUT = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A2";

// backend/src/lib/weeklyPlanner.js:58 — const SCALE_BOUNDS = { min: 0.5, max: 2 };
const SCALE_MIN = 0.5, SCALE_MAX = 2;
const EPS = 1e-6; // scales are round2()'d at weeklyPlanner.js:356, so equality is exact
const TOL = { kcal: 0.15, protein: 0.15, fat: 0.25, carb: 0.25 };

// stats.json impossibleTier.mislabelledIds — forge errors, genuinely satisfiable
const MISLABELLED = new Set(["p028", "p066", "p080", "p083", "p103", "p160", "p212"]);

const personas = fs.readFileSync(path.join(RUN, "results.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

const rows = [];
let instrumentMismatch = 0;

for (const p of personas) {
  const pr = p.primary;
  if (!pr || !pr.mine) continue; // 38 profile-blocked-400 personas never reached a plan
  const raw = JSON.parse(fs.readFileSync(path.join(RUN, "raw", `${p.id}.json`), "utf8"));
  const slots = (raw.generate && raw.generate.body && raw.generate.body.slots) || [];

  const byDay = new Map();
  for (const s of slots) {
    if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
    byDay.get(s.dayOfWeek).push(s);
  }

  for (const d of pr.mine.days) {
    const ds = byDay.get(d.dayOfWeek) || [];
    const claimed = ds.reduce((a, s) => a + (s.kcal || 0), 0);
    if (Math.abs(claimed - d.claimedKcal) > 1) instrumentMismatch++;

    // ── slot-level pinning ────────────────────────────────────────────────
    // A slot is "pinned" when either knob sits exactly on a SCALE_BOUNDS edge.
    // Unfilled slots (recipeId null) carry a cosmetic 1/1 and are excluded —
    // weeklyPlanner.js:481 returns { recipeId: null, proteinScale: 1, sidesScale: 1 }.
    let filled = 0, pinnedMax = 0, pinnedMin = 0, pinnedAny = 0, unfilled = 0;
    for (const s of ds) {
      if (!s.recipeId) { unfilled++; continue; }
      filled++;
      const hiP = Math.abs((s.proteinScale ?? 1) - SCALE_MAX) < EPS;
      const hiS = Math.abs((s.sidesScale ?? 1) - SCALE_MAX) < EPS;
      const loP = Math.abs((s.proteinScale ?? 1) - SCALE_MIN) < EPS;
      const loS = Math.abs((s.sidesScale ?? 1) - SCALE_MIN) < EPS;
      if (hiP || hiS) pinnedMax++;
      if (loP || loS) pinnedMin++;
      if (hiP || hiS || loP || loS) pinnedAny++;
    }

    const target = p.target || {};
    const keto = !!target.keto;

    // ── symptoms (independent; a day may show several) ─────────────────────
    const sym = {
      kcal: !d.kcalOk,
      protein: !d.proteinOk,
      fat: !d.fatOk,
      carb: !d.carbOk,
      poolExhausted: unfilled > 0 || d.empty === true || (d.missingFood || 0) > 0,
      pinnedAny: pinnedAny > 0,
    };

    // Directional pinning: a bound only BINDS if it blocks the direction the
    // day needed to move. Wanting more (kcal under / protein short) is blocked
    // by the 2.0x ceiling; wanting less (kcal over / fat or carb over) by 0.5x.
    const needsMore = (!d.kcalOk && d.kcalDeltaPct < 0) || !d.proteinOk ||
      (!d.fatOk && d.fatShortPct > TOL.fat) || (!d.carbOk && d.carbShortPct > TOL.carb);
    const needsLess = (!d.kcalOk && d.kcalDeltaPct > 0) ||
      (!d.fatOk && d.fatOverPct > TOL.fat) ||
      (!d.carbOk && d.carbOverPct > (keto ? 0 : TOL.carb));
    sym.pinnedBinding = (needsMore && pinnedMax > 0) || (needsLess && pinnedMin > 0);

    // ── severity, each excursion as a multiple of its own tolerance ────────
    const carbAllow = keto ? 0 : TOL.carb;
    const sev = {
      kcal: Math.abs(d.kcalDeltaPct) / TOL.kcal,
      protein: d.proteinShortPct / TOL.protein,
      fat: Math.max(d.fatShortPct, d.fatOverPct) / TOL.fat,
      carb: Math.max(
        d.carbShortPct / TOL.carb,
        carbAllow > 0 ? d.carbOverPct / carbAllow : (d.carbOverPct > 0 ? Infinity : 0),
      ),
    };

    rows.push({
      persona: p.id, tier: p.tier, diet: p.dietaryStyle || "none",
      impossibleKind: p.impossibleKind || null,
      satisfiable: !(p.impossibleKind && !MISLABELLED.has(p.id)),
      dayOfWeek: d.dayOfWeek, inTolerance: d.inTolerance,
      slots: ds.length, filled, unfilled, pinnedAny, pinnedMax, pinnedMin,
      keto,
      kcalDeltaPct: d.kcalDeltaPct, proteinShortPct: d.proteinShortPct,
      fatShortPct: d.fatShortPct, fatOverPct: d.fatOverPct,
      carbShortPct: d.carbShortPct, carbOverPct: d.carbOverPct,
      needsMore, needsLess, sym, sev,
      poolAfterStack: (pr.claims && pr.claims.poolCounts && pr.claims.poolCounts.afterStack) ?? null,
    });
  }
}

// ── binding-constraint precedence ────────────────────────────────────────────
// Documented and deliberately ordered from "no solver decision could have helped"
// down to "the solver had room and still missed":
//   1 STRUCTURAL      persona engineered unsatisfiable — correct output is refusal
//   2 POOL_EXHAUSTED  a slot had nothing to place; scaling cannot fix an empty slot
//   3 PINNED_AT_BOUND the day's miss direction is blocked by a 0.5x/2.0x edge
//   4..7 the worst remaining macro excursion, by severity (multiples of its tolerance)
function bind(r) {
  if (!r.satisfiable) return "STRUCTURAL";
  if (r.sym.poolExhausted) return "POOL_EXHAUSTED";
  if (r.sym.pinnedBinding) return "PINNED_AT_BOUND";
  const order = ["fat", "protein", "kcal", "carb"];
  let best = null, bestV = -1;
  for (const k of order) {
    if (!r.sym[k]) continue;
    if (r.sev[k] > bestV) { bestV = r.sev[k]; best = k; }
  }
  return best ? { fat: "FAT_OUT_OF_BAND", protein: "PROTEIN_SHORT", kcal: "KCAL_OUT_OF_BAND", carb: "CARB_OUT_OF_BAND" }[best] : "UNCLASSIFIED";
}

const missed = rows.filter((r) => !r.inTolerance);
for (const r of missed) r.binding = bind(r);

// ── output ───────────────────────────────────────────────────────────────────
const tally = (arr, key) => arr.reduce((m, r) => (m[key(r)] = (m[key(r)] || 0) + 1, m), {});

const report = {
  instrumentMismatch,
  daysTotal: rows.length,
  daysInBand: rows.filter((r) => r.inTolerance).length,
  daysMissed: missed.length,
  satisfiableDays: rows.filter((r) => r.satisfiable).length,
  satisfiableMissed: missed.filter((r) => r.satisfiable).length,
  bindingAll: tally(missed, (r) => r.binding),
  bindingSatisfiable: tally(missed.filter((r) => r.satisfiable), (r) => r.binding),
  coOccurrence: {
    kcal: missed.filter((r) => r.sym.kcal).length,
    protein: missed.filter((r) => r.sym.protein).length,
    fat: missed.filter((r) => r.sym.fat).length,
    carb: missed.filter((r) => r.sym.carb).length,
    poolExhausted: missed.filter((r) => r.sym.poolExhausted).length,
    pinnedAny: missed.filter((r) => r.sym.pinnedAny).length,
    pinnedBinding: missed.filter((r) => r.sym.pinnedBinding).length,
    structural: missed.filter((r) => !r.satisfiable).length,
  },
  symptomCountHistogram: tally(missed, (r) =>
    ["kcal", "protein", "fat", "carb"].filter((k) => r.sym[k]).length),
  macroComboHistogram: tally(missed, (r) =>
    ["kcal", "protein", "fat", "carb"].filter((k) => r.sym[k]).join("+") || "none"),
  // per-SLOT pinning, the number the brief quotes (68.3% / 39.3%)
  slotPinning: (() => {
    let allFilled = 0, allPinned = 0, missDayFilled = 0, missDayPinned = 0;
    for (const r of rows) {
      allFilled += r.filled; allPinned += r.pinnedAny;
      if (!r.inTolerance) { missDayFilled += r.filled; missDayPinned += r.pinnedAny; }
    }
    return { allFilled, allPinned, allPct: allPinned / allFilled,
      missDayFilled, missDayPinned, missDayPct: missDayPinned / missDayFilled };
  })(),
};

// per-diet tables
const diets = [...new Set(rows.map((r) => r.diet))].sort();
const BINDINGS = ["STRUCTURAL", "POOL_EXHAUSTED", "PINNED_AT_BOUND", "FAT_OUT_OF_BAND", "PROTEIN_SHORT", "KCAL_OUT_OF_BAND", "CARB_OUT_OF_BAND", "UNCLASSIFIED"];
const perDiet = (pool) => diets.map((d) => {
  const days = pool.filter((r) => r.diet === d);
  const ms = days.filter((r) => !r.inTolerance);
  const row = { diet: d, days: days.length, missed: ms.length,
    missRate: days.length ? ms.length / days.length : 0 };
  for (const b of BINDINGS) row[b] = ms.filter((r) => r.binding === b).length;
  return row;
});
report.perDietAll = perDiet(rows);
report.perDietSatisfiable = perDiet(rows.filter((r) => r.satisfiable));

fs.writeFileSync(path.join(OUT, "A2-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, "A2-days.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const csvCols = ["persona", "tier", "diet", "satisfiable", "dayOfWeek", "inTolerance", "binding", "slots", "filled", "unfilled", "pinnedAny", "pinnedMax", "pinnedMin", "keto", "kcalDeltaPct", "proteinShortPct", "fatShortPct", "fatOverPct", "carbShortPct", "carbOverPct", "poolAfterStack"];
fs.writeFileSync(path.join(OUT, "A2-missed-days.csv"),
  csvCols.join(",") + "\n" + missed.map((r) => csvCols.map((c) => r[c] ?? "").join(",")).join("\n") + "\n");

console.log(JSON.stringify(report, null, 2));
