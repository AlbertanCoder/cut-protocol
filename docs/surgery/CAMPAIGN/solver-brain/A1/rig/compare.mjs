// A1/rig/compare.mjs — baseline vs treatment, on BOTH denominators.
//
//   node compare.mjs <baseline.jsonl> <treatment.jsonl> [--json=out.json]
//
// Reports days-in-band for each side with a Wilson 95% interval, and the DELTA
// with a Newcombe hybrid-score interval built from those same Wilson roots
// (Newcombe 1998, method 10 — the standard interval for a difference of two
// proportions derived from Wilson bounds).
//
// It refuses to let a small delta be read as a result: BRIEF.md measured
// run-to-run variance at +/-1.5 points, so any |delta| under that is printed as
// NOISE, NOT A RESULT no matter how clean the arithmetic looks.
//
// Denominators, never mixed (BRIEF.md):
//   satisfiable-only  PRIMARY   tier != IMPOSSIBLE. This is the real question.
//   all days          secondary includes the engineered-unsatisfiable tier,
//                               whose correct output is a refusal, so it carries
//                               a hard ceiling near 88%.
// A third line reports all PLANNED days counting a refused day as a miss, so
// nothing is hidden by the `judged` flag.

import fs from "node:fs";
import path from "node:path";

const Z = 1.959964;

export function wilson(k, n, z = Z) {
  if (!n) return { k, n, p: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Newcombe hybrid-score interval for p1 - p2, from the two Wilson intervals. */
export function newcombeDiff(k1, n1, k2, n2, z = Z) {
  const a = wilson(k1, n1, z), b = wilson(k2, n2, z);
  if (a.p == null || b.p == null) return { d: null, lo: null, hi: null };
  const d = a.p - b.p;
  const lo = d - Math.sqrt((a.p - a.lo) ** 2 + (b.hi - b.p) ** 2);
  const hi = d + Math.sqrt((a.hi - a.p) ** 2 + (b.p - b.lo) ** 2);
  return { d, lo, hi };
}

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pc = (x) => (x == null ? "  —  " : (x * 100).toFixed(1).padStart(5) + "%");
const pp = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + " pts");

function tally(rows, filter) {
  let n = 0, k = 0;
  for (const r of rows) { if (!filter(r)) continue; n++; if (r.verdict?.inBand) k++; }
  return { k, n };
}

function report(name, base, treat, out) {
  const B = wilson(base.k, base.n), T = wilson(treat.k, treat.n);
  const D = newcombeDiff(treat.k, treat.n, base.k, base.n);
  out.push(`${name}`);
  out.push(`  baseline   ${String(base.k).padStart(4)}/${String(base.n).padEnd(4)} = ${pc(B.p)}   95% CI ${pc(B.lo)}–${pc(B.hi)}`);
  out.push(`  treatment  ${String(treat.k).padStart(4)}/${String(treat.n).padEnd(4)} = ${pc(T.p)}   95% CI ${pc(T.lo)}–${pc(T.hi)}`);
  out.push(`  DELTA      ${pp(D.d)}   95% CI ${pp(D.lo)} … ${pp(D.hi)}`);
  const dpts = D.d == null ? null : D.d * 100;
  if (dpts == null) out.push(`  VERDICT    no data`);
  else if (Math.abs(dpts) < 1.5) out.push(`  VERDICT    NOISE, NOT A RESULT — |${dpts.toFixed(2)}| pts is inside the +/-1.5 pt run-to-run variance floor.`);
  else if (D.lo <= 0 && D.hi >= 0) out.push(`  VERDICT    NOT DISTINGUISHABLE FROM ZERO — the 95% interval spans 0.`);
  else out.push(`  VERDICT    delta is outside the noise floor AND the interval excludes 0.`);
  out.push("");
  return { base: B, treat: T, delta: D, noise: dpts != null && Math.abs(dpts) < 1.5 };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
  if (args.length < 2) { console.error("usage: node compare.mjs <baseline.jsonl> <treatment.jsonl> [--json=out.json]"); process.exit(2); }
  const [bp, tp] = args.map((a) => path.resolve(a));
  const base = readJsonl(bp), treat = readJsonl(tp);
  const out = [];

  const bh = base[0]?.run || {}, th = treat[0]?.run || {};
  out.push(`COMPARE  ${path.basename(bp)}  ->  ${path.basename(tp)}`);
  out.push(`  baseline : label=${bh.label} pop=${bh.pop} seed=${bh.seed} treatment=${bh.treatment} fingerprint=${bh.foodFingerprint}`);
  out.push(`  treatment: label=${th.label} pop=${th.pop} seed=${th.seed} treatment=${th.treatment} fingerprint=${th.foodFingerprint}`);

  // ── comparability gate. A mismatch here invalidates every number below. ──
  const problems = [];
  if (bh.pop !== th.pop) problems.push(`POPULATION MISMATCH (${bh.pop} vs ${th.pop}) — different denominators, not comparable`);
  if (bh.seed !== th.seed) problems.push(`SEED MISMATCH (${bh.seed} vs ${th.seed}) — this is a seed effect, not a treatment effect`);
  if (bh.foodFingerprint !== th.foodFingerprint) problems.push(`FOOD FINGERPRINT MISMATCH — the two runs saw different nutrition data`);
  const bKeys = new Set(base.map((r) => r.dayKey)), tKeys = new Set(treat.map((r) => r.dayKey));
  const onlyB = [...bKeys].filter((k) => !tKeys.has(k)), onlyT = [...tKeys].filter((k) => !bKeys.has(k));
  if (onlyB.length || onlyT.length) problems.push(`DAY-KEY MISMATCH — ${onlyB.length} only in baseline, ${onlyT.length} only in treatment (a treatment that changes the day SET changes the denominator)`);
  const inst = (rows) => ({ dis: rows.filter((r) => r.verdictDisagrees).length, drift: rows.filter((r) => Math.abs(r.drift?.kcal ?? 0) > 1).length, crash: rows.filter((r) => r.crash).length });
  const ib = inst(base), it = inst(treat);
  out.push(`  instrument: baseline verdict-disagreements ${ib.dis} / kcal-drift ${ib.drift} / crashes ${ib.crash}  ·  treatment ${it.dis} / ${it.drift} / ${it.crash}   (all should be 0)`);
  out.push("");
  if (problems.length) { out.push("*** COMPARABILITY PROBLEMS ***"); for (const p of problems) out.push(`  ! ${p}`); out.push(""); }

  const res = {};
  res.satisfiable = report("SATISFIABLE-ONLY (PRIMARY — tier != IMPOSSIBLE, judged days)",
    tally(base, (r) => r.judged && r.satisfiable !== false), tally(treat, (r) => r.judged && r.satisfiable !== false), out);
  res.all = report("ALL DAYS (secondary — every tier, judged days)",
    tally(base, (r) => r.judged), tally(treat, (r) => r.judged), out);
  res.planned = report("ALL PLANNED DAYS (a refused/empty day counted as a miss — nothing hidden)",
    { k: base.filter((r) => r.judged && r.verdict?.inBand).length, n: base.length },
    { k: treat.filter((r) => r.judged && r.verdict?.inBand).length, n: treat.length }, out);

  // ── paired view. Same seed + same population = the same day appears on both
  //    sides, so the flip counts are stronger evidence than the interval above
  //    (which treats the two samples as independent and is therefore
  //    conservative for this design).
  const bm = new Map(base.map((r) => [r.dayKey, r]));
  let flipsToIn = 0, flipsToOut = 0, same = 0, unpaired = 0;
  for (const t of treat) {
    const b = bm.get(t.dayKey);
    if (!b) { unpaired++; continue; }
    const bi = !!b.verdict?.inBand, ti = !!t.verdict?.inBand;
    if (bi === ti) same++; else if (ti) flipsToIn++; else flipsToOut++;
  }
  out.push(`PAIRED (same day, both sides)`);
  out.push(`  unchanged ${same} · flipped INTO band ${flipsToIn} · flipped OUT of band ${flipsToOut} · unpaired ${unpaired}`);
  const bc = flipsToIn + flipsToOut;
  if (bc === 0) out.push(`  ZERO days changed verdict. On a same-seed A/B this is the signature of a genuine no-op.`);
  else {
    const chi = (Math.abs(flipsToIn - flipsToOut) - 1) ** 2 / bc;
    out.push(`  McNemar chi2(1) with continuity correction = ${chi.toFixed(2)} (3.84 = p<0.05)`);
  }

  // Byte-level identity: the strongest possible no-op evidence.
  const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.run; delete c.solveMs; if (c.slots) for (const s of c.slots) delete s.warning; return JSON.stringify(c); };
  let identical = 0;
  for (const t of treat) { const b = bm.get(t.dayKey); if (b && strip(b) === strip(t)) identical++; }
  out.push(`  byte-identical day records (run header + timing excluded): ${identical}/${treat.length}`);
  out.push("");

  console.log(out.join("\n"));
  if (flags.json) {
    fs.writeFileSync(path.resolve(String(flags.json)), JSON.stringify({
      baselineFile: bp, treatmentFile: tp, baselineHeader: bh, treatmentHeader: th,
      problems, instrument: { baseline: ib, treatment: it },
      results: res, paired: { same, flipsToIn, flipsToOut, unpaired, identical, total: treat.length },
      generatedAt: new Date().toISOString(),
    }, null, 2) + "\n");
    console.log(`json -> ${path.resolve(String(flags.json))}`);
  }
  if (problems.length) process.exitCode = 3;
}

main();
