// W1-5 F — claim H3: gluten guard covers flour/tortilla/cereal but not pasta/noodle.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(path.join(process.cwd(), "backend/src/lib/x.js"));
const { PrismaClient } = require("@prisma/client");
const { RECIPE_GATE_SELECT, FOOD_GATE_SELECT, explainRecipeExclusion, filterRecipes } = require("../../../backend/src/lib/exclusionGate.js");
const df = require("../../../backend/src/lib/dietaryFilter.js");
const prisma = new PrismaClient();

const main = async () => {
  const rows = await prisma.recipe.findMany({ select: { ...RECIPE_GATE_SELECT } });
  const celiac = { dietaryStyle: null, excludedFoods: ["gluten"] };

  // structural: is there a WORD_GUARD for pasta/noodle?
  const src = fs.readFileSync("backend/src/lib/dietaryFilter.js", "utf8");
  const guardBlock = src.slice(src.indexOf("const WORD_GUARDS"), src.indexOf("const WORD_GUARDS") + 8000);
  const guardKeys = [...guardBlock.matchAll(/^\s{2}"?([a-z' ]+)"?:\s*\(name\)/gm)].map((m) => m[1]);

  const glutenPastaRe = /\b(lentil|chickpea|red lentil|black bean|edamame|quinoa|brown rice|corn)\s+(pasta|noodles?|penne|spaghetti|fusilli)\b/i;
  const namedPasta = rows.filter((r) => glutenPastaRe.test(r.name || ""));
  const hpPasta = rows.filter((r) => /^high-protein\b/i.test(r.name || "") && /\bwith\b.*\b(lentil|chickpea)\s+pasta\b/i.test(r.name || ""));

  const excl = [];
  for (const r of rows) {
    const e = explainRecipeExclusion(r, celiac);
    if (e) excl.push({ id: r.id, name: r.name, reason: e.reason ?? e.term ?? JSON.stringify(e).slice(0, 200) });
  }
  const exclIds = new Set(excl.map((e) => e.id));
  const hpPastaExcluded = hpPasta.filter((r) => exclIds.has(r.id));
  const namedPastaExcluded = namedPasta.filter((r) => exclIds.has(r.id));

  // Which term did it fire on, for the high-protein pasta rows?
  const sample = hpPasta.slice(0, 6).map((r) => ({ name: r.name, explain: explainRecipeExclusion(r, celiac) }));

  // the underlying Food rows: are they GF pastas?
  const pastaFoods = await prisma.food.findMany({
    where: { OR: [{ name: { contains: "Lentil Pasta" } }, { name: { contains: "Chickpea Pasta" } }, { name: { contains: "lentil pasta" } }, { name: { contains: "chickpea pasta" } }] },
    select: FOOD_GATE_SELECT,
  });
  const foodVerdicts = pastaFoods.map((f) => ({ name: f.name, cat: f.fdcCategory, glutenMatch: df.foodMatchesExclusionTerm(f, "gluten"), pastaMatch: df.foodMatchesExclusionTerm(f, "pasta") }));

  // direct word-guard probe on synthetic names
  const probe = ["Lentil Pasta", "Chickpea Pasta", "Corn Tortilla", "Rice Flour", "Quinoa Flour", "Brown Rice Noodles", "Pasta, gluten-free, corn flour and quinoa flour"]
    .map((n) => ({ name: n, glutenHit: df.foodMatchesExclusionTerm({ name: n }, "gluten") }));

  // celiac pool sizes with/without those recipes
  const pool = filterRecipes(rows, celiac);
  const out = {
    library: rows.length,
    guardKeys,
    hasPastaGuard: guardKeys.includes("pasta"),
    hasNoodleGuard: guardKeys.includes("noodle") || guardKeys.includes("noodles"),
    hasFlourGuard: guardKeys.includes("flour"),
    hasTortillaGuard: guardKeys.includes("tortilla"),
    hasCerealGuard: guardKeys.includes("cereal"),
    celiacPool: pool.length,
    celiacExcluded: excl.length,
    gfPastaNamedRecipes: namedPasta.length,
    gfPastaNamedExcluded: namedPastaExcluded.length,
    highProteinLentilChickpeaPasta: hpPasta.length,
    highProteinLentilChickpeaPastaExcluded: hpPastaExcluded.length,
    sampleExplanations: sample,
    pastaFoodRows: foodVerdicts,
    syntheticProbe: probe,
    namedPastaRecipeNames: namedPasta.map((r) => r.name),
  };
  fs.writeFileSync("fleet/out/W1-5/h3-gluten.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, namedPastaRecipeNames: out.namedPastaRecipeNames.slice(0, 8) }, null, 1));
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
