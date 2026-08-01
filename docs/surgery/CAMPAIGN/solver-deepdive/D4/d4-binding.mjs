// D4 — is classifyBinding's machine-readable key ATTRIBUTED correctly?
// Run-level: a run reports exactly one `binding`. Ask what the run's misses
// actually were, and whether the reported key can be right.
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));

let runs = 0, runsMissing = 0;
let compOnlyRuns = 0, compOnlyRight = 0;
const compOnlyWrongKeys = new Map();
let snackKeyRuns = 0, snackKeyWithUnfilled = 0, snackKeyNoUnfilled = 0;
let densityKeyRuns = 0, densityKeyProteinFailed = 0, densityKeyNoProteinFail = 0;
const perHorizon = new Map();

for (const r of rows) {
  const p = r.primary; if (!p?.mine?.days?.length || !p.claims) continue;
  runs++;
  const out = p.mine.days.filter((d) => !d.inTolerance);
  if (!out.length) continue;
  runsMissing++;
  const b = p.claims.binding || "(none)";
  const unfilled = p.mine.unfilledSlots || 0;
  const anyProteinFail = out.some((d) => !d.proteinOk);
  const anyKcalFail = out.some((d) => !d.kcalOk);
  const compOnly = out.every((d) => d.kcalOk && d.proteinOk && (!d.fatOk || !d.carbOk));
  const h = r.horizon || "?";
  perHorizon.set(h, (perHorizon.get(h) || 0) + 1);

  if (compOnly) {
    compOnlyRuns++;
    if (b === "macro-composition") compOnlyRight++;
    else compOnlyWrongKeys.set(b, (compOnlyWrongKeys.get(b) || 0) + 1);
  }
  if (b === "snack-pool") {
    snackKeyRuns++;
    if (unfilled > 0) snackKeyWithUnfilled++; else snackKeyNoUnfilled++;
  }
  if (b === "protein-density") {
    densityKeyRuns++;
    if (anyProteinFail) densityKeyProteinFailed++; else densityKeyNoProteinFail++;
  }
  void anyKcalFail;
}

const pc = (a, b) => b ? `${((a / b) * 100).toFixed(1)}%` : "n/a";
console.log(`runs with >=1 out-of-band day: ${runsMissing} (of ${runs} runs)`);
console.log(`horizons in play:`, [...perHorizon].map(([k, v]) => `${k}=${v}`).join(" "));
console.log(`\nCOMPOSITION-ONLY runs (every missed day hit kcal+protein, failed only fat and/or carb): ${compOnlyRuns}`);
console.log(`  reported binding = macro-composition : ${compOnlyRight} (${pc(compOnlyRight, compOnlyRuns)})`);
console.log(`  reported something else              : ${compOnlyRuns - compOnlyRight} (${pc(compOnlyRuns - compOnlyRight, compOnlyRuns)})`);
for (const [k, v] of [...compOnlyWrongKeys].sort((a, b) => b[1] - a[1])) console.log(`      ${String(v).padStart(3)}  ${k}`);
console.log(`\nruns whose binding = snack-pool : ${snackKeyRuns}`);
console.log(`  ...and at least one slot really came back unfilled : ${snackKeyWithUnfilled}`);
console.log(`  ...and ZERO slots were unfilled (every slot filled, yet "snack pool" is blamed) : ${snackKeyNoUnfilled}`);
console.log(`\nruns whose binding = protein-density : ${densityKeyRuns}`);
console.log(`  ...and at least one day really failed protein : ${densityKeyProteinFailed}`);
console.log(`  ...and NO day failed protein : ${densityKeyNoProteinFail}`);
