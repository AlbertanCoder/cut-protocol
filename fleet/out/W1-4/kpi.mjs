// W1-4 — E3 reconciliation across every live denominator, the in-band/declared
// split, and the C10/E11 INFLATION TRAP quantified on THIS tree.
import fs from "node:fs";

const rows = fs.readFileSync("fleet/out/W1-2/daydump-route-s424242.jsonl", "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);

// ── denominators (W1-2 §3) ───────────────────────────────────────────────────
const planned = rows;                                            // 640
const degenerate = rows.filter((r) => r.degenerate);             // 1  (p233)
const plannedMinusDegen = rows.filter((r) => !r.degenerate);     // 639
const judged = rows.filter((r) => r.judged);                     // 623
const satPlanned = rows.filter((r) => r.satisfiable);            // 554
const satPlannedMinusDegen = satPlanned.filter((r) => !r.degenerate); // 553 CANONICAL
const satJudged = satPlanned.filter((r) => r.judged);            // 537

const D = {
  planned, plannedMinusDegen, judged, satPlanned,
  "satPlanned-degenerate (CANONICAL 553)": satPlannedMinusDegen, satJudged,
};

// ── E3 — the 2-macro slot warning's structural blind spot, every denominator ─
const e3 = {};
for (const [name, set] of Object.entries(D)) {
  const oob = set.filter((r) => r.verdict.inBand === false);
  const bothFine = oob.filter((r) => r.verdict.kcalOk && r.verdict.proteinOk);
  const noWarn = oob.filter((r) => !r.honesty.hasWarning);
  const fullySilent = oob.filter((r) => !r.honesty.hasWarning && !r.honesty.hasDiagnosis);
  e3[name] = {
    n: set.length, outOfBandDays: oob.length,
    kcalAndProteinBothFine: oob.length ? pct(bothFine.length, oob.length) : null,
    noSlotWarning: oob.length ? pct(noWarn.length, oob.length) : null,
    fullySilent: oob.length ? pct(fullySilent.length, oob.length) : null,
    fullySilentCount: fullySilent.length,
  };
}

// Slot-level: can the warning even FIRE? It is formed at weeklyPlanner.js:661-671
// only when kcalOff > 15% OR proteinShortfall > 15% — a 2-macro trigger.
let filledSlots = 0, slotsWithWarning = 0;
const oobDays = rows.filter((r) => r.verdict.inBand === false);
let oobDaysAllSlotsSilent = 0;
for (const r of rows) for (const s of r.slots) { if (s.recipeId) { filledSlots++; if (s.warning) slotsWithWarning++; } }
for (const r of oobDays) if (!r.slots.some((s) => s.warning)) oobDaysAllSlotsSilent++;

// ── in-band days that nonetheless carry a declaration ────────────────────────
const inBand = rows.filter((r) => r.verdict.inBand === true);
const inBandSplit = {
  n: inBand.length,
  withOwnSlotWarning: inBand.filter((r) => r.honesty.hasWarning).length,
  withRunDiagnosisOnly: inBand.filter((r) => !r.honesty.hasWarning && r.honesty.hasDiagnosis).length,
  clean: inBand.filter((r) => !r.honesty.hasWarning && !r.honesty.hasDiagnosis).length,
  note: "A slot warning on an in-band DAY is not a false surrender: the slot genuinely missed its own share while the day still landed. The run diagnosis on an in-band day comes from a DIFFERENT day of the same week.",
};

// ── C10 / E11 — THE INFLATION TRAP, quantified on this tree ─────────────────
// A6's hole: `judged = slotsFilled > 0`. A treatment that REFUSES a day (ships
// it empty) removes it from `judged` while leaving `planned` intact.
const inBandJudged = judged.filter((r) => r.verdict.inBand).length;
const oobJudged = judged.filter((r) => !r.verdict.inBand).length;
const inBandPlanned = planned.filter((r) => r.verdict.inBand).length;

const refuseK = (k) => {
  // Refuse the k worst out-of-band judged days -> they become unjudged.
  const newJudgedN = judged.length - k;
  return {
    refused: k,
    judgedRate: pct(inBandJudged, newJudgedN),
    plannedRate: pct(inBandPlanned, planned.length),
    satJudgedRate: pct(satJudged.filter((r) => r.verdict.inBand).length, satJudged.length - Math.min(k, satJudged.filter((r) => !r.verdict.inBand).length)),
  };
};
const trap = {
  mechanism: "A1/rig/schema.mjs:83 `judged: filled.length > 0`. Refusing a day empties its slots, so the day leaves the JUDGED denominator entirely while ALL PLANNED DAYS is unchanged. Zero behaviour improvement, large apparent gain.",
  baseline: { judged: `${inBandJudged}/${judged.length} = ${pct(inBandJudged, judged.length)}%`, planned: `${inBandPlanned}/${planned.length} = ${pct(inBandPlanned, planned.length)}%` },
  ladder: [0, 50, 100, 150, oobJudged].map(refuseK),
  maxGainOnJudged: Math.round((100 - pct(inBandJudged, judged.length)) * 100) / 100,
  maxGainOnPlanned: 0.0,
  falseRefusalsRequired: oobJudged,
  note: "Refusing ALL 188 out-of-band judged days scores a PERFECT 100% on `judged` and EXACTLY +0.00 on ALL PLANNED DAYS. That is E11's inflation trap in this tree's own arithmetic.",
};

// C10 — a SOUND refusal. The 18 provably-infeasible personas already contribute
// zero in-band days, so refusing them changes the numerator by zero.
const ANALYSIS = JSON.parse(fs.readFileSync("fleet/out/W1-2/analysis.json", "utf8"));
const PROVABLE = new Set(ANALYSIS.f1.aboveMaxGate.ids);
const provRows = rows.filter((r) => PROVABLE.has(r.personaId));
const c10 = {
  provablyInfeasiblePersonas: PROVABLE.size,
  theirPlannedDays: provRows.length,
  theirInBandDays: provRows.filter((r) => r.verdict.inBand).length,
  deltaOnPlannedIfSoundlyRefused: 0.0,
  deltaOnJudgedIfSoundlyRefused: pct(inBandJudged, judged.length - provRows.filter((r) => r.judged).length) - pct(inBandJudged, judged.length),
  verdict: "C10 CONFIRMED: a SOUND refusal moves ALL PLANNED DAYS by exactly +0.00, because the days it refuses were already contributing 0 to the numerator. It still scores on `judged` — which is precisely why `judged` must never be the headline.",
};

const out = { e3ByDenominator: e3, slotLevel: { filledSlots, slotsWithWarning, slotWarningRatePct: pct(slotsWithWarning, filledSlots), outOfBandDaysWithNoSlotWarningAtAll: oobDaysAllSlotsSilent, ofOutOfBandDaysPct: pct(oobDaysAllSlotsSilent, oobDays.length) }, inBandSplit, inflationTrap: trap, c10 };
fs.writeFileSync("fleet/out/W1-4/kpi.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
