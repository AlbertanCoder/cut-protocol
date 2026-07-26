import { C } from "../lib/theme.js";

// Grocery-store food categories — client mirror of
// backend/src/lib/foodCategories.js (slugs and labels must stay in sync;
// the backend side is pinned by tests). Order = display order.
export const FOOD_CATEGORIES = [
  { slug: "protein", label: "Protein" },
  { slug: "dairy-eggs", label: "Dairy & Eggs" },
  { slug: "fruit-veg", label: "Fruit & Veg" },
  { slug: "grains", label: "Grains & Carbs" },
  { slug: "fats-nuts-oils", label: "Fats, Nuts & Oils" },
  { slug: "pantry", label: "Pantry, Spices & Sauces" },
  { slug: "drinks", label: "Drinks" },
];

export const CATEGORY_LABEL = Object.fromEntries(FOOD_CATEGORIES.map((c) => [c.slug, c.label]));

// A raw slug is a database detail, never a thing to show a person. Every
// lookup below goes through a humanising fallback instead of `|| slug`, so an
// unmapped value degrades to "Dairy Eggs" rather than leaking `dairy-eggs`.
const humanize = (slug) =>
  String(slug || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

export const categoryLabel = (slug) => CATEGORY_LABEL[slug] || humanize(slug) || "Uncategorised";

// Category dots — NEUTRAL by law: the macro triad means macros ONLY and green
// is reserved (CLAUDE.md design constitution), so a category dot can borrow
// neither. Wayfinding is carried by a quiet LIGHTNESS ramp of the single
// off-white ink (the app's "elevation is lightness" language), brightest at
// the top of the shopping order down to the dimmest — never a hue. The label
// still carries the exact meaning; the tier is an ordering cue. color-mix on
// var(--ink) keeps this to one token (no new color literal), matching the
// color-mix pattern already used in ui/Parts.jsx.
const CATEGORY_TIER = {
  protein: 82, "dairy-eggs": 70, "fruit-veg": 60, grains: 50,
  "fats-nuts-oils": 42, pantry: 34, drinks: 27,
};
export const CATEGORY_DOT = (slug) =>
  `color-mix(in srgb, ${C.ink} ${CATEGORY_TIER[slug] ?? 38}%, transparent)`;

// Provenance tiers, keyed on the values the DB actually stores (see the
// `source` column in backend/prisma/schema.prisma). The key here USED to be
// "usda" while every row on disk says "usda-verified" — 13,516 of 14,122 rows
// fell through to the raw-slug fallback and rendered "usda-verified" instead
// of the constitutional "USDA-VERIFIED". Both keys are kept: the schema
// comment is the source of truth, "usda" stays as a legacy alias so an older
// row can never regress to a slug.
export const SOURCE_LABEL = {
  "usda-verified": "USDA-VERIFIED",
  "usda": "USDA-VERIFIED", // legacy alias — pre-rename rows
  "label": "LABEL",
  "manual": "LABEL / MANUAL",
  "manual-placeholder": "PLACEHOLDER — NO REAL DATA",
  "ai-estimated": "AI-ESTIMATED — VERIFY BEFORE USE",
  // Barcode-off track: Open Food Facts is crowd-sourced, materially lower
  // trust than the audited USDA core — never presented as the same tier.
  // "COMMUNITY" always renders with its source in parens so the distinction
  // reads even out of context (a tooltip, a CSV export, a screenshot).
  "community": "COMMUNITY (OPEN FOOD FACTS)",
  // Set on rows proven to carry another food's record (see quarantineNote).
  "quarantined": "QUARANTINED — NUMBERS NOT TRUSTED",
};

export const sourceLabel = (source) => SOURCE_LABEL[source] || humanize(source).toUpperCase() || "SOURCE UNKNOWN";

// dataQuality is the fiber-adjusted-Atwater verdict recorded at import time
// (see backend/src/lib/offImport.js): "pass" | "warn:<codes>" |
// "exception:<documented-reason>" | null. Only "warn" rows get a visible
// caution badge — "pass" is the silent default, same as every USDA/manual row
// that's never had a reason to say anything.
export function dataQualityFlag(food) {
  if (!food?.dataQuality || !food.dataQuality.startsWith("warn:")) return null;
  const codes = food.dataQuality.slice("warn:".length).split(",");
  const reason = codes.includes("atwater")
    ? "calories don't reconcile with the declared macros"
    : codes.includes("name-shape")
      ? "the name and the macros don't quite match"
      : "unverified";
  return { label: "UNVERIFIED MACROS", detail: `Unverified macros — ${reason}.` };
}

// ── The corruption an arithmetic check cannot see ────────────────────────
// 470 rows in this library carry another food's USDA record VERBATIM: a real,
// internally consistent tuple filed under the wrong name. kcal ≈ 4P + 4C + 9F
// passes perfectly on every one of them, which is exactly why the Atwater
// gate must never be sold as a warrant of correctness.
//
// The database already says so, per row, in `dataQuality`:
//   "exception:provenance-cleared — carried fdcId 169225 (\"Cucumber, peeled,
//    raw\"), whose description does not denote this food; this row's macros
//    are that record's values verbatim and are therefore NOT this food's
//    numbers; …"
// That sentence was written and then never rendered. This turns it into the
// short version a person can act on.
//
// Defensive on purpose: a parallel change moves these rows to
// source === "quarantined". Today they are still source "manual", so BOTH
// signals are accepted and this reads correctly before and after that lands.
// Amber, never red (design law b) — wrong data is a caveat about the record,
// not a verdict on the food.
// Tolerant of whitespace after the colon: one row in the wild reads
// "exception: unverified" with a stray space, and an anchored match without
// \s* silently treats it as a clean row.
const PROVENANCE_CLEARED = /^exception:\s*provenance-cleared\b/;

// Trust is revoked by the CLAIM, not by the exception code. Measured against
// the live 14,122-row library: "carried fdcId <n>" appears on exactly 471 rows
// — the 470 provenance-cleared set, plus `Rye`, whose code is the typo above.
// Zero of the other 505 documented exceptions mention a carried record
// (usda-source-model 337, alcohol-energy 153, curated-override 7,
// atwater-exempt 6, unverifiable-fdcid 2), so this predicate is exact in both
// directions and does not widen the amber net by a single row.
//
// The point is that a code-name whitelist can only ever catch the codes
// somebody remembered to write down. `Rye` says in its own sentence that its
// macros are rye BREAD's, and still rendered as fully trusted everywhere,
// because one typo put it outside the list. Match what the row asserts.
//
// Parentheses are optional for the same reason: 470 rows read
// `carried fdcId 169225 ("Cucumber, peeled, raw")` and the odd one out reads
// `carried fdcId 172684 "Bread, rye"`. Requiring them cost that row its
// detail sentence on top of its flag.
const CARRIED_RECORD = /carried fdcId\s+(\d+)\s*\(?\s*"([^"]+)"/;

export function quarantineNote(food) {
  const dq = food?.dataQuality || "";
  if (
    food?.source !== "quarantined"
    && !PROVENANCE_CLEARED.test(dq)
    && !CARRIED_RECORD.test(dq)
  ) return null;
  const m = CARRIED_RECORD.exec(dq);
  const detail = m
    ? `These numbers are USDA record #${m[1]} — “${m[2]}” — copied verbatim. That is a different food, so they are not this food's values. They still add up, which is why the calorie check never caught it.`
    // No parseable provenance line: fall back to the row's own sentence,
    // minus the machine-readable "exception:<code> — " prefix.
    : dq.replace(/^[a-z-]+:\s*[a-z-]+\s*—\s*/i, "") ||
      "This row's macros came from another food's record — they are not this food's values.";
  return { label: "WRONG RECORD — NUMBERS NOT TRUSTED", detail };
}

/** The one caution a food row/detail should show, worst first. Null = quiet. */
export function foodWarning(food) {
  return quarantineNote(food) || dataQualityFlag(food);
}
