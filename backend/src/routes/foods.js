const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { validateFood, computeRecipeMacros } = require("../lib/foodValidation.js");
const { CATEGORY_SLUGS } = require("../lib/foodCategories.js");
const { loadFoodOverrides } = require("../lib/foodOverrides.js");
const { lookupUpc, normalizeUpc } = require("../lib/openFoodFactsClient.js");
const { assessImport, candidateFromOffProduct } = require("../lib/offImport.js");

const router = express.Router();
router.use(requireAuth);

// ── The Foods list payload ───────────────────────────────────────────────
// Everything EXCEPT `micros`. That one column is 6.9 MB of JSON across the
// 14,122-row table — half the entire response — and no client reads it from
// this endpoint: the only micronutrient consumer in the app
// (frontend/src/components/MicronutrientsCard.jsx) is fed by
// GET /api/micronutrients/today, which does its own targeted lookup of the
// ~dozen foods in today's plan. It was being shipped to the browser on every
// Foods tab open purely because `findMany` with no `select` means "every
// column". Measured through real Prisma on a copy of dev.db: 13.13 MB / 557 ms
// -> 6.11 MB / 226 ms for the unpaginated list, and 43.8 KB / 1.9 ms once the
// caller asks for a page.
//
// `dataQuality` stays IN, deliberately, even though it is another 1.19 MB —
// frontend/src/data/foodCategories.js reads it (dataQualityFlag /
// quarantineNote) to render the per-row provenance warning, so dropping it
// would silently blank a safety annotation. That is the whole reason this is
// an explicit allowlist rather than an `omit`: a new column added by someone
// else defaults to NOT shipped, and has to be added here on purpose.
const FOOD_LIST_SELECT = {
  id: true, name: true, category: true,
  fdcId: true, upc: true, brand: true,
  kcal: true, protein: true, fat: true, carb: true, fiber: true,
  source: true, dataQuality: true, fdcCategory: true,
  allergenTags: true, mayContain: true, createdAt: true,
};

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;
const clampInt = (raw, min, max, fallback) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

// GET /api/foods
//   ?search=<substring of name>   optional, both modes
//   ?category=<category slug>     optional, both modes
//   ?page=<1-based> &pageSize=<1..500>
//
// RESPONSE SHAPE — two modes, and the rule is exactly one thing:
// PRESENCE OF `page` OR `pageSize` SWITCHES THE SHAPE. Nothing else does.
//   * neither present -> a bare JSON ARRAY, unchanged from before this route
//     grew options, so every existing caller (api.js getFoods() ->
//     FoodsTab.jsx, which does `setFoods(await api.getFoods())` and then
//     `foods.filter(...)` / `foods.length`) keeps working untouched. It is
//     just 2.3x smaller now.
//   * either present -> { items, total, page, pageSize, hasMore }, where
//     `items` is the same row shape and `total` counts rows matching the
//     filter, not the page.
// `search` and `category` filter in BOTH modes and never change the shape, so
// a caller can adopt server-side search before it adopts pagination.
// Page/pageSize are CLAMPED rather than rejected, and the values actually used
// come back in the envelope — a client that asks for page 900 of 3 gets an
// honest empty page and can see why, instead of a 400 it has to interpret.
router.get("/", async (req, res) => {
  const { search, category, page, pageSize } = req.query;

  const where = {};
  if (typeof search === "string" && search.trim()) where.name = { contains: search.trim() };
  if (typeof category === "string" && category.trim()) where.category = category.trim();
  const orderBy = [{ category: "asc" }, { name: "asc" }];
  const query = { where, orderBy, select: FOOD_LIST_SELECT };

  if (page === undefined && pageSize === undefined) {
    return res.json(await prisma.food.findMany(query));
  }

  const size = clampInt(pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const pageNum = clampInt(page, 1, Number.MAX_SAFE_INTEGER, 1);
  const [items, total] = await Promise.all([
    prisma.food.findMany({ ...query, skip: (pageNum - 1) * size, take: size }),
    prisma.food.count({ where }),
  ]);
  res.json({ items, total, page: pageNum, pageSize: size, hasMore: pageNum * size < total });
});

// ── Open Food Facts barcode lookup (barcode-off track) ──────────────────
// Manual UPC entry is the primary path (CLAUDE.md track brief). Two steps,
// mirroring the recipe importer's fetch→review→save shape: GET previews
// what OFF has and how it scored against the shared validator WITHOUT
// writing anything, so a shopper can see a flagged/rejected panel before
// deciding; POST actually saves. Neither step ever touches
// backend/scripts/** or the validator itself — both are imported read-only.

// GET /foods/lookup-upc/:upc — preview only, never writes to the DB.
router.get("/lookup-upc/:upc", async (req, res) => {
  const upc = normalizeUpc(req.params.upc);
  const existing = await prisma.food.findUnique({ where: { upc } });
  if (existing) return res.json({ alreadyImported: true, food: existing });

  let product;
  try {
    product = await lookupUpc(upc);
  } catch (e) {
    return res.status(502).json({ error: `Open Food Facts lookup failed: ${e.message}` });
  }
  if (!product.found) return res.status(404).json({ found: false, reason: product.reason });

  const candidate = candidateFromOffProduct(product);
  const assessment = assessImport(candidate);
  res.json({
    found: true,
    product,
    candidate,
    verdict: assessment.verdict, // "pass" | "warn" | "reject"
    dataQuality: assessment.dataQuality,
    issues: assessment.issues,
    importable: assessment.verdict !== "reject",
  });
});

// POST /foods/import-upc { upc } — re-fetches and re-validates itself
// rather than trusting any client-supplied macro number, then saves.
// source is hard-pinned to "community" here (not merely by convention) —
// this route structurally cannot create a "usda-verified" row, and it
// never overwrites an existing food (of ANY provenance) for the same UPC.
router.post("/import-upc", async (req, res) => {
  const upc = normalizeUpc(req.body?.upc);
  if (!upc) return res.status(400).json({ error: "upc is required" });

  const existing = await prisma.food.findUnique({ where: { upc } });
  if (existing) return res.json({ alreadyImported: true, food: existing });

  let product;
  try {
    product = await lookupUpc(upc);
  } catch (e) {
    return res.status(502).json({ error: `Open Food Facts lookup failed: ${e.message}` });
  }
  if (!product.found) return res.status(404).json({ found: false, reason: product.reason });

  const candidate = candidateFromOffProduct(product);
  const assessment = assessImport(candidate);
  if (assessment.verdict === "reject") {
    return res.status(422).json({
      error: "this product's Open Food Facts panel doesn't reconcile with itself — not imported",
      issues: assessment.issues,
      product,
    });
  }

  try {
    const food = await prisma.food.create({
      data: { ...candidate, source: "community", dataQuality: assessment.dataQuality },
    });
    res.status(201).json({ food, verdict: assessment.verdict, issues: assessment.issues, notes: product.notes });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "a food with this UPC already exists" });
    throw e;
  }
});

// GET /api/foods/:id — the whole row, INCLUDING `micros`.
// The counterpart to the list's allowlist: micronutrients are still reachable,
// just per-food-on-demand instead of 14,122-at-a-time. Registered after the
// two /lookup-upc and /import-upc routes so a literal path segment always wins
// over this wildcard.
router.get("/:id", async (req, res) => {
  const food = await prisma.food.findUnique({ where: { id: req.params.id } });
  if (!food) return res.status(404).json({ error: "food not found" });
  res.json(food);
});

const EDITABLE = ["name", "category", "kcal", "protein", "fat", "carb", "fiber"];
const r1 = (n) => Math.round(n * 10) / 10;

// Foods are a shared library (every recipe and plan reads them), so edits are
// admin-only — same policy recipes.js applies to library content. The Phase 2
// guardrail: nothing invalid gets written, and cached recipe macros are
// recomputed for every recipe that uses the edited food.
router.put("/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (user?.role !== "admin") {
    return res.status(403).json({ error: "food library edits are admin-only" });
  }
  const food = await prisma.food.findUnique({ where: { id: req.params.id } });
  if (!food) return res.status(404).json({ error: "food not found" });

  const patch = {};
  for (const key of EDITABLE) {
    if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  }
  const candidate = { ...food, ...patch };
  const { ok, issues } = validateFood(candidate, {
    exemptions: loadFoodOverrides(),
    validCategories: CATEGORY_SLUGS,
  });
  if (!ok) {
    return res.status(400).json({ error: "food fails validation", issues });
  }
  // A hand-edit supersedes whatever record the row pointed at before.
  if (patch.kcal !== undefined || patch.protein !== undefined || patch.fat !== undefined || patch.carb !== undefined) {
    patch.source = "manual";
    // …and the row must stop CLAIMING that record. Flipping source while
    // leaving fdcId in place produced a row that says two contradictory things
    // at once — the UI rendered "LABEL/MANUAL · FDC 170160", i.e. "these
    // numbers are hand-entered" next to "these numbers are USDA record
    // 170160". Under the constitution's provenance rule that is the one thing
    // a food row may never do.
    //
    // It is also a slow leak: Food.fdcId is @unique precisely so one FDC
    // record can belong to exactly one row, so a stale id on a row that no
    // longer holds that record's macros PERMANENTLY BLOCKS a genuine future
    // import of it — the importer would hit P2002 against a row that isn't
    // really it. Releasing the id costs nothing (the macros here are now
    // hand-entered by definition) and the link is not lost, only demoted: the
    // id is written into dataQuality below, where the provenance audit trail
    // already lives.
    //
    // fdcCategory is deliberately NOT cleared. It is allergen evidence
    // ("Finfish and Shellfish Products"), dietaryFilter.js unions it with the
    // name-keyword verdict, and the schema's add-only invariant says nothing
    // may CLEAR an exclusion another source raised. The food is still the same
    // food; only its numbers were re-entered.
    if (food.fdcId != null) {
      patch.fdcId = null;
      const prior = food.dataQuality ? ` (previously: ${food.dataQuality})` : "";
      patch.dataQuality =
        `manual-edit — macros hand-entered ${new Date().toISOString().slice(0, 10)}; ` +
        `released FDC id ${food.fdcId}, whose record no longer describes this row's numbers${prior}`;
    }
  }

  try {
    // ── One transaction (fix: this was N+1 unrelated writes) ──────────────
    // The food update and the recipe-cache recomputation are ONE fact, not
    // several. Unwrapped, a failure partway through the loop (a crash, a
    // closed connection, a locked DB) committed the new food macros and only
    // SOME of the recipe caches, leaving the rest silently disagreeing with
    // their own ingredients — the exact drift the recompute exists to prevent,
    // and invisible because each individual write succeeded.
    //
    // The explicit timeout is not decoration. This ripple is unbounded by the
    // data: "Olive Oil" is an ingredient in 367 of the 889 recipes, so an edit
    // to it is 367 sequential updates in one transaction, and Prisma's default
    // interactive-transaction budget is 5 s. Raised to 30 s with a 10 s queue
    // wait so a legitimate large ripple completes instead of rolling back and
    // telling the admin nothing useful.
    //
    // The ingredient fetch selects only what computeRecipeMacros reads rather
    // than `include: { food: true }`, which pulled every column of every
    // ingredient's food — including the `micros` JSON blob — for all 367
    // recipes, inside the transaction, where it held locks the whole time.
    const { updated, recipesRecomputed } = await prisma.$transaction(
      async (tx) => {
        const updatedFood = await tx.food.update({ where: { id: food.id }, data: patch });

        // Ripple: recipes cache per-serving macros — recompute every recipe that
        // contains this food so the caches never drift from their ingredients.
        const affected = await tx.recipe.findMany({
          where: { ingredients: { some: { foodId: food.id } } },
          select: {
            id: true,
            ingredients: {
              select: {
                baseGrams: true,
                food: { select: { kcal: true, protein: true, fat: true, carb: true } },
              },
            },
          },
        });
        for (const r of affected) {
          const t = computeRecipeMacros(r.ingredients);
          await tx.recipe.update({
            where: { id: r.id },
            data: { kcal: r1(t.kcal), protein: r1(t.protein), fat: r1(t.fat), carb: r1(t.carb) },
          });
        }
        return { updated: updatedFood, recipesRecomputed: affected.length };
      },
      { timeout: 30_000, maxWait: 10_000 }
    );

    res.json({ food: updated, recipesRecomputed });
  } catch (e) {
    // P2002 = unique violation. The message used to name `patch.name`, which is
    // now doubly wrong: Food.name stopped being @unique when the USDA import
    // landed (see schema.prisma — FDC ships duplicate descriptions), so a name
    // collision is no longer even possible, and on a rename-only edit
    // `patch.name` is undefined and the sentence read 'a food named "undefined"'.
    // The only unique columns left are fdcId and upc, so report the one the
    // database actually rejected.
    if (e.code === "P2002") {
      const fields = e.meta?.target;
      const which = Array.isArray(fields) ? fields.join(", ") : fields || "a unique field";
      return res.status(409).json({ error: `another food already claims this ${which}` });
    }
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
