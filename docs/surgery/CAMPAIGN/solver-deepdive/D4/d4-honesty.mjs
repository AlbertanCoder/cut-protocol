// D4 — honesty-layer coverage. Reads the 250-persona HTTP fleet run.
// `claims.*` = what the server said. `mine.*` = the harness's independent re-grade.
// Nothing here calls into backend/src.
import fs from "node:fs";
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));

let personasWithRun = 0, daysTotal = 0, daysOut = 0;
let runsWithAnyMiss = 0, runsWithAnyMissAndDiag = 0;
let dayVerdictDisagree = 0, missLineMissing = 0, silentMissRows = 0;
const bindingByFailShape = new Map();
const bindingCounts = new Map();
const failShapeCounts = new Map();
let outNoBinding = 0, outWithBinding = 0;
let fatOnly = 0, fatOnlyOver = 0, fatOnlyShort = 0;
const emptyDayOut = { n: 0, diag: 0 };

for (const r of rows) {
  const p = r.primary; if (!p || !p.mine || !p.claims) continue;
  personasWithRun++;
  const claimDays = new Map((p.claims.days || []).map((d) => [d.dayOfWeek, d]));
  const diagPresent = !!p.claims.diagnosisPresent;
  const binding = p.claims.binding || null;
  if (Array.isArray(p.mine.silentMisses) && p.mine.silentMisses.length) silentMissRows += p.mine.silentMisses.length;
  let anyMiss = false;
  for (const d of p.mine.days || []) {
    daysTotal++;
    const cd = claimDays.get(d.dayOfWeek);
    if (cd && cd.inTolerance !== d.inTolerance) dayVerdictDisagree++;
    if (d.inTolerance) continue;
    daysOut++; anyMiss = true;
    if (cd && !cd.miss) missLineMissing++;
    if (d.empty || d.kcal === 0) { emptyDayOut.n++; if (diagPresent) emptyDayOut.diag++; }
    const shape = [d.kcalOk ? null : "kcal", d.proteinOk ? null : "protein", d.fatOk ? null : "fat", d.carbOk ? null : "carb"].filter(Boolean).join("+") || "?";
    failShapeCounts.set(shape, (failShapeCounts.get(shape) || 0) + 1);
    if (shape === "fat") { fatOnly++; if (d.fatOverPct > 0) fatOnlyOver++; if (d.fatShortPct > 0) fatOnlyShort++; }
    if (binding) { outWithBinding++; bindingCounts.set(binding, (bindingCounts.get(binding) || 0) + 1); } else outNoBinding++;
    const key = `${shape} -> ${binding || "(none)"}`;
    bindingByFailShape.set(key, (bindingByFailShape.get(key) || 0) + 1);
  }
  if (anyMiss) { runsWithAnyMiss++; if (diagPresent) runsWithAnyMissAndDiag++; }
}

const pc = (a, b) => b ? `${((a / b) * 100).toFixed(1)}%` : "n/a";
console.log(`personas with a primary run : ${personasWithRun}`);
console.log(`days judged                 : ${daysTotal}`);
console.log(`days OUT of band (harness)  : ${daysOut}  (${pc(daysOut, daysTotal)})`);
console.log(`server/harness day-verdict disagreements : ${dayVerdictDisagree}`);
console.log(`out-of-band days with NO plain-English miss line : ${missLineMissing}`);
console.log(`harness-flagged silentMisses rows : ${silentMissRows}`);
console.log(`runs with >=1 missed day    : ${runsWithAnyMiss}, of which diagnosis attached: ${runsWithAnyMissAndDiag} (${pc(runsWithAnyMissAndDiag, runsWithAnyMiss)})`);
console.log(`out-of-band days whose run carried a binding key : ${outWithBinding} / ${daysOut} (${pc(outWithBinding, daysOut)}); none: ${outNoBinding}`);
console.log(`empty (0-kcal) out-of-band days: ${emptyDayOut.n}, with diagnosis: ${emptyDayOut.diag}`);
console.log(`\nfat-ONLY failures: ${fatOnly}  (over ${fatOnlyOver} / short ${fatOnlyShort})`);
console.log("\n== failure shape of out-of-band days ==");
for (const [k, v] of [...failShapeCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log("\n== binding key reported (counted per out-of-band day) ==");
for (const [k, v] of [...bindingCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log("\n== failure shape -> binding key ==");
for (const [k, v] of [...bindingByFailShape].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
