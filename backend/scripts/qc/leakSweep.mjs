// leakSweep.mjs — fleet T-2. THE FALSE-NEGATIVE sweep of the exclusion gate.
//
//   node backend/scripts/qc/leakSweep.mjs
//   node backend/scripts/qc/leakSweep.mjs --freshdb --out=fleet/out/T-2
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// Every leak statement in the inherited corpus was produced by an instrument
// that inspects what the gate REMOVED. Those instruments are structurally
// incapable of finding a false negative: a food that was never removed never
// appears in their output. fleet/TRIAGE.md logs T-2 as OPEN for exactly this
// reason. This file measures the other direction — foods and recipes that
// SHOULD be excluded for a rule-set and are NOT.
//
// ── THE ORACLE PROBLEM, AND THE FIVE ANSWERS ────────────────────────────────
// "Should be excluded" needs a ground truth that is not the gate itself, or the
// sweep is circular. Five independent oracles are used, in decreasing order of
// how much they depend on the author's judgement:
//
//   A. SUPPRESSION ENUMERATION (no vocabulary at all). Every place the gate's
//      own keyword would have fired and a WORD_GUARD or a free-from veto turned
//      it OFF. The gate's vocabulary is the ground truth; the guards are the
//      hypothesis under test. This is the structural indictment in
//      fleet/TRIAGE.md — "a denylist of exceptions to a denylist" — made
//      enumerable. Complete by construction over the corpus.
//   B. STYLE↔ALLERGY DISAGREEMENT (no vocabulary at all). The app carries two
//      independent vocabularies over the same foods: the dietary STYLE filter
//      and the ALLERGEN filter. A food the vegan filter removes but the
//      vegetarian filter keeps is, by the style filter's own reasoning, a dairy
//      or egg carrier. If the dairy AND egg allergy filters both keep it, the
//      two vocabularies disagree, and the safety-critical reading of a
//      disagreement is that the allergy side is leaking. This is the `perogi`
//      class named in allergenTaxonomy.js's own header.
//   C. TERM-RESOLUTION PARITY (the taxonomy is the ground truth). Every key,
//      label and synonym the taxonomy declares must resolve to its own
//      category. One that resolves to `kind:"literal"` degrades to a substring
//      grep — the measured class that served pork to 12 of 46 customers who
//      typed "pork" (allergenTaxonomy.js:530-548).
//   D. GATE-SURFACE PARITY (the gate is its own ground truth). isExcluded() on
//      a flat Food must agree with foodMatchesExclusionTerm(); "egg" and "eggs"
//      must agree; a food excluded on its own must not be admitted inside a
//      recipe. Any disagreement is a leak on whichever surface says "allowed".
//   E. HOSTILE VOCABULARY (author's judgement, declared as such). A curated
//      table of foods that carry an allergen by definition or by standard
//      commercial formulation, written against culinary fact and then measured
//      against the real corpus. Every entry carries its basis and a strength
//      tier, and `standard` entries are held to the same bar the repo already
//      committed to for kimchi/pho/worcestershire/caesar.
//
// ── EVIDENCE STANDARD ───────────────────────────────────────────────────────
// Every number printed carries its denominator and lands in an artifact file.
// A probe that swept a near-empty scope is reported INCONCLUSIVE, never clean.
// The arm check (what was examined, what was NOT) is generated from the run,
// not written by hand.
//
// ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
// It changes nothing under backend/src or frontend/src, and it does not measure
// OVER-exclusion (foods hidden that need not be). Over-exclusion is this
// codebase's documented safe direction and a different job.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

process.env.BRAIN = "off";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");
const PERSONAS_PATH = path.resolve(REPO, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032/personas.jsonl");
const AGENT = "T-2";

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.length ? v.join("=") : true];
}));
const OUTDIR = path.resolve(REPO, String(argv.out || `fleet/out/${AGENT}`));

const sha256 = (p) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);

// ── DB ISOLATION. Nothing may require prisma before this block. ─────────────
// Verbatim in shape from backend/scripts/qc/dayDump.mjs:92-118. The shared
// backend/prisma/dev.db is READ-ONLY to the fleet; prisma opens SQLite
// read-write and enables WAL, so "we only read" is not a property the
// filesystem enforces — a copy is.
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
function prepareDb(agentId) {
  if (!/^[A-Za-z0-9_-]+$/.test(agentId)) throw new Error(`bad agent id ${JSON.stringify(agentId)}`);
  if (!fs.existsSync(SHARED_DB)) throw new Error(`shared DB not found at ${SHARED_DB}`);
  const dir = path.resolve(REPO, "fleet/scratch", agentId);
  const dbPath = path.resolve(dir, "dev.db");
  if (norm(dbPath) === norm(SHARED_DB)) throw new Error("refusing — resolved to the SHARED dev.db");
  fs.mkdirSync(dir, { recursive: true });
  if (argv.freshdb || !fs.existsSync(dbPath)) {
    fs.copyFileSync(SHARED_DB, dbPath);
    for (const ext of ["-wal", "-shm"]) {
      const src = SHARED_DB + ext;
      if (fs.existsSync(src)) fs.copyFileSync(src, dbPath + ext);
      else if (fs.existsSync(dbPath + ext)) fs.rmSync(dbPath + ext);
    }
  }
  process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, "/")}`;
  return { dbPath, sourceSha256: sha256(SHARED_DB), copySha256: sha256(dbPath) };
}
const DB = prepareDb(AGENT);
if (norm(String(process.env.DATABASE_URL).slice(5)) === norm(SHARED_DB)) throw new Error("DATABASE_URL points at the SHARED dev.db — refusing");

const require_ = createRequire(import.meta.url);
const B = path.resolve(REPO, "backend");
const gate = require_(path.join(B, "src/lib/exclusionGate.js"));
const df = require_(path.join(B, "src/lib/dietaryFilter.js"));
const tax = require_(path.join(B, "src/lib/allergenTaxonomy.js"));
const planCtx = require_(path.join(B, "src/lib/planContext.js"));
const { prisma } = require_(path.join(B, "src/lib/prisma.js"));

const { CATEGORY_SYNONYMS, WORD_GUARDS, matchesExclusionTerm, foodMatchesExclusionTerm,
  expandCompoundTokens, applyDietaryFilters, resolveExclusionTerm, exclusionEvidence } = df;

// The ten foods planContext.loadAdjusters() can inject straight into a day.
// Mirrored from planContext.js:167-178 via dayDump.mjs:212-217 — an adjuster
// leak lands the food on the plate with no recipe in between, so membership
// here is a REACHABILITY tier of its own.
const ADJUSTER_CANDIDATES = [
  "Olive Oil", "Butter", "Avocado", "White rice, cooked", "Potatoes", "Oats",
  "Chicken breast, cooked, skinless", "Greek Yogurt", "Tofu", "Lentils",
];

// ════════════════════════════════════════════════════════════════════════════
// ORACLE E — THE HOSTILE VOCABULARY
// ════════════════════════════════════════════════════════════════════════════
// Curated by the author against culinary fact, NOT copied from the app's own
// lists — a table derived from dietaryFilter's vocabulary could only ever
// re-state it. Each row declares:
//
//   cat       the exclusion term a user would have set
//   re        the food-name pattern that carries it
//   basis     WHY that name implies that allergen
//   strength  "certain"  — the named thing IS the allergen, by definition
//             "standard" — standard commercial/traditional formulation. This is
//                          the SAME bar the repo already committed to for
//                          kimchi (jeotgal), pho (nuoc mam), worcestershire
//                          (anchovy) and ranch dressing (buttermilk); it is
//                          named here so a reviewer can discount it if they
//                          disagree with the bar rather than with the sweep.
//   veto      optional — the name declares the allergen away. This mirrors the
//                        gate's own plantDeclaredDish()/WORD_GUARDS idiom and
//                        exists because the FIRST run of this sweep produced
//                        false positives of exactly the kind it is hunting:
//                        `\broti\b` fired on "Poulet Roti" (French *rôti*,
//                        roast) and claimed a gluten leak against 55 personas;
//                        `\bragu\b` fired on "Venetian Duck Ragu". Both are
//                        recorded in FINDINGS.md as retracted rather than
//                        deleted.
//
// Word-boundary patterns throughout, because H5 (commit b28bd17) is the
// standing lesson that a bare substring fires inside longer words.
//
// A free-from claim for the category is honoured globally (see FREE_FROM_FOR):
// "Pretzel chips, hard, gluten free" is not a gluten leak, and a sweep that
// called it one would be arguing with the gate's own licensed reduction.

// Another species / a plant identity is declared, so a species-ambiguous dish
// name is not evidence of THIS species.
const OTHER_PROTEIN_DECLARED = /\b(?:lentils?|mushrooms?|vegan|vegetarian|veggie|meatless|plant[\s-]?based|duck|chicken|turkey|poultry|pork|lamb|mutton|goat|fish|salmon|tuna|tofu|soy|bean|beans|chickpea)\b/i;

const HOSTILE = [
  // ── DAIRY ────────────────────────────────────────────────────────────────
  { cat: "dairy", re: /\bghee\b/i, basis: "clarified butter — milk fat; retains trace casein", strength: "certain" },
  { cat: "dairy", re: /\bpaneer\b/i, basis: "fresh acid-set cow's-milk cheese", strength: "certain" },
  { cat: "dairy", re: /\bhalloum/i, basis: "brined sheep/goat/cow cheese", strength: "certain" },
  { cat: "dairy", re: /\bmascarpone\b/i, basis: "cream cheese", strength: "certain" },
  { cat: "dairy", re: /\bricotta\b/i, basis: "whey cheese", strength: "certain" },
  { cat: "dairy", re: /\bquark\b/i, basis: "fresh curd cheese", strength: "certain" },
  { cat: "dairy", re: /\bkefir\b/i, basis: "fermented milk", strength: "certain" },
  { cat: "dairy", re: /\bskyr\b/i, basis: "Icelandic strained milk product", strength: "certain" },
  { cat: "dairy", re: /\blabneh\b/i, basis: "strained yogurt", strength: "certain" },
  { cat: "dairy", re: /\bcreme\s*fraiche\b|\bcrème\s*fraîche\b/i, basis: "cultured cream", strength: "certain" },
  { cat: "dairy", re: /\bbuttermilk\b/i, basis: "milk product; the glued spelling defeats a \\bbutter\\b boundary", strength: "certain" },
  { cat: "dairy", re: /\bmilkshake\b/i, basis: "milk drink; glued spelling defeats a \\bmilk\\b boundary", strength: "certain" },
  { cat: "dairy", re: /\bstroganoff\b/i, basis: "sour-cream sauce is the defining component", strength: "standard" },
  { cat: "dairy", re: /\bcarbonara\b/i, basis: "pecorino/parmesan (and egg) are definitional", strength: "certain" },
  { cat: "dairy", re: /\bdulce de leche\b/i, basis: "caramelised milk", strength: "certain" },
  { cat: "dairy", re: /\bgelato\b/i, basis: "milk-based frozen dessert", strength: "standard" },
  { cat: "dairy", re: /\bqueso\b/i, basis: "Spanish for cheese", strength: "certain" },
  { cat: "dairy", re: /\bkulfi\b|\brasmalai\b|\bgulab jamun\b|\bkhoa\b|\bbarfi\b|\bburfi\b/i, basis: "South Asian milk-solid (khoa) sweets", strength: "certain" },
  { cat: "dairy", re: /\blassi\b/i, basis: "yogurt drink", strength: "certain" },
  { cat: "dairy", re: /\bbechamel\b|\bbéchamel\b|\bmornay\b/i, basis: "milk/butter mother sauce", strength: "certain" },
  { cat: "dairy", re: /\bbutterscotch\b/i, basis: "butter + sugar; commercial chips carry milk solids", strength: "standard" },
  { cat: "dairy", re: /\bhalf and half\b|\bhalf-and-half\b/i, basis: "milk/cream blend", strength: "certain" },
  // RETRACTED as authored (/\bcurds?\b/): all 5 hits were "Soybean curd" rows
  // that WORD_GUARDS.curd correctly exempts. Narrowed to the unambiguous form.
  { cat: "dairy", re: /\bcheese curds?\b/i, basis: "cheese curd is milk", strength: "certain" },

  // ── EGGS ─────────────────────────────────────────────────────────────────
  { cat: "eggs", re: /\bomelet(?:te)?s?\b/i, basis: "an omelette is eggs", strength: "certain" },
  { cat: "eggs", re: /\bfrittata\b/i, basis: "baked egg dish", strength: "certain" },
  { cat: "eggs", re: /\bquiche\b/i, basis: "egg custard tart", strength: "certain" },
  { cat: "eggs", re: /\bmeringue\b/i, basis: "whipped egg white", strength: "certain" },
  { cat: "eggs", re: /\bcarbonara\b/i, basis: "raw-egg emulsion sauce", strength: "certain" },
  { cat: "eggs", re: /\bhollandaise\b|\bbearnaise\b|\bbéarnaise\b/i, basis: "egg-yolk emulsion mother sauce", strength: "certain" },
  { cat: "eggs", re: /\bavgolemono\b/i, basis: "egg-lemon sauce/soup", strength: "certain" },
  { cat: "eggs", re: /\bshakshuka\b/i, basis: "eggs poached in sauce — the dish is the eggs", strength: "certain" },
  { cat: "eggs", re: /\bdevil(?:l)?ed\b/i, basis: "'devilled' in this corpus is devilled EGGS", strength: "standard" },
  { cat: "eggs", re: /\bcustard\b|\bcreme anglaise\b|\bcrème anglaise\b|\bsabayon\b/i, basis: "egg-thickened custard", strength: "certain" },
  { cat: "eggs", re: /\bfrench toast\b/i, basis: "bread soaked in beaten egg", strength: "certain" },
  { cat: "eggs", re: /\bcaesar\b/i, veto: /\bno dressing\b/i, basis: "Caesar dressing is a raw-egg emulsion (and anchovy)", strength: "standard" },
  { cat: "eggs", re: /\bchallah\b/i, basis: "enriched egg bread", strength: "certain" },
  { cat: "eggs", re: /\bmacaron(?:s)?\b/i, basis: "meringue-based (egg white + almond)", strength: "certain" },
  { cat: "eggs", re: /\bsponge cake\b|\bgenoise\b|\bgénoise\b/i, basis: "whole-egg foam cake", strength: "certain" },
  { cat: "eggs", re: /\beggnog\b/i, basis: "egg drink; glued spelling", strength: "certain" },
  // Found by ORACLE B first: the vegan style filter already treats wonton as an
  // egg carrier (wonton wrappers are wheat + egg). The egg ALLERGY does not.
  { cat: "eggs", re: /\bwonton\b|\bwon ton\b/i, basis: "wonton wrappers are wheat + egg — the gate's own vegan vocabulary says so", strength: "certain" },

  // ── GLUTEN ───────────────────────────────────────────────────────────────
  { cat: "gluten", re: /\bcous\s?cous\b/i, basis: "durum wheat semolina", strength: "certain" },
  { cat: "gluten", re: /\borzo\b/i, basis: "wheat pasta", strength: "certain" },
  { cat: "gluten", re: /\bpanko\b/i, basis: "wheat breadcrumb", strength: "certain" },
  { cat: "gluten", re: /\bph?yllo\b|\bfilo\b/i, basis: "wheat pastry", strength: "certain" },
  { cat: "gluten", re: /\bpuff pastry\b|\bshortcrust\b/i, basis: "wheat pastry", strength: "certain" },
  { cat: "gluten", re: /\bcroissant\b|\bcrumpet\b|\bscone\b|\bpretzel\b/i, basis: "wheat bakery", strength: "certain" },
  { cat: "gluten", re: /\budon\b|\bramen\b|\bwonton\b|\bgyoza\b/i, basis: "wheat noodle/wrapper", strength: "certain" },
  // Bare \broti\b was TRIED AND RETRACTED — it is French "rôti" (roast) in the
  // real recipe "Poulet Roti a l'Algerienne", and claimed a gluten leak against
  // 55 of the 94 gluten-excluded personas. The retraction is the finding.
  { cat: "gluten", re: /\bnaan\b|\bparatha\b|\bchapati\b|\bpita\b/i, basis: "wheat flatbread", strength: "certain" },
  { cat: "gluten", re: /\bmatzo\b|\bmatzah\b|\bmatzoh\b/i, basis: "wheat unleavened bread", strength: "certain" },
  { cat: "gluten", re: /\bsemolina\b|\bvermicelli\b|\bspaetzle\b|\bspätzle\b/i, basis: "wheat", strength: "certain" },
  { cat: "gluten", re: /\btabbouleh\b|\btabouli\b/i, basis: "bulgur wheat salad", strength: "certain" },
  { cat: "gluten", re: /\bsoy sauce\b|\bteriyaki\b|\bhoisin\b/i, basis: "brewed on wheat unless labelled tamari", strength: "standard" },
  { cat: "gluten", re: /\bseitan\b/i, basis: "vital wheat gluten — the allergen itself", strength: "certain" },
  { cat: "gluten", re: /\bcrouton\b/i, basis: "toasted bread", strength: "certain" },
  { cat: "gluten", re: /\bgraham\b/i, basis: "graham flour is wheat", strength: "certain" },
  { cat: "gluten", re: /\bbrownie\b|\bshortbread\b|\bdanish pastry\b/i, basis: "wheat bakery", strength: "certain" },
  { cat: "gluten", re: /\bgnocchi\b/i, basis: "potato dumpling bound with wheat flour", strength: "standard" },
  { cat: "gluten", re: /\bfarro\b|\bbulgur\b|\btriticale\b|\bspelt\b/i, basis: "wheat species", strength: "certain" },

  // ── SESAME ───────────────────────────────────────────────────────────────
  { cat: "sesame", re: /\bhumm?ou?s\b/i, basis: "tahini is definitional in hummus", strength: "certain" },
  { cat: "sesame", re: /\bhalvah?\b/i, basis: "sesame-paste confection", strength: "certain" },
  { cat: "sesame", re: /\bbaba\s*gh?anou?(?:sh|j)\b/i, basis: "tahini is definitional", strength: "certain" },
  { cat: "sesame", re: /\bfurikake\b|\bgomashio\b|\bgomasio\b/i, basis: "sesame seasoning", strength: "certain" },
  { cat: "sesame", re: /\bfalafel\b/i, basis: "served with/bound by tahini; sesame in most commercial mixes", strength: "standard" },
  { cat: "sesame", re: /\beverything bagel\b/i, basis: "sesame is in the seed blend", strength: "certain" },

  // ── PEANUTS ──────────────────────────────────────────────────────────────
  { cat: "peanuts", re: /\bsatay\b|\bsate\b/i, basis: "peanut sauce is definitional", strength: "standard" },
  { cat: "peanuts", re: /\bgado[\s-]?gado\b/i, basis: "peanut-sauce salad", strength: "certain" },
  { cat: "peanuts", re: /\bgoober\b/i, basis: "regional name for peanut", strength: "certain" },
  { cat: "peanuts", re: /\bnutter butter\b/i, basis: "peanut butter cookie", strength: "certain" },

  // ── TREE NUTS ────────────────────────────────────────────────────────────
  { cat: "tree nuts", re: /\bmacaron(?:s)?\b/i, basis: "almond flour is definitional", strength: "certain" },
  { cat: "tree nuts", re: /\bromesco\b/i, basis: "almond/hazelnut thickened sauce", strength: "certain" },
  { cat: "tree nuts", re: /\bdukkah\b/i, basis: "nut-and-seed blend", strength: "certain" },
  { cat: "tree nuts", re: /\bturron\b|\bturrón\b/i, basis: "almond nougat", strength: "certain" },
  { cat: "tree nuts", re: /\bfinancier\b|\bfrangipane\b/i, basis: "almond flour pastry", strength: "certain" },
  { cat: "tree nuts", re: /\blinzer\b/i, basis: "hazelnut/almond torte", strength: "certain" },
  { cat: "tree nuts", re: /\bwaldorf\b/i, basis: "walnut is definitional", strength: "certain" },
  { cat: "tree nuts", re: /\bamandine\b|\balmondine\b/i, basis: "almond preparation", strength: "certain" },

  // ── SOY ──────────────────────────────────────────────────────────────────
  { cat: "soy", re: /\bnatto\b/i, basis: "fermented soybeans", strength: "certain" },
  // The sibling of the gate's own `meatless` WORD_GUARD. That guard fires only
  // on the literal word "meatless" + a MEAT_ANALOGUE_NOUN; FNDDS spells the
  // same product "vegetarian" and "veggie" too, and those spellings reach a
  // soy-allergic user.
  { cat: "soy", re: /\b(?:vegetarian|veggie|plant[\s-]?based)\b[^.]{0,26}\b(?:burgers?|hot ?dogs?|frankfurters?|sausages?|patt(?:y|ies)|nuggets?|crumbles?|strips?)\b|\b(?:burgers?|hot ?dogs?|frankfurters?|sausages?|patt(?:y|ies)|nuggets?)\b[^.]{0,26}\b(?:vegetarian|veggie|plant[\s-]?based)\b/i, basis: "commercial meat analogues are textured soy protein", strength: "standard" },
  { cat: "soy", re: /\btextured vegetable protein\b|\btvp\b/i, basis: "soy protein by definition", strength: "certain" },

  // ── FISH ─────────────────────────────────────────────────────────────────
  { cat: "fish", re: /\bsurimi\b/i, basis: "surimi is minced white fish", strength: "certain" },
  { cat: "fish", re: /\bimitation crab\b|\bcrab stick\b|\bkrab\b/i, basis: "surimi = fish", strength: "certain" },
  { cat: "fish", re: /\bdashi\b/i, basis: "katsuobushi (bonito) stock", strength: "standard" },
  { cat: "fish", re: /\bbonito\b|\bkatsuobushi\b/i, basis: "a fish", strength: "certain" },
  { cat: "fish", re: /\bcaviar\b|\bbottarga\b|\btaramasalata\b|\bikura\b|\btobiko\b/i, basis: "fish roe", strength: "certain" },
  { cat: "fish", re: /\bceviche\b|\bsashimi\b|\bpoke bowl\b|\bnigiri\b/i, basis: "raw fish dishes", strength: "standard" },
  { cat: "fish", re: /\bputtanesca\b/i, basis: "anchovy is definitional", strength: "standard" },
  { cat: "fish", re: /\bcaesar\b/i, veto: /\bno dressing\b/i, basis: "anchovy is definitional in Caesar dressing", strength: "standard" },
  { cat: "fish", re: /\bworcestershire\b/i, basis: "anchovy", strength: "certain" },
  { cat: "fish", re: /\bbagna cauda\b|\bbrandade\b|\bescabeche\b/i, basis: "anchovy / salt cod dishes", strength: "certain" },
  { cat: "fish", re: /\bkipper\b|\bwhitebait\b|\brollmops\b|\belver\b/i, basis: "fish", strength: "certain" },

  // ── SHELLFISH ────────────────────────────────────────────────────────────
  { cat: "shellfish", re: /\bcalamari\b/i, basis: "squid — a mollusc", strength: "certain" },
  { cat: "shellfish", re: /\bimitation crab\b|\bcrab stick\b|\bkrab\b/i, basis: "crab extract/flavour is standard in surimi sticks", strength: "standard" },
  { cat: "shellfish", re: /\bcioppino\b|\bgumbo\b|\bjambalaya\b|\betouff?ee\b|\bétouffée\b/i, veto: /\b(?:chicken|beef|pork|turkey|meat|sausage)\b/i, basis: "crustacean-bearing stews by standard formulation", strength: "standard" },
  { cat: "shellfish", re: /\bxo sauce\b/i, basis: "dried scallop + dried shrimp", strength: "certain" },
  { cat: "shellfish", re: /\bbelacan\b|\bterasi\b|\bbagoong\b/i, basis: "shrimp paste", strength: "certain" },
  { cat: "shellfish", re: /\bsurf and turf\b/i, basis: "the 'surf' is lobster/prawn", strength: "standard" },

  // ── CORN ─────────────────────────────────────────────────────────────────
  { cat: "corn", re: /\btamale?s?\b/i, basis: "masa (corn) dough", strength: "certain" },
  { cat: "corn", re: /\barepa\b/i, basis: "masarepa (corn) cake", strength: "certain" },
  { cat: "corn", re: /\bpupusa\b/i, basis: "masa cake", strength: "certain" },
  { cat: "corn", re: /\bsuccotash\b/i, basis: "corn + lima beans, definitional", strength: "certain" },
  { cat: "corn", re: /\bhush\s?pupp/i, basis: "cornmeal fritter", strength: "certain" },
  { cat: "corn", re: /\belote\b|\besquites\b/i, basis: "street corn", strength: "certain" },
  { cat: "corn", re: /\bjohnny\s?cake\b/i, basis: "cornmeal cake", strength: "certain" },

  // ── NIGHTSHADES ──────────────────────────────────────────────────────────
  { cat: "nightshades", re: /\bsriracha\b|\bsiracha\b/i, basis: "chilli sauce — Capsicum", strength: "certain" },
  { cat: "nightshades", re: /\bgochujang\b|\bgochugaru\b/i, basis: "Korean chilli paste/flake", strength: "certain" },
  { cat: "nightshades", re: /\bharissa\b/i, basis: "chilli paste", strength: "certain" },
  { cat: "nightshades", re: /\btabasco\b|\bpiri[\s-]?piri\b|\bpery[\s-]?peri\b/i, basis: "chilli sauces", strength: "certain" },
  { cat: "nightshades", re: /\bpassata\b|\bpomodoro\b|\bnapoletana\b|\bnapolitana\b/i, basis: "tomato sauce", strength: "certain" },
  { cat: "nightshades", re: /\bputtanesca\b|\bvodka sauce\b|\barrabbiata\b/i, basis: "tomato/chilli sauce", strength: "certain" },
  { cat: "nightshades", re: /\bsofrito\b|\bmole\b/i, basis: "pepper/tomato and chilli bases", strength: "standard" },
  { cat: "nightshades", re: /\bratatouille\b|\bcaponata\b|\bmoussaka\b|\bgazpacho\b/i, basis: "aubergine/tomato/pepper dishes", strength: "certain" },
  { cat: "nightshades", re: /\bshakshuka\b/i, basis: "tomato + pepper base", strength: "certain" },
  { cat: "nightshades", re: /\bpaprika\b|\bpimenton\b|\bpimentón\b/i, basis: "ground Capsicum", strength: "certain" },

  // ── ALLIUMS ──────────────────────────────────────────────────────────────
  { cat: "alliums", re: /\baioli\b|\ballioli\b/i, basis: "garlic emulsion — garlic is definitional", strength: "certain" },
  { cat: "alliums", re: /\bmirepoix\b|\bsofrito\b/i, basis: "onion is a definitional component", strength: "certain" },
  { cat: "alliums", re: /\bchimichurri\b|\bgremolata\b|\bpersillade\b/i, basis: "garlic is definitional", strength: "certain" },
  { cat: "alliums", re: /\btzatziki\b/i, basis: "garlic is definitional", strength: "standard" },

  // ── LEGUMES ──────────────────────────────────────────────────────────────
  { cat: "legumes", re: /\bfalafel\b/i, basis: "chickpea/fava fritter", strength: "certain" },
  { cat: "legumes", re: /\bbesan\b|\bgram flour\b/i, basis: "chickpea flour", strength: "certain" },
  { cat: "legumes", re: /\bpapadu?m\b|\bpappadam\b/i, basis: "lentil/gram flour wafer", strength: "certain" },
  { cat: "legumes", re: /\bsocca\b|\bfarinata\b/i, basis: "chickpea pancake", strength: "certain" },
  { cat: "legumes", re: /\bchana\b|\brajma\b/i, basis: "chickpea / kidney bean", strength: "certain" },
  { cat: "legumes", re: /\bsuccotash\b/i, basis: "lima beans", strength: "certain" },
  { cat: "legumes", re: /\bcassoulet\b|\bminestrone\b/i, basis: "bean-based by definition", strength: "standard" },

  // ── PORK ─────────────────────────────────────────────────────────────────
  { cat: "pork", re: /\bcarnitas\b/i, basis: "braised pork", strength: "certain" },
  { cat: "pork", re: /\bal pastor\b/i, basis: "spit-roast pork", strength: "certain" },
  { cat: "pork", re: /\bporchetta\b/i, basis: "pork roast", strength: "certain" },
  { cat: "pork", re: /\bnduja\b|\b'nduja\b/i, basis: "spreadable pork salume", strength: "certain" },
  { cat: "pork", re: /\bsoppressata\b|\bcotechino\b|\bmortadella\b/i, basis: "pork salumi", strength: "certain" },
  { cat: "pork", re: /\bscrapple\b/i, basis: "pork offal loaf", strength: "certain" },
  { cat: "pork", re: /\bspam\b/i, basis: "canned pork shoulder", strength: "certain" },
  { cat: "pork", re: /\bchar\s?siu\b/i, basis: "barbecued pork", strength: "certain" },
  { cat: "pork", re: /\brillettes?\b|\blardons?\b|\bpanceta\b/i, basis: "pork preparations", strength: "certain" },
  { cat: "pork", re: /\bhot ?dogs?\b|\bfrankfurters?\b|\bwiener\b/i, veto: /\b(?:beef|turkey|chicken|poultry|meatless|vegetarian|veggie)\b|^\s*(?:rolls?|pickle relish)\b/i, basis: "pork or a pork/beef mix unless the label declares the species; the BUN and relish rows are vetoed", strength: "standard" },

  // ── BEEF ─────────────────────────────────────────────────────────────────
  // Every beef rule carries OTHER_PROTEIN_DECLARED. Without it the ragù rule
  // RETRACTED-fired on "Venetian Duck Ragu" and "Lentil Bolognese with Pasta",
  // which between them accounted for 26 of the first run's 142 persona hits.
  { cat: "beef", re: /\bbolognese\b|\bragu\b|\bragù\b/i, veto: OTHER_PROTEIN_DECLARED, basis: "beef-mince ragù", strength: "standard" },
  { cat: "beef", re: /\bstroganoff\b/i, veto: OTHER_PROTEIN_DECLARED, basis: "beef strips are definitional", strength: "standard" },
  { cat: "beef", re: /\bcarne asada\b|\bbarbacoa\b|\bpicadillo\b/i, veto: OTHER_PROTEIN_DECLARED, basis: "beef preparations", strength: "standard" },
  { cat: "beef", re: /\bgoulash\b|\brendang\b/i, veto: OTHER_PROTEIN_DECLARED, basis: "beef stews", strength: "standard" },
  { cat: "beef", re: /\bsalisbury\b|\bmeatloaf\b/i, veto: OTHER_PROTEIN_DECLARED, basis: "ground-beef dishes", strength: "standard" },
  { cat: "beef", re: /\bgyro\b|\bcarpaccio\b/i, veto: OTHER_PROTEIN_DECLARED, basis: "beef (or beef/lamb) preparations", strength: "standard" },
  { cat: "beef", re: /\bcottage pie\b/i, veto: OTHER_PROTEIN_DECLARED, basis: "beef mince (shepherd's pie is the lamb one)", strength: "certain" },

  // ── MSG ──────────────────────────────────────────────────────────────────
  { cat: "msg", re: /\bmarmite\b|\bvegemite\b/i, basis: "yeast extract — free glutamate", strength: "certain" },
  { cat: "msg", re: /\bbouillon\b|\bstock cube\b/i, basis: "commercial bouillon carries MSG or yeast extract", strength: "standard" },

  // ── CELERY ───────────────────────────────────────────────────────────────
  { cat: "celery", re: /\bmirepoix\b/i, basis: "celery is one of the three", strength: "certain" },
  { cat: "celery", re: /\bwaldorf\b/i, basis: "celery is definitional", strength: "certain" },
  { cat: "celery", re: /\bbloody mary\b/i, basis: "celery salt/stick is standard", strength: "standard" },

  // ── MUSTARD ──────────────────────────────────────────────────────────────
  { cat: "mustard", re: /\bremoulade\b|\brémoulade\b/i, basis: "mustard is definitional", strength: "certain" },
  { cat: "mustard", re: /\bdevil(?:l)?ed\b/i, basis: "'devilled' means mustard-spiced", strength: "standard" },
  { cat: "mustard", re: /\bvinaigrette\b/i, basis: "Dijon is the standard emulsifier", strength: "standard" },

  // ── CILANTRO ─────────────────────────────────────────────────────────────
  { cat: "cilantro", re: /\bpico de gallo\b/i, basis: "cilantro is definitional", strength: "certain" },
  { cat: "cilantro", re: /\bguacamole\b/i, basis: "cilantro is standard", strength: "standard" },
];

// ── the default keyword rule, mirrored ──────────────────────────────────────
// dietaryFilter.js:801-803 `matchesTermList` is not exported. This is a
// character-for-character mirror of it (:757-799): a multi-word term is a plain
// case-insensitive substring; a single-word term is \bWORD(?:es|s)?\b. Probe A
// asserts the mirror against the module's own observable behaviour on every
// UNGUARDED keyword and reports any disagreement as an instrument fault, so it
// cannot silently drift.
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mirrorCache = new Map();
function defaultRule(name, term) {
  if (term.includes(" ")) return name.toLowerCase().includes(term.toLowerCase());
  let re = mirrorCache.get(term);
  if (re === undefined) { re = new RegExp("\\b" + escapeRe(term) + "(?:es|s)?\\b", "i"); mirrorCache.set(term, re); }
  return re.test(name);
}

// The free-from claim shapes CATEGORY_ABSENCE_DECLARED can honour
// (dietaryFilter.js). Used to ATTRIBUTE a suppression in probe A, and to
// suppress a hostile-vocabulary hit in probe E — a product whose own name
// carries a regulated free-from claim for the category is NOT a leak, and a
// sweep that called it one would be arguing with the gate's licensed reduction.
const FREE_FROM_CLAIM = /\b(?:gluten|wheat|dairy|milk|soya?|eggs?|tree[\s-]?nut|nut|peanut|fish|shellfish|seafood|sesame)[\s-]?free\b/i;
const FREE_FROM_FOR = {
  gluten: /\b(?:gluten|wheat)[\s-]?free\b/i,
  dairy: /\b(?:dairy|milk)[\s-]?free\b/i,
  eggs: /\beggs?[\s-]?free\b/i,
  soy: /\bsoya?[\s-]?free\b/i,
  peanuts: /\bpeanut[\s-]?free\b/i,
  "tree nuts": /\b(?:tree[\s-]?nut|nut)[\s-]?free\b/i,
  fish: /\bfish[\s-]?free\b/i,
  shellfish: /\bshellfish[\s-]?free\b/i,
  sesame: /\bsesame[\s-]?free\b/i,
};
// A hostile rule "fires" on a string when its pattern matches, its own veto
// does not, and the string carries no free-from claim for that category.
function hostileFires(h, s) {
  if (!h.re.test(s)) return false;
  if (h.veto && h.veto.test(s)) return false;
  const ff = FREE_FROM_FOR[h.cat];
  return !(ff && ff.test(s));
}

const rel = (p) => path.relative(REPO, p).replace(/\\/g, "/");
function writeArtifact(name, data) {
  const p = path.resolve(OUTDIR, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
  return rel(p);
}

function gitInfo() {
  const run = (args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim(); } catch { return null; } };
  const status = run(["status", "--porcelain"]) || "";
  return {
    sha: run(["rev-parse", "HEAD"]), branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    porcelainEntries: status ? status.split("\n").length : 0,
  };
}

async function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUTDIR, { recursive: true });

  const foods = await prisma.food.findMany({ select: gate.FOOD_GATE_SELECT });
  const recipes = await prisma.recipe.findMany({ include: { ingredients: { include: { food: true } } } });

  // ── ground rule #1: no network, trapped after prisma is warm ──────────────
  let netCalls = 0;
  const trap = (label) => () => { netCalls++; throw new Error(`leakSweep attempted a ${label} call — ground rule #1 violated`); };
  https.request = trap("https.request"); https.get = trap("https.get");
  http.request = trap("http.request"); http.get = trap("http.get");
  if (globalThis.fetch) globalThis.fetch = trap("fetch");
  if (process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;

  const git = gitInfo();
  const personas = fs.readFileSync(PERSONAS_PATH, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  // ── REACHABILITY INDEX ────────────────────────────────────────────────────
  // The ranking axis. T-1 and T-3 were separated into P0 and P1-latent by
  // exactly this: is the row referenced by a real recipe, or is it inert?
  const recipesByFoodId = new Map();
  for (const r of recipes) {
    for (const ing of r.ingredients || []) {
      if (!ing.foodId) continue;
      if (!recipesByFoodId.has(ing.foodId)) recipesByFoodId.set(ing.foodId, []);
      recipesByFoodId.get(ing.foodId).push(r);
    }
  }
  const adjusterSet = new Set(ADJUSTER_CANDIDATES.map((n) => n.trim().toLowerCase()));
  const reach = (f) => ({
    recipeRefs: (recipesByFoodId.get(f.id) || []).length,
    isAdjuster: adjusterSet.has(String(f.name || "").trim().toLowerCase()),
  });

  // Metadata coverage — T-1's finding, re-measured here because it decides how
  // many of the gate's four probes are actually live in this corpus.
  const meta = {
    foods: foods.length,
    withAllergenTags: foods.filter((f) => f.allergenTags != null && String(f.allergenTags).length > 2).length,
    withMayContain: foods.filter((f) => f.mayContain != null && String(f.mayContain).length > 2).length,
    withFdcCategory: foods.filter((f) => typeof f.fdcCategory === "string" && f.fdcCategory.trim()).length,
    fdcCategoriesThatAreEvidence: Object.keys(df.FDC_CATEGORY_FAMILIES),
  };
  meta.foodsWithEvidenceBearingFdcCategory = foods.filter((f) =>
    typeof f.fdcCategory === "string" && df.FDC_CATEGORY_FAMILIES[f.fdcCategory.trim().toLowerCase()]).length;

  const CATS = Object.keys(CATEGORY_SYNONYMS);
  const findings = [];
  const push = (o) => { findings.push(o); return o; };

  // ══════════════════════════════════════════════════════════════════════════
  // PROBE A — SUPPRESSION ENUMERATION  (oracle A; no external vocabulary)
  // ══════════════════════════════════════════════════════════════════════════
  // For every (category, keyword, food name): the gate's OWN default rule says
  // this name carries this keyword. Does the gate still exclude it? If not,
  // something turned the match off — a WORD_GUARD, or a free-from veto. Every
  // such row is enumerated and attributed. Complete over the corpus.
  const suppressions = [];
  let mirrorFaults = 0;
  let keywordChecks = 0;
  const names = foods.map((f) => ({ kind: "food", id: f.id, name: f.name, row: f }));
  for (const r of recipes) names.push({ kind: "recipe", id: r.id, name: r.name, row: r });

  for (const cat of CATS) {
    const kws = CATEGORY_SYNONYMS[cat] || [];
    for (const item of names) {
      const raw = String(item.name || "");
      const expanded = expandCompoundTokens(raw);
      const final = matchesExclusionTerm(raw, cat);
      for (const w of kws) {
        keywordChecks++;
        if (!defaultRule(expanded, w)) continue;
        if (final) continue;                       // some keyword still fired — not suppressed
        const guard = WORD_GUARDS[w];
        const guardVetoed = !!guard && !guard(expanded);
        const claim = raw.match(FREE_FROM_CLAIM);
        let attribution;
        if (guardVetoed) attribution = `word-guard:${w}`;
        else if (claim) attribution = `free-from-veto:${claim[0]}`;
        else { attribution = "UNATTRIBUTED — mirror fault or unknown path"; mirrorFaults++; }
        suppressions.push({
          kind: item.kind, id: item.id, name: raw, category: cat, keyword: w, attribution,
          ...(item.kind === "food" ? reach(item.row) : { recipeRefs: null, isAdjuster: false }),
        });
      }
    }
  }
  const suppByAttribution = {};
  for (const s of suppressions) (suppByAttribution[s.attribution] ||= []).push(s);

  // ══════════════════════════════════════════════════════════════════════════
  // PROBE B — STYLE ↔ ALLERGY DISAGREEMENT  (oracle B; no external vocabulary)
  // ══════════════════════════════════════════════════════════════════════════
  // vegan-excluded AND vegetarian-allowed  ⇒  the style filter says "dairy or
  // egg". If neither the dairy nor the egg allergy filter agrees, the two
  // vocabularies disagree about the same food.
  const styleAllergyDisagreements = [];
  for (const f of foods) {
    const vegan = applyDietaryFilters([f], { dietaryStyle: "vegan" }).length === 0;
    const vegetarian = applyDietaryFilters([f], { dietaryStyle: "vegetarian" }).length === 0;
    if (!vegan || vegetarian) continue;
    const dairy = foodMatchesExclusionTerm(f, "dairy");
    const eggs = foodMatchesExclusionTerm(f, "eggs");
    if (dairy || eggs) continue;
    styleAllergyDisagreements.push({ id: f.id, name: f.name, fdcCategory: f.fdcCategory, ...reach(f) });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROBE C — TERM-RESOLUTION PARITY  (oracle C; the taxonomy is ground truth)
  // ══════════════════════════════════════════════════════════════════════════
  // Every key / label / synonym the taxonomy publishes must resolve to its own
  // category. `kind:"literal"` = the term degrades to a substring grep.
  const unresolvedTerms = [];
  for (const e of tax.ALLERGEN_TAXONOMY) {
    const want = tax.categoryKeyOf(e);
    for (const term of [e.key, e.label, ...(e.synonyms || [])]) {
      const r = resolveExclusionTerm(term);
      if (r.kind === "literal") unresolvedTerms.push({ term, taxonomyRow: e.key, expectedCategory: want, kind: r.kind, resolvedTo: null, tier: e.tier });
      else if (r.synonymKey !== want) unresolvedTerms.push({ term, taxonomyRow: e.key, expectedCategory: want, kind: r.kind, resolvedTo: r.synonymKey, tier: e.tier });
    }
  }
  // …and the terms REAL customers typed.
  const personaTerms = [...new Set(personas.flatMap((p) => p.profile.excludedFoods || []))];
  const personaTermResolution = personaTerms.map((t) => {
    const r = resolveExclusionTerm(t);
    return { term: t, kind: r.kind, synonymKey: r.synonymKey, normalisedKey: r.normalisedKey, users: personas.filter((p) => (p.profile.excludedFoods || []).includes(t)).length };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PROBE D — GATE-SURFACE PARITY  (oracle D; the gate is its own ground truth)
  // ══════════════════════════════════════════════════════════════════════════
  const parity = { isExcludedVsMatcher: [], eggSingularPlural: [], ingredientAdmittedByRecipe: [] };
  for (const f of foods) {
    for (const cat of CATS) {
      const viaGate = gate.isExcluded(f, { excludedFoods: [cat] });
      const viaMatcher = foodMatchesExclusionTerm(f, cat);
      if (viaGate !== viaMatcher) parity.isExcludedVsMatcher.push({ id: f.id, name: f.name, category: cat, viaGate, viaMatcher, ...reach(f) });
    }
    if (foodMatchesExclusionTerm(f, "egg") !== foodMatchesExclusionTerm(f, "eggs")) {
      parity.eggSingularPlural.push({ id: f.id, name: f.name, egg: foodMatchesExclusionTerm(f, "egg"), eggs: foodMatchesExclusionTerm(f, "eggs"), ...reach(f) });
    }
  }
  // TRANSITIVITY: a recipe carrying an excluded ingredient must itself be
  // excluded. If this ever fails the gate is leaking on its primary path.
  for (const r of recipes) {
    for (const cat of CATS) {
      const bad = (r.ingredients || []).find((ing) => ing.food && foodMatchesExclusionTerm(ing.food, cat));
      if (!bad) continue;
      if (!gate.isExcluded(r, { excludedFoods: [cat] })) {
        parity.ingredientAdmittedByRecipe.push({ recipeId: r.id, recipe: r.name, category: cat, ingredient: bad.food.name });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROBE E — HOSTILE VOCABULARY  (oracle E; author's judgement, declared)
  // ══════════════════════════════════════════════════════════════════════════
  // A leak = the hostile pattern matches the name, and the gate does not
  // exclude it for that category.
  // PER-RULE DENOMINATOR. A rule with ZERO corpus matches proves nothing — it
  // is INCONCLUSIVE, not clean — and a rule whose every match is already
  // excluded is positive evidence the gate covers that carrier. Both are
  // recorded so the arm check can be generated rather than asserted.
  const ruleStats = HOSTILE.map((h) => ({
    cat: h.cat, pattern: String(h.re), veto: h.veto ? String(h.veto) : null,
    basis: h.basis, strength: h.strength,
    foodNamesMatching: 0, foodNamesFiring: 0, foodLeaks: 0,
    recipeNamesMatching: 0, recipeLeaks: 0,
  }));

  const foodLeaks = [];
  for (let i = 0; i < HOSTILE.length; i++) {
    const h = HOSTILE[i]; const st = ruleStats[i];
    for (const f of foods) {
      if (h.re.test(f.name)) st.foodNamesMatching++;
      if (!hostileFires(h, f.name)) continue;
      st.foodNamesFiring++;
      if (foodMatchesExclusionTerm(f, h.cat)) continue;
      st.foodLeaks++;
      const rc = reach(f);
      // Which recipes SHIP this food to a user who excluded h.cat?
      const shipping = (recipesByFoodId.get(f.id) || [])
        .filter((r) => !gate.isExcluded(r, { excludedFoods: [h.cat] }))
        .map((r) => r.name);
      foodLeaks.push({
        target: "food", category: h.cat, pattern: String(h.re), basis: h.basis, strength: h.strength,
        id: f.id, name: f.name, fdcCategory: f.fdcCategory, ...rc,
        shippingRecipes: shipping.length, shippingRecipeNames: shipping.slice(0, 8),
      });
    }
  }
  const recipeLeaks = [];
  // A steps hit is vetoed against a WINDOW around the match, not the whole step
  // text: "duck" 400 characters away is not a declaration about this clause.
  // The DISH NAME is always in veto scope — "Venetian Duck Ragu" declares its
  // species in the title and mentions the duck 900 characters from the word
  // "ragu", so a window-only veto RETRACTED-fired it at 9 personas.
  const firesInSteps = (h, text, dishName = "") => {
    if (!h.re.test(text)) return false;
    const i = text.search(h.re);
    const window = text.slice(Math.max(0, i - 90), i + 120);
    if (h.veto && h.veto.test(dishName)) return false;
    return hostileFires(h, window);
  };
  for (let k = 0; k < HOSTILE.length; k++) {
    const h = HOSTILE[k]; const st = ruleStats[k];
    for (const r of recipes) {
      const stepText = Array.isArray(r.steps) ? r.steps.join("  ") : String(r.steps ?? "");
      const inName = hostileFires(h, r.name);
      const inSteps = firesInSteps(h, stepText, r.name);
      if (h.re.test(r.name) || h.re.test(stepText)) st.recipeNamesMatching++;
      if (!inName && !inSteps) continue;
      if (gate.isExcluded(r, { excludedFoods: [h.cat] })) continue;
      st.recipeLeaks++;
      recipeLeaks.push({
        target: "recipe", category: h.cat, pattern: String(h.re), basis: h.basis, strength: h.strength,
        id: r.id, name: r.name, matchedIn: inName ? (inSteps ? "name+steps" : "name") : "steps",
        // A `standard`-strength claim is about typical FORMULATION, and this
        // recipe's own ingredient list is the check on it. Carried on the row so
        // a reviewer can confirm or retract without re-querying — the sesame
        // claim on the "Falafel" recipe was retracted exactly this way.
        ingredientNames: (r.ingredients || []).map((i) => i.food?.name).filter(Boolean),
        excerpt: (inName ? r.name : stepText.slice(Math.max(0, stepText.search(h.re) - 60), stepText.search(h.re) + 90)).slice(0, 220),
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROBE F — THE 250 REAL PERSONAS, THROUGH THE REAL ROUTE NARROWING
  // ══════════════════════════════════════════════════════════════════════════
  // planContext.filterRecipePool is what routes/plans.js:214 calls. A recipe
  // that survives it and hits a hostile pattern for one of THAT customer's own
  // declared exclusions is a leak that shipped.
  const personaLeaks = [];
  for (const p of personas) {
    const dietProfile = { dietaryStyle: p.profile.dietaryStyle && p.profile.dietaryStyle !== "none" ? p.profile.dietaryStyle : null, excludedFoods: p.profile.excludedFoods || [] };
    const terms = new Set((p.profile.excludedFoods || []).map((t) => resolveExclusionTerm(t).synonymKey).filter(Boolean));
    if (!terms.size) continue;
    const pool = planCtx.filterRecipePool(recipes, dietProfile);
    for (const r of pool) {
      const stepText = Array.isArray(r.steps) ? r.steps.join("  ") : String(r.steps ?? "");
      for (const h of HOSTILE) {
        if (!terms.has(h.cat)) continue;
        const where = hostileFires(h, r.name) ? "name"
          : firesInSteps(h, stepText, r.name) ? "steps"
            : (r.ingredients || []).some((i) => i.food?.name && hostileFires(h, i.food.name)) ? "ingredient" : null;
        if (!where) continue;
        personaLeaks.push({ personaId: p.id, tier: p.tier, category: h.cat, strength: h.strength, basis: h.basis, recipe: r.name, recipeId: r.id, matchedIn: where, pattern: String(h.re), ingredientNames: (r.ingredients || []).map((i) => i.food?.name).filter(Boolean) });
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROBE G — THE TEN ADJUSTERS, EVERY RULE-SET
  // ══════════════════════════════════════════════════════════════════════════
  // planContext injects these straight onto a plate with no recipe in between,
  // gated only by exclusionGate.isExcluded. Enumerated in full because the
  // scope is ten rows — small enough that "we checked all of it" is provable.
  const adjusterRows = foods.filter((f) => adjusterSet.has(String(f.name || "").trim().toLowerCase()));
  const adjusterMatrix = adjusterRows.map((f) => {
    const row = { name: f.name, id: f.id, fdcCategory: f.fdcCategory, excludedFor: [], allowedFor: [] };
    for (const cat of CATS) (gate.isExcluded(f, { excludedFoods: [cat] }) ? row.excludedFor : row.allowedFor).push(cat);
    row.styles = {};
    for (const s of df.DIETARY_STYLES) row.styles[s] = gate.isExcluded(f, { dietaryStyle: s });
    return row;
  });
  const adjustersMissing = ADJUSTER_CANDIDATES.filter((n) => !adjusterRows.some((f) => f.name.trim().toLowerCase() === n.trim().toLowerCase()));

  // ══════════════════════════════════════════════════════════════════════════
  // ARTIFACTS
  // ══════════════════════════════════════════════════════════════════════════
  const provenance = {
    tool: "backend/scripts/qc/leakSweep.mjs",
    agentId: AGENT,
    generatedAt: new Date().toISOString(),
    dbSha256: DB.sourceSha256, dbCopySha256: DB.copySha256, dbCopy: rel(DB.dbPath),
    // THE TREE MOVED DURING THIS AUDIT. dietaryFilter.js gained `pasta`/`noodle`
    // WORD_GUARDS at 03:45:51 on 2026-08-02, between this agent reading the file
    // and running the sweep, and dev.db changed at 03:44:54 (not by this tool —
    // the shared DB is only ever COPIED here). A source hash per gate file is
    // therefore mandatory: the run is pinned to these bytes and to nothing else.
    sourceSha256: Object.fromEntries(["backend/src/lib/dietaryFilter.js", "backend/src/lib/exclusionGate.js",
      "backend/src/lib/allergenTaxonomy.js", "backend/src/lib/planContext.js"]
      .map((p) => [p, sha256(path.resolve(REPO, p))])),
    foods: foods.length, recipes: recipes.length,
    recipeIngredientRows: recipes.reduce((n, r) => n + (r.ingredients || []).length, 0),
    personasPath: rel(PERSONAS_PATH), personasSha256: sha256(PERSONAS_PATH), personas: personas.length,
    gitSha: git.sha, gitBranch: git.branch, gitPorcelainEntries: git.porcelainEntries,
    categories: CATS.length,
    keywordsTotal: CATS.reduce((n, c) => n + (CATEGORY_SYNONYMS[c] || []).length, 0),
    keywordChecks,
    hostileRules: HOSTILE.length,
    hostileCategories: [...new Set(HOSTILE.map((h) => h.cat))].length,
    wordGuards: Object.keys(WORD_GUARDS).length,
    metadataCoverage: meta,
    networkCalls: netCalls,
    elapsedMs: null,
  };

  const written = [];
  written.push(writeArtifact("provenance.json", provenance));
  written.push(writeArtifact("probeA-suppressions.json", { probe: "A/suppression-enumeration", total: suppressions.length, byAttribution: Object.fromEntries(Object.entries(suppByAttribution).map(([k, v]) => [k, v.length])), rows: suppressions }));
  written.push(writeArtifact("probeB-style-allergy-disagreement.json", { probe: "B/style-vs-allergy", total: styleAllergyDisagreements.length, rows: styleAllergyDisagreements }));
  written.push(writeArtifact("probeC-term-resolution.json", { probe: "C/term-resolution", taxonomyMisses: unresolvedTerms.length, rows: unresolvedTerms, personaTerms: personaTermResolution }));
  written.push(writeArtifact("probeD-gate-parity.json", { probe: "D/gate-surface-parity", isExcludedVsMatcher: parity.isExcludedVsMatcher.length, eggSingularPlural: parity.eggSingularPlural.length, ingredientAdmittedByRecipe: parity.ingredientAdmittedByRecipe.length, rows: parity }));
  // THE ARM CHECK, generated. Three buckets, and the middle one is the point:
  // a rule that matched nothing in the corpus has proved NOTHING.
  const armCheck = {
    note: "A rule with foodNamesFiring=0 AND recipeNamesMatching=0 swept an EMPTY scope. It is INCONCLUSIVE, not clean.",
    inconclusive: ruleStats.filter((s) => s.foodNamesFiring === 0 && s.recipeNamesMatching === 0),
    coveredByGate: ruleStats.filter((s) => (s.foodNamesFiring > 0 || s.recipeNamesMatching > 0) && s.foodLeaks === 0 && s.recipeLeaks === 0),
    leaking: ruleStats.filter((s) => s.foodLeaks > 0 || s.recipeLeaks > 0),
  };
  written.push(writeArtifact("probeE-hostile-vocabulary.json", { probe: "E/hostile-vocabulary", foodLeaks: foodLeaks.length, recipeLeaks: recipeLeaks.length, ruleStats, armCheck, foodRows: foodLeaks, recipeRows: recipeLeaks }));
  written.push(writeArtifact("probeF-persona-shipped-leaks.json", { probe: "F/persona-route-pool", total: personaLeaks.length, rows: personaLeaks }));
  written.push(writeArtifact("probeG-adjusters.json", { probe: "G/adjusters", candidates: ADJUSTER_CANDIDATES, resolved: adjusterRows.length, missingFromDb: adjustersMissing, matrix: adjusterMatrix }));

  provenance.elapsedMs = Date.now() - t0;
  writeArtifact("provenance.json", provenance);

  await prisma.$disconnect();

  // ── console summary — every number with its denominator ───────────────────
  const L = [];
  L.push(`[leakSweep] T-2 · DB ${String(DB.sourceSha256).slice(0, 12)} · ${foods.length} foods / ${recipes.length} recipes / ${personas.length} personas`);
  L.push(`[leakSweep] scope: ${CATS.length} categories · ${provenance.keywordsTotal} keywords · ${keywordChecks.toLocaleString()} keyword×name checks · ${HOSTILE.length} hostile rules over ${provenance.hostileCategories} categories`);
  L.push(`[leakSweep] metadata: allergenTags on ${meta.withAllergenTags}/${foods.length} · mayContain on ${meta.withMayContain}/${foods.length} · fdcCategory on ${meta.withFdcCategory}/${foods.length} (evidence-bearing on ${meta.foodsWithEvidenceBearingFdcCategory}/${foods.length})`);
  L.push(`[leakSweep] A suppressions      ${suppressions.length}  (${Object.entries(suppByAttribution).map(([k, v]) => `${k}=${v.length}`).join(" · ") || "none"})`);
  L.push(`[leakSweep] A mirror faults     ${mirrorFaults}  (must be 0 — INSTRUMENT)`);
  L.push(`[leakSweep] B style/allergy     ${styleAllergyDisagreements.length} foods vegan-excluded, vegetarian-allowed, and NOT dairy/egg`);
  L.push(`[leakSweep] C term resolution   ${unresolvedTerms.length} taxonomy terms of ${tax.ALLERGEN_TAXONOMY.reduce((n, e) => n + 2 + (e.synonyms || []).length, 0)} do not resolve to their own row`);
  L.push(`[leakSweep] D parity            isExcluded≠matcher ${parity.isExcludedVsMatcher.length} · egg≠eggs ${parity.eggSingularPlural.length} · ingredient-admitted-by-recipe ${parity.ingredientAdmittedByRecipe.length}`);
  L.push(`[leakSweep] E hostile           ${foodLeaks.length} food leaks · ${recipeLeaks.length} recipe leaks`);
  L.push(`[leakSweep] E ARM CHECK         ${armCheck.leaking.length} rules leaking · ${armCheck.coveredByGate.length} rules the gate COVERS · ${armCheck.inconclusive.length} rules INCONCLUSIVE (no corpus match — proved nothing)`);
  L.push(`[leakSweep] F personas          ${personaLeaks.length} shipped hits over ${personas.length} real rule-sets`);
  L.push(`[leakSweep] G adjusters         ${adjusterRows.length}/${ADJUSTER_CANDIDATES.length} resolved${adjustersMissing.length ? ` · MISSING ${adjustersMissing.join(", ")}` : ""}`);
  L.push(`[leakSweep] network calls ${netCalls} (must be 0) · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  L.push(`[leakSweep] artifacts -> ${written.join("  ")}`);
  console.log(L.join("\n"));
  if (netCalls > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
