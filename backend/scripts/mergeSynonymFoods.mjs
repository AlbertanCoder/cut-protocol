#!/usr/bin/env node
// Merge synonym Food rows that share one FDC id, so `fdcId` can take a UNIQUE
// constraint. Dry-run by default; pass --apply to write.
//
// WHY: after the provenance repair, 23 fdcId groups still held 2 rows each. All
// 23 are legitimate duplication, not corruption — the app's curated display name
// and USDA's description as two rows on one record with identical macros
// ("Garlic" + "Garlic, raw"; "Ground Pork" + "Minced Pork"). That is the same
// class Phase 2 already solved for names (969 -> 854, merged with ingredient
// re-pointing); it just reappeared keyed on fdcId after the bulk import.
//
// The UNIQUE constraint is the point. The original corruption — one FDC record's
// macros copied onto six different pastes — becomes structurally unrepresentable
// once one id can only ever belong to one row. This script clears the last
// blocker to adding it.
//
// KEEPER RULE: most recipe references wins (fewest FK rewrites, least churn),
// tie-broken by earliest createdAt (the curated row predates the import). Macros
// are asserted identical before any merge — if a group's rows disagree, that is
// corruption rather than synonymy and the script refuses to touch it.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, "..", "prisma", "dev.db").replace(/\\/g, "/");
const url = process.env.DATABASE_URL?.startsWith("file:")
  && path.isAbsolute(process.env.DATABASE_URL.slice(5))
  ? process.env.DATABASE_URL
  : `file:${dbPath}`;

const prisma = new PrismaClient({ datasources: { db: { url } } });
const APPLY = process.argv.includes("--apply");
const EPS = 0.01;

// Groups that are NOT synonyms despite passing the identical-macros test, and so
// must never be auto-merged. Identical macros only prove the two rows carry the
// SAME numbers — not that those numbers belong to either food.
//
// 172684: FDC "Bread, rye" (SR Legacy). "Rye Bread" is correct; the row named
// "Rye" is mislabelled — a user reads that as rye grain/berries (~338 kcal,
// 10.3g protein, 15g fibre per 100g), but it carries bread's 259/8.5/5.8 under
// source="usda-verified". Merging would have hidden a wrong number behind a
// trusted label. This is the original fuzzy-match corruption class surviving the
// repair, because the repair verified the fdcId points at a REAL FDC record (it
// does) rather than that the display name describes that record.
// `downgrade` names the row whose display name does NOT describe the FDC record.
// It loses the false fdcId and the usda-verified tier; its macros are RETAINED
// but explicitly marked as another food's numbers. Nothing is invented — an
// honestly-labelled unknown is correct, a confident wrong number is not.
const NOT_SYNONYMS = new Map([
  [172684, {
    reason: 'FDC is "Bread, rye" — the row named "Rye" is mislabelled grain-vs-bread',
    keep: "Rye Bread",
    downgrade: "Rye",
    note: 'unverified — carried fdcId 172684 "Bread, rye" (SR Legacy) under the name "Rye"; ' +
          "macros are rye BREAD's, not rye grain's. Needs real rye-grain data or deletion.",
  }],
]);

async function main() {
  console.log(`[synonym-merge] db=${url}`);
  console.log(`[synonym-merge] mode=${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const groups = await prisma.$queryRawUnsafe(
    "SELECT fdcId FROM Food WHERE fdcId IS NOT NULL GROUP BY fdcId HAVING COUNT(*) > 1"
  );

  let merged = 0, deleted = 0, repointed = 0, folded = 0, refused = 0, downgraded = 0;

  for (const g of groups) {
    const fdcId = Number(g.fdcId);
    if (NOT_SYNONYMS.has(fdcId)) {
      const x = NOT_SYNONYMS.get(fdcId);
      console.log(`  SKIP   fdc ${fdcId}: ${x.reason}`);
      console.log(`         keep "${x.keep}" · downgrade "${x.downgrade}" off the verified tier`);
      refused++;
      if (APPLY) {
        const bad = await prisma.food.findFirst({ where: { fdcId, name: x.downgrade } });
        if (bad) {
          await prisma.food.update({
            where: { id: bad.id },
            data: { fdcId: null, source: "manual", dataQuality: `exception: ${x.note}` },
          });
          downgraded++;
        }
      }
      continue;
    }
    const rows = await prisma.food.findMany({
      where: { fdcId },
      select: { id: true, name: true, kcal: true, protein: true, fat: true, carb: true, fiber: true, createdAt: true },
    });

    // Refuse to merge rows that disagree on macros — that is corruption, not
    // synonymy, and it needs the provenance repair path, not this script.
    const [a] = rows;
    const identical = rows.every((r) =>
      Math.abs(r.kcal - a.kcal) < EPS && Math.abs(r.protein - a.protein) < EPS &&
      Math.abs(r.fat - a.fat) < EPS && Math.abs(r.carb - a.carb) < EPS &&
      Math.abs((r.fiber ?? 0) - (a.fiber ?? 0)) < EPS);
    if (!identical) {
      console.log(`  REFUSE fdc ${fdcId}: macros differ across rows — not synonyms`);
      rows.forEach((r) => console.log(`         ${r.name} — ${r.kcal}kcal/${r.protein}p`));
      refused++;
      continue;
    }

    const counts = {};
    for (const r of rows) counts[r.id] = await prisma.recipeIngredient.count({ where: { foodId: r.id } });
    const ranked = [...rows].sort((x, y) => (counts[y.id] - counts[x.id]) || (x.createdAt - y.createdAt));
    const keeper = ranked[0];
    const losers = ranked.slice(1);

    console.log(`  fdc ${fdcId}: keep "${keeper.name}" (${counts[keeper.id]} refs) · drop ${losers.map((l) => `"${l.name}" (${counts[l.id]})`).join(", ")}`);

    if (!APPLY) { merged++; continue; }

    await prisma.$transaction(async (tx) => {
      for (const loser of losers) {
        const ings = await tx.recipeIngredient.findMany({ where: { foodId: loser.id } });
        for (const ing of ings) {
          // If the recipe already uses the keeper, fold the grams into that row
          // rather than leaving the same food listed twice on one recipe.
          const existing = await tx.recipeIngredient.findFirst({
            where: { recipeId: ing.recipeId, foodId: keeper.id },
          });
          if (existing) {
            await tx.recipeIngredient.update({
              where: { id: existing.id },
              data: { baseGrams: existing.baseGrams + ing.baseGrams },
            });
            await tx.recipeIngredient.delete({ where: { id: ing.id } });
            folded++;
          } else {
            await tx.recipeIngredient.update({ where: { id: ing.id }, data: { foodId: keeper.id } });
            repointed++;
          }
        }
        await tx.food.delete({ where: { id: loser.id } });
        deleted++;
      }
    });
    merged++;
  }

  const left = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) c FROM (SELECT fdcId FROM Food WHERE fdcId IS NOT NULL GROUP BY fdcId HAVING COUNT(*) > 1)"
  );
  const remaining = Number(left[0].c);
  const total = await prisma.food.count();

  console.log(`\n[synonym-merge] groups=${merged} refused=${refused} deleted=${deleted} repointed=${repointed} folded=${folded}`);
  console.log(`[synonym-merge] foods now=${total} · duplicate-fdcId groups remaining=${remaining}`);
  if (APPLY && remaining === 0) console.log("[synonym-merge] fdcId is now safe to make UNIQUE.");
  if (!APPLY) console.log("[synonym-merge] dry run — re-run with --apply to write.");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
