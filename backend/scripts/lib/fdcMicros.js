// Build the `Food.micros` JSON from an FDC record, per the contract in
// src/lib/nutrients.js.
//
// THE LOAD-BEARING RULE: absent ≠ zero.
//   - key missing from the object  -> this food's FDC profile does not report
//                                     that nutrient ("we don't know")
//   - key present with value 0     -> FDC reports a real, measured 0
//   - micros === null              -> no micronutrient data at all
// Writing 0 for "not reported" would silently corrupt every daily total that
// aggregates these — the same class of bug as a confidently wrong macro, just
// entered from the other side. So nothing here ever defaults a missing
// nutrient to a number.
//
// Units are converted into the registry's canonical unit for each key. A unit
// FDC reports that is not a mass (IU, and anything unrecognised) is DROPPED
// with a warning rather than converted by a guessed factor — IU→mcg depends on
// the specific vitamer and cannot be done generically.

const { NUTRIENT_LIST, convertUnit } = require("../../src/lib/nutrients.js");

// FDC spells units inconsistently across datasets ("G"/"g", "UG"/"µg"/"ug").
const UNIT_ALIASES = {
  g: "g", gram: "g", grams: "g",
  mg: "mg",
  ug: "mcg", mcg: "mcg", "µg": "mcg", "μg": "mcg", // U+00B5 and U+03BC both occur
};

/** Normalize an FDC unitName to a registry unit, or return it lowercased if unknown. */
function normalizeUnit(unitName) {
  const raw = String(unitName ?? "").trim().toLowerCase();
  return UNIT_ALIASES[raw] || raw;
}

const CONVERTIBLE = new Set(["g", "mg", "mcg"]);

// Only nutrients that actually live in the JSON column: `sourceField` entries
// (currently fiber) have a dedicated scalar column and must never be
// duplicated here, or the two can drift apart.
const MICRO_NUTRIENTS = NUTRIENT_LIST.filter((n) => !n.sourceField);
const BY_FDC_ID = new Map(MICRO_NUTRIENTS.map((n) => [n.fdcId, n]));

const round = (n) => {
  if (!Number.isFinite(n)) return null;
  // 6 significant-ish decimals: enough for mcg-scale values, short enough to
  // keep the JSON column small across tens of thousands of rows.
  return Math.round(n * 1e6) / 1e6;
};

/**
 * @param {object} record raw FDC food record (with foodNutrients[])
 * @returns {{ micros: object|null, dropped: Array<{key,unit,reason}>, count:number }}
 */
function extractMicros(record) {
  const micros = {};
  const dropped = [];
  const seen = new Set();

  for (const fn of record.foodNutrients || []) {
    const id = fn.nutrient?.id;
    if (id == null) continue;
    const spec = BY_FDC_ID.get(id);
    if (!spec || seen.has(spec.key)) continue;
    // No amount = FDC did not report a value for this food. Honest absence.
    if (typeof fn.amount !== "number" || !Number.isFinite(fn.amount)) continue;

    const unit = normalizeUnit(fn.nutrient.unitName);
    if (!CONVERTIBLE.has(unit)) {
      dropped.push({ key: spec.key, unit: fn.nutrient.unitName, reason: "non-mass unit — no generic conversion exists" });
      continue;
    }
    let value;
    try {
      value = convertUnit(fn.amount, unit, spec.unit);
    } catch (e) {
      dropped.push({ key: spec.key, unit: fn.nutrient.unitName, reason: e.message });
      continue;
    }
    const v = round(value);
    if (v == null) continue;
    // Negative amounts are data errors, not measurements.
    if (v < 0) { dropped.push({ key: spec.key, unit, reason: `negative amount ${v}` }); continue; }
    micros[spec.key] = v;
    seen.add(spec.key);
  }

  const count = Object.keys(micros).length;
  return { micros: count ? micros : null, dropped, count };
}

module.exports = { extractMicros, normalizeUnit, MICRO_NUTRIENTS, BY_FDC_ID, CONVERTIBLE };
