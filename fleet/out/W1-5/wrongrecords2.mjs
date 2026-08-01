// W1-5 E — wrong-record scan v2. Three evidence channels, blast radius per hit.
// Read-only. BRAIN=off node fleet/out/W1-5/wrongrecords2.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/backend/src/lib/x.js");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ── channel C: physical implausibility (tightened; spice-protein DROPPED —
// real whole spices genuinely run 300-500 kcal / 7-18 g protein per 100 g, so
// that rule was pure false-positive. Alcohol rows are exempt from Atwater by
// the repo's own documented exception.) ────────────────────────────────────
const ALCOHOL = /\b(wine|sherry|brandy|rum|vodka|whisk|beer|liqueur|extract|essence|vermouth|marsala|port|cognac|kirsch|bourbon|gin|sake|mirin|bitters|vanilla)\b/i;
const RULES = [
  { id: "shellfish-carb", sev: "high",
    match: /\b(prawns?|shrimps?|crabs?|lobsters?|crayfish|langoustines?|scallops?|mussels?|clams?)\b/i,
    exclude: /\b(mushroom|oyster sauce|cocktail|salad|cake|breaded|batter|roll|paste|sauce|soup|chowder|dumpling|toast|bisque|curry|pie|scampi|tempura|spring|wonton|noodle|rice|chip|cracker|puff|snack|flavou?r|seasoning|imitation|surimi|stuffed|croquette|pasta|bread|pizza|sandwich|casserole|gumbo|jambalaya|paella|risotto|salad|dip|spread|egg|cheese|pancake|fritter|ball|burger|patty|stew|bake|au gratin|creole|newburg|thermidor)\b/i,
    test: (f) => f.carb > 8, why: "crustacean/mollusc flesh has ~0 g carbohydrate" },
  { id: "finfish-carb", sev: "high",
    match: /^(?:fish|salmon|cod|tuna|haddock|mackerel|sardines?|trout|halibut|snapper|tilapia|pollock|anchov)\b/i,
    exclude: /\b(cake|breaded|batter|pie|paste|sauce|stick|finger|chowder|soup|salad|roll|sandwich|nugget|croquette|pate|spread|dip|casserole|curry|imitation|surimi|flavou?r|seasoning|oil|loaf|ball|bake|gefilte|pudding|mousse|dumpling|pasta|noodle|rice|chip|cracker|snack|bread|pizza|burger|patty|stew|creole|jerky|roe|caviar)\b/i,
    test: (f) => f.carb > 8, why: "finfish flesh has ~0 g carbohydrate" },
  { id: "stock-broth-kcal", sev: "med",
    match: /\b(stock|broth|bouillon|consomm[eé])\b/i,
    exclude: /\b(cubes?|powder|granules?|paste|concentrate|dry|dried|base|pot|gel|mix|seasoning)\b/i,
    test: (f) => f.kcal > 60, why: "ready-to-use liquid stock is 4-20 kcal/100 g; >60 is a cube/paste or a meat record on a liquid row" },
  { id: "plain-veg-fat", sev: "high",
    match: /^(?:carrots?|broccoli|spinach|cabbages?|lettuce|celery|cucumbers?|tomato(?:es)?|onions?|courgettes?|zucchini|aubergines?|egg ?plants?|cauliflowers?|kale|leeks?|turnips?|swede|beetroots?|radish(?:es)?|apples?|oranges?|bananas?|pears?|grapes?|strawberr|melons?|peach(?:es)?|plums?|green beans?|peas)\b/i,
    exclude: /\b(oil|fried|crisp|chips?|butter|creamed?|dressing|salad|gratin|tempura|batter|pie|cake|puffs?|seeds?|dried|juice|paste|snack|bread|sauce|cheese|bacon|casserole|fritter|pakora|bhaji|coconut|nut|almond|pesto|dip|hummus|curry|stuffed|scallop|soup|croquette|tart|muffin|loaf|pudding|smoothie|shake|milk|yogh?urt)\b/i,
    test: (f) => f.fat > 12, why: "plain vegetables/fruit carry <12 g fat per 100 g" },
  { id: "lean-cut-fat", sev: "high",
    match: /\b(chicken breast|turkey breast|egg whites?)\b/i,
    exclude: /\b(oil|fried|breaded|batter|skin|butter|cream|sauce|pie|nugget|pastry|mayo|salad|kiev|cordon|parmesan|casserole|pot pie|roll|wrap|sandwich|burger|patty|stuffed|tender|strip|nugget)\b/i,
    test: (f) => f.fat > 20, why: "these cuts are <20 g fat in every cooked form" },
  { id: "impossible-mass", sev: "high",
    match: /.*/, exclude: null,
    test: (f) => (f.protein + f.fat + f.carb) > 100.5 || f.protein < 0 || f.fat < 0 || f.carb < 0 || f.kcal > 950,
    why: "macro grams exceed 100 g per 100 g, or kcal exceeds the pure-fat ceiling" },
  { id: "atwater-break", sev: "med",
    match: /.*/, exclude: ALCOHOL,
    test: (f) => {
      const net = Math.max(0, f.carb - (f.fiber || 0));
      const at = 4 * f.protein + 4 * net + 9 * f.fat + 2 * (f.fiber || 0);
      if (f.kcal <= 0) return at > 60;
      return Math.abs(at - f.kcal) / f.kcal > 0.45 && Math.abs(at - f.kcal) > 80;
    },
    why: "stated kcal disagrees with fiber-adjusted Atwater by >45% and >80 kcal (non-alcohol row)" },
];

// ── channel B: the LAUNDERING channel (claim H4). Parse `fdcId N "DESC"` out of
// dataQuality and ask whether DESC denotes the row's own name. A row whose
// provenance string names a DIFFERENT food is a wrong record wearing a
// "pass" badge — and its fdcCategory then feeds the allergen gate. ─────────
const STOP = new Set(["and", "or", "with", "the", "of", "in", "raw", "cooked", "fresh", "dried", "ground", "whole", "plain", "unsweetened", "sweetened", "canned", "frozen", "prepared", "nfs", "powder", "stick", "sticks", "seed", "seeds", "leaf", "leaves", "extract", "sauce", "oil", "juice", "flour", "mix", "style", "type", "all", "purpose", "low", "fat", "free", "reduced", "light", "large", "small", "medium", "boiled", "baked", "roasted", "grilled", "fried", "steamed"]);
const tokens = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
const singular = (t) => (t.endsWith("ies") ? t.slice(0, -3) + "y" : t.endsWith("es") && t.length > 4 ? t.slice(0, -2) : t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t);

const main = async () => {
  const foods = await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, fdcId: true, fdcCategory: true, source: true, dataQuality: true, dataQualityFlag: true } });
  const ris = await prisma.recipeIngredient.findMany({ select: { recipeId: true, foodId: true, baseGrams: true } });
  const recipes = await prisma.recipe.findMany({ select: { id: true, name: true, kcal: true, protein: true, slotType: true, mealCategory: true } });
  const recById = new Map(recipes.map((r) => [r.id, r]));
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const useByFood = new Map();
  for (const ri of ris) { if (!useByFood.has(ri.foodId)) useByFood.set(ri.foodId, []); useByFood.get(ri.foodId).push(ri); }
  const recProt = new Map(), recKcal = new Map();
  for (const ri of ris) { const f = foodById.get(ri.foodId); if (!f) continue;
    recProt.set(ri.recipeId, (recProt.get(ri.recipeId) || 0) + (f.protein * ri.baseGrams) / 100);
    recKcal.set(ri.recipeId, (recKcal.get(ri.recipeId) || 0) + (f.kcal * ri.baseGrams) / 100); }

  const hits = new Map();
  const add = (f, ch, id, why, sev) => {
    if (!hits.has(f.id)) hits.set(f.id, { food: f, ev: [] });
    hits.get(f.id).ev.push({ channel: ch, rule: id, why, sev });
  };

  // channel A — the DB's own declaration
  for (const f of foods) {
    if (f.source === "quarantined") add(f, "A-selfdeclared", "quarantined", String(f.dataQuality || "").slice(0, 220), "high");
  }

  // channel B — provenance/name mismatch on rows NOT quarantined
  let parsed = 0;
  for (const f of foods) {
    if (f.source === "quarantined") continue;
    const m = /fdcId\s+(\d+)\s+"([^"]+)"/.exec(String(f.dataQuality || ""));
    if (!m) continue;
    parsed++;
    const desc = m[2];
    // the row was already re-derived / repaired => trust the final clause only
    const nameT = new Set(tokens(f.name).map(singular));
    const descT = new Set(tokens(desc).map(singular));
    if (!nameT.size) continue;
    let overlap = 0; for (const t of nameT) if (descT.has(t)) overlap++;
    if (overlap === 0) {
      add(f, "B-laundered-provenance", "fdc-desc-mismatch",
        `name "${f.name}" shares no head noun with its own fdcId ${m[1]} "${desc}"; fdcCategory="${f.fdcCategory}" is therefore the WRONG food's category and feeds the allergen gate`, "high");
    }
  }

  // channel C — physical implausibility
  for (const f of foods) for (const r of RULES) {
    if (!r.match.test(f.name)) continue;
    if (r.exclude && r.exclude.test(f.name)) continue;
    let bad = false; try { bad = r.test(f); } catch { }
    if (bad) add(f, "C-implausible", r.id, r.why, r.sev);
  }

  const scored = [];
  for (const { food, ev } of hits.values()) {
    const uses = useByFood.get(food.id) || [];
    let domP = 0, domK = 0; const touched = [];
    for (const u of uses) {
      const rp = recProt.get(u.recipeId) || 0, rk = recKcal.get(u.recipeId) || 0;
      const sp = rp > 0 ? ((food.protein * u.baseGrams) / 100) / rp : 0;
      const sk = rk > 0 ? ((food.kcal * u.baseGrams) / 100) / rk : 0;
      if (sp > 0.25) domP++; if (sk > 0.25) domK++;
      touched.push({ recipeId: u.recipeId, recipe: recById.get(u.recipeId)?.name, grams: u.baseGrams, proteinShare: +sp.toFixed(3), kcalShare: +sk.toFixed(3) });
    }
    scored.push({
      id: food.id, name: food.name, fdcId: food.fdcId, fdcCategory: food.fdcCategory, source: food.source,
      dataQualityFlag: food.dataQualityFlag, dataQuality: String(food.dataQuality || "").slice(0, 300),
      macros: { kcal: +food.kcal.toFixed(2), protein: +food.protein.toFixed(2), fat: +food.fat.toFixed(2), carb: +food.carb.toFixed(2), fiber: food.fiber },
      channels: [...new Set(ev.map((e) => e.channel))], rules: [...new Set(ev.map((e) => e.rule))],
      severity: ev.some((e) => e.sev === "high") ? "high" : "med",
      evidence: ev,
      recipesTouched: new Set(uses.map((u) => u.recipeId)).size,
      recipesWhereDominantProtein: domP, recipesWhereDominantKcal: domK,
      touched: touched.sort((a, b) => b.kcalShare - a.kcalShare),
    });
  }
  scored.sort((a, b) => b.recipesTouched - a.recipesTouched || (a.severity === "high" ? -1 : 1));

  const byChan = (c) => scored.filter((s) => s.channels.includes(c));
  const unionRecipes = (set) => new Set(set.flatMap((s) => s.touched.map((t) => t.recipeId))).size;
  const summary = {
    dbSha: "d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1",
    foodsScanned: foods.length, recipeIngredientRows: ris.length, recipes: recipes.length,
    provenanceStringsParsed: parsed,
    totalHits: scored.length, high: scored.filter((s) => s.severity === "high").length,
    usedInAnyRecipe: scored.filter((s) => s.recipesTouched > 0).length,
    recipesTouchedUnion: unionRecipes(scored),
    recipesDominantProtein25: scored.reduce((a, s) => a + s.recipesWhereDominantProtein, 0),
    recipesDominantKcal25: scored.reduce((a, s) => a + s.recipesWhereDominantKcal, 0),
    channels: {
      "A-selfdeclared": { rows: byChan("A-selfdeclared").length, used: byChan("A-selfdeclared").filter((s) => s.recipesTouched > 0).length, recipes: unionRecipes(byChan("A-selfdeclared")), dominantProtein: byChan("A-selfdeclared").reduce((a, s) => a + s.recipesWhereDominantProtein, 0) },
      "B-laundered-provenance": { rows: byChan("B-laundered-provenance").length, used: byChan("B-laundered-provenance").filter((s) => s.recipesTouched > 0).length, recipes: unionRecipes(byChan("B-laundered-provenance")), dominantProtein: byChan("B-laundered-provenance").reduce((a, s) => a + s.recipesWhereDominantProtein, 0) },
      "C-implausible": { rows: byChan("C-implausible").length, used: byChan("C-implausible").filter((s) => s.recipesTouched > 0).length, recipes: unionRecipes(byChan("C-implausible")), dominantProtein: byChan("C-implausible").reduce((a, s) => a + s.recipesWhereDominantProtein, 0) },
    },
    byRule: scored.flatMap((s) => s.rules).reduce((m, r) => { m[r] = (m[r] || 0) + 1; return m; }, {}),
  };
  fs.writeFileSync("fleet/out/W1-5/wrong-records.json", JSON.stringify({ ...summary, hits: scored }, null, 2));
  console.log(JSON.stringify(summary, null, 1));
  console.log("\n=== USED HITS, BY BLAST RADIUS (recipesTouched > 0) ===");
  for (const s of scored.filter((x) => x.recipesTouched > 0).slice(0, 45)) {
    console.log(`${String(s.recipesTouched).padStart(3)} | ${s.severity.padEnd(4)} | ${s.channels.join("+").padEnd(24)} | ${s.name.slice(0, 40).padEnd(40)} | ${String(Math.round(s.macros.kcal)).padStart(5)}kcal P${String(s.macros.protein.toFixed(1)).padStart(5)} F${String(s.macros.fat.toFixed(1)).padStart(5)} C${String(s.macros.carb.toFixed(1)).padStart(5)} | domP=${s.recipesWhereDominantProtein}`);
  }
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
