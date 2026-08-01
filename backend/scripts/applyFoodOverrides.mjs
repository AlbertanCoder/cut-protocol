/**
 * applyFoodOverrides.mjs — push backend/data/foodOverrides.json into the Food table,
 * and recompute the cached macros of every recipe that uses a changed row.
 *
 * WHY A NARROW SCRIPT AND NOT scripts/fixFoodData.mjs
 * fixFoodData.mjs is the full Phase-2 pipeline: overrides, negative-macro clamps,
 * Atwater recomputation, placeholder promotion, recategorisation of all 14k foods,
 * AND a 200-group duplicate merge that re-points recipe ingredients and deletes rows.
 * All of that may well be wanted, but none of it is required to land a value
 * correction, and bundling a 200-row merge into a data fix makes the fix impossible
 * to review or revert independently. This script does two things only.
 *
 * WHAT IT DOES
 *   1. For every entry in foodOverrides.json that carries macro values, update the
 *      matching Food row (matched on lowercased name, the same key foodOverrides.js
 *      uses) and stamp `dataQuality` with the override's own note so provenance is
 *      not lost.
 *   2. Recompute `kcal/protein/fat/carb` on every Recipe whose ingredients include a
 *      changed food — the cached per-serving macros are derived data and go stale the
 *      moment a Food row moves.
 *
 * DESIGN
 *   · IDEMPOTENT — re-running is a no-op once values match.
 *   · REPORT ONLY unless --apply. Backs up dev.db before writing.
 *   · Exemption-only entries (atwaterExempt with no macros) are applied as flags and
 *     change no numbers.
 *
 *   node scripts/applyFoodOverrides.mjs            # report
 *   node scripts/applyFoodOverrides.mjs --apply    # write
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { prisma } = require('../src/lib/prisma.js');
const { loadFoodOverrides, OVERRIDES_FILE } = require('../src/lib/foodOverrides.js');
const { macroTrustIssue } = require('../src/lib/foodValidation.js');

const APPLY = process.argv.includes('--apply');
const MACRO_KEYS = ['kcal', 'protein', 'fat', 'carb', 'fiber'];
const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005;

async function main() {
  const overrides = loadFoodOverrides();
  console.log(`== apply food overrides ==  ${APPLY ? 'APPLY (writing)' : 'REPORT ONLY (pass --apply to write)'}`);
  console.log(`source: ${OVERRIDES_FILE}`);
  console.log(`entries: ${Object.keys(overrides).length}\n`);

  const names = Object.keys(overrides);
  const foods = await prisma.food.findMany({
    where: { name: { in: names.map((n) => n) } },
    select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, category: true, fdcId: true, dataQuality: true },
  });
  // Match case-insensitively, the way foodOverrides.js keys them.
  const byLower = new Map();
  for (const f of await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, category: true, fdcId: true, dataQuality: true } })) {
    const k = f.name.trim().toLowerCase();
    if (!byLower.has(k)) byLower.set(k, f);
  }

  // Who already owns each fdcId — Food.fdcId is @unique, see the skip rule below.
  const fdcOwner = new Map();
  for (const f of await prisma.food.findMany({ where: { NOT: { fdcId: null } }, select: { id: true, name: true, fdcId: true } })) {
    fdcOwner.set(f.fdcId, { id: f.id, name: f.name });
  }

  const planned = [];
  const missing = [];
  const already = [];
  const skippedFdc = [];
  const reStamped = [];
  for (const [key, entry] of Object.entries(overrides)) {
    const food = byLower.get(key);
    if (!food) { missing.push(key); continue; }
    const hasMacros = MACRO_KEYS.some((k) => typeof entry[k] === 'number');
    if (!hasMacros) continue; // exemption-only entry — no numbers to move
    const changes = {};
    for (const k of MACRO_KEYS) {
      if (typeof entry[k] !== 'number') continue;
      if (!near(food[k], entry[k])) changes[k] = entry[k];
    }
    if (typeof entry.category === 'string' && entry.category !== food.category) changes.category = entry.category;
    // fdcId is NEVER written when another row already holds it.
    //
    // Food.fdcId is @unique, and this corpus already contains the canonical USDA
    // row under its full USDA name ("Potatoes, flesh and skin, raw"), so an override
    // that points a short-named row at the same record collides every time — the
    // first --apply attempt died on exactly this. The fdcId is provenance metadata,
    // not part of the correction, so it is skipped and reported rather than allowed
    // to block a macro fix that is otherwise right.
    if (typeof entry.fdcId === 'number' && entry.fdcId !== food.fdcId) {
      const owner = fdcOwner.get(entry.fdcId);
      if (owner && owner.id !== food.id) skippedFdc.push({ name: food.name, fdcId: entry.fdcId, owner: owner.name });
      else changes.fdcId = entry.fdcId;
    }
    // AN OVERRIDE IS ITSELF A VERIFICATION, EVEN WHEN NO NUMBER MOVES.
    //
    // Many staple rows are quarantined not because their macros are wrong but
    // because the USDA record they borrowed carries a different NAME — "Parsley" <-
    // "Parsley, fresh", "Lime" <- "Limes, raw", "Ginger" <- "Ginger root, raw".
    // The values were always right; only the provenance stamp said otherwise, and
    // that stamp blocks 79% of recipes with `untrusted-ingredients` and makes new
    // recipe authoring impossible (you cannot write a Mediterranean dish without
    // lemon).
    //
    // The first version of this script only wrote rows whose VALUES differed, so
    // those entries were skipped as "already correct" and stayed quarantined —
    // the override said nothing, which is the opposite of what a curated,
    // hand-checked entry means. Writing an override for a row is an explicit
    // statement that someone verified it, so it clears the quarantine whether or
    // not a number changed.
    const stillDoubted = !!macroTrustIssue(food);
    if (!Object.keys(changes).length) {
      if (!stillDoubted) { already.push(food.name); continue; }
      reStamped.push(food.name);
    }
    planned.push({ food, entry, changes });
  }

  console.log(`to update : ${planned.length}`);
  for (const { food, entry, changes } of planned) {
    const before = MACRO_KEYS.map((k) => `${k}=${food[k]}`).join(' ');
    const after = Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`  ${food.name}`);
    console.log(`      was : ${before}${food.category ? ` cat=${food.category}` : ''}`);
    console.log(`      now : ${after}`);
    if (entry.note) console.log(`      why : ${String(entry.note).slice(0, 130)}`);
  }
  if (skippedFdc.length) {
    console.log(`
fdcId NOT written (already owned by the canonical USDA row): ${skippedFdc.length}`);
    for (const s2 of skippedFdc.slice(0, 8)) console.log(`  ${s2.name} -> ${s2.fdcId} is held by "${s2.owner}"`);
    console.log('  (macro corrections above still apply; only the provenance id is skipped)');
  }
  if (reStamped.length) {
    console.log(`
provenance re-stamped with no macro change (values were already right): ${reStamped.length}`);
    console.log(`  ${reStamped.slice(0, 12).join(', ')}${reStamped.length > 12 ? ', …' : ''}`);
  }
  if (already.length) console.log(`\nalready correct : ${already.length} (${already.slice(0, 6).join(', ')}${already.length > 6 ? ', …' : ''})`);
  if (missing.length) console.log(`no such Food row: ${missing.length} (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''})`);

  // Which recipes go stale?
  const changedIds = planned.map((p) => p.food.id);
  const affected = changedIds.length
    ? await prisma.recipeIngredient.findMany({ where: { foodId: { in: changedIds } }, select: { recipeId: true } })
    : [];
  const recipeIds = [...new Set(affected.map((r) => r.recipeId))];
  console.log(`\nrecipes whose cached macros go stale: ${recipeIds.length}`);

  if (!APPLY) {
    console.log('\nREPORT ONLY — nothing written. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }
  if (!planned.length) {
    console.log('\nnothing to do.');
    await prisma.$disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const db = path.join(path.dirname(OVERRIDES_FILE), '..', 'prisma', 'dev.db');
  const backup = `${db}.backup-overrides-${stamp}`;
  fs.copyFileSync(db, backup);
  console.log(`\nbackup: ${backup}`);

  let n = 0;
  for (const { food, entry, changes } of planned) {
    const note = entry.note ? `override:applied — ${entry.note}` : 'override:applied';
    await prisma.food.update({ where: { id: food.id }, data: { ...changes, dataQuality: note } });
    n++;
  }
  console.log(`updated ${n} Food row(s)`);

  // Recompute recipe caches from ingredients — same arithmetic the solver uses.
  let r = 0;
  for (const id of recipeIds) {
    const recipe = await prisma.recipe.findUnique({ where: { id }, include: { ingredients: { include: { food: true } } } });
    if (!recipe) continue;
    const t = { kcal: 0, protein: 0, fat: 0, carb: 0 };
    for (const ing of recipe.ingredients) {
      const f = ing.food;
      const factor = (ing.baseGrams || 0) / 100;
      t.kcal += (f.kcal || 0) * factor;
      t.protein += (f.protein || 0) * factor;
      t.fat += (f.fat || 0) * factor;
      t.carb += (f.carb || 0) * factor;
    }
    await prisma.recipe.update({ where: { id }, data: t });
    r++;
  }
  console.log(`recomputed ${r} recipe macro cache(s)`);
  console.log('\ndone. Re-run without --apply to confirm idempotence.');
  console.log('NOTE: existing PlanSlot rows still hold the macros they were solved with —');
  console.log('      they are a historical record of what was served, not a cache. Customers');
  console.log('      see corrected numbers on their next generate.');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error('FAILED:', e && e.stack); try { await prisma.$disconnect(); } catch {} process.exitCode = 1; });
