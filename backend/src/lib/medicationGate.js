// THE MEDICATION GATE — the single authority on "is this plan safe to give
// THIS user, given what they take and what they're being treated for?"
//
// ── why this file exists ──────────────────────────────────────────────────
// The app ships keto as a dietary style and, until this module, asked nothing
// about medication. For one drug class that combination is genuinely
// dangerous, and — this is the part that matters — it is dangerous in a way
// no glucose check can catch.
//
// The current FDA label for empagliflozin (JARDIANCE, rev. 1/2026) lists,
// verbatim, among the precipitating factors for ketoacidosis:
//
//     "Reduced caloric intake"
//     "Ketogenic diet"
//
// Those are the two things this app does. The same label warns that
// presenting glucose "may be below those typically expected for diabetic
// ketoacidosis (e.g., less than 250 mg/dL)". Published cases presented at
// 137, 181, 183 and 238 mg/dL — readings a glucose-based guard would wave
// through. ADA Standards of Care 2026 §5, Rec 5.26 (Grade E) says to
// "discourage a ketogenic eating pattern" for these patients outright.
//
// ── the design rule: ask what they TAKE, not what they HAVE ───────────────
// The highest-severity triggers are all drug classes, and a person reliably
// knows they take Jardiance without knowing it is an SGLT2 inhibitor — or
// that "SGLT2 inhibitor" is a category at all. A diagnosis question misses
// them; a medication question catches them. So the drug table below carries
// BRAND names first and generics second, because brand names are what people
// type. Conditions are handled too, but only where the guidance is a flat
// refusal that no drug name would reveal (pregnancy being the obvious one).
//
// ── fails open on the unknown, and says so ────────────────────────────────
// An unrecognised medication is NOT silently ignored and NOT treated as
// dangerous. It is returned in `unrecognised` so the caller can surface it
// honestly ("we don't recognise this one — it isn't affecting your plan").
// Pretending to have screened something we didn't screen is the one failure
// mode worse than not screening.
//
// ── what this module does NOT do ──────────────────────────────────────────
// It changes no calorie, macro, TDEE, BMR or target calculation (CLAUDE.md
// rule 2). It returns FLOORS and REFUSALS as data; deciding what to do with
// them belongs to the caller. Nothing here is diagnostic, and no verdict
// says a user does or does not have a condition — only that a stated input
// matches a rule with a citable source.

const KETOGENIC_STYLES = new Set(["keto"]);

// Every entry: what a person might actually type → the class we recognise.
// Brands first. Generics second. Combination products listed explicitly
// because "Synjardy" contains no string that reveals its empagliflozin.
const DRUG_CLASSES = [
  {
    id: "sglt2",
    label: "SGLT2 inhibitor",
    terms: [
      // brands
      "jardiance", "farxiga", "forxiga", "invokana", "steglatro", "brenzavvy",
      // combination products — none of these reveal their component by name
      "synjardy", "glyxambi", "trijardy", "xigduo", "qtern", "qternmet",
      "invokamet", "segluromet", "steglujan",
      // generics
      "empagliflozin", "dapagliflozin", "canagliflozin", "ertugliflozin",
      "bexagliflozin", "sotagliflozin",
    ],
  },
  {
    id: "sulfonylurea",
    label: "sulfonylurea",
    terms: [
      "glucotrol", "diabeta", "micronase", "glynase", "amaryl", "diamicron",
      "glipizide", "glyburide", "glibenclamide", "glimepiride", "gliclazide",
      "chlorpropamide", "tolbutamide", "tolazamide",
    ],
  },
  {
    id: "glinide",
    label: "meglitinide",
    terms: ["prandin", "gluconorm", "starlix", "repaglinide", "nateglinide"],
  },
  {
    id: "insulin",
    label: "insulin",
    terms: [
      "insulin", "lantus", "levemir", "tresiba", "toujeo", "basaglar",
      "semglee", "humalog", "novolog", "novorapid", "apidra", "fiasp",
      "lyumjev", "humulin", "novolin", "admelog", "xultophy", "soliqua",
      "glargine", "detemir", "degludec", "lispro", "aspart", "glulisine",
    ],
  },
  {
    id: "glp1",
    label: "GLP-1 or dual agonist",
    terms: [
      "ozempic", "wegovy", "rybelsus", "victoza", "saxenda", "trulicity",
      "byetta", "bydureon", "mounjaro", "zepbound", "adlyxin", "lyxumia",
      "semaglutide", "liraglutide", "dulaglutide", "exenatide",
      "tirzepatide", "lixisenatide", "retatrutide",
    ],
  },
  {
    id: "levothyroxine",
    label: "levothyroxine",
    terms: [
      "synthroid", "levoxyl", "eltroxin", "euthyrox", "tirosint", "unithroid",
      "levothyroxine", "liothyronine", "cytomel",
    ],
  },
];

const CONDITIONS = [
  { id: "pregnant", label: "pregnancy" },
  { id: "breastfeeding", label: "breastfeeding" },
  { id: "ckd", label: "chronic kidney disease" },
  { id: "bariatric", label: "bariatric surgery" },
  { id: "type1", label: "type 1 diabetes" },
  { id: "eatingDisorder", label: "eating disorder history" },
];
const CONDITION_IDS = new Set(CONDITIONS.map((c) => c.id));

// Word-boundary matching, deliberately NOT substring. This repo has already
// paid for that lesson twice — "Sausages" contains "sage", "Pepper" matches
// "bell pepper". A naive includes() here would match "insulin" inside
// "insulin-like growth factor" and, worse, could miss nothing while claiming
// coverage it doesn't have.
function normalise(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(haystack, term) {
  if (!haystack || !term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

/**
 * Classify one free-text medication entry.
 * Returns the matching class descriptor, or null if we do not recognise it.
 */
function classifyMedication(raw) {
  const text = normalise(raw);
  if (!text) return null;
  for (const cls of DRUG_CLASSES) {
    for (const term of cls.terms) {
      if (containsTerm(text, term)) {
        return { id: cls.id, label: cls.label, matched: term, input: String(raw) };
      }
    }
  }
  return null;
}

/**
 * Classify a whole list. Returns { classes: Map<id, hit>, unrecognised: [] }.
 * One entry can only ever produce one class — first match wins, and the table
 * is ordered so the most consequential class is checked first.
 */
function classifyAll(medications) {
  const list = Array.isArray(medications) ? medications : [];
  const classes = new Map();
  const unrecognised = [];
  for (const entry of list) {
    if (!normalise(entry)) continue;
    const hit = classifyMedication(entry);
    if (hit) {
      if (!classes.has(hit.id)) classes.set(hit.id, hit);
    } else {
      unrecognised.push(String(entry).trim());
    }
  }
  return { classes, unrecognised };
}

const R = (code, severity, message, source, extra = {}) => ({
  code, severity, message, source, ...extra,
});

/**
 * The gate.
 *
 * @param {object} input
 * @param {string[]} input.medications   free text, as the user typed it
 * @param {string[]} input.conditions    ids from CONDITIONS
 * @param {string|null} input.dietaryStyle  the profile's dietaryStyle
 * @param {number|null} input.targetKcal    the derived daily target
 * @param {number|null} input.weeksPostPartum
 * @param {number|null} input.monthsPostOp
 *
 * @returns {object} verdict — never throws, never mutates its input.
 *   allowed        false when at least one REFUSE fired
 *   refusals[]     hard stops, each with a citable source
 *   warnings[]     surface these; do not block on them
 *   floors         { kcalMin, proteinMaxGPerKg } — advisory, caller applies
 *   unrecognised[] medications we could not classify, echoed back honestly
 */
function assessPlanSafety(input = {}) {
  const {
    medications = [],
    conditions = [],
    dietaryStyle = null,
    targetKcal = null,
    weeksPostPartum = null,
    monthsPostOp = null,
  } = input;

  const { classes, unrecognised } = classifyAll(medications);
  const has = (id) => classes.has(id);
  const hit = (id) => classes.get(id) || null;

  const cond = new Set(
    (Array.isArray(conditions) ? conditions : []).filter((c) => CONDITION_IDS.has(c))
  );

  const refusals = [];
  const warnings = [];
  const floors = {};

  const style = typeof dietaryStyle === "string" ? dietaryStyle.toLowerCase() : null;
  const isKetogenic = style ? KETOGENIC_STYLES.has(style) : false;
  const kcal = Number.isFinite(targetKcal) ? targetKcal : null;

  // ── 1. SGLT2 × ketogenic — the reason this module exists ───────────────
  if (has("sglt2") && isKetogenic) {
    refusals.push(R(
      "sglt2_ketogenic",
      "critical",
      "A ketogenic plan is not safe alongside an SGLT2 inhibitor. This drug class "
      + "can cause ketoacidosis while blood sugar still reads normal, and both a "
      + "ketogenic diet and reduced calories are listed triggers. Choose a "
      + "non-ketogenic plan, or speak to your prescriber first.",
      "FDA label, empagliflozin (JARDIANCE) rev. 1/2026 §5.1; ADA Standards of Care 2026 §5 Rec 5.26",
      { drug: hit("sglt2") }
    ));
  } else if (has("sglt2")) {
    warnings.push(R(
      "sglt2_deficit",
      "high",
      "Reduced calorie intake is itself a listed trigger for ketoacidosis on this "
      + "drug class. Your plan avoids ketogenic eating, but tell your prescriber "
      + "you are starting a deficit.",
      "FDA label, empagliflozin (JARDIANCE) rev. 1/2026 §5.1",
      { drug: hit("sglt2") }
    ));
  }

  // ── 2. Type 1 diabetes × very-low-carb ─────────────────────────────────
  if (cond.has("type1") && isKetogenic) {
    refusals.push(R(
      "type1_ketogenic",
      "critical",
      "A ketogenic plan needs specialist supervision in type 1 diabetes.",
      "ADA Standards of Care 2026 §5"
    ));
  }

  // ── 3. Hypoglycaemia risk — insulin, sulfonylureas, glinides ───────────
  const hypoClasses = ["insulin", "sulfonylurea", "glinide"].filter(has);
  if (hypoClasses.length) {
    warnings.push(R(
      "hypoglycaemia_dose_review",
      "high",
      "Eating less can cause low blood sugar on this medication even without a "
      + "dose change. Your prescriber may need to adjust the dose before you start.",
      "FDA labels, glipizide and glyburide — \"Hypoglycemia is more likely to occur when caloric intake is deficient\"",
      { drugs: hypoClasses.map(hit) }
    ));
    // The trial ADA cites for very-low-calorie diets withdrew these drugs
    // BEFORE the diet began. Below 1,000 kcal that stops being a warning.
    if (kcal !== null && kcal < 1000) {
      refusals.push(R(
        "diabetes_vlcd",
        "critical",
        "A plan under 1,000 calories a day on this medication needs to be "
        + "prescribed and monitored in a medical setting.",
        "ADA Standards of Care 2026 Rec 8.12 (Grade B); DiRECT trial protocol (Lancet 2018)",
        { drugs: hypoClasses.map(hit) }
      ));
    }
  }

  // ── 4. GLP-1 and dual agonists — raise floors, do not refuse ───────────
  if (has("glp1")) {
    warnings.push(R(
      "glp1_lean_mass",
      "medium",
      "Around a quarter of the weight lost on this medication is lean tissue. "
      + "Keep protein high and keep training — that is what protects it.",
      "SURMOUNT-1 DXA substudy; network meta-analysis of 22 RCTs",
      { drug: hit("glp1") }
    ));
    if (kcal !== null && kcal < 1200) {
      warnings.push(R(
        "glp1_micronutrient",
        "medium",
        "Nutritional deficiencies were found in about 13% of people on this drug "
        + "class at six months and over 22% at a year. Below 1,200 calories a day, "
        + "a multivitamin is advised.",
        "ADA Standards of Care 2026 §8, retrospective cohort n=461,382"
      ));
    }
  }

  // ── 5. Levothyroxine — a meal planner can silently break absorption ────
  if (has("levothyroxine")) {
    warnings.push(R(
      "levothyroxine_timing",
      "medium",
      "Take this either 60 minutes before breakfast or at bedtime, 3+ hours after "
      + "your evening meal — and keep it about 4 hours apart from calcium or iron. "
      + "Moving your breakfast, or adding a fortified or high-fibre one, can reduce "
      + "how much you absorb.",
      "American Thyroid Association guidelines (Jonklaas 2014), Rec 3a and 3b",
      { drug: hit("levothyroxine") }
    ));
  }

  // ── 6. Pregnancy — no authority endorses a deficit at any BMI ──────────
  if (cond.has("pregnant")) {
    refusals.push(R(
      "pregnancy_deficit",
      "critical",
      "No health authority endorses intentional weight loss during pregnancy, at "
      + "any starting weight. A maintenance plan is available instead.",
      "Institute of Medicine, Weight Gain During Pregnancy (2009)"
    ));
  }

  // ── 7. Breastfeeding — the one genuinely sourced floor in the set ──────
  if (cond.has("breastfeeding")) {
    floors.kcalMin = Math.max(floors.kcalMin || 0, 1500);
    if (Number.isFinite(weeksPostPartum) && weeksPostPartum < 3) {
      refusals.push(R(
        "postpartum_too_early",
        "critical",
        "Dieting is not recommended in the first two to three weeks after birth.",
        "IOM, Nutrition During Lactation (1991), Ch.5"
      ));
    } else {
      warnings.push(R(
        "lactation_floor",
        "high",
        "Your floor is raised to 1,500 calories a day while breastfeeding. Below "
        + "that, infant milk intake has been measured to drop by about 15%.",
        "IOM, Nutrition During Lactation (1991) — \"Intakes below 1,500 kcal/day are not recommended at any time during lactation\""
      ));
    }
  }

  // ── 8. CKD — our protein floor is 2-3x the guideline ceiling ───────────
  if (cond.has("ckd")) {
    floors.proteinMaxGPerKg = 0.8;
    refusals.push(R(
      "ckd_protein",
      "critical",
      "This app's protein target is far above the level recommended in kidney "
      + "disease. Your protein target needs to come from your kidney team, not "
      + "from here.",
      "KDOQI 2020 clinical practice guideline, statements 3.0.1 (Grade 1A) and 3.0.2"
    ));
  }

  // ── 9. Post-bariatric — already in a deficit by anatomy ────────────────
  if (cond.has("bariatric")) {
    if (Number.isFinite(monthsPostOp) && monthsPostOp < 6) {
      refusals.push(R(
        "bariatric_early",
        "critical",
        "In the first six months after bariatric surgery your intake is staged by "
        + "your surgical team, not by a meal planner.",
        "AACE/TOS/ASMBS/OMA/ASA 2019 perioperative nutrition guideline"
      ));
    } else {
      warnings.push(R(
        "bariatric_no_added_deficit",
        "high",
        "After bariatric surgery you are already eating at a reduced intake. This "
        + "plan should not add a further deficit on top, and your protein target "
        + "is set from ideal rather than current body weight.",
        "AACE/TOS/ASMBS/OMA/ASA 2019 perioperative nutrition guideline"
      ));
    }
  }

  // ── 10. Eating disorder — the app already screens; this closes the loop ─
  if (cond.has("eatingDisorder")) {
    refusals.push(R(
      "eating_disorder",
      "critical",
      "A calorie-deficit plan is not the right tool here. Support resources are "
      + "available in the app at any time.",
      "ADA Standards of Care 2026 §5; app design constitution"
    ));
  }

  return {
    allowed: refusals.length === 0,
    refusals,
    warnings,
    floors,
    unrecognised,
    recognised: [...classes.values()],
  };
}

module.exports = {
  DRUG_CLASSES,
  CONDITIONS,
  classifyMedication,
  classifyAll,
  assessPlanSafety,
};
