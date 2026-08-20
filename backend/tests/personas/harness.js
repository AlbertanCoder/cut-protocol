// personas/harness.js — fixture-driven pipeline runner (directive §7):
// declared targets → REAL pool filtering → solve N days → verification.
//
// Pool source: the isolated rebuild QA database (built from migrations + the
// three seed scripts + seedRebuildCandidates — see BUILD_LOG Phase 2), opened
// READ-ONLY via node:sqlite. This harness refuses to open any path ending in
// dev.db: the owner's personal database is never opened, copied, or hashed,
// under any env misconfiguration. When no QA database exists the caller
// skips loudly with build instructions — a silent skip would fool nobody
// and prove nothing.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { filterRecipePool } = require("../../src/lib/planContext.js");
const { solvePrescriptionDay } = require("../../src/lib/prescription/daySolver.js");
const { makeRng } = require("../helpers/seededRng.js");

function qaDbPath() {
  const candidates = [
    process.env.CUT_REBUILD_QA_DB,
    path.resolve(__dirname, "../../prisma/rebuild-qa.db"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (/dev\.db$/i.test(p)) throw new Error("harness refuses to open a dev.db — the owner's personal data is never a test fixture");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const SKIP_NOTE =
  "rebuild-qa.db not found — build it first:\n" +
  "  cd backend && DATABASE_URL=file:./rebuild-qa.db npx prisma migrate deploy \\\n" +
  "  && DATABASE_URL=file:./rebuild-qa.db node scripts/seedUser.js \\\n" +
  "  && DATABASE_URL=file:./rebuild-qa.db node scripts/seedRecipes.js \\\n" +
  "  && DATABASE_URL=file:./rebuild-qa.db node scripts/seedRecipesFromRecomp.mjs \\\n" +
  "  && DATABASE_URL=file:./rebuild-qa.db node scripts/seedRebuildCandidates.mjs --write";

function parseJson(text, fallback) {
  if (text == null) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

// Load the full recipe library in the gate's shape (rows carry whole Food rows).
function loadPoolRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const foods = new Map();
    for (const f of db.prepare(
      "SELECT id,name,category,kcal,protein,fat,carb,fiber,source,dataQuality,fdcCategory,allergenTags,mayContain FROM Food"
    ).all()) {
      foods.set(f.id, {
        ...f,
        allergenTags: parseJson(f.allergenTags, null),
        mayContain: parseJson(f.mayContain, null),
      });
    }
    const ingsByRecipe = new Map();
    for (const i of db.prepare(
      "SELECT recipeId,foodId,baseGrams,scalable,role FROM RecipeIngredient"
    ).all()) {
      const list = ingsByRecipe.get(i.recipeId) || [];
      list.push({ foodId: i.foodId, baseGrams: i.baseGrams, scalable: !!i.scalable, role: i.role, food: foods.get(i.foodId) });
      ingsByRecipe.set(i.recipeId, list);
    }
    const rows = [];
    for (const r of db.prepare(
      "SELECT id,name,description,steps,slotType,cuisine,prepTimeMin,source,mealCategory,kcal,protein,fat,carb,costPerServing FROM Recipe"
    ).all()) {
      rows.push({
        ...r,
        steps: parseJson(r.steps, []),
        ingredients: ingsByRecipe.get(r.id) || [],
      });
    }
    return rows;
  } finally {
    db.close();
  }
}

function biasFor(persona) {
  const likes = new Set((persona.likesCuisines || []).map((c) => c.toLowerCase()));
  const dislikes = persona.dislikes || null;
  const budget = persona.budgetPerDayCad || null;
  if (!likes.size && !dislikes && !budget) return null;
  return (r) => {
    let w = 1;
    if (likes.size && r.cuisine && likes.has(String(r.cuisine).toLowerCase())) w *= 3;
    if (dislikes) {
      const inName = dislikes.test(r.name || "");
      const inIngs = (r.ingredients || []).some((i) => dislikes.test(i.food?.name || ""));
      if (inName || inIngs) w *= 0.25; // a dislike bends the draw, never walls it
    }
    if (budget && Number.isFinite(r.costPerServing) && r.costPerServing > 0) {
      w *= r.costPerServing <= budget / 3 ? 1.5 : 0.5;
    }
    return w;
  };
}

/**
 * runPersona(persona, libraryRows, { days = 30, seed = 1 })
 * → { persona, poolSize, days: [{ day, ok, latencyMs, totals, verdict,
 *     scan, scanLine, slots, estCostCad, costCoverage }], summary }
 */
function runPersona(persona, libraryRows, { days = 30, seed = 1 } = {}) {
  const pool = filterRecipePool(libraryRows, persona.profile);
  const rng = makeRng(seed);
  const bias = biasFor(persona);
  const window = []; // last 2 days' recipe ids — "no repeat within 3 days"
  const out = [];
  for (let day = 1; day <= days; day++) {
    const recentIds = new Set(window.flat());
    const t0 = process.hrtime.bigint();
    const solved = solvePrescriptionDay({
      pool, targets: persona.targets, mealConfig: persona.mealConfig,
      profile: persona.profile, rng, recentIds, bias,
    });
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const dayIds = solved.slots.flatMap((s) => s.dishes.map((d) => d.recipeId));
    window.push(dayIds);
    if (window.length > 2) window.shift();

    // Cost, honestly: sum where costPerServing is known, and say how much is known.
    let estCostCad = 0, costed = 0, dishes = 0;
    for (const s of solved.slots) {
      for (const d of s.dishes) {
        dishes++;
        const row = pool.find((r) => r.id === d.recipeId);
        if (row && Number.isFinite(row.costPerServing) && row.costPerServing > 0) {
          costed++;
          estCostCad += row.costPerServing;
        }
      }
    }
    out.push({
      day, ok: solved.ok, latencyMs,
      totals: solved.totals, verdict: solved.verdict, scan: solved.scan,
      scanLine: solved.scanLine, slots: solved.slots, diagnosis: solved.diagnosis,
      estCostCad, costCoverage: dishes ? costed / dishes : 0,
    });
  }
  const okDays = out.filter((d) => d.ok).length;
  const latencies = out.map((d) => d.latencyMs).sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))];
  return {
    persona, poolSize: pool.length, days: out,
    summary: {
      days: out.length, okDays, okRate: okDays / out.length,
      allergenHits: out.reduce((n, d) => n + d.scan.hits.length, 0),
      latencyP50: pct(0.5), latencyP95: pct(0.95),
    },
  };
}

module.exports = { qaDbPath, SKIP_NOTE, loadPoolRows, runPersona, biasFor };
