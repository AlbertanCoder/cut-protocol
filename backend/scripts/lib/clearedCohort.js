// Re-judging the `provenance-cleared` cohort — who gets released, who gets
// quarantined.
//
// THE COHORT
// ------------------------------------------------------------------------
// A prior repair pass found 470 Food rows whose claimed FDC record did not
// denote the food the row is named after. It did three honest things and one
// dishonest one: it wrote a plain-English confession into `dataQuality`, it
// stripped the false `usda-verified` claim down to `manual`, it nulled the
// `fdcId` — and it LEFT THE WRONG NUMBERS in `kcal`/`protein`/`fat`/`carb`,
// which are the columns the app actually reads. 469 of those rows are used by
// 779 of 889 recipes.
//
// TWO JOBS, IN THIS ORDER
// ------------------------------------------------------------------------
//   1. RELEASE the rows that were only ever conservative false positives — the
//      cleared record genuinely IS this food, the app's display name was just
//      terser than USDA's. Those get their fdcId and `usda-verified` back.
//   2. QUARANTINE everything else, so the app refuses to serve those macros as
//      truth (see isQuarantined / macroTrustIssue in src/lib/foodValidation.js).
//
// WHY THE RELEASE RULE IS SO MUCH NARROWER THAN IT LOOKS LIKE IT SHOULD BE
// ------------------------------------------------------------------------
// The obvious move is to re-run fdcMatch's `agreement()` and keep whatever
// comes back likely-correct. That yields ZERO — `agreement()` is what condemned
// these rows in the first place. The next move is to relax it: forgive the
// stemmer's mangling of -es plurals ("limes" -> "lim"), forgive FDC's leading
// taxonomy noun, forgive preparation words. Run against the real cohort, that
// relaxation proposes:
//
//     "Potatoes"  <- "Bread, potato"        266 kcal   (real potato: 77)
//     "Onion Salt" <- "Onions, cooked, boiled, drained, with salt"
//     "Ground Clove" <- "Spices, cloves, ground"
//     "Mackerel"  <- "Fish, mackerel, salted"
//
// The first of those is verbatim the failure fdcMatch.js's own header documents
// ("Onion" -> "Bread, onion") from the one time this rule was loosened. Dropping
// FDC's leading noun is only safe when that noun is a category; when it is the
// food and the trailing word is the flavour, it inverts the meaning of the
// record. So this file does NOT drop it, and pays for that with lost true
// positives ("Monterey Jack Cheese" <- "Cheese, monterey jack, solid" is real
// and is refused anyway).
//
// What survives is: the row name accounts for EVERY content token of the FDC
// description, except at most one soft cooking state that the name leaves
// implicit, and the row's macros are already that record's numbers verbatim, so
// restoring the pointer asserts nothing the row did not already claim.
//
// It releases 6 of 470. That is the honest number. The near-miss band — rows
// with no extra tokens and one or two unaccounted-for ones — contains
// "Flour" <- "Arrowroot flour", "Apples" <- "Croissants, apple", "Bread" <-
// "Bread, cheese", "Tofu" <- "Tofu yogurt" and "Brown Rice" <- "Flour, rice,
// brown" sitting immediately next to the genuine matches, with nothing in the
// names to separate them. There is no threshold that takes the good ones and
// leaves those. `nearMisses()` below emits that band as a HAND-VERIFICATION
// queue rather than pretending a rule can decide it.

const { contentTokens, SOFT_STATE, HARD_STATE } = require("./fdcMatch.js");

// `nameKey`'s plural stemmer mangles -es plurals of e-final words: "limes" ->
// "lim", "spices" -> "spic", "berries" -> "berri". A token that differs from
// its counterpart ONLY by that mangling is the same word, not a new claim.
const destem = (t) => t.replace(/[ei]$/, "");
const stemEq = (a, b) => a === b || destem(a) === destem(b);
const covers = (set, t) => [...set].some((u) => stemEq(t, u));

// Beyond fdcMatch's SOFT_STATE. "fresh" is the default reading of a bare herb
// or produce name and does not change density (that is what "dried" does, and
// "dried" is in HARD_STATE). All three are already on ingredientResolver's
// DESCRIPTOR_TOKENS allowlist, which is curated under an explicit rule that
// nothing on it may materially change macro density.
const EXTRA_SOFT_STATE = new Set(["fresh", "chilled", "refrigerated"]);
const isSoftState = (t) => SOFT_STATE.has(t) || EXTRA_SOFT_STATE.has(t);
const isAnyState = (t) => isSoftState(t) || HARD_STATE.has(t);

// Only ONE state may be left implicit. "Cucumber" <- "Cucumber, peeled, raw"
// (2) is probably fine; "Onion Salt" <- "Onions, cooked, boiled, drained, with
// salt" (3) is not, and no rule reading only names tells them apart. One is the
// line where the FDC description is still describing the plain ingredient.
const MAX_IMPLICIT_STATES = 1;

const RE_CARRIED = /carried fdcId (\d+) \("([^"]*)"\)/;
const RE_VERBATIM = /macros are that record's values verbatim/;
const MACRO_EPSILON = 0.5;

/** Is this row part of the provenance-cleared cohort? */
const isCleared = (row) => (row.dataQuality || "").includes("provenance-cleared");

/**
 * Pull the fdcId the confession names back out of `dataQuality`. The repair
 * nulled the column but wrote the id into the sentence, which is the only
 * surviving record of what this row used to point at.
 */
function carriedRecord(row) {
  const m = RE_CARRIED.exec(row.dataQuality || "");
  if (!m) return null;
  return { fdcId: Number(m[1]), description: m[2], macrosAreVerbatim: RE_VERBATIM.test(row.dataQuality) };
}

const macrosMatch = (row, rec) =>
  ["kcal", "protein", "fat", "carb"].every((k) => Math.abs((row[k] || 0) - (rec[k] || 0)) <= MACRO_EPSILON);

/**
 * Should this cleared row get its USDA provenance back?
 *
 * @param {object} row      Food row
 * @param {Map}    byFdcId  fdcId -> normalized FDC record (scripts/lib/fdcDataset)
 * @returns {{release:boolean, reason:string, fdcId?:number, record?:object,
 *            implicit?:string[], nearMiss?:boolean, missing?:string[]}}
 */
function reviewClearedRow(row, byFdcId) {
  const carried = carriedRecord(row);
  if (!carried) return { release: false, reason: "dataQuality does not name the fdcId that was cleared" };

  const record = byFdcId.get(carried.fdcId);
  if (!record) return { release: false, reason: `cleared fdcId ${carried.fdcId} is not in the FDC datasets` };

  if (!carried.macrosAreVerbatim || !macrosMatch(row, record)) {
    return {
      release: false,
      reason: `this row's macros are not FDC ${carried.fdcId}'s numbers, so confirming the name would not confirm the numbers`,
    };
  }

  const R = contentTokens(row.name);
  const F = contentTokens(record.description);
  if (!R.size || !F.size) return { release: false, reason: "name or FDC description has no content tokens" };

  // Direction 1 — the row name may not introduce anything FDC does not have.
  const extra = [...R].filter((t) => !covers(F, t));
  if (extra.length) {
    return { release: false, reason: `name introduces token(s) the FDC description lacks: ${extra.join(", ")}` };
  }

  // Direction 2 — the row name must account for EVERY content token of the FDC
  // description. No taxonomy-prefix drop: see the header.
  const missing = [...F].filter((t) => !covers(R, t));
  if (!missing.length) {
    return { release: true, reason: "name and FDC description denote the same food", fdcId: record.fdcId, record, implicit: [] };
  }

  const nearMiss = missing.length <= 2;
  const hard = missing.filter((t) => HARD_STATE.has(t));
  if (hard.length) {
    return { release: false, nearMiss, missing, reason: `FDC states a form that changes density: ${hard.join(", ")}` };
  }
  const substantive = missing.filter((t) => !isSoftState(t));
  if (substantive.length) {
    return { release: false, nearMiss, missing, reason: `FDC description carries token(s) the name does not account for: ${substantive.join(", ")}` };
  }
  if (missing.length > MAX_IMPLICIT_STATES) {
    return { release: false, nearMiss, missing, reason: `FDC describes ${missing.length} preparation steps (${missing.join(", ")}) — too prepared to be the plain ingredient` };
  }
  // The name must not claim a preparation of its own, or we would be
  // overwriting the row's own statement with FDC's.
  const claimed = [...R].filter(isAnyState);
  if (claimed.length) {
    return { release: false, nearMiss, missing, reason: `the name states its own preparation (${claimed.join(", ")}), so FDC's "${missing.join(", ")}" cannot be assumed` };
  }

  return {
    release: true,
    reason: `name denotes the FDC food; FDC additionally states "${missing.join(", ")}", which the name leaves implicit`,
    fdcId: record.fdcId,
    record,
    implicit: missing,
  };
}

/**
 * Review the whole cohort and resolve fdcId collisions.
 *
 * `fdcId` is `@unique` on Food — the constraint that made this bug class
 * unrepresentable going forward. So the id itself can only be restored if
 * nothing else holds it. In practice, for every row this rule accepts, SOMETHING
 * ELSE DOES: the later FDC bulk import created a properly-named `usda-verified`
 * row for the same record, so "Parsley" (81 recipe references) sits next to
 * "Parsley, fresh" (1), both at 36 kcal, both correct, and only the terser one
 * got condemned.
 *
 * That is a duplicate-row problem wearing a provenance problem's clothes, and
 * it changes the right answer. Quarantining "Parsley" would pull a CORRECT
 * number out of 81 recipes to fix nothing. So when the id is held by a twin
 * whose macros are identical, the row is released to `usda-verified` WITHOUT
 * the id, and the note records which row holds it. The proper end state is a
 * merge (scripts/mergeSynonymFoods.mjs) — this just stops the app lying about
 * six rows that were right all along.
 *
 * If the twin's macros DIFFER, that is a real conflict between two rows
 * claiming one record, and both stay untouched. Two cleared rows wanting the
 * same free id ("Coriander Leaves" and "Cilantro Leaves" both denote FDC
 * 169997) is an ambiguity, and an ambiguity is a refusal, not a tie-break.
 *
 * @param {Array} foods     every Food row
 * @param {Map}   byFdcId   fdcId -> FDC record
 */
function reviewCohort(foods, byFdcId) {
  const cohort = foods.filter(isCleared);
  const reviews = cohort.map((row) => ({ row, ...reviewClearedRow(row, byFdcId) }));

  const holder = new Map(foods.filter((f) => f.fdcId != null).map((f) => [f.fdcId, f]));
  const wanted = new Map();
  for (const r of reviews) if (r.release) {
    if (!wanted.has(r.fdcId)) wanted.set(r.fdcId, []);
    wanted.get(r.fdcId).push(r);
  }
  for (const [fdcId, group] of wanted) {
    const twin = holder.get(fdcId);
    if (twin) {
      for (const r of group) {
        if (macrosMatch(r.row, twin)) {
          r.twin = { id: twin.id, name: twin.name, source: twin.source };
          r.fdcId = null; // the twin keeps the id; Food.fdcId is unique
          r.reason = `${r.reason}; FDC ${fdcId} is held by "${twin.name}", whose macros are identical — same food, two rows, so the numbers are confirmed and the id stays with the twin (merge them next)`;
        } else {
          r.release = false;
          r.reason = `fdcId ${fdcId} is held by "${twin.name}" at ${twin.kcal} kcal against this row's ${r.row.kcal} — two rows disagree about one record, a person has to settle it`;
        }
      }
    } else if (group.length > 1) {
      const names = group.map((g) => `"${g.row.name}"`).join(", ");
      for (const r of group) { r.release = false; r.reason = `ambiguous — ${names} all denote FDC ${fdcId}, and only one row may hold it`; }
    }
  }

  return {
    cohort,
    reviews,
    released: reviews.filter((r) => r.release),
    quarantined: reviews.filter((r) => !r.release),
  };
}

/**
 * The band a human should look at: no extra tokens, one or two unaccounted-for
 * ones. Every entry here is EITHER a true match the rule refused to guess at
 * ("Semolina" <- "Semolina, enriched") OR a wrong record that looks identical
 * from the outside ("Flour" <- "Arrowroot flour"). Ordered by recipe usage so
 * the ones that move the most numbers get looked at first.
 */
function nearMisses(reviews, usageByFoodId = new Map()) {
  return reviews
    .filter((r) => !r.release && r.nearMiss)
    .map((r) => ({
      id: r.row.id,
      name: r.row.name,
      description: carriedRecord(r.row)?.description ?? null,
      missing: r.missing || [],
      kcal: r.row.kcal,
      recipeRefs: usageByFoodId.get(r.row.id) || 0,
      reason: r.reason,
    }))
    .sort((a, b) => b.recipeRefs - a.recipeRefs || a.name.localeCompare(b.name));
}

module.exports = {
  isCleared,
  carriedRecord,
  reviewClearedRow,
  reviewCohort,
  nearMisses,
  EXTRA_SOFT_STATE,
  MAX_IMPLICIT_STATES,
};
