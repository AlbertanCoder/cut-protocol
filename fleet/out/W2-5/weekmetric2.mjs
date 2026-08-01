// W2-5 read-only analysis, part 2: test the SPECIFIC proposed metric forms.
// Modifies no product source. Run: node fleet/out/W2-5/weekmetric2.mjs
import fs from "node:fs";

const path = process.argv[2] || "fleet/out/W1-1/daydump-route-s424242.jsonl";
const rows = fs.readFileSync(path, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
const byP = new Map();
for (const r of rows) { if (!byP.has(r.personaId)) byP.set(r.personaId, []); byP.get(r.personaId).push(r); }
const weeks = [...byP.entries()].filter(([, d]) => d.length === 7)
  .map(([id, d]) => ({ id, days: d.sort((a, b) => a.dayIndex - b.dayIndex) }));

const out = { weekPersonas: weeks.length };
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? +s[m].toFixed(3) : +((s[m - 1] + s[m]) / 2).toFixed(3)) : null; };

// ---- A. Direction census restricted to BAND macros (kcal/fat/carb), protein excluded ----
// Protein is a one-sided FLOOR, not a band; counting its shortfall as an "under"
// manufactures fake "mixed" days and hides how one-sided the band failures are.
let bandBad = 0, bOver = 0, bUnder = 0, bMixed = 0;
for (const w of weeks) for (const d of w.days) {
  if (!d.judged || d.verdict.inBand) continue;
  const v = d.verdict;
  let over = 0, under = 0;
  if (!v.kcalOk) { v.kcalDeltaPct > 0 ? over++ : under++; }
  if (!v.fatOk) { v.fatOverPct > 0 ? over++ : under++; }
  if (!v.carbOk) { v.carbOverPct > 0 ? over++ : under++; }
  if (!over && !under) continue; // protein-only failure
  bandBad++;
  if (over && !under) bOver++; else if (under && !over) bUnder++; else bMixed++;
}
out.bandMacroDirection = {
  daysWithABandFailure: bandBad, pureOver: bOver, pureUnder: bUnder, mixed: bMixed,
  pureOverPct: pct(bOver, bandBad),
  note: "kcal/fat/carb only. Protein excluded because it is a one-sided floor, not a band — counting it as an 'under' fabricates mixed days.",
};

// ---- B. Severity: is a days-in-band COUNT throwing away magnitude? ----
// CGM's stated flaw: TIR 'treats all values outside the target range as equally
// significant'. Measure how wide the overage distribution actually is.
const fatOver = [], carbOver = [], kcalAbs = [];
for (const w of weeks) for (const d of w.days) {
  if (!d.judged) continue;
  const v = d.verdict;
  if (v.fatOverPct > 0.25) fatOver.push(v.fatOverPct);
  if (v.carbOverPct > 0.25) carbOver.push(v.carbOverPct);
  if (!v.kcalOk) kcalAbs.push(Math.abs(v.kcalDeltaPct));
}
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
out.severitySpread = {
  fatOverBeyondTolerance: { n: fatOver.length, median: median(fatOver), p90: q(fatOver, 0.9), max: +Math.max(0, ...fatOver).toFixed(3) },
  carbOverBeyondTolerance: { n: carbOver.length, median: median(carbOver), p90: q(carbOver, 0.9), max: +Math.max(0, ...carbOver).toFixed(3) },
  kcalMissMagnitude: { n: kcalAbs.length, median: median(kcalAbs), p90: q(kcalAbs, 0.9), max: +Math.max(0, ...kcalAbs).toFixed(3) },
  // 2x-tolerance = the "level 2" analogue of CGM's <54 mg/dL tier
  fatOverBeyond2xTolerance: fatOver.filter((x) => x > 0.5).length,
  carbOverBeyond2xTolerance: carbOver.filter((x) => x > 0.5).length,
  note: "A flat in-band count scores a 26% fat overage and a 150% fat overage identically. CGM answers this with a SEVERITY TIER (level 1 / level 2), not with a mean.",
};

// ---- C. ">=6 of 7 days met the protein floor" — what happens on day 7? ----
const sixOf7 = [];
for (const w of weeks) {
  const j = w.days.filter((d) => d.judged);
  if (j.length !== 7) continue;
  const ok = j.filter((d) => d.verdict.proteinOk).length;
  if (ok === 6) {
    const badDay = j.find((d) => !d.verdict.proteinOk);
    sixOf7.push(+badDay.verdict.proteinShortPct.toFixed(3));
  }
}
out.sixOfSevenProteinRule = {
  weeksScoringExactly6of7: sixOf7.length,
  shortfallOnTheOneAllowedDayPct: sixOf7,
  worst: sixOf7.length ? Math.max(...sixOf7) : null,
  note: "A '>=6 of 7' rule grants one FREE day with no depth limit. Measured worst free-day shortfall here is the max above; the rule would have called that week compliant.",
};

// ---- D. Does REFUSING a day raise the score under each candidate denominator? ----
// Simulate: take each week, refuse (blank) the single WORST day, re-score.
function worstIdx(j) {
  let bi = -1, bs = -1;
  j.forEach((d, i) => {
    const v = d.verdict;
    const s = Math.abs(v.kcalDeltaPct) + v.proteinShortPct + v.fatOverPct + v.fatShortPct + v.carbOverPct + v.carbShortPct;
    if (s > bs) { bs = s; bi = i; }
  });
  return bi;
}
let dJudged = [0, 0], dJudgedAfter = [0, 0], dPlanned = [0, 0], dPlannedAfter = [0, 0];
for (const w of weeks) {
  const j = w.days.filter((d) => d.judged);
  if (j.length < 2) continue;
  const wi = worstIdx(j);
  j.forEach((d, i) => {
    // Denominator 1: judged days only (drops refused days)
    dJudged[1]++; if (d.verdict.inBand) dJudged[0]++;
    if (i !== wi) { dJudgedAfter[1]++; if (d.verdict.inBand) dJudgedAfter[0]++; }
    // Denominator 2: all PLANNED days, a refused day counts as not-in-band
    dPlanned[1]++; if (d.verdict.inBand) dPlanned[0]++;
    dPlannedAfter[1]++; if (i !== wi && d.verdict.inBand) dPlannedAfter[0]++;
  });
}
out.refusalExploit = {
  judgedOnlyDenominator: { before: pct(dJudged[0], dJudged[1]), afterRefusingWorstDay: pct(dJudgedAfter[0], dJudgedAfter[1]),
    deltaPts: +(pct(dJudgedAfter[0], dJudgedAfter[1]) - pct(dJudged[0], dJudged[1])).toFixed(1) },
  plannedDaysDenominator: { before: pct(dPlanned[0], dPlanned[1]), afterRefusingWorstDay: pct(dPlannedAfter[0], dPlannedAfter[1]),
    deltaPts: +(pct(dPlannedAfter[0], dPlannedAfter[1]) - pct(dPlanned[0], dPlanned[1])).toFixed(1) },
  note: "Refusing the single worst day of every week. Under a judged-only denominator the score RISES for free — that is E11. Under a fixed planned-days denominator it can only fall.",
};

// ---- E. Candidate: weekly MAD-of-kcal instead of signed mean ----
const cmp = [];
for (const w of weeks) {
  const j = w.days.filter((d) => d.judged);
  if (!j.length) continue;
  const tgt = j.reduce((s, d) => s + d.target.kcal, 0), got = j.reduce((s, d) => s + d.achieved.kcal, 0);
  const signed = Math.abs((got - tgt) / tgt);
  const mad = j.reduce((s, d) => s + Math.abs(d.verdict.kcalDeltaPct), 0) / j.length;
  cmp.push({ signed, mad, allIn: j.every((d) => d.verdict.inBand), bad: j.filter((d) => !d.verdict.inBand).length });
}
const madPass = cmp.filter((c) => c.mad <= 0.05), signedPass = cmp.filter((c) => c.signed <= 0.05);
out.madVsSignedMean = {
  weeks: cmp.length,
  signedMeanPass5: signedPass.length, signedMeanPass5_hidingBadDays: signedPass.filter((c) => !c.allIn).length,
  madPass5: madPass.length, madPass5_hidingBadDays: madPass.filter((c) => !c.allIn).length,
  badDaysHidden_signed: signedPass.reduce((s, c) => s + c.bad, 0),
  badDaysHidden_mad: madPass.reduce((s, c) => s + c.bad, 0),
  note: "Mean absolute deviation cannot cancel an over-day against an under-day. Compare the two 'hiding' columns.",
};

// ---- F. What a 3-state weekly composition (in / over / under) would report ----
let cIn = 0, cOver = 0, cUnder = 0, cMixed = 0, cTot = 0;
for (const w of weeks) for (const d of w.days) {
  if (!d.judged) continue;
  cTot++;
  const v = d.verdict;
  if (v.inBand) { cIn++; continue; }
  let over = 0, under = 0;
  if (!v.kcalOk) { v.kcalDeltaPct > 0 ? over++ : under++; }
  if (v.fatOverPct > 0.25) over++; if (v.fatShortPct > 0.25) under++;
  if (v.carbOverPct > 0.25) over++; if (v.carbShortPct > 0.25) under++;
  if (!v.proteinOk) under++;
  if (over && !under) cOver++; else if (under && !over) cUnder++; else cMixed++;
}
out.threeStateComposition = {
  judgedDays: cTot,
  inBand: cIn, over: cOver, short: cUnder, both: cMixed,
  inBandPct: pct(cIn, cTot), overPct: pct(cOver, cTot), shortPct: pct(cUnder, cTot), bothPct: pct(cMixed, cTot),
  note: "The direct analogue of CGM's TIR / TAR / TBR stacked bar. Sums to 100% of PLANNED days by construction — no day can be dropped without the bar visibly shrinking.",
};

console.log(JSON.stringify(out, null, 1));
