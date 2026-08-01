// A16-flips.mjs — WHO gains from a pool-enrichment arm?
//
// The enrichment treatment adds one corner's synthetic rows to EVERY persona's
// pool and lets the product's own gate decide who may see them. A vegan row is
// legal for an omnivore. So a headline delta says nothing about which customer
// the authoring money reached. This attributes the paired McNemar discordants
// (b = lost, c = gained) to the persona's dietStyle, and counts how many
// synthetic slots each style actually consumed.
//
//   node A16-flips.mjs <baseline.jsonl> <treatment.jsonl>

import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const [BASE, TRT] = process.argv.slice(2);
const b = read(BASE), t = read(TRT);
const bi = new Map(b.map((r) => [r.dayKey, r]));

const rows = new Map();
const get = (k) => { if (!rows.has(k)) rows.set(k, { n: 0, bIn: 0, tIn: 0, gained: 0, lost: 0, synSlots: 0, daysWithSyn: 0 }); return rows.get(k); };

let synTotal = 0, synDays = 0;
for (const tr of t) {
  if (!tr.judged || tr.satisfiable === false) continue;
  const br = bi.get(tr.dayKey);
  if (!br || !br.judged) continue;
  const style = tr.dietStyle || "none";
  const r = get(style), all = get("__ALL");
  const syn = (tr.slots || []).filter((s) => String(s.recipeId || "").startsWith("A16-syn-")).length;
  synTotal += syn; if (syn) synDays++;
  for (const x of [r, all]) {
    x.n++;
    if (br.verdict?.inBand) x.bIn++;
    if (tr.verdict?.inBand) x.tIn++;
    if (!br.verdict?.inBand && tr.verdict?.inBand) x.gained++;
    if (br.verdict?.inBand && !tr.verdict?.inBand) x.lost++;
    x.synSlots += syn; if (syn) x.daysWithSyn++;
  }
}

const all = rows.get("__ALL");
console.log(`\n# ${TRT.split(/[\\/]/).pop()}  (satisfiable-only, paired on dayKey)`);
console.log(`style          n   base%   trt%   gained(c)  lost(b)   synSlots  daysWithSyn  shareOfGain`);
for (const [k, v] of [...rows].filter(([k]) => k !== "__ALL").sort((x, y) => y[1].gained - x[1].gained)) {
  console.log(
    `${k.padEnd(14)}${String(v.n).padStart(4)}  ${(100 * v.bIn / v.n).toFixed(1).padStart(5)}  ${(100 * v.tIn / v.n).toFixed(1).padStart(5)}` +
    `${String(v.gained).padStart(10)}${String(v.lost).padStart(9)}${String(v.synSlots).padStart(11)}${String(v.daysWithSyn).padStart(13)}` +
    `${(100 * v.gained / (all.gained || 1)).toFixed(1).padStart(12)}%`);
}
console.log(`TOTAL         ${String(all.n).padStart(4)}  ${(100 * all.bIn / all.n).toFixed(1).padStart(5)}  ${(100 * all.tIn / all.n).toFixed(1).padStart(5)}${String(all.gained).padStart(10)}${String(all.lost).padStart(9)}${String(all.synSlots).padStart(11)}${String(all.daysWithSyn).padStart(13)}`);
console.log(`synthetic slots overall: ${synTotal} on ${synDays} satisfiable judged days`);
