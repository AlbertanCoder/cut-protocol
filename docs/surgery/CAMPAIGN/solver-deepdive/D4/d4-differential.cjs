// D4 — DIFFERENTIAL test. The hand-derived rule (d4-algebra.mjs, constants only)
// is the AUTHORITY. This file loads the real dayTolerance() and looks for any day
// where the two disagree. Agreement = my reading of the code is correct.
// Disagreement = one of us is wrong and the report must say which.
// This is NOT "compute dayTolerance and compare it to itself" — the predicate below
// never calls into mealSolver.
const fs = require("node:fs");
const path = require("node:path");
const SOLVER = path.resolve("C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/mealSolver.js");
const { dayTolerance, dayInTolerance } = require(SOLVER);

const K = 0.15, P = 0.15, F = 0.25, C = 0.25;
const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;

// HAND rule — window form, written from the algebra, not from the code shape.
function handVerdict(t, tot) {
  const pMid = (t.proteinLo + t.proteinHi) / 2;
  const kcalOk = t.kcal > 0 ? Math.abs(tot.kcal - t.kcal) <= K * t.kcal : false;
  const proteinOk = pMid > 0 ? tot.protein >= (1 - P) * pMid : true;
  let fatOk = true;
  if (hasBand(t.fatLo, t.fatHi)) {
    const mid = (t.fatLo + t.fatHi) / 2;
    fatOk = mid > 0 ? tot.fat >= t.fatLo - F * mid && tot.fat <= t.fatHi + F * mid : true;
  }
  let carbOk = true;
  if (hasBand(t.carbLo, t.carbHi)) {
    const mid = (t.carbLo + t.carbHi) / 2;
    const over = t.keto ? 0 : C;
    carbOk = mid > 0 ? tot.carb >= t.carbLo - C * mid && tot.carb <= t.carbHi + over * mid : true;
  }
  return { kcalOk, proteinOk, fatOk, carbOk, all: kcalOk && proteinOk && fatOk && carbOk };
}

const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
let n = 0, dis = 0; const examples = [];
// 1) every REAL day the fleet produced
for (const r of rows) {
  const t = r.target; if (!t) continue;
  for (const d of r.primary?.mine?.days || []) {
    const tot = { kcal: d.kcal, protein: d.protein, fat: d.fat, carb: d.carb };
    const h = handVerdict(t, tot);
    const impl = dayTolerance(t, tot);
    const i = { kcalOk: impl.kcalOk, proteinOk: impl.proteinOk, fatOk: impl.fatOk, carbOk: impl.carbOk, all: dayInTolerance(impl) };
    n++;
    for (const k of ["kcalOk", "proteinOk", "fatOk", "carbOk", "all"]) {
      if (h[k] !== i[k]) { dis++; if (examples.length < 8) examples.push({ id: r.id, k, hand: h[k], impl: i[k], tot, t }); break; }
    }
  }
}
console.log(`REAL DAYS: ${n} judged, ${dis} disagreement(s) between hand rule and dayTolerance()`);

// 2) adversarial sweep — walk each macro across its whole boundary region
let n2 = 0, dis2 = 0;
const rng = (() => { let s = 424242; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
for (const r of rows) {
  const t = r.target; if (!t) continue;
  for (let i = 0; i < 400; i++) {
    const tot = {
      kcal: t.kcal * (0.5 + rng() * 1.2),
      protein: ((t.proteinLo + t.proteinHi) / 2) * (0.5 + rng() * 1.2),
      fat: ((t.fatLo + t.fatHi) / 2) * (rng() * 2.5),
      carb: ((t.carbLo + t.carbHi) / 2) * (rng() * 2.5),
    };
    const h = handVerdict(t, tot);
    const impl = dayTolerance(t, tot);
    const iv = { kcalOk: impl.kcalOk, proteinOk: impl.proteinOk, fatOk: impl.fatOk, carbOk: impl.carbOk, all: dayInTolerance(impl) };
    n2++;
    for (const k of ["kcalOk", "proteinOk", "fatOk", "carbOk", "all"]) {
      if (h[k] !== iv[k]) { dis2++; if (examples.length < 8) examples.push({ id: r.id, k, hand: h[k], impl: iv[k], tot, t }); break; }
    }
  }
}
console.log(`SYNTHETIC: ${n2} judged, ${dis2} disagreement(s)`);

// 3) degenerate-band probes the real data never reaches
const probes = [
  { name: "carbLo=0 carbHi=12 (carb-floored to 0)", t: { kcal: 2000, proteinLo: 150, proteinHi: 165, fatLo: 60, fatHi: 70, carbLo: 0, carbHi: 12, keto: false }, tots: [{ kcal: 2000, protein: 160, fat: 65, carb: 0 }, { kcal: 2000, protein: 160, fat: 65, carb: 15 }, { kcal: 2000, protein: 160, fat: 65, carb: 16 }] },
  { name: "no fat band at all", t: { kcal: 2000, proteinLo: 150, proteinHi: 165, fatLo: null, fatHi: null, carbLo: 100, carbHi: 124, keto: false }, tots: [{ kcal: 2000, protein: 160, fat: 999, carb: 110 }] },
  { name: "keto carbs", t: { kcal: 2000, proteinLo: 150, proteinHi: 165, fatLo: 140, fatHi: 175, carbLo: 10, carbHi: 30, keto: true }, tots: [{ kcal: 2000, protein: 160, fat: 150, carb: 4.9 }, { kcal: 2000, protein: 160, fat: 150, carb: 5.1 }, { kcal: 2000, protein: 160, fat: 150, carb: 30.1 }] },
  { name: "fatHi = 0 (hasBand false)", t: { kcal: 2000, proteinLo: 150, proteinHi: 165, fatLo: 0, fatHi: 0, carbLo: 100, carbHi: 124, keto: false }, tots: [{ kcal: 2000, protein: 160, fat: 500, carb: 110 }] },
];
let dis3 = 0, n3 = 0;
for (const p of probes) for (const tot of p.tots) {
  const h = handVerdict(p.t, tot); const impl = dayTolerance(p.t, tot);
  const iv = { kcalOk: impl.kcalOk, proteinOk: impl.proteinOk, fatOk: impl.fatOk, carbOk: impl.carbOk, all: dayInTolerance(impl) };
  n3++;
  const bad = ["kcalOk", "proteinOk", "fatOk", "carbOk", "all"].filter((k) => h[k] !== iv[k]);
  if (bad.length) { dis3++; console.log("  PROBE DISAGREE", p.name, JSON.stringify(tot), bad, "hand", h, "impl", iv); }
  else console.log(`  probe ok: ${p.name} carb=${tot.carb} fat=${tot.fat} -> all=${iv.all}`);
}
console.log(`PROBES: ${n3} judged, ${dis3} disagreement(s)`);
if (examples.length) console.log("EXAMPLES:", JSON.stringify(examples, null, 1));
