// Food & recipe data validation — the Phase 2 quality gate, kept as pure
// functions so the audit script, the fix pipeline, write-path routes, and CI
// tests all enforce the exact same rules (CLAUDE.md standing rule 5).
//
// Core check: kcal ≈ Atwater energy from macros. Primary model is
// fiber-adjusted (4P + 9F + 4×(carb−fiber) + 2×fiber) because USDA "carb"
// is carb-by-difference INCLUDING fiber, which contributes ~2 kcal/g, not 4 —
// high-fiber items (spices, bran) fail naive 4/4/9 while being perfectly
// correct. An entry passes if EITHER model lands within tolerance.
//
// Known physical exception: alcohol (7 kcal/g) appears in kcal but in no
// macro — wine/beer/spirits legitimately fail Atwater. Those carry an
// explicit exemption (atwaterExempt) with a reason, never a silent pass.

const TOLERANCE_PCT = 0.15;
// USDA computes energy for high-fiber botanicals (dried spices, cocoa,
// dried fungi) with specific Atwater factors well below the general 4/4/9 —
// correct records like ground cloves miss the 15% band through no fault of
// their own. Fiber ≥ 12 g/100g widens the band instead of exempting them.
const HIGH_FIBER_G = 12;
const HIGH_FIBER_TOLERANCE_PCT = 0.30;
const TOLERANCE_ABS_KCAL = 10; // near-zero foods: water at 3 kcal vs 0 computed is fine

// The generic 4/4/9 model is an approximation. USDA computes most FoodData
// Central records with FOOD-SPECIFIC Atwater factors — limes are 3.36/8.37/
// 2.48, chicken 4.27/9.02/3.87 — and 4,716 of the 5,024 bulk records that
// declare factors use something other than 4/4/9. Checking those against
// 4/4/9 reports a discrepancy that lives in the model, not in the data. When
// the caller knows the factors USDA actually used (the bulk importer reads
// them straight off the record), pass them and the check uses them.
const DEFAULT_FACTORS = { protein: 4, fat: 9, carb: 4 };

function atwater(food, factors) {
  const k = factors || DEFAULT_FACTORS;
  const p = food.protein || 0, f = food.fat || 0, c = food.carb || 0;
  const fiber = Math.min(food.fiber || 0, c); // fiber can't exceed total carb
  return {
    classic: k.protein * p + k.carb * c + k.fat * f,
    // Fiber is carb-by-difference's least-digestible fraction (~2 kcal/g).
    fiberAdjusted: k.protein * p + k.fat * f + k.carb * (c - fiber) + 2 * fiber,
  };
}

function withinTolerance(kcal, computed, tolPct) {
  const diff = Math.abs(kcal - computed);
  return diff <= Math.max(TOLERANCE_ABS_KCAL, tolPct * Math.max(kcal, computed));
}

function checkAtwater(food, factors) {
  const { classic, fiberAdjusted } = atwater(food, factors);
  const tolPct = (food.fiber || 0) >= HIGH_FIBER_G ? HIGH_FIBER_TOLERANCE_PCT : TOLERANCE_PCT;
  const ok = withinTolerance(food.kcal, fiberAdjusted, tolPct) || withinTolerance(food.kcal, classic, tolPct);
  return { ok, classic: Math.round(classic), fiberAdjusted: Math.round(fiberAdjusted) };
}

// ── name-implied shape checks ────────────────────────────────────────────
// Atwater can't catch a wrong-food match: oil macros stored under "Porridge
// oats" are internally consistent — only the NAME says they're wrong. These
// rules flag hard mismatches between what a name implies and what the
// numbers say. Deliberately conservative: only unambiguous keywords, only
// gross violations.

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Word-boundary + plural match ("berry" → berries, "nut" → nuts); multi-word
// entries match as substrings.
const word = (name, w) => {
  if (w.includes(" ")) return name.toLowerCase().includes(w);
  const stem = w.endsWith("y") ? esc(w.slice(0, -1)) + "(?:y|ies)" : esc(w) + "(?:es|s)?";
  return new RegExp("\\b" + stem + "\\b", "i").test(name);
};
const any = (name, ws) => ws.some((w) => word(name, w));

// Full-name patterns: "canned in water" and "with added salt" are NOT water
// or salt — only names that essentially ARE the near-zero item qualify.
const NEAR_ZERO_PATTERNS = [
  /^(boiling |cold |hot |warm |sparkling |still |tap |soda |ice )?water$/i,
  /^(sea |table |kosher |rock |pink |himalayan )?salt$/i,
  /^black coffee$/i,
  /^(green |black |herbal )?tea$/i,
  /^diet (cola|coke|soda|pop)$/i,
];
const OIL_NAMES = ["oil", "lard", "tallow", "ghee", "suet", "shortening", "dripping", "schmaltz"];
const CARB_DOMINANT_NAMES = ["oat", "oats", "porridge", "rice", "flour", "pasta", "noodle", "bread", "sugar", "honey", "syrup", "cereal", "couscous", "quinoa", "potato"];
const CARB_DOMINANT_BLOCKERS = ["rice vinegar", "rice wine", "cauliflower rice", "fried"];
const MEAT_NAMES = ["chicken breast", "chicken thigh", "turkey breast", "beef", "steak", "pork loin", "salmon", "tuna", "cod", "white fish"];
// Stocks, sauces, composite dishes, and oils legitimately carry meat words
// with non-meat macros.
const MEAT_BLOCKERS = ["stock", "broth", "bouillon", "gravy", "sauce", "seasoning", "tomato", "tortilla", "soup", "stew", " and ", "with", "oil", "rind", "crackling", "dripping"];
const NUT_NAMES = ["almond", "walnut", "cashew", "peanut", "pistachio", "pecan", "hazelnut", "macadamia"];
const NUT_BLOCKERS = ["milk", "essence", "extract", "flour", "drink", "water", "butter bean", "brittle", "cookie", "candy", "paste", "satay", "sauce", "oil"];

function checkNameShape(food) {
  const issues = [];
  const n = food.name;
  const { kcal, protein, fat, carb } = food;

  if (NEAR_ZERO_PATTERNS.some((re) => re.test(n.trim())) && kcal > 10) {
    issues.push(`name implies ~0 kcal but has ${Math.round(kcal)} kcal`);
  }
  if (any(n, OIL_NAMES) && !/free|spray/i.test(n) && (fat < 85 || protein + carb > 8) && kcal > 0) {
    issues.push(`name implies pure fat (oil/lard) but macros are ${protein}P/${fat}F/${carb}C`);
  }
  // The inverse trap: an OIL record stored under a non-oil name ("Walnuts"
  // at 884/0P/100F, "Sardines" carrying fish-oil data). Internally
  // consistent, so only the name betrays it — nothing except rendered fats
  // is ≥90% fat.
  if (fat >= 90 && !any(n, OIL_NAMES)) {
    issues.push(`pure-fat macros (${fat}F/100g) under a non-oil name — likely an oil record mismatched to this food`);
  }
  if (any(n, CARB_DOMINANT_NAMES) && !any(n, CARB_DOMINANT_BLOCKERS) && fat > 50 && carb < 10) {
    issues.push(`name implies carb-dominant food but macros are fat-dominant (${protein}P/${fat}F/${carb}C — likely a wrong USDA match)`);
  }
  if (any(n, MEAT_NAMES) && !any(n, MEAT_BLOCKERS) && kcal > 0 && (protein < 10 || carb > 20)) {
    issues.push(`name implies lean meat/fish but macros are ${protein}P/${fat}F/${carb}C`);
  }
  if (any(n, NUT_NAMES) && !any(n, NUT_BLOCKERS) && (kcal < 400 || fat < 30)) {
    issues.push(`name implies nut (~550-650 kcal, fat-dominant) but entry is ${Math.round(kcal)} kcal ${protein}P/${fat}F/${carb}C`);
  }
  return issues;
}

// ── the per-food verdict ─────────────────────────────────────────────────

/**
 * food: { name, kcal, protein, fat, carb, fiber, category, source }
 * opts.exemptions: { [lowercased name]: { atwaterExempt, reason } }
 * opts.validCategories: array of allowed category slugs (skip check if absent)
 * opts.atwaterFactors: { protein, fat, carb } — the factors the SOURCE used to
 *   compute this food's energy, when known. Defaults to the generic 4/4/9.
 * opts.nameIsSourceDescription: true when `name` is verbatim the source
 *   record's own description (bulk USDA import). The name-shape rules exist to
 *   catch a food whose macros came from a DIFFERENT record than its name
 *   implies; where name and macros are two fields of one record that mismatch
 *   is unrepresentable, and the heuristics only produce false positives
 *   ("Anchovies, canned in olive oil" is not an oil; "Snacks, granola bars,
 *   almond" is not a nut). Skipped in that case, never skipped otherwise.
 * Returns { ok, issues: [{ code, detail }] }
 */
function validateFood(food, opts = {}) {
  const issues = [];
  const nameKey = (food.name || "").trim().toLowerCase();
  const exemption = opts.exemptions?.[nameKey];

  for (const k of ["kcal", "protein", "fat", "carb", "fiber"]) {
    const v = food[k];
    if (typeof v !== "number" || Number.isNaN(v)) issues.push({ code: "missing", detail: `${k} is not a number` });
    else if (v < 0) issues.push({ code: "negative", detail: `${k} is negative (${v})` });
  }
  if (issues.length === 0) {
    if (food.kcal > 950) issues.push({ code: "absurd", detail: `kcal/100g ${Math.round(food.kcal)} exceeds pure fat (~900)` });
    if (food.protein + food.fat + food.carb > 105) {
      issues.push({ code: "absurd", detail: `macros sum to ${Math.round(food.protein + food.fat + food.carb)} g per 100 g` });
    }
    if (food.kcal === 0 && food.protein + food.fat + food.carb > 3) {
      issues.push({ code: "zero-kcal", detail: `kcal is 0 but macros are ${food.protein}P/${food.fat}F/${food.carb}C (incomplete source record)` });
    }
    const aw = checkAtwater(food, opts.atwaterFactors);
    if (!aw.ok) {
      if (exemption?.atwaterExempt) {
        // documented exception — not a failure
      } else {
        const basis = opts.atwaterFactors
          ? ` using source factors ${opts.atwaterFactors.protein}/${opts.atwaterFactors.carb}/${opts.atwaterFactors.fat} (P/C/F)`
          : "";
        issues.push({
          code: "atwater",
          detail: `kcal ${Math.round(food.kcal)} vs computed ${aw.fiberAdjusted} (fiber-adj) / ${aw.classic} (classic)${basis}`,
        });
      }
    }
    if (!opts.nameIsSourceDescription) {
      for (const detail of checkNameShape(food)) issues.push({ code: "name-shape", detail });
    }
  }
  if (opts.validCategories && !opts.validCategories.includes(food.category)) {
    issues.push({ code: "category", detail: `category "${food.category}" is not one of the grocery categories` });
  }
  if (food.source === "manual-placeholder") {
    issues.push({ code: "placeholder", detail: "zero-macro placeholder awaiting real data" });
  }
  return { ok: issues.length === 0, issues };
}

// ── is this row's number allowed to be shown or added up? ────────────────
//
// WHY THIS IS SEPARATE FROM validateFood()  (fleet finding food-data-2)
//
// validateFood() asks "is this row internally coherent?". That question CANNOT
// catch the corruption this section exists for. 470 rows in the food library
// carry a DIFFERENT food's macros verbatim — "Chicken Breast" holding breaded
// tenders' 263 kcal, "Tomato" holding tomato POWDER's 302, "Mayonnaise" holding
// low-calorie mayo's 263 against real mayo's 680. Every one of those is a real
// USDA record, so every one of them satisfies 4/4/9 perfectly. The Atwater gate
// passes them. The name is the only thing that says they are wrong, and a prior
// repair pass already wrote that finding into each row's own `dataQuality`.
//
// So trust is asked as its own question, of the row's PROVENANCE rather than
// its arithmetic. And it is deliberately NOT folded into validateFood(): that
// function gates writes (POST/PUT /foods, USDA import), and a quarantined row
// must stay editable — fixing its numbers is the whole point.
//
// Direction of the error matters. Mayonnaise reading 263 instead of 680 makes
// every recipe containing it UNDER-count fat, which on a cutting app is the
// worst possible direction to be wrong in: the user eats the deficit they were
// promised and it isn't one.

const QUARANTINE_SOURCE = "quarantined";

// dataQuality prefixes written by the provenance repair that mean "this row's
// USDA claim did not survive verification". Distinct from the OTHER
// `exception:` prefixes — atwater-exempt, alcohol-energy, usda-source-model,
// curated-override — which are DOCUMENTED, reviewed explanations of a healthy
// row and must never be treated as untrustworthy. (There are ~500 of those; a
// blanket "starts with exception:" rule would condemn all of them.)
const UNVERIFIED_PROVENANCE_PREFIXES = [
  "exception:provenance-cleared",   // carried another food's record; macros are that record's
  "exception:unverifiable-fdcid",   // claimed an FDC id that is not in any dataset
];

/** Has this row been pulled from service by scripts/quarantineCorruptFoods.mjs? */
function isQuarantined(food) {
  if (!food) return false;
  if (food.source === QUARANTINE_SOURCE) return true;
  // Also true BEFORE the migration runs, so the app is honest about these rows
  // from the moment this code ships rather than from the moment someone
  // remembers to run a script.
  return (food.dataQuality || "").startsWith("exception:provenance-cleared");
}

/**
 * Why this row's macros may not be presented as fact, or null if they may.
 * Returns { code, detail } — `detail` is plain English, safe to show a user.
 */
function macroTrustIssue(food) {
  if (!food) return { code: "missing-food", detail: "no food record" };
  if (isQuarantined(food)) {
    return {
      code: "quarantined",
      detail: `"${food.name}" is quarantined — its stored macros are another food's numbers, so they are not this food's calories`,
    };
  }
  const dq = food.dataQuality || "";
  if (UNVERIFIED_PROVENANCE_PREFIXES.some((p) => dq.startsWith(p))) {
    return {
      code: "unverified-provenance",
      detail: `"${food.name}" lost its USDA source and its macros were never re-verified`,
    };
  }
  if (food.source === "manual-placeholder") {
    return {
      code: "placeholder",
      detail: `"${food.name}" has no nutrition data yet — it is a placeholder waiting for real numbers`,
    };
  }
  return null;
}

/** Cheap boolean for filtering pools. */
const hasUsableMacros = (food) => macroTrustIssue(food) === null;

/**
 * Throwing form, for the write paths and any caller that would otherwise put a
 * quarantined number in front of a user. Returns the food so it can be used
 * inline: `const f = assertUsableMacros(row)`.
 */
function assertUsableMacros(food) {
  const issue = macroTrustIssue(food);
  if (issue) {
    const err = new Error(issue.detail);
    err.code = issue.code;
    err.status = 422;
    err.foodId = food?.id ?? null;
    throw err;
  }
  return food;
}

/**
 * Can this recipe's totals be shown as a number, or must it say "incomplete
 * data"? Pure — hand it a recipe with `ingredients: [{ food }]`.
 *
 * Returns { complete, unusable, reason } where `reason` is a plain-English
 * sentence for the UI and `unusable` lists the offending ingredients. A recipe
 * with even one untrusted ingredient has a wrong total, and the honest thing to
 * render is the ingredient's name, not a confident kcal figure.
 */
function recipeDataConfidence(recipe) {
  const ingredients = recipe?.ingredients || [];
  const unusable = [];
  for (const ing of ingredients) {
    const issue = macroTrustIssue(ing?.food);
    if (issue) unusable.push({ foodId: ing.food?.id ?? null, name: ing.food?.name ?? "(unnamed)", code: issue.code, detail: issue.detail });
  }
  if (!unusable.length) return { complete: true, unusable: [], reason: null };
  const names = unusable.map((u) => u.name);
  const list = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return {
    complete: false,
    unusable,
    reason: `Calories for this recipe are incomplete — ${list} ${names.length === 1 ? "does not have" : "do not have"} verified nutrition data yet.`,
  };
}

// ── recipes ──────────────────────────────────────────────────────────────

/**
 * Recompute a recipe's per-serving macros from its ingredients.
 * ingredients: [{ baseGrams, food: { kcal, protein, fat, carb } }]
 */
function computeRecipeMacros(ingredients) {
  const t = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  for (const ing of ingredients) {
    const f = ing.food;
    const factor = (ing.baseGrams || 0) / 100;
    t.kcal += (f.kcal || 0) * factor;
    t.protein += (f.protein || 0) * factor;
    t.fat += (f.fat || 0) * factor;
    t.carb += (f.carb || 0) * factor;
  }
  return t;
}

/**
 * recipe: { name, kcal, protein, fat, carb, ingredients: [{ baseGrams, food }] }
 * Checks stored macros against the sum of ingredients and reports placeholder
 * ingredients (which make any total untrustworthy).
 */
function validateRecipe(recipe) {
  const issues = [];
  const placeholders = recipe.ingredients.filter((i) => i.food?.source === "manual-placeholder");
  if (placeholders.length) {
    issues.push({
      code: "placeholder-ingredients",
      detail: `${placeholders.length} ingredient(s) with no real data: ${placeholders.map((i) => i.food.name).join(", ")}`,
    });
  }
  // A quarantined ingredient makes the total wrong by an unknown amount, which
  // is a different failure from macro-drift: recomputing does not fix it,
  // because the number being summed is another food's.
  const untrusted = recipe.ingredients.filter((i) => {
    const issue = macroTrustIssue(i.food);
    return issue && issue.code !== "placeholder";
  });
  if (untrusted.length) {
    issues.push({
      code: "untrusted-ingredients",
      detail: `${untrusted.length} ingredient(s) whose macros are not verified for that food: ${untrusted.map((i) => i.food.name).join(", ")} — this recipe's total cannot be trusted and should read "incomplete data"`,
    });
  }
  const computed = computeRecipeMacros(recipe.ingredients);
  const diff = Math.abs(recipe.kcal - computed.kcal);
  if (diff > Math.max(TOLERANCE_ABS_KCAL, TOLERANCE_PCT * Math.max(recipe.kcal, computed.kcal))) {
    issues.push({
      code: "macro-drift",
      detail: `stored ${Math.round(recipe.kcal)} kcal vs ${Math.round(computed.kcal)} from ingredients`,
    });
  }
  return { ok: issues.length === 0, issues, computed };
}

// ── duplicate detection ──────────────────────────────────────────────────

// Fold a name to a duplicate-grouping key: lowercase, punctuation → space,
// collapsed whitespace, trailing plural stripped per word.
function nameKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("ses") ? w : w.length > 3 && w.endsWith("es") && !w.endsWith("oes") ? w.slice(0, -2) : w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

function findDuplicateGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = nameKey(row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].filter(([, members]) => members.length > 1);
}

module.exports = {
  TOLERANCE_PCT,
  TOLERANCE_ABS_KCAL,
  atwater,
  checkAtwater,
  checkNameShape,
  validateFood,
  QUARANTINE_SOURCE,
  UNVERIFIED_PROVENANCE_PREFIXES,
  isQuarantined,
  macroTrustIssue,
  hasUsableMacros,
  assertUsableMacros,
  recipeDataConfidence,
  computeRecipeMacros,
  validateRecipe,
  nameKey,
  findDuplicateGroups,
};
