// The provenance decision engine.
//
// Both scripts/auditFoodProvenance.mjs (read-only report) and
// scripts/repairFoodProvenance.mjs (writes) call `decideRow` / `auditFoods`,
// so the report can never describe a different decision than the repair
// actually applies.
//
// Every row that claims an fdcId gets exactly one of four verdicts:
//
//   verified   the name genuinely denotes the FDC record it points at.
//              Macros are refreshed FROM that record and the row is promoted
//              to source "usda-verified".
//   rematched  the name does NOT denote its current record, but it denotes
//              exactly one OTHER FDC record by exact token equality. fdcId and
//              macros are both replaced.
//   downgraded the name does not denote its record and nothing else can be
//              confidently matched. The false fdcId is REMOVED, source drops
//              off the USDA tier, and dataQuality records precisely what was
//              wrong. Macros are retained but explicitly marked unverified —
//              we do not invent a replacement number.
//   curated    a human-reviewed entry in data/foodOverrides.json owns this
//              row's numbers. Its macros are never touched; only provenance is
//              corrected.
//
// The bias is deliberate and one-directional: when the evidence is not
// conclusive the row is downgraded, never guessed at. An honestly-labelled
// unknown is a correct row; a confidently wrong number is not.

const { validateFood, checkNameShape } = require("../../src/lib/foodValidation.js");
const { loadFoodOverrides } = require("../../src/lib/foodOverrides.js");
const { CATEGORY_SLUGS } = require("../../src/lib/foodCategories.js");
const { agreement, findConfidentMatch } = require("./fdcMatch.js");

// Provenance tiers, per the Food.source comment in schema.prisma.
const TIER_USDA = "usda-verified";
// Legacy rows whose USDA claim did not survive verification. They are not
// label data and not AI-estimated, so "manual" (hand-entered / pre-import
// legacy) is the honest landing tier; dataQuality carries the detail.
const TIER_UNVERIFIED = "manual";

const MACRO_EPSILON = 0.5;

const macrosDiffer = (row, rec) =>
  Math.abs(row.kcal - rec.kcal) > MACRO_EPSILON ||
  Math.abs(row.protein - rec.protein) > MACRO_EPSILON ||
  Math.abs(row.fat - rec.fat) > MACRO_EPSILON ||
  Math.abs(row.carb - rec.carb) > MACRO_EPSILON;

/** Validator verdict for the dataQuality column. */
function qualityVerdict(food, exemptions) {
  const nameKey = (food.name || "").trim().toLowerCase();
  const exemption = exemptions?.[nameKey];
  const { ok, issues } = validateFood(food, { exemptions, validCategories: CATEGORY_SLUGS });
  if (ok) {
    return exemption?.atwaterExempt
      ? `exception:atwater-exempt — ${exemption.reason || exemption.note || "documented physical exception"}`
      : "pass";
  }
  return `warn:${issues.map((i) => i.code).join(",")} — ${issues.map((i) => i.detail).join("; ")}`;
}

/**
 * Decide what should happen to one Food row.
 *
 * @param {object} row      Food row from Prisma
 * @param {Map}    byFdcId  fdcId -> normalized FDC record
 * @param {object} index    buildMatchIndex() output
 * @param {object} exemptions loadFoodOverrides() output
 * @returns {object} decision
 */
function decideRow(row, byFdcId, index, exemptions) {
  const nameKey = (row.name || "").trim().toLowerCase();
  const override = exemptions?.[nameKey];
  const curatedValues = override && typeof override.kcal === "number";

  const base = { id: row.id, name: row.name, category: row.category, fdcId: row.fdcId, source: row.source };

  if (row.fdcId == null) {
    return { ...base, verdict: "untouched", reason: "no fdcId claimed", changes: null };
  }

  const record = byFdcId.get(row.fdcId);

  // A row whose macros are human-curated keeps them no matter what the FDC
  // record says — that decision was already reviewed by a person.
  if (curatedValues) {
    const agrees = record ? agreement(row.name, record.description) : null;
    const keepId = agrees?.verdict === "likely-correct";
    return {
      ...base,
      verdict: "curated",
      reason: `data/foodOverrides.json owns this row's macros (${override.note || "curated correction"})`,
      fdcDescription: record?.description ?? null,
      changes: {
        fdcId: keepId ? row.fdcId : null,
        source: keepId ? TIER_USDA : TIER_UNVERIFIED,
        dataQuality: keepId
          ? `pass — curated values, fdcId ${row.fdcId} confirmed as "${record.description}"`
          : `exception:curated-override — macros come from data/foodOverrides.json (${override.note || "curated correction"})`
          + (record ? `; prior fdcId ${row.fdcId} ("${record.description}") did not denote this food and was removed` : "; prior fdcId unresolvable and was removed"),
      },
    };
  }

  if (!record) {
    return {
      ...base,
      verdict: "downgraded",
      reason: `fdcId ${row.fdcId} is not present in the FDC Foundation / SR Legacy / Survey datasets — the claim cannot be verified`,
      fdcDescription: null,
      changes: {
        fdcId: null,
        source: TIER_UNVERIFIED,
        dataQuality: `exception:unverifiable-fdcid — claimed FDC id ${row.fdcId} is not in the Foundation/SR Legacy/Survey datasets; provenance removed, macros retained but unverified`,
      },
    };
  }

  const agrees = agreement(row.name, record.description);

  if (agrees.verdict === "likely-correct") {
    const refreshed = {
      ...row, kcal: record.kcal, protein: record.protein, fat: record.fat, carb: record.carb, fiber: record.fiber,
      source: TIER_USDA,
    };
    const quality = qualityVerdict(refreshed, exemptions);
    return {
      ...base,
      verdict: "verified",
      reason: agrees.reason,
      stateRelaxed: !!agrees.stateRelaxed,
      fdcDescription: record.description,
      macrosChanged: macrosDiffer(row, record),
      changes: {
        fdcId: row.fdcId,
        kcal: record.kcal, protein: record.protein, fat: record.fat, carb: record.carb, fiber: record.fiber,
        source: TIER_USDA,
        dataQuality: quality === "pass"
          ? `pass — fdcId ${record.fdcId} "${record.description}" (${record.dataType})`
          : quality,
      },
      record,
    };
  }

  // Suspect. Is there exactly one other FDC record this name denotes?
  const match = findConfidentMatch(row.name, index);
  if (match.ok) {
    const candidate = {
      ...row, kcal: match.record.kcal, protein: match.record.protein, fat: match.record.fat,
      carb: match.record.carb, fiber: match.record.fiber, source: TIER_USDA,
    };
    const own = validateFood(candidate, { exemptions, validCategories: CATEGORY_SLUGS });
    const shape = checkNameShape(candidate);
    if (own.ok && shape.length === 0) {
      return {
        ...base,
        verdict: "rematched",
        reason: `${agrees.reason}; re-derived from FDC ${match.record.fdcId} "${match.record.description}" by exact token equality`,
        fdcDescription: record.description,
        newDescription: match.record.description,
        changes: {
          fdcId: match.record.fdcId,
          kcal: match.record.kcal, protein: match.record.protein, fat: match.record.fat,
          carb: match.record.carb, fiber: match.record.fiber,
          source: TIER_USDA,
          dataQuality: `pass — re-derived; fdcId ${match.record.fdcId} "${match.record.description}" (${match.record.dataType}); replaced mismatched fdcId ${row.fdcId} "${record.description}"`,
        },
        record: match.record,
      };
    }
    return {
      ...base,
      verdict: "downgraded",
      reason: `${agrees.reason}; the one candidate FDC record ("${match.record.description}") fails validation under this name (${[...own.issues.map((i) => i.code), ...shape].join("; ")})`,
      fdcDescription: record.description,
      changes: downgradeChanges(row, record),
    };
  }

  return {
    ...base,
    verdict: "downgraded",
    reason: `${agrees.reason}; ${match.reason}`,
    fdcDescription: record.description,
    changes: downgradeChanges(row, record),
  };
}

function downgradeChanges(row, record) {
  const copied = !macrosDiffer(row, record);
  return {
    fdcId: null,
    source: TIER_UNVERIFIED,
    dataQuality:
      `exception:provenance-cleared — carried fdcId ${record.fdcId} ("${record.description}"), whose description does not denote this food; `
      + (copied
        ? `this row's macros are that record's values verbatim and are therefore NOT this food's numbers`
        : `macros retained but unverified`)
      + `; no FDC record matches this name unambiguously, so no replacement was guessed`,
  };
}

/**
 * Audit every food row. Returns decisions plus duplicate-group context.
 */
function auditFoods(foods, byFdcId, index, exemptions) {
  const decisions = foods.map((f) => decideRow(f, byFdcId, index, exemptions));
  const byId = new Map(decisions.map((d) => [d.id, d]));

  const groups = new Map();
  for (const f of foods) {
    if (f.fdcId == null) continue;
    if (!groups.has(f.fdcId)) groups.set(f.fdcId, []);
    groups.get(f.fdcId).push(f);
  }
  const duplicateGroups = [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([fdcId, members]) => {
      const cats = [...new Set(members.map((m) => m.category))];
      const record = byFdcId.get(fdcId);
      return {
        fdcId,
        description: record?.description ?? null,
        dataType: record?.dataType ?? null,
        spansCategories: cats.length > 1,
        categories: cats,
        members: members.map((m) => ({ ...byId.get(m.id), kcal: m.kcal })),
      };
    })
    .sort((a, b) => b.members.length - a.members.length);

  const tally = (list) => list.reduce((acc, d) => ((acc[d.verdict] = (acc[d.verdict] || 0) + 1), acc), {});
  const dupIds = new Set(duplicateGroups.map((g) => g.fdcId));
  const withFdc = decisions.filter((d) => d.fdcId != null);

  return {
    decisions,
    duplicateGroups,
    summary: {
      foods: foods.length,
      withFdcId: withFdc.length,
      duplicateGroupCount: duplicateGroups.length,
      duplicateRowCount: duplicateGroups.reduce((a, g) => a + g.members.length, 0),
      categorySpanningGroups: duplicateGroups.filter((g) => g.spansCategories).length,
      all: tally(decisions),
      inDuplicateGroups: tally(withFdc.filter((d) => dupIds.has(d.fdcId))),
      singletons: tally(withFdc.filter((d) => !dupIds.has(d.fdcId))),
      stateRelaxed: decisions.filter((d) => d.stateRelaxed).length,
    },
  };
}

module.exports = { decideRow, auditFoods, qualityVerdict, TIER_USDA, TIER_UNVERIFIED };
