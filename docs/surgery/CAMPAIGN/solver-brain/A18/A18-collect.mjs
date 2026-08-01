// A18/A18-collect.mjs — reads the compare.v2 JSONs the sweep produced and the
// raw JSONL runs, and emits (a) the paired delta table and (b) the per-macro
// failure breakdown that shows the SHAPE of the response surface, not just a
// best point.
//
// Separate file because A18-sweep.mjs guessed compare.v2's JSON key names wrong
// and docs/surgery/CAMPAIGN/ is create-only (A1 hit the same guard; the
// convention is to ship the correction as a new file, never to edit in place).
//
//   node A18-collect.mjs --seed=424242

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));
const SEED = String(argv.seed || "424242");

const ARM = {
  "w-equal": "weights", "w-graderline": "weights", "w-fatheavy": "weights",
  "w-fatcarb": "weights", "w-kcalonly": "weights",
  "c-strict": "slot-comp", "c-firstfit": "slot-comp(NEG CTRL)",
  "s-fallbackcomp": "structural",
  "p-slotsym": "hinge(NEG CTRL)", "p-daysym": "hinge(NEG CTRL)",
  hookidentity: "instrument",
};

const pct = (x) => (x * 100).toFixed(2);

// ── (a) paired deltas ──────────────────────────────────────────────────────
const abs = fs.readdirSync(HERE).filter((f) => f.startsWith("A18-ab-") && f.endsWith(`-s${SEED}.json`));
const table = [];
for (const f of abs.sort()) {
  const name = f.replace("A18-ab-", "").replace(`-s${SEED}.json`, "");
  const j = JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));
  const inst = j.instrument;
  const bad = ["dis", "drift", "crash"].some((k) => inst.baseline[k] || inst.treatment[k]);
  const honesty = inst.treatment.silent - inst.baseline.silent;
  for (const den of ["satisfiable", "all"]) {
    const r = j.results[den];
    table.push({
      variant: name, arm: ARM[name] || "?", den,
      base: `${r.base.k}/${r.base.n}`, basePct: pct(r.base.p),
      treat: `${r.treat.k}/${r.treat.n}`, treatPct: pct(r.treat.p),
      deltaPts: (r.deltaPaired.d * 100).toFixed(2),
      ciLo: (r.deltaPaired.lo * 100).toFixed(2),
      ciHi: (r.deltaPaired.hi * 100).toFixed(2),
      b: r.deltaPaired.b, c: r.deltaPaired.c,
      instrumentBad: bad ? "FAIL" : "ok",
      silentMissDelta: honesty,
    });
  }
}

const cols = Object.keys(table[0] || { x: 1 });
fs.writeFileSync(path.join(HERE, `A18-deltas-s${SEED}.csv`),
  [cols.join(","), ...table.map((r) => cols.map((c) => r[c]).join(","))].join("\n") + "\n");

console.log("PAIRED DELTAS (C14: churning treatment needs |delta| >= ~3.5 pts; b=0 treatment needs ~9 flipped days)\n");
console.log(["variant", "arm", "den", "base", "treat", "delta", "95% CI", "b", "c", "inst"].join("\t"));
for (const r of table.filter((x) => x.den === "satisfiable")) {
  console.log([r.variant, r.arm, r.den, `${r.base}=${r.basePct}%`, `${r.treat}=${r.treatPct}%`,
    `${r.deltaPts>=0?"+":""}${r.deltaPts}`, `${r.ciLo}..${r.ciHi}`, r.b, r.c, r.instrumentBad].join("\t"));
}

// ── (b) per-macro failure shape, satisfiable-only ─────────────────────────
console.log("\nPER-MACRO FAILURE COUNTS (satisfiable-only judged days; a day can fail several)\n");
console.log(["run", "n", "inBand", "failKcal", "failProtein", "failFat", "failCarb", "fatOverOnly", "fatShortOnly"].join("\t"));
const shape = [];
for (const f of fs.readdirSync(HERE).filter((x) => x.startsWith("A18-") && x.endsWith(`-s${SEED}.jsonl`)).sort()) {
  const name = f.replace("A18-", "").replace(`-s${SEED}.jsonl`, "");
  let n = 0, ok = 0, fk = 0, fp = 0, ff = 0, fc = 0, fOver = 0, fShort = 0;
  for (const line of fs.readFileSync(path.join(HERE, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!r.judged || r.satisfiable === false) continue;
    n++;
    const v = r.verdict;
    if (v.inBand) { ok++; continue; }
    if (!v.kcalOk) fk++;
    if (!v.proteinOk) fp++;
    if (!v.fatOk) ff++;
    if (!v.carbOk) fc++;
    if (!v.fatOk && (v.fatOverPct || 0) > 0) fOver++;
    if (!v.fatOk && (v.fatShortPct || 0) > 0) fShort++;
  }
  shape.push({ run: name, n, inBand: ok, failKcal: fk, failProtein: fp, failFat: ff, failCarb: fc, fatOverOnly: fOver, fatShortOnly: fShort });
  console.log([name, n, ok, fk, fp, ff, fc, fOver, fShort].join("\t"));
}
const scols = Object.keys(shape[0] || { x: 1 });
fs.writeFileSync(path.join(HERE, `A18-macroshape-s${SEED}.csv`),
  [scols.join(","), ...shape.map((r) => scols.map((c) => r[c]).join(","))].join("\n") + "\n");
console.log(`\nwrote A18-deltas-s${SEED}.csv and A18-macroshape-s${SEED}.csv`);
