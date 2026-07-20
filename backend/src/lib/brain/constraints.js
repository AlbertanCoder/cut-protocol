// constraints.js — Brain v3 Stage E. The canonical ConstraintSet + the
// deterministic acceptance predicate the planning loop converges against (the
// model never decides "done"). HARD constraints never relax — exclusions,
// energy-band, protein-floor. SOFT constraints relax UP an ordered ladder
// (portion → batch → complexity → time → budget → carb/fat), each widening
// logged to relaxations[]. Missing inputs → INDETERMINATE, never a false pass
// (LAW 7). Every leaf: { value, source, kind:'hard'|'soft', priority, weight? }.
const { proteinMid } = require("./feasibility.js");

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

// The soft relaxation ladder — lowest priority relaxes first.
const SOFT_ORDER = ["portion", "batch", "complexity", "time", "budget", "carbBand", "fatBand"];

function leaf(value, source, kind, priority, weight) {
  const l = { value, source, kind, priority };
  if (weight != null) l.weight = weight;
  return l;
}

/**
 * compileConstraints(profile, dailyTarget, catalogStats) -> ConstraintSet.
 * dailyTarget: { kcal, proteinLo, proteinHi, fatLo, fatHi, carbLo, carbHi }.
 * catalogStats (optional): { compliantCount, bestProteinPerKcal } — used only by
 * checkFeasibility; absent fields make the affected check INDETERMINATE.
 * Soft per-user constraints come from nullable profile fields (null = no
 * constraint); a persistence migration for those fields is a follow-up.
 */
function compileConstraints(profile = {}, dailyTarget = {}, catalogStats = {}) {
  const kcal = dailyTarget.kcal || 0;
  const band = Math.max(50, kcal * 0.03);
  const proteinFloor = dailyTarget.proteinLo != null ? dailyTarget.proteinLo : proteinMid(dailyTarget);

  const hard = {
    exclusions: leaf({ dietaryStyle: profile.dietaryStyle || "none", excludedFoods: Array.isArray(profile.excludedFoods) ? [...profile.excludedFoods] : [] }, "profile", "hard", 0),
    energy: leaf({ kcal, lo: round(kcal - band), hi: round(kcal + band) }, "target", "hard", 0),
    proteinFloor: leaf({ g: round(proteinFloor) }, "target", "hard", 0),
  };

  const soft = {
    portion: leaf({ min: 0.5, max: 2 }, "engine", "soft", 1),
    batch: leaf({ allow: profile.allowBatch ?? null }, "profile", "soft", 2),
    complexity: leaf({ max: profile.maxComplexity ?? null }, "profile", "soft", 3),
    time: leaf({ maxPrepMin: profile.maxPrepMin ?? null }, "profile", "soft", 4),
    budget: leaf({ tier: profile.budgetTier ?? null }, "profile", "soft", 5),
    carbBand: leaf({ lo: dailyTarget.carbLo ?? null, hi: dailyTarget.carbHi ?? null }, "target", "soft", 6, 0.075),
    fatBand: leaf({ lo: dailyTarget.fatLo ?? null, hi: dailyTarget.fatHi ?? null }, "target", "soft", 6, 0.075),
  };

  return { hard, soft, relaxations: [], meta: { catalogStats } };
}

/**
 * checkFeasibility(cs, catalogStats) -> { feasible, conflicts, relaxations, computed, fixes }.
 * feasible: true | false | null (INDETERMINATE). Pre-flight NECESSARY checks
 * only — a missing required input yields indeterminate, never a false pass.
 */
function checkFeasibility(cs, catalogStats = {}) {
  const conflicts = [];
  const fixes = [];
  const computed = {};
  let indeterminate = false;

  const stats = { ...(cs.meta?.catalogStats || {}), ...catalogStats };
  const energy = cs.hard.energy.value;
  const floor = cs.hard.proteinFloor.value.g;

  // 1. Catalog residue after exclusions.
  if (stats.compliantCount == null) indeterminate = true;
  else if (stats.compliantCount <= 0) {
    conflicts.push({ constraint: "exclusions", reason: "no compliant recipes remain after the diet/allergy filters" });
    fixes.push("Relax the dietary style or AI-generate compliant recipes.");
  }

  // 2. Protein-floor vs energy — is the required protein density reachable?
  const neededDensity = energy.kcal > 0 ? floor / energy.kcal : 0;
  computed.neededProteinPerKcal = round(neededDensity, 4);
  // A non-positive energy target can't be assessed as feasible: a real protein
  // floor makes it a conflict, otherwise indeterminate — NEVER a false pass. The
  // `: 0` density fallback must not skip the whole check into an implicit true.
  if (!(energy.kcal > 0)) {
    if (floor > 0) { conflicts.push({ constraint: "energy", reason: `energy target is non-positive (${energy.kcal} kcal) but the protein floor needs ${floor} g` }); fixes.push("Set a positive calorie target."); }
    else indeterminate = true;
  } else if (neededDensity > 0) {
    if (stats.bestProteinPerKcal == null) indeterminate = true;
    else {
      computed.bestProteinPerKcal = round(stats.bestProteinPerKcal, 4);
      if (stats.bestProteinPerKcal < neededDensity - 1e-9) {
        conflicts.push({ constraint: "proteinFloor", reason: `protein floor needs ~${round(neededDensity)} g/kcal; the densest compliant recipe gives ~${round(stats.bestProteinPerKcal)} g/kcal` });
        fixes.push("Lower the protein target, raise the energy band, or add high-protein recipes.");
      }
    }
  }

  // 3. Atwater identity — the protein + carb/fat floors must fit under the energy top.
  const carbLo = cs.soft.carbBand.value.lo;
  const fatLo = cs.soft.fatBand.value.lo;
  if (carbLo != null && fatLo != null) {
    const minKcal = floor * 4 + carbLo * 4 + fatLo * 9;
    computed.minMacroKcal = round(minKcal);
    if (minKcal > energy.hi + 1) {
      conflicts.push({ constraint: "energy", reason: `protein+carb+fat floors (~${round(minKcal)} kcal) exceed the top of the energy band (${energy.hi} kcal)` });
      fixes.push("Raise the calorie target or lower a macro floor.");
    }
  }

  // 4. Soft constraints impossible on their face (relaxable, not hard conflicts).
  const relaxations = [];
  if (cs.soft.time.value.maxPrepMin != null && cs.soft.time.value.maxPrepMin <= 0) relaxations.push({ constraint: "time", reason: "max prep time ≤ 0" });

  const feasible = conflicts.length > 0 ? false : indeterminate ? null : true;
  return { feasible, conflicts, relaxations, computed, fixes };
}

/**
 * satisfies(computedDay, cs) -> { ok, hardUnmet, softOutOfBand }. The
 * deterministic acceptance predicate the loop converges against — ok = every
 * HARD constraint met (energy band + protein floor). Soft band misses are
 * reported but don't fail acceptance on their own.
 */
function satisfies(computedDay = {}, cs) {
  const totals = computedDay.totals || computedDay;
  const hardUnmet = [];
  const softOutOfBand = [];

  const e = cs.hard.energy.value;
  const kcal = totals.kcal || 0;
  if (kcal < e.lo || kcal > e.hi) hardUnmet.push({ constraint: "energy", value: round(kcal), band: [e.lo, e.hi] });

  const floor = cs.hard.proteinFloor.value.g;
  // Fail-closed: `??` only catches null/undefined, so a NaN protein total would
  // slip past `NaN < floor` (false) and be reported MET. Treat non-finite as UNMET.
  const proteinRaw = totals.protein ?? totals.protein_g ?? 0;
  if (!(Number.isFinite(proteinRaw) && proteinRaw >= floor - 1e-9)) hardUnmet.push({ constraint: "proteinFloor", value: Number.isFinite(proteinRaw) ? round(proteinRaw) : null, floor });

  const inBand = (v, b) => b.lo == null || b.hi == null || (v >= b.lo && v <= b.hi);
  const carb = totals.carb ?? totals.carb_g ?? 0;
  const fat = totals.fat ?? totals.fat_g ?? 0;
  if (!inBand(carb, cs.soft.carbBand.value)) softOutOfBand.push({ constraint: "carbBand", value: round(carb) });
  if (!inBand(fat, cs.soft.fatBand.value)) softOutOfBand.push({ constraint: "fatBand", value: round(fat) });

  return { ok: hardUnmet.length === 0, hardUnmet, softOutOfBand };
}

// Widen/drop the lowest-priority ACTIVE soft constraint, logging the change.
// Returns a NEW ConstraintSet (pure); null when nothing soft is left to relax.
function relaxNext(cs) {
  for (const key of SOFT_ORDER) {
    const s = cs.soft[key];
    if (!s || !isActive(key, s.value)) continue;
    const relaxed = relaxLeaf(key);
    const next = { ...cs, soft: { ...cs.soft, [key]: { ...s, value: relaxed.value } }, relaxations: [...cs.relaxations, { constraint: key, priority: s.priority, from: s.value, to: relaxed.value, note: relaxed.note }] };
    return next;
  }
  return null;
}

function isActive(key, value) {
  if (key === "batch") return value.allow === false; // only a DISALLOW is a constraint to relax
  if (key === "complexity") return value.max != null;
  if (key === "time") return value.maxPrepMin != null;
  if (key === "budget") return value.tier != null;
  if (key === "carbBand" || key === "fatBand") return value.lo != null || value.hi != null;
  if (key === "portion") return value.min > 0.5 || value.max < 2; // only when tightened past default
  return false;
}

function relaxLeaf(key) {
  if (key === "batch") return { value: { allow: true }, note: "allow batch-cooking repeats" };
  if (key === "complexity") return { value: { max: null }, note: "drop complexity cap" };
  if (key === "time") return { value: { maxPrepMin: null }, note: "drop max prep time" };
  if (key === "budget") return { value: { tier: null }, note: "drop budget tier" };
  // Bands DROP to inactive in one step so the ladder always TERMINATES. The prior
  // "widen ~15%" never nulled the band, so isActive stayed true and relaxNext
  // re-widened the same band forever (never reaching fatBand or returning null).
  if (key === "carbBand") return { value: { lo: null, hi: null }, note: "drop carb band" };
  if (key === "fatBand") return { value: { lo: null, hi: null }, note: "drop fat band" };
  if (key === "portion") return { value: { min: 0.5, max: 2 }, note: "reset portion bounds" };
  return { value: {}, note: "no-op" };
}

module.exports = { compileConstraints, checkFeasibility, satisfies, relaxNext, SOFT_ORDER };
