// mc.mjs — the Monte-Carlo runner for the QC gauntlet (Phase 0 + Phase 1).
//
//   node scripts/qc/mc.mjs --n 1000 --seed 42          # smoke
//   node scripts/qc/mc.mjs --n 10000 --seed 42          # main run
//   node scripts/qc/mc.mjs --n 100000 --seed 42 --quiet # overnight
//
// Loads the real Food/Recipe pool once, then for each seeded run:
//   genProfile -> runSolve (real engine) -> oracle (independent verify)
// Streams one compact JSONL row per run, aggregates p50/p95/p99 broken down by
// diet × allergy-stack corner, ranks failure patterns, and writes:
//   docs/qc/monte-carlo-report.md   (human-facing)
//   docs/qc/failures.jsonl          (every finding, each with its seed)
//   docs/qc/mc-results.jsonl        (compact per-run rows, for re-analysis)
//
// Ground rule #1 (ZERO API COST) is enforced, not assumed: after the pool
// loads, every outbound http/https/fetch call is trapped and counted; a run
// that makes even one is a P0 stop-the-line.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";

import prismaPkg from "../../src/lib/prisma.js";
import { genProfile } from "./genProfile.mjs";
import { runSolve } from "./runSolve.mjs";
import { oracle } from "./oracle.mjs";

const { prisma } = prismaPkg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE = backend/scripts/qc → three up is the repo root (where docs/ lives).
const REPO = path.resolve(HERE, "..", "..", "..");

// BRAIN off before anything else loads a brain module.
process.env.BRAIN = "off";

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));
const N = Number(argv.n ?? 1000);
const SEED = Number(argv.seed ?? 42);
const QUIET = !!argv.quiet;
const OUT = path.resolve(REPO, String(argv.out ?? "docs/qc"));

// ── stats ───────────────────────────────────────────────────────────────
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function dist(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  return { n: s.length, p50: quantile(s, 0.5), p95: quantile(s, 0.95), p99: quantile(s, 0.99), max: s[s.length - 1] };
}
const r1 = (x) => (x == null ? "—" : Math.round(x * 10) / 10);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const t00 = performance.now();

  // ── load the real pool + private snapshots (warm prisma BEFORE net guard) ──
  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const foods = await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true } });
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const recipeById = new Map(rawPool.map((r) => [r.id, { name: r.name, slotType: r.slotType, mealCategory: r.mealCategory }]));
  const macroHash = crypto.createHash("sha256")
    .update(foods.map((f) => `${f.id}:${f.kcal}:${f.protein}:${f.fat}:${f.carb}`).sort().join("|"))
    .digest("hex").slice(0, 16);

  // ── ground rule #1: trap the network. Prisma is already warm and talks to a
  //    local engine (not http), so these guards never fire for the DB. ──
  let netCalls = 0;
  const trap = (label) => (...a) => { netCalls++; throw new Error(`QC harness attempted a ${label} call — ground rule #1 (zero API cost) violated`); };
  https.request = trap("https.request"); https.get = trap("https.get");
  http.request = trap("http.request"); http.get = trap("http.get");
  if (globalThis.fetch) globalThis.fetch = trap("fetch");
  if (process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;

  console.log(`Cut Protocol · QC Monte Carlo`);
  console.log(`  pool: ${rawPool.length} recipes / ${foods.length} foods (macro fingerprint ${macroHash})`);
  console.log(`  runs: ${N.toLocaleString()}  seed: ${SEED}  BRAIN=off`);
  console.log("");

  // ── per-run streams + aggregation accumulators ────────────────────────
  const resultsPath = path.join(OUT, "mc-results.jsonl");
  const failuresPath = path.join(OUT, "failures.jsonl");
  const resStream = fs.createWriteStream(resultsPath);
  const failStream = fs.createWriteStream(failuresPath);

  const outcomes = {};                 // outcome -> count
  const P0 = { "allergy-leak": 0, "diet-style-leak": 0, "kcal-floor-breach": 0, "macro-drift": 0, "dessert-as-meal": 0, "portion-bound": 0, "crash": 0 };
  const P1 = { "silent-solver-miss": 0, "silent-unfilled-slot": 0, "missing-food-row": 0 };
  const kcalDevMax = [], proteinShortMax = [], solveMs = [];
  let feasibleDays = 0, feasibleMisses = 0, totalDays = 0, daysInTol = 0;
  const byCorner = new Map();          // "diet|stack" -> { runs, feasibleDays, feasibleMisses, solverMissRuns }

  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const gen = genProfile(SEED, i);
    const rng = (() => { let a = (gen.seed ^ 0x1234567) >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
    const solved = await runSolve(gen, rawPool, rng);
    const o = oracle(solved, { foodById, recipeById });
    delete solved._pool; // free the pool reference immediately

    outcomes[o.outcome || (o.crash ? "crash" : "?")] = (outcomes[o.outcome || "crash"] || 0) + 1;
    for (const f of o.findings) {
      if (P0[f.kind] !== undefined) P0[f.kind]++;
      else if (P1[f.kind] !== undefined) P1[f.kind]++;
      if (f.severity === "P0" || f.severity === "P1") failStream.write(JSON.stringify(f) + "\n");
    }
    if (!o.crash) {
      kcalDevMax.push(o.kcalDevMax); proteinShortMax.push(o.proteinShortMax); solveMs.push(o.solveMs);
      feasibleDays += o.daysFeasible; feasibleMisses += o.feasibleMisses; totalDays += o.totalDays; daysInTol += o.daysInTol;
    }

    const ck = `${gen.corner.diet}|${gen.corner.allergyStack}`;
    const c = byCorner.get(ck) || { runs: 0, feasibleDays: 0, feasibleMisses: 0, solverMissRuns: 0, unsafeRuns: 0 };
    c.runs++; c.feasibleDays += o.daysFeasible || 0; c.feasibleMisses += o.feasibleMisses || 0;
    if (o.outcome === "silent-miss") c.solverMissRuns++;
    if (o.outcome === "unsafe") c.unsafeRuns++;
    byCorner.set(ck, c);

    resStream.write(JSON.stringify({ seed: o.seed, corner: gen.corner, outcome: o.outcome, target: o.target, floored: o.floored, solveMs: o.solveMs, kcalDevMax: o.kcalDevMax, proteinShortMax: o.proteinShortMax, feasibleMisses: o.feasibleMisses }) + "\n");

    if (!QUIET && (i + 1) % Math.max(1, Math.floor(N / 20)) === 0) {
      const pct = Math.round(((i + 1) / N) * 100);
      process.stdout.write(`\r  ${pct}%  (${(i + 1).toLocaleString()}/${N.toLocaleString()})   `);
    }
  }
  resStream.end(); failStream.end();
  const runMs = performance.now() - t0;
  if (!QUIET) process.stdout.write("\n");

  // ── report ────────────────────────────────────────────────────────────
  const perRunMs = runMs / N;
  const p0Total = Object.values(P0).reduce((a, b) => a + b, 0);
  const patterns = [...byCorner.entries()]
    .map(([k, c]) => ({ corner: k, runs: c.runs, missRate: c.feasibleDays ? c.feasibleMisses / c.feasibleDays : 0, solverMissRuns: c.solverMissRuns, unsafeRuns: c.unsafeRuns }))
    .filter((p) => p.runs >= 3)
    .sort((a, b) => b.missRate - a.missRate);

  const L = [];
  L.push(`# Cut Protocol — Monte Carlo QC report`);
  L.push("");
  L.push(`- Runs: **${N.toLocaleString()}** · seed \`${SEED}\` · BRAIN=off`);
  L.push(`- Pool: ${rawPool.length} recipes / ${foods.length} foods · macro fingerprint \`${macroHash}\``);
  L.push(`- Runtime: ${(runMs / 1000).toFixed(1)}s (${perRunMs.toFixed(1)} ms/run). Extrapolated: 10k ≈ ${((perRunMs * 10000) / 1000 / 60).toFixed(1)} min · 100k ≈ ${((perRunMs * 100000) / 1000 / 60).toFixed(1)} min.`);
  L.push(`- **Network calls during simulation: ${netCalls}** (ground rule #1: must be 0).`);
  L.push("");
  L.push(`## Outcome mix`);
  L.push(`| outcome | count | % |`);
  L.push(`|---|--:|--:|`);
  for (const [k, v] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} | ${((v / N) * 100).toFixed(1)}% |`);
  L.push("");
  L.push(`## Safety tallies (target: all ZERO)`);
  L.push(`| check | count |`);
  L.push(`|---|--:|`);
  for (const [k, v] of Object.entries(P0)) L.push(`| ${k} | ${v}${v ? " ⚠️" : ""} |`);
  L.push(`| **P0 total** | **${p0Total}** |`);
  L.push("");
  L.push(`## Core-flow (P1)`);
  L.push(`| check | count |`);
  L.push(`|---|--:|`);
  for (const [k, v] of Object.entries(P1)) L.push(`| ${k} | ${v} |`);
  const offTargetRate = feasibleDays ? (feasibleMisses / feasibleDays) : 0;
  L.push(`| feasible-day OFF-TARGET rate (outside ±5%, but declared — quality, not a bug) | ${(offTargetRate * 100).toFixed(2)}% |`);
  L.push(`| feasible days within ±5% (acceptance bar: ≥90%) | ${feasibleDays ? ((daysInTol / totalDays) * 100).toFixed(1) : "—"}% of ${totalDays} days |`);
  L.push(`| **SILENT** misses (feasible, breaches solver's own ±15%, undeclared — the real bug) | ${P1["silent-solver-miss"]} |`);
  L.push("");
  L.push(`## Distributions (p50 / p95 / p99 / max)`);
  const dk = dist(kcalDevMax), dp = dist(proteinShortMax), ds = dist(solveMs);
  L.push(`| metric | p50 | p95 | p99 | max |`);
  L.push(`|---|--:|--:|--:|--:|`);
  L.push(`| worst-day kcal deviation % | ${r1(dk.p50)} | ${r1(dk.p95)} | ${r1(dk.p99)} | ${r1(dk.max)} |`);
  L.push(`| worst-day protein shortfall g | ${r1(dp.p50)} | ${r1(dp.p95)} | ${r1(dp.p99)} | ${r1(dp.max)} |`);
  L.push(`| full-week solve ms | ${r1(ds.p50)} | ${r1(ds.p95)} | ${r1(ds.p99)} | ${r1(ds.max)} |`);
  L.push("");
  L.push(`## Failure patterns — worst corners by feasible-day off-target rate`);
  L.push(`_Off-target = day outside ±5% of the calorie target (declared, not silent). Silent-miss and unsafe runs are the columns that would indicate real defects._`);
  L.push(`| diet \\| allergy-stack | runs | off-target rate | silent-miss runs | unsafe runs |`);
  L.push(`|---|--:|--:|--:|--:|`);
  for (const p of patterns.slice(0, 15)) L.push(`| ${p.corner} | ${p.runs} | ${(p.missRate * 100).toFixed(1)}% | ${p.solverMissRuns} | ${p.unsafeRuns} |`);
  L.push("");
  L.push(`## Reproduce`);
  L.push("```");
  L.push(`node scripts/qc/mc.mjs --n ${N} --seed ${SEED}`);
  L.push(`# any failing run replays from its seed in failures.jsonl`);
  L.push("```");
  L.push("");
  L.push(`_Generated ${new Date().toISOString()} · every absolute nutritional number is a property of food-fingerprint \`${macroHash}\`._`);

  const reportPath = path.join(OUT, "monte-carlo-report.md");
  fs.writeFileSync(reportPath, L.join("\n") + "\n");

  console.log(`\nDONE. ${N.toLocaleString()} runs in ${(runMs / 1000).toFixed(1)}s (${perRunMs.toFixed(1)} ms/run)`);
  console.log(`  outcomes:`, outcomes);
  console.log(`  P0 total: ${p0Total}  ·  network calls: ${netCalls}`);
  console.log(`  report:   ${path.relative(REPO, reportPath)}`);
  console.log(`  failures: ${path.relative(REPO, failuresPath)}`);
  await prisma.$disconnect();
  // A non-zero P0 count or any network call fails the smoke under --assert.
  if (argv.assert && (p0Total > 0 || netCalls > 0)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
