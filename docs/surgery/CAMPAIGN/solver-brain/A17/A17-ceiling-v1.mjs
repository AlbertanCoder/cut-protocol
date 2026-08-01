// A17-ceiling-v1.mjs — the add-only ceiling, computed from a rig JSONL.
//
// C9/A9: macroCloser can only ADD. Adding food raises kcal, protein, fat and carb
// monotonically. So a missed day whose failure is an OVER-ceiling failure is
// unreachable by ANY add-only mechanism, no matter how wide its gate. This script
// counts how many currently-missed days are reachable-in-principle, which caps
// everything A17 can measure.
//
// Tier A (structural): no OVER failure on any graded macro.
// Tier B (thermodynamic): Tier A, and the kcal cost of closing every shortfall
//   with an idealised nutrient (protein/carb at 4 kcal/g, fat at 9 kcal/g — no
//   real food beats this) still fits under the +15% kcal ceiling.
// Tier C (product-shaped): Tier B, and the shortfalls fit inside the closer's
//   MAX_GRAMS caps using the densest of the ten shipped candidates.
//
//   node A17-ceiling-v1.mjs <baseline.jsonl>
import fs from "node:fs";

const F = process.argv[2];
const rows = fs.readFileSync(F, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const TOLK = 0.15, TOLP = 0.15, TOLF = 0.25, TOLC = 0.25;
const fin = Number.isFinite;

function grade(t, a) {
  const pMid = (t.proteinLo + t.proteinHi) / 2;
  const fMid = fin(t.fatLo) && fin(t.fatHi) ? (t.fatLo + t.fatHi) / 2 : NaN;
  const cMid = fin(t.carbLo) && fin(t.carbHi) ? (t.carbLo + t.carbHi) / 2 : NaN;
  const kDelta = t.kcal > 0 ? (a.kcal - t.kcal) / t.kcal : 0;
  const pShort = pMid > 0 ? Math.max(0, pMid - a.protein) / pMid : 0;
  const band = (v, lo, hi, mid) => {
    if (!(mid > 0)) return { s: 0, o: 0, judged: false, mid };
    if (v < lo) return { s: (lo - v) / mid, o: 0, judged: true, mid };
    if (v > hi) return { s: 0, o: (v - hi) / mid, judged: true, mid };
    return { s: 0, o: 0, judged: true, mid };
  };
  const fat = band(a.fat, t.fatLo, t.fatHi, fMid);
  const carb = band(a.carb, t.carbLo, t.carbHi, cMid);
  const carbOverAllow = t.keto ? 0 : TOLC;
  return {
    kMid: t.kcal, pMid, fMid, cMid, kDelta, pShort, fat, carb,
    kcalOk: Math.abs(kDelta) <= TOLK,
    proteinOk: pShort <= TOLP,
    fatOk: !fat.judged || (fat.s <= TOLF && fat.o <= TOLF),
    carbOk: !carb.judged || (carb.s <= TOLC && carb.o <= carbOverAllow),
  };
}

// densest of the ten shipped adjusters, g of macro per kcal (product MAX_GRAMS caps)
const CAP = { fat: 25, carb: 160, protein: 180 };

let judged = 0, sat = 0, satMiss = 0, mismatch = 0;
const blocked = { kcalOver: 0, fatOver: 0, carbOver: 0, ketoCarb: 0 };
const failMacro = { kcalUnder: 0, kcalOver: 0, protein: 0, fatShort: 0, fatOver: 0, carbShort: 0, carbOver: 0 };
let tierA = 0, tierB = 0, tierC = 0;
const byStyle = new Map();

for (const r of rows) {
  if (!r.judged) continue;
  judged++;
  const g = grade(r.target, r.achieved);
  const mine = g.kcalOk && g.proteinOk && g.fatOk && g.carbOk;
  if (mine !== r.verdict.inBand) mismatch++;
  if (r.satisfiable === false) continue;
  sat++;
  if (r.verdict.inBand) continue;
  satMiss++;

  if (!g.kcalOk && g.kDelta < 0) failMacro.kcalUnder++;
  if (!g.kcalOk && g.kDelta > 0) failMacro.kcalOver++;
  if (!g.proteinOk) failMacro.protein++;
  if (!g.fatOk && g.fat.s > 0) failMacro.fatShort++;
  if (!g.fatOk && g.fat.o > 0) failMacro.fatOver++;
  if (!g.carbOk && g.carb.s > 0) failMacro.carbShort++;
  if (!g.carbOk && g.carb.o > 0) failMacro.carbOver++;

  const overBlocked = [];
  if (!g.kcalOk && g.kDelta > 0) { blocked.kcalOver++; overBlocked.push("kcalOver"); }
  if (!g.fatOk && g.fat.o > 0) { blocked.fatOver++; overBlocked.push("fatOver"); }
  if (!g.carbOk && g.carb.o > 0) { blocked.carbOver++; overBlocked.push(r.target.keto ? "ketoCarb" : "carbOver"); }
  if (r.target.keto && !g.carbOk && g.carb.o > 0) blocked.ketoCarb++;

  const style = r.dietStyle || "none";
  if (!byStyle.has(style)) byStyle.set(style, { miss: 0, A: 0, B: 0, C: 0 });
  const st = byStyle.get(style);
  st.miss++;

  if (overBlocked.length) continue;
  tierA++; st.A++;

  // shortfalls needed to pass
  const dK = Math.max(0, g.kMid * (1 - TOLK) - r.achieved.kcal);
  const dP = Math.max(0, g.pMid * (1 - TOLP) - r.achieved.protein);
  const dF = g.fat.judged ? Math.max(0, (r.target.fatLo - TOLF * g.fMid) - r.achieved.fat) : 0;
  const dC = g.carb.judged ? Math.max(0, (r.target.carbLo - TOLC * g.cMid) - r.achieved.carb) : 0;
  const minKcal = Math.max(dK, 4 * dP + 4 * dC + 9 * dF);
  const headroom = g.kMid * (1 + TOLK) - r.achieved.kcal;
  if (minKcal > headroom) continue;
  tierB++; st.B++;

  // product-shaped: the shortfall has to fit under MAX_GRAMS at a real density.
  // Most generous real densities among the ten shipped rows: chicken breast
  // ~0.31 g protein/g, white rice ~0.28 g carb/g, olive oil 1.0 g fat/g.
  const okP = dP <= CAP.protein * 0.31;
  const okC = dC <= CAP.carb * 0.28;
  const okF = dF <= CAP.fat * 1.0;
  if (okP && okC && okF) { tierC++; st.C++; }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");
console.log(`file ${F}`);
console.log(`judged ${judged} · satisfiable-judged ${sat} · satisfiable misses ${satMiss}`);
console.log(`INSTRUMENT: my grade vs rig verdict mismatches = ${mismatch}  (must be 0)`);
console.log("");
console.log("failing macro among satisfiable misses (a day can fail on several):");
console.table(failMacro);
console.log("OVER-failures — unreachable by ANY add-only mechanism:");
console.table(blocked);
console.log("");
console.log(`ADD-ONLY CEILING on ${satMiss} satisfiable misses:`);
console.log(`  Tier A structural   ${tierA}  (${pct(tierA, satMiss)}% of misses)`);
console.log(`  Tier B thermodynamic ${tierB}  (${pct(tierB, satMiss)}% of misses)`);
console.log(`  Tier C product-shaped ${tierC}  (${pct(tierC, satMiss)}% of misses)`);
console.log(`  => max reachable satisfiable-only rate: A ${pct(sat - satMiss + tierA, sat)}%  B ${pct(sat - satMiss + tierB, sat)}%  C ${pct(sat - satMiss + tierC, sat)}%   (from ${pct(sat - satMiss, sat)}%)`);
console.log("");
console.log("by diet style (satisfiable misses):");
console.table(Object.fromEntries([...byStyle.entries()].sort((a, b) => b[1].miss - a[1].miss).map(([k, v]) => [k, v])));
