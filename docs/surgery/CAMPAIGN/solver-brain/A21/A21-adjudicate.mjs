// A21-adjudicate.mjs — the finisher's analysis. NO SOLVING, NO DB ACCESS.
// Pure arithmetic over rig JSONL day records already on disk, so every A21
// claim below is replayable by A22/A24 from artifacts alone.
//
//   node A21-adjudicate.mjs            (run from the solver-brain directory)
//
// Sections:
//   1  LEVER SIGNATURE SCAN   — what is actually inside A21-stack-*.jsonl.
//      The rig header can only ever record the --treatment module's NAME
//      (runRig.mjs:214 `treatmentName = treatment.NAME || path.basename(tp)`),
//      and A13's lever ships as a NODE_OPTIONS --require preload, so the
//      header CANNOT name it. Identification is therefore by signature:
//        · A16-conc* recipeIds in slots      -> the pool lever is present
//        · min(proteinScale, sidesScale)     -> 0.5 means SCALE_BOUNDS floor
//                                               was NOT moved (floor25 arms
//                                               show 0.25)
//        · share of slots with proteinScale != sidesScale, and the warned-slot
//          rise, fingerprint the 4-macro 2-bundle portioner.
//   2  BASELINE IDENTITY      — A13/A16/A17/A19/A21 baselines at one seed.
//   3  WARNED-SLOT ADJUDICATION — filled vs all slots. Resolves the apparent
//      A13-vs-A21 contradiction (341 vs 389).
//   4  MACRO-MISS DIRECTION   — over vs short, per arm.
//   5  McNEMAR MATRIX         — paired deltas incl. marginal contributions.
//   6  DENOMINATORS           — D1 rig tier / D2 C7-A3 / D3 A20-repaired / D4 all.
import fs from "node:fs";
import path from "node:path";

const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain";
const P = (p) => path.resolve(SB, p);
const rows = (p) => fs.readFileSync(P(p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const ARMS = {
  base: "A21/A21-baseline-s424242.jsonl",
  stack: "A21/A21-stack-s424242.jsonl",
  wls2: "A13/A13-wls2-s424242.jsonl",
  conc8: "A16/A16-conc-recipes-N8-s424242.jsonl",
  floor25: "A13/A13-floor25-s424242.jsonl",
  floor25w: "A13/A13-floor25w-s424242.jsonl",
  trim3: "A17/A17-trim3-s424242.jsonl",
  att12: "A14/A14-att12-s424242.jsonl",
};

console.log("== 1  LEVER SIGNATURE SCAN (all days, seed 424242) ==");
console.log("arm       days slots minScale A16concSlots protNEsides");
for (const [k, p] of Object.entries(ARMS)) {
  let min = 9, conc = 0, slots = 0, days = 0, ne = 0;
  for (const r of rows(p)) {
    days++;
    for (const s of r.slots || []) {
      slots++;
      for (const v of [s.proteinScale, s.sidesScale]) if (typeof v === "number" && v < min) min = v;
      if (s.proteinScale !== s.sidesScale) ne++;
      if (String(s.recipeId || "").startsWith("A16-conc")) conc++;
    }
  }
  console.log(k.padEnd(9), days, slots, min, String(conc).padStart(11), String(ne).padStart(11));
}

console.log("\n== 2  BASELINE IDENTITY (achieved macros + verdict, per dayKey) ==");
const baseMap = new Map(rows(ARMS.base).map((r) => [r.dayKey, r]));
for (const k of ["A13/A13-baseline-s424242.jsonl", "A16/A16-baseline-s424242.jsonl",
  "A17/A17-baseline-s424242.jsonl", "A19/A19-baseline-s424242.jsonl"]) {
  const o = new Map(rows(k).map((r) => [r.dayKey, r]));
  let same = 0, diff = 0;
  for (const [dk, r] of baseMap) {
    const q = o.get(dk);
    if (!q) { diff++; continue; }
    if (JSON.stringify([r.achieved, r.verdict.inBand]) === JSON.stringify([q.achieved, q.verdict.inBand])) same++; else diff++;
  }
  console.log(`  A21-base vs ${path.basename(k)}: identical ${same} differing ${diff}`);
}

console.log("\n== 3  WARNED SLOTS, satisfiable(rig tier) judged days ==");
console.log("arm       unfilled unfilledWarned filled filledWarned allWarned");
for (const [k, p] of Object.entries(ARMS)) {
  let uf = 0, ufw = 0, fi = 0, fiw = 0;
  for (const r of rows(p)) {
    if (!r.judged || r.satisfiable === false) continue;
    for (const s of r.slots || []) {
      if (!s.recipeId) { uf++; if (s.warning) ufw++; } else { fi++; if (s.warning) fiw++; }
    }
  }
  console.log(k.padEnd(9), String(uf).padStart(8), String(ufw).padStart(14), String(fi).padStart(6), String(fiw).padStart(12), String(ufw + fiw).padStart(9));
}

console.log("\n== 4  MACRO-MISS DIRECTION, satisfiable judged days ==");
console.log("arm       n   in  miss fatOver fatShort kcal prot carbOver carbShort filled/total");
const SAT = {};
for (const [k, p] of Object.entries(ARMS)) {
  const m = new Map();
  let n = 0, inb = 0, fo = 0, fsh = 0, km = 0, pm = 0, co = 0, cs = 0, filled = 0, tot = 0;
  for (const r of rows(p)) {
    if (!r.judged || r.satisfiable === false) continue;
    m.set(r.dayKey, !!r.verdict.inBand); n++; filled += r.slotsFilled; tot += r.slotsTotal;
    if (r.verdict.inBand) { inb++; continue; }
    if (!r.verdict.kcalOk) km++;
    if (!r.verdict.proteinOk) pm++;
    if (r.verdict.fatOk === false) { if (r.achieved.fat > r.target.fatHi) fo++; else fsh++; }
    if (r.verdict.carbOk === false) { if (r.achieved.carb > r.target.carbHi) co++; else cs++; }
  }
  SAT[k] = m;
  console.log(k.padEnd(9), n, String(inb).padStart(4), String(n - inb).padStart(4), String(fo).padStart(7),
    String(fsh).padStart(8), String(km).padStart(4), String(pm).padStart(4), String(co).padStart(8), String(cs).padStart(9), ` ${filled}/${tot}`);
}

console.log("\n== 5  McNEMAR (paired, satisfiable rig tier, seed 424242) ==");
function mcnemar(a, b) {
  let bb = 0, cc = 0, n = 0;
  for (const [k, x] of SAT[a]) { const y = SAT[b].get(k); if (y === undefined) continue; n++; if (x && !y) bb++; if (!x && y) cc++; }
  const d = (cc - bb) / n, se = Math.sqrt(bb + cc - ((cc - bb) ** 2) / n) / n;
  return `n=${n} b=${bb} c=${cc} delta=${(d * 100).toFixed(2)} CI[${((d - 1.96 * se) * 100).toFixed(2)},${((d + 1.96 * se) * 100).toFixed(2)}]`;
}
for (const [a, b] of [["base", "stack"], ["conc8", "stack"], ["wls2", "stack"], ["base", "wls2"],
  ["base", "conc8"], ["base", "floor25w"], ["stack", "floor25w"]]) console.log(`  ${a} -> ${b}: ${mcnemar(a, b)}`);

console.log("\n== 6  DENOMINATORS x SEEDS (C21: no lever in this stack refuses a day) ==");
const A3IMP = new Set(["p027", "p030", "p051", "p059", "p073", "p077", "p108", "p130", "p133", "p184", "p208", "p211", "p220", "p222", "p227", "p248"]);
const A20IMP = new Set(["p027", "p073", "p077", "p108", "p130", "p133", "p184", "p208", "p220", "p248"]);
const FILT = { D1_rigTier: (r) => r.satisfiable !== false, D2_C7_A3: (r) => !A3IMP.has(r.personaId), D3_A20rep: (r) => !A20IMP.has(r.personaId), D4_all: () => true };
for (const seed of [424242, 8675309, 20260730]) {
  for (const [dn, f] of Object.entries(FILT)) {
    const b = new Map(rows(`A21/A21-baseline-s${seed}.jsonl`).filter((r) => r.judged && f(r)).map((r) => [r.dayKey, !!r.verdict.inBand]));
    const t = new Map(rows(`A21/A21-stack-s${seed}.jsonl`).filter((r) => r.judged && f(r)).map((r) => [r.dayKey, !!r.verdict.inBand]));
    let bb = 0, cc = 0, n = 0, bi = 0, ti = 0;
    for (const [k, v] of b) { const y = t.get(k); if (y === undefined) continue; n++; if (v) bi++; if (y) ti++; if (v && !y) bb++; if (!v && y) cc++; }
    const d = (cc - bb) / n, se = Math.sqrt(bb + cc - ((cc - bb) ** 2) / n) / n;
    console.log(`  s${seed} ${dn.padEnd(10)} n=${n} base=${bi} (${(bi / n * 100).toFixed(2)}%) stack=${ti} (${(ti / n * 100).toFixed(2)}%) delta=${(d * 100).toFixed(2)} CI[${((d - 1.96 * se) * 100).toFixed(2)},${((d + 1.96 * se) * 100).toFixed(2)}] b=${bb} c=${cc}`);
  }
}
