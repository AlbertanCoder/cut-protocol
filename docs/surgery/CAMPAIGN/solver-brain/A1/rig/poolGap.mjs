// A1/rig/poolGap.mjs — K2c. The EVIDENCE for fleet finding K2c, and the
// regression check that keeps it closed.
//
//   node docs/surgery/CAMPAIGN/solver-brain/A1/rig/poolGap.mjs
//
// THE FINDING
// routes/plans.js:271-277 narrows the pool in THREE stages:
//     filterRecipePool -> applyPrepFilter -> applyFilterStack
// runRig.mjs and backend/scripts/qc/runSolve.mjs did the first two only. The
// third (mealSolver.applyFilterStack) enforces the Stage-3 optional hard caps
// maxCostCad / maxComplexity / minTaste. Dropping it does not merely skip a
// filter — it means the instrument and the product are not solving the same
// problem for any persona that sets one of those caps.
//
// There are TWO independent breaks, and fixing either alone leaves the gap open:
//   1. runRig.loadPersonas built `filters` by hand and never copied
//      maxCostCad / maxComplexity / minTaste out of personas.jsonl. So even a
//      rig that called applyFilterStack would get a pass-through
//      (mealSolver.js:47-50 returns the pool unchanged when all three are null).
//   2. Neither instrument called applyFilterStack at all.
// This script measures the pool under each combination, so the claim is a
// number rather than a reading of the source.
//
// NO FOURTH RULER. The corrected filters are produced by the product's own
// planContext.parseFilters — the same function routes/plans.js:264 calls — not
// by a hand-rolled copy. `--auditparse` proves that switching to it changes
// NOTHING except the three cap fields.
//
// DB: read-only on backend/prisma/dev.db. prepareAgentDb copies it first and
// refuses to hand back the shared file.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareAgentDb, assertIsolated, REPO } from "./dbcopy.mjs";
import { loadPersonas, rigLegacyFilters, PERSONAS_PATH } from "./personas.mjs";

process.env.BRAIN = "off";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

const AGENT = String(argv.agent || "K2c");
const OUT = argv.out ? path.resolve(String(argv.out)) : null;

const db = prepareAgentDb(AGENT, { force: !!argv.freshdb });
assertIsolated(AGENT);

const require = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const solver = require(path.join(B, "src/lib/mealSolver.js"));
const planCtx = require(path.join(B, "src/lib/planContext.js"));
const { prisma } = require(path.join(B, "src/lib/prisma.js"));

const pct = (a, b) => (b ? ((a / b) * 100) : 0);

async function main() {
  const rawPool = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  const customers = loadPersonas();

  console.log(`[poolGap] agent=${AGENT}  db=${db.dbPath}`);
  console.log(`[poolGap] shared dev.db sha256:16 ${db.sourceHash}  copy ${db.copyHash}  ${db.sourceHash === db.copyHash ? "MATCH" : "*** MISMATCH ***"}`);
  console.log(`[poolGap] personas ${customers.length} from ${path.relative(REPO, PERSONAS_PATH).replace(/\\/g, "/")}`);
  console.log(`[poolGap] raw recipe pool ${rawPool.length}`);
  console.log("");

  // ── BREAK 1: what the legacy hand-rolled filter object dropped ───────────
  // rigLegacyFilters reproduces runRig.loadPersonas as it was before this fix.
  // Every field must agree with parseFilters EXCEPT the three cap fields; a
  // disagreement anywhere else would mean the fix changed something it should
  // not have, and is reported as a FAIL.
  const CAPS = ["maxCostCad", "maxComplexity", "minTaste"];
  let parseDrift = 0;
  const capCarriers = [];
  for (const c of customers) {
    const legacy = rigLegacyFilters(c._raw);
    const fixed = c.filters;
    for (const k of Object.keys(fixed)) {
      if (CAPS.includes(k)) continue;
      const a = JSON.stringify(legacy[k] ?? null), b = JSON.stringify(fixed[k] ?? null);
      if (a !== b) { parseDrift++; console.log(`  DRIFT ${c.id}.${k}: legacy ${a} vs parseFilters ${b}`); }
    }
    for (const k of CAPS) if (legacy[k] == null && fixed[k] != null) { capCarriers.push(c); break; }
  }
  console.log(`[break 1] filter fields OTHER than the three caps that changed when adopting`);
  console.log(`          planContext.parseFilters: ${parseDrift}  ${parseDrift === 0 ? "(none — the fix is a strict superset)" : "*** NON-ZERO: investigate ***"}`);
  console.log(`[break 1] personas whose caps the legacy loader DROPPED: ${capCarriers.length} of ${customers.length}`);
  const byCap = Object.fromEntries(CAPS.map((k) => [k, customers.filter((c) => c.filters[k] != null).length]));
  console.log(`[break 1] cap census: ${CAPS.map((k) => `${k}=${byCap[k]}`).join("  ")}`);
  console.log("");

  // ── BREAK 2: what applyFilterStack actually removes ──────────────────────
  const rows = [];
  for (const c of customers) {
    const afterDiet = planCtx.filterRecipePool(rawPool, c.dietProfile);
    const afterPrep = solver.applyPrepFilter(afterDiet, c.filters.maxPrepMin ?? undefined);

    // (a) the OLD instrument: hand-rolled filters, no stack call.
    const rigPool = afterPrep;
    // (b) OLD filters + a stack call — isolates break 1 on its own.
    const legacyStack = solver.applyFilterStack(afterPrep, rigLegacyFilters(c._raw), null).survivors;
    // (c) the SHIPPING shape: parseFilters + stack (routes/plans.js:271-277).
    const { survivors: routePool, explain } = solver.applyFilterStack(afterPrep, c.filters, null);

    rows.push({
      id: c.id, idx: c.idx, tier: c.tier, horizon: c.horizonKey,
      caps: Object.fromEntries(CAPS.filter((k) => c.filters[k] != null).map((k) => [k, c.filters[k]])),
      raw: rawPool.length, afterDiet: afterDiet.length, afterPrep: afterPrep.length,
      rig: rigPool.length, legacyStack: legacyStack.length, route: routePool.length,
      delta: routePool.length - rigPool.length,
      deltaPct: -pct(rigPool.length - routePool.length, rigPool.length),
      stackOk: explain ? explain.ok : null,
      binding: explain ? explain.bindingConstraint : null,
    });
  }

  const affected = rows.filter((r) => r.delta !== 0);
  const legacyAffected = rows.filter((r) => r.legacyStack !== r.rig);
  affected.sort((a, b) => a.deltaPct - b.deltaPct);

  console.log(`[break 2] personas whose pool CHANGES when applyFilterStack is applied`);
  console.log(`          with the LEGACY hand-rolled filters : ${legacyAffected.length}   <- break 1 alone makes the stack a no-op`);
  console.log(`          with the SHIPPING parseFilters      : ${affected.length}`);
  console.log("");
  console.log(`[break 2] pooled recipe-slots  rig ${rows.reduce((s, r) => s + r.rig, 0)}  ->  route ${rows.reduce((s, r) => s + r.route, 0)}`
    + `  (${(-pct(rows.reduce((s, r) => s + r.rig - r.route, 0), rows.reduce((s, r) => s + r.rig, 0))).toFixed(2)}%)`);
  console.log("");
  console.log("  persona  tier        caps                          afterPrep -> afterStack     delta");
  for (const r of affected) {
    const caps = Object.entries(r.caps).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`  ${r.id.padEnd(8)} ${String(r.tier).padEnd(11)} ${caps.padEnd(29)} ${String(r.rig).padStart(9)} -> ${String(r.route).padEnd(11)} ${r.deltaPct.toFixed(1).padStart(7)}%`
      + (r.stackOk === false ? `   [stack UNDER minSurvivors, binding=${r.binding}]` : ""));
  }
  console.log("");

  // Personas that carry a cap but whose pool does NOT move — the difference
  // between "sets a cap" and "is affected by it". Named, not glossed over.
  const inert = rows.filter((r) => Object.keys(r.caps).length > 0 && r.delta === 0);
  console.log(`[break 2] personas that SET a cap but whose pool is unchanged: ${inert.length}`
    + (inert.length ? ` (${inert.map((r) => r.id).join(", ")})` : ""));
  console.log(`[break 2] TOTAL cap-carrying personas: ${rows.filter((r) => Object.keys(r.caps).length).length}`
    + `  = ${affected.length} affected + ${inert.length} inert`);

  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`\n[poolGap] per-persona rows -> ${OUT}`);
  }

  await prisma.$disconnect();

  // Regression contract: once the fix is in, the SHIPPING pool must never be
  // wider than the un-stacked pool, and adopting parseFilters must not have
  // moved any non-cap field.
  const widened = rows.filter((r) => r.route > r.rig);
  if (widened.length) { console.error(`\n*** ${widened.length} persona(s) got a WIDER pool from the stack — impossible; investigate.`); process.exit(1); }
  if (parseDrift) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
