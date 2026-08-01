// A16-enrich.mjs — rig treatment: SIMULATED pool enrichment.
//
// Adds the first N rows of the A16 catalogue for one corner to every persona's
// pool, THROUGH THE PRODUCT'S OWN EXCLUSION GATE. The synthetic rows are not
// slipped past the gate: planContext.filterRecipePool() and
// mealSolver.applyPrepFilter() are imported from backend/src and run on them
// exactly as they run on the 910 real recipes. A synthetic row a persona's
// allergies forbid is therefore dropped by product code, not by my code.
//
//   A16_CORNER=vegetarian|vegan|none|all   A16_N=<int>
//
// Nothing in backend/src is modified. The DB is never written.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..", "..");
const require = createRequire(import.meta.url);
const planCtx = require(path.join(REPO, "backend/src/lib/planContext.js"));
const solver = require(path.join(REPO, "backend/src/lib/mealSolver.js"));

const CORNER = String(process.env.A16_CORNER || "vegetarian");
const N = Number(process.env.A16_N ?? 0);

export const NAME = `A16-enrich-${CORNER}-N${N}`;

const cat = JSON.parse(fs.readFileSync(path.join(HERE, "A16-catalogue-v2.json"), "utf8")).catalogue;

function slice() {
  if (N <= 0) return [];
  if (CORNER === "all") return ["vegetarian", "vegan", "none"].flatMap((c) => (cat[c] || []).slice(0, N));
  return (cat[CORNER] || []).slice(0, N);
}
const ADDED = slice();

export function applyTreatment({ customer, pool, filters }) {
  if (!ADDED.length) return {};
  // product gate first, then the product's prep filter — same order as runRig
  const admitted = planCtx.filterRecipePool(ADDED, customer.dietProfile);
  const afterPrep = solver.applyPrepFilter(admitted, filters?.maxPrepMin ?? undefined);
  return { pool: pool.concat(afterPrep) };
}
