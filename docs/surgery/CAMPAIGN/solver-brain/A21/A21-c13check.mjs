// A21-c13check.mjs — C19 step 1: check the STACK's shipped candidate/ingredient
// set BY NAME against C13's 13-row latent style-gate leak list, because
// oracle.mjs catches only 1 of the 13 (A17, MEASURED).
//
// Scope of the check: every distinct Food NAME reachable in the stack arm =
//   (a) ingredients of every real recipe actually placed in a slot,
//   (b) ingredients of the 8 synthetic concentrate recipes (from A16's manifest),
//   (c) the macro closer's adjuster candidate list (unchanged by this stack).
// Read-only; the DB is A21's own copy.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const SB = "C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain";
const REPO = "C:/Users/<account>/Desktop/cut-protocol";
process.env.DATABASE_URL = `file:${SB}/A21/dev.db`;
const require = createRequire(import.meta.url);
const { prisma } = require(path.join(REPO, "backend/src/lib/prisma.js"));

// C13's list, verbatim from CORRECTIONS-2.md C13 + CORRECTIONS-5.md C19.
const C13 = ["squirrel", "groundhog", "armadillo", "wild pig", "heart", "owl",
  "sea cucumber", "ceviche", "hog maws", "bear", "dove", "isopure", "whey",
  "seal, bearded", "oogruk"];

const ARM = process.argv[2] || `${SB}/A21/A21-stack-s424242.jsonl`;
const ids = new Set(); let slots = 0, syn = 0;
for (const l of fs.readFileSync(ARM, "utf8").split("\n")) {
  if (!l.trim()) continue; const r = JSON.parse(l);
  for (const s of r.slots || []) { slots++; if (s.recipeId == null) continue;
    if (String(s.recipeId).startsWith("A16-")) { syn++; continue; } ids.add(s.recipeId); }
}
const recs = await prisma.recipe.findMany({ where: { id: { in: [...ids] } },
  include: { ingredients: { include: { food: { select: { name: true } } } } } });
const names = new Set();
for (const r of recs) for (const i of r.ingredients) names.add(i.food.name);
// (b) synthetic rows
const man = JSON.parse(fs.readFileSync(`${SB}/A16/A16-concentrate-recipes-manifest.json`, "utf8"));
const manRows = Array.isArray(man) ? man : (man.recipes || Object.values(man).find(Array.isArray) || []);
for (const r of manRows) {
  const n = r.name || r.title || "";
  for (const part of String(n).replace(/\s*\[.*$/, "").split(/\s+with\s+|\s+and\s+/i)) if (part.trim()) names.add(part.trim());
  for (const i of r.ingredients || []) names.add(i.name || i.food || String(i));
}
// (c) adjuster candidates, copied from planContext.js:167-178 via the rig
for (const n of ["Olive Oil", "Butter", "Avocado", "White rice, cooked", "Potatoes", "Oats",
  "Chicken breast, cooked, skinless", "Greek Yogurt", "Tofu", "Lentils"]) names.add(n);

const hits = [];
for (const n of names) { const l = n.toLowerCase();
  for (const t of C13) if (l.includes(t)) hits.push({ name: n, term: t }); }

console.log(`[A21-c13] arm ${path.basename(ARM)}`);
console.log(`  slots ${slots} · real recipes placed ${ids.size} · synthetic slots ${syn}`);
console.log(`  distinct Food names checked: ${names.size}`);
console.log(`  C13 terms: ${C13.length}`);
console.log(`  HITS: ${hits.length}`);
for (const h of hits) console.log(`   ! "${h.name}" matches C13 term "${h.term}"`);
fs.writeFileSync(`${SB}/A21/A21-c13check-${path.basename(ARM, ".jsonl")}.json`,
  JSON.stringify({ arm: ARM, slots, realRecipes: ids.size, syntheticSlots: syn,
    distinctNames: names.size, c13Terms: C13, hits, names: [...names].sort() }, null, 2));
await prisma.$disconnect();
