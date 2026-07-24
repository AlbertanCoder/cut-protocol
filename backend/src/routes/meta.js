const express = require("express");
const path = require("path");

const router = express.Router();

// Public, non-personal build metadata for the bug-report footer (version + OS).
// Deliberately NOT behind requireAuth and deliberately carries zero user data.
let cached = null;
function buildMeta() {
  if (cached) return cached;
  let version = "unknown";
  try {
    version = require(path.join(__dirname, "..", "..", "..", "package.json")).version || "unknown";
  } catch {
    /* dev-tree layout differs; leave "unknown" */
  }
  cached = {
    version,
    platform: process.platform, // "win32" | "darwin" | "linux"
    arch: process.arch,
    node: process.versions.node,
    packaged: !!process.env.CUT_PROTOCOL_DB_PATH, // set only in the packaged Electron build
  };
  return cached;
}

router.get("/", (_req, res) => res.json(buildMeta()));

// ── Allergen taxonomy — Stage 1, "Allergies 2.0" ───────────────────────────
//
// Read-only vocabulary for the allergen picker (Profile tab + first-run
// wizard). Served rather than mirrored client-side so the searchable list can
// never drift from the matcher's own source — the same rule /api/profile/meta
// already follows for occupations and dietary styles.
//
// TWO DELIBERATE CHOICES HERE:
//
//  1. The taxonomy module is required LAZILY inside a try/catch. It is owned
//     by the dietary-filter half of this stage and may legitimately not exist
//     yet, or be mid-rewrite. A missing or broken taxonomy must degrade to
//     "unavailable" — it may never take the server's boot, this endpoint, or
//     the allergy UI down. The UI falls back to /api/profile/meta's
//     allergyOptions quick list, which keeps working regardless.
//
//  2. Only { key, label, synonyms } is published. nameKeywords / fdcCategories
//     / offTags are MATCHER internals: the screen has no business rendering
//     them, and shipping them invites someone to re-implement enforcement in
//     the browser. Enforcement stays in dietaryFilter.js, server-side.
//
// Public (no auth), like the rest of this router: static vocabulary, zero
// user data.
let taxonomyCache = null; // cached only on success — a miss must stay retryable

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** Pull the taxonomy array out of whatever shape the module exports. */
function readTaxonomyModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../lib/allergenTaxonomy.js");
  const raw =
    (Array.isArray(mod) && mod) ||
    (Array.isArray(mod?.ALLERGEN_TAXONOMY) && mod.ALLERGEN_TAXONOMY) ||
    (Array.isArray(mod?.TAXONOMY) && mod.TAXONOMY) ||
    (Array.isArray(mod?.taxonomy) && mod.taxonomy) ||
    null;
  if (!raw) throw new Error("allergenTaxonomy.js exports no taxonomy array");
  return raw;
}

function loadTaxonomy() {
  if (taxonomyCache) return taxonomyCache;
  try {
    const entries = readTaxonomyModule()
      .map((e) => ({
        key: str(e?.key) || str(e?.label).toLowerCase(),
        label: str(e?.label) || str(e?.key),
        synonyms: Array.isArray(e?.synonyms) ? e.synonyms.map(str).filter(Boolean) : [],
      }))
      .filter((e) => e.key && e.label);
    if (!entries.length) throw new Error("allergen taxonomy is empty");
    taxonomyCache = { available: true, count: entries.length, taxonomy: entries, reason: null };
    return taxonomyCache;
  } catch (e) {
    // 200, not 5xx: "there is no taxonomy on this build" is a normal answer the
    // client is designed to handle, not a transport failure it should retry as
    // an error. The reason is stated out loud so nothing fails silently — but
    // it is a SUMMARY, never the raw error: require() failures carry absolute
    // filesystem paths (i.e. the machine's username) and this response is
    // rendered on screen. Full detail goes to the server log only.
    console.warn("[meta] allergen taxonomy unavailable:", e.message);
    return {
      available: false,
      count: 0,
      taxonomy: [],
      reason: e.code === "MODULE_NOT_FOUND"
        ? "the allergen list isn't installed on this build"
        : "the allergen list couldn't be loaded",
    };
  }
}

router.get("/allergens", (_req, res) => res.json(loadTaxonomy()));

// ── How each saved exclusion will ACTUALLY be matched ──────────────────────
//
// dietaryFilter.describeExclusionTerms() has always distinguished "we
// understand this allergen category" from "we are grepping your text", and
// until now nothing rendered it — a user typing "sesamee" had no way to learn
// that only a literal substring match was protecting them. Silent partial
// failure is banned by CLAUDE.md, so the signal gets a surface.
//
// Pure function over terms supplied in the request: reads no user record,
// writes nothing, stores nothing. Lazy require + try/catch for the same
// reason as above (dietaryFilter is being edited alongside this).
router.post("/allergens/describe", (req, res) => {
  const raw = Array.isArray(req.body?.terms) ? req.body.terms : [];
  // Mirrors the profile route's own excludedFoods bounds (max 40, ≤60 chars).
  const terms = raw.filter((t) => typeof t === "string" && t.trim() && t.length <= 60).slice(0, 40);
  if (!terms.length) return res.json({ available: true, described: [] });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { describeExclusionTerms } = require("../lib/dietaryFilter.js");
    if (typeof describeExclusionTerms !== "function") throw new Error("describeExclusionTerms is not exported");
    return res.json({ available: true, described: describeExclusionTerms(terms) });
  } catch (e) {
    // Never 500 here: this endpoint only ADDS an explanation. Losing it must
    // not break the allergy control, and the UI must be able to tell the
    // difference between "no explanation available" and "matched literally".
    // Summary reason only — see the note in loadTaxonomy() about paths.
    console.warn("[meta] describeExclusionTerms unavailable:", e.message);
    return res.json({ available: false, described: [], reason: "the matcher's explanation service is unavailable" });
  }
});

module.exports = router;
