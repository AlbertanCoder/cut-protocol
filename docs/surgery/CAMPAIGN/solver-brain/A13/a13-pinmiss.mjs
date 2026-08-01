// A13 — THE PRIMARY METRIC: pinning-given-miss, and which END of the box binds.
//
// BRIEF.md's motivating statistic: "68.3 % of slots that MISSED tolerance were
// pinned at a 0.5x or 2.0x scale bound, against 39.3 % of all slots." This
// recomputes both halves on the rig's own records so the two variants are
// measured with one ruler.
//
// Slot-level miss = the slot carries a `warning` (the solver's own per-slot
// gate: KCAL_TOLERANCE_PCT / PROTEIN_TOLERANCE_PCT, mealSolver.js).
// Pinning is taken from the hook's true per-knob lo/hi when a diag join is
// available (see a13-spread.mjs header: for a per-role run the rig's
// proteinScale/sidesScale pair understates pinning, because sidesScale is a
// kcal-weighted mean of several knobs).
//
// C10 direction test: of MISSED days that touch a bound, how many needed the
// day to be SMALLER (achieved kcal above target, or fat over band) and were
// blocked at the LO end, vs blocked at the HI end only.
//
//   node a13-pinmiss.mjs <variant.jsonl> [diag.json]

import fs from "node:fs";
import path from "node:path";

const [jsonlPath, diagPath] = process.argv.slice(2);
const rows = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const idx = new Map();
if (diagPath && fs.existsSync(diagPath)) {
  const d = JSON.parse(fs.readFileSync(diagPath, "utf8"));
  for (const s of d.scales || []) idx.set(s.key, s);
}
const LO = 0.5, HI = 2.0;
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");

let slots = 0, slotsPinned = 0, warned = 0, warnedPinned = 0, joined = 0;
let sSlots = 0, sPinned = 0, sWarned = 0, sWarnedPinned = 0;
let loOnly = 0, hiOnly = 0, both = 0;
// day level, satisfiable-only
let dIn = 0, dOut = 0, dOutAnyPinned = 0, dInAnyPinned = 0;
let missNeedSmaller = 0, missNeedSmaller_loBlocked = 0, missNeedSmaller_hiOnly = 0;
let missNeedBigger = 0, missNeedBigger_hiBlocked = 0;

for (const r of rows) {
  if (!r.judged) continue;
  const sat = r.satisfiable !== false;
  let dayPinLo = false, dayPinHi = false;
  for (const s of r.slots || []) {
    if (!s.recipeId) continue;
    slots++; if (sat) sSlots++;
    const key = `${s.recipeId}|${r2(s.proteinScale)}|${r2(s.sidesScale)}`;
    const d = idx.get(key);
    let pl, ph;
    if (d) { joined++; pl = d.lo <= LO + 1e-9; ph = d.hi >= HI - 1e-9; }
    else { pl = !!s.pinnedLo; ph = !!s.pinnedHi; }
    if (pl) dayPinLo = true;
    if (ph) dayPinHi = true;
    if (pl && ph) both++; else if (pl) loOnly++; else if (ph) hiOnly++;
    const pinned = pl || ph;
    if (pinned) { slotsPinned++; if (sat) sPinned++; }
    if (s.warning) {
      warned++; if (pinned) warnedPinned++;
      if (sat) { sWarned++; if (pinned) sWarnedPinned++; }
    }
  }
  if (!sat) continue;
  const anyPin = dayPinLo || dayPinHi;
  if (r.verdict.inBand) { dIn++; if (anyPin) dInAnyPinned++; continue; }
  dOut++; if (anyPin) dOutAnyPinned++;
  // direction: does this missed day need to SHRINK?
  const v = r.verdict;
  const smaller = v.kcalDeltaPct > 0 || v.fatOverPct > 0 || v.carbOverPct > 0;
  const bigger = v.kcalDeltaPct < 0 || v.proteinShortPct > 0 || v.fatShortPct > 0 || v.carbShortPct > 0;
  if (smaller && anyPin) {
    missNeedSmaller++;
    if (dayPinLo) missNeedSmaller_loBlocked++; else missNeedSmaller_hiOnly++;
  }
  if (bigger && !smaller && anyPin) {
    missNeedBigger++;
    if (dayPinHi) missNeedBigger_hiBlocked++;
  }
}

const out = {
  file: path.basename(jsonlPath),
  diagJoined: joined, servedSlots: slots,
  ALL_SLOTS: {
    slots, pinned: slotsPinned, pinnedPct: pct(slotsPinned, slots),
    warnedSlots: warned, warnedPinned, pinnedGivenMissPct: pct(warnedPinned, warned),
    pinLoOnly: loOnly, pinHiOnly: hiOnly, pinBoth: both,
  },
  SATISFIABLE: {
    slots: sSlots, pinned: sPinned, pinnedPct: pct(sPinned, sSlots),
    warnedSlots: sWarned, warnedPinned: sWarnedPinned, pinnedGivenMissPct: pct(sWarnedPinned, sWarned),
    daysInBand: dIn, daysOut: dOut,
    daysOut_anyPinned: dOutAnyPinned, daysOut_anyPinnedPct: pct(dOutAnyPinned, dOut),
    daysIn_anyPinned: dInAnyPinned, daysIn_anyPinnedPct: pct(dInAnyPinned, dIn),
    missedDays_needSmaller_pinned: missNeedSmaller,
    missedDays_needSmaller_blockedAtLo: missNeedSmaller_loBlocked,
    missedDays_needSmaller_hiEndOnly: missNeedSmaller_hiOnly,
    missedDays_needBiggerOnly_pinned: missNeedBigger,
    missedDays_needBiggerOnly_blockedAtHi: missNeedBigger_hiBlocked,
  },
};
console.log(JSON.stringify(out));
fs.writeFileSync(jsonlPath.replace(/\.jsonl$/, "-pinmiss.json"), JSON.stringify(out, null, 2));
