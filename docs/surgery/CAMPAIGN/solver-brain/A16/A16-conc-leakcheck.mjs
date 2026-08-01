// A16-conc-leakcheck.mjs — C16 discharge for the CONCENTRATE arm.
//
// WHY THIS EXISTS: A16-leakcheck-v2.mjs resolves a shipped slot's ingredients by
// recipeId, and it only recognises the catalogue's `A16-syn-*` ids. Against
// A16-conc-recipes-N8-s424242.jsonl it therefore reported `unknown-ids 358` and
// did NOT inspect a single concentrate slot. Its "LEAKS 1" for that arm covers
// 2552 of 2910 slots only. That gap is an instrument fault, recorded, and this
// file closes it.
//
// Ingredient names come from A16-concentrate-recipes-manifest.json, which the
// treatment wrote at run time ("Nutritional Yeast with X and Y [A16 conc #n]").
// AUDIT_ALLERGENS / hitsAny are IMPORTED from backend/scripts/qc/oracle.mjs —
// the independently curated list that imports no src/lib engine module (C16).
// ANIMAL_MEAT is a verbatim copy of oracle.mjs:80.
//
//   node A16-conc-leakcheck.mjs <arm.jsonl>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_ALLERGENS, hitsAny } from "../../../../../backend/scripts/qc/oracle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARM = path.resolve(String(process.argv[2]));

const ANIMAL_MEAT = ["beef", "pork", "chicken", "turkey", "duck", "goose", "lamb", "mutton", "veal", "venison", "bison", "goat", "rabbit", "bacon", "ham", "sausage", "salami", "pepperoni", "prosciutto", "chorizo", "gelatin", "gelatine", "lard", "tallow", "suet", "meat", "steak", "mince", "liver", "ostrich", "emu", "bologna", "gizzard", "brisket"];
const ANIMAL_SEA = AUDIT_ALLERGENS.fish.concat(AUDIT_ALLERGENS.shellfish);
const ANIMAL_DAIRY_EGG = AUDIT_ALLERGENS.dairy.concat(AUDIT_ALLERGENS.eggs, ["honey"]);

const man = JSON.parse(fs.readFileSync(path.join(HERE, "A16-concentrate-recipes-manifest.json"), "utf8"));
const ingsById = new Map();
for (const r of man.recipes) {
  const body = r.name.replace(/\s*\[A16 conc #\d+\]\s*$/, "");
  ingsById.set(r.id, body.split(/\s+with\s+/).flatMap((p) => p.split(/\s+and\s+/)).map((s) => s.trim()).filter(Boolean));
}
console.log("[conc-leak] recipe -> ingredient names parsed from the manifest:");
for (const [id, names] of ingsById) console.log(`  ${id}: ${names.join(" | ")}`);

const rows = fs.readFileSync(ARM, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
let concSlots = 0, checked = 0, leaks = [];
for (const r of rows) {
  for (const s of r.slots || []) {
    const id = String(s.recipeId || "");
    if (!id.startsWith("A16-conc-")) continue;
    concSlots++;
    const names = ingsById.get(id);
    if (!names) { leaks.push({ personaId: r.personaId, recipeId: id, kind: "UNRESOLVED" }); continue; }
    checked++;
    for (const nm of names) {
      for (const key of r.allergens || []) {
        const audit = AUDIT_ALLERGENS[key];
        if (audit && hitsAny(nm, audit, key === "dairy")) leaks.push({ personaId: r.personaId, dayKey: r.dayKey, recipeId: id, food: nm, kind: "allergen", key });
      }
      const style = r.dietStyle;
      if (style === "vegan" || style === "vegetarian") {
        if (hitsAny(nm, ANIMAL_MEAT) || hitsAny(nm, ANIMAL_SEA)) leaks.push({ personaId: r.personaId, dayKey: r.dayKey, recipeId: id, food: nm, kind: "diet", key: style });
        if (style === "vegan" && hitsAny(nm, ANIMAL_DAIRY_EGG, true)) leaks.push({ personaId: r.personaId, dayKey: r.dayKey, recipeId: id, food: nm, kind: "diet", key: "vegan" });
      }
    }
  }
}
const out = { tool: "A16-conc-leakcheck.mjs", arm: ARM, concSlots, checkedSlots: checked, leakCount: leaks.length, leaks: leaks.slice(0, 40) };
fs.writeFileSync(path.join(HERE, "A16-conc-leakcheck.json"), JSON.stringify(out, null, 2));
console.log(`[conc-leak] ${path.basename(ARM)} · concentrate slots ${concSlots} · checked ${checked} · LEAKS ${leaks.length}`);
for (const l of leaks.slice(0, 20)) console.log(`   ! ${l.personaId} ${l.kind}:${l.key} "${l.food}" via ${l.recipeId}`);
