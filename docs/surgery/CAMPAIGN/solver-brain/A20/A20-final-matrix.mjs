// A20 — final confusion matrices under the REPAIRED ground truth.
// Ground truth revision: A3's "structurally impossible" label omits the macro
// closer entirely. With the closer's reachable adjusters added to the bound
// (A20-soundness-repair-v2), only 10 personas / 16 days remain PROVABLE.
// The other 6 personas / 36 days hold no proof AND no satisfiability
// certificate -> they move to UNKNOWN, not to SAT.
import fs from "node:fs";
const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/";
const jsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const labels = jsonl(SB + "A20/A20-day-labels.jsonl");
const rep = JSON.parse(fs.readFileSync(SB + "A20/A20-soundness-repair-v2.json", "utf8"));

const PROVEN = new Set(rep.rows.filter((r) => r.stillProves).map((r) => r.id));   // 10
const DEMOTED = new Set(rep.rows.filter((r) => !r.stillProves).map((r) => r.id)); // 6

function truth2(d) {
  if (PROVEN.has(d.id)) return "INFEASIBLE-proved";
  if (DEMOTED.has(d.id)) return "UNKNOWN";        // proof withdrawn, no certificate
  return d.truth;                                  // SAT-certified / UNKNOWN as before
}
const tc = {}; for (const d of labels) tc[truth2(d)] = (tc[truth2(d)] ?? 0) + 1;
console.log("REVISED ground truth (days):", JSON.stringify(tc), "sum", labels.length);
console.log("demoted days all out of band:", labels.filter((d) => DEMOTED.has(d.id)).every((d) => !d.inBand));

const PREDS = {
  P0_shipped: () => false,
  P4_A3bound: (d) => d.preds.P4_scaledBound,
  P5_tierLabel: (d) => d.preds.P5_tierLabel,
  P6_ownDiagnose: (d) => d.preds.P6_ownDiagnose,
  P7_repaired: (d) => PROVEN.has(d.id),
};
const out = [];
for (const [name, fn] of Object.entries(PREDS)) {
  const m = { TA: 0, TR: 0, FR: 0, FAhard: 0, FAsoft: 0, UR: 0, UA_inband: 0, UA_out: 0, PROVEN_inband: 0 };
  for (const d of labels) {
    const t = truth2(d), refuse = fn(d);
    if (refuse) { if (t === "INFEASIBLE-proved") m.TR++; else if (t === "SAT-certified") m.FR++; else m.UR++; }
    else if (t === "INFEASIBLE-proved") { d.inBand ? m.PROVEN_inband++ : m.FAhard++; }
    else if (t === "SAT-certified") { d.inBand ? m.TA++ : m.FAsoft++; }
    else { d.inBand ? m.UA_inband++ : m.UA_out++; }
  }
  const refused = m.TR + m.FR + m.UR;
  const r = {
    pred: name, refusedDays: refused, ...m,
    precision_strict: refused ? m.TR / refused : null,          // UNKNOWN refusals count against
    precision_certOnly: (m.TR + m.FR) ? m.TR / (m.TR + m.FR) : null, // A8's KPI-2a
    recall_proven: (m.TR + m.FAhard) ? m.TR / (m.TR + m.FAhard) : null,
    recall_vsA3_52: m.TR / 52,
    kpi1_c7: (m.TA + m.UA_inband) / (m.TA + m.UA_inband + m.FAsoft + m.UA_out),
    kpi1_c7Den: m.TA + m.UA_inband + m.FAsoft + m.UA_out,
  };
  out.push(r);
}
console.log("\npred\trefused\tTR\tFR\tUR\tFAhard\tFAsoft\tTA\tprec_strict\tprec_KPI2a\trecall_proven\trecall_vs52\tKPI1_C7\tden");
for (const r of out) console.log([r.pred, r.refusedDays, r.TR, r.FR, r.UR, r.FAhard, r.FAsoft, r.TA,
  r.precision_strict == null ? "n/a" : (100 * r.precision_strict).toFixed(1),
  r.precision_certOnly == null ? "n/a" : (100 * r.precision_certOnly).toFixed(1),
  r.recall_proven == null ? "n/a" : (100 * r.recall_proven).toFixed(1),
  (100 * r.recall_vsA3_52).toFixed(1), (100 * r.kpi1_c7).toFixed(2), r.kpi1_c7Den].join("\t"));
for (const r of out) if (r.PROVEN_inband) console.log(`!! ${r.pred}: ${r.PROVEN_inband} in-band days on a PROVEN-impossible persona — bound unsound`);

// C7 ceiling under the repaired count
const provenDays = tc["INFEASIBLE-proved"] ?? 0;
console.log(`\nCEILING: A3/C7 says 52 impossible -> 526/578 = ${(100 * 526 / 578).toFixed(1)} %`);
console.log(`         repaired: ${provenDays} proven impossible -> ${578 - provenDays}/578 = ${(100 * (578 - provenDays) / 578).toFixed(1)} %`);
fs.writeFileSync(SB + "A20/A20-final-matrix.json", JSON.stringify({
  revisedGroundTruthDays: tc, provenPersonas: [...PROVEN], demotedPersonas: [...DEMOTED],
  ceiling: { c7Days: 52, c7Pct: 526 / 578, repairedDays: provenDays, repairedPct: (578 - provenDays) / 578 },
  matrices: out,
}, null, 2));
console.log("\nwrote A20-final-matrix.json");
