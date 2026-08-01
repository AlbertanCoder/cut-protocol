// A18/A18-sweep.mjs — objective-constant sweep driver.
//
// Runs the A1 rig once per variant through a18-hook.cjs (which patches the
// objective constant in memory at require-time; backend/src is never written),
// then runs compare.v2.mjs baseline-vs-variant and collects the paired McNemar
// deltas into one CSV.
//
//   node A18-sweep.mjs --seed=424242 --only=w-equal,w-graderline
//
// Every variant names the EXACT source text it replaces. The hook exits 3 if a
// find-string is not present verbatim exactly once, so a stale line number can
// never silently produce an unpatched "null result".

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RIG = path.resolve(HERE, "../A1/rig");
const HOOK = path.join(HERE, "a18-hook.cjs");

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));
const SEED = String(argv.seed || "424242");
const ONLY = argv.only ? String(argv.only).split(",") : null;

// ── the exact shipping source text each variant replaces ───────────────────
const SW = "const SCORE_WEIGHTS = { kcal: 0.46, protein: 0.3, fat: 0.12, carb: 0.12 };";
const CGE = "const COMPOSITION_GOOD_ENOUGH = 0.05;";
const BESTLINE = "if (!best || worstRatio < best.worstRatio) best = { recipe, scaled, kcalOff, proteinShort, worstRatio };";
const SLOTHINGE = "return target > 0 ? Math.max(0, (target - scaledProtein) / target) : 0;";
const DAYHINGE = "const proteinShort = pMid > 0 ? Math.max(0, (pMid - t.protein) / pMid) : 0;";

const sw = (k, p, f, c) => [{ file: "mealSolver.js", find: SW, replace: `const SCORE_WEIGHTS = { kcal: ${k}, protein: ${p}, fat: ${f}, carb: ${c} };` }];

const VARIANTS = {
  // ARM 1 — SCORE_WEIGHTS (the assignment's named lever, week-selection tiebreak)
  "w-equal":      { arm: "weights", note: "flat 0.25 each", edits: sw(0.25, 0.25, 0.25, 0.25) },
  "w-graderline": { arm: "weights", note: "equal cost AT the grader line", edits: sw(0.435, 0.435, 0.065, 0.065) },
  "w-fatheavy":   { arm: "weights", note: "fat up, protein down", edits: sw(0.30, 0.20, 0.30, 0.20) },
  "w-fatcarb":    { arm: "weights", note: "fat+carb dominate", edits: sw(0.20, 0.20, 0.30, 0.30) },
  "w-kcalonly":   { arm: "weights", note: "extreme: kcal only (destructive probe)", edits: sw(1.0, 0.0, 0.0, 0.0) },

  // ARM 2 — the slot-level fat/carb term that A9/C8 report as absent
  "c-strict":    { arm: "slot-comp", note: "COMPOSITION_GOOD_ENOUGH 0.05 -> 0 (no early accept)", edits: [{ file: "weeklyPlanner.js", find: CGE, replace: "const COMPOSITION_GOOD_ENOUGH = 0;" }] },
  "c-firstfit":  { arm: "slot-comp", note: "NEGATIVE CONTROL: 0.05 -> 999, pure first-fit", edits: [{ file: "weeklyPlanner.js", find: CGE, replace: "const COMPOSITION_GOOD_ENOUGH = 999;" }] },

  // ARM 3 — structural: give the no-fit FALLBACK rank a fat/carb term.
  // Only reached when NO candidate passed the 2-macro gate, i.e. exactly the
  // slots that produce failing days. Cannot change a slot that already fits.
  "s-fallbackcomp": {
    arm: "structural", note: "no-fit fallback ranks on worstRatio + compositionDistance",
    edits: [{ file: "weeklyPlanner.js", find: BESTLINE, replace: "const __a18r = worstRatio + (composed ? compositionDistance(target, scaled) : 0); if (!best || __a18r < best.__a18r) best = { recipe, scaled, kcalOff, proteinShort, worstRatio, __a18r };" }],
  },

  // ARM 4 — protein asymmetry. The hinge is ALREADY shipped in both places;
  // these BREAK it, to price what it is currently worth.
  "p-slotsym": { arm: "hinge", note: "NEGATIVE CONTROL: slot protein hinge -> symmetric", edits: [{ file: "weeklyPlanner.js", find: SLOTHINGE, replace: "return target > 0 ? Math.abs(target - scaledProtein) / target : 0;" }] },
  "p-daysym":  { arm: "hinge", note: "NEGATIVE CONTROL: day protein hinge -> symmetric", edits: [{ file: "mealSolver.js", find: DAYHINGE, replace: "const proteinShort = pMid > 0 ? Math.abs(pMid - t.protein) / pMid : 0;" }] },
};

const baseline = path.join(HERE, `A18-baseline-s${SEED}.jsonl`);
if (!fs.existsSync(baseline)) {
  console.error(`missing baseline ${baseline} — run runRig.mjs --label=baseline first`);
  process.exit(1);
}

const rows = [];
for (const [name, v] of Object.entries(VARIANTS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const out = path.join(HERE, `A18-${name}-s${SEED}.jsonl`);
  const abj = path.join(HERE, `A18-ab-${name}-s${SEED}.json`);

  if (!fs.existsSync(out)) {
    process.stderr.write(`\n=== ${name} (${v.arm}) — ${v.note}\n`);
    const r = spawnSync(process.execPath, [
      "--require", HOOK, path.join(RIG, "runRig.mjs"),
      "--agent=A18", "--pop=personas", `--seed=${SEED}`, `--label=${name}`, `--out=${out}`, "--quiet",
    ], { cwd: RIG, env: { ...process.env, A18_EDITS: JSON.stringify(v.edits) }, encoding: "utf8" });
    process.stderr.write((r.stderr || "").split("\n").filter((l) => l.startsWith("[a18-hook]")).join("\n") + "\n");
    process.stderr.write((r.stdout || "").split("\n").filter((l) => l.includes("in band") || l.includes("INSTRUMENT")).join("\n") + "\n");
    if (r.status !== 0) { console.error(`  !! ${name} exited ${r.status} — SKIPPED`); continue; }
  }

  const c = spawnSync(process.execPath, [path.join(RIG, "compare.v2.mjs"), baseline, out, `--json=${abj}`],
    { cwd: RIG, encoding: "utf8" });
  if (c.status !== 0 || !fs.existsSync(abj)) { console.error(`  !! compare failed for ${name}`); continue; }
  const j = JSON.parse(fs.readFileSync(abj, "utf8"));
  rows.push({ name, arm: v.arm, note: v.note, j });
}

// ── collect ────────────────────────────────────────────────────────────────
const pick = (j, key) => j[key] || (j.denominators && j.denominators[key]) || null;
const csv = ["variant,arm,note,seed,sat_base,sat_treat,sat_n,delta_pts,ci_lo,ci_hi,b,c"];
for (const { name, arm, note, j } of rows) {
  const s = pick(j, "satisfiable") || pick(j, "satisfiableOnly") || {};
  csv.push([name, arm, JSON.stringify(note), SEED,
    s.baselineCount ?? s.baseline ?? "", s.treatmentCount ?? s.treatment ?? "", s.n ?? "",
    s.deltaPts ?? s.delta ?? "", s.pairedCiLo ?? "", s.pairedCiHi ?? "", s.b ?? "", s.c ?? ""].join(","));
}
fs.writeFileSync(path.join(HERE, `A18-sweep-s${SEED}.csv`), csv.join("\n") + "\n");
console.log(csv.join("\n"));
console.log(`\nraw compare JSON per variant: A18-ab-<variant>-s${SEED}.json`);
