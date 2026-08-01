// scoreDays.mjs — W1-1 (harness-truth). Score or A/B a dayDump JSONL.
//
//   node backend/scripts/qc/scoreDays.mjs <dump.jsonl>                  # level
//   node backend/scripts/qc/scoreDays.mjs <base.jsonl> <treat.jsonl>    # A/B
//   ... [--json=out.json] [--ruler=product|kcal5|fatwide:0.5|nofat|nocarb]
//
// WHY IT EXISTS — the A6 fix, in the form the brief prescribes.
// `A1/rig/schema.mjs:83` sets `judged: filled.length > 0`, so the rig's PRIMARY
// denominator silently discards every day the solver failed to fill at all.
// MEASURED on this tree, pop=personas seed=424242: **16 of 639 planned days are
// unjudged, and all 16 are SATISFIABLE total failures.** A treatment that
// refuses MORE hard days therefore raises the reported rate while helping
// nobody. `compare.v2.mjs` already computes an all-planned-days line but prints
// it third, as one section among three that a reader may skip.
//
// This tool does not change anyone's primary denominator. It makes the
// all-planned line MANDATORY: it is printed first, it is printed last, and the
// unjudged count is printed next to every rate. Refusing to publish it is not
// an option the tool offers.
//
// RE-SCORING WITHOUT RE-SOLVING is the other half. dayDump records carry the
// four achieved macros AND the four target bands, so a different ruler is pure
// arithmetic on the file — no solve, no DB, no RNG. `--ruler=` picks one:
//
//   product          the shipping 4-macro rule as recorded (default; verifies
//                    against the stored booleans and REFUSES on disagreement)
//   kcal5            oracle.mjs's bar: |kcalDev| <= 5% AND protein >= lo-5g,
//                    NO fat/carb term. A THIRD ruler — never mix with "in band".
//   fatwide:<x>      the product rule with the fat allowance widened to x
//                    (brief C9/A15: fat +-50% is `--ruler=fatwide:0.5`)
//   carbwide:<x>     ditto for carbs (keto's over-allowance stays 0)
//   nofat / nocarb   the product rule with that macro dropped — isolates how
//                    much of the failure each macro is actually carrying
//
// Statistics: same as compare.v2.mjs — Wilson for a level, Newcombe for an
// unpaired delta, McNemar for the PAIRED delta (a same-seed A/B is a paired
// design and the discordant counts b/c are the sensitive statistic). The paired
// interval is the one to judge on.
import fs from "node:fs";
import path from "node:path";

const Z = 1.959964;

export function wilson(k, n, z = Z) {
  if (!n) return { k, n, p: null, lo: null, hi: null };
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}
export function newcombeDiff(k1, n1, k2, n2, z = Z) {
  const a = wilson(k1, n1, z), b = wilson(k2, n2, z);
  if (a.p == null || b.p == null) return { d: null, lo: null, hi: null };
  const d = a.p - b.p;
  return { d, lo: d - Math.sqrt((a.p - a.lo) ** 2 + (b.hi - b.p) ** 2), hi: d + Math.sqrt((a.hi - a.p) ** 2 + (b.p - b.lo) ** 2) };
}

const readJsonl = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const pc = (x) => (x == null ? "   —  " : (x * 100).toFixed(1).padStart(5) + "%");
const pp = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + " pts");

// ── rulers. Every one is a pure function of a stored record. ────────────────
const bandMiss = (v, lo, hi) => {
  const mid = (lo + hi) / 2;
  if (!(mid > 0)) return { shortPct: 0, overPct: 0, mid };
  const val = Number.isFinite(v) ? v : 0;
  if (val < lo) return { shortPct: (lo - val) / mid, overPct: 0, mid };
  if (val > hi) return { shortPct: 0, overPct: (val - hi) / mid, mid };
  return { shortPct: 0, overPct: 0, mid };
};
const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;

/** Recompute the PRODUCT rule from stored fields, with optional per-macro overrides. */
function productRule(r, { kcalTol = 0.15, proteinTol = 0.15, fatTol = 0.25, carbTol = 0.25, dropFat = false, dropCarb = false } = {}) {
  const t = r.target || {}, a = r.achieved || {};
  const pMid = Number.isFinite(t.proteinMid) ? t.proteinMid : ((t.proteinLo + t.proteinHi) / 2);
  const kcalDeltaPct = t.kcal > 0 ? (a.kcal - t.kcal) / t.kcal : 1;
  const proteinShortPct = pMid > 0 ? Math.max(0, (pMid - a.protein) / pMid) : 0;
  const fatBand = !dropFat && hasBand(t.fatLo, t.fatHi);
  const carbBand = !dropCarb && hasBand(t.carbLo, t.carbHi);
  const fat = fatBand ? bandMiss(a.fat, t.fatLo, t.fatHi) : { shortPct: 0, overPct: 0 };
  const carb = carbBand ? bandMiss(a.carb, t.carbLo, t.carbHi) : { shortPct: 0, overPct: 0 };
  const carbOverAllowance = t.keto ? 0 : carbTol;
  const kcalOk = Math.abs(kcalDeltaPct) <= kcalTol;
  const proteinOk = proteinShortPct <= proteinTol;
  const fatOk = !fatBand || (fat.shortPct <= fatTol && fat.overPct <= fatTol);
  const carbOk = !carbBand || (carb.shortPct <= carbTol && carb.overPct <= carbOverAllowance);
  return { inBand: kcalOk && proteinOk && fatOk && carbOk, kcalOk, proteinOk, fatOk, carbOk };
}

/** oracle.mjs's acceptOk (oracle.mjs:38-39, :194). A DIFFERENT RULER — labelled as such. */
function kcal5Rule(r) {
  const t = r.target || {}, a = r.achieved || {};
  const kcalDev = t.kcal > 0 ? (a.kcal - t.kcal) / t.kcal : 1;
  const ok = Math.abs(kcalDev) <= 0.05 && a.protein >= (t.proteinLo ?? 0) - 5;
  return { inBand: ok, kcalOk: Math.abs(kcalDev) <= 0.05, proteinOk: a.protein >= (t.proteinLo ?? 0) - 5, fatOk: null, carbOk: null };
}

function makeRuler(spec) {
  const s = String(spec || "product");
  if (s === "product") return { id: "product/dayTolerance (as recorded)", stored: true, fn: (r) => ({ inBand: !!r.verdict?.inBand }) };
  if (s === "product-recomputed") return { id: "product/dayTolerance (recomputed from stored macros)", fn: (r) => productRule(r) };
  if (s === "kcal5") return { id: "oracle/acceptOk — kcal +-5%, protein >= lo-5g, NO fat/carb term", warn: true, fn: kcal5Rule };
  if (s === "nofat") return { id: "product minus the fat term", fn: (r) => productRule(r, { dropFat: true }) };
  if (s === "nocarb") return { id: "product minus the carb term", fn: (r) => productRule(r, { dropCarb: true }) };
  const w = s.match(/^(fat|carb)wide:([0-9.]+)$/);
  if (w) {
    const x = Number(w[2]);
    return { id: `product with the ${w[1]} allowance widened to +-${(x * 100).toFixed(0)}% of band mid`, fn: (r) => productRule(r, w[1] === "fat" ? { fatTol: x } : { carbTol: x }) };
  }
  throw new Error(`unknown --ruler=${s}`);
}

// ── denominators. NEVER interchangeable, ALWAYS all three. ──────────────────
const FILTERS = {
  planned: () => true,
  satisfiable: (r) => r.judged && r.satisfiable !== false,
  all: (r) => r.judged,
};

function tally(rows, filter, ok) {
  let n = 0, k = 0, unjudged = 0, unjudgedSat = 0, degenerate = 0;
  for (const r of rows) {
    if (!filter(r)) continue;
    n++; if (ok(r)) k++;
    if (r.degenerate) degenerate++;
    // A6's count is SOLVER total failures. A 0-slot config never gave the
    // solver anything to fail at, so it is reported on its own line.
    if (!r.judged) { unjudged++; if (r.satisfiable !== false && !r.degenerate) unjudgedSat++; }
  }
  return { k, n, unjudged, unjudgedSat, degenerate };
}

export function pairedDelta(baseRows, treatRows, filter, ok) {
  const bm = new Map(baseRows.filter(filter).map((r) => [r.dayKey, r]));
  let n = 0, b = 0, c = 0, unpaired = 0;
  for (const t of treatRows.filter(filter)) {
    const bb = bm.get(t.dayKey);
    if (!bb) { unpaired++; continue; }
    n++;
    const bi = ok(bb), ti = ok(t);
    if (bi && !ti) b++; else if (!bi && ti) c++;
  }
  if (!n) return { n: 0, b, c, unpaired, d: null, lo: null, hi: null, thin: true, chi: 0 };
  const d = (c - b) / n;
  const se = Math.sqrt(Math.max(0, b + c - ((b - c) ** 2) / n)) / n;
  const chi = b + c > 0 ? ((Math.abs(b - c) - 1) ** 2) / (b + c) : 0;
  // Brief A5's minimum detectable effect, stated per comparison rather than
  // remembered: real at 95% iff |b - c| > 1.96*sqrt(b + c).
  const mde = 1.959964 * Math.sqrt(b + c);
  return { n, b, c, unpaired, d, lo: d - Z * se, hi: d + Z * se, thin: b + c < 10, chi, mde, clearsMde: Math.abs(b - c) > mde };
}

function levelBlock(rows, ruler, out, tag = "") {
  const ok = ruler.fn ? (r) => !!ruler.fn(r).inBand : (r) => !!r.verdict?.inBand;
  const P = tally(rows, FILTERS.planned, ok), S = tally(rows, FILTERS.satisfiable, ok), A = tally(rows, FILTERS.all, ok);
  const WP = wilson(P.k, P.n), WS = wilson(S.k, S.n), WA = wilson(A.k, A.n);
  out.push(`LEVEL${tag ? " " + tag : ""}  ruler = ${ruler.id}`);
  // The all-planned line is FIRST, by construction. See the header.
  out.push(`  ALL PLANNED DAYS  (MANDATORY CO-REPORT)  ${String(P.k).padStart(4)}/${String(P.n).padEnd(4)} = ${pc(WP.p)}   95% CI ${pc(WP.lo)}-${pc(WP.hi)}   unjudged ${P.unjudged} (satisfiable ${P.unjudgedSat})`);
  out.push(`  SATISFIABLE-ONLY  (judged, tier != IMPOSSIBLE) ${String(S.k).padStart(4)}/${String(S.n).padEnd(4)} = ${pc(WS.p)}   95% CI ${pc(WS.lo)}-${pc(WS.hi)}`);
  out.push(`  ALL DAYS          (judged, every tier)         ${String(A.k).padStart(4)}/${String(A.n).padEnd(4)} = ${pc(WA.p)}   95% CI ${pc(WA.lo)}-${pc(WA.hi)}`);
  if (P.unjudgedSat > 0) {
    out.push(`  ! ${P.unjudgedSat} SATISFIABLE solver total-failure day(s) are excluded from both judged denominators.`);
    out.push(`    A treatment that refuses more of them RAISES the judged rate and is flat on the planned rate (A6).`);
  }
  if (P.degenerate > 0) {
    out.push(`  ! ${P.degenerate} DEGENERATE day(s) (meal config asks for 0 slots). A1/rig/runRig.mjs emits no record for these at all,`);
    out.push(`    so its all-planned n is ${P.n - P.degenerate}, not ${P.n}. Subtract ${P.degenerate} before comparing with a published rig figure.`);
  }
  out.push("");
  return { planned: { ...P, ...WP }, satisfiable: { ...S, ...WS }, all: { ...A, ...WA } };
}

function abBlock(name, baseRows, treatRows, filter, ok, out) {
  const base = tally(baseRows, filter, ok), treat = tally(treatRows, filter, ok);
  const B = wilson(base.k, base.n), T = wilson(treat.k, treat.n);
  const D = newcombeDiff(treat.k, treat.n, base.k, base.n);
  const P = pairedDelta(baseRows, treatRows, filter, ok);
  out.push(name);
  out.push(`  baseline   ${String(base.k).padStart(4)}/${String(base.n).padEnd(4)} = ${pc(B.p)}   95% CI ${pc(B.lo)}-${pc(B.hi)}   unjudged ${base.unjudged} (sat ${base.unjudgedSat})`);
  out.push(`  treatment  ${String(treat.k).padStart(4)}/${String(treat.n).padEnd(4)} = ${pc(T.p)}   95% CI ${pc(T.lo)}-${pc(T.hi)}   unjudged ${treat.unjudged} (sat ${treat.unjudgedSat})`);
  out.push(`  DELTA unpaired (Newcombe/Wilson)  ${pp(D.d)}   95% CI ${pp(D.lo)} … ${pp(D.hi)}`);
  out.push(`  DELTA paired   (McNemar)          ${pp(P.d)}   95% CI ${pp(P.lo)} … ${pp(P.hi)}   discordant b=${P.b} c=${P.c}${P.thin ? "  [b+c<10: trust the counts, not this CI]" : ""}`);
  out.push(`  MDE (A5)   |b-c| = ${Math.abs(P.b - P.c)} vs 1.96*sqrt(b+c) = ${(P.mde ?? 0).toFixed(2)}  ->  ${P.clearsMde ? "CLEARS" : "DOES NOT CLEAR"} the detection floor`);
  const dpts = P.d == null ? null : P.d * 100;
  if (dpts == null) out.push(`  VERDICT    no data`);
  else if (P.b === 0 && P.c === 0) out.push(`  VERDICT    ZERO days changed verdict — an exact no-op on this denominator.`);
  else if (Math.abs(dpts) < 1.5) out.push(`  VERDICT    NOISE, NOT A RESULT — |${dpts.toFixed(2)}| pts is inside the +/-1.5 pt run-to-run variance floor.`);
  else if (P.lo <= 0 && P.hi >= 0) out.push(`  VERDICT    NOT DISTINGUISHABLE FROM ZERO — the paired 95% interval spans 0.`);
  else out.push(`  VERDICT    clears the +/-1.5 pt noise floor AND the paired interval excludes 0 (McNemar chi2=${P.chi.toFixed(2)}; 3.84 = p<0.05).`);
  out.push("");
  return { base: B, treat: T, deltaUnpaired: D, deltaPaired: P, unjudged: { base: base.unjudged, treat: treat.unjudged, baseSat: base.unjudgedSat, treatSat: treat.unjudgedSat } };
}

function header(rows, label, out) {
  const h = rows[0]?.run || {};
  out.push(`  ${label}: label=${h.label} pop=${h.pop} seed=${h.seed} poolShape="${h.poolShape ?? "?"}"`);
  out.push(`            db=${String(h.dbSha256 ?? "?").slice(0, 16)} food=${String(h.foodFingerprint ?? "?").slice(0, 16)} git=${String(h.gitSha ?? "?").slice(0, 12)} diff="${h.gitDiffStat ?? "?"}" personas=${String(h.personasSha256 ?? "?").slice(0, 16)}`);
  return h;
}

function instrument(rows) {
  return {
    dis: rows.filter((r) => r.verdictDisagrees).length,
    drift: rows.filter((r) => Math.abs(r.drift?.kcal ?? 0) > 1).length,
    crash: rows.filter((r) => r.crash).length,
    silent: rows.filter((r) => r.honesty && r.honesty.declared === false).length,
    missingFood: rows.reduce((s, r) => s + (r.drift?.missingFoodRows ?? 0), 0),
  };
}

/**
 * Self-check: the stored per-check booleans must reconcile with the stored
 * verdict, AND recomputing the product rule from the stored macros must
 * reproduce both. If they disagree the dump is not a valid substrate for
 * re-scoring and the tool says so instead of quietly averaging it.
 */
function reconcile(rows) {
  let andMismatch = 0, recomputeMismatch = 0, checked = 0;
  for (const r of rows) {
    if (!r.verdict || typeof r.verdict.inBand !== "boolean") continue;
    checked++;
    const AND = r.verdict.kcalOk && r.verdict.proteinOk && r.verdict.fatOk && r.verdict.carbOk;
    if (AND !== r.verdict.inBand) andMismatch++;
    if (productRule(r).inBand !== r.verdict.inBand) recomputeMismatch++;
  }
  return { checked, andMismatch, recomputeMismatch };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--"))
    .map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
  if (!args.length) { console.error("usage: node scoreDays.mjs <dump.jsonl> [<treatment.jsonl>] [--ruler=…] [--json=out.json]"); process.exit(2); }

  const ruler = makeRuler(flags.ruler);
  const out = [];
  const base = readJsonl(path.resolve(args[0]));
  const treat = args[1] ? readJsonl(path.resolve(args[1])) : null;

  out.push(`SCORE-DAYS  ${path.basename(args[0])}${treat ? `  ->  ${path.basename(args[1])}` : ""}`);
  const bh = header(base, "baseline ", out);
  const th = treat ? header(treat, "treatment", out) : null;
  out.push("");

  const rb = reconcile(base), rt = treat ? reconcile(treat) : null;
  const ib = instrument(base), it = treat ? instrument(treat) : null;
  out.push(`RECONCILIATION (stored booleans vs stored verdict vs recomputation from stored macros)`);
  out.push(`  baseline  checked ${rb.checked} · AND-mismatch ${rb.andMismatch} · recompute-mismatch ${rb.recomputeMismatch}  (both must be 0)`);
  if (rt) out.push(`  treatment checked ${rt.checked} · AND-mismatch ${rt.andMismatch} · recompute-mismatch ${rt.recomputeMismatch}`);
  out.push(`INSTRUMENT`);
  out.push(`  baseline  disagree ${ib.dis} · kcal-drift>1 ${ib.drift} · crash ${ib.crash} · missing-food ${ib.missingFood} · silent-miss ${ib.silent}`);
  if (it) out.push(`  treatment disagree ${it.dis} · kcal-drift>1 ${it.drift} · crash ${it.crash} · missing-food ${it.missingFood} · silent-miss ${it.silent}`);
  out.push(`  (disagree, drift, crash must be 0. silent-miss RISING is an honesty regression and disqualifies a treatment.)`);
  out.push("");
  if (ruler.warn) {
    out.push(`*** RULER WARNING: "${ruler.id}" is NOT the product's rule. Numbers under it must never share a`);
    out.push(`    table with "days in band". Label every one of them with this ruler id. ***`);
    out.push("");
  }

  const problems = [];
  if (treat) {
    if (bh.pop !== th.pop) problems.push(`POPULATION MISMATCH (${bh.pop} vs ${th.pop})`);
    if (bh.seed !== th.seed) problems.push(`SEED MISMATCH (${bh.seed} vs ${th.seed}) — this is a seed effect, not a treatment effect`);
    if (bh.foodFingerprint !== th.foodFingerprint) problems.push(`FOOD FINGERPRINT MISMATCH — the two runs saw different nutrition data`);
    if (bh.dbSha256 !== th.dbSha256) problems.push(`DB SHA MISMATCH`);
    if (bh.poolShape !== th.poolShape) problems.push(`POOL SHAPE MISMATCH (${bh.poolShape} vs ${th.poolShape}) — route and rig pool shapes are not comparable`);
    if (bh.gitSha !== th.gitSha || bh.gitDiffStat !== th.gitDiffStat) problems.push(`WORKING TREE MISMATCH (git ${bh.gitSha} "${bh.gitDiffStat}" vs ${th.gitSha} "${th.gitDiffStat}") — the baseline is a working tree, not a commit`);
    const bK = new Set(base.map((r) => r.dayKey)), tK = new Set(treat.map((r) => r.dayKey));
    const onlyB = [...bK].filter((k) => !tK.has(k)).length, onlyT = [...tK].filter((k) => !bK.has(k)).length;
    if (onlyB || onlyT) problems.push(`DAY-KEY MISMATCH — ${onlyB} only in baseline, ${onlyT} only in treatment`);
    if (problems.length) { out.push("*** COMPARABILITY PROBLEMS ***"); for (const p of problems) out.push(`  ! ${p}`); out.push(""); }
  }

  const ok = ruler.fn ? (r) => !!ruler.fn(r).inBand : (r) => !!r.verdict?.inBand;
  let results;
  if (!treat) {
    results = { level: levelBlock(base, ruler, out) };
  } else {
    results = {
      baselineLevel: levelBlock(base, ruler, out, "(baseline)"),
      treatmentLevel: levelBlock(treat, ruler, out, "(treatment)"),
      planned: abBlock("A/B — ALL PLANNED DAYS (MANDATORY CO-REPORT — refusals counted as misses)", base, treat, FILTERS.planned, ok, out),
      satisfiable: abBlock("A/B — SATISFIABLE-ONLY (judged days, tier != IMPOSSIBLE)", base, treat, FILTERS.satisfiable, ok, out),
      all: abBlock("A/B — ALL DAYS (judged days, every tier)", base, treat, FILTERS.all, ok, out),
    };
    const bm = new Map(base.map((r) => [r.dayKey, r]));
    const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.run; delete c.solveMs; return JSON.stringify(c); };
    let identical = 0;
    for (const t of treat) { const b = bm.get(t.dayKey); if (b && strip(b) === strip(t)) identical++; }
    out.push(`BYTE-IDENTICAL day records (run header + timing excluded): ${identical}/${treat.length}`);
    if (identical === treat.length) out.push(`  Every record matched. The treatment changed nothing at all.`);
    out.push("");
    // Repeat the mandatory line last, so a reader who skimmed still sees it.
    const P = results.planned;
    out.push(`>> HEADLINE ON THE MANDATORY DENOMINATOR (all planned days): baseline ${P.base.k}/${P.base.n} = ${pc(P.base.p)} -> treatment ${P.treat.k}/${P.treat.n} = ${pc(P.treat.p)}  ·  paired ${pp(P.deltaPaired.d)} (b=${P.deltaPaired.b} c=${P.deltaPaired.c})`);
    out.push(`   unjudged: baseline ${P.unjudged.base} (sat ${P.unjudged.baseSat}) -> treatment ${P.unjudged.treat} (sat ${P.unjudged.treatSat}). A RISE here is a treatment refusing days, not solving them.`);
  }

  console.log(out.join("\n"));
  if (flags.json) {
    const jp = path.resolve(String(flags.json));
    fs.writeFileSync(jp, JSON.stringify({
      tool: "backend/scripts/qc/scoreDays.mjs", ruler: ruler.id,
      baselineFile: path.resolve(args[0]), treatmentFile: args[1] ? path.resolve(args[1]) : null,
      baselineHeader: bh, treatmentHeader: th, problems,
      reconciliation: { baseline: rb, treatment: rt },
      instrument: { baseline: ib, treatment: it },
      results, generatedAt: new Date().toISOString(),
    }, null, 2) + "\n");
    console.log(`json -> ${jp}`);
  }
  if (rb.andMismatch || rb.recomputeMismatch || (rt && (rt.andMismatch || rt.recomputeMismatch))) process.exitCode = 4;
  else if (problems.length) process.exitCode = 3;
}

main();
