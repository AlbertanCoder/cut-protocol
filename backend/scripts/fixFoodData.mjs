// Phase 2 fix pipeline. DRY-RUN by default — prints every planned change.
//   node scripts/fixFoodData.mjs            (dry run)
//   node scripts/fixFoodData.mjs --apply    (backs up dev.db, then writes)
//
// Order of operations matters:
//   1. curated overrides (backend/data/foodOverrides.json) — wrong-record
//      matches get correct values; exemption-only entries change nothing
//   2. clamp negative macros to 0
//   3. kcal=0 rows with real macros → kcal from fiber-adjusted Atwater
//      (USDA Foundation records that ship no energy nutrient)
//   4. placeholder promotion: manual-placeholder rows whose macros now pass
//      validation become "manual" (they were user-entered label data)
//   5. recategorize every food to the grocery-store scheme
//   6. merge duplicate foods (case/plural/synonym), re-point recipe
//      ingredients to the winner, delete the losers
//   7. recompute every recipe's cached per-serving macros from ingredients
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prismaPkg from "../src/lib/prisma.js";
import validationPkg from "../src/lib/foodValidation.js";
import categoriesPkg from "../src/lib/foodCategories.js";

const { prisma } = prismaPkg;
const { validateFood, atwater, nameKey, findDuplicateGroups, computeRecipeMacros } = validationPkg;
const { CATEGORY_SLUGS, classifyFood } = categoriesPkg;

const APPLY = process.argv.includes("--apply");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Extra dupe folds beyond case/plural: alternate names for the same food.
const SYNONYM_KEY_MAP = {
  "cashew nut": "cashew",
  "allspice berry": "allspice",
};
const foldKey = (name) => {
  const k = nameKey(name);
  return SYNONYM_KEY_MAP[k] || k;
};

function loadOverrides() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "foodOverrides.json"), "utf8"));
  const byKey = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (name.startsWith("__")) continue;
    byKey[name.trim().toLowerCase()] = entry;
  }
  return byKey;
}

const r1 = (n) => Math.round(n * 10) / 10;

async function main() {
  const overrides = loadOverrides();
  const foods = await prisma.food.findMany();
  const ingCounts = new Map(
    (await prisma.recipeIngredient.groupBy({ by: ["foodId"], _count: { foodId: true } }))
      .map((g) => [g.foodId, g._count.foodId])
  );

  const changes = { values: [], categories: [], promotions: [], merges: [], recipes: 0 };

  // ── 1-4: per-food value plan ──
  const planned = new Map(); // id -> planned row state
  for (const f of foods) {
    const p = { ...f };
    const ov = overrides[f.name.trim().toLowerCase()];

    if (ov && typeof ov.kcal === "number") {
      Object.assign(p, {
        kcal: ov.kcal, protein: ov.protein, fat: ov.fat, carb: ov.carb, fiber: ov.fiber ?? 0,
        fdcId: ov.fdcId ?? null,
        source: ov.fdcId ? "usda" : "manual",
      });
      changes.values.push({ name: f.name, why: "override", from: `${Math.round(f.kcal)}kcal ${f.protein}P/${f.fat}F/${f.carb}C`, to: `${Math.round(p.kcal)}kcal ${p.protein}P/${p.fat}F/${p.carb}C` });
    } else {
      let touched = false;
      for (const k of ["kcal", "protein", "fat", "carb", "fiber"]) {
        if (p[k] < 0) { p[k] = 0; touched = true; }
      }
      if (p.kcal === 0 && p.protein + p.fat + p.carb >= 3) {
        p.kcal = Math.round(atwater(p).fiberAdjusted);
        touched = true;
      }
      if (touched) {
        changes.values.push({ name: f.name, why: "computed", from: `${Math.round(f.kcal)}kcal ${f.protein}P/${f.fat}F/${f.carb}C`, to: `${Math.round(p.kcal)}kcal ${p.protein}P/${p.fat}F/${p.carb}C` });
      }
    }

    if (p.source === "manual-placeholder") {
      const check = validateFood({ ...p, source: "manual" }, { exemptions: overrides, validCategories: null });
      if (check.ok || check.issues.every((i) => i.code === "category")) {
        p.source = "manual";
        changes.promotions.push(f.name);
      }
    }

    const targetCategory = (ov && ov.category) || classifyFood(f.name).category;
    if (targetCategory !== p.category) {
      changes.categories.push({ name: f.name, from: p.category, to: targetCategory });
      p.category = targetCategory;
    }

    planned.set(f.id, p);
  }

  // ── 6: duplicate merge plan (on planned states) ──
  const groups = findDuplicateGroups([...planned.values()].map((p) => ({ ...p, name: p.name })));
  // findDuplicateGroups uses nameKey; re-group with synonym folding on top.
  const byFold = new Map();
  for (const p of planned.values()) {
    const key = foldKey(p.name);
    if (!byFold.has(key)) byFold.set(key, []);
    byFold.get(key).push(p);
  }
  const mergeGroups = [...byFold.values()].filter((m) => m.length > 1);

  const caps = (s) => (s.match(/[A-Z]/g) || []).length;
  const score = (p) => {
    const v = validateFood(p, { exemptions: overrides, validCategories: CATEGORY_SLUGS });
    return (
      (v.ok ? 8 : 0) +
      (p.source === "usda" && p.fdcId ? 4 : 0) +
      (p.source !== "manual-placeholder" ? 2 : 0) +
      Math.min(1, (ingCounts.get(p.id) || 0) / 100)
    );
  };
  const mergePlan = [];
  for (const members of mergeGroups) {
    const sorted = [...members].sort((a, b) => {
      const d = score(b) - score(a);
      if (d !== 0) return d;
      const c = caps(b.name) - caps(a.name);
      if (c !== 0) return c;
      return a.name.length - b.name.length || (a.createdAt < b.createdAt ? -1 : 1);
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);
    mergePlan.push({ winner, losers });
    changes.merges.push({ keep: winner.name, drop: losers.map((l) => `${l.name} (${ingCounts.get(l.id) || 0} refs)`) });
  }

  // ── report the plan ──
  console.log(`VALUE FIXES: ${changes.values.length}`);
  for (const c of changes.values) console.log(`  [${c.why}] ${c.name}: ${c.from} → ${c.to}`);
  console.log(`PLACEHOLDER PROMOTIONS: ${changes.promotions.length} (${changes.promotions.join(", ")})`);
  console.log(`CATEGORY CHANGES: ${changes.categories.length}`);
  console.log(`MERGES: ${changes.merges.length}`);
  for (const m of changes.merges) console.log(`  keep "${m.keep}"  ← ${m.drop.join(", ")}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to execute.");
    return;
  }

  // ── backup, then write ──
  const dbPath = path.join(__dirname, "..", "prisma", "dev.db");
  const backupPath = dbPath + ".backup-phase2-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  fs.copyFileSync(dbPath, backupPath);
  console.log(`\nbacked up dev.db → ${path.basename(backupPath)}`);

  for (const p of planned.values()) {
    await prisma.food.update({
      where: { id: p.id },
      data: { kcal: p.kcal, protein: p.protein, fat: p.fat, carb: p.carb, fiber: p.fiber, category: p.category, source: p.source, fdcId: p.fdcId },
    });
  }
  console.log(`wrote ${planned.size} food rows`);

  for (const { winner, losers } of mergePlan) {
    const loserIds = losers.map((l) => l.id);
    await prisma.$transaction([
      prisma.recipeIngredient.updateMany({ where: { foodId: { in: loserIds } }, data: { foodId: winner.id } }),
      prisma.food.deleteMany({ where: { id: { in: loserIds } } }),
    ]);
  }
  console.log(`merged ${mergePlan.length} duplicate groups`);

  // ── 7: recompute recipe cached macros ──
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });
  for (const r of recipes) {
    const t = computeRecipeMacros(r.ingredients);
    if (Math.abs(t.kcal - r.kcal) > 0.5 || Math.abs(t.protein - r.protein) > 0.2 || Math.abs(t.fat - r.fat) > 0.2 || Math.abs(t.carb - r.carb) > 0.2) {
      await prisma.recipe.update({
        where: { id: r.id },
        data: { kcal: r1(t.kcal), protein: r1(t.protein), fat: r1(t.fat), carb: r1(t.carb) },
      });
      changes.recipes++;
    }
  }
  console.log(`recomputed macros on ${changes.recipes} recipes`);

  const logPath = path.join(__dirname, "..", "reports", `fix_log_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(changes, null, 2));
  console.log(`change log: ${logPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
