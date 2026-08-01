// A13 — per-macro pass-rate decomposition, satisfiable-only.
//
// An instrument check, not a headline. The mechanism under test steers fat and
// carb at portioning time, which the 2-knob solve never did. If the compliance
// jump is real it MUST show up as fat/carb pass rates rising while kcal and
// protein hold. A jump that appears without that signature would mean the gain
// came from somewhere I did not design, and would be a bug in my own work.
//
//   node a13-macrobreak.mjs <a.jsonl> <b.jsonl> ...

import fs from "node:fs";
import path from "node:path";

const rowsOf = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : "—");

const table = [];
for (const p of process.argv.slice(2)) {
  const rows = rowsOf(p).filter((r) => r.judged && r.satisfiable !== false);
  const c = { n: 0, inBand: 0, kcal: 0, protein: 0, fat: 0, carb: 0, slots: 0, fatJudged: 0, carbJudged: 0 };
  let fatOverSum = 0, fatOverN = 0, kcalAbsSum = 0;
  for (const r of rows) {
    c.n++;
    const v = r.verdict || {};
    if (v.inBand) c.inBand++;
    if (v.kcalOk) c.kcal++;
    if (v.proteinOk) c.protein++;
    if (v.fatOk) c.fat++;
    if (v.carbOk) c.carb++;
    if (v.fatJudged) c.fatJudged++;
    if (v.carbJudged) c.carbJudged++;
    c.slots += r.slotsFilled || 0;
    if (v.fatOverPct > 0) { fatOverSum += v.fatOverPct; fatOverN++; }
    kcalAbsSum += Math.abs(v.kcalDeltaPct || 0);
  }
  table.push({
    file: path.basename(p),
    days: c.n,
    inBand: `${c.inBand} (${pct(c.inBand, c.n)}%)`,
    kcalOk: pct(c.kcal, c.n) + "%",
    proteinOk: pct(c.protein, c.n) + "%",
    fatOk: pct(c.fat, c.n) + "%",
    carbOk: pct(c.carb, c.n) + "%",
    slotsFilled: c.slots,
    daysFatOverBand: fatOverN,
    meanFatOverPctWhenOver: fatOverN ? (fatOverSum / fatOverN).toFixed(3) : "—",
    meanAbsKcalDeltaPct: (kcalAbsSum / c.n).toFixed(4),
  });
}
console.table(table);
fs.writeFileSync(
  path.join(path.dirname(process.argv[2]), "A13-macro-breakdown.json"),
  JSON.stringify(table, null, 2)
);
