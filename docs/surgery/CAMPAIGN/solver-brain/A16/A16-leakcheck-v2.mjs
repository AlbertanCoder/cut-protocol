// A16-leakcheck-v2.mjs — corrects an INSTRUMENT ERROR in A16-leakcheck.mjs.
// v1 is left on disk unchanged (docs/surgery/CAMPAIGN is create-only) and its
// output is void.
//
// THE ERROR, recorded per integrity rule 13: v1 reported 220 allergen leaks on
// the vegetarian and vegan catalogues. Every one was the word "butter" inside
// "Butter Beans" matching the dairy term list. oracle.mjs itself does not make
// this mistake — oracle.mjs:181 reads
//
//     if (hitsAny(ing.name, audit, term === "dairy")) { allergyLeaks++; ... }
//
// i.e. it passes stripDairy=TRUE for the dairy list precisely so that the
// PLANT_DAIRY entries ("butter bean", "peanut butter", "coconut milk", ...) are
// neutralised before matching. v1 passed the default `false`. The 220 was a
// defect in my checker, not in the catalogue. Fixed here by calling hitsAny with
// oracle.mjs's own convention.
//
// Everything else is unchanged from v1: AUDIT_ALLERGENS/hitsAny are IMPORTED
// from backend/scripts/qc/oracle.mjs (which imports no src/lib engine module);
// ANIMAL_MEAT is a verbatim copy of oracle.mjs:80, the one list it does not
// export; ANIMAL_SEA and ANIMAL_DAIRY_EGG are derived as oracle.mjs:81-82 does.
//
//   node A16-leakcheck-v2.mjs --mode=pool    --corner=vegetarian --n=80
//   node A16-leakcheck-v2.mjs --mode=shipped --jsonl=<abs run.jsonl>

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareAgentDb, assertIsolated, REPO } from "../A1/rig/dbcopy.mjs";
import { AUDIT_ALLERGENS, hitsAny } from "../../../../../backend/scripts/qc/oracle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));

prepareAgentDb("A16");
assertIsolated("A16");
const require = createRequire(import.meta.url);
const planCtx = require(path.join(REPO, "backend/src/lib/planContext.js"));
const { prisma } = require(path.join(REPO, "backend/src/lib/prisma.js"));

const ANIMAL_MEAT = ["beef", "pork", "chicken", "turkey", "duck", "goose", "lamb", "mutton", "veal", "venison", "bison", "goat", "rabbit", "bacon", "ham", "sausage", "salami", "pepperoni", "prosciutto", "chorizo", "gelatin", "gelatine", "lard", "tallow", "suet", "meat", "steak", "mince", "liver", "ostrich", "emu", "bologna", "gizzard", "brisket"];
const ANIMAL_SEA = AUDIT_ALLERGENS.fish.concat(AUDIT_ALLERGENS.shellfish);
const ANIMAL_DAIRY_EGG = AUDIT_ALLERGENS.dairy.concat(AUDIT_ALLERGENS.eggs, ["honey"]);

const CAT_FILE = argv.cat ? path.resolve(String(argv.cat)) : path.join(HERE, "A16-catalogue-v2.json");
const cat = JSON.parse(fs.readFileSync(CAT_FILE, "utf8")).catalogue;

function leaksFor(name, excluded, style) {
  const out = [];
  for (const key of excluded || []) {
    const terms = AUDIT_ALLERGENS[key];
    // oracle.mjs:181 — stripDairy is TRUE for the dairy list. This is the fix.
    if (terms && hitsAny(name, terms, key === "dairy")) out.push({ kind: "allergen", key });
  }
  if (style === "vegan" && hitsAny(name, ANIMAL_MEAT.concat(ANIMAL_SEA, ANIMAL_DAIRY_EGG), true)) out.push({ kind: "diet", key: "vegan" });
  if (style === "vegetarian" && hitsAny(name, ANIMAL_MEAT.concat(ANIMAL_SEA), true)) out.push({ kind: "diet", key: "vegetarian" });
  return out;
}

function personas() {
  const p = path.resolve(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");
  return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

async function modePool() {
  const corner = String(argv.corner || "vegetarian");
  const n = Number(argv.n ?? 80);
  const rows = corner === "all"
    ? ["vegetarian", "vegan", "none"].flatMap((c) => (cat[c] || []).slice(0, n))
    : (cat[corner] || []).slice(0, n);

  let admittedTotal = 0; const leaks = []; const perPersona = [];
  for (const p of personas()) {
    const style = p.profile.dietaryStyle && p.profile.dietaryStyle !== "none" ? p.profile.dietaryStyle : null;
    const dietProfile = { dietaryStyle: style, excludedFoods: p.profile.excludedFoods || [] };
    const admitted = planCtx.filterRecipePool(rows, dietProfile);
    admittedTotal += admitted.length;
    let bad = 0;
    for (const r of admitted) for (const ing of r.ingredients) {
      for (const L of leaksFor(ing.food.name, dietProfile.excludedFoods, style)) {
        bad++; leaks.push({ personaId: p.id, style, excluded: dietProfile.excludedFoods, recipe: r.name, food: ing.food.name, ...L });
      }
    }
    perPersona.push({ personaId: p.id, style, admitted: admitted.length, leaks: bad });
  }
  const out = { mode: "pool", tool: "A16-leakcheck-v2.mjs", corner, n, catalogueRows: rows.length, personas: perPersona.length, admittedTotal, leakCount: leaks.length, leaks: leaks.slice(0, 200) };
  fs.writeFileSync(path.join(HERE, `A16-leak-v2-pool-${corner}-N${n}.json`), JSON.stringify(out, null, 2));
  console.log(`[A16-leak-v2 pool] corner=${corner} N=${n} rows=${rows.length} · admissions across 250 personas ${admittedTotal} · LEAKS ${leaks.length}`);
  for (const l of leaks.slice(0, 8)) console.log(`   ! ${l.personaId} ${l.kind}:${l.key} "${l.food}" via ${l.recipe}`);
}

async function modeShipped() {
  const jsonl = path.resolve(String(argv.jsonl));
  const recs = fs.readFileSync(jsonl, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const real = await prisma.recipe.findMany({ select: { id: true, name: true, ingredients: { select: { food: { select: { name: true } } } } } });
  const byId = new Map(real.map((r) => [r.id, r.ingredients.map((i) => i.food?.name || "")]));
  for (const c of Object.values(cat)) for (const r of c) byId.set(r.id, r.ingredients.map((i) => i.food.name));

  let slots = 0, synthSlots = 0, unknown = 0; const leaks = [];
  for (const rec of recs) {
    if (!rec.judged) continue;
    const style = rec.dietStyle && rec.dietStyle !== "none" ? rec.dietStyle : null;
    for (const s of rec.slots || []) {
      if (!s.recipeId) continue;
      slots++;
      if (String(s.recipeId).startsWith("A16-syn-")) synthSlots++;
      const names = byId.get(s.recipeId);
      if (!names) { unknown++; continue; }
      for (const nm of names) for (const L of leaksFor(nm, rec.allergens, style)) {
        leaks.push({ personaId: rec.personaId, dayKey: rec.dayKey, style, excluded: rec.allergens, recipeId: s.recipeId, food: nm, ...L });
      }
    }
  }
  const out = { mode: "shipped", tool: "A16-leakcheck-v2.mjs", jsonl, slotsChecked: slots, syntheticSlots: synthSlots, unknownRecipeIds: unknown, leakCount: leaks.length, leaks: leaks.slice(0, 200) };
  const tag = path.basename(jsonl).replace(/\.jsonl$/, "");
  fs.writeFileSync(path.join(HERE, `A16-leak-v2-shipped-${tag}.json`), JSON.stringify(out, null, 2));
  console.log(`[A16-leak-v2 shipped] ${path.basename(jsonl)} · slots ${slots} (synthetic ${synthSlots}) · unknown-ids ${unknown} · LEAKS ${leaks.length}`);
  for (const l of leaks.slice(0, 8)) console.log(`   ! ${l.personaId} ${l.kind}:${l.key} "${l.food}" via ${l.recipeId}`);
}

const mode = String(argv.mode || "pool");
(mode === "pool" ? modePool() : modeShipped()).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
