// D9 — READ-ONLY re-score of the stored HTTP-fleet results. No solve, no DB, no
// writes to the fleet directory. Reproduces (or fails to reproduce) 405/578 and
// 405/526 from the run's own recorded per-day verdicts.
import fs from "node:fs";

const RES = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/results.jsonl";
const rows = fs.readFileSync(RES, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));

let judged = 0, inBand = 0, empty = 0, reached = 0;
const byTier = new Map();
for (const r of rows) {
  const m = r.primary && r.primary.mine;
  if (!m) continue;
  reached++;
  judged += m.daysJudged || 0;
  inBand += m.daysInTolerance || 0;
  empty += m.emptyDays || 0;
  const t = r.tier || "?";
  const g = byTier.get(t) || { dj: 0, db: 0, personas: 0 };
  g.dj += m.daysJudged || 0; g.db += m.daysInTolerance || 0; g.personas++;
  byTier.set(t, g);
}
console.log(`rows=${rows.length} reachedAPlan=${reached}`);
console.log(`ALL DAYS      ${inBand}/${judged} = ${((inBand / judged) * 100).toFixed(1)}%   emptyDays=${empty}`);
for (const [t, g] of [...byTier.entries()].sort()) {
  console.log(`  tier ${t.padEnd(11)} personas=${String(g.personas).padStart(3)}  ${g.db}/${g.dj} = ${g.dj ? ((g.db / g.dj) * 100).toFixed(1) : "--"}%`);
}
// A3's C7 satisfiable bucket = every tier except the IMPOSSIBLE personas that
// were genuinely unsatisfiable (the "mislabelled-satisfiable" ones are put back).
const imposs = byTier.get("IMPOSSIBLE") || { dj: 0, db: 0 };
const misl = rows.filter((r) => r.tier === "IMPOSSIBLE" && r.primary && r.primary.mine
  && r.primary.mine.daysJudged > 0 && r.primary.mine.daysInTolerance === r.primary.mine.daysJudged);
const mislDj = misl.reduce((s, r) => s + r.primary.mine.daysJudged, 0);
const mislDb = misl.reduce((s, r) => s + r.primary.mine.daysInTolerance, 0);
console.log(`IMPOSSIBLE tier: ${imposs.db}/${imposs.dj}; mislabelled-satisfiable personas=${misl.length} days=${mislDj} inBand=${mislDb}`);
console.log(`drop-whole-IMPOSSIBLE      -> ${inBand - imposs.db}/${judged - imposs.dj}`);
console.log(`drop-IMPOSSIBLE-keep-misl. -> ${inBand - imposs.db + mislDb}/${judged - imposs.dj + mislDj} = ${(((inBand - imposs.db + mislDb) / (judged - imposs.dj + mislDj)) * 100).toFixed(1)}%`);
