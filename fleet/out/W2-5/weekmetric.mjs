// W2-5 read-only analysis: what would a weekly metric actually report on the
// real 7-day personas, and what would it conceal?
// Reads fleet/out/W1-1/daydump-route-s424242.jsonl. Writes nothing but stdout.
// Modifies no product source. Run: node fleet/out/W2-5/weekmetric.mjs [dumpPath]
import fs from "node:fs";

const path = process.argv[2] || "fleet/out/W1-1/daydump-route-s424242.jsonl";
const rows = fs.readFileSync(path, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? +s[m].toFixed(4) : +((s[m - 1] + s[m]) / 2).toFixed(4);
}

const byP = new Map();
for (const r of rows) {
  if (!byP.has(r.personaId)) byP.set(r.personaId, []);
  byP.get(r.personaId).push(r);
}

// Only the 7-day-horizon personas can exercise a 7-day metric.
const weeks = [...byP.entries()]
  .filter(([, ds]) => ds.length === 7)
  .map(([id, ds]) => ({ id, days: ds.sort((a, b) => a.dayIndex - b.dayIndex) }));

const out = { source: path, weekPersonas: weeks.length, dayRecords: rows.length };

// ---- 1. Distribution of days-in-band out of 7 (judged days only) ----
const kHist = {};
for (const w of weeks) {
  const judged = w.days.filter((d) => d.judged);
  const k = judged.filter((d) => d.verdict.inBand).length;
  kHist[`${k}/${judged.length}`] = (kHist[`${k}/${judged.length}`] || 0) + 1;
}
out.daysInBandHistogram = kHist;

// ---- 2. Weekly-mean kcal metric vs per-day truth ----
const w5 = [];
for (const w of weeks) {
  const judged = w.days.filter((d) => d.judged);
  if (!judged.length) continue;
  const tgt = judged.reduce((s, d) => s + d.target.kcal, 0);
  const got = judged.reduce((s, d) => s + d.achieved.kcal, 0);
  const meanDevPct = (got - tgt) / tgt; // signed: cancellation allowed
  const madPct = judged.reduce((s, d) => s + Math.abs(d.verdict.kcalDeltaPct), 0) / judged.length;
  const inBand = judged.filter((d) => d.verdict.inBand).length;
  w5.push({ id: w.id, n: judged.length, meanDevPct, madPct, inBand, allIn: inBand === judged.length });
}
const pass5 = w5.filter((w) => Math.abs(w.meanDevPct) <= 0.05);
const pass3 = w5.filter((w) => Math.abs(w.meanDevPct) <= 0.03);
out.meanKcalMetric = {
  weeksScored: w5.length,
  passWithin5pct: pass5.length,
  passWithin3pct: pass3.length,
  // THE CONCEALMENT NUMBER: weeks that pass the weekly headline but contain >=1 bad day
  pass5_butHasOutOfBandDay: pass5.filter((w) => !w.allIn).length,
  pass5_outOfBandDaysHidden: pass5.reduce((s, w) => s + (w.n - w.inBand), 0),
  pass3_butHasOutOfBandDay: pass3.filter((w) => !w.allIn).length,
  pass3_outOfBandDaysHidden: pass3.reduce((s, w) => s + (w.n - w.inBand), 0),
  fail5_butAllDaysIn: w5.filter((w) => Math.abs(w.meanDevPct) > 0.05 && w.allIn).length,
  medianAbsSignedMeanPct: median(w5.map((w) => Math.abs(w.meanDevPct))),
  medianMadPct: median(w5.map((w) => w.madPct)),
  weeksWhereMadExceedsSignedBy2x: w5.filter((w) => w.madPct > 2 * Math.abs(w.meanDevPct)).length,
};

// ---- 3. Protein: does a weekly mean hide a below-floor day? ----
const wp = [];
for (const w of weeks) {
  const judged = w.days.filter((d) => d.judged);
  if (!judged.length) continue;
  const mid = judged.reduce((s, d) => s + d.target.proteinMid, 0);
  const got = judged.reduce((s, d) => s + d.achieved.protein, 0);
  wp.push({
    id: w.id, n: judged.length, meanRatio: got / mid,
    shortDays: judged.filter((d) => !d.verdict.proteinOk).length,
    worstShortPct: Math.max(...judged.map((d) => d.verdict.proteinShortPct)),
  });
}
out.proteinWeekly = {
  weeksScored: wp.length,
  weeklyMeanMeetsMidpoint: wp.filter((w) => w.meanRatio >= 1).length,
  weeklyMeanMeetsFloor085: wp.filter((w) => w.meanRatio >= 0.85).length,
  meanClearsFloorButHasShortDay: wp.filter((w) => w.meanRatio >= 0.85 && w.shortDays > 0).length,
  shortDaysHiddenUnderPassingMean: wp.filter((w) => w.meanRatio >= 0.85).reduce((s, w) => s + w.shortDays, 0),
  worstHiddenShortfallPct: +Math.max(0, ...wp.filter((w) => w.meanRatio >= 0.85 && w.shortDays > 0).map((w) => w.worstShortPct)).toFixed(4),
  medianWeeklyProteinRatio: median(wp.map((w) => w.meanRatio)),
  weeksAbove120pctOfMid: wp.filter((w) => w.meanRatio >= 1.2).length,
};

// ---- 4. E11 test: does DROPPING days raise the score? ----
const A = [0, 0], B = [0, 0], C = [0, 0];
for (const w of weeks) {
  for (const d of w.days) {
    B[1] += 1; if (d.verdict?.inBand) B[0] += 1;                        // all planned records
    if (d.judged) { A[1] += 1; if (d.verdict.inBand) A[0] += 1; }       // judged only (rig rule, A6)
    if (d.judged && d.slotsEmpty === 0) { C[1] += 1; if (d.verdict.inBand) C[0] += 1; } // complete only
  }
}
out.denominatorSensitivity = {
  allPlannedRecords: { inBand: B[0], n: B[1], pct: +(100 * B[0] / B[1]).toFixed(2) },
  judgedOnly: { inBand: A[0], n: A[1], pct: +(100 * A[0] / A[1]).toFixed(2) },
  completeDaysOnly: { inBand: C[0], n: C[1], pct: +(100 * C[0] / C[1]).toFixed(2) },
  note: "Each filter DROPS days the app served badly. Any denominator narrower than all planned days means refusing/emptying a day RAISES the score. This is the E11 trap in metric form.",
};

// ---- 5. Signed side census on the 7-day cohort ----
const sides = { kcalOver: 0, kcalUnder: 0, fatOver: 0, fatShort: 0, carbOver: 0, carbShort: 0, proteinShort: 0 };
let bad = 0, pureOver = 0, pureUnder = 0, mixed = 0;
for (const w of weeks) for (const d of w.days) {
  if (!d.judged || d.verdict.inBand) continue;
  bad += 1;
  const v = d.verdict;
  let over = 0, under = 0;
  if (!v.kcalOk) { if (v.kcalDeltaPct > 0) { sides.kcalOver++; over++; } else { sides.kcalUnder++; under++; } }
  if (!v.fatOk) { if (v.fatOverPct > 0) { sides.fatOver++; over++; } else { sides.fatShort++; under++; } }
  if (!v.carbOk) { if (v.carbOverPct > 0) { sides.carbOver++; over++; } else { sides.carbShort++; under++; } }
  if (!v.proteinOk) { sides.proteinShort++; under++; }
  if (over && !under) pureOver++; else if (under && !over) pureUnder++; else mixed++;
}
out.sideCensus7dCohort = {
  badDays: bad, pureOver, pureUnder, mixed,
  pureOverPct: bad ? +(100 * pureOver / bad).toFixed(1) : null, ...sides,
};

// ---- 6. Binomial noise of a 7-day rate (own arithmetic, not sourced) ----
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [+(100 * (c - m) / d).toFixed(1), +(100 * (c + m) / d).toFixed(1)];
}
out.wilson95 = { n7: {}, n28: {}, n90: {} };
for (let k = 0; k <= 7; k++) out.wilson95.n7[`${k}/7`] = wilson(k, 7);
for (const k of [17, 19, 21, 22, 24]) out.wilson95.n28[`${k}/28`] = wilson(k, 28);
for (const k of [63, 68, 72, 76]) out.wilson95.n90[`${k}/90`] = wilson(k, 90);

function binom(n, p) {
  const o = []; let c = 1;
  for (let k = 0; k <= n; k++) { o.push(c * p ** k * (1 - p) ** (n - k)); c = c * (n - k) / (k + 1); }
  return o;
}
const b = binom(7, 0.773);
out.sevenDayNoise = {
  trueRate: 0.773,
  pAtMost3of7: +b.slice(0, 4).reduce((a, x) => a + x, 0).toFixed(4),
  pAtMost4of7: +b.slice(0, 5).reduce((a, x) => a + x, 0).toFixed(4),
  pExactly7of7: +b[7].toFixed(4),
  pSwingOf3OrMoreBetweenTwoIndependentWeeks: (() => {
    let s = 0;
    for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) if (Math.abs(i - j) >= 3) s += b[i] * b[j];
    return +s.toFixed(4);
  })(),
  note: "A user whose TRUE in-band rate never changes from 77.3% still sees these swings. Any week-over-week narrative built on a 7-point rate is mostly narrating noise.",
};

out.minDetectableWeekOverWeek = {
  rule: "|b-c| > 1.96*sqrt(b+c)  (fleet A5)",
  maxPairedDays: 7,
  thresholdAtBPlusC7: +(1.96 * Math.sqrt(7)).toFixed(2),
  verdict: "With 7 paired days the largest possible |b-c| is 7, versus a 5.19 threshold. Only a 6-0 or 7-0 flip is detectable; every realistic week-over-week move is noise.",
};

console.log(JSON.stringify(out, null, 1));
