// A16-leakcheck.mjs — MANDATORY per C16. The rig emits no allergen-leak column,
// so every A16 enrichment variant is checked here, independently.
//
// Independence: AUDIT_ALLERGENS, hitsAny and matchesTerm are IMPORTED from
// backend/scripts/qc/oracle.mjs, which imports no src/lib engine module. The one
// list oracle.mjs does not export is ANIMAL_MEAT; it is copied verbatim below
// from oracle.mjs:80 and marked as a copy. ANIMAL_SEA and ANIMAL_DAIRY_EGG are
// derived from the imported AUDIT_ALLERGENS exactly as oracle.mjs:81-82 does.
//
// Two modes, because "what shipped" and "what could have shipped" are different
// questions and the pool question is the one enrichment actually changes:
//
//   --mode=pool     every synthetic row the product gate ADMITS to each
//                   persona's pool, checked against that persona's exclusions.
//                   This is the reachable surface, not just the sampled one.
//   --mode=shipped  every recipe actually placed in a slot in a rig JSONL,
//                   synthetic and real alike.
//
//   node A16-leakcheck.mjs --mode=pool   --corner=vegetarian --n=80
//   node A16-leakcheck.mjs --mode=shipped --jsonl=<abs run.jsonl>

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

// VERBATIM COPY of oracle.mjs:80 — the only list that module does not export.
const ANIMAL_MEAT = ["beef", "pork", "chicken", "turkey", "duck", "goose", "lamb", "mutton", "veal", "venison", "bison", "goat", "rabbit", "bacon", "ham", "sausage", "salami", "pepperoni", "prosciutto", "chorizo", "gelatin", "gelatine", "lard", "tallow", "suet", "meat", "steak", "mince", "liver", "ostrich", "emu", "bologna", "gizzard", "brisket"];
// oracle.mjs:81-82, re-derived from the IMPORTED list.
const ANIMAL_SEA = AUDIT_ALLERGENS.fish.concat(AUDIT_ALLERGENS.shellfish);
const ANIMAL_DAIRY_EGG = AUDIT_ALLERGENS.dairy.concat(AUDIT_ALLERGENS.eggs, ["honey"]);

const cat = JSON.parse(fs.readFileSync(path.join(HERE, "A16-catalogue-v2.json"), "utf8")).catalogue;

/** Every leak this ingredient name represents for this persona. */
function leaksFor(name, excluded, style) {
  const out = [];
  for (const key of excluded || []) {
    const terms = AUDIT_ALLERGENS[key];
    if (terms && hitsAny(name, terms)) out.push({ kind: "allergen", key });
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

  let admittedTotal = 0, leaks = [];
  const perPersona = [];
  for (const p of personas()) {
    const style = p.profile.dietaryStyle && p.profile.dietaryStyle !== "none" ? p.profile.dietaryStyle : null;
    const dietProfile = { dietaryStyle: style, excludedFoods: p.profile.excludedFoods || [] };
    const admitted = planCtx.filterRecipePool(rows, dietProfile);
    admittedTotal += admitted.length;
    let bad = 0;
    for (const r of admitted) {
      for (const ing of r.ingredients) {
        for (const L of leaksFor(ing.food.name, dietProfile.excludedFoods, style)) {
          bad++;
          leaks.push({ personaId: p.id, style, excluded: dietProfile.excludedFoods, recipe: r.name, food: ing.food.name, ...L });
        }
      }
    }
    perPersona.push({ personaId: p.id, style, admitted: admitted.length, leaks: bad });
  }
  const out = { mode: "pool", corner, n, catalogueRows: rows.length, personas: perPersona.length, admittedTotal, leakCount: leaks.length, leaks: leaks.slice(0, 200) };
  fs.writeFileSync(path.join(HERE, `A16-leak-pool-${corner}-N${n}.json`), JSON.stringify(out, null, 2));
  console.log(`[A16-leak pool] corner=${corner} N=${n} rows=${rows.length} · admissions across 250 personas ${admittedTotal} · LEAKS ${leaks.length}`);
  for (const l of leaks.slice(0, 10)) console.log(`   ! ${l.personaId} ${l.kind}:${l.key} "${l.food}" via ${l.recipe}`);
}

async function modeShipped() {
  const jsonl = path.resolve(String(argv.jsonl));
  const recs = fs.readFileSync(jsonl, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const real = await prisma.recipe.findMany({ select: { id: true, name: true, ingredients: { select: { food: { select: { name: true } } } } } });
  const byId = new Map(real.map((r) => [r.id, r.ingredients.map((i) => i.food?.name || "")]));
  for (const c of Object.values(cat)) for (const r of c) byId.set(r.id, r.ingredients.map((i) => i.food.name));

  let slots = 0, synthSlots = 0, unknown = 0;
  const leaks = [];
  for (const rec of recs) {
    if (!rec.judged) continue;
    const style = rec.dietStyle && rec.dietStyle !== "none" ? rec.dietStyle : null;
    for (const s of rec.slots || []) {
      if (!s.recipeId) continue;
      slots++;
      if (String(s.recipeId).startsWith("A16-syn-")) synthSlots++;
      const names = byId.get(s.recipeId);
      if (!names) { unknown++; continue; }
      for (const nm of names) {
        for (const L of leaksFor(nm, rec.allergens, style)) {
          leaks.push({ personaId: rec.personaId, dayKey: rec.dayKey, style, excluded: rec.allergens, recipeId: s.recipeId, food: nm, ...L });
        }
      }
    }
  }
  const out = { mode: "shipped", jsonl, slotsChecked: slots, syntheticSlots: synthSlots, unknownRecipeIds: unknown, leakCount: leaks.length, leaks: leaks.slice(0, 200) };
  const tag = path.basename(jsonl).replace(/\.jsonl$/, "");
  fs.writeFileSync(path.join(HERE, `A16-leak-shipped-${tag}.json`), JSON.stringify(out, null, 2));
  console.log(`[A16-leak shipped] ${path.basename(jsonl)} · slots ${slots} (synthetic ${synthSlots}) · unknown ids ${unknown} · LEAKS ${leaks.length}`);
  for (const l of leaks.slice(0, 10)) console.log(`   ! ${l.personaId} ${l.kind}:${l.key} "${l.food}" via ${l.recipeId}`);
}

const mode = String(argv.mode || "pool");
(mode === "pool" ? modePool() : modeShipped()).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
