// oracle — INDEPENDENT verification of a solve (QC gauntlet v2).
//
// HARD INDEPENDENCE RULE (v2): this file imports NO src/lib engine module —
// not mealSolver, foodValidation, bmrEngine, or dietaryFilter. Every check is
// re-derived inline, in a different style, so a bug in the engine cannot hide
// behind the engine verifying itself. In particular the allergen check matches
// against a SEPARATELY-CURATED derived-allergen list below, never the app's own
// synonym table (that would be the same map read twice).
//
// Policy constants (portion bounds, repeat cap, tolerances) are INLINED with
// their source values cited. The Phase 0.5 self-check test imports the real
// constants and asserts these copies still equal them — so drift is caught
// without a runtime dependency on the engine.
//
// What it verifies per week:
//   1. MACROS   — recompute each slot from a private Food snapshot (stored
//                 Food.kcal × g/100; NOT an Atwater re-derivation) and compare
//                 to the solver's claim. Ingredient-level 5 g rounding is
//                 authoritative. Fiber lives on Food.fiber.
//   2. ALLERGEN — every shipped ingredient vs a curated derived-term audit list
//                 (independent). One match on an excluded allergen = P0.
//   3. DIET     — vegan/vegetarian plans vs an independent animal-term list.
//   4. FLOOR    — target >= max(sexFloor, RMR*0.95, profile.floorKcal), inline.
//   5. PORTION  — every scale in [0.5, 2].
//   6. SLOTTING — no dessert/beverage/condiment in a meal slot.
//   7. FEASIBILITY — bounds-based honest/solver-miss classification.
//                 (v2 upgrade to a week-consistent witness search is pending and
//                 is tracked in RUNLOG; until then misses are reported, not used
//                 to auto-drive fixes.)

// ── inlined policy constants (source values cited; drift-guarded by 0.5) ──
export const ORACLE_CONSTANTS = {
  SCALE_LO: 0.5, SCALE_HI: 2,          // weeklyPlanner.SCALE_BOUNDS
  REPEAT_CAP: 2,                        // weeklyPlanner.DEFAULT_REPEAT_CAP
  KCAL_SILENT: 0.15, PROTEIN_SILENT: 0.15, // mealSolver.DAY_{KCAL,PROTEIN}_TOLERANCE_PCT
};
const { SCALE_LO, SCALE_HI, REPEAT_CAP, KCAL_SILENT, PROTEIN_SILENT } = ORACLE_CONSTANTS;
const KCAL_ACCEPT = 0.05;   // gauntlet acceptance bar
const PROTEIN_SLACK = 5;    // protein may run down to −5 g of the low bound
const SEX_FLOOR = { M: 1500, F: 1200 };
const MEAL_CATS_BANNED_IN_MEAL = new Set(["dessert", "beverage", "condiment_or_sauce", "bread_or_pastry_side"]);

// ── CURATED derived-allergen audit list — INDEPENDENT of the app's map ──────
// Keyed by the app's excludedFoods keys, but every term list is authored here
// from allergen knowledge, deliberately including DERIVED terms the app might
// miss (whey/casein/ghee<-milk, semolina/durum/seitan<-wheat, lecithin/edamame
// <-soy, surimi<-fish, ...). Multiword terms match as substrings; single words
// match on word boundaries.
export const AUDIT_ALLERGENS = {
  // NB: bare "flour" and "bran" are DELIBERATELY excluded — rice/almond/corn
  // flour and oat/rice/corn/sorghum bran are gluten-FREE, so those broad terms
  // make the verifier over-claim leaks. "wheat" + the specific grains catch the
  // real cases without the false positives.
  gluten: ["wheat", "wheat flour", "wheat bran", "all-purpose flour", "breadcrumb", "panko", "semolina", "durum", "farina", "spelt", "kamut", "rye", "barley", "malt", "bulgur", "couscous", "seitan", "graham", "matzo", "matzah", "orzo", "farro", "triticale", "macaroni", "spaghetti", "beer", "soy sauce"],
  dairy: ["milk", "cream", "butter", "buttermilk", "cheese", "yogurt", "yoghurt", "whey", "casein", "caseinate", "ghee", "lactose", "custard", "kefir", "curd", "paneer", "ricotta", "mozzarella", "parmesan", "cheddar", "feta", "gelato", "ice cream", "half-and-half", "condensed milk", "evaporated milk"],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "crayfish", "crawfish", "langoustine", "scampi", "mussel", "clam", "oyster", "scallop", "cockle", "whelk", "abalone", "squid", "calamari", "octopus", "cuttlefish"],
  soy: ["soy", "soya", "soybean", "edamame", "tofu", "tempeh", "miso", "natto", "tamari", "soy sauce", "lecithin", "textured vegetable protein", "tvp", "soy protein"],
  nuts: ["almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "macadamia", "brazil nut", "pine nut", "chestnut", "praline", "marzipan", "nutella", "gianduja", "nut butter"],
  eggs: ["egg", "albumen", "albumin", "ovalbumin", "mayonnaise", "meringue", "aioli", "hollandaise", "custard", "frittata", "omelet", "omelette", "quiche"],
  fish: ["salmon", "tuna", "cod", "halibut", "trout", "mackerel", "sardine", "anchovy", "herring", "haddock", "tilapia", "seabass", "sea bass", "snapper", "pollock", "catfish", "swordfish", "fish sauce", "worcestershire", "surimi", "roe", "caviar"],
  kiwi: ["kiwi", "kiwifruit"],
  peanuts: ["peanut", "groundnut", "goober", "arachis", "satay", "peanut butter", "peanut oil"],
  sesame: ["sesame", "tahini", "halva", "halvah", "benne", "gomashio", "za'atar", "zaatar"],
};
// False-exclusion guards. Two kinds, applied by STRIPPING the offending token
// from the name (never by voiding the whole name — a homograph must not mask a
// real allergen elsewhere in "Chicken with water chestnut"):
//  · HARD_EXEMPT — homographs that are no allergen at all.
//  · PLANT_DAIRY — plant "milk/butter/cream" that must not read as DAIRY, but
//    MUST still read as their own allergen (peanut butter -> peanuts, almond
//    milk -> tree nuts). So these are stripped ONLY when checking dairy/animal.
const HARD_EXEMPT = ["water chestnut", "butternut", "butterhead", "butterbur", "milk thistle", "cream of tartar", "nutmeg", "butterscotch"];
const PLANT_DAIRY = ["peanut butter", "almond butter", "cashew butter", "sunflower butter", "seed butter", "nut butter", "apple butter", "cocoa butter", "shea butter", "coconut milk", "almond milk", "soy milk", "oat milk", "rice milk", "hemp milk", "pea milk", "cashew milk", "coconut cream", "butter bean"];

// Independent animal-term list for vegan / vegetarian leak checks.
const ANIMAL_MEAT = ["beef", "pork", "chicken", "turkey", "duck", "goose", "lamb", "mutton", "veal", "venison", "bison", "goat", "rabbit", "bacon", "ham", "sausage", "salami", "pepperoni", "prosciutto", "chorizo", "gelatin", "gelatine", "lard", "tallow", "suet", "meat", "steak", "mince", "liver", "ostrich", "emu", "bologna", "gizzard", "brisket"];
const ANIMAL_SEA = AUDIT_ALLERGENS.fish.concat(AUDIT_ALLERGENS.shellfish);
const ANIMAL_DAIRY_EGG = AUDIT_ALLERGENS.dairy.concat(AUDIT_ALLERGENS.eggs, ["honey"]);

// ── independent term matcher ────────────────────────────────────────────────
function norm(s) { return String(s || "").toLowerCase(); }
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function oneTerm(n, t) { return (t.includes(" ") || t.includes("-")) ? n.includes(t) : new RegExp(`\\b${esc(t)}(?:e?s)?\\b`, "i").test(n); }
// stripDairy: also neutralise plant milks/butters/creams so they never read as
// dairy or as an animal product (they still match their OWN allergen when that
// list is passed, because the plant word — peanut, almond — survives).
function prep(name, stripDairy) {
  let n = norm(name);
  for (const h of HARD_EXEMPT) n = n.split(h).join(" ");
  if (stripDairy) for (const p of PLANT_DAIRY) n = n.split(p).join(" ");
  return n;
}
export function matchesTerm(name, term, stripDairy = false) { return oneTerm(prep(name, stripDairy), norm(term)); }
export function hitsAny(name, terms, stripDairy = false) { const n = prep(name, stripDairy); return terms.some((t) => oneTerm(n, norm(t))); }

// Recompute one slot's macros from the private Food snapshot (independent of
// the solver's arithmetic). Uses the slot's OWN shipped grams.
function recomputeSlot(slot, foodById) {
  let kcal = 0, protein = 0, fat = 0, carb = 0, missing = 0;
  for (const ing of slot.ingredients || []) {
    const f = foodById.get(ing.foodId);
    if (!f) { missing++; continue; }
    const factor = ing.grams / 100;
    kcal += f.kcal * factor; protein += f.protein * factor; fat += f.fat * factor; carb += f.carb * factor;
  }
  return { kcal, protein, fat, carb, missing };
}

export function oracle(res, ctx) {
  const { foodById, recipeById } = ctx;
  const target = res.target;
  const excluded = res.inputs.dietProfile.excludedFoods || [];
  const style = res.inputs.dietProfile.dietaryStyle;
  const nMeal = res.inputs.mealConfig.meals;
  const nSnack = res.inputs.mealConfig.snacks;

  const findings = [];
  const add = (kind, severity, detail) => findings.push({ kind, severity, detail, seed: res.seed });

  if (res.crash) { add("crash", "P0", res.crash.message); return baseSummary(res, { crash: true, findings }); }

  // ── FLOOR (three-term, inline; RMR comes from the solve result) ─────────
  const sexFloor = SEX_FLOOR[res.inputs.profile.sex] ?? 1500;
  const requiredFloor = Math.max(sexFloor, Math.round(res.energy.rmr * 0.95), res.inputs.profile.floorKcal || 0);
  if (res.derived.target < requiredFloor - 1) add("kcal-floor-breach", "P0", `target ${res.derived.target} < floor ${requiredFloor} (RMR ${res.energy.rmr})`);

  // ── pool feasibility bounds (per slot type) ─────────────────────────────
  const pool = res._pool || [];
  const mealPool = pool.filter((r) => r.slotType === "meal" || r.slotType === "either" || r.slotType == null);
  const snackPool = pool.filter((r) => r.slotType === "snack" || r.slotType === "either");
  const maxOf = (arr, k) => arr.reduce((m, r) => Math.max(m, r[k] || 0), 0);
  const minPosOf = (arr, k) => arr.reduce((m, r) => (r[k] > 0 ? Math.min(m, r[k]) : m), Infinity);
  const maxMealK = maxOf(mealPool, "kcal"), maxMealP = maxOf(mealPool, "protein");
  const maxSnackK = maxOf(snackPool, "kcal"), maxSnackP = maxOf(snackPool, "protein");
  const minMealK = Number.isFinite(minPosOf(mealPool, "kcal")) ? minPosOf(mealPool, "kcal") : 0;
  const minSnackK = Number.isFinite(minPosOf(snackPool, "kcal")) ? minPosOf(snackPool, "kcal") : 0;
  const dayMaxKcal = nMeal * maxMealK * SCALE_HI + nSnack * maxSnackK * SCALE_HI;
  const dayMinKcal = nMeal * minMealK * SCALE_LO + nSnack * minSnackK * SCALE_LO;
  const dayMaxProtein = nMeal * maxMealP * SCALE_HI + nSnack * maxSnackP * SCALE_HI;

  const byDay = new Map();
  for (const s of res.slots) byDay.set(s.dayOfWeek, [...(byDay.get(s.dayOfWeek) || []), s]);

  let daysInTol = 0, daysFeasible = 0, feasibleMisses = 0, honestMisses = 0, silentMisses = 0;
  let allergyLeaks = 0, portionViolations = 0, dessertInMeal = 0, macroDrift = 0, sameRecipeSameDay = 0, falseExclusion = 0;
  let unfilledSilent = 0, unfilledDeclared = 0;
  const kcalDevs = [], proteinShorts = [];
  const declaredWeek = !!res.diagnosis;

  for (const [dow, slots] of byDay) {
    let dKcal = 0, dProt = 0;
    const seenToday = new Map();
    for (const s of slots) {
      for (const sc of [s.proteinScale, s.sidesScale]) {
        if (sc != null && (sc < SCALE_LO - 1e-6 || sc > SCALE_HI + 1e-6)) { portionViolations++; add("portion-bound", "P0", `scale ${sc} outside [${SCALE_LO}, ${SCALE_HI}] (day ${dow})`); }
      }
      if (!s.recipeId) {
        if (s.warning || declaredWeek) unfilledDeclared++;
        else { unfilledSilent++; add("silent-unfilled-slot", "P1", `empty ${s.slotType} slot day ${dow}, no warning/diagnosis`); }
        continue;
      }
      seenToday.set(s.recipeId, (seenToday.get(s.recipeId) || 0) + 1);
      if (s.slotType === "meal") {
        const rec = recipeById.get(s.recipeId);
        if (rec && rec.mealCategory && MEAL_CATS_BANNED_IN_MEAL.has(rec.mealCategory)) { dessertInMeal++; add("dessert-as-meal", "P0", `"${rec.name}" (${rec.mealCategory}) in a meal slot, day ${dow}`); }
      }
      const re = recomputeSlot(s, foodById);
      if (re.missing) add("missing-food-row", "P1", `slot day ${dow} references ${re.missing} food id(s) absent from the snapshot`);
      if (Math.abs(re.kcal - (s.kcal ?? re.kcal)) > 1.0 || Math.abs(re.protein - (s.protein ?? re.protein)) > 0.5) { macroDrift++; add("macro-drift", "P0", `day ${dow}: solver ${Math.round(s.kcal)}kcal/${Math.round(s.protein)}p vs oracle ${Math.round(re.kcal)}kcal/${Math.round(re.protein)}p`); }
      dKcal += re.kcal; dProt += re.protein;

      // ALLERGEN (independent curated list) on the actually-shipped ingredients
      for (const ing of s.ingredients || []) {
        for (const term of excluded) {
          const audit = AUDIT_ALLERGENS[term] || [term];
          // Strip plant milks/butters only when the excluded allergen is dairy.
          if (hitsAny(ing.name, audit, term === "dairy")) { allergyLeaks++; add("allergy-leak", "P0", `"${ing.name}" matches excluded ${term} (day ${dow})`); }
        }
        // DIET style (vegan/vegetarian) — independent animal-term lists, plant
        // milks/butters stripped so they don't read as animal.
        if (style === "vegan" && hitsAny(ing.name, ANIMAL_MEAT.concat(ANIMAL_SEA, ANIMAL_DAIRY_EGG), true)) { allergyLeaks++; add("diet-style-leak", "P0", `"${ing.name}" is animal-derived on a vegan plan (day ${dow})`); }
        else if (style === "vegetarian" && hitsAny(ing.name, ANIMAL_MEAT.concat(ANIMAL_SEA), true)) { allergyLeaks++; add("diet-style-leak", "P0", `"${ing.name}" is meat/fish on a vegetarian plan (day ${dow})`); }
      }
    }
    for (const [, n] of seenToday) if (n > 1) { sameRecipeSameDay++; add("same-recipe-same-day", "P2", `a recipe served ${n}× on day ${dow}`); }

    const kcalDev = target.kcal > 0 ? (dKcal - target.kcal) / target.kcal : 0;
    const proteinShort = Math.max(0, target.proteinLo - dProt);
    kcalDevs.push(kcalDev * 100); proteinShorts.push(proteinShort);
    const acceptOk = Math.abs(kcalDev) <= KCAL_ACCEPT && dProt >= target.proteinLo - PROTEIN_SLACK;
    if (acceptOk) daysInTol++;
    const withinSolverPromise = Math.abs(kcalDev) <= KCAL_SILENT && (target.proteinLo <= 0 || (target.proteinLo - dProt) / target.proteinLo <= PROTEIN_SILENT);
    const reachable = target.kcal <= dayMaxKcal && target.kcal >= dayMinKcal && dayMaxProtein >= target.proteinLo;
    if (reachable) daysFeasible++;
    if (!acceptOk && reachable) feasibleMisses++;
    if (!acceptOk && !reachable) honestMisses++;
    if (reachable && !withinSolverPromise && !declaredWeek) { silentMisses++; add("silent-solver-miss", "P1", `day ${dow} feasible, outside solver's ±15% (kcal ${Math.round(dKcal)}/${target.kcal}, protein ${Math.round(dProt)}/${target.proteinLo}), no diagnosis`); }
  }

  const recipeCounts = new Map();
  for (const s of res.slots) if (s.recipeId) recipeCounts.set(s.recipeId, (recipeCounts.get(s.recipeId) || 0) + 1);
  let repeatCapViolations = 0;
  for (const [, n] of recipeCounts) if (n > REPEAT_CAP) { repeatCapViolations++; add("week-repeat-cap", "P2", `a recipe used ${n}× (cap ${REPEAT_CAP})`); }

  const totalDays = byDay.size || 1;
  let outcome;
  if (allergyLeaks || macroDrift || dessertInMeal || portionViolations) outcome = "unsafe";
  else if (silentMisses > 0 || unfilledSilent > 0) outcome = "silent-miss";
  else if (daysInTol === totalDays && unfilledSilent === 0 && unfilledDeclared === 0) outcome = "converged";
  else if (feasibleMisses > 0) outcome = "off-target-declared";
  else if (honestMisses > 0 || unfilledDeclared > 0) outcome = "honest-unsolvable";
  else outcome = "partial";

  return baseSummary(res, {
    crash: false, outcome, findings,
    daysInTol, daysFeasible, feasibleMisses, honestMisses, silentMisses, totalDays,
    allergyLeaks, portionViolations, dessertInMeal, macroDrift, sameRecipeSameDay, falseExclusion,
    repeatCapViolations, unfilledSilent, unfilledDeclared,
    kcalDevMax: kcalDevs.length ? Math.max(...kcalDevs.map(Math.abs)) : 0,
    proteinShortMax: proteinShorts.length ? Math.max(...proteinShorts) : 0,
    declaredWeek,
  });
}

function baseSummary(res, extra) {
  return { seed: res.seed, corner: res.corner, solveMs: res.solveMs, target: res.derived.target, floored: res.derived.floored, counts: res.counts, ...extra };
}
