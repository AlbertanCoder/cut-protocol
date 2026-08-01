// A21-denoms.mjs — the stack scored on THREE denominators (C20), plus the
// slot-warning cost (C23/A13) and the honesty columns. Artifacts only.
//   D1 rig tier-split  : satisfiable = tier !== "IMPOSSIBLE"          (536 days)
//   D2 C7 / A3         : exclude only A3's PROVEN-impossible personas
//   D3 A20 repaired    : exclude only A20's stillProves===true personas
// No refusal path is in the stack, so no day leaves any denominator by refusal
// (C21): every denominator below is the one that existed before any refusal.
import fs from "node:fs";
import path from "node:path";
const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain";

const a3 = JSON.parse(fs.readFileSync(path.join(SB, "A3/A3-final-split.json"), "utf8"));
const a3Impossible = new Set(a3.filter((r) => r.bucket === "structurally impossible" ||
  /impossible/i.test(String(r.classification)) || /impossible/i.test(String(r.bucket))).map((r) => r.id));
const a20 = JSON.parse(fs.readFileSync(path.join(SB, "A20/A20-soundness-repair-v2.json"), "utf8"));
const a20Impossible = new Set(a20.rows.filter((r) => r.stillProves === true).map((r) => r.id));

function read(p) {
  return fs.readFileSync(path.join(SB, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
function score(rows, exclude) {
  let n = 0, ok = 0;
  for (const r of rows) { if (!r.judged) continue; if (exclude.has(r.personaId)) continue; n++; if (r.verdict.inBand) ok++; }
  return { n, ok, pct: +((ok / n) * 100).toFixed(2) };
}
function tierExclude(rows) { const s = new Set(); for (const r of rows) if (r.satisfiable === false) s.add(r.personaId); return s; }
function warnStats(rows, exclude) {
  let slots = 0, warned = 0, daysWarn = 0, judged = 0, silent = 0, disagree = 0, drift = 0;
  for (const r of rows) {
    if (!r.judged) continue; if (exclude.has(r.personaId)) continue;
    judged++;
    for (const s of r.slots || []) { slots++; if (s.warning) warned++; }
    if ((r.slots || []).some((s) => s.warning)) daysWarn++;
    if (r.honesty && r.honesty.declared === false) silent++;
    if (r.verdictDisagrees) disagree++;
    if (Math.abs((r.drift && r.drift.kcal) || 0) > 1) drift++;
  }
  return { judged, slots, warned, warnedPct: +((warned / slots) * 100).toFixed(2), daysWarn, silent, disagree, drift };
}

const out = { a3ImpossiblePersonas: [...a3Impossible], a20ImpossiblePersonas: [...a20Impossible], seeds: {} };
console.log(`A3 proven-impossible personas: ${a3Impossible.size}   A20 repaired: ${a20Impossible.size}`);

for (const seed of [424242, 20260730, 8675309]) {
  const base = read(`A21/A21-baseline-s${seed}.jsonl`);
  const trt = read(`A21/A21-stack-s${seed}.jsonl`);
  const tierEx = tierExclude(base);
  const D = {
    D1_rigTier: { base: score(base, tierEx), stack: score(trt, tierEx) },
    D2_C7_A3: { base: score(base, a3Impossible), stack: score(trt, a3Impossible) },
    D3_A20repaired: { base: score(base, a20Impossible), stack: score(trt, a20Impossible) },
    D4_allJudged: { base: score(base, new Set()), stack: score(trt, new Set()) },
  };
  for (const k of Object.keys(D)) D[k].delta = +(D[k].stack.pct - D[k].base.pct).toFixed(2);
  const W = { base: warnStats(base, tierEx), stack: warnStats(trt, tierEx) };
  out.seeds[seed] = { denominators: D, warnings_satisfiableTier: W };
  console.log(`\nseed ${seed}`);
  for (const [k, v] of Object.entries(D)) console.log(`  ${k.padEnd(15)} base ${v.base.ok}/${v.base.n} = ${v.base.pct}%   stack ${v.stack.ok}/${v.stack.n} = ${v.stack.pct}%   delta ${v.delta >= 0 ? "+" : ""}${v.delta}`);
  console.log(`  warned slots (satisfiable tier): base ${W.base.warned}/${W.base.slots} = ${W.base.warnedPct}%  ->  stack ${W.stack.warned}/${W.stack.slots} = ${W.stack.warnedPct}%`);
  console.log(`  days carrying >=1 warning: base ${W.base.daysWarn} -> stack ${W.stack.daysWarn}`);
  console.log(`  honesty: silent-miss base ${W.base.silent} -> stack ${W.stack.silent} · verdict-disagree ${W.base.disagree} -> ${W.stack.disagree} · kcal-drift>1 ${W.base.drift} -> ${W.stack.drift}`);
}
fs.writeFileSync(path.join(SB, "A21/A21-denoms.json"), JSON.stringify(out, null, 2));
console.log("\n-> A21/A21-denoms.json");
