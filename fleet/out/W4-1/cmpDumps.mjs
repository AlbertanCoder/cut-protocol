// cmpDumps.mjs — W4-1 (reproduce). Pair two dayDump JSONL dumps record-by-record.
//
//   node fleet/out/W4-1/cmpDumps.mjs <a.jsonl> <b.jsonl> [--json=out.json]
//
// PURE ARITHMETIC. No DB, no solve, no network.
//
// The `run` block is per-record provenance (label, agentId, dbPath, gitSha,
// gitBranch, startedAt). It differs between any two runs BY CONSTRUCTION and
// says nothing about the measurement, so it is stripped before comparison and
// its divergences are reported separately. Everything else — target, achieved,
// verdict, slots, closer, honesty — must match for a run to be called a
// byte-exact reproduction.
//
// DENOMINATORS: all six of W1-2 §3 are computed and named. Never one alone.
import fs from "node:fs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const jsonOut = (args.find((a) => a.startsWith("--json=")) || "").slice(7);
if (files.length !== 2) { console.error("need exactly 2 dumps"); process.exit(2); }

const read = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const key = (r) => `${r.personaId}#${r.dayIndex}`;
const strip = (r) => { const { run, ...rest } = r; return rest; };

const A = read(files[0]), B = read(files[1]);
const mapA = new Map(A.map((r) => [key(r), r])), mapB = new Map(B.map((r) => [key(r), r]));

// ── denominators (W1-2 §3) ──────────────────────────────────────────────────
function denoms(rows) {
  const planned = rows.length;
  const degenerate = rows.filter((r) => r.slotsTotal === 0).length;
  const judged = rows.filter((r) => r.judged).length;
  const sat = rows.filter((r) => r.satisfiable);
  const satPlanned = sat.length;
  const satPlannedMinusDegen = sat.filter((r) => r.slotsTotal > 0).length;
  const satJudged = sat.filter((r) => r.judged).length;
  const ib = (rs) => rs.filter((r) => r.verdict?.inBand).length;
  return {
    planned: { n: planned, k: ib(rows) },
    plannedMinusDegen: { n: planned - degenerate, k: ib(rows.filter((r) => r.slotsTotal > 0)) },
    judged: { n: judged, k: ib(rows.filter((r) => r.judged)) },
    satPlanned: { n: satPlanned, k: ib(sat) },
    satPlannedMinusDegen: { n: satPlannedMinusDegen, k: ib(sat.filter((r) => r.slotsTotal > 0)) },
    satJudged: { n: satJudged, k: ib(sat.filter((r) => r.judged)) },
  };
}
const pct = (o) => (o.n ? ((o.k / o.n) * 100).toFixed(2) : "—");

// ── pairing ─────────────────────────────────────────────────────────────────
const onlyA = [...mapA.keys()].filter((k) => !mapB.has(k));
const onlyB = [...mapB.keys()].filter((k) => !mapA.has(k));
const shared = [...mapA.keys()].filter((k) => mapB.has(k));

let identical = 0, contentDiff = 0;
let b = 0, c = 0, bothPass = 0, bothFail = 0;          // b = A-pass/B-fail, c = A-fail/B-pass
const fieldDiffs = new Map();
const targetFieldDiffs = new Map();
const flipsB = [], flipsC = [];
for (const k of shared) {
  const ra = strip(mapA.get(k)), rb = strip(mapB.get(k));
  const sa = JSON.stringify(ra), sb = JSON.stringify(rb);
  if (sa === sb) identical++;
  else {
    contentDiff++;
    for (const f of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (JSON.stringify(ra[f]) !== JSON.stringify(rb[f])) fieldDiffs.set(f, (fieldDiffs.get(f) || 0) + 1);
    }
    const ta = ra.target || {}, tb = rb.target || {};
    for (const f of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
      if (JSON.stringify(ta[f]) !== JSON.stringify(tb[f])) targetFieldDiffs.set(f, (targetFieldDiffs.get(f) || 0) + 1);
    }
  }
  const pa = !!mapA.get(k).verdict?.inBand, pb = !!mapB.get(k).verdict?.inBand;
  if (pa && pb) bothPass++; else if (!pa && !pb) bothFail++;
  else if (pa && !pb) { b++; flipsB.push(k); } else { c++; flipsC.push(k); }
}

// McNemar-style detection floor, the fleet's A5 convention: |b-c| must clear
// 1.96*sqrt(b+c) before a paired difference is called real.
const A5 = 1.96 * Math.sqrt(b + c);

const dA = denoms(A), dB = denoms(B);
const runDiffs = {};
if (A.length && B.length) {
  const ra = A[0].run || {}, rb = B[0].run || {};
  for (const f of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (JSON.stringify(ra[f]) !== JSON.stringify(rb[f])) runDiffs[f] = [ra[f], rb[f]];
  }
}

const out = {
  a: files[0], b: files[1],
  records: { a: A.length, b: B.length, shared: shared.length, onlyA: onlyA.length, onlyB: onlyB.length },
  identicalRecords: identical, contentDiffRecords: contentDiff,
  verdict: { bothPass, bothFail, aPass_bFail: b, aFail_bPass: c, net: c - b, absBC: Math.abs(b - c), a5Floor: Math.round(A5 * 100) / 100, clearsA5: Math.abs(b - c) > A5 },
  fieldDiffs: Object.fromEntries([...fieldDiffs].sort((x, y) => y[1] - x[1])),
  targetFieldDiffs: Object.fromEntries([...targetFieldDiffs].sort((x, y) => y[1] - x[1])),
  denominators: { a: dA, b: dB },
  runProvenanceDiffs: runDiffs,
  flipSampleB: flipsB.slice(0, 15), flipSampleC: flipsC.slice(0, 15),
};

console.log(`\n=== ${files[0]}\n=== ${files[1]}\n`);
console.log(`records      A=${A.length} B=${B.length} shared=${shared.length} onlyA=${onlyA.length} onlyB=${onlyB.length}`);
console.log(`content      identical=${identical}  differing=${contentDiff}   (provenance 'run' block excluded)`);
console.log(`verdict 2x2  bothPass=${bothPass} bothFail=${bothFail} A-pass/B-fail(b)=${b} A-fail/B-pass(c)=${c}  net=${c - b}  |b-c|=${Math.abs(b - c)} vs A5 floor ${A5.toFixed(2)} => ${Math.abs(b - c) > A5 ? "CLEARS" : "does NOT clear"}`);
console.log(`\ndenominator                     A                B              delta pp`);
for (const [name, label] of [["planned", "planned (640)"], ["plannedMinusDegen", "planned-degen (639)"], ["judged", "judged (623)"], ["satPlanned", "sat-planned (554)"], ["satPlannedMinusDegen", "sat-planned-degen (553)"], ["satJudged", "sat-judged (537)"]]) {
  const x = dA[name], y = dB[name];
  const d = x.n && y.n ? ((y.k / y.n - x.k / x.n) * 100).toFixed(2) : "—";
  console.log(`  ${label.padEnd(24)} ${String(x.k + "/" + x.n).padStart(8)} ${pct(x).padStart(6)}%  ${String(y.k + "/" + y.n).padStart(8)} ${pct(y).padStart(6)}%   ${String(d).padStart(7)}`);
}
if (fieldDiffs.size) { console.log(`\nfields differing (record count):`); for (const [f, n] of [...fieldDiffs].sort((x, y) => y[1] - x[1])) console.log(`  ${f.padEnd(20)} ${n}`); }
if (targetFieldDiffs.size) { console.log(`\ntarget sub-fields differing:`); for (const [f, n] of [...targetFieldDiffs].sort((x, y) => y[1] - x[1])) console.log(`  ${f.padEnd(20)} ${n}`); }
console.log(`\nprovenance ('run') divergences: ${Object.keys(runDiffs).join(", ") || "none"}`);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log(`\njson -> ${jsonOut}`); }
