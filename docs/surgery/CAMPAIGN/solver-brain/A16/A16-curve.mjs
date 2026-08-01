// A16-curve.mjs — the enrichment curve, on each corner's OWN denominator (C14).
//
// compare.v2.mjs reports the whole satisfiable-only denominator, where a corner
// worth 57 of 536 days cannot show a resolvable effect however large it is
// locally. C14 requires the corner's own slice. The Wilson and McNemar
// arithmetic below is COPIED FROM compare.v2.mjs (wilson(), pairedDelta()) so
// the two tools cannot disagree; compare.v2.mjs cannot be imported because it
// calls main() at module load.
//
// C14 also requires b and c reported explicitly. Enrichment should only ever
// help (b = 0). A non-zero b means adding recipes BROKE a previously-good day,
// which is a finding about the sampler, not about the pool.
//
//   node A16-curve.mjs --baseline=<f> --diet=vegetarian --runs=<f1,f2,...> [--out=x.csv]
//   --diet=__satisfiable  -> the full satisfiable-only denominator
//   --diet=__all          -> every judged day

import fs from "node:fs";
import path from "node:path";

const Z = 1.959964;
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

function wilson(k, n, z = Z) {
  if (!n) return { k, n, p: null, lo: null, hi: null };
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}
function pairedDelta(baseRows, treatRows, filter) {
  const bm = new Map(baseRows.filter(filter).map((r) => [r.dayKey, r]));
  let n = 0, b = 0, c = 0, unpaired = 0;
  for (const t of treatRows.filter(filter)) {
    const bb = bm.get(t.dayKey);
    if (!bb) { unpaired++; continue; }
    n++;
    const bi = !!bb.verdict?.inBand, ti = !!t.verdict?.inBand;
    if (bi && !ti) b++; else if (!bi && ti) c++;
  }
  if (!n) return { n: 0, b, c, unpaired, d: null, lo: null, hi: null };
  const d = (c - b) / n;
  const se = Math.sqrt(Math.max(0, b + c - ((b - c) ** 2) / n)) / n;
  const chi = b + c > 0 ? ((Math.abs(b - c) - 1) ** 2) / (b + c) : 0;
  return { n, b, c, unpaired, d, lo: d - Z * se, hi: d + Z * se, chi };
}

const read = (p) => fs.readFileSync(path.resolve(p), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pct = (x) => (x == null ? "—" : (x * 100).toFixed(1));
const pts = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(2));

const diet = String(argv.diet || "vegetarian");
const filter = diet === "__satisfiable" ? (r) => r.judged && r.satisfiable !== false
  : diet === "__all" ? (r) => r.judged
    : (r) => r.judged && r.satisfiable !== false && (r.dietStyle || "none") === diet;

const base = read(String(argv.baseline));
const runs = String(argv.runs).split(",").filter(Boolean);

const B = (() => { let k = 0, n = 0; for (const r of base) { if (!filter(r)) continue; n++; if (r.verdict?.inBand) k++; } return wilson(k, n); })();

const rows = [];
rows.push({ run: "baseline", N: 0, k: B.k, n: B.n, pctv: B.p, lo: B.lo, hi: B.hi, b: 0, c: 0, delta: 0, dlo: null, dhi: null, chi: null, synthSlots: 0 });
console.log(`\nA16 CURVE · diet=${diet} · satisfiable-only · seed from run headers`);
console.log(`  N      in band        rate    95% CI (Wilson)     paired delta   b   c    McNemar chi2   synth slots`);
console.log(`  0   ${String(B.k).padStart(4)}/${String(B.n).padEnd(4)} = ${pct(B.p).padStart(5)}%   ${pct(B.lo).padStart(5)}–${pct(B.hi).padStart(5)}%          —        —   —          —              0`);

for (const f of runs) {
  const t = read(f);
  const hdr = t[0]?.run || {};
  const N = Number((hdr.treatment || "").match(/N(\d+)/)?.[1] ?? 0);
  let k = 0, n = 0, synth = 0;
  for (const r of t) {
    if (!filter(r)) continue;
    n++; if (r.verdict?.inBand) k++;
    for (const s of r.slots || []) if (String(s.recipeId || "").startsWith("A16-syn-")) synth++;
  }
  const W = wilson(k, n);
  const P = pairedDelta(base, t, filter);
  rows.push({ run: hdr.treatment, N, k, n, pctv: W.p, lo: W.lo, hi: W.hi, b: P.b, c: P.c, delta: P.d, dlo: P.lo, dhi: P.hi, chi: P.chi, synthSlots: synth });
  console.log(`  ${String(N).padStart(3)} ${String(k).padStart(4)}/${String(n).padEnd(4)} = ${pct(W.p).padStart(5)}%   ${pct(W.lo).padStart(5)}–${pct(W.hi).padStart(5)}%   ${pts(P.d).padStart(7)} pts  ${String(P.b).padStart(3)} ${String(P.c).padStart(3)}   chi2 ${(P.chi ?? 0).toFixed(2).padStart(6)}      ${String(synth).padStart(5)}`);
}

if (argv.out) {
  const out = path.resolve(String(argv.out));
  const hdr = "diet,run,N,inBand,days,rate,wilsonLo,wilsonHi,pairedB,pairedC,deltaPts,deltaLoPts,deltaHiPts,mcnemarChi2,syntheticSlotsUsed";
  fs.writeFileSync(out, [hdr, ...rows.map((r) => [diet, r.run, r.N, r.k, r.n,
    r.pctv == null ? "" : (r.pctv * 100).toFixed(2), r.lo == null ? "" : (r.lo * 100).toFixed(2), r.hi == null ? "" : (r.hi * 100).toFixed(2),
    r.b, r.c, r.delta == null ? "" : (r.delta * 100).toFixed(3), r.dlo == null ? "" : (r.dlo * 100).toFixed(3), r.dhi == null ? "" : (r.dhi * 100).toFixed(3),
    r.chi == null ? "" : r.chi.toFixed(3), r.synthSlots].join(","))].join("\n") + "\n");
  console.log(`\n  csv -> ${out}`);
}
