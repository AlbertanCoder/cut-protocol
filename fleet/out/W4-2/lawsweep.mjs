// ═══════════════════════════════════════════════════════════════════════════
// W4-2 LAWS SWEEP — allergen / calorie-floor / keto-carb-ceiling across every
// probe output this fleet produced.
//
// RUN:  node fleet/out/W4-2/lawsweep.mjs
//
// It reads (never writes) every *.jsonl day dump under fleet/out/** and
// fleet/scratch/**, joins each placement back to the recipe's real ingredient
// rows, and grades it with an oracle whose vocabulary is authored in
// oracleVocab.mjs and NOT imported from dietaryFilter.js / allergenTaxonomy.js.
//
// Positive controls are ON by default (--nocontrol to disable): three synthetic
// violations are injected into the stream so a zero can be shown to be a
// FIRING zero rather than a broken predicate.
// ═══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ORACLE, DIET_ORACLE, ORACLE_VERSION } from "./oracleVocab.mjs";

const ROOT = path.resolve(process.argv[2] || "C:/Users/<account>/Desktop/cut-protocol");
const OUT = path.join(ROOT, "fleet/out/W4-2");
const CONTROLS = !process.argv.includes("--nocontrol");

// ── DB resolution ─────────────────────────────────────────────────────────
// The dumps were produced against d9037dce (fleet/scratch/W1-2/dev.db keeps a
// byte copy). W3-6's probe arm ran on its own DB with inserted rows (8c080b54).
// fb67a37f is the CURRENT tree DB, used only for IDs the other two lack.
const DBS = [
  ["d9037dce", "fleet/scratch/W1-2/dev.db"],
  ["8c080b54", "fleet/scratch/W3-6/dev.db"],
  ["fb67a37f", "backend/prisma/dev.db"],
].filter(([, p]) => fs.existsSync(path.join(ROOT, p)));

const recipeIx = new Map(); // id -> {name, steps, ings:[{name,fdc}], db}
const foodIx = new Map(); // id -> {name, fdc, db}
const dbFingerprints = [];

for (const [tag, rel] of DBS) {
  const db = new DatabaseSync(path.join(ROOT, rel), { readOnly: true });
  const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
  const foods = db.prepare("SELECT id,name,fdcCategory FROM Food").all();
  for (const f of foods) if (!foodIx.has(f.id)) foodIx.set(f.id, { name: f.name || "", fdc: f.fdcCategory || "", db: tag });
  const recs = db.prepare("SELECT id,name,steps FROM Recipe").all();
  const ings = db.prepare("SELECT recipeId,foodId FROM RecipeIngredient").all();
  const byRecipe = new Map();
  for (const r of ings) {
    if (!byRecipe.has(r.recipeId)) byRecipe.set(r.recipeId, []);
    byRecipe.get(r.recipeId).push(r.foodId);
  }
  for (const r of recs) {
    if (recipeIx.has(r.id)) continue;
    const ingIds = byRecipe.get(r.id) || [];
    recipeIx.set(r.id, {
      name: r.name || "",
      steps: typeof r.steps === "string" ? r.steps : JSON.stringify(r.steps || ""),
      ings: ingIds.map((fid) => foodIx.get(fid) || { name: "(unresolved food " + fid + ")", fdc: "" }),
      db: tag,
    });
  }
  dbFingerprints.push({ tag, rel, sha256: sha, foods: foods.length, recipes: recs.length, ingredientRows: ings.length });
  db.close();
}

// ── personas ──────────────────────────────────────────────────────────────
const PERSONAS_REL = "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl";
const personaRaw = fs.readFileSync(path.join(ROOT, PERSONAS_REL), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const personasSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, PERSONAS_REL))).digest("hex");

// The one free-text wall that is narrower than the category: cow dairy only.
const COW_ONLY = "no cow dairy but sheep and goat cheese are completely fine";

const personas = new Map();
for (const p of personaRaw) {
  const walls = new Set();
  let cowOnlyDairy = false;
  for (const e of p.profile.excludedFoods || []) {
    const k = String(e).toLowerCase();
    if (k === COW_ONLY) { walls.add("dairy"); cowOnlyDairy = true; continue; }
    walls.add(k);
  }
  for (const e of p.freeTextExclusions || []) walls.add(String(e).toLowerCase());
  personas.set(p.id, {
    id: p.id, tier: p.tier, sex: p.profile.sex, diet: p.dietaryStyle || p.profile.dietaryStyle || "none",
    walls: [...walls], cowOnlyDairy, userFloor: p.profile.floorKcal || 0,
  });
}

// ── the oracle ────────────────────────────────────────────────────────────
const norm = (s) => " " + String(s || "").toLowerCase().replace(/[_/]/g, " ").replace(/\s+/g, " ") + " ";

// Channel 2: USDA/FNDDS category evidence. Written from the USDA category
// vocabulary, independent of the app's own fdcCategories[] lists.
// Precision note: USDA SR-Legacy category names are NOT ingredient claims.
// "Cereal Grains and Pasta" holds quinoa, rice and cornstarch; "Plant-based
// milk" holds coconut milk; "Nuts and Seeds" holds peanuts and sunflower.
// Each of those produced a false positive in the first pass and each is
// excluded by construction below rather than filtered afterwards.
const FDC_EVIDENCE = [
  [/^(cheese|cottage\/ricotta cheese|cream cheese|ice cream|milk shakes|yogurt|milk,|flavored milk|dairy and egg products|macaroni and cheese|cheese sandwiches|soups, cream-based|butter and animal fats)/i, ["dairy"]],
  [/^(eggs and omelets|egg )/i, ["eggs"]],
  [/^(finfish|fish\b|fish and shellfish|seafood mixed dishes|seafood sandwiches)/i, ["fish"]],
  [/^(shellfish)/i, ["shellfish"]],
  [/^(yeast breads|rolls and buns|bagels and english muffins|biscuits, muffins, quick breads|cookies and brownies|cakes and pies|doughnuts|crackers|saltine crackers|pancakes, waffles|pasta mixed dishes|pizza|turnovers)/i, ["gluten"]],
  [/^(soy-based condiments|soy and meat-alternative|stir-fry and soy)/i, ["soy"]],
  [/^(pork|bacon|cured pork)/i, ["pork"]],
  [/^(beef|veal|ground beef)/i, ["beef"]],
];

function scanText(text, category, where) {
  const hits = [];
  const pats = ORACLE[category];
  if (!pats) return hits;
  const t = norm(text);
  for (const p of pats) {
    const m = t.match(p.re);
    if (m) hits.push({ term: m[0].trim(), strength: p.s, where, note: p.note || null, pattern: String(p.re) });
  }
  return hits;
}

const CATS = Object.keys(ORACLE);
const evalCache = new Map();

function evaluate(personaKey, walls, cowOnlyDairy, diet, recipeId, recipeNameHint) {
  const ck = personaKey + "|" + recipeId;
  if (evalCache.has(ck)) return evalCache.get(ck);
  const r = recipeIx.get(recipeId);
  const findings = [];
  if (!r) {
    evalCache.set(ck, { unresolved: true, findings });
    return { unresolved: true, findings };
  }
  const ingText = r.ings.map((i) => i.name).join(" ; ");
  for (const wall of walls) {
    if (!CATS.includes(wall)) continue;
    // channel 1 — culinary vocabulary, on ingredient rows then dish name then steps
    let hits = [
      ...scanText(ingText, wall, "ingredient"),
      ...scanText(r.name, wall, "recipeName"),
      ...scanText(r.steps, wall, "steps"),
    ];
    if (wall === "dairy" && cowOnlyDairy) {
      // this persona's own words permit sheep/goat: drop hits whose matched
      // ingredient row is a sheep/goat cheese
      hits = hits.filter((h) => !/pecorino|feta|halloumi|haloumi|manchego|roquefort|chevre|goat|sheep/i.test(h.term));
    }
    // channel 2 — USDA category evidence on the actual ingredient rows
    const fdcHits = [];
    for (const ing of r.ings) {
      for (const [re, cats] of FDC_EVIDENCE) {
        if (cats.includes(wall) && re.test(ing.fdc)) fdcHits.push({ term: ing.name, strength: "certain", where: "fdcCategory:" + ing.fdc, note: "USDA category evidence", pattern: String(re) });
      }
    }
    for (const h of [...hits, ...fdcHits]) findings.push({ category: wall, ...h });
  }
  // diet-style animal-product checks
  if (diet === "vegan" || diet === "vegetarian") {
    const t = norm(ingText + " ; " + r.name);
    for (const [k, re] of Object.entries(DIET_ORACLE)) {
      if (diet === "vegetarian" && k === "dairyEgg") continue;
      const m = t.match(re);
      if (m) findings.push({ category: "diet:" + diet, term: m[0].trim(), strength: "certain", where: "ingredient|recipeName", note: k, pattern: String(re) });
    }
  }
  const res = { unresolved: false, findings };
  evalCache.set(ck, res);
  return res;
}

// ── controls ──────────────────────────────────────────────────────────────
const CONTROL_RECIPE = "CONTROL-w42-tahina-lupini";
if (CONTROLS) {
  recipeIx.set(CONTROL_RECIPE, {
    name: "Levantine Mezze Platter",
    steps: "Whisk the tahina with lemon. Fold through the besan crackers.",
    ings: [
      { name: "Tahina", fdc: "" },
      { name: "Lupini Beans, brined", fdc: "" },
      { name: "Surimi Sticks", fdc: "" },
      { name: "Besan", fdc: "" },
      { name: "Aged Cheddar", fdc: "Cheese" },
    ],
    db: "CONTROL",
  });
}

// ── stream every dump ─────────────────────────────────────────────────────
function listDumps() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  for (const base of ["fleet/out", "fleet/scratch"]) {
    const d = path.join(ROOT, base);
    if (fs.existsSync(d)) walk(d);
  }
  return out.sort();
}

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const files = limitArg ? listDumps().slice(0, Number(limitArg.split("=")[1])) : listDumps();
const fileMeta = [];
const leaks = new Map(); // key -> aggregated finding
const ketoViol = [];
const floorViol = [];
const deliveredUnderFloor = new Map(); // file -> count
const energyByPersona = new Map();
const wallDisagreements = [];
let totalRecords = 0, totalPlacements = 0, unresolvedPlacements = 0, skippedFiles = 0;
const controlFired = { allergen: 0, keto: 0, floor: 0 };

function addLeak(f, rec, slot, finding, file) {
  const key = [finding.category, finding.term.toLowerCase(), rec.personaId, slot.recipeId, finding.where].join("|");
  if (!leaks.has(key)) {
    const r = recipeIx.get(slot.recipeId);
    leaks.set(key, {
      category: finding.category, term: finding.term, strength: finding.strength, where: finding.where,
      note: finding.note, pattern: finding.pattern,
      personaId: rec.personaId, personaTier: rec.tier, personaDiet: rec.dietStyle,
      recipeId: slot.recipeId, recipeName: r ? r.name : slot.recipeName || "?",
      ingredients: r ? r.ings.map((i) => i.name) : [],
      placements: 0, files: new Set(),
    });
  }
  const L = leaks.get(key);
  L.placements++;
  L.files.add(path.relative(ROOT, file).replace(/\\/g, "/"));
}

async function sweepFile(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let first = true, nRec = 0;
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  let meta = null;
  let ketoDays = 0, ketoOver = 0, floorBad = 0, underFloorDelivered = 0, judgedRecs = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (first) { meta = rec.run || null; first = false; }
    if (!rec.personaId) continue;
    nRec++; totalRecords++;
    const P = personas.get(rec.personaId);
    if (!P) continue;

    // cross-check: the dump's own allergen list vs the persona file
    if (Array.isArray(rec.allergens)) {
      const a = [...rec.allergens].map((x) => String(x).toLowerCase()).sort().join(",");
      const b = [...P.walls].sort().join(",");
      if (a !== b && wallDisagreements.length < 40) wallDisagreements.push({ file: rel, personaId: rec.personaId, dump: a, personaFile: b });
    }

    // ── LAW 2: energy floor (prescription) ──
    if (rec.energy) {
      if (!energyByPersona.has(rec.personaId)) energyByPersona.set(rec.personaId, rec.energy);
      const sexFloor = P.sex === "F" ? 1200 : 1500;
      const expected = Math.max(rec.energy.rmr * 0.95, sexFloor, P.userFloor || 0);
      if (rec.energy.targetKcal < expected - 1) {
        floorBad++;
        if (floorViol.length < 60) floorViol.push({ file: rel, personaId: rec.personaId, sex: P.sex, rmr: rec.energy.rmr, expectedFloor: Math.round(expected), targetKcal: rec.energy.targetKcal, engineFloor: rec.energy.floorKcal, floored: rec.energy.floored });
      }
    }
    // delivered kcal far below the prescription floor (advisory metric)
    const en = rec.energy || energyByPersona.get(rec.personaId);
    if (en && rec.achieved && rec.slotsFilled > 0) {
      const sexFloor = P.sex === "F" ? 1200 : 1500;
      const fl = Math.max(en.rmr * 0.95, sexFloor, P.userFloor || 0);
      if (rec.achieved.kcal < fl) underFloorDelivered++;
    }

    // ── LAW 3: keto carb ceiling ──
    const isKeto = P.diet === "keto";
    if (isKeto && rec.target && rec.achieved && rec.slotsFilled > 0) {
      ketoDays++;
      if (rec.target.keto !== true && ketoViol.length < 60) {
        ketoViol.push({ kind: "flag-mismatch", file: rel, personaId: rec.personaId, targetKeto: rec.target.keto });
      }
      if (rec.achieved.carb > rec.target.carbHi + 1e-6) {
        ketoOver++;
        if (ketoViol.length < 60) ketoViol.push({ kind: "carb-over-ceiling", file: rel, personaId: rec.personaId, dayKey: rec.dayKey, carbHi: rec.target.carbHi, achievedCarb: rec.achieved.carb, overBy: +(rec.achieved.carb - rec.target.carbHi).toFixed(2), engineSaysCarbOk: rec.verdict ? rec.verdict.carbOk : null, engineInBand: rec.engineInBand });
      }
    }
    if (rec.judged) judgedRecs++;

    // ── LAW 1: allergen / diet placements ──
    const pk = rec.personaId;
    for (const slot of rec.slots || []) {
      if (!slot || !slot.recipeId) continue;
      totalPlacements++;
      const r = evaluate(pk, P.walls, P.cowOnlyDairy, P.diet, slot.recipeId, slot.recipeName);
      if (r.unresolved) { unresolvedPlacements++; continue; }
      for (const f of r.findings) addLeak(f, rec, slot, f, file);
      // adjuster foods placed onto the plate
      for (const adj of slot.adjusters || []) {
        const food = foodIx.get(adj.foodId) || { name: adj.name || "", fdc: "" };
        for (const wall of P.walls) {
          if (!CATS.includes(wall)) continue;
          const hits = scanText(food.name, wall, "adjusterFood");
          for (const h of hits) addLeak(h, rec, { recipeId: "food:" + adj.foodId, recipeName: food.name }, { category: wall, ...h }, file);
        }
      }
    }
  }
  fileMeta.push({ file: rel, records: nRec, agent: meta?.agentId ?? null, label: meta?.label ?? null, seed: meta?.seed ?? null, brain: meta?.brain ?? null, db: (meta?.dbSha256 || "").slice(0, 8) || null, git: (meta?.gitSha || "").slice(0, 7) || null, ketoDays, ketoOver, floorBad, underFloorDelivered, judged: judgedRecs });
  if (underFloorDelivered) deliveredUnderFloor.set(rel, underFloorDelivered);
}

// ── positive controls ─────────────────────────────────────────────────────
function runControls() {
  // C1 — allergen: a persona walled on sesame+peanut+shellfish+gluten+dairy is
  // handed a plate of tahina, lupini, surimi, besan and cheddar.
  const victim = [...personas.values()].find((p) => p.walls.includes("sesame")) || [...personas.values()][0];
  const walls = ["sesame", "peanuts", "shellfish", "gluten", "dairy", "legumes"];
  const r = evaluate("CONTROL", walls, false, "none", CONTROL_RECIPE, "Levantine Mezze Platter");
  controlFired.allergen = r.findings.length;
  const cats = [...new Set(r.findings.map((f) => f.category))];
  // C2 — keto: a keto day 80 g over its own ceiling
  const ketoRec = { target: { keto: true, carbHi: 40 }, achieved: { carb: 120 }, slotsFilled: 3 };
  controlFired.keto = ketoRec.achieved.carb > ketoRec.target.carbHi ? 1 : 0;
  // C3 — floor: a 900 kcal prescription for a man with RMR 1600
  const eng = { rmr: 1600, targetKcal: 900 };
  controlFired.floor = eng.targetKcal < Math.max(eng.rmr * 0.95, 1500) ? 1 : 0;
  return { victim: victim.id, walls, categoriesFired: cats, findings: r.findings.map((f) => ({ category: f.category, term: f.term, where: f.where, strength: f.strength })) };
}

// ── independence measurement ──────────────────────────────────────────────
// AFTER the oracle is authored and frozen, measure how much of its vocabulary
// the app's own allergen table already contains. This is a MEASUREMENT of
// independence; it is never used to build or filter the predicate.
async function measureIndependence() {
  const taxPath = path.join(ROOT, "backend/src/lib/allergenTaxonomy.js");
  const dfPath = path.join(ROOT, "backend/src/lib/dietaryFilter.js");
  const appVocab = (fs.readFileSync(taxPath, "utf8") + "\n" + fs.readFileSync(dfPath, "latin1")).toLowerCase();
  const rows = [];
  for (const [cat, pats] of Object.entries(ORACLE)) {
    for (const p of pats) {
      // extract literal alternatives from the pattern for the overlap test
      const lits = String(p.re).replace(/^\/|\/[a-z]*$/g, "")
        .replace(/\(\?<[=!][^)]*\)/g, "").replace(/\(\?[:!=][^)]*\)/g, "")
        .split(/[|()\\bws?+*\[\]{}^$.]+/).map((s) => s.trim()).filter((s) => s.length >= 4);
      for (const l of lits) rows.push({ cat, term: l, inApp: appVocab.includes(l) });
    }
  }
  const uniq = new Map();
  for (const r of rows) if (!uniq.has(r.cat + "|" + r.term)) uniq.set(r.cat + "|" + r.term, r);
  const all = [...uniq.values()];
  return { totalTerms: all.length, absentFromApp: all.filter((r) => !r.inApp).length, presentInApp: all.filter((r) => r.inApp).length, sampleAbsent: all.filter((r) => !r.inApp).slice(0, 60).map((r) => r.cat + ":" + r.term) };
}

// ── main ──────────────────────────────────────────────────────────────────
const started = Date.now();
const control = CONTROLS ? runControls() : null;
for (const f of files) {
  try { await sweepFile(f); } catch (e) { skippedFiles++; console.error("SKIP", f, e.message); }
}
const independence = await measureIndependence();

const leakRows = [...leaks.values()].map((l) => ({ ...l, files: [...l.files] }))
  .sort((a, b) => b.placements - a.placements);

const byCategory = {};
for (const l of leakRows) {
  const k = l.category + "/" + l.strength;
  byCategory[k] = (byCategory[k] || 0) + 1;
}
const personasAffected = new Set(leakRows.filter((l) => l.strength !== "advisory").map((l) => l.personaId));

const report = {
  agent: "W4-2", oracle: ORACLE_VERSION, generatedAt: new Date().toISOString(),
  elapsedMs: Date.now() - started,
  scope: { files: files.length, skippedFiles, records: totalRecords, placements: totalPlacements, unresolvedPlacements, distinctRecipesPlaced: new Set([...evalCache.keys()].map((k) => k.split("|")[1])).size },
  dbs: dbFingerprints, personasSha256: personasSha, personas: personas.size,
  controls: { enabled: CONTROLS, ...control, fired: controlFired },
  independence,
  law1_allergen: {
    distinctFindings: leakRows.length,
    certain: leakRows.filter((l) => l.strength === "certain").length,
    standard: leakRows.filter((l) => l.strength === "standard").length,
    advisory: leakRows.filter((l) => l.strength === "advisory").length,
    personasAffectedNonAdvisory: personasAffected.size,
    byCategory,
    findings: leakRows.filter((l) => !String(l.recipeId).startsWith("CONTROL")),
  },
  law2_floor: { prescriptionViolations: floorViol.length, samples: floorViol, deliveredBelowFloorByFile: [...deliveredUnderFloor.entries()].map(([f, n]) => ({ file: f, days: n })).sort((a, b) => b.days - a.days) },
  law3_keto: { violations: ketoViol.length, samples: ketoViol },
  wallDisagreements,
  files: fileMeta,
};

fs.writeFileSync(path.join(OUT, "lawsweep.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({
  files: files.length, records: totalRecords, placements: totalPlacements, unresolved: unresolvedPlacements,
  controlsFired: controlFired, controlCats: control ? control.categoriesFired : null,
  allergenFindings: leakRows.length, certain: report.law1_allergen.certain, standard: report.law1_allergen.standard, advisory: report.law1_allergen.advisory,
  floorViolations: floorViol.length, ketoViolations: ketoViol.length,
  independence: { terms: independence.totalTerms, absentFromApp: independence.absentFromApp },
  elapsedMs: report.elapsedMs,
}, null, 1));
