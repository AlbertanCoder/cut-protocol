// W1-5 E — wrong-record scan: name-class vs macro-vector mismatch, DB + seed files.
// Read-only. BRAIN=off node fleet/out/W1-5/wrongrecords.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/backend/src/lib/x.js");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ── name classes with expected macro envelopes (per 100 g, as-stored) ──────
// Each rule: match the NAME, assert a property the macro vector must satisfy.
// Envelopes are deliberately generous — a hit means "no plausible form of this
// food looks like this", not "unusual".
const RULES = [
  { id: "shellfish-carb", cls: "crustacean/mollusc",
    match: /\b(prawns?|shrimps?|crab|lobster|crayfish|langoustine)\b/i,
    exclude: /\b(cocktail|salad|cake|breaded|batter|roll|paste|sauce|soup|chowder|dumpling|toast|bisque|curry|pie|scampi|tempura|spring|wonton|noodle|rice|chip|cracker|puff|snack|flavor|flavour|seasoning|imitation|surimi|stuffed|croquette)\b/i,
    test: (f) => f.carb > 8, why: "crustacean flesh has ~0 g carbohydrate", sev: "high" },
  { id: "finfish-carb", cls: "finfish",
    match: /^(?:fish|salmon|cod|tuna|haddock|mackerel|sardines?|trout|halibut|bass|snapper|tilapia|pollock)\b/i,
    exclude: /\b(cake|breaded|batter|pie|paste|sauce|stick|finger|chowder|soup|salad|roll|sandwich|nugget|croquette|pate|spread|dip|casserole|curry|imitation|surimi|flavou?r|seasoning|oil)\b/i,
    test: (f) => f.carb > 8, why: "finfish flesh has ~0 g carbohydrate", sev: "high" },
  { id: "spice-protein", cls: "spice/herb",
    match: /\b(anise|cinnamon|clove|nutmeg|cardamom|turmeric|saffron|paprika|oregano|thyme|rosemary|basil|bay leaf|coriander seed|cumin|fennel seed|mace|allspice|peppercorn|star anise|vanilla bean)\b/i,
    exclude: /\b(oil|extract|bread|cake|roll|bun|cookie|biscuit|latte|drink|tea|sauce|chicken|beef|pork|rice|soup|blend|mix|seasoned|rub|paste|butter)\b/i,
    test: (f) => f.protein > 12 || f.kcal > 300, why: "whole spices deliver <12 g protein and are used in gram quantities; >300 kcal/100 g here is a wrong-record signature", sev: "med" },
  { id: "stock-broth-kcal", cls: "stock/broth",
    match: /\b(stock|broth|bouillon|consomm[eé])\b/i,
    exclude: /\b(cube|powder|granule|paste|concentrate|dry|dried|base|pot|gel|bouillon cube)\b/i,
    test: (f) => f.kcal > 60, why: "liquid stock is 4-20 kcal/100 g; >60 indicates a cube/paste record on a liquid row", sev: "med" },
  { id: "veg-fat", cls: "vegetable/fruit",
    match: /^(?:carrots?|broccoli|spinach|cabbage|lettuce|celery|cucumber|tomato(?:es)?|onions?|peppers?|courgette|zucchini|aubergine|egg ?plants?|cauliflower|kale|leek|turnip|swede|beetroot|radish|apples?|oranges?|bananas?|pears?|grapes?|berries|strawberr|melon|peach|plum)/i,
    exclude: /\b(oil|fried|crisp|chip|roasted in|butter|cream|dressing|salad|au gratin|tempura|batter|pie|cake|puff|seed|dried|juice concentrate|paste|snack|bread)\b/i,
    test: (f) => f.fat > 12, why: "raw/plain vegetables and fruit carry <12 g fat", sev: "high" },
  { id: "lean-meat-fat", cls: "lean poultry/lean cut",
    match: /\b(chicken breast|turkey breast|cod|haddock|white fish|egg white)\b/i,
    exclude: /\b(oil|fried|breaded|batter|skin|butter|cream|sauce|pie|nugget|pastry|mayo|salad)\b/i,
    test: (f) => f.fat > 20, why: "these cuts are <20 g fat in every cooked form", sev: "high" },
  { id: "water-zero", cls: "water/plain beverage",
    match: /^(?:water|black coffee|tea, brewed|club soda|sparkling water|mineral water)\b/i,
    exclude: /\b(sweetened|flavou?red|milk|sugar|coconut|tonic|energy)\b/i,
    test: (f) => f.kcal > 5, why: "plain water/coffee is ~0 kcal", sev: "high" },
  { id: "atwater-break", cls: "any",
    match: /.*/, exclude: null,
    test: (f) => {
      const at = 4 * f.protein + 4 * Math.max(0, f.carb - (f.fiber || 0)) + 9 * f.fat + 2 * (f.fiber || 0);
      if (f.kcal <= 0 && at > 40) return true;
      if (f.kcal <= 0) return false;
      return Math.abs(at - f.kcal) / f.kcal > 0.40 && Math.abs(at - f.kcal) > 60;
    },
    why: "stated kcal is >40% and >60 kcal away from fiber-adjusted Atwater — the row's own numbers disagree", sev: "med" },
  { id: "impossible-mass", cls: "any",
    match: /.*/, exclude: null,
    test: (f) => (f.protein + f.fat + f.carb) > 100.5 || f.protein < 0 || f.fat < 0 || f.carb < 0 || f.kcal > 950,
    why: "macro grams exceed 100 g per 100 g, or kcal exceeds the pure-fat ceiling (900)", sev: "high" },
];

const FDC_CLASS_MISMATCH = [
  // name token -> forbidden fdcCategory substrings (the laundering channel, claim H4)
  { token: /\b(cinnamon|nutmeg|clove|allspice|cardamom|turmeric|paprika|cumin|coriander|oregano|thyme|basil|rosemary|bay leaf|anise|saffron|mace|ginger, ground)\b/i,
    forbid: /baked products|bakery|breakfast cereals|snacks|sweets|beverages|dairy|poultry|beef|pork|sausages|fast foods|restaurant/i,
    label: "spice row filed under a composite-food FDC category" },
  { token: /\b(prawns?|shrimps?|crab|lobster|scallops?|mussels?|clams?|oysters?)\b/i,
    forbid: /baked products|cereal grains|legumes|vegetables|fruits|sweets|fats and oils/i,
    label: "shellfish row filed under a non-animal FDC category" },
];

const main = async () => {
  const foods = await prisma.food.findMany({
    select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, fdcId: true, fdcCategory: true, source: true, dataQuality: true, dataQualityFlag: true, category: true },
  });
  const ris = await prisma.recipeIngredient.findMany({ select: { recipeId: true, foodId: true, baseGrams: true } });
  const recipes = await prisma.recipe.findMany({ select: { id: true, name: true, kcal: true, protein: true, slotType: true, mealCategory: true } });
  const recById = new Map(recipes.map((r) => [r.id, r]));
  const foodById = new Map(foods.map((f) => [f.id, f]));

  // usage index
  const useByFood = new Map();
  for (const ri of ris) {
    if (!useByFood.has(ri.foodId)) useByFood.set(ri.foodId, []);
    useByFood.get(ri.foodId).push(ri);
  }
  // per-recipe protein & kcal contribution
  const recProt = new Map(), recKcal = new Map();
  for (const ri of ris) {
    const f = foodById.get(ri.foodId); if (!f) continue;
    recProt.set(ri.recipeId, (recProt.get(ri.recipeId) || 0) + (f.protein * ri.baseGrams) / 100);
    recKcal.set(ri.recipeId, (recKcal.get(ri.recipeId) || 0) + (f.kcal * ri.baseGrams) / 100);
  }

  const hits = new Map(); // foodId -> {food, rules:[]}
  for (const f of foods) {
    for (const r of RULES) {
      if (!r.match.test(f.name)) continue;
      if (r.exclude && r.exclude.test(f.name)) continue;
      let bad = false;
      try { bad = r.test(f); } catch { bad = false; }
      if (!bad) continue;
      if (!hits.has(f.id)) hits.set(f.id, { food: f, rules: [] });
      hits.get(f.id).rules.push({ id: r.id, cls: r.cls, why: r.why, sev: r.sev });
    }
    for (const m of FDC_CLASS_MISMATCH) {
      if (!m.token.test(f.name)) continue;
      if (!f.fdcCategory || !m.forbid.test(f.fdcCategory)) continue;
      if (!hits.has(f.id)) hits.set(f.id, { food: f, rules: [] });
      hits.get(f.id).rules.push({ id: "fdc-class-mismatch", cls: "provenance", why: `${m.label}: fdcCategory="${f.fdcCategory}"`, sev: "high" });
    }
  }

  // ── score + blast radius ────────────────────────────────────────────────
  const scored = [];
  for (const { food, rules } of hits.values()) {
    const uses = useByFood.get(food.id) || [];
    const recIds = [...new Set(uses.map((u) => u.recipeId))];
    let dominantProtein = 0, dominantKcal = 0;
    const touched = [];
    for (const u of uses) {
      const rp = recProt.get(u.recipeId) || 0, rk = recKcal.get(u.recipeId) || 0;
      const sp = rp > 0 ? ((food.protein * u.baseGrams) / 100) / rp : 0;
      const sk = rk > 0 ? ((food.kcal * u.baseGrams) / 100) / rk : 0;
      if (sp > 0.25) dominantProtein++;
      if (sk > 0.25) dominantKcal++;
      touched.push({ recipeId: u.recipeId, recipe: recById.get(u.recipeId)?.name, grams: u.baseGrams, proteinShare: +sp.toFixed(3), kcalShare: +sk.toFixed(3) });
    }
    const sev = rules.some((r) => r.sev === "high") ? "high" : "med";
    scored.push({
      id: food.id, name: food.name, fdcId: food.fdcId, fdcCategory: food.fdcCategory,
      source: food.source, dataQuality: food.dataQuality, dataQualityFlag: food.dataQualityFlag,
      macros: { kcal: food.kcal, protein: food.protein, fat: food.fat, carb: food.carb, fiber: food.fiber },
      rules: rules.map((r) => r.id), reasons: rules.map((r) => r.why), severity: sev,
      recipesTouched: recIds.length, recipesWhereDominantProtein: dominantProtein, recipesWhereDominantKcal: dominantKcal,
      touched: touched.sort((a, b) => b.kcalShare - a.kcalShare).slice(0, 12),
    });
  }
  scored.sort((a, b) => (b.recipesTouched - a.recipesTouched) || (b.severity === "high" ? 1 : -1));

  // ── named suspects, explicitly ──────────────────────────────────────────
  const findAll = (re) => foods.filter((f) => re.test(f.name));
  const named = {};
  for (const [k, re] of Object.entries({
    tigerPrawns: /tiger prawn/i, starAnise: /star anise/i, lambStock: /lamb stock/i, cinnamon: /^cinnamon$|^cinnamon,/i,
  })) {
    named[k] = findAll(re).map((f) => ({
      id: f.id, name: f.name, fdcId: f.fdcId, fdcCategory: f.fdcCategory, kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb,
      source: f.source, dataQuality: f.dataQuality,
      recipesTouched: (useByFood.get(f.id) || []).length,
      topRecipes: (useByFood.get(f.id) || []).map((u) => ({ r: recById.get(u.recipeId)?.name, g: u.baseGrams,
        kcalShare: +(((f.kcal * u.baseGrams) / 100) / (recKcal.get(u.recipeId) || 1)).toFixed(3) })).sort((a, b) => b.kcalShare - a.kcalShare).slice(0, 6),
    }));
  }

  // ── seed-file scan ──────────────────────────────────────────────────────
  const seedDir = "backend/src/lib/portedFromRecomp";
  const seedFiles = fs.existsSync(seedDir) ? fs.readdirSync(seedDir) : [];
  const seedFindings = [];
  for (const fn of seedFiles) {
    const p = `${seedDir}/${fn}`;
    const txt = fs.readFileSync(p, "utf8");
    for (const [k, re] of Object.entries({ tigerPrawns: /tiger prawn/i, starAnise: /star anise/i, lambStock: /lamb stock/i, cinnamon: /cinnamon/i })) {
      const lines = txt.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => re.test(l));
      if (lines.length) seedFindings.push({ file: fn, key: k, hits: lines.length, sample: lines.slice(0, 3).map(([n, l]) => `${n}: ${l.trim().slice(0, 200)}`) });
    }
  }

  // ── inertness: % of food library reachable by the solver (F12 tail) ─────
  const usedFoodIds = new Set(ris.map((r) => r.foodId));
  const ADJ = ["Olive Oil", "Butter", "Avocado", "White rice, cooked", "Potatoes", "Oats", "Chicken breast, cooked, skinless", "Greek Yogurt", "Tofu", "Lentils"];
  const adjIds = new Set(foods.filter((f) => ADJ.includes(f.name)).map((f) => f.id));
  const reachable = new Set([...usedFoodIds, ...adjIds]);
  const inert = {
    foods: foods.length, referencedByAnyRecipe: usedFoodIds.size, adjusterRows: adjIds.size,
    reachable: reachable.size, inert: foods.length - reachable.size,
    inertPct: +(((foods.length - reachable.size) / foods.length) * 100).toFixed(2),
  };

  const out = {
    dbSha: "d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1",
    foodsScanned: foods.length, recipeIngredientRows: ris.length,
    confirmedHits: scored.length,
    high: scored.filter((s) => s.severity === "high").length,
    used: scored.filter((s) => s.recipesTouched > 0).length,
    recipesTouchedUnion: new Set(scored.flatMap((s) => s.touched.map((t) => t.recipeId))).size,
    recipesDominantProtein: scored.reduce((a, s) => a + s.recipesWhereDominantProtein, 0),
    byRule: scored.flatMap((s) => s.rules).reduce((m, r) => { m[r] = (m[r] || 0) + 1; return m; }, {}),
    named, seedFindings, inert,
    hits: scored,
  };
  // full recipe-union, not just top-12 slice
  const unionAll = new Set();
  for (const { food } of hits.values()) for (const u of (useByFood.get(food.id) || [])) unionAll.add(u.recipeId);
  out.recipesTouchedUnion = unionAll.size;

  fs.writeFileSync("fleet/out/W1-5/wrong-records.json", JSON.stringify(out, null, 2));
  const { hits: _h, ...summary } = out;
  console.log(JSON.stringify(summary, null, 1));
  console.log("\n=== TOP 30 BY BLAST RADIUS ===");
  for (const s of scored.slice(0, 30)) {
    console.log(`${String(s.recipesTouched).padStart(3)} rec | ${s.severity.padEnd(4)} | ${s.name.slice(0, 46).padEnd(46)} | kcal ${String(Math.round(s.macros.kcal)).padStart(5)} P${String(s.macros.protein.toFixed(1)).padStart(6)} F${String(s.macros.fat.toFixed(1)).padStart(6)} C${String(s.macros.carb.toFixed(1)).padStart(6)} | ${s.rules.join(",")}`);
  }
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
