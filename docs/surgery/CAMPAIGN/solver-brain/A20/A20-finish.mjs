// A20 — finishing pass. Pure arithmetic over artifacts already on disk.
// Answers the four things the predicate eval left open:
//   (1) how much NON-CIRCULAR falsification evidence backs "FR = 0"
//   (2) what the refusal path costs / buys on KPI-1 (the laundering test)
//   (3) the A7 counterfactual margins — is the refusal permanent or a stock claim
//   (4) the exact-binomial bound on precision if you refuse to trust the proof
// Read-only. No DB, no solve, no port.
import fs from "node:fs";

const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/";
const QA = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/";
const jsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const cls = json(SB + "A3/A3-classification.json");
const clsById = new Map(cls.map((r) => [r.id, r]));
const evalJ = json(SB + "A20/A20-predicate-eval.json");
const labels = jsonl(SB + "A20/A20-day-labels.jsonl");
const results = jsonl(QA + "results.jsonl");
const E = Object.fromEntries(evalJ.evals.map((e) => [e.pred, e]));

const REFUSED = new Set(E.P4_scaledBound.trIds); // 16 personas the sound predicate refuses

// ---- (1) NON-CIRCULAR FALSIFICATION -------------------------------------
// P4's precision against a ground truth built from the same bound is a
// tautology. The only independent evidence is the certificate side: every
// time any instrument SOLVED one of these personas, did it ever land in band?
const RIG = [
  ["rig-baseline-s424242", SB + "A1/A1-baseline-s424242.jsonl"],
  ["rig-baseline-s20260730", SB + "A1/A1-baseline-s20260730.jsonl"],
  ["rig-baseline-s8675309", SB + "A1/A1-baseline-s8675309.jsonl"],
  ["rig-noop-s424242", SB + "A1/A1-noop-s424242.jsonl"],
  ["rig-poscontrol-s424242", SB + "A1/A1-poscontrol-s424242.jsonl"],
];
let attempts = 0, inband = 0;
const perRun = {};
for (const r of results) {
  if (!REFUSED.has(r.id)) continue;
  const days = r?.primary?.mine?.days ?? [];
  attempts += days.length;
  const n = days.filter((d) => d.inTolerance).length;
  inband += n;
  perRun["fleet-http"] = (perRun["fleet-http"] ?? 0) + days.length;
}
for (const [label, path] of RIG) {
  if (!fs.existsSync(path)) { console.error("MISSING " + path); continue; }
  for (const d of jsonl(path)) {
    if (!REFUSED.has(d.personaId) || !d.judged) continue;
    attempts++; perRun[label] = (perRun[label] ?? 0) + 1;
    if (d.verdict?.inBand) inband++;
  }
}
console.log("=== (1) NON-CIRCULAR FALSIFICATION ===");
console.log(`refused personas: ${REFUSED.size}`);
console.log(`day-instances SOLVED for them across 2 instruments / 6 runs: ${attempts}`);
console.log(`of which landed in band: ${inband}   (any >0 refutes the refusal)`);
console.log("per run:", JSON.stringify(perRun));

// exact one-sided 95% upper bound on the false-refusal rate, from the sample alone
const n52 = E.P4_scaledBound.refusedDays;
const upper = 1 - Math.pow(0.05, 1 / n52);
const upperAll = 1 - Math.pow(0.05, 1 / attempts);
console.log(`\n=== (4) BINOMIAL BOUND (if you distrust the proof) ===`);
console.log(`0 FR in ${n52} refused days  -> 95% one-sided upper bound on FR rate = ${(100*upper).toFixed(2)} %`);
console.log(`0 in-band in ${attempts} solved instances -> upper bound = ${(100*upperAll).toFixed(2)} %`);

// ---- (2) THE LAUNDERING TEST --------------------------------------------
// A8 gaming guard #1: every refused day leaves KPI-1's denominator.
console.log("\n=== (2) LAUNDERING TEST — what each predicate buys on KPI-1 ===");
console.log("pred\trefusedDays\tKPI1_C7\tden\tdelta_pts_vs_shipped\tFRdays");
const base = E.P0_shipped.kpi1_c7;
for (const e of evalJ.evals) {
  console.log([e.pred, e.refusedDays, (100 * e.kpi1_c7).toFixed(2), e.kpi1_c7Den,
    (100 * (e.kpi1_c7 - base)).toFixed(2), e.FR].join("\t"));
}

// ---- (3) A7 COUNTERFACTUAL MARGINS --------------------------------------
console.log("\n=== (3) A7 COUNTERFACTUAL — permanent, or a stocking claim? ===");
const CONC = 0.133; // A7: nutritional yeast, 53.3 g P / 400 kcal
console.log("id\tstyle\tdays\ttargetKcal\tfloor_g\tmaxDens\treqDens\tloose_g\tscaled_g\tconcLoose_g\tclears");
const rows = [];
for (const id of [...REFUSED].sort()) {
  const c = clsById.get(id);
  const dl = labels.filter((d) => d.id === id);
  const kcalCeil = c.targetKcal * 1.15;
  const reqDens = c.proteinFloor / kcalCeil;
  const concLoose = kcalCeil * CONC;
  rows.push({ id, style: dl[0]?.dietaryStyle ?? null, days: dl.length, targetKcal: c.targetKcal,
    floor: +c.proteinFloor.toFixed(1), maxDens: +(c.looseBound / kcalCeil).toFixed(4),
    reqDens: +reqDens.toFixed(4), loose: +c.looseBound.toFixed(1), scaled: +c.scaledBound.toFixed(1),
    concLoose: +concLoose.toFixed(1), clears: concLoose >= c.proteinFloor });
  const r = rows[rows.length - 1];
  console.log([r.id, r.style, r.days, r.targetKcal, r.floor, r.maxDens, r.reqDens, r.loose, r.scaled, r.concLoose, r.clears].join("\t"));
}
const reqs = rows.map((r) => r.reqDens);
console.log(`required density range: ${Math.min(...reqs).toFixed(4)} – ${Math.max(...reqs).toFixed(4)} g/kcal`);
console.log(`best density actually in each filtered pool: ${Math.min(...rows.map(r=>r.maxDens)).toFixed(4)} – ${Math.max(...rows.map(r=>r.maxDens)).toFixed(4)}`);
console.log(`personas still provably impossible with ONE ${CONC} g/kcal row: ${rows.filter((r) => !r.clears).length}`);

// styles of the refused set
const styleCount = {};
for (const d of labels) if (REFUSED.has(d.id)) styleCount[d.dietaryStyle ?? "null"] = (styleCount[d.dietaryStyle ?? "null"] ?? 0) + 1;
console.log("refused DAYS by dietary style:", JSON.stringify(styleCount));

// ---- (5) THE TRAP PREDICATE, day by day ---------------------------------
console.log("\n=== (5) P5_tierLabel — refusing the engineered tier ===");
const tierDays = labels.filter((d) => d.tier === "IMPOSSIBLE");
const byKind = {};
for (const d of tierDays) {
  const k = d.kind ?? "null";
  byKind[k] ??= { days: 0, inBand: 0, truthSAT: 0, truthUNK: 0, truthINF: 0 };
  byKind[k].days++; if (d.inBand) byKind[k].inBand++;
  if (d.truth === "SAT-certified") byKind[k].truthSAT++;
  else if (d.truth === "UNKNOWN") byKind[k].truthUNK++;
  else byKind[k].truthINF++;
}
console.log("engineered IMPOSSIBLE tier days:", tierDays.length, JSON.stringify(byKind));
const wrong = E.P5_tierLabel.FR + E.P5_tierLabel.UR;
console.log(`P5 refuses ${E.P5_tierLabel.refusedDays} days; ${E.P5_tierLabel.FR} hold certificates + ${E.P5_tierLabel.UR} unknown = ${wrong} not proven impossible (${(100*wrong/E.P5_tierLabel.refusedDays).toFixed(1)} %)`);

// ---- (6) UNKNOWN accounting ---------------------------------------------
const unk = labels.filter((d) => d.truth === "UNKNOWN");
console.log("\n=== (6) UNKNOWN ===");
console.log(`UNKNOWN days ${unk.length} over ${new Set(unk.map((d) => d.id)).size} personas; all out of band = ${unk.every((d) => !d.inBand)}`);
console.log("SAT-certified days:", labels.filter((d) => d.truth === "SAT-certified").length,
  "— numerically equal to the BRIEF's 495 but a DIFFERENT set (brief = 578-83 tier days; this = days on personas holding a certificate)");

fs.writeFileSync(SB + "A20/A20-finish.json", JSON.stringify({
  falsification: { refusedPersonas: REFUSED.size, solvedInstances: attempts, inBand: inband, perRun },
  binomial: { refusedDays: n52, upper95FRrate: upper, upper95FromInstances: upperAll },
  laundering: evalJ.evals.map((e) => ({ pred: e.pred, refusedDays: e.refusedDays, kpi1_c7: e.kpi1_c7,
    den: e.kpi1_c7Den, deltaPts: 100 * (e.kpi1_c7 - base), FRdays: e.FR })),
  counterfactual: rows, refusedDaysByStyle: styleCount,
  tierTrap: { tierDays: tierDays.length, byKind, p5RefusedDays: E.P5_tierLabel.refusedDays, p5NotProven: wrong },
  unknown: { days: unk.length, personas: new Set(unk.map((d) => d.id)).size },
}, null, 2));
console.log("\nwrote A20-finish.json");
