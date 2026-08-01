// A14/A14-analyze.mjs — stratified paired A/B + cost, on top of the rig schema.
//
// compare.v2.mjs is the authority for the headline paired delta; this adds the
// two things A14's question needs and v2 does not carry:
//   1. STRATA. The 2026 negative result was that depth helps fat pools and hurts
//      thin ones. An aggregate averages that away. Strata: diet style, and
//      pool-size quartile taken from the per-persona cost CSV (poolAfterPrep).
//   2. COST. p50/p95 whole-customer solveMs, from the same CSV.
//
// McNemar, same arithmetic as compare.v2.mjs:
//   b = in-band under baseline, out under treatment (HARM)
//   c = out under baseline, in  under treatment (HELP)
//   delta = (c - b)/n ; se = sqrt(b + c - (c-b)^2/n)/n ; 95% = 1.96*se
//
//   node A14-analyze.mjs <base.jsonl> <treat.jsonl> [--json=out.json] [--strata]

import fs from "node:fs";
import path from "node:path";

const Z = 1.959964;
const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true];
}));

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

function costFor(jsonlPath) {
  const m = path.basename(jsonlPath).match(/^A14-(.+)-s(\d+)\.jsonl$/);
  if (!m) return new Map();
  const p = path.join(path.dirname(jsonlPath), `A14-cost-${m[1]}-s${m[2]}.csv`);
  if (!fs.existsSync(p)) return new Map();
  const lines = fs.readFileSync(p, "utf8").trim().split("\n");
  const head = lines[0].split(",");
  const out = new Map();
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    const o = {}; head.forEach((h, i) => { o[h] = c[i]; });
    o.poolAfterPrep = Number(o.poolAfterPrep);
    o.poolAfterDiet = Number(o.poolAfterDiet);
    o.solveMs = Number(o.solveMs);
    o.meanBudget = o.meanBudget === "" ? null : Number(o.meanBudget);
    o.slotCalls = Number(o.slotCalls);
    out.set(o.personaId, o);
  }
  return out;
}

const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

function mcnemar(pairs) {
  let n = 0, b = 0, c = 0, kB = 0, kT = 0;
  for (const [ob, ot] of pairs) {
    n++; if (ob) kB++; if (ot) kT++;
    if (ob && !ot) b++; else if (!ob && ot) c++;
  }
  const delta = n ? (c - b) / n : null;
  const se = n ? Math.sqrt(Math.max(0, b + c - ((c - b) ** 2) / n)) / n : null;
  return { n, kB, kT, pB: n ? kB / n : null, pT: n ? kT / n : null, b, c, delta, se, hw: se == null ? null : Z * se };
}

const pctS = (x) => (x == null ? "  -  " : (x * 100).toFixed(1).padStart(5) + "%");
const ppS = (x) => (x == null ? "-" : (x >= 0 ? "+" : "") + (x * 100).toFixed(2));

function main() {
  const [bp, tp] = files;
  const B = readJsonl(bp), T = readJsonl(tp);
  const cB = costFor(bp), cT = costFor(tp);
  const bByKey = new Map(B.filter((r) => r.dayKey).map((r) => [r.dayKey, r]));
  const tByKey = new Map(T.filter((r) => r.dayKey).map((r) => [r.dayKey, r]));
  const keys = [...bByKey.keys()].filter((k) => tByKey.has(k));
  if (keys.length !== bByKey.size || keys.length !== tByKey.size) {
    console.error(`!! DAY-KEY MISMATCH base=${bByKey.size} treat=${tByKey.size} paired=${keys.length}`);
  }

  const rows = keys.map((k) => {
    const rb = bByKey.get(k), rt = tByKey.get(k);
    const cost = cB.get(rb.personaId);
    return {
      key: k, personaId: rb.personaId,
      satisfiable: rb.satisfiable !== false, judged: rb.judged && rt.judged,
      diet: rb.dietStyle || "none", tier: rb.tier,
      pool: cost ? cost.poolAfterPrep : null,
      ok: [!!rb.verdict?.inBand, !!rt.verdict?.inBand],
    };
  });

  const sat = rows.filter((r) => r.judged && r.satisfiable);
  const all = rows.filter((r) => r.judged);

  const head = (label, m) =>
    `${label.padEnd(26)} ${String(m.kB).padStart(4)}/${String(m.n).padEnd(4)} ${pctS(m.pB)} -> ${pctS(m.pT)}  ${ppS(m.delta).padStart(7)} pts  +-${(m.hw == null ? 0 : m.hw * 100).toFixed(2)}  b=${m.b} c=${m.c}`;

  const runB = B[0]?.run || {}, runT = T[0]?.run || {};
  console.log(`\nA14 ${path.basename(bp)}  ->  ${path.basename(tp)}`);
  console.log(`  base  treatment=${runB.treatment}  seed=${runB.seed}`);
  console.log(`  treat treatment=${runT.treatment}  seed=${runT.seed}`);

  const msB = [...cB.values()].map((x) => x.solveMs), msT = [...cT.values()].map((x) => x.solveMs);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const budT = [...cT.values()].map((x) => x.meanBudget).filter((x) => x != null);
  const budB = [...cB.values()].map((x) => x.meanBudget).filter((x) => x != null);
  console.log(`  COST  base p50 ${q(msB, 0.5)} ms p95 ${q(msB, 0.95)} ms total ${(sum(msB) / 1000).toFixed(1)}s  mean slot depth ${(sum(budB) / budB.length).toFixed(2)}`);
  console.log(`        treat p50 ${q(msT, 0.5)} ms p95 ${q(msT, 0.95)} ms total ${(sum(msT) / 1000).toFixed(1)}s  mean slot depth ${(sum(budT) / budT.length).toFixed(2)}  x${(sum(msT) / sum(msB)).toFixed(2)} wall`);

  const mSat = mcnemar(sat.map((r) => r.ok));
  const mAll = mcnemar(all.map((r) => r.ok));
  console.log(`\n  ${"slice".padEnd(26)} ${"inband".padStart(9)}  base  -> treat    delta        95%hw  discordant`);
  console.log("  " + head("SATISFIABLE-ONLY (PRIMARY)", mSat));
  console.log("  " + head("all days (secondary)", mAll));

  const out = { base: path.basename(bp), treat: path.basename(tp), runB: runB.treatment, runT: runT.treatment, seed: runB.seed, sat: mSat, all: mAll, strata: {}, cost: { baseP50: q(msB, 0.5), baseP95: q(msB, 0.95), treatP50: q(msT, 0.5), treatP95: q(msT, 0.95), baseTotalS: sum(msB) / 1000, treatTotalS: sum(msT) / 1000, baseDepth: sum(budB) / budB.length, treatDepth: sum(budT) / budT.length } };

  if (flags.strata) {
    // --- by pool size, fixed cut points so every A/B uses the same bins ----
    const BINS = [[0, 60], [60, 140], [140, 300], [300, 1e9]];
    console.log(`\n  BY POOL SIZE (recipes surviving diet+prep filter, satisfiable-only)`);
    out.strata.pool = {};
    for (const [lo, hi] of BINS) {
      const s = sat.filter((r) => r.pool != null && r.pool >= lo && r.pool < hi);
      if (!s.length) continue;
      const m = mcnemar(s.map((r) => r.ok));
      const label = `pool ${lo}-${hi === 1e9 ? "max" : hi}`;
      console.log("  " + head(label, m));
      out.strata.pool[label] = m;
    }
    console.log(`\n  BY DIET STYLE (satisfiable-only)`);
    out.strata.diet = {};
    const diets = [...new Set(sat.map((r) => r.diet))].sort();
    for (const d of diets) {
      const s = sat.filter((r) => r.diet === d);
      const m = mcnemar(s.map((r) => r.ok));
      const pools = s.map((r) => r.pool).filter((x) => x != null);
      const label = `${d} (pool~${pools.length ? Math.round(sum(pools) / pools.length) : "?"})`;
      console.log("  " + head(label, m));
      out.strata.diet[d] = { ...m, meanPool: pools.length ? sum(pools) / pools.length : null };
    }
  }

  if (flags.json) fs.writeFileSync(path.resolve(String(flags.json)), JSON.stringify(out, null, 2));
  console.log("");
}
main();
