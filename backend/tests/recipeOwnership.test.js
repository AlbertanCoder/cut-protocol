// Recipe OWNERSHIP — who is stamped as the creator of a recipe row, and what
// that stamp does (and does NOT) change.
//
// THE DEFECT THIS LOCKS (QC fleet, live multi-tenant deploy):
// Recipe.createdByUserId exists, and routes/recipes.js's assertCanMutateRecipe
// is written around it — "a recipe with a creator may only be mutated by that
// creator or an admin; a recipe with createdByUserId:null is pre-multi-tenancy
// shared/curated content, admin-only". But no write path ever set the column
// except POST /api/import (routes/export.js:814). Every AI-generated, brain-
// generated, web-imported and hand-saved recipe landed with
// createdByUserId = null, so the "creator" branch was unreachable: the person
// who had just created a recipe got 403 on their own PUT and DELETE, and only
// an admin could touch it. On a deploy with five QA users that is a real
// asymmetry — everyone can add to the library, nobody can maintain what they
// added.
//
// THE OTHER HALF, ASSERTED HERE AS A CHARACTERIZATION, NOT A FIX:
// stamping ownership does NOT scope VISIBILITY. Every read of Recipe on the
// solver/library path queries with no owner predicate —
// planContext.loadRecipeLibrary (`prisma.recipe.findMany({ select:
// RECIPE_GATE_SELECT })`), GET /api/recipes, brain/chat.js, and the durable AI
// cache (recipeBrain/sources/cacheSource.js, keyed on aiFingerprint). So an
// owned recipe stays in EVERY other user's pool exactly as an owner-less one
// did. The last two tests in this file assert that on purpose: if someone later
// adds an owner filter to the pool, they must come here and decide it
// deliberately, rather than discover it as a silent behaviour change.
//
// ENVIRONMENT. The throwaway SQLite install is built and DATABASE_URL is
// repointed at the TOP OF THIS FILE, before a single backend module is
// required, because src/lib/prisma.js constructs its PrismaClient at require
// time and Prisma's own env loading pulls backend/.env in with it. The
// developer's dev.db is never opened by this file.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");

function buildFreshInstallDb(file) {
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
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-ownership-"));
const dbFile = path.join(tmpDir, "ownership-test.db");
buildFreshInstallDb(dbFile);

process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
process.env.JWT_SECRET = "recipe-ownership-test-only-secret"; // scan:allow — fixture; keeps the developer's real secret out of this process
process.env.QC_NO_LISTEN = "1";
process.env.BRAIN = "off";
process.env.CUT_PROTOCOL_AUDIT = "off";

const { prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js"));
const { generateAndSaveSlotRecipe } = require(path.join(BACKEND, "src", "lib", "recipeGeneration.js"));
const { routeMealSlot, makeRouterStats } = require(path.join(BACKEND, "src", "lib", "mealRouter.js"));
const { solveRecipeForSlot, makeStats } = require(path.join(BACKEND, "src", "lib", "recipeBrain", "orchestrator.js"));
const { makeSlotCache } = require(path.join(BACKEND, "src", "lib", "brain", "slotCache.js"));
const { makeBudget } = require(path.join(BACKEND, "src", "lib", "brain", "userBudget.js"));
const { memoryStore } = require(path.join(BACKEND, "src", "lib", "brain", "ledger.js"));
const planContext = require(path.join(BACKEND, "src", "lib", "planContext.js"));
const { hashPassword, signToken } = require(path.join(BACKEND, "src", "lib", "auth.js"));
const app = require(path.join(BACKEND, "server.js"));

// ── fixtures ────────────────────────────────────────────────────────────────

const CHICKEN_MACROS = [165, 31, 3.6, 0];
const RICE_MACROS = [130, 2.7, 0.3, 28];
const memFood = (id, name, m) => ({ id, name, category: "other", kcal: m[0], protein: m[1], fat: m[2], carb: m[3], fiber: 0, source: "manual" });

const ing = (f, grams, role, scalable = true) => ({ foodId: f.id, baseGrams: grams, scalable, role, food: f });
function poolRecipe(id, name, ings, over = {}) {
  const t = ings.reduce((s, i) => {
    const k = i.baseGrams / 100;
    return { kcal: s.kcal + i.food.kcal * k, protein: s.protein + i.food.protein * k, fat: s.fat + i.food.fat * k, carb: s.carb + i.food.carb * k };
  }, { kcal: 0, protein: 0, fat: 0, carb: 0 });
  return { id, name, slotType: "meal", mealCategory: null, source: "curated", steps: [], description: null, cuisine: null, prepTimeMin: 20, ingredients: ings, ...t, ...over };
}

const DRAFT = {
  name: "Grilled Chicken Rice Plate", description: "Lean and simple.", cuisine: "western-comfort",
  slotType: "meal", prepTimeMin: 20, servings: 1, steps: ["Grill chicken.", "Serve over rice."],
  ingredients: [
    { name: "Chicken breast", grams: 150, role: "protein", scalable: true },
    { name: "White rice", grams: 150, role: "carb", scalable: true },
  ],
  tasteTier: "decent",
};

const SLOT_TARGET = { slotType: "meal", kcalTarget: 620, proteinTarget: 45 };
const DAILY_TARGET = { kcal: 2100, proteinLo: 150, proteinHi: 170, fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210, keto: false };
const ACTING_USER_MEM = "user-acting-42"; // for the fully in-memory channels
const PROFILE_MEM = {
  userId: ACTING_USER_MEM, dietaryStyle: null, excludedFoods: [],
  cuisinePreferences: [], mealPreferencesNote: null, mealsPerDay: 3, snacksPerDay: 0,
};

let srv, base;
let userAdmin, cookieAdmin, userSaver, cookieSaver, userOther, cookieOther;
let chickenId, riceId, libraryRecipeId;

async function call(method, p, { body, cookie } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON kept in text */ }
  return { status: res.status, json, text };
}

const draftBody = (name) => ({
  name,
  description: "saved from the draft editor",
  slotType: "meal",
  prepTimeMin: 20,
  steps: ["Grill the chicken.", "Serve over rice."],
  ingredients: [
    { foodId: chickenId, grams: 150, role: "protein", scalable: true },
    { foodId: riceId, grams: 150, role: "carb", scalable: true },
  ],
  source: "ai-generated",
});

test.before(async () => {
  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  // Users are created DIRECTLY rather than through /api/auth/register, because
  // the "first account becomes admin" rule is disabled on a hosted deploy
  // (auth.js:125 — `isFirstRun && !isSupabaseAuthEnabled()`) and a developer
  // with SUPABASE_URL in backend/.env would silently get a plain user here.
  // Roles are the whole subject of this file; they are stated, not inferred.
  const hashA = await hashPassword("correct-horse-battery");
  const a = await prisma.user.create({ data: { email: "admin@example.test", passwordHash: hashA, role: "admin" } });
  userAdmin = a.id;
  cookieAdmin = `cutprotocol_session=${signToken(userAdmin, hashA)}`;

  // The saver is deliberately NOT the admin: an admin passes
  // assertCanMutateRecipe on the ROLE branch, which would make every "the
  // creator can edit their own recipe" claim below pass vacuously.
  const hashS = await hashPassword("correct-horse-battery-2");
  const s = await prisma.user.create({ data: { email: "saver@example.test", passwordHash: hashS } });
  userSaver = s.id;
  cookieSaver = `cutprotocol_session=${signToken(userSaver, hashS)}`;
  assert.notEqual(s.role, "admin", "the saver must be a plain user or the ownership branch is never exercised");

  const hashO = await hashPassword("correct-horse-battery-3");
  const o = await prisma.user.create({ data: { email: "other@example.test", passwordHash: hashO } });
  userOther = o.id;
  cookieOther = `cutprotocol_session=${signToken(userOther, hashO)}`;
  assert.notEqual(o.role, "admin");

  const mk = (name, m) => prisma.food.create({
    data: { name, category: "protein", kcal: m[0], protein: m[1], fat: m[2], carb: m[3], fiber: 0, source: "manual" },
  });
  chickenId = (await mk("Chicken breast", CHICKEN_MACROS)).id;
  riceId = (await mk("White rice", RICE_MACROS)).id;

  // A CURATED, owner-less library row — the pre-multi-tenancy shape that must
  // keep behaving exactly as it does today.
  libraryRecipeId = (await prisma.recipe.create({
    data: {
      name: "Seeded library stew", steps: ["Simmer."], source: "curated",
      kcal: 500, protein: 25, fat: 20, carb: 45,
      ingredients: { create: [{ foodId: chickenId, baseGrams: 150 }] },
    },
  })).id;
});

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — the four write paths, with persistence injected.
// ═══════════════════════════════════════════════════════════════════════════

// generateAndSaveSlotRecipe threads no loadFoodsImpl, so resolveDraftIngredients
// re-fetches the resolved rows through prisma. This resolver therefore returns
// the REAL rows created in the before hook (against the throwaway install), so
// the re-fetch succeeds and the macro sum is computed from real rows exactly as
// it is in production.
const resolveFromDb = async (name) => {
  assert.ok(chickenId && riceId, "the before hook must have created the fixture foods");
  const byName = {
    "Chicken breast": memFood(chickenId, "Chicken breast", CHICKEN_MACROS),
    "White rice": memFood(riceId, "White rice", RICE_MACROS),
  };
  const f = byName[name];
  if (!f) return { food: { id: `ph-${name}`, name, kcal: 0, protein: 0, fat: 0, carb: 0 }, matched: "placeholder", status: "needs_review", needsReview: true };
  return { food: f, matched: "existing", status: "resolved", needsReview: false, confidence: 1 };
};

test("weekly-solver AI fallback stamps the acting user as the creator", async () => {
  let opts = null;
  await generateAndSaveSlotRecipe(
    SLOT_TARGET,
    { ...PROFILE_MEM, userId: userSaver },
    [],
    {
      generateDraftsImpl: async () => ({ drafts: [DRAFT] }),
      resolveIngredientImpl: resolveFromDb,
      persistRecipeImpl: async (resolved, o) => { opts = o; return { id: "saved", name: resolved.name }; },
    }
  );
  assert.equal(opts.createdByUserId, userSaver,
    "a recipe generated for a user's plan must carry that user as its creator — without it the row is owner-less and they cannot edit or delete it");
  assert.equal(opts.source, "ai-generated", "provenance is unchanged by the ownership stamp");
});

test("weekly-solver AI fallback persists owner-less when the profile carries no userId (seed/fixture paths unchanged)", async () => {
  let opts = null;
  await generateAndSaveSlotRecipe(
    SLOT_TARGET,
    { dietaryStyle: null, excludedFoods: [] }, // no userId
    [],
    {
      generateDraftsImpl: async () => ({ drafts: [DRAFT] }),
      resolveIngredientImpl: resolveFromDb,
      persistRecipeImpl: async (resolved, o) => { opts = o; return { id: "saved", name: resolved.name }; },
    }
  );
  assert.equal(opts.createdByUserId, null, "null, never undefined — persistRecipe treats null as 'shared library content'");
});

test("mealRouter: a generated recipe carries the acting user as its creator", async () => {
  const CHICKEN = memFood("f-chicken", "Chicken breast", CHICKEN_MACROS);
  const RICE = memFood("f-rice", "White rice", RICE_MACROS);
  const memResolve = async (name) => {
    const f = name === CHICKEN.name ? CHICKEN : name === RICE.name ? RICE : null;
    if (!f) return { food: { id: `ph-${name}`, name, kcal: 0, protein: 0, fat: 0, carb: 0 }, matched: "placeholder", status: "needs_review", needsReview: true };
    return { food: f, matched: "existing", status: "resolved", needsReview: false, confidence: 1 };
  };
  // Structurally cannot reach the slot target at any legal portion, so the
  // router is forced past the library and into a real persistence call.
  const riceOnly = poolRecipe("r-rice", "Plain Rice Bowl", [ing(RICE, 100, "carb")]);

  const persisted = [];
  const out = await routeMealSlot(
    { target: SLOT_TARGET, profile: PROFILE_MEM, recipePool: [riceOnly], existingRecipeNames: [] },
    {
      generateDraftsImpl: async () => ({ drafts: [DRAFT], droppedForAllergies: [], droppedForShape: [] }),
      resolveIngredientImpl: memResolve,
      loadFoodsImpl: async (ids) => [CHICKEN, RICE].filter((f) => ids.includes(f.id)),
      persistRecipeImpl: async (resolved, o) => { persisted.push(o); return { id: "r-new", name: resolved.name }; },
      cache: makeSlotCache(),
      budget: makeBudget({ store: memoryStore(), userId: ACTING_USER_MEM }),
      stats: makeRouterStats(),
    }
  );
  assert.equal(out.status, "generated", "the fixture pool cannot answer this slot, so generation must have run");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].createdByUserId, ACTING_USER_MEM);
});

test("recipe brain: an AI-generated recipe carries the acting user as its creator", async () => {
  const CHICKEN = memFood("f-chicken", "Chicken breast", CHICKEN_MACROS);
  const RICE = memFood("f-rice", "White rice", RICE_MACROS);
  const memResolve = async (name) => {
    const f = name === CHICKEN.name ? CHICKEN : name === RICE.name ? RICE : null;
    if (!f) return { food: { id: `ph-${name}`, name, kcal: 0, protein: 0, fat: 0, carb: 0 }, matched: "placeholder", status: "needs_review", needsReview: true };
    return { food: f, matched: "existing", status: "resolved", needsReview: false, confidence: 1 };
  };
  const riceOnly = poolRecipe("r-rice", "Plain Rice Bowl", [ing(RICE, 100, "carb")]);

  const persisted = [];
  const out = await solveRecipeForSlot(
    { target: SLOT_TARGET, dailyTarget: DAILY_TARGET, profile: PROFILE_MEM, recipePool: [riceOnly], existingRecipeNames: [] },
    {
      persistRecipeImpl: async (resolved, o) => { persisted.push(o); return { id: "r-brain-new", name: resolved.name }; },
      resolveIngredientImpl: memResolve,
      loadFoodsImpl: async (ids) => [CHICKEN, RICE].filter((f) => ids.includes(f.id)),
      stats: makeStats(),
      now: () => new Date("2026-08-14T12:00:00Z"),
      cacheDeps: { cache: makeSlotCache(), findByFingerprintImpl: async () => [] },
      aiDeps: {
        budget: makeBudget({ store: memoryStore(), userId: ACTING_USER_MEM }),
        generateDraftsImpl: async () => ({ drafts: [DRAFT], droppedForAllergies: [], droppedForShape: [] }),
      },
      webDeps: {
        registry: { maxImportsPerSite: 2, sources: [] },
        fetchTextImpl: async () => { throw new Error("no web in this test"); },
        importImpl: async () => { throw new Error("no web in this test"); },
        delayImpl: async () => {},
      },
    }
  );
  assert.equal(out.status, "generated");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].createdByUserId, ACTING_USER_MEM);
  assert.equal(persisted[0].source, "ai-generated", "the durable-cache stamps still travel alongside ownership");
  assert.ok(persisted[0].aiVerifiedAt, "aiVerifiedAt is unchanged by the ownership stamp");
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — the route, end to end.
// ═══════════════════════════════════════════════════════════════════════════

test("POST /api/recipes/save-draft stamps the saver as the creator", async () => {
  const res = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Saver's Chicken Rice Plate") });
  assert.equal(res.status, 201, res.text);
  const row = await prisma.recipe.findUnique({ where: { id: res.json.id } });
  assert.equal(row.createdByUserId, userSaver,
    "a hand-saved recipe landed owner-less: assertCanMutateRecipe's creator branch is then unreachable and the saver cannot maintain their own row");
});

test("the creator can EDIT and DELETE their own saved recipe (the asymmetry this fixes)", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Saver's Editable Plate") });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;

  const put = await call("PUT", `/api/recipes/${id}`, { cookie: cookieSaver, body: { description: "edited by its creator" } });
  assert.equal(put.status, 200, `the creator must be able to edit their own recipe — got ${put.status} ${put.text}`);
  assert.equal(put.json.description, "edited by its creator");

  const del = await call("DELETE", `/api/recipes/${id}`, { cookie: cookieSaver });
  assert.equal(del.status, 204, `the creator must be able to delete their own recipe — got ${del.status} ${del.text}`);
  assert.equal(await prisma.recipe.findUnique({ where: { id } }), null);
});

test("a DIFFERENT plain user still cannot edit or delete someone else's recipe", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Saver's Defended Plate") });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;

  const put = await call("PUT", `/api/recipes/${id}`, { cookie: cookieOther, body: { description: "not yours" } });
  assert.equal(put.status, 403);
  const del = await call("DELETE", `/api/recipes/${id}`, { cookie: cookieOther });
  assert.equal(del.status, 403);

  const still = await prisma.recipe.findUnique({ where: { id } });
  assert.equal(still.description, "saved from the draft editor", "a refused edit must not have written anything");
  assert.equal(still.createdByUserId, userSaver, "ownership is not transferable by a failed mutation");
});

test("the seeded, owner-less library row stays admin-only — curated content is unchanged", async () => {
  const put = await call("PUT", `/api/recipes/${libraryRecipeId}`, { cookie: cookieSaver, body: { description: "not yours either" } });
  assert.equal(put.status, 403, "createdByUserId:null still means 'shared/curated content, admin only'");

  const adminPut = await call("PUT", `/api/recipes/${libraryRecipeId}`, { cookie: cookieAdmin, body: { description: "curated edit" } });
  assert.equal(adminPut.status, 200, adminPut.text);

  const row = await prisma.recipe.findUnique({ where: { id: libraryRecipeId } });
  assert.equal(row.createdByUserId, null, "an admin edit must not accidentally claim ownership of a curated row");
});

// ── the half this change does NOT fix, asserted so it cannot drift silently ──

test("VISIBILITY IS UNCHANGED: an owned recipe is still in every other user's library listing", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Saver's Shared-Pool Plate") });
  assert.equal(created.status, 201, created.text);

  const listed = await call("GET", "/api/recipes", { cookie: cookieOther });
  assert.equal(listed.status, 200, listed.text);
  const names = listed.json.recipes.map((r) => r.name);
  assert.ok(names.includes("Saver's Shared-Pool Plate"),
    "GET /api/recipes has no owner predicate, so stamping ownership does not stop one user's recipe reaching another's library");
  assert.ok(names.includes("Seeded library stew"), "and the curated owner-less row is still visible to everyone");

  const mine = await call("GET", "/api/recipes", { cookie: cookieSaver });
  assert.ok(mine.json.recipes.map((r) => r.name).includes("Saver's Shared-Pool Plate"),
    "the creator still sees their own recipe — the stamp must not hide it from them either");
});

test("VISIBILITY IS UNCHANGED: an owned recipe is still in every other user's SOLVER POOL", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Saver's Solver-Pool Plate") });
  assert.equal(created.status, 201, created.text);
  planContext.invalidateRecipeLibrary();

  const noRules = { dietaryStyle: null, excludedFoods: [] };
  const { pool } = await planContext.loadRecipePool(noRules);
  const names = pool.map((r) => r.name);
  assert.ok(names.includes("Saver's Solver-Pool Plate"),
    "planContext.loadRecipeLibrary queries Recipe with no owner predicate — ownership does NOT partition the pool, so the shared-library pollution half of the finding remains open");
  assert.ok(names.includes("Seeded library stew"));

  const library = await planContext.loadRecipeLibrary();
  const owned = library.find((r) => r.name === "Saver's Solver-Pool Plate");
  assert.equal(owned.createdByUserId, userSaver,
    "the pool rows do carry the owner (RECIPE_GATE_SELECT selects it) — nothing reads it as a filter today");
});

// ── the hazard creator-delete introduced, and its guard ─────────────────────
// Stamping ownership made DELETE reachable by a creator for the first time.
// The solver pool is NOT partitioned by owner, so another user's plan or cart
// can legitimately hold this recipe — and the schema then harms them on the
// deleter's behalf: CartItem.recipe is onDelete CASCADE (their cart row is
// destroyed) and PlanSlot.recipe is onDelete SET NULL (their saved plan slot
// silently loses its meal). A user must not be able to do that to a stranger
// by tidying up their own list.
test("a creator CANNOT delete a recipe that is in ANOTHER user's plan (409, and nothing is destroyed)", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Shared Plate In Someone Elses Week") });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;

  // userOther builds a plan that uses it — exactly what the shared pool allows.
  const plan = await prisma.plan.create({ data: { userId: userOther, startDate: "2026-08-17" } });
  await prisma.planSlot.create({
    data: { planId: plan.id, dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: id, ingredients: [], kcal: 500, protein: 30, fat: 15, carb: 45 },
  });

  const del = await call("DELETE", `/api/recipes/${id}`, { cookie: cookieSaver });
  assert.equal(del.status, 409, `deleting out from under another user's plan must be refused — got ${del.status} ${del.text}`);
  assert.equal(del.json.code, "recipe_in_use");

  // The whole point: the other user's plan slot still has its meal.
  assert.ok(await prisma.recipe.findUnique({ where: { id } }), "the recipe must survive a refused delete");
  const slot = await prisma.planSlot.findFirst({ where: { planId: plan.id } });
  assert.equal(slot.recipeId, id, "another user's plan slot was emptied by someone else's delete");
});

test("a creator CANNOT delete a recipe sitting in ANOTHER user's cart", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Shared Plate In Someone Elses Cart") });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;
  await prisma.cartItem.create({ data: { userId: userOther, recipeId: id } });

  const del = await call("DELETE", `/api/recipes/${id}`, { cookie: cookieSaver });
  assert.equal(del.status, 409, `got ${del.status} ${del.text}`);
  assert.equal(await prisma.cartItem.count({ where: { recipeId: id, userId: userOther } }), 1,
    "another user's cart item was destroyed by someone else's delete (onDelete: Cascade)");
});

test("the creator's OWN plan or cart never blocks their delete", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("My Own Mistake Plate") });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;
  await prisma.cartItem.create({ data: { userId: userSaver, recipeId: id } });

  const del = await call("DELETE", `/api/recipes/${id}`, { cookie: cookieSaver });
  assert.equal(del.status, 204, `own-cart must not block the creator — got ${del.status} ${del.text}`);
  assert.equal(await prisma.recipe.findUnique({ where: { id } }), null);
});

test("an ADMIN may still delete a recipe another user is relying on (curation stays possible)", async () => {
  const created = await call("POST", "/api/recipes/save-draft", { cookie: cookieSaver, body: draftBody("Admin Curated Away Plate") });
  assert.equal(created.status, 201, created.text);
  const id = created.json.id;
  await prisma.cartItem.create({ data: { userId: userOther, recipeId: id } });

  const del = await call("DELETE", `/api/recipes/${id}`, { cookie: cookieAdmin });
  assert.equal(del.status, 204, `an admin curating the library must not be blocked — got ${del.status} ${del.text}`);
});
