// W1-5 E/H4 — the LAUNDERING channel: a wrong FDC record on a right name, and
// the allergen evidence it manufactures. Read-only.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/backend/src/lib/x.js");
const { PrismaClient } = require("@prisma/client");
const df = require("../../../backend/src/lib/dietaryFilter.js");
const { FDC_MACRO_CACHE } = await import("../../../backend/src/lib/portedFromRecomp/fdcMacroCache.mjs");
const prisma = new PrismaClient();

const STOPQ = /\b(raw|cooked|dry|dried|ground|whole|fresh|frozen|canned|prepared|nfs|unprepared|boiled|baked|roasted|without|with|added|includes|commercially|home|regular|low|reduced|light|salt|salted|unsalted|sr legacy|survey|foundation)\b/gi;
// FDC descriptions are "HEAD, qualifier, qualifier". The head noun is what the
// record IS. A row whose NAME is a qualifier of some other head noun is a
// wrong-record: "Cinnamon" pointing at "Bread, cinnamon" is a BREAD record.
const head = (s) => String(s || "").split(",")[0].toLowerCase().replace(STOPQ, " ").replace(/[^a-z0-9 ]+/g, " ").trim().replace(/\s+/g, " ");
const sing = (t) => (t.endsWith("ies") ? t.slice(0, -3) + "y" : t.endsWith("es") && t.length > 4 ? t.slice(0, -2) : t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t);
const headSet = (s) => new Set(head(s).split(" ").filter((t) => t.length > 2).map(sing));

const main = async () => {
  const foods = await prisma.food.findMany({ select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, fdcId: true, fdcCategory: true, source: true, dataQuality: true, allergenTags: true, mayContain: true } });
  const ris = await prisma.recipeIngredient.findMany({ select: { recipeId: true, foodId: true, baseGrams: true } });
  const recipes = await prisma.recipe.findMany({ select: { id: true, name: true } });
  const recById = new Map(recipes.map((r) => [r.id, r]));
  const useByFood = new Map();
  for (const ri of ris) { if (!useByFood.has(ri.foodId)) useByFood.set(ri.foodId, []); useByFood.get(ri.foodId).push(ri); }

  const findings = [];
  const seen = new Set();
  const consider = (f, desc, src) => {
    if (seen.has(f.id)) return;
    const a = headSet(f.name), b = headSet(desc);
    if (!a.size || !b.size) return;
    let overlap = 0; for (const t of a) if (b.has(t)) overlap++;
    if (overlap > 0) return; // head nouns agree -> not a mismatch
    seen.add(f.id);
    const uses = useByFood.get(f.id) || [];
    findings.push({
      id: f.id, name: f.name, fdcId: f.fdcId, fdcCategory: f.fdcCategory, source: f.source,
      recordDescription: desc, evidenceSource: src,
      nameHead: head(f.name), recordHead: head(desc),
      macros: { kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb },
      recipesTouched: new Set(uses.map((u) => u.recipeId)).size,
      recipeNames: [...new Set(uses.map((u) => recById.get(u.recipeId)?.name))].slice(0, 40),
    });
  };

  // evidence 1 — the description recorded in dataQuality
  for (const f of foods) {
    const m = /fdcId\s+(\d+)\s+"([^"]+)"/.exec(String(f.dataQuality || ""));
    if (m) consider(f, m[2], `dataQuality fdcId ${m[1]}`);
  }
  // evidence 2 — the offline FDC cache, joined on fdcId
  for (const f of foods) {
    if (f.fdcId == null) continue;
    const c = FDC_MACRO_CACHE[String(f.fdcId)];
    if (c && c.description) consider(f, c.description, `fdcMacroCache ${f.fdcId}`);
  }

  findings.sort((a, b) => b.recipesTouched - a.recipesTouched);

  // ── does the corrupt fdcCategory manufacture allergen evidence? ─────────
  const ALLERGENS = ["gluten", "dairy", "egg", "fish", "shellfish", "soy", "peanuts", "tree nuts", "sesame", "wheat"];
  for (const f of findings) {
    const row = foods.find((x) => x.id === f.id);
    const fires = [];
    for (const a of ALLERGENS) { try { if (df.foodMatchesExclusionTerm(row, a)) fires.push(a); } catch { } }
    // control: same row with the corrupt category stripped
    const clean = { ...row, fdcCategory: null };
    const firesClean = [];
    for (const a of ALLERGENS) { try { if (df.foodMatchesExclusionTerm(clean, a)) firesClean.push(a); } catch { } }
    f.allergenFires = fires;
    f.allergenFiresWithoutCategory = firesClean;
    f.manufacturedByCategory = fires.filter((a) => !firesClean.includes(a));
  }

  const manufactured = findings.filter((f) => f.manufacturedByCategory.length);
  const out = {
    dbSha: "d9037dce9754b4524943069fff7e0f3e396598c108426f370b0a189458b623a1",
    foodsScanned: foods.length,
    rowsWithRecordDescription: foods.filter((f) => /fdcId\s+\d+\s+"/.test(String(f.dataQuality || "")) || (f.fdcId != null && FDC_MACRO_CACHE[String(f.fdcId)]?.description)).length,
    headNounMismatches: findings.length,
    usedInRecipes: findings.filter((f) => f.recipesTouched > 0).length,
    recipesTouchedUnion: new Set(findings.flatMap((f) => (useByFood.get(f.id) || []).map((u) => u.recipeId))).size,
    manufacturingAllergenEvidence: manufactured.length,
    recipesUnderManufacturedEvidence: new Set(manufactured.flatMap((f) => (useByFood.get(f.id) || []).map((u) => u.recipeId))).size,
    findings,
  };
  fs.writeFileSync("fleet/out/W1-5/h4-laundering.json", JSON.stringify(out, null, 2));
  const { findings: _f, ...s } = out;
  console.log(JSON.stringify(s, null, 1));
  console.log("\n=== HEAD-NOUN MISMATCHES ===");
  for (const f of findings) {
    console.log(`${String(f.recipesTouched).padStart(3)} rec | ${f.name.slice(0, 34).padEnd(34)} -> fdcId ${String(f.fdcId ?? "-").padStart(8)} "${String(f.recordDescription).slice(0, 40).padEnd(40)}" | cat=${String(f.fdcCategory).slice(0, 22).padEnd(22)} | fires=[${f.allergenFires}] manufactured=[${f.manufacturedByCategory}]`);
  }
  await prisma.$disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
