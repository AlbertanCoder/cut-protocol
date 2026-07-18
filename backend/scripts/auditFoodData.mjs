// Phase 2 audit: scan every Food and Recipe row, report every failure.
// Read-only — never writes to the DB. Run:  node scripts/auditFoodData.mjs
// Writes a JSON report to backend/reports/ and prints a summary.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prismaPkg from "../src/lib/prisma.js";
import validationPkg from "../src/lib/foodValidation.js";
import categoriesPkg from "../src/lib/foodCategories.js";

const { prisma } = prismaPkg;
const { validateFood, validateRecipe, findDuplicateGroups } = validationPkg;
const { CATEGORY_SLUGS, classifyFood } = categoriesPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = path.join(__dirname, "..", "data", "foodOverrides.json");

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_PATH)) return {};
  const raw = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
  const byKey = {};
  for (const [name, entry] of Object.entries(raw)) byKey[name.trim().toLowerCase()] = entry;
  return byKey;
}

async function main() {
  const overrides = loadOverrides();
  const foods = await prisma.food.findMany({ orderBy: { name: "asc" } });
  const recipes = await prisma.recipe.findMany({
    include: { ingredients: { include: { food: true } } },
    orderBy: { name: "asc" },
  });

  // ── foods ──
  const foodFailures = [];
  for (const f of foods) {
    const { ok, issues } = validateFood(f, { exemptions: overrides, validCategories: CATEGORY_SLUGS });
    if (!ok) foodFailures.push({ id: f.id, name: f.name, source: f.source, fdcId: f.fdcId, category: f.category, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb, fiber: f.fiber, issues });
  }

  // ── duplicates ──
  const dupGroups = findDuplicateGroups(foods).map(([key, members]) => ({
    key,
    members: members.map((m) => ({ id: m.id, name: m.name, source: m.source, fdcId: m.fdcId, kcal: m.kcal, protein: m.protein, fat: m.fat, carb: m.carb })),
  }));
  const recipeDupGroups = findDuplicateGroups(recipes).map(([key, members]) => ({
    key,
    members: members.map((m) => ({ id: m.id, name: m.name, source: m.source, kcal: Math.round(m.kcal) })),
  }));

  // ── category preview: what the classifier would assign ──
  const recategorizations = [];
  const fallbackAssignments = [];
  for (const f of foods) {
    const ov = overrides[f.name.trim().toLowerCase()];
    const rule = classifyFood(f.name);
    // Curated override categories are authoritative over the name classifier.
    const category = ov?.category || rule.category;
    const confidence = ov?.category ? "override" : rule.confidence;
    if (confidence === "fallback") fallbackAssignments.push({ name: f.name, current: f.category, proposed: category });
    if (category !== f.category) recategorizations.push({ name: f.name, current: f.category, proposed: category, confidence });
  }

  // ── recipes ──
  const recipeFailures = [];
  for (const r of recipes) {
    const { ok, issues, computed } = validateRecipe(r);
    if (!ok) recipeFailures.push({ id: r.id, name: r.name, source: r.source, stored: { kcal: Math.round(r.kcal), protein: Math.round(r.protein), fat: Math.round(r.fat), carb: Math.round(r.carb) }, computedKcal: Math.round(computed.kcal), issues });
  }

  // ── issue-code histogram ──
  const histogram = {};
  for (const f of foodFailures) for (const i of f.issues) histogram[i.code] = (histogram[i.code] || 0) + 1;

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      foods: foods.length,
      foodFailures: foodFailures.length,
      duplicateFoodGroups: dupGroups.length,
      recategorizations: recategorizations.length,
      categoryFallbacks: fallbackAssignments.length,
      recipes: recipes.length,
      recipeFailures: recipeFailures.length,
      duplicateRecipeGroups: recipeDupGroups.length,
    },
    issueHistogram: histogram,
    foodFailures,
    duplicateFoodGroups: dupGroups,
    duplicateRecipeGroups: recipeDupGroups,
    recategorizations,
    fallbackAssignments,
    recipeFailures,
  };

  const reportsDir = path.join(__dirname, "..", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const outPath = path.join(reportsDir, `food_audit_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("── FOOD DATA AUDIT ──");
  console.log(JSON.stringify(report.totals, null, 2));
  console.log("issue histogram:", JSON.stringify(histogram));
  console.log(`full report: ${outPath}`);

  // Non-zero exit when dirty, so this can gate CI/startup checks later.
  const dirty = foodFailures.length + dupGroups.length + recipeFailures.length + recipeDupGroups.length + recategorizations.length;
  process.exitCode = dirty > 0 ? 2 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
