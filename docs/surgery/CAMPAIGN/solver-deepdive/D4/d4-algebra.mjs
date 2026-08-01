// D4 — hand-derived tolerance algebra, computed from CONSTANTS ONLY.
// Deliberately does NOT import mealSolver.js. Nothing here calls dayTolerance().
// Constants transcribed by hand from mealSolver.js:210-213 and bmrEngine.js:268-292.
import fs from "node:fs";

const K = 0.15;   // DAY_KCAL_TOLERANCE_PCT      mealSolver.js:210
const P = 0.15;   // DAY_PROTEIN_TOLERANCE_PCT   mealSolver.js:211
const F = 0.25;   // DAY_FAT_TOLERANCE_PCT       mealSolver.js:212
const C = 0.25;   // DAY_CARB_TOLERANCE_PCT      mealSolver.js:213

// Hand transcription of the RULE, not of the code:
//   hasBand(lo,hi)      = finite(lo) && finite(hi) && hi > 0
//   bandMiss(v,lo,hi)   mid=(lo+hi)/2; short=(lo-v)/mid if v<lo ; over=(v-hi)/mid if v>hi
//   fatOk               short<=F && over<=F           => v in [lo - F*mid , hi + F*mid]
//   carbOk              short<=C && over<=overAllow   => v in [lo - C*mid , hi + overAllow*mid]
//   kcalOk              |v-kcal|/kcal <= K            => v in [kcal*(1-K), kcal*(1+K)]
//   proteinOk           max(0,(pMid-v)/pMid) <= P     => v >= pMid*(1-P), no ceiling
const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;

function windows(t) {
  const pMid = (t.proteinLo + t.proteinHi) / 2;
  const out = {
    kcal: { lo: t.kcal * (1 - K), hi: t.kcal * (1 + K), mid: t.kcal, halfRel: K, judged: t.kcal > 0 },
    protein: { lo: pMid * (1 - P), hi: Infinity, mid: pMid, halfRel: null, judged: pMid > 0 },
  };
  if (hasBand(t.fatLo, t.fatHi)) {
    const mid = (t.fatLo + t.fatHi) / 2;
    const h = (t.fatHi - t.fatLo) / 2;
    out.fat = { lo: t.fatLo - F * mid, hi: t.fatHi + F * mid, mid, bandHalfRel: h / mid, halfRel: h / mid + F, judged: true };
  } else out.fat = { judged: false };
  if (hasBand(t.carbLo, t.carbHi)) {
    const mid = (t.carbLo + t.carbHi) / 2;
    const h = (t.carbHi - t.carbLo) / 2;
    const over = t.keto ? 0 : C;
    out.carb = {
      lo: t.carbLo - C * mid, hi: t.carbHi + over * mid, mid,
      bandHalfRel: h / mid, shortRel: h / mid + C, overRel: h / mid + over, judged: true,
    };
  } else out.carb = { judged: false };
  return out;
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (a) => a.length ? `n=${a.length} min=${(Math.min(...a) * 100).toFixed(2)}% p50=${(q(a, .5) * 100).toFixed(2)}% max=${(Math.max(...a) * 100).toFixed(2)}%` : "n=0";

const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const buckets = { defaultFat: [], ketoFat: [], flooredFat: [], carbShort: [], carbOver: [], ketoCarbShort: [] };
const gramWin = { fat: [], carb: [] };
let keto = 0, floored = 0, plain = 0, noFat = 0, noCarb = 0, carbLoZero = 0;

for (const r of rows) {
  const t = r.target;
  if (!t) continue;
  const w = windows(t);
  if (!w.fat.judged) { noFat++; } else {
    // classify path: keto flag, else detect the carb-floored branch by fat band ratio.
    // default path: fatHi/fatLo = round(.40L)/round(.34L) ~ 1.176
    // keto+floored: round(mid*1.12)/round(mid*0.9)      ~ 1.244
    const ratio = t.fatHi / t.fatLo;
    if (t.keto) { keto++; buckets.ketoFat.push(w.fat.halfRel); }
    else if (ratio > 1.21) { floored++; buckets.flooredFat.push(w.fat.halfRel); }
    else { plain++; buckets.defaultFat.push(w.fat.halfRel); }
    gramWin.fat.push([w.fat.lo, w.fat.hi]);
  }
  if (!w.carb.judged) noCarb++; else {
    if (t.carbLo === 0) carbLoZero++;
    if (t.keto) buckets.ketoCarbShort.push(w.carb.shortRel);
    else { buckets.carbShort.push(w.carb.shortRel); buckets.carbOver.push(w.carb.overRel); }
    gramWin.carb.push([w.carb.lo, w.carb.hi]);
  }
}

console.log("== personas ==", rows.length, "| fat bands: plain", plain, "keto", keto, "carb-floored", floored, "| noFat", noFat, "noCarb", noCarb, "| carbLo==0:", carbLoZero);
console.log("FAT effective half-width, DEFAULT path :", fmt(buckets.defaultFat));
console.log("FAT effective half-width, KETO path    :", fmt(buckets.ketoFat));
console.log("FAT effective half-width, CARBFLOOR    :", fmt(buckets.flooredFat));
console.log("CARB short half-width, non-keto        :", fmt(buckets.carbShort));
console.log("CARB over  half-width, non-keto        :", fmt(buckets.carbOver));
console.log("CARB short half-width, keto (over = 0) :", fmt(buckets.ketoCarbShort));

// Symbolic checks, no data needed.
console.log("\n== symbolic (exact, no rounding) ==");
const symDefault = (0.40 - 0.34) / 2 / ((0.40 + 0.34) / 2);
console.log("default fat band half-width  h/mid = (0.40-0.34)/2 / 0.37 =", symDefault.toFixed(6), `(${(symDefault * 100).toFixed(2)}%)`);
console.log("default fat EFFECTIVE gate   E = h/mid + 0.25 =", (symDefault + F).toFixed(6), `(${((symDefault + F) * 100).toFixed(2)}%)`);
console.log("  -> pass window in g:", (0.37 * (1 - symDefault - F)).toFixed(4), "* lbm  ..", (0.37 * (1 + symDefault + F)).toFixed(4), "* lbm");
const symKeto = (1.12 - 0.9) / 2 / ((1.12 + 0.9) / 2);
console.log("keto/floored band half-width h/mid = (1.12-0.9)/2 / 1.01 =", symKeto.toFixed(6), `(${(symKeto * 100).toFixed(2)}%)`);
console.log("keto/floored EFFECTIVE gate  E =", (symKeto + F).toFixed(6), `(${((symKeto + F) * 100).toFixed(2)}%)`);
console.log("  -> graded centre is 1.01x the PRESCRIBED fatMid; window vs prescribed fatMid:",
  (1.01 * (1 - symKeto - F)).toFixed(4), "..", (1.01 * (1 + symKeto + F)).toFixed(4));
console.log("keto carbs: band [10,30] mid 20, over-allowance 0 -> pass [", 10 - C * 20, ",", 30, "] g; prescribed carbMid = 25");
console.log("protein: pass v >= 0.85*pMid = 0.85*1.195*lbm =", (0.85 * (1.14 + 1.25) / 2).toFixed(4), "* lbm ; proteinLo displayed = 1.14 * lbm");
console.log("kcal: pass |d| <= 15% of target, symmetric, no band involved");
