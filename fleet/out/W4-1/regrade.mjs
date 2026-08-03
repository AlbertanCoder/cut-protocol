// regrade.mjs — W4-1 (reproduce). DECOMPOSE the uncommitted fat rewrite.
//
//   node fleet/out/W4-1/regrade.mjs --old=<armP.jsonl> --new=<armF.jsonl> [--json=out.json]
//
// The fat rewrite changes computeMacros, which is BOTH:
//   (1) the ruler   — dayTolerance grades achieved macros against fatLo/fatHi
//                     and carbLo/carbHi, all four of which move; and
//   (2) the aim     — the solver receives the same object as its target, so it
//                     searches for different food.
// A full re-run confounds the two. This file separates them by grading the OLD
// run's ACHIEVED macros (identical plates, identical food) against the NEW
// targets. No re-solve. The three arms are then:
//
//   armP            old target, old plates      = baseline
//   REGRADE         NEW target, OLD plates      = pure RULER effect
//   armF            new target, new plates      = total effect
//   armF - REGRADE                              = the solver's response
//
// The grading function is imported from the PRODUCT (mealSolver.dayInTolerance /
// dayTolerance) — not transcribed — so the ruler here is the shipping ruler by
// construction. Verified on every record: re-grading the OLD plates against the
// OLD targets must reproduce the stored verdict exactly, or the run is void.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));

const require_ = createRequire(import.meta.url);
const solver = require_(path.join(REPO, "backend/src/lib/mealSolver.js"));

const read = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const key = (r) => `${r.personaId}#${r.dayIndex}`;

const OLD = read(path.resolve(String(argv.old)));
const NEW = read(path.resolve(String(argv.new)));
const newByPersona = new Map();
for (const r of NEW) if (!newByPersona.has(r.personaId)) newByPersona.set(r.personaId, r.target);
const newByKey = new Map(NEW.map((r) => [key(r), r]));

// ── integrity: the new targets must differ ONLY in fat/carb ────────────────
let kcalMoved = 0, proteinMoved = 0, ketoMoved = 0, fatMoved = 0, carbMoved = 0;
for (const r of OLD) {
  const nt = newByPersona.get(r.personaId); if (!nt) continue;
  const ot = r.target;
  if (ot.kcal !== nt.kcal) kcalMoved++;
  if (ot.proteinLo !== nt.proteinLo || ot.proteinHi !== nt.proteinHi) proteinMoved++;
  if (!!ot.keto !== !!nt.keto) ketoMoved++;
  if (ot.fatLo !== nt.fatLo || ot.fatHi !== nt.fatHi) fatMoved++;
  if (ot.carbLo !== nt.carbLo || ot.carbHi !== nt.carbHi) carbMoved++;
}

// ── control: re-grading OLD plates on OLD targets must match stored ────────
let controlMismatch = 0;
for (const r of OLD) {
  if (!r.judged) continue;
  const t = solver.dayTolerance(r.target, r.achieved);
  if (solver.dayInTolerance(t) !== !!r.verdict?.inBand) controlMismatch++;
}

// ── the three arms ─────────────────────────────────────────────────────────
const inBandOldPlatesNewTarget = new Map();
for (const r of OLD) {
  const nt = newByPersona.get(r.personaId);
  if (!nt || !r.judged) { inBandOldPlatesNewTarget.set(key(r), false); continue; }
  const t = solver.dayTolerance(nt, r.achieved);
  inBandOldPlatesNewTarget.set(key(r), solver.dayInTolerance(t));
}

function tally(rows, verdictFn) {
  const sel = { planned: () => true, plannedMinusDegen: (r) => r.slotsTotal > 0, judged: (r) => r.judged, satPlanned: (r) => r.satisfiable, satPlannedMinusDegen: (r) => r.satisfiable && r.slotsTotal > 0, satJudged: (r) => r.satisfiable && r.judged };
  const o = {};
  for (const [name, f] of Object.entries(sel)) { const rs = rows.filter(f); o[name] = { n: rs.length, k: rs.filter(verdictFn).length }; }
  return o;
}
const armP = tally(OLD, (r) => !!r.verdict?.inBand);
const regrade = tally(OLD, (r) => inBandOldPlatesNewTarget.get(key(r)));
const armF = tally(NEW, (r) => !!r.verdict?.inBand);

// paired 2x2 for each step, on the canonical denominator
function mcnemar(rows, fa, fb) {
  let b = 0, c = 0, bb = 0, ff = 0;
  for (const r of rows) { const a = fa(r), z = fb(r); if (a && z) bb++; else if (!a && !z) ff++; else if (a) b++; else c++; }
  return { bothPass: bb, bothFail: ff, b, c, net: c - b, a5: Math.round(1.96 * Math.sqrt(b + c) * 100) / 100, clears: Math.abs(b - c) > 1.96 * Math.sqrt(b + c) };
}
const canon = OLD.filter((r) => r.satisfiable && r.slotsTotal > 0);
const stepRuler = mcnemar(canon, (r) => !!r.verdict?.inBand, (r) => inBandOldPlatesNewTarget.get(key(r)));
const stepTotal = mcnemar(canon, (r) => !!r.verdict?.inBand, (r) => !!newByKey.get(key(r))?.verdict?.inBand);

// ── WHY days flip: which macro term moved them ─────────────────────────────
const why = { rescuedByFat: 0, rescuedByCarb: 0, rescuedByBoth: 0, lostByFat: 0, lostByCarb: 0, lostByBoth: 0 };
for (const r of canon) {
  const was = !!r.verdict?.inBand, now = inBandOldPlatesNewTarget.get(key(r));
  if (was === now) continue;
  const ot = solver.dayTolerance(r.target, r.achieved);
  const nt = solver.dayTolerance(newByPersona.get(r.personaId), r.achieved);
  const fatChanged = ot.fatOk !== nt.fatOk, carbChanged = ot.carbOk !== nt.carbOk;
  const bucket = fatChanged && carbChanged ? "Both" : fatChanged ? "Fat" : "Carb";
  why[(now ? "rescuedBy" : "lostBy") + bucket]++;
}

const pctOf = (o) => (o.n ? (o.k / o.n) * 100 : null);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const out = {
  old: String(argv.old), new: String(argv.new),
  integrity: { kcalMoved, proteinMoved, ketoMoved, fatMoved, carbMoved, controlMismatch, records: OLD.length },
  arms: { armP, regrade, armF },
  levels: Object.fromEntries(Object.keys(armP).map((k) => [k, { n: armP[k].n, armP: r2(pctOf(armP[k])), regrade: r2(pctOf(regrade[k])), armF: r2(pctOf(armF[k])), rulerOnly: r2(pctOf(regrade[k]) - pctOf(armP[k])), solverResponse: r2(pctOf(armF[k]) - pctOf(regrade[k])), total: r2(pctOf(armF[k]) - pctOf(armP[k])) }])),
  paired: { rulerStep: stepRuler, totalStep: stepTotal },
  flipCause: why,
};

console.log(`\nINTEGRITY  kcal moved ${kcalMoved} · protein moved ${proteinMoved} · keto flag moved ${ketoMoved}  (all must be 0)`);
console.log(`           fat band moved ${fatMoved}/${OLD.length} · carb band moved ${carbMoved}/${OLD.length}`);
console.log(`CONTROL    re-grade of OLD plates on OLD targets vs stored verdict: ${controlMismatch} mismatches (must be 0)\n`);
console.log(`denominator                  n     armP    REGRADE     armF   | ruler-only  solver   TOTAL`);
for (const [k, v] of Object.entries(out.levels)) {
  console.log(`  ${k.padEnd(22)}${String(v.n).padStart(5)}  ${String(v.armP).padStart(6)}%  ${String(v.regrade).padStart(6)}%  ${String(v.armF).padStart(6)}%   ${String((v.rulerOnly >= 0 ? "+" : "") + v.rulerOnly).padStart(7)}  ${String((v.solverResponse >= 0 ? "+" : "") + v.solverResponse).padStart(6)}  ${String((v.total >= 0 ? "+" : "") + v.total).padStart(6)}`);
}
console.log(`\nPAIRED on canonical n=${canon.length}`);
console.log(`  ruler step (old plates)  b=${stepRuler.b} c=${stepRuler.c} net=${stepRuler.net} |b-c|=${Math.abs(stepRuler.b - stepRuler.c)} vs A5 ${stepRuler.a5} => ${stepRuler.clears ? "CLEARS" : "does NOT clear"}`);
console.log(`  total step (re-solved)   b=${stepTotal.b} c=${stepTotal.c} net=${stepTotal.net} |b-c|=${Math.abs(stepTotal.b - stepTotal.c)} vs A5 ${stepTotal.a5} => ${stepTotal.clears ? "CLEARS" : "does NOT clear"}`);
console.log(`\nFLIP CAUSE (ruler step): rescued fat ${why.rescuedByFat} · carb ${why.rescuedByCarb} · both ${why.rescuedByBoth}  ||  lost fat ${why.lostByFat} · carb ${why.lostByCarb} · both ${why.lostByBoth}`);
if (argv.json) { fs.writeFileSync(path.resolve(String(argv.json)), JSON.stringify(out, null, 2)); console.log(`\njson -> ${argv.json}`); }
