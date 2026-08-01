// A20 — refusal path. Builds the satisfiability-certificate union, evaluates
// candidate refusal predicates against it, emits A8's KPI split.
//
// GROUND TRUTH, and the point of the whole exercise:
//   * INFEASIBLE-proved  = A3's macro-envelope relaxation fires (SCALED bound
//     < protein floor). A relaxation strictly more generous than the solver,
//     so a failure is a PROOF. Reused verbatim from A3-classification.json.
//   * SAT-certified      = some run, on some instrument, at some seed, has
//     produced an in-band day for this persona. An in-band plan IS a
//     satisfiability certificate (A8). Union over 2 instruments / 5 runs.
//   * UNKNOWN            = neither. Reported, never folded into either side.
//
// Ground truth NEVER comes from the app's own diagnose(). That is the
// relabelling guard: a refusal path graded by the module that produces
// refusals is the engine grading itself.
//
// Read-only. No DB, no solve: this is arithmetic over artifacts already on disk.
import fs from "node:fs";

const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/";
const QA = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/";
const OUT = SB + "A20/";

const jsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const json = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// ---------------------------------------------------------------- inputs
const cls = json(SB + "A3/A3-classification.json");          // 250 personas, both bounds
const split = json(SB + "A3/A3-final-split.json");           // 212 personas, buckets
const personas = jsonl(QA + "personas.jsonl");
const results = jsonl(QA + "results.jsonl");                 // canonical 578-day fleet

const clsById = new Map(cls.map((r) => [r.id, r]));
const splitById = new Map(split.map((r) => [r.id, r]));
const perById = new Map(personas.map((p) => [p.id, p]));
const resById = new Map(results.map((r) => [r.id, r]));

// Rig runs — certificate sources only (C15: rig for deltas, not levels).
const RIG = [
  ["rig-baseline-s424242", SB + "A1/A1-baseline-s424242.jsonl"],
  ["rig-baseline-s20260730", SB + "A1/A1-baseline-s20260730.jsonl"],
  ["rig-baseline-s8675309", SB + "A1/A1-baseline-s8675309.jsonl"],
  ["rig-noop-s424242", SB + "A1/A1-noop-s424242.jsonl"],
  ["rig-poscontrol-s424242", SB + "A1/A1-poscontrol-s424242.jsonl"],
];

// ------------------------------------------------- certificate accumulation
// certFleet[id] = # in-band days in the canonical HTTP fleet run
// certRig[id]   = # in-band days across the 5 rig runs
// A certificate is persona-level: the refusal predicate is a PRE-SOLVE
// function of (profile, filtered pool), identical for every day of a horizon,
// so one in-band day anywhere refutes a refusal of that persona.
const certFleet = new Map();
const certRig = new Map();
const certSources = new Map(); // id -> Set(run labels)

for (const r of results) {
  const days = r?.primary?.mine?.days ?? [];
  const n = days.filter((d) => d.inTolerance).length;
  certFleet.set(r.id, n);
  if (n > 0) {
    if (!certSources.has(r.id)) certSources.set(r.id, new Set());
    certSources.get(r.id).add("fleet-http");
  }
}

const rigTargets = new Map(); // id -> target from rig, for the instrument check
for (const [label, path] of RIG) {
  if (!fs.existsSync(path)) { console.error(`MISSING rig file ${path}`); continue; }
  for (const d of jsonl(path)) {
    if (!rigTargets.has(d.personaId)) rigTargets.set(d.personaId, d.target);
    if (d.judged && d.verdict?.inBand) {
      certRig.set(d.personaId, (certRig.get(d.personaId) ?? 0) + 1);
      if (!certSources.has(d.personaId)) certSources.set(d.personaId, new Set());
      certSources.get(d.personaId).add(label);
    }
  }
}

// ---------------------------------------------- INSTRUMENT CHECK 1: targets
// Cross-instrument certificates are only valid if both instruments solve the
// same customer against the same target. Compare fleet target vs rig target.
let tgtSame = 0, tgtDiff = 0; const tgtDiffIds = [];
for (const r of results) {
  const rt = rigTargets.get(r.id), ft = r.target;
  if (!rt || !ft) continue;
  const same = rt.kcal === ft.kcal && rt.proteinLo === ft.proteinLo && rt.proteinHi === ft.proteinHi;
  if (same) tgtSame++; else { tgtDiff++; tgtDiffIds.push(r.id); }
}

// ------------------------------------------------------------ ground truth
function truthOf(id) {
  const c = clsById.get(id);
  const proved = c?.classification === "structurally-impossible";
  const certified = (certFleet.get(id) ?? 0) > 0 || (certRig.get(id) ?? 0) > 0;
  if (proved && certified) return "CONTRADICTION";
  if (proved) return "INFEASIBLE-proved";
  if (certified) return "SAT-certified";
  return "UNKNOWN";
}

// ---------------------------------------------- INSTRUMENT CHECK 2: soundness
// If any persona is BOTH proven infeasible and holds a satisfiability
// certificate, the proof is unsound (or a certificate is bogus). A3 checked
// this within one fleet run; this widens it to 2 instruments and 5 runs.
const contradictions = cls.filter((c) => truthOf(c.id) === "CONTRADICTION").map((c) => c.id);

// ------------------------------------------------------------- predicates
// Every predicate is PRE-SOLVE: a function of the profile and the filtered
// pool only. P1/P3/P4 are SOUND (a short proof of impossibility exists).
// P5/P6 are the two traps the assignment names; measured, not endorsed.
const CONCENTRATE_G_PER_KCAL = 0.133; // A7: nutritional yeast 53.3 g P / 400 kcal

function predicates(id) {
  const c = clsById.get(id) ?? {};
  const r = resById.get(id) ?? {};
  const p = perById.get(id) ?? {};
  const afterDiet = c.poolAfterDiet ?? r?.primary?.claims?.poolCounts?.afterDiet ?? null;
  const floor = c.proteinFloor, loose = c.looseBound, scaled = c.scaledBound;
  const kcalCeiling = c.targetKcal != null ? c.targetKcal * 1.15 : null;

  return {
    // P0 — the app as shipped: never withholds. (mealSolver.js:754-755)
    P0_shipped: false,
    // P1 — pool empty after hard filters. Already implemented, exact.
    P1_emptyPool: afterDiet === 0,
    // P3 — macro-envelope LOOSE bound (A3): ignores slots and the portion clamp.
    P3_looseBound: floor != null && loose != null && loose < floor,
    // P4 — macro-envelope SCALED bound (A3): applies the 0.5-2.0x clamp. Sound,
    //      strictly stronger than P3. This is A3's operative predicate.
    P4_scaledBound: floor != null && scaled != null && scaled < floor,
    // P5 — THE TRAP the assignment was set up to walk into: refuse the whole
    //      engineered IMPOSSIBLE tier (the brief's 83 days).
    P5_tierLabel: p.tier === "IMPOSSIBLE",
    // P6 — THE RELABELLING TRAP: refuse whenever the app's own diagnose()
    //      already says infeasible. Zero behaviour change; pure re-badging.
    P6_ownDiagnose: r?.primary?.claims?.diagnosisFeasible === false,
    // Counterfactual for A7's reverse direction: would the SOUND predicate
    // still fire if the library held ONE vegan protein concentrate row?
    P4_withConcentrate:
      floor != null && kcalCeiling != null &&
      (floor != null && scaled != null && scaled < floor) &&
      kcalCeiling * CONCENTRATE_G_PER_KCAL < floor,
  };
}

// --------------------------------------------------------- confusion matrix
// Day-level, over the canonical 578-day fleet denominator.
const PREDS = ["P0_shipped", "P1_emptyPool", "P3_looseBound", "P4_scaledBound", "P5_tierLabel", "P6_ownDiagnose"];

const dayRows = [];
for (const r of results) {
  if (r.outcome !== "ok") continue; // 38 profile-blocked-400: 0 days, outside the 578
  const days = r?.primary?.mine?.days ?? [];
  const truth = truthOf(r.id);
  const preds = predicates(r.id);
  days.forEach((d, i) => {
    dayRows.push({
      id: r.id, dayIdx: i, tier: r.tier, kind: r.impossibleKind ?? null,
      dietaryStyle: r.dietaryStyle ?? null,
      bucket: splitById.get(r.id)?.bucket ?? null,
      inBand: !!d.inTolerance, warned: d.warned ?? null,
      truth, preds,
      certFleet: certFleet.get(r.id) ?? 0, certRig: certRig.get(r.id) ?? 0,
      certSources: [...(certSources.get(r.id) ?? [])].join("|"),
      proteinFloor: clsById.get(r.id)?.proteinFloor ?? null,
      scaledBound: clsById.get(r.id)?.scaledBound ?? null,
    });
  });
}

function evaluate(pred) {
  const m = { TA: 0, TR: 0, FR: 0, FAhard: 0, FAsoft: 0, UR: 0, UA_inband: 0, UA_out: 0, IMPOSSIBLE_inband: 0 };
  const frIds = new Set(), trIds = new Set(), urIds = new Set();
  for (const d of dayRows) {
    const refuse = d.preds[pred];
    const t = d.truth;
    if (refuse) {
      if (t === "INFEASIBLE-proved") { m.TR++; trIds.add(d.id); }
      else if (t === "SAT-certified") { m.FR++; frIds.add(d.id); }
      else { m.UR++; urIds.add(d.id); }
    } else {
      if (t === "INFEASIBLE-proved") {
        if (d.inBand) m.IMPOSSIBLE_inband++; // must be 0 or the proof is unsound
        else m.FAhard++;
      } else if (t === "SAT-certified") {
        if (d.inBand) m.TA++; else m.FAsoft++;
      } else {
        if (d.inBand) m.UA_inband++; else m.UA_out++;
      }
    }
  }
  // KPI-1: plan quality over satisfiable days the app CHOSE to plan.
  // "certified" = strict (certificates only). "c7" = C7's ruling: every day
  // not proven impossible counts as satisfiable (UNKNOWN treated as satisfiable).
  const kpi1_certDen = m.TA + m.FAsoft;
  const kpi1_cert = kpi1_certDen ? m.TA / kpi1_certDen : null;
  const taC7 = m.TA + m.UA_inband, faC7 = m.FAsoft + m.UA_out;
  const kpi1_c7 = (taC7 + faC7) ? taC7 / (taC7 + faC7) : null;
  const kpi2a = (m.TR + m.FR) ? m.TR / (m.TR + m.FR) : null;
  const kpi2b = (m.TR + m.FAhard) ? m.TR / (m.TR + m.FAhard) : null;
  return { pred, ...m, refusedDays: m.TR + m.FR + m.UR,
    kpi1_cert, kpi1_certDen, kpi1_c7, kpi1_c7Den: taC7 + faC7, kpi2a, kpi2b,
    frIds: [...frIds], trIds: [...trIds], urIds: [...urIds] };
}

const evals = PREDS.map(evaluate);

// --------------------------------------------------------------- reporting
const pct = (x) => (x == null ? "n/a" : (100 * x).toFixed(1) + " %");
console.log("=== A20 REFUSAL PATH ===");
console.log(`fleet days judged: ${dayRows.length}  personas planned: ${new Set(dayRows.map(d=>d.id)).size}`);
const tc = {}; for (const d of dayRows) tc[d.truth] = (tc[d.truth] ?? 0) + 1;
console.log("ground truth (days):", JSON.stringify(tc));
const tcp = {}; for (const c of cls) tcp[truthOf(c.id)] = (tcp[truthOf(c.id)] ?? 0) + 1;
console.log("ground truth (all 250 personas):", JSON.stringify(tcp));
console.log(`INSTRUMENT CHECK 1 target agreement fleet-vs-rig: same=${tgtSame} diff=${tgtDiff} ${tgtDiffIds.slice(0,8).join(",")}`);
console.log(`INSTRUMENT CHECK 2 proof-vs-certificate contradictions: ${contradictions.length} ${contradictions.join(",") || "(none)"}`);

console.log("\npred\trefused\tTR\tFR\tUR\tFA-hard\tFA-soft\tTA\tKPI-2a\tKPI-2b\tKPI-1(cert)\tKPI-1(C7)");
for (const e of evals) {
  console.log([e.pred, e.refusedDays, e.TR, e.FR, e.UR, e.FAhard, e.FAsoft, e.TA,
    pct(e.kpi2a), pct(e.kpi2b), `${pct(e.kpi1_cert)} n=${e.kpi1_certDen}`, `${pct(e.kpi1_c7)} n=${e.kpi1_c7Den}`].join("\t"));
}
for (const e of evals) {
  if (e.IMPOSSIBLE_inband) console.log(`!! ${e.pred}: ${e.IMPOSSIBLE_inband} in-band days on proven-infeasible personas — PROOF UNSOUND`);
}
console.log("\nFALSE REFUSALS by predicate (persona ids, each holds a satisfiability certificate):");
for (const e of evals) console.log(`  ${e.pred}: FR personas=${e.frIds.length} ${e.frIds.join(",") || "(none)"}`);
console.log("\nUNKNOWN refusals (no certificate, no proof) by predicate:");
for (const e of evals) console.log(`  ${e.pred}: ${e.urIds.length} ${e.urIds.join(",") || "(none)"}`);

// A7 reverse direction: of the SOUND refusals, how many are library walls?
const soundRefused = cls.filter((c) => predicates(c.id).P4_scaledBound);
const stillImpossible = soundRefused.filter((c) => predicates(c.id).P4_withConcentrate);
console.log(`\nA7 COUNTERFACTUAL (one nutritional-yeast row @ ${CONCENTRATE_G_PER_KCAL} g/kcal):`);
console.log(`  personas refused by the sound predicate: ${soundRefused.length}`);
console.log(`  still provably impossible with the concentrate row: ${stillImpossible.length} ${stillImpossible.map(c=>c.id).join(",") || "(none)"}`);
console.log(`  => reason flips to "not stocked" for ${soundRefused.length - stillImpossible.length} of ${soundRefused.length}`);

fs.writeFileSync(OUT + "A20-day-labels.jsonl", dayRows.map((d) => JSON.stringify(d)).join("\n"));
fs.writeFileSync(OUT + "A20-predicate-eval.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  fleetRun: "qa-fleet-20260729-2032", certificateSources: ["fleet-http", ...RIG.map((r) => r[0])],
  daysJudged: dayRows.length, groundTruthDays: tc, groundTruthPersonas: tcp,
  instrumentChecks: { targetAgreement: { same: tgtSame, diff: tgtDiff, diffIds: tgtDiffIds }, contradictions },
  evals, concentrateGPerKcal: CONCENTRATE_G_PER_KCAL,
  a7Counterfactual: { refused: soundRefused.map((c) => c.id), stillImpossible: stillImpossible.map((c) => c.id) },
}, null, 2));
console.log(`\nwrote ${OUT}A20-day-labels.jsonl and A20-predicate-eval.json`);
