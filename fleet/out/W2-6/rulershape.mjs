// W2-6 · CONTRARIAN measurement: what SHAPE is the fat ruler, in %E terms, on the
// real 250-persona fleet? Read-only. No product source touched.
//
// Computes, per persona:
//   - the graded fat window (fatLo - 0.25*fatMid, fatHi + 0.25*fatMid) as %E of targetKcal
//   - the graded carb floor vs the engine's own NONKETO_CARB_FLOOR_G = 50
//   - the IMPLICIT fat ceiling that a floor-ruler would leave standing:
//       9*F <= kcalHi - 4*proteinFloorGraded - 4*carbFloorGraded
//     i.e. what fat %E a day could reach if the explicit fat ceiling were removed
//     and only kcal(+15%) + protein floor + carb floor bound it.
//   - the same with the carb floor REPAIRED to the engine's own 50 g / carbLo.
//
// Usage: node fleet/out/W2-6/rulershape.mjs   (from backend/ or repo root)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(process.cwd().endsWith("backend") ? ".." : ".");
const eng = require(path.join(ROOT, "backend/src/lib/bmrEngine.js"));

const PERSONAS = path.join(
  ROOT,
  "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl",
);
const rows = fs
  .readFileSync(PERSONAS, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l));

// Tolerance algebra per BRIEF-CLAIMS D3 (hand-derived, differential-tested, 0 disagreements)
const KCAL_TOL = 0.15;
const PROT_TOL = 0.15;
const FAT_EXT = 0.25;
const CARB_EXT = 0.25;

const pct = (a) => (a * 100).toFixed(1);
const q = (arr, p) => {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

const out = [];
let skipped = 0;
for (const r of rows) {
  const p = r.profile;
  let energy;
  try {
    energy = eng.computeEnergy(p, p.startWeightKg);
  } catch {
    skipped++;
    continue;
  }
  const tdee = energy?.tdee ?? energy?.TDEE;
  const rmr = energy?.rmr ?? energy?.bmr ?? energy?.bmrMean;
  if (!(tdee > 0)) {
    skipped++;
    continue;
  }
  const t = eng.deriveTarget(p, tdee, rmr);
  const kcal = t.target ?? t.targetKcal;
  const m = eng.computeMacros(p, p.startWeightKg, kcal);
  if (!(kcal > 0) || !(m.fatLo > 0)) {
    skipped++;
    continue;
  }

  const fatMid = (m.fatLo + m.fatHi) / 2;
  const gFatLo = m.fatLo - FAT_EXT * fatMid;
  const gFatHi = m.fatHi + FAT_EXT * fatMid;

  const pMid = (m.proteinLo + m.proteinHi) / 2;
  const gProtFloor = 0.85 * pMid;

  const carbMid = m.carbMid;
  const carbLo = m.carbLo;
  const A = m.keto ? 0 : CARB_EXT;
  const gCarbFloor = Math.max(0, carbLo - CARB_EXT * carbMid);

  const kcalHi = kcal * (1 + KCAL_TOL);

  // Implicit fat ceiling under a floor ruler, using the ruler AS GRADED TODAY
  const implicitAsGraded = (kcalHi - 4 * gProtFloor - 4 * gCarbFloor) / 9;
  // ...and with the carb floor repaired to the engine's own intent (carbLo, and
  // never below NONKETO_CARB_FLOOR_G=50 for non-keto)
  const repairedCarbFloor = m.keto ? gCarbFloor : Math.max(carbLo, 50);
  const implicitRepaired = (kcalHi - 4 * gProtFloor - 4 * repairedCarbFloor) / 9;

  out.push({
    id: r.id,
    diet: p.dietaryStyle,
    keto: !!m.keto,
    bfAssumed: !!m.bfAssumed,
    carbFloored: !!m.carbFloored,
    kcal,
    lbmLb: Math.round(m.lbmLb * 10) / 10,
    fatLo: m.fatLo,
    fatHi: m.fatHi,
    gFatLoE: (gFatLo * 9) / kcal,
    gFatHiE: (gFatHi * 9) / kcal,
    gFatLoPerLb: gFatLo / m.lbmLb,
    gFatHiPerLb: gFatHi / m.lbmLb,
    gCarbFloor,
    carbLo,
    carbMid,
    implicitAsGradedE: (implicitAsGraded * 9) / kcalHi,
    implicitRepairedE: (implicitRepaired * 9) / kcalHi,
    implicitAsGradedG: implicitAsGraded,
    implicitRepairedG: implicitRepaired,
    ratioImplicitToExplicit: implicitAsGraded / gFatHi,
  });
}

const nonketo = out.filter((r) => !r.keto);
const rep = {
  n: out.length,
  skipped,
  nonketo: nonketo.length,
  keto: out.length - nonketo.length,
  gradedFatWindowE: {
    lo_p50: q(out.map((r) => r.gFatLoE), 0.5),
    hi_p50: q(out.map((r) => r.gFatHiE), 0.5),
    lo_p05: q(out.map((r) => r.gFatLoE), 0.05),
    hi_p95: q(out.map((r) => r.gFatHiE), 0.95),
  },
  gradedFatFloorPerLbLbm_p50: q(out.map((r) => r.gFatLoPerLb), 0.5),
  belowEssentialFatFloor_count: out.filter((r) => r.gFatLoPerLb < 0.3).length,
  // Helms 15-30 %E  ·  AMDR 20-35 %E
  gradedHiBelowAmdrHi: out.filter((r) => r.gFatHiE < 0.35).length,
  gradedHiBelowHelmsHi: out.filter((r) => r.gFatHiE < 0.3).length,
  gradedLoBelowAmdrLo: out.filter((r) => r.gFatLoE < 0.2).length,
  gradedLoBelowHelmsLo: out.filter((r) => r.gFatLoE < 0.15).length,
  carbFloorGap: {
    graded_p50: q(nonketo.map((r) => r.gCarbFloor), 0.5),
    carbLo_p50: q(nonketo.map((r) => r.carbLo), 0.5),
    nonketo_graded_below_50g: nonketo.filter((r) => r.gCarbFloor < 50).length,
  },
  implicitCeilingAsGraded_E: {
    p50: q(out.map((r) => r.implicitAsGradedE), 0.5),
    p05: q(out.map((r) => r.implicitAsGradedE), 0.05),
    p95: q(out.map((r) => r.implicitAsGradedE), 0.95),
  },
  implicitCeilingRepaired_E: {
    p50: q(out.map((r) => r.implicitRepairedE), 0.5),
    p05: q(out.map((r) => r.implicitRepairedE), 0.05),
    p95: q(out.map((r) => r.implicitRepairedE), 0.95),
  },
  implicitOverExplicitRatio_p50: q(out.map((r) => r.ratioImplicitToExplicit), 0.5),
  implicitAsGraded_above_AMDR35: out.filter((r) => r.implicitAsGradedE > 0.35).length,
  implicitRepaired_above_AMDR35: out.filter((r) => r.implicitRepairedE > 0.35).length,
  // symmetric +/-50% widening keeps a ceiling at fatHi + 0.5*fatMid
  fiftyPctWidenCeilingPerLb_p50: q(
    out.map((r) => (r.fatHi + 0.5 * ((r.fatLo + r.fatHi) / 2)) / r.lbmLb),
    0.5,
  ),
};

console.log(JSON.stringify(rep, null, 2));
fs.writeFileSync(
  path.join(ROOT, "fleet/out/W2-6/rulershape.json"),
  JSON.stringify({ summary: rep, rows: out }, null, 2),
);
console.error(`wrote fleet/out/W2-6/rulershape.json (${out.length} personas, ${skipped} skipped)`);
