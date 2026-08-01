// W1-4 — honesty detection measured on the canonical dump.
// Pure arithmetic over fleet/out/W1-2/daydump-route-s*.jsonl. No solve, no DB,
// no network. Denominators named on every rate.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || "fleet/out/W1-2";
const SEEDS = ["424242", "20260730", "8675309"];
const ANALYSIS = JSON.parse(fs.readFileSync("fleet/out/W1-2/analysis.json", "utf8"));
const PROVABLE_18 = new Set(ANALYSIS.f1.aboveMaxGate.ids);

const load = (seed) =>
  fs.readFileSync(path.join(ROOT, `daydump-route-s${seed}.jsonl`), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));

const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);
const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return Math.round(s[i] * 1000) / 1000;
};

function analyseSeed(seed) {
  const rows = load(seed);

  // ── DAY-LEVEL ────────────────────────────────────────────────────────────
  // oracle = the product's own 4-macro verdict (W1-2 reconciled 2560/2560).
  // declared(day) = any slot warning on this day OR the run carries a diagnosis.
  const dayRows = rows.filter((r) => !r.degenerate || true);
  const day2x2 = { inBandDeclared: 0, inBandSilent: 0, outDeclared: 0, outSilent: 0 };
  const silentDays = [];
  const certifiedFalseSurrenderDays = [];
  for (const r of dayRows) {
    const inBand = r.verdict.inBand === true;
    const declared = Boolean(r.honesty.hasWarning || r.honesty.hasDiagnosis);
    if (inBand && declared) { day2x2.inBandDeclared++; certifiedFalseSurrenderDays.push(r.dayKey); }
    else if (inBand && !declared) day2x2.inBandSilent++;
    else if (!inBand && declared) day2x2.outDeclared++;
    else { day2x2.outSilent++; silentDays.push({ dayKey: r.dayKey, tier: r.tier, slotsFilled: r.slotsFilled, slotsTotal: r.slotsTotal }); }
  }

  // Cross-check against the dump's own tri-state `declared`
  const declaredFalse = rows.filter((r) => r.honesty.declared === false).map((r) => r.dayKey);

  // ── RUN-LEVEL (one /generate call = one persona) ─────────────────────────
  // This is the level the "41/41 perfect weeks mislabeled" claim lives at:
  // diagnoseFromResult stamps feasible:false on the whole RUN.
  const byRun = new Map();
  for (const r of rows) {
    if (!byRun.has(r.personaId)) byRun.set(r.personaId, []);
    byRun.get(r.personaId).push(r);
  }
  const runs = [];
  for (const [personaId, rs] of byRun) {
    const allInBand = rs.every((r) => r.verdict.inBand === true);
    const anyEmptySlot = rs.some((r) => r.slotsEmpty > 0);
    const converged = allInBand && !anyEmptySlot;      // oracle-feasible run
    const declared = Boolean(rs[0].honesty.hasDiagnosis);
    runs.push({
      personaId, tier: rs[0].tier, satisfiable: rs[0].satisfiable,
      days: rs.length, allInBand, anyEmptySlot, converged, declared,
      daysInBand: rs.filter((r) => r.verdict.inBand).length,
      horizonKey: rs[0].horizonKey,
    });
  }
  const run2x2 = {
    convergedDeclared: runs.filter((r) => r.converged && r.declared).length,   // FALSE SURRENDER
    convergedSilent: runs.filter((r) => r.converged && !r.declared).length,    // true negative
    missedDeclared: runs.filter((r) => !r.converged && r.declared).length,     // true positive
    missedSilent: runs.filter((r) => !r.converged && !r.declared).length,      // FALSE NEGATIVE (silent miss)
  };
  const tp = run2x2.missedDeclared, fp = run2x2.convergedDeclared;
  const fn = run2x2.missedSilent, tn = run2x2.convergedSilent;

  // Sub-case: perfect run that is ALSO all-slots-filled AND declared →
  // certified false surrender. Split by why (variety breach is a legal trigger).
  const falseSurrenderRuns = runs.filter((r) => r.converged && r.declared);

  // ── E3 — the 2-macro slot warning's structural blind spot ────────────────
  const outOfBand = rows.filter((r) => r.verdict.inBand === false);
  const bothFine = outOfBand.filter((r) => r.verdict.kcalOk && r.verdict.proteinOk);
  const noSlotWarning = outOfBand.filter((r) => !r.honesty.hasWarning);
  const noSlotWarningBothFine = outOfBand.filter((r) => r.verdict.kcalOk && r.verdict.proteinOk && !r.honesty.hasWarning);

  // ── E7 — floor-pinned slots ──────────────────────────────────────────────
  // Nominal slot kcal share reconstructed from the day target and slot weights
  // is not on the record, so measure what IS: pin prevalence + the day-level
  // overshoot of days carrying a lo-pinned slot vs days carrying none.
  const withLoPin = rows.filter((r) => r.pinned.atLoBound > 0);
  const withoutPin = rows.filter((r) => r.pinned.atLoBound === 0 && r.pinned.atHiBound === 0 && r.slotsFilled > 0);
  const kcalDelta = (r) => r.verdict.kcalDeltaPct;
  const pinStats = {
    daysWithLoPin: withLoPin.length,
    daysWithHiPin: rows.filter((r) => r.pinned.atHiBound > 0).length,
    loPinSlots: rows.reduce((s, r) => s + r.pinned.atLoBound, 0),
    hiPinSlots: rows.reduce((s, r) => s + r.pinned.atHiBound, 0),
    scaledSlots: rows.reduce((s, r) => s + r.pinned.scaledSlots, 0),
    loPinDays_kcalDeltaPct: { median: q(withLoPin.map(kcalDelta), 0.5), p90: q(withLoPin.map(kcalDelta), 0.9) },
    noPinDays_kcalDeltaPct: { median: q(withoutPin.map(kcalDelta), 0.5), p90: q(withoutPin.map(kcalDelta), 0.9) },
    loPinDays_inBand: pct(withLoPin.filter((r) => r.verdict.inBand).length, withLoPin.length),
    noPinDays_inBand: pct(withoutPin.filter((r) => r.verdict.inBand).length, withoutPin.length),
    loPinDays_warningRate: pct(withLoPin.filter((r) => r.honesty.hasWarning).length, withLoPin.length),
  };

  // Slot-level: a lo-pinned slot's own overshoot needs its target. Use the
  // day's kcal target split by the dump's own slot count as the best available
  // proxy, and FLAG it as a proxy rather than pretend it is the solver's share.
  const loPinSlotOver = [];
  for (const r of rows) {
    const filled = r.slots.filter((s) => s.recipeId);
    if (!filled.length || !(r.target.kcal > 0)) continue;
    const share = r.target.kcal / filled.length;   // PROXY — equal split
    for (const s of filled) {
      if (s.pinnedLo) loPinSlotOver.push((s.kcal - share) / share);
    }
  }
  pinStats.loPinSlot_overVsEqualSplitProxy = {
    n: loPinSlotOver.length,
    median: q(loPinSlotOver, 0.5), p90: q(loPinSlotOver, 0.9), p10: q(loPinSlotOver, 0.1),
    shareOver: pct(loPinSlotOver.filter((x) => x > 0).length, loPinSlotOver.length),
    note: "PROXY denominator (day kcal / filled slot count), NOT the solver's weighted+carry-forward share. Direction only.",
  };

  // ── B — detection scored per tier ────────────────────────────────────────
  const scoreCohort = (label, filterFn) => {
    const rs = runs.filter(filterFn);
    const d = rs.filter((r) => r.declared).length;
    const conv = rs.filter((r) => r.converged).length;
    return {
      label, runs: rs.length, declaredInfeasible: d,
      declaredRate: pct(d, rs.length),
      convergedRuns: conv,
      runsWithAtLeastOneInBandDay: rs.filter((r) => r.daysInBand > 0).length,
      falseSurrenders: rs.filter((r) => r.converged && r.declared).length,
      silentMisses: rs.filter((r) => !r.converged && !r.declared).length,
    };
  };
  const tiers = {
    label32: scoreCohort("IMPOSSIBLE label (32)", (r) => r.tier === "IMPOSSIBLE"),
    provable18: scoreCohort("provably infeasible (18, W1-5 aboveMax_gate)", (r) => PROVABLE_18.has(r.personaId)),
    mislabeled14: scoreCohort("IMPOSSIBLE label but NOT provable (14)", (r) => r.tier === "IMPOSSIBLE" && !PROVABLE_18.has(r.personaId)),
    satisfiable218: scoreCohort("satisfiable (218)", (r) => r.tier !== "IMPOSSIBLE"),
    all250: scoreCohort("all runs (250)", () => true),
  };

  return {
    seed, records: rows.length, runs: runs.length,
    dayLevel: {
      n: dayRows.length,
      matrix: day2x2,
      silentMissDays: silentDays,
      dumpDeclaredFalse: declaredFalse,
      certifiedFalseSurrenderDays_count: certifiedFalseSurrenderDays.length,
      note: "hasDiagnosis is a RUN-level flag replicated onto every day of the run; a day-level 'declared' therefore inherits the week's line.",
    },
    runLevel: {
      n: runs.length,
      matrix: run2x2,
      precision: pct(tp, tp + fp),
      recall: pct(tp, tp + fn),
      falseSurrenderRate: pct(fp, tp + fp),
      falseSurrenderRate_ofConverged: pct(fp, fp + tn),
      specificity: pct(tn, tn + fp),
      falseSurrenderRuns: falseSurrenderRuns.map((r) => ({ personaId: r.personaId, tier: r.tier, days: r.days, horizonKey: r.horizonKey })),
      silentMissRuns: runs.filter((r) => !r.converged && !r.declared).map((r) => ({ personaId: r.personaId, tier: r.tier, daysInBand: r.daysInBand, days: r.days, anyEmptySlot: r.anyEmptySlot })),
    },
    tiers,
    e3: {
      outOfBandDays: outOfBand.length,
      kcalAndProteinBothFine: bothFine.length,
      kcalAndProteinBothFinePct: pct(bothFine.length, outOfBand.length),
      noSlotWarning: noSlotWarning.length,
      noSlotWarningPct: pct(noSlotWarning.length, outOfBand.length),
      noSlotWarningAndBothFine: noSlotWarningBothFine.length,
      noSlotWarningAndBothFinePct: pct(noSlotWarningBothFine.length, outOfBand.length),
    },
    e7: pinStats,
  };
}

const out = { generatedBy: "W1-4", input: ROOT, seeds: {} };
for (const s of SEEDS) out.seeds[s] = analyseSeed(s);
fs.mkdirSync("fleet/out/W1-4", { recursive: true });
fs.writeFileSync("fleet/out/W1-4/analysis.json", JSON.stringify(out, null, 2));

const p = out.seeds["424242"];
console.log("=== RUN-LEVEL 2x2 (n=250 /generate calls, seed 424242) ===");
console.log(JSON.stringify(p.runLevel.matrix, null, 2));
console.log("precision", p.runLevel.precision, "recall", p.runLevel.recall,
  "falseSurrenderRate(of declared)", p.runLevel.falseSurrenderRate,
  "falseSurrenderRate(of converged)", p.runLevel.falseSurrenderRate_ofConverged);
console.log("false-surrender runs:", JSON.stringify(p.runLevel.falseSurrenderRuns));
console.log("silent-miss runs:", JSON.stringify(p.runLevel.silentMissRuns));
console.log("\n=== DAY-LEVEL ===");
console.log(JSON.stringify(p.dayLevel.matrix), "silentDays:", JSON.stringify(p.dayLevel.silentMissDays));
console.log("dump declared===false:", JSON.stringify(p.dayLevel.dumpDeclaredFalse));
console.log("\n=== TIERS ===");
for (const k of Object.keys(p.tiers)) console.log(JSON.stringify(p.tiers[k]));
console.log("\n=== E3 ===");
console.log(JSON.stringify(p.e3, null, 2));
console.log("\n=== E7 ===");
console.log(JSON.stringify(p.e7, null, 2));
console.log("\n=== CROSS-SEED run-level matrix ===");
for (const s of SEEDS) console.log(s, JSON.stringify(out.seeds[s].runLevel.matrix), "e3.bothFinePct", out.seeds[s].e3.kcalAndProteinBothFinePct, "e3.noSlotWarnPct", out.seeds[s].e3.noSlotWarningPct);
