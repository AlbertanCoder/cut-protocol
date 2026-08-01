// A1/rig/compare.v2.mjs — RUN THIS ONE. Supersedes compare.mjs.
//
// compare.mjs (v1) is correct but reports only the UNPAIRED (Newcombe) interval
// for the delta. At n≈620 that interval is ~±5 points wide, so a real +3 or +4
// point treatment effect would be reported as "not distinguishable from zero" —
// a false negative baked into the shared tool. A same-seed A/B is a PAIRED
// design: the same day appears on both sides, and the discordant-pair counts are
// the sensitive statistic. v2 prints both and judges on the paired one.
//
// v1 is still on disk unchanged because the campaign guard
// (.claude/hooks/guard-edit.js) makes every file under docs/surgery/CAMPAIGN/
// immutable once created. Recorded, not worked around.
//
//   node compare.v2.mjs <baseline.jsonl> <treatment.jsonl> [--json=out.json]
//
// Denominators, never mixed (BRIEF.md):
//   satisfiable-only  PRIMARY   tier != IMPOSSIBLE — the real question.
//   all days          secondary includes the engineered-unsatisfiable tier,
//                               whose correct output is a refusal (ceiling ~88%).
//   all planned days  a refused/empty day counted as a miss — nothing hidden.

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

/** Newcombe hybrid-score interval for p1 - p2, built from the two Wilson roots. */
export function newcombeDiff(k1, n1, k2, n2, z = Z) {
  const a = wilson(k1, n1, z), b = wilson(k2, n2, z);
  if (a.p == null || b.p == null) return { d: null, lo: null, hi: null };
  const d = a.p - b.p;
  return {
    d,
    lo: d - Math.sqrt((a.p - a.lo) ** 2 + (b.hi - b.p) ** 2),
    hi: d + Math.sqrt((a.hi - a.p) ** 2 + (b.p - b.lo) ** 2),
  };
}

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pc = (x) => (x == null ? "  —  " : (x * 100).toFixed(1).padStart(5) + "%");
const pp = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + " pts");
const ok = (r) => !!r.verdict?.inBand;

const FILTERS = {
  satisfiable: (r) => r.judged && r.satisfiable !== false,
  all: (r) => r.judged,
  planned: () => true,
};

function tally(rows, filter) {
  let n = 0, k = 0;
  for (const r of rows) { if (!filter(r)) continue; n++; if (ok(r)) k++; }
  return { k, n };
}

/**
 * Paired delta on the SAME days.
 *   b = in band on baseline, out on treatment
 *   c = out on baseline, in on treatment
 * delta = (c - b)/n, se from the McNemar normal approximation. Flagged as thin
 * when b + c < 10, where the normal approximation should not be leaned on.
 */
export function pairedDelta(baseRows, treatRows, filter) {
  const bm = new Map(baseRows.filter(filter).map((r) => [r.dayKey, r]));
  let n = 0, b = 0, c = 0, unpaired = 0;
  for (const t of treatRows.filter(filter)) {
    const bb = bm.get(t.dayKey);
    if (!bb) { unpaired++; continue; }
    n++;
    const bi = ok(bb), ti = ok(t);
    if (bi && !ti) b++; else if (!bi && ti) c++;
  }
  if (!n) return { n: 0, b, c, unpaired, d: null, lo: null, hi: null, thin: true };
  const d = (c - b) / n;
  const se = Math.sqrt(Math.max(0, b + c - ((b - c) ** 2) / n)) / n;
  const chi = b + c > 0 ? ((Math.abs(b - c) - 1) ** 2) / (b + c) : 0;
  return { n, b, c, unpaired, d, lo: d - Z * se, hi: d + Z * se, thin: b + c < 10, chi };
}

function report(name, baseRows, treatRows, filter, out) {
  const base = tally(baseRows, filter), treat = tally(treatRows, filter);
  const B = wilson(base.k, base.n), T = wilson(treat.k, treat.n);
  const D = newcombeDiff(treat.k, treat.n, base.k, base.n);
  const P = pairedDelta(baseRows, treatRows, filter);
  out.push(name);
  out.push(`  baseline   ${String(base.k).padStart(4)}/${String(base.n).padEnd(4)} = ${pc(B.p)}   95% CI ${pc(B.lo)}–${pc(B.hi)}`);
  out.push(`  treatment  ${String(treat.k).padStart(4)}/${String(treat.n).padEnd(4)} = ${pc(T.p)}   95% CI ${pc(T.lo)}–${pc(T.hi)}`);
  out.push(`  DELTA unpaired (Newcombe/Wilson)  ${pp(D.d)}   95% CI ${pp(D.lo)} … ${pp(D.hi)}`);
  out.push(`  DELTA paired   (McNemar)          ${pp(P.d)}   95% CI ${pp(P.lo)} … ${pp(P.hi)}   discordant b=${P.b} c=${P.c}${P.thin ? "  [b+c<10: trust the counts, not this CI]" : ""}`);
  const dpts = P.d == null ? null : P.d * 100;
  if (dpts == null) out.push(`  VERDICT    no data`);
  else if (P.b === 0 && P.c === 0) out.push(`  VERDICT    ZERO days changed verdict — an exact no-op on this denominator.`);
  else if (Math.abs(dpts) < 1.5) out.push(`  VERDICT    NOISE, NOT A RESULT — |${dpts.toFixed(2)}| pts is inside the +/-1.5 pt run-to-run variance floor (BRIEF.md).`);
  else if (P.lo <= 0 && P.hi >= 0) out.push(`  VERDICT    NOT DISTINGUISHABLE FROM ZERO — the paired 95% interval spans 0.`);
  else out.push(`  VERDICT    clears the +/-1.5 pt noise floor AND the paired interval excludes 0 (McNemar chi2=${P.chi.toFixed(2)}; 3.84 = p<0.05).`);
  out.push("");
  return { base: B, treat: T, deltaUnpaired: D, deltaPaired: P };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
  if (args.length < 2) { console.error("usage: node compare.v2.mjs <baseline.jsonl> <treatment.jsonl> [--json=out.json]"); process.exit(2); }
  const [bp, tp] = args.map((a) => path.resolve(a));
  const base = readJsonl(bp), treat = readJsonl(tp);
  const out = [];

  const bh = base[0]?.run || {}, th = treat[0]?.run || {};
  out.push(`COMPARE v2  ${path.basename(bp)}  ->  ${path.basename(tp)}`);
  out.push(`  baseline : label=${bh.label} pop=${bh.pop} seed=${bh.seed} treatment=${bh.treatment} fingerprint=${bh.foodFingerprint}`);
  out.push(`  treatment: label=${th.label} pop=${th.pop} seed=${th.seed} treatment=${th.treatment} fingerprint=${th.foodFingerprint}`);

  // ── comparability gate: a mismatch invalidates every number below ────────
  const problems = [];
  if (bh.pop !== th.pop) problems.push(`POPULATION MISMATCH (${bh.pop} vs ${th.pop}) — different denominators, not comparable`);
  if (bh.seed !== th.seed) problems.push(`SEED MISMATCH (${bh.seed} vs ${th.seed}) — this is a seed effect, not a treatment effect`);
  if (bh.foodFingerprint !== th.foodFingerprint) problems.push(`FOOD FINGERPRINT MISMATCH — the two runs saw different nutrition data`);
  const bKeys = new Set(base.map((r) => r.dayKey)), tKeys = new Set(treat.map((r) => r.dayKey));
  const onlyB = [...bKeys].filter((k) => !tKeys.has(k)), onlyT = [...tKeys].filter((k) => !bKeys.has(k));
  if (onlyB.length || onlyT.length) problems.push(`DAY-KEY MISMATCH — ${onlyB.length} only in baseline, ${onlyT.length} only in treatment (a treatment that changes the day SET changes the denominator)`);

  const inst = (rows) => ({
    dis: rows.filter((r) => r.verdictDisagrees).length,
    drift: rows.filter((r) => Math.abs(r.drift?.kcal ?? 0) > 1).length,
    crash: rows.filter((r) => r.crash).length,
    silent: rows.filter((r) => r.honesty && r.honesty.declared === false).length,
  });
  const ib = inst(base), it = inst(treat);
  out.push(`  instrument: baseline disagree ${ib.dis} / drift ${ib.drift} / crash ${ib.crash} / silent-miss ${ib.silent}  ·  treatment ${it.dis} / ${it.drift} / ${it.crash} / ${it.silent}`);
  out.push(`              (disagree, drift, crash must be 0. silent-miss rising is a HONESTY REGRESSION and disqualifies a treatment — BRIEF.md.)`);
  out.push("");
  if (problems.length) { out.push("*** COMPARABILITY PROBLEMS ***"); for (const p of problems) out.push(`  ! ${p}`); out.push(""); }

  const results = {
    satisfiable: report("SATISFIABLE-ONLY (PRIMARY — tier != IMPOSSIBLE, judged days)", base, treat, FILTERS.satisfiable, out),
    all: report("ALL DAYS (secondary — every tier, judged days)", base, treat, FILTERS.all, out),
    planned: report("ALL PLANNED DAYS (refused/empty day counted as a miss)", base, treat, FILTERS.planned, out),
  };

  // Byte-level identity — the strongest possible no-op evidence.
  const bm = new Map(base.map((r) => [r.dayKey, r]));
  const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.run; delete c.solveMs; return JSON.stringify(c); };
  let identical = 0;
  for (const t of treat) { const b = bm.get(t.dayKey); if (b && strip(b) === strip(t)) identical++; }
  out.push(`BYTE-IDENTICAL day records (run header + timing excluded): ${identical}/${treat.length}`);
  if (identical === treat.length) out.push(`  Every record matched. The treatment changed nothing at all.`);
  out.push("");

  console.log(out.join("\n"));
  if (flags.json) {
    const jp = path.resolve(String(flags.json));
    fs.writeFileSync(jp, JSON.stringify({
      tool: "compare.v2.mjs", baselineFile: bp, treatmentFile: tp,
      baselineHeader: bh, treatmentHeader: th, problems,
      instrument: { baseline: ib, treatment: it }, results,
      byteIdentical: identical, total: treat.length,
      generatedAt: new Date().toISOString(),
    }, null, 2) + "\n");
    console.log(`json -> ${jp}`);
  }
  if (problems.length) process.exitCode = 3;
}

main();
