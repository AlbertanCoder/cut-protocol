// QC gauntlet — recipe prose-vs-ingredient allergen audit (customer #7 finding).
//
//   node scripts/qc/recipeAllergenAudit.mjs [--assert]
//
// Some imported recipes carry allergens in their STEP TEXT that never became
// structured ingredients — e.g. "Beef Banh Mi ... Sriracha Mayo" whose first
// step is literally "Add'l ingredients: mayonnaise, siracha" while its
// ingredient rows are rice/beef/veg with no egg. The allergen filter scans
// INGREDIENTS, so it passes that recipe for an egg-allergic user. This read-only
// audit scans each recipe's name + steps against the QC oracle's INDEPENDENT
// allergen list and reports every allergen that appears in the prose but is
// absent from the structured ingredients. Report-only; never writes.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const ASSERT = process.argv.includes("--assert");
const { prisma } = require(path.join(HERE, "..", "..", "src", "lib", "prisma.js"));
const O = await import("./oracle.mjs");

const CATS = ["gluten", "shellfish", "dairy", "soy", "tree nuts", "eggs", "fish", "kiwi", "peanuts", "sesame"];

function stepsText(steps) {
  if (Array.isArray(steps)) return steps.join("  ");
  if (typeof steps === "string") return steps;
  return "";
}

async function main() {
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: { select: { name: true } } } } } });

  const findings = [];      // {recipe, cat, term-source, addlLine}
  for (const r of recipes) {
    const ingNames = (r.ingredients || []).map((i) => i.food?.name || "");
    const prose = stepsText(r.steps);
    const addl = (prose.match(/add'?l ingredients?:[^.]*/i) || [])[0] || null; // the tell-tale importer line
    for (const cat of CATS) {
      const audit = O.AUDIT_ALLERGENS[cat] || [cat];
      const inProse = O.hitsAny(`${r.name} ${prose}`, audit, cat === "dairy");
      const inIngredients = ingNames.some((n) => O.hitsAny(n, audit, cat === "dairy"));
      if (inProse && !inIngredients) {
        findings.push({ recipe: r.name, cat, addl: addl ? addl.slice(0, 80) : null });
      }
    }
  }

  // Rank: an explicit "Add'l ingredients:" line is the high-confidence class
  // (a declared ingredient the importer dropped) vs an incidental prose mention.
  const declared = findings.filter((f) => f.addl);
  const incidental = findings.filter((f) => !f.addl);
  const byCat = {};
  for (const f of findings) byCat[f.cat] = (byCat[f.cat] || 0) + 1;

  const L = [];
  L.push(`# Cut Protocol — recipe prose-vs-ingredient allergen audit`);
  L.push("");
  L.push(`- Scanned ${recipes.length} recipes. An allergen in the NAME or STEPS but NOT in the structured`);
  L.push(`  ingredient rows means the allergen filter (which reads ingredients) can't see it.`);
  L.push(`- Findings: **${findings.length}** (high-confidence "Add'l ingredients:" declarations: **${declared.length}**; incidental prose mentions: ${incidental.length}).`);
  L.push(`- By allergen: ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  L.push("");
  if (declared.length) {
    L.push(`## High-confidence — a declared ingredient the importer dropped (fix the data)`);
    L.push(`| recipe | allergen | the dropped line |`);
    L.push(`|---|---|---|`);
    for (const f of declared.slice(0, 60)) L.push(`| ${f.recipe.slice(0, 50)} | ${f.cat} | \`${(f.addl || "").replace(/\|/g, "/")}\` |`);
    L.push("");
  }
  if (incidental.length) {
    L.push(`## Incidental prose mentions (review — may be a garnish, an "optional", or a false hit)`);
    L.push(`| recipe | allergen |`);
    L.push(`|---|---|`);
    for (const f of incidental.slice(0, 40)) L.push(`| ${f.recipe.slice(0, 50)} | ${f.cat} |`);
  }
  L.push("");
  L.push(`_Generated ${new Date().toISOString()}. Report-only — no recipe data was modified. The defence-in-depth fix (have the allergen filter also parse the "Add'l ingredients:" line) is applied in dietaryFilter; this audit finds what still needs the data itself corrected._`);

  const out = path.join(REPO, "docs", "qc"); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "recipe-allergen-audit.md"), L.join("\n") + "\n");
  fs.writeFileSync(path.join(out, "recipe-allergen-audit.json"), JSON.stringify(findings, null, 0));

  console.log(`\nRECIPE ALLERGEN AUDIT: ${findings.length} prose-only allergens (${declared.length} high-confidence "Add'l ingredients" drops)`);
  console.log(`  by allergen:`, byCat);
  console.log(`  report: docs/qc/recipe-allergen-audit.md`);
  await prisma.$disconnect();
  if (ASSERT && declared.length > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
