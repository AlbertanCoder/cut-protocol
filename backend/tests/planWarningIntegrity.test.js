// ── plans.js · the slot warning is a SERVER conclusion (fleet finding E8) ────
//
// The constitution: "Solver declares 'unsolvable + why' — silent target misses
// are forbidden." A PlanSlot's `warning` IS that declaration. It is the field a
// user reads to learn that the plate in front of them is not the plate the
// engine was asked for.
//
// Two write paths did not treat it that way.
//
//  1. rebuildSlotFromClient() — the shared rebuild behind POST /plans/accept-day
//     and PUT /plans/:planId/slots/:slotId/apply — ended with:
//
//         warning: typeof incoming.warning === "string" ? incoming.warning : null
//
//     Everything ELSE on that path is re-established server-side, deliberately
//     and with comments saying so: recipeId is checked against the user's
//     filtered pool, each ingredient is checked to belong to that recipe, grams
//     are bounds-checked to the 0.5-2x portion band, macros are recomputed from
//     raw Food rows, the display scales are clamped. The honesty signal was the
//     single field still taken on the client's word — so a client could clear a
//     real miss by sending null, or write any sentence it liked into a field the
//     UI renders as the engine speaking.
//
//  2. POST /plans/place-recipe hardcoded `warning: null`, while its SIBLING
//     /plans/fill-today-from-cart — in the same file, ~45 lines below — derived
//     the same signal correctly from kcalOff and said in a comment why
//     ("instead of storing warning:null — the constitution bans silent misses").
//     Placing a 600-kcal dish by hand into a 300-kcal snack slot stored silence.
//
// The fix derives the warning in ONE place (deriveSlotWarning) against the
// solver's own thresholds, and every write path uses it. These tests hold the
// line at the two levels that can rot independently: the pure rebuild function,
// and the ROUTES that must actually WIRE it (a fix that lands in the helper but
// not in the caller is not a fix).
//
// PRE-FIX PROOF: this file was run against `git show HEAD:...plans.js` (with
// require() redirected so server.js mounted the ORIGINAL router). 10 of 13
// failed. Every test marked [E8] is a discriminator; the three marked GUARD
// pass in both directions on purpose — they exist so the fix cannot be "pass"ed
// by warning on everything or by breaking the rebuild's other checks. Nine of
// the ten failed on ERR_ASSERTION with the forged text or a null actually
// stored ("Chef's kiss — perfectly on target!", "Perfectly balanced, as all
// things should be."); the tenth failed on `deriveSlotWarning is not a
// function`, since pre-fix there was no single derivation to call.
//
// DB-backed halves run against a throwaway SQLite file built from the shipped
// migrations on an ephemeral port — same pattern as tests/exportRoute.test.js,
// never the developer's dev.db.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");

// ── env FIRST ──────────────────────────────────────────────────────────────
// src/lib/prisma.js instantiates a client at import time. Requiring anything
// from the app before DATABASE_URL is repointed would bind this test to the
// developer's real dev.db and then WRITE to it.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-e8-"));
const dbFile = path.join(tmpDir, "warning-integrity.db");
(function buildFreshInstallDb(file) {
  const migrationsDir = path.join(BACKEND, "prisma", "migrations");
  const names = fs
    .readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  assert.ok(names.length > 0, "no migrations found — cannot build a fresh-install DB");
  const db = new DatabaseSync(file);
  try {
    for (const name of names) db.exec(fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  } finally {
    db.close();
  }
})(dbFile);

process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
process.env.JWT_SECRET = "plan-warning-integrity-test-only-secret"; // scan:allow — fixture; keeps the developer's real secret out of this process
process.env.QC_NO_LISTEN = "1";
process.env.BRAIN = "off";
process.env.CUT_PROTOCOL_AUDIT = "off";

const PLANS_SRC = path.join(BACKEND, "src", "routes", "plans.js");
const { rebuildSlotFromClient, deriveSlotWarning } = require(PLANS_SRC);
// Pre-existing, NOT-under-test target arithmetic. The expected slot targets in
// the route tests are computed with these so the assertions never derive their
// own expectation from the code they are judging.
const { buildSlots, targetsForSlots, KCAL_TOLERANCE_PCT, PROTEIN_TOLERANCE_PCT } = require(path.join(BACKEND, "src", "lib", "weeklyPlanner.js"));

// ── pure-rebuild fixtures ──────────────────────────────────────────────────
// Same shape as tests/planLogic.test.js's POOL: baseGrams drive the 0.5-2x band.
const CHICKEN = {
  id: "r1", name: "Chicken & Rice", carb: 60,
  ingredients: [
    { foodId: "f1", role: "protein", scalable: true, baseGrams: 200, food: { name: "Chicken breast", kcal: 165, protein: 31, fat: 3.6, carb: 0 } },
    { foodId: "f2", role: "carb", scalable: true, baseGrams: 150, food: { name: "White rice", kcal: 130, protein: 2.7, fat: 0.3, carb: 28 } },
  ],
};
const POOL = [CHICKEN];
// Base portion (200 g chicken + 150 g rice) = 525.0 kcal / 66.05 g protein.
const BASE_INGREDIENTS = [{ foodId: "f1", grams: 200 }, { foodId: "f2", grams: 150 }];
const ON_TARGET = { kcalTarget: 525, proteinTarget: 60 };

// ═══ 1. the pure rebuild ═══════════════════════════════════════════════════

test("[E8] a client-supplied warning string is discarded, not stored", () => {
  const slot = rebuildSlotFromClient(
    { recipeId: "r1", warning: "Chef's kiss — perfectly on target!", ingredients: BASE_INGREDIENTS },
    POOL,
    ON_TARGET
  );
  assert.equal(
    slot.warning, null,
    "the slot lands on target, so the server's own verdict is null — the client's sentence must not survive"
  );
});

test("[E8] a client cannot invent a warning the server did not conclude", () => {
  // The mirror image of the test above: the forged text must not appear even
  // when the server DOES have something to say. What is stored is the server's
  // sentence, never the client's.
  const forged = "SEND BITCOIN TO ...";
  const slot = rebuildSlotFromClient(
    { recipeId: "r1", warning: forged, ingredients: [{ foodId: "f1", grams: 100 }, { foodId: "f2", grams: 75 }] },
    POOL,
    ON_TARGET
  );
  assert.ok(slot.warning, "a half portion against a 525 kcal target is a real miss and must be declared");
  assert.ok(!slot.warning.includes(forged), `client text leaked into the stored warning: ${slot.warning}`);
  assert.match(slot.warning, /263 kcal vs a 525 kcal slot/, "the server quotes the macros IT recomputed");
});

test("[E8] a client cannot erase a real target miss by sending warning:null", () => {
  // This is the dangerous direction. A forged sentence is noise; a suppressed
  // one is the silent target miss the constitution names.
  const slot = rebuildSlotFromClient(
    { recipeId: "r1", warning: null, ingredients: [{ foodId: "f1", grams: 100 }, { foodId: "f2", grams: 75 }] },
    POOL,
    ON_TARGET
  );
  assert.ok(slot.warning, "262.5 kcal into a 525 kcal slot is a 50% miss — silence here is the defect");
  assert.match(slot.warning, /couldn't close the gap/);
});

test("[E8] a protein-only shortfall is declared, not just a kcal miss", () => {
  // resolveSlot() warns on `best.proteinShort > PROTEIN_TOLERANCE_PCT` ALONE,
  // so those warnings used to reach the DB via the client round-trip. Deriving
  // from kcal only would have replaced a forgeable warning with a MISSING one —
  // trading one silent-miss defect for another.
  const slot = rebuildSlotFromClient(
    { recipeId: "r1", ingredients: BASE_INGREDIENTS },
    POOL,
    { kcalTarget: 525, proteinTarget: 120 } // kcal dead on, protein 45% short
  );
  assert.ok(slot.warning, "66 g protein against a 120 g target is a 45% shortfall");
  assert.match(slot.warning, /66g protein vs a 120g target/);
  assert.ok(!/kcal vs a/.test(slot.warning), "kcal is on target — it must not be named as a miss");
});

// Passes before AND after: pre-fix this client sent no warning, so null was
// stored for the wrong reason. It guards the FIX, not the defect — a derivation
// that treated protein symmetrically would warn on every well-fed slot.
test("GUARD: protein OVER target is not a miss (the shortfall is asymmetric, like the solver's)", () => {
  const slot = rebuildSlotFromClient({ recipeId: "r1", ingredients: BASE_INGREDIENTS }, POOL, { kcalTarget: 525, proteinTarget: 20 });
  assert.equal(slot.warning, null, "delivering 66 g against a 20 g target is inside the band by construction");
});

test("[E8] no slot target => no verdict, and still no client text", () => {
  // A slot the current meal config does not describe has no target to miss.
  // Null here is the honest answer; falling back to the client's string is not.
  const slot = rebuildSlotFromClient({ recipeId: "r1", warning: "trust me", ingredients: BASE_INGREDIENTS }, POOL);
  assert.equal(slot.warning, null);
});

test("GUARD: the rest of the rebuild contract is untouched (passes before AND after the fix)", () => {
  // Pool membership, ingredient ownership, the 0.5-2x grams band, server-side
  // macro recomputation and scale clamping all pre-date E8. If the warning fix
  // cost any of them, that is a worse bug than the one being fixed.
  assert.throws(() => rebuildSlotFromClient({ recipeId: "nope", ingredients: BASE_INGREDIENTS }, POOL, ON_TARGET), /allowed pool/);
  assert.throws(() => rebuildSlotFromClient({ recipeId: "r1", ingredients: [{ foodId: "f1", grams: 2000 }] }, POOL, ON_TARGET), /portion range/);
  assert.throws(() => rebuildSlotFromClient({ recipeId: "r1", ingredients: [{ foodId: "zzz", grams: 100 }] }, POOL, ON_TARGET), /does not belong/);
  assert.throws(() => rebuildSlotFromClient({ recipeId: "r1", ingredients: [] }, POOL, ON_TARGET), /at least one ingredient/);

  const ok = rebuildSlotFromClient({ recipeId: "r1", proteinScale: 20, sidesScale: 0.01, ingredients: BASE_INGREDIENTS }, POOL, ON_TARGET);
  assert.equal(Math.round(ok.kcal * 10) / 10, 525, "macros still recomputed from raw Food rows");
  assert.equal(ok.proteinScale, 2, "scale labels still clamped to the 0.5-2 band");
  assert.equal(ok.sidesScale, 0.5);
  assert.equal(ok.ingredients.length, 2, "ingredient names still resolved server-side");
});

// ═══ 2. the derivation itself ══════════════════════════════════════════════

test("[E8] deriveSlotWarning gates on the SOLVER's thresholds, not a re-typed literal", () => {
  // The pre-fix fill-today path hardcoded 0.15. Drifting these apart would make
  // a slot the solver rejects look acceptable once stored.
  assert.equal(KCAL_TOLERANCE_PCT, 0.15);
  assert.equal(PROTEIN_TOLERANCE_PCT, 0.12);

  const t = { kcalTarget: 1000, proteinTarget: 100 };
  // Just inside each tolerance — no verdict.
  assert.equal(deriveSlotWarning({ kcal: 1000 * (1 + KCAL_TOLERANCE_PCT * 0.9), protein: 100 }, t), null);
  assert.equal(deriveSlotWarning({ kcal: 1000, protein: 100 * (1 - PROTEIN_TOLERANCE_PCT * 0.9) }, t), null);
  // Just outside — a verdict, in the shipped wording.
  assert.match(deriveSlotWarning({ kcal: 1400, protein: 100 }, t), /1400 kcal vs a 1000 kcal slot — the 0\.5-2x portion limit couldn't close the gap\./);
  assert.match(deriveSlotWarning({ kcal: 1000, protein: 50 }, t), /50g protein vs a 100g target/);
  // Both miss => both are named; neither hides behind the other.
  const both = deriveSlotWarning({ kcal: 400, protein: 20 }, t);
  assert.match(both, /400 kcal vs a 1000 kcal slot/);
  assert.match(both, /20g protein vs a 100g target/);
  // UNDER-target kcal is a miss too (symmetric), not just over.
  assert.ok(deriveSlotWarning({ kcal: 500, protein: 100 }, t), "a slot 50% UNDER its kcal target is a miss");
  // Degenerate targets cannot manufacture a false verdict.
  assert.equal(deriveSlotWarning({ kcal: 500, protein: 40 }, { kcalTarget: 0, proteinTarget: 0 }), null);
  assert.equal(deriveSlotWarning({ kcal: 500, protein: 40 }, null), null);
});

test("[E8] the derivation exists exactly ONCE and no path reads a client warning", () => {
  // The reuse requirement. /fill-today-from-cart had the correct logic all
  // along; the fix had to SHARE it, not grow a second copy that can drift.
  const src = fs.readFileSync(PLANS_SRC, "utf8");
  const sentences = src.split("portion limit couldn't close the gap").length - 1;
  assert.equal(sentences, 1, "the miss sentence must be built in exactly one place");
  assert.ok(!/warning:\s*typeof\s+incoming\.warning/.test(src), "the client's warning must never be read back into a stored slot");
  assert.ok(!/ingredients,\s*\.\.\.totals,\s*warning:\s*null/.test(src), "place-recipe must not hardcode warning:null");
});

// ═══ 3. the ROUTES — proof the derivation is actually wired ════════════════

let app, srv, base, prisma, cookie, recipeId, foodId, snackTarget, mealTarget, BASE_GRAMS;

const call = async (method, p, body) => {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON kept in text */ }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
};

const slotOf = (plan, slotType, slotIndex, dayOfWeek) =>
  (plan.slots || []).find((s) => s.slotType === slotType && s.slotIndex === slotIndex && s.dayOfWeek === dayOfWeek);

// A weekday that is never "today", so /place-recipe and /accept-day cannot
// collide with anything date-derived.
const DAY = 3;

test.before(async () => {
  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  const { planContext } = require(path.join(BACKEND, "src", "lib", "planContext.js"));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const reg = await call("POST", "/api/auth/register", { email: "e8@example.test", password: "correct-horse-battery" });
  assert.ok(reg.status < 300, `register failed: ${reg.status} ${reg.text}`);
  cookie = (reg.setCookie || "").split(";")[0];
  const userId = (await prisma.user.findUnique({ where: { email: "e8@example.test" } })).id;

  await prisma.profile.create({
    data: {
      userId, sex: "M", age: 35, heightCm: 180, bodyFatPct: 20,
      occupationKey: "desk-office", sessionsPerWeek: 3,
      startWeightKg: 100, goalWeightKg: 90, startDate: "2026-01-01",
      excludedFormulas: [], excludedFoods: [], cuisinePreferences: [],
      targetKcal: 2400, mealsPerDay: 3, snacksPerDay: 1, dietaryStyle: null,
    },
  });

  // The pre-existing target arithmetic decides what the slots are worth. The
  // fixture recipe is then SIZED to those numbers, so the assertions below are
  // about the warning, never about whether the fixture happened to fit.
  const { dailyTarget, mealConfig } = await planContext(userId);
  const targets = targetsForSlots(dailyTarget, buildSlots(mealConfig));
  const find = (slotType, slotIndex) => targets.find((t) => t.dayOfWeek === DAY && t.slotType === slotType && t.slotIndex === slotIndex);
  snackTarget = find("snack", 0);
  mealTarget = find("meal", 0);
  assert.ok(snackTarget && mealTarget, "fixture profile must produce a snack 0 and a meal 0 target");

  // 100 kcal / 20 g protein per 100 g. Atwater: 4*20 + 4*3 + 9*1 = 101 ≈ 100.
  const food = await prisma.food.create({
    data: { name: "Plain test block", category: "protein", kcal: 100, protein: 20, fat: 1, carb: 3, fiber: 0, source: "manual" },
  });
  // Base portion = the SNACK slot's kcal target, so scale 1 lands on target and
  // scale 2 misses it by ~100%.
  BASE_GRAMS = Math.round(snackTarget.kcalTarget);
  const recipe = await prisma.recipe.create({
    data: {
      name: "E8 Warning Integrity Dish", steps: ["Weigh", "Eat"], slotType: "either", source: "curated",
      kcal: BASE_GRAMS, protein: BASE_GRAMS * 0.2, fat: BASE_GRAMS * 0.01, carb: BASE_GRAMS * 0.03,
      ingredients: { create: [{ foodId: food.id, baseGrams: BASE_GRAMS, scalable: true, role: "protein" }] },
    },
  });
  recipeId = recipe.id;
  foodId = food.id;

  // Fixture sanity: at scale 1 the dish must be protein-ABUNDANT for both slots,
  // so the "on target => null warning" cases are testing the kcal verdict and
  // are not silently rescued (or spoiled) by a protein shortfall.
  assert.ok(BASE_GRAMS * 0.2 > snackTarget.proteinTarget, "fixture must clear the snack protein target at 1x");
  assert.ok(BASE_GRAMS * 0.2 * 2 > mealTarget.proteinTarget, "fixture must clear the meal protein target at 2x");
});

test.after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prisma) await prisma.$disconnect();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("[E8] POST /plans/place-recipe derives the warning instead of storing null", async () => {
  // The x2 placement puts ~2x the snack slot's calories on the plate. Pre-fix
  // this route hardcoded `warning: null` for EVERY placement, so this stored
  // silence — the exact thing its sibling /fill-today-from-cart refuses to do.
  const res = await call("POST", "/api/plans/place-recipe", { dayOfWeek: DAY, slotType: "snack", slotIndex: 0, recipeId, scale: 2 });
  assert.equal(res.status, 200, res.text);
  const slot = slotOf(res.json, "snack", 0, DAY);
  assert.ok(slot, "the slot was written");
  assert.ok(slot.warning, `a ${Math.round(slot.kcal)} kcal dish in a ${Math.round(snackTarget.kcalTarget)} kcal slot must be declared, got null`);
  assert.match(slot.warning, new RegExp(`${Math.round(slot.kcal)} kcal vs a ${Math.round(snackTarget.kcalTarget)} kcal slot`));
});

test("GUARD: /plans/place-recipe stays SILENT when the placement is on target (passes before AND after)", async () => {
  // The counterweight. A fix that warns on everything is as useless as one that
  // warns on nothing — it just moves the noise.
  const res = await call("POST", "/api/plans/place-recipe", { dayOfWeek: DAY, slotType: "snack", slotIndex: 0, recipeId, scale: 1 });
  assert.equal(res.status, 200, res.text);
  const slot = slotOf(res.json, "snack", 0, DAY);
  assert.equal(slot.warning, null, `on-target placement (${Math.round(slot.kcal)} vs ${Math.round(snackTarget.kcalTarget)} kcal) must not warn`);
});

test("[E8] POST /plans/accept-day discards the client's warning and states the server's", async () => {
  const forged = "Perfectly balanced, as all things should be.";
  const res = await call("POST", "/api/plans/accept-day", {
    dayOfWeek: DAY,
    slots: [
      // On target for the snack slot, but the client claims a warning.
      { slotType: "snack", slotIndex: 0, recipeId, warning: forged, ingredients: [{ foodId, grams: BASE_GRAMS }] },
      // A genuine miss against the much larger meal slot — and the client is silent.
      { slotType: "meal", slotIndex: 0, recipeId, warning: null, ingredients: [{ foodId, grams: Math.round(BASE_GRAMS * 0.5) }] },
    ],
  });
  assert.equal(res.status, 200, res.text);

  const snack = slotOf(res.json, "snack", 0, DAY);
  assert.equal(snack.warning, null, "the forged warning must not be stored — the slot is on target");

  const meal = slotOf(res.json, "meal", 0, DAY);
  assert.ok(meal.warning, `${Math.round(meal.kcal)} kcal into a ${Math.round(mealTarget.kcalTarget)} kcal slot must be declared even though the client sent null`);
  assert.ok(!meal.warning.includes(forged));
  assert.match(meal.warning, /couldn't close the gap/);
});

test("[E8] PUT /plans/:planId/slots/:slotId/apply discards the client's warning", async () => {
  const current = await call("GET", "/api/plans/current");
  assert.equal(current.status, 200, current.text);
  const target = slotOf(current.json, "snack", 0, DAY);
  assert.ok(target, "the accept-day / place-recipe slot is on the current plan");

  const forged = "No notes, chef.";
  const res = await call("PUT", `/api/plans/${current.json.id}/slots/${target.id}/apply`, {
    recipeId, warning: forged,
    ingredients: [{ foodId, grams: Math.round(BASE_GRAMS * 2) }],
  });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.json.warning, "the applied alternate misses the snack target by ~100% and must say so");
  assert.ok(!res.json.warning.includes(forged), `client text leaked: ${res.json.warning}`);
  assert.match(res.json.warning, new RegExp(`vs a ${Math.round(snackTarget.kcalTarget)} kcal slot`));
});
