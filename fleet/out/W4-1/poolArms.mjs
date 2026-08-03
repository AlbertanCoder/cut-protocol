// poolArms.mjs — W4-1 (reproduce). Pool dayDump JSONL dumps by ARM across seeds
// and report every denominator, plus paired b/c against a named base arm.
//
//   node fleet/out/W4-1/poolArms.mjs --dir=<dir> --pat="dump-{arm}-s{seed}.jsonl" \
//        --arms=base,c14_c2,trim,c14_c2_trim --seeds=424242,20260730,8675309 \
//        --base=base [--json=out.json]
//
// PURE ARITHMETIC on stored records. No solve, no DB, no network.
//
// DENOMINATORS (W1-2 §3) — all six, always named, never one alone:
//   planned 640 · planned−degen 639 · judged 623 · sat-planned 554
//   · sat-planned−degen 553 (CANONICAL) · sat-judged 537       (per seed)
// Pooled over 3 seeds those become 1920 / 1917 / 1869 / 1662 / 1659 / 1611.
//
// A6 TRAP: `judged` drops zero-slot days, so an arm that REFUSES more days
// scores higher on it. Both `judged` and `planned` are printed for every arm and
// the refusal count is printed beside them, so the trap is visible rather than
// silent.
import fs from "node:fs";
import path from "node:path";

const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const DIR = path.resolve(String(argv.dir));
const PAT = String(argv.pat || "dump-{arm}-s{seed}.jsonl");
const ARMS = String(argv.arms).split(",");
const SEEDS = String(argv.seeds || "424242,20260730,8675309").split(",");
const BASE = String(argv.base || ARMS[0]);

const read = (p) => fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const key = (r) => `${r.personaId}#${r.dayIndex}`;
const SEL = {
  planned: () => true,
  plannedMinusDegen: (r) => r.slotsTotal > 0,
  judged: (r) => r.judged,
  satPlanned: (r) => r.satisfiable,
  satPlannedMinusDegen: (r) => r.satisfiable && r.slotsTotal > 0,
  satJudged: (r) => r.satisfiable && r.judged,
};

const loaded = {};
for (const arm of ARMS) {
  loaded[arm] = {};
  for (const s of SEEDS) {
    const f = path.join(DIR, PAT.replace("{arm}", arm).replace("{seed}", s));
    if (!fs.existsSync(f)) { console.error(`MISSING ${f}`); process.exit(2); }
    loaded[arm][s] = read(f);
  }
}

function pooled(arm) {
  const o = {};
  for (const [name, f] of Object.entries(SEL)) {
    let n = 0, k = 0;
    for (const s of SEEDS) { const rs = loaded[arm][s].filter(f); n += rs.length; k += rs.filter((r) => r.verdict?.inBand).length; }
    o[name] = { n, k, pct: n ? Math.round((k / n) * 10000) / 100 : null };
  }
  o.refusedDays = SEEDS.reduce((a, s) => a + loaded[arm][s].filter((r) => r.slotsTotal > 0 && !r.judged).length, 0);
  o.perSeedCanonical = SEEDS.map((s) => { const rs = loaded[arm][s].filter(SEL.satPlannedMinusDegen); return Math.round((rs.filter((r) => r.verdict?.inBand).length / rs.length) * 10000) / 100; });
  return o;
}

function paired(armA, armB, sel) {
  let b = 0, c = 0, bb = 0, ff = 0;
  for (const s of SEEDS) {
    const mb = new Map(loaded[armB][s].map((r) => [key(r), r]));
    for (const r of loaded[armA][s].filter(sel)) {
      const o = mb.get(key(r)); if (!o) continue;
      const x = !!r.verdict?.inBand, y = !!o.verdict?.inBand;
      if (x && y) bb++; else if (!x && !y) ff++; else if (x) b++; else c++;
    }
  }
  const a5 = 1.96 * Math.sqrt(b + c);
  return { bothPass: bb, bothFail: ff, b, c, net: c - b, a5: Math.round(a5 * 100) / 100, clears: Math.abs(b - c) > a5 };
}

const res = {};
for (const arm of ARMS) res[arm] = pooled(arm);
const baseCanon = res[BASE].satPlannedMinusDegen.pct, baseSatJ = res[BASE].satJudged.pct, basePl = res[BASE].planned.pct;

console.log(`\nPOOLED over seeds ${SEEDS.join("/")} · dir ${DIR}\n`);
console.log(`arm                sat-judged(1611)      Δ   | canonical 553x3(1659)      Δ   | all-planned(1920)      Δ   | refused`);
for (const arm of ARMS) {
  const r = res[arm];
  const f = (o, base) => `${String(o.k).padStart(4)}/${o.n} ${String(o.pct.toFixed(2)).padStart(6)}%  ${String(((o.pct - base) >= 0 ? "+" : "") + (o.pct - base).toFixed(2)).padStart(6)}`;
  console.log(`  ${arm.padEnd(14)} ${f(r.satJudged, baseSatJ)}  | ${f(r.satPlannedMinusDegen, baseCanon)}  | ${f(r.planned, basePl)}  | ${String(r.refusedDays).padStart(4)}`);
}
console.log(`\nper-seed canonical (n=553):`);
for (const arm of ARMS) console.log(`  ${arm.padEnd(14)} ${res[arm].perSeedCanonical.map((x) => x.toFixed(2) + "%").join("  ")}`);
console.log(`\npaired vs ${BASE} on canonical (sat-planned−degenerate):`);
const pairs = {};
for (const arm of ARMS) { if (arm === BASE) continue; const p = paired(BASE, arm, SEL.satPlannedMinusDegen); pairs[arm] = p; console.log(`  ${arm.padEnd(14)} b=${String(p.b).padStart(3)} c=${String(p.c).padStart(3)} net=${String(p.net).padStart(4)} |b-c|=${String(Math.abs(p.b - p.c)).padStart(3)} vs A5 ${String(p.a5).padStart(6)} => ${p.clears ? "CLEARS" : "does NOT clear"}`);
}
const out = { dir: DIR, seeds: SEEDS, arms: res, pairedVsBase: pairs, base: BASE };
if (argv.json) { fs.writeFileSync(path.resolve(String(argv.json)), JSON.stringify(out, null, 2)); console.log(`\njson -> ${argv.json}`); }
