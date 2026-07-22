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

router.get("/", async (req, res) => {
  const foods = await prisma.food.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  res.json(foods);
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
  }

  try {
    const updated = await prisma.food.update({ where: { id: food.id }, data: patch });

    // Ripple: recipes cache per-serving macros — recompute every recipe that
    // contains this food so the caches never drift from their ingredients.
    const affected = await prisma.recipe.findMany({
      where: { ingredients: { some: { foodId: food.id } } },
      include: { ingredients: { include: { food: true } } },
    });
    for (const r of affected) {
      const t = computeRecipeMacros(r.ingredients);
      await prisma.recipe.update({
        where: { id: r.id },
        data: { kcal: r1(t.kcal), protein: r1(t.protein), fat: r1(t.fat), carb: r1(t.carb) },
      });
    }

    res.json({ food: updated, recipesRecomputed: affected.length });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: `a food named "${patch.name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
