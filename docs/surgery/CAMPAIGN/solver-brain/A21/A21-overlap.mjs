// A21-overlap.mjs — day-level rescue-set overlap across Phase-4 levers (C23).
// Reads rig JSONL day records, builds the set of dayKeys each lever flips
// MISS -> IN BAND (satisfiable-only, judged), and intersects them.
// No DB access, no solving. Pure set arithmetic on artifacts already on disk.
import fs from "node:fs";
import path from "node:path";

const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain";

function load(p) {
  const m = new Map();
  for (const line of fs.readFileSync(path.resolve(SB, p), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!r.judged) continue;
    if (r.satisfiable === false) continue;
    m.set(r.dayKey, !!(r.verdict && r.verdict.inBand));
  }
  return m;
}
function flips(baseP, treatP) {
  const b = load(baseP), t = load(treatP);
  const gained = new Set(), lost = new Set(), baseMiss = new Set();
  for (const [k, v] of b) {
    if (!t.has(k)) continue;
    if (!v) baseMiss.add(k);
    if (!v && t.get(k)) gained.add(k);
    if (v && !t.get(k)) lost.add(k);
  }
  return { gained, lost, baseMiss, n: b.size, baseIn: [...b.values()].filter(Boolean).length,
           treatIn: [...t.keys()].filter((k) => b.has(k) && t.get(k)).length };
}
const inter = (a, b) => [...a].filter((x) => b.has(x)).length;

const LEVERS = {
  wls2:   ["A21/A21-baseline-s424242.jsonl", "A13/A13-wls2-s424242.jsonl"],
  conc8:  ["A21/A21-baseline-s424242.jsonl", "A16/A16-conc-recipes-N8-s424242.jsonl"],
  trim:   ["A17/A17-baseline-s424242.jsonl", "A17/A17-trim3-s424242.jsonl"],
  att12:  ["A21/A21-baseline-s424242.jsonl", "A14/A14-att12-s424242.jsonl"],
  dayNst: ["A19/A19-forkweek-s424242.jsonl", "A19/A19-dayNstrict-s424242.jsonl"],
  floor25:["A21/A21-baseline-s424242.jsonl", "A13/A13-floor25-s424242.jsonl"],
  STACK:  ["A21/A21-baseline-s424242.jsonl", "A21/A21-stack-s424242.jsonl"],
};

const R = {};
const out = { seed: 424242, levers: {}, pairwise: {}, stack: {} };
for (const [name, [b, t]] of Object.entries(LEVERS)) {
  try {
    const f = flips(b, t);
    R[name] = f;
    out.levers[name] = { n: f.n, baseIn: f.baseIn, treatIn: f.treatIn,
      gained: f.gained.size, lost: f.lost.size, net: f.gained.size - f.lost.size,
      baseMiss: f.baseMiss.size, base: b, treat: t };
    console.log(`${name.padEnd(8)} n=${f.n} baseIn=${f.baseIn} treatIn=${f.treatIn} gained=${f.gained.size} lost=${f.lost.size} net=${f.gained.size - f.lost.size}`);
  } catch (e) { console.log(`${name}: SKIP ${e.message}`); }
}
console.log("\nPAIRWISE OVERLAP of rescued-day sets (|A∩B| / |A∪B|, Jaccard)");
const names = Object.keys(R);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const a = R[names[i]].gained, b = R[names[j]].gained;
  const ix = inter(a, b), un = new Set([...a, ...b]).size;
  out.pairwise[`${names[i]}|${names[j]}`] = { a: a.size, b: b.size, both: ix, union: un, jaccard: +(ix / un).toFixed(3) };
  console.log(`  ${names[i]} x ${names[j]}: |A|=${a.size} |B|=${b.size} both=${ix} union=${un} jaccard=${(ix / un).toFixed(3)}`);
}
// The C23 question: does the STACK equal the union of its parts?
if (R.STACK && R.wls2 && R.conc8) {
  const u = new Set([...R.wls2.gained, ...R.conc8.gained]);
  const s = R.STACK.gained;
  out.stack = {
    wls2Only: R.wls2.gained.size, conc8Only: R.conc8.gained.size,
    unionOfParts: u.size, sumOfParts: R.wls2.gained.size + R.conc8.gained.size,
    overlapPartsBoth: inter(R.wls2.gained, R.conc8.gained),
    stackGained: s.size, stackLost: R.STACK.lost.size,
    stackMinusUnion: [...s].filter((x) => !u.has(x)).length,
    unionMinusStack: [...u].filter((x) => !s.has(x)).length,
    baseMissTotal: R.STACK.baseMiss.size,
    stillMissingAfterStack: R.STACK.baseMiss.size - s.size,
  };
  console.log("\nSTACK vs UNION OF PARTS");
  for (const [k, v] of Object.entries(out.stack)) console.log(`  ${k}: ${v}`);
}
fs.writeFileSync(path.resolve(SB, "A21/A21-overlap-s424242.json"), JSON.stringify(out, null, 2));
console.log("\n-> A21/A21-overlap-s424242.json");
