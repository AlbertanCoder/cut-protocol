#!/usr/bin/env node
// Dietary-exclusion coverage audit — re-run this whenever the Food table grows.
//
// WHY THIS EXISTS: dietaryFilter.js's keyword lists were exhaustively audited in
// Phase 4 against a 854-name food table, after live verification caught prawn stew
// being offered to a vegan account. The USDA FoodData Central bulk import took that
// table to 14,144 names written in USDA's taxonomy-first vocabulary ("Mollusks,
// whelk, unspecified, raw"), which is not the vocabulary the keyword lists were
// tuned against. A keyword list is only as good as the corpus it was audited on.
//
// METHOD: classify every food name twice — once with the app's real dietaryFilter,
// once with a deliberately BROAD independent animal-indicator lexicon — and report
// the disagreements. We care about one direction asymmetrically:
//
//   LEAK  = broad lexicon says animal-derived, dietaryFilter does NOT exclude it.
//           This is the dangerous direction: an animal food reaching a vegan plate.
//   OVER  = dietaryFilter excludes something the lexicon thinks is plant.
//           Harmless (over-exclusion is the documented design preference) but
//           reported anyway, because a big number here means a bad keyword.
//
// The lexicon is intentionally noisy. It is a DETECTOR, not the source of truth —
// its job is to surface candidates for human review, never to auto-edit filters.
// Exit code is 1 if any leak candidate is found, so this can gate CI.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { adjusterExcludedByStyle } = require("../src/lib/dietaryFilter.js");

// Resolve the DB next to THIS script's worktree, not wherever the shared Prisma
// client was generated. See docs/audit/worktree-db-isolation.md — a generated
// client bakes in a relative DATABASE_URL, so an un-overridden PrismaClient in a
// git worktree silently reads the main checkout's database.
const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, "..", "prisma", "dev.db").replace(/\\/g, "/");
const url = process.env.DATABASE_URL?.startsWith("file:")
  && path.isAbsolute(process.env.DATABASE_URL.slice(5))
  ? process.env.DATABASE_URL
  : `file:${dbPath}`;

const prisma = new PrismaClient({ datasources: { db: { url } } });

// USDA writes taxonomy first. These prefixes are near-certain animal signals.
const USDA_ANIMAL_PREFIXES = [
  "fish,", "mollusks,", "crustaceans,", "beef,", "pork,", "lamb,", "veal,",
  "game meat,", "poultry,", "chicken,", "turkey,", "duck,", "goose,", "egg,",
  "eggs,", "milk,", "cheese,", "yogurt,", "cream,", "butter,", "sausage",
  "sausages,", "bologna", "frankfurter", "luncheon meat", "gelatins",
  "ham,", "bacon,", "emu,", "ostrich,", "bison,", "elk,", "deer,", "moose,",
  "caribou,", "rabbit,", "squab,", "pheasant,", "quail,", "goat,", "mutton,",
  "whale,", "seal,", "walrus,", "beaver,", "muskrat,", "opossum,", "raccoon,",
  "bear,", "buffalo,", "antelope,", "horse,", "snail,", "turtle,", "frog",
];

// Broad in-name animal indicators (any position).
const BROAD_ANIMAL_TERMS = [
  "beef", "pork", "chicken", "turkey", "lamb", "veal", "mutton", "venison",
  "bison", "buffalo", "elk", "moose", "caribou", "rabbit", "goat", "duck",
  "goose", "quail", "pheasant", "squab", "emu", "ostrich", "boar",
  "fish", "salmon", "tuna", "cod", "halibut", "trout", "mackerel", "sardine",
  "anchovy", "anchovies", "herring", "haddock", "pollock", "perch", "carp",
  "eel", "hake", "bass", "snapper", "bream", "sole", "flounder", "mullet",
  "catfish", "tilapia", "swordfish", "marlin", "roughy", "sturgeon", "shad",
  "smelt", "burbot", "cusk", "croaker", "grouper", "monkfish",
  "shark", "skate", "whiting", "wolffish", "roe", "caviar", "surimi",
  "shrimp", "prawn", "crab", "lobster", "crayfish", "crawfish", "mussel",
  "clam", "oyster", "scallop", "squid", "octopus", "cuttlefish", "whelk",
  "abalone", "conch", "cockle", "snail", "escargot", "urchin",
  "bacon", "ham", "sausage", "salami", "pepperoni", "chorizo", "prosciutto",
  "pancetta", "bratwurst", "kielbasa", "mortadella", "pastrami", "liverwurst",
  "bologna", "frankfurter", "headcheese", "scrapple", "pate", "foie gras",
  // NOTE: bare "heart" and "bear" are deliberately absent. They produced only
  // false positives on the real corpus ("Palm Hearts" is a vegetable; the
  // KLONDIKE "SLIM-A-BEAR" fudge bar is a brand name). Real bear and organ
  // meats are caught by the USDA taxonomy prefixes instead ("bear,", "beef,").
  "liver", "kidney", "tripe", "tongue", "sweetbread", "gizzard",
  "brain", "marrow", "chitterling", "giblet", "oxtail", "trotter", "snout",
  "lard", "tallow", "suet", "gelatin", "gelatine", "rennet", "isinglass",
  "egg", "milk", "cheese", "yogurt", "yoghurt", "cream", "butter", "whey",
  "casein", "kefir", "custard", "ghee", "curd", "buttermilk", "honey",
];

const PLANT_QUALIFIERS = [
  "palm heart", "hearts of palm", "artichoke heart", "heart of palm",
  "peanut butter", "nut butter", "almond butter", "cashew butter",
  "soy milk", "almond milk", "oat milk", "coconut milk", "rice milk",
  "hemp milk", "cashew milk", "pea milk", "coconut cream", "cream of tartar",
  "butter beans", "butter bean", "buttercup", "butterhead", "butternut",
  "butterbur", "creamed corn", "cream of wheat", "shea butter", "cocoa butter",
  "apple butter", "milk thistle", "eggplant", "vegan", "meatless", "imitation",
  "substitute", "analog", "analogue", "non-dairy", "nondairy", "plant-based",
];

const norm = (s) => String(s || "").toLowerCase();

function looksAnimal(name) {
  const n = norm(name);
  for (const q of PLANT_QUALIFIERS) if (n.includes(q)) return null;
  for (const p of USDA_ANIMAL_PREFIXES) if (n.startsWith(p)) return p;
  for (const t of BROAD_ANIMAL_TERMS) {
    if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?\\b`).test(n)) return t;
  }
  return null;
}

const STYLES = ["vegan", "vegetarian"];

async function main() {
  const foods = await prisma.food.findMany({ select: { name: true, source: true } });
  console.log(`[dietary-audit] db=${url}`);
  console.log(`[dietary-audit] scanning ${foods.length} food names against dietaryFilter\n`);

  const leaks = {};
  const overs = {};
  for (const style of STYLES) { leaks[style] = []; overs[style] = []; }

  for (const f of foods) {
    const signal = looksAnimal(f.name);
    for (const style of STYLES) {
      const excluded = adjusterExcludedByStyle({ name: f.name }, style);
      // Vegetarian permits dairy/eggs/honey; only flag flesh for that style.
      // Signals arrive both as bare terms ("egg") and USDA taxonomy prefixes
      // ("egg,"), so strip the trailing comma before comparing — not doing so
      // reported all 53 FDC egg rows as vegetarian leaks, which they are not.
      const sig = signal ? signal.replace(/,$/, "") : null;
      const flesh = sig && !["egg", "eggs", "milk", "cheese", "yogurt", "yoghurt",
        "cream", "butter", "whey", "casein", "kefir", "custard", "ghee",
        "curd", "buttermilk", "honey"].includes(sig);
      const shouldExclude = style === "vegan" ? Boolean(signal) : Boolean(flesh);

      if (shouldExclude && !excluded) leaks[style].push({ name: f.name, signal, source: f.source });
      else if (!signal && excluded) overs[style].push(f.name);
    }
  }

  let totalLeaks = 0;
  for (const style of STYLES) {
    const L = leaks[style];
    totalLeaks += L.length;
    console.log(`── ${style.toUpperCase()} ──`);
    console.log(`   LEAK candidates (animal-looking, NOT excluded): ${L.length}`);
    const byTerm = {};
    for (const x of L) byTerm[x.signal] = (byTerm[x.signal] || 0) + 1;
    const top = Object.entries(byTerm).sort((a, b) => b[1] - a[1]).slice(0, 18);
    for (const [term, n] of top) {
      const ex = L.find((x) => x.signal === term).name;
      console.log(`     ${String(n).padStart(5)}  ${term.padEnd(16)} e.g. ${ex.slice(0, 74)}`);
    }
    console.log(`   over-exclusions (harmless, review if large): ${overs[style].length}\n`);
  }

  await prisma.$disconnect();
  if (totalLeaks > 0) {
    console.log(`[dietary-audit] FAIL — ${totalLeaks} leak candidate(s) need human review.`);
    process.exit(1);
  }
  console.log("[dietary-audit] clean — no leak candidates.");
}

main().catch((e) => { console.error(e); process.exit(1); });
