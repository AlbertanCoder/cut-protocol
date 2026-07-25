const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { mondayOf, dayNum } = require("../lib/dates.js");
const { recomputeTarget } = require("../lib/profileTarget.js");
const { foodMatchesExclusionTerm } = require("../lib/dietaryFilter.js");

const router = express.Router();
router.use(requireAuth);

// Logged intake is one of the two series the adaptive expenditure estimator
// reconciles (see lib/expenditureEstimator.js), so a diary write can move the
// derived target exactly as a weigh-in can. Best-effort: a target recompute
// must never FAIL a diary write — the next weigh-in or profile save re-derives.
//
// But "must not fail the write" is not the same as "must not be mentioned".
// The old body of this function was `catch { }` — an empty block — so a
// recompute that threw every single time left the user's calorie target
// silently stale while the diary itself looked perfectly healthy, and nothing
// anywhere said so. That is the exact shape of bug the constitution's "every
// automatic adjustment is logged and visible" clause exists to prevent.
//
// Now: the write still succeeds, the failure is logged server-side with its
// stack, and the response carries `targetStale: true` so the UI can say the
// target didn't re-derive instead of quietly showing yesterday's number.
async function refreshTargetQuietly(userId) {
  try {
    await recomputeTarget(userId);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[diary] target recompute failed for user ${userId} — the diary write stands, the target is stale until the next weigh-in or profile save:`, e);
    return false;
  }
}

// Sane bounds for a single logged food entry — big enough for a genuine large
// meal, small enough to reject fat-fingered / junk payloads (a single entry
// over 10,000 kcal or 2,000 g of one macro is not real food). Mirrors the
// bounds-then-type validation style the other routes use (weighins' 35-300 kg,
// plans' portion clamps) rather than an Atwater gate: the diary logs the user's
// ACTUAL intake (labels legitimately deviate from 4/4/9), so the constitution's
// food/recipe sanity gate — which guards LIBRARY data — is deliberately not
// imposed on hand-logged actuals.
const KCAL_MAX = 10000;
const MACRO_MAX = 2000;
const NAME_MAX = 200;

const isDateStr = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00"));

// ── error voice ──────────────────────────────────────────────────────────
// `error` is the ONLY field the client renders (api.js lifts body.error into
// ApiError.message, and TodayTab prints e.message straight into the diary's
// inline note). So `error` must be a sentence a person can act on, and the
// API-contract form — "date must be yyyy-mm-dd", "kcal must be a number
// 0-10000" — belongs in `detail`, next to a stable `code`, where a developer
// reading a log or a network panel finds it and a user never does.
function reject(res, status, { code, human, detail }) {
  // eslint-disable-next-line no-console
  console.warn(`[diary] ${status} ${code} — ${detail}`);
  return res.status(status).json({ error: human, code, detail });
}
const BAD_DATE = {
  code: "bad_date",
  human: "That day couldn't be read — reload the page and try again.",
  detail: "date must be yyyy-mm-dd",
};

// Shared response contract for every write + the GET: the day's entries plus
// its running totals. Per-entry kcal is stored as an Int; the macros are Floats
// rounded here only for display (never for storage).
function toDiaryShape(logs) {
  const entries = logs.map((l) => ({
    id: l.id,
    name: l.name,
    kcal: l.kcal,
    proteinG: l.proteinG,
    carbG: l.carbG,
    fatG: l.fatG,
    slotType: l.slotType,
    source: l.source,
  }));
  const sum = entries.reduce(
    (t, e) => ({ kcal: t.kcal + e.kcal, protein: t.protein + e.proteinG, carb: t.carb + e.carbG, fat: t.fat + e.fatG }),
    { kcal: 0, protein: 0, carb: 0, fat: 0 }
  );
  const r1 = (n) => Math.round(n * 10) / 10;
  return { entries, totals: { kcal: Math.round(sum.kcal), protein: r1(sum.protein), carb: r1(sum.carb), fat: r1(sum.fat) } };
}

async function diaryForDate(userId, date) {
  const logs = await prisma.mealLog.findMany({ where: { userId, date }, orderBy: { createdAt: "asc" } });
  return toDiaryShape(logs);
}

// ═════════════════════════════════════════════════════════════════════════
// FOOD SEARCH FOR THE DIARY
// ═════════════════════════════════════════════════════════════════════════
//
// Why this lives in the diary route and not in /foods: it is a DIARY concern,
// not a library-browsing one. It answers exactly one question — "which library
// row do I want to turn into today's log line, and is that row safe to trust?"
// — and its result shape is built for that (per-100 g macros ready to scale by
// grams, provenance in plain English, and an explicit caution field). GET
// /foods stays the librarian's endpoint. If the two ever converge, this is the
// caller to fold in, not the shape to copy.
//
// THE SAFETY RULE THIS ENDPOINT ENFORCES: a number that is known to be wrong
// never reaches a diary silently. Two mechanisms, in order of severity:
//   1. HIDDEN_SOURCES — rows another pass has quarantined are not returned at
//      all. There is no flag loud enough to justify offering them.
//   2. caution{} — everything else that is merely UNVERIFIED (a documented
//      Atwater exception, a placeholder with no macros, a row whose macros were
//      copied off a different USDA record) is returned WITH a plain-English
//      warning attached and sorted below the clean matches. Hiding these
//      outright would make it impossible to log a cucumber; serving them
//      silently would put another food's numbers in someone's day. Flagged and
//      demoted is the only honest third option.

// Sources that must never be offered as a diary entry. "quarantined" is the
// tag the food-integrity pass applies to rows carrying another food's macros;
// this list is written ahead of that landing on purpose, so the moment those
// rows exist they are already excluded here rather than needing a follow-up.
const HIDDEN_SOURCES = ["quarantined"];

// Plain English, not the storage enum. The front door does not speak in
// slugs (see the de-jargon rule); the Foods tab keeps the formal tier labels.
const PROVENANCE_LABEL = {
  "usda-verified": "USDA",
  usda: "USDA",
  label: "Package label",
  community: "Community label",
  "ai-estimated": "AI estimate",
  manual: "Hand-entered",
  "manual-placeholder": "Placeholder",
};

const FOOD_SEARCH_MIN_Q = 2;
const FOOD_SEARCH_LIMIT_DEFAULT = 20;
const FOOD_SEARCH_LIMIT_MAX = 50;
// How many rows we pull before ranking. 14,122 foods and a one-word query like
// "chicken" matches 822 of them, so a cap is required; the dedicated
// startsWith query below guarantees the best matches are inside it regardless.
const FOOD_SEARCH_SCAN_CAP = 600;
const FOOD_SEARCH_PREFIX_TAKE = 80;

/**
 * SQLite's LIKE treats `%` and `_` as wildcards and Prisma does not escape
 * them, so `contains: "2%"` silently matches "Milk, whole, 3.25% milkfat" and
 * `contains: "chi%ken"` matches every chicken. Verified against the real DB.
 *
 * Rather than guess at an ESCAPE clause Prisma can't emit, the query is split
 * on the wildcards into literal fragments, and SQLite is asked a deliberately
 * BROADER question built from those fragments; the true `q` is then re-applied
 * in JS with a plain substring test.
 *
 *   dbContains = the LONGEST fragment. Every genuine match contains the whole
 *                query, therefore contains this fragment — superset guaranteed.
 *   dbPrefix   = the FIRST fragment. Every name starting with the query starts
 *                with this fragment — superset guaranteed.
 *
 * Deleting the wildcards instead would NARROW the search, which is the trap:
 * "Protein_p" would become "Proteinp", and "Protein_powder" — the row the user
 * is actually looking at — contains no such substring, so the search would
 * return nothing at all.
 */
function sanitizeSearchQuery(raw) {
  const q = typeof raw === "string" ? raw.trim() : "";
  if (q.length < FOOD_SEARCH_MIN_Q) return null;
  const fragments = q.split(/[%_]/).filter(Boolean);
  const longest = fragments.reduce((a, b) => (b.length > a.length ? b : a), "");
  return { q, lower: q.toLowerCase(), dbContains: longest, dbPrefix: fragments[0] || "" };
}

/**
 * Is this row's macro data something a person can trust in their diary?
 * Returns null for a clean row, or { level, label, reason } where level is
 * "high" (demoted below clean matches AND shown at the moment of choosing) or
 * "low" (a documented, understood quirk — surfaced, never demoted).
 *
 * The dataQuality strings are the validator's own verdicts, recorded at import
 * (schema.prisma: "pass" | "warn:<reason>" | "exception:<documented-reason>").
 * The one that matters here is `exception:provenance-cleared`: 976 rows in the
 * shipped library carry it, and its own text says the macros "are that
 * record's values verbatim and are therefore NOT this food's numbers."
 */
function foodCaution(food) {
  if (!food) return null;
  const dq = typeof food.dataQuality === "string" ? food.dataQuality : "";

  if (food.source === "manual-placeholder") {
    return { level: "high", label: "No real data", reason: "this row is a placeholder — its macros are all zero and logging it adds nothing" };
  }
  if (dq.includes("provenance-cleared")) {
    return { level: "high", label: "Numbers not verified", reason: "these macros were copied from a different food's record — check the label before you log it" };
  }
  // Two spellings of the same verdict: the prose column's prefix, and the
  // structured projection of it (Food.dataQualityFlag). Either one alone is
  // enough — a row is not clean just because the other half wasn't written.
  if (dq.startsWith("warn:") || food.dataQualityFlag === "warn") {
    return { level: "high", label: "Numbers not verified", reason: "the calories and the macros on this row don't reconcile" };
  }
  if (dq.startsWith("exception:alcohol-energy")) {
    return { level: "low", label: "Documented exception", reason: "alcohol carries calories the 4/4/9 rule doesn't count" };
  }
  if (dq.startsWith("exception:usda-source-model")) {
    return { level: "low", label: "Documented exception", reason: "USDA derived these calories with its own model rather than 4/4/9" };
  }
  if (dq.startsWith("exception:curated-override")) {
    return { level: "low", label: "Hand-corrected", reason: "these macros were fixed by hand against a verified source" };
  }
  if (dq.startsWith("exception:")) {
    return { level: "low", label: "Documented exception", reason: dq.slice("exception:".length).split(/[;.]/)[0].trim() || "a documented data exception" };
  }
  if (food.source === "community") {
    return { level: "low", label: "Community data", reason: "crowd-sourced from Open Food Facts, not lab-verified" };
  }
  // `source` is an OPEN vocabulary (schema.prisma says so out loud: the
  // owner's installed DB carries a "usda" tier no comment ever documented).
  // An unrecognised tier is a row to show cautiously, never one to silently
  // trust — the default branch the schema comment asks every consumer for.
  if (!Object.prototype.hasOwnProperty.call(PROVENANCE_LABEL, food.source)) {
    return { level: "low", label: "Unrecognised source", reason: "this row's provenance tier isn't one this screen knows — treat the numbers as an estimate" };
  }
  return null;
}

/**
 * The user's own hard exclusions (Profile.excludedFoods — allergies and
 * must-avoids), applied as a FLAG rather than a filter.
 *
 * A diary records what was eaten, not what was permitted. Hiding peanut butter
 * from an allergic user's search does not make the peanut butter they ate go
 * away; it makes it unloggable, and the day's calories wrong. So the row stays
 * findable, is demoted below everything else, and says out loud which of their
 * own exclusions it trips. (The meal SOLVER's behaviour is unchanged and stays
 * a hard filter — that one is choosing food FOR them.)
 */
function avoidNote(food, terms) {
  if (!Array.isArray(terms) || terms.length === 0) return null;
  const hit = [];
  for (const term of terms) {
    if (typeof term !== "string" || !term.trim()) continue;
    try {
      if (foodMatchesExclusionTerm(food, term)) hit.push(term);
    } catch { /* a malformed exclusion term must never break a search */ }
  }
  if (!hit.length) return null;
  return { terms: hit, reason: `You've listed ${hit.join(" and ")} as something to avoid.` };
}

const r1 = (n) => Math.round(n * 10) / 10;

function toSearchRow(food, { caution, avoid }) {
  return {
    id: food.id,
    name: food.name,
    category: food.category,
    per100g: {
      kcal: Math.round(food.kcal || 0),
      proteinG: r1(food.protein || 0),
      carbG: r1(food.carb || 0),
      fatG: r1(food.fat || 0),
    },
    source: food.source,
    provenance: PROVENANCE_LABEL[food.source] || "Hand-entered",
    caution: caution || null,
    avoid: avoid || null,
  };
}

/**
 * Pure ranking. Exported so the ordering can be tested without a database.
 *
 * Buckets, best first: exact name · name starts with the query · a WORD in the
 * name starts with the query · the query appears anywhere. Within a bucket the
 * shorter name wins, because the library's short names ("Chicken breast") are
 * the everyday foods and the 184-character ones are USDA survey descriptions.
 * Then two demotions ride on top: an unverified row (+10) sorts below every
 * clean match, and a row that trips the user's own exclusions (+20) below that.
 */
function rankFoods(foods, query, { limit = FOOD_SEARCH_LIMIT_DEFAULT, avoidTerms = [] } = {}) {
  const lower = String(query || "").toLowerCase();
  const scored = [];
  for (const food of foods) {
    // Defence in depth: the SQL WHERE already excludes these, but a quarantined
    // row must be unreachable through this function too, so a future caller
    // that forgets the WHERE clause cannot reintroduce the bug.
    if (HIDDEN_SOURCES.includes(food.source)) continue;
    const name = String(food.name || "");
    const ln = name.toLowerCase();
    const at = ln.indexOf(lower);
    if (at === -1) continue; // the JS re-check that undoes SQLite's wildcards

    let bucket;
    if (ln === lower) bucket = 0;
    else if (at === 0) bucket = 1;
    else if (/[\s,(/-]/.test(ln[at - 1])) bucket = 2;
    else bucket = 3;

    const caution = foodCaution(food);
    const avoid = avoidNote(food, avoidTerms);
    if (caution?.level === "high") bucket += 10;
    if (avoid) bucket += 20;

    scored.push({ bucket, len: name.length, name, food, caution, avoid });
  }
  scored.sort((a, b) => a.bucket - b.bucket || a.len - b.len || a.name.localeCompare(b.name));
  return {
    total: scored.length,
    results: scored.slice(0, limit).map((s) => toSearchRow(s.food, s)),
  };
}

// GET /api/diary/food-search?q=&limit= -> { query, results, total, truncated }
//
// MUST stay above the "/:date" route below: Express matches in declaration
// order, so a "/:date" declared first would swallow "/food-search" and answer
// it with a 400 about date formats.
router.get("/food-search", async (req, res) => {
  const parsed = sanitizeSearchQuery(req.query?.q);
  if (!parsed) {
    // Not an error — an empty/one-character box is the resting state of a
    // search field, and answering it with a 400 would paint the picker red
    // before the user has finished the first word.
    return res.json({ query: typeof req.query?.q === "string" ? req.query.q : "", results: [], total: 0, truncated: false, minChars: FOOD_SEARCH_MIN_Q });
  }
  const rawLimit = Number(req.query?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), FOOD_SEARCH_LIMIT_MAX) : FOOD_SEARCH_LIMIT_DEFAULT;

  try {
    const notHidden = { source: { notIn: HIDDEN_SOURCES } };
    const select = { id: true, name: true, category: true, kcal: true, protein: true, carb: true, fat: true, source: true, dataQuality: true, fdcCategory: true, allergenTags: true, mayContain: true };

    // Two reads, not one: `contains` is capped for cost, and a cap applied to
    // an unordered scan can genuinely miss "Chicken breast" among 822 rows
    // containing "chicken". The prefix read guarantees the best bucket is in
    // the candidate set no matter where the cap falls.
    const [prefix, contains, profile] = await Promise.all([
      parsed.dbPrefix
        ? prisma.food.findMany({ where: { AND: [{ name: { startsWith: parsed.dbPrefix } }, notHidden] }, take: FOOD_SEARCH_PREFIX_TAKE, select })
        : [],
      prisma.food.findMany({ where: { AND: [{ name: { contains: parsed.dbContains } }, notHidden] }, take: FOOD_SEARCH_SCAN_CAP, select }),
      prisma.profile.findUnique({ where: { userId: req.userId } }).catch(() => null),
    ]);

    const byId = new Map();
    for (const f of [...prefix, ...contains]) byId.set(f.id, f);
    const avoidTerms = Array.isArray(profile?.excludedFoods) ? profile.excludedFoods : [];

    const { results, total } = rankFoods([...byId.values()], parsed.q, { limit, avoidTerms });
    res.json({
      query: parsed.q,
      results,
      total,
      // The scan cap was reached, so `total` is a floor, not a count — the UI
      // says "200+ matches", never a number it can't stand behind.
      truncated: contains.length >= FOOD_SEARCH_SCAN_CAP,
      limit,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[diary] food-search failed:", e);
    res.status(500).json({ error: "Couldn't search your food library just now.", code: "food_search_failed", detail: e.message });
  }
});

// GET /api/diary/:date -> { entries:[...], totals:{kcal,protein,carb,fat} }
router.get("/:date", async (req, res) => {
  const { date } = req.params;
  if (!isDateStr(date)) return reject(res, 400, BAD_DATE);
  res.json(await diaryForDate(req.userId, date));
});

// POST /api/diary/log-planned { date } -> copies that date's solved PlanSlot
// rows into the diary as source:"planned". Idempotent: re-logging replaces the
// prior "planned" rows for that date (so a double-click can't duplicate them)
// while leaving any "manual" entries untouched. Returns the diary shape.
//
// ⚠ DOWNSTREAM CONTRACT — READ BEFORE CHANGING `source` HERE.
// lib/adaptiveTarget.js:loadHistory() reads MealLog with NO source filter, so
// every row this route writes is fed to the expenditure estimator as if it were
// measured intake. It isn't: it is the PLAN, copied. On a day logged this way
// intake equals target by construction, the estimator's partial-log detector
// can never fire, and confidenceBlock() still tells the user "Measured from
// your own logged intake." The fix belongs on the read side (filter to
// source:"manual", or weight "planned" rows as the weaker evidence they are)
// — do not change the tag written here without changing that reader in the
// same pass, because the tag is the only thing that makes the fix possible.
router.post("/log-planned", async (req, res) => {
  try {
    const date = req.body?.date;
    if (!isDateStr(date)) return reject(res, 400, BAD_DATE);

    const monday = mondayOf(date);
    const dayOfWeek = dayNum(date) - dayNum(monday); // 0 = Monday .. 6 = Sunday
    const plan = await prisma.plan.findUnique({
      where: { userId_startDate: { userId: req.userId, startDate: monday } },
      include: { slots: { include: { recipe: true } } },
    });

    // Only real, solved meals become diary rows. A slot with recipeId still set
    // has its recipe (PlanSlot.recipe is SetNull on delete, so recipeId != null
    // guarantees the recipe row exists), carrying the display name; unsolved
    // slots (recipeId null, kcal 0) are skipped, never logged as empty food.
    const rows = (plan?.slots || [])
      .filter((s) => s.dayOfWeek === dayOfWeek && s.recipeId && s.recipe)
      .map((s) => ({
        userId: req.userId,
        date,
        source: "planned",
        recipeId: s.recipeId,
        name: s.recipe.name,
        kcal: Math.round(s.kcal || 0),
        proteinG: s.protein || 0,
        carbG: s.carb || 0,
        fatG: s.fat || 0,
        slotType: s.slotType || null,
      }));

    await prisma.$transaction([
      prisma.mealLog.deleteMany({ where: { userId: req.userId, date, source: "planned" } }),
      ...(rows.length ? [prisma.mealLog.createMany({ data: rows })] : []),
    ]);

    const fresh = await refreshTargetQuietly(req.userId);
    res.json({ ...(await diaryForDate(req.userId, date)), targetStale: !fresh });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /api/diary/entry { date,name,kcal,proteinG,carbG,fatG,slotType?,recipeId? }
// Validated hand-logged entry. Rejects junk (bad types / out-of-bounds) with
// 400 before touching the DB. Returns the day's diary shape.
router.post("/entry", async (req, res) => {
  try {
    const b = req.body || {};
    if (!isDateStr(b.date)) return reject(res, 400, BAD_DATE);

    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > NAME_MAX) {
      return reject(res, 400, {
        code: "bad_name",
        human: name ? `That name is too long — keep it under ${NAME_MAX} characters.` : "Give the item a name.",
        detail: `name is required (1-${NAME_MAX} chars)`,
      });
    }

    const num = (v) => (typeof v === "number" ? v : NaN);
    const kcal = num(b.kcal), proteinG = num(b.proteinG), carbG = num(b.carbG), fatG = num(b.fatG);
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > KCAL_MAX) {
      return reject(res, 400, {
        code: "bad_kcal",
        human: `Calories need to be a number between 0 and ${KCAL_MAX.toLocaleString("en-CA")}.`,
        detail: `kcal must be a number 0-${KCAL_MAX}`,
      });
    }
    const MACRO_WORD = { proteinG: "Protein", carbG: "Carbs", fatG: "Fat" };
    for (const [k, v] of [["proteinG", proteinG], ["carbG", carbG], ["fatG", fatG]]) {
      if (!Number.isFinite(v) || v < 0 || v > MACRO_MAX) {
        return reject(res, 400, {
          code: `bad_${k}`,
          human: `${MACRO_WORD[k]} needs to be a number between 0 and ${MACRO_MAX.toLocaleString("en-CA")} grams.`,
          detail: `${k} must be a number 0-${MACRO_MAX}`,
        });
      }
    }

    // Optional, lenient: slotType is a free label, recipeId a provenance tag.
    // Present-but-wrong-type is junk (400); absent/null is fine.
    if (b.slotType != null && (typeof b.slotType !== "string" || b.slotType.length > 40)) {
      return reject(res, 400, {
        code: "bad_slot_type",
        human: "Couldn't save that entry — the meal label wasn't readable.",
        detail: "slotType must be a short string or null",
      });
    }
    if (b.recipeId != null && typeof b.recipeId !== "string") {
      return reject(res, 400, {
        code: "bad_recipe_id",
        human: "Couldn't save that entry — the recipe reference wasn't readable.",
        detail: "recipeId must be a string or null",
      });
    }

    await prisma.mealLog.create({
      data: {
        userId: req.userId,
        date: b.date,
        source: "manual",
        recipeId: b.recipeId ?? null,
        name,
        kcal: Math.round(kcal),
        proteinG, carbG, fatG,
        slotType: b.slotType ?? null,
      },
    });

    const fresh = await refreshTargetQuietly(req.userId);
    res.status(201).json({ ...(await diaryForDate(req.userId, b.date)), targetStale: !fresh });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// DELETE /api/diary/entry/:id -> ownership-checked delete. 404 when the entry
// doesn't exist OR belongs to another user (never reveal the difference).
router.delete("/entry/:id", async (req, res) => {
  const existing = await prisma.mealLog.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!existing) return res.status(404).json({ error: "That entry is already gone.", code: "entry_not_found", detail: "diary entry not found" });
  await prisma.mealLog.delete({ where: { id: existing.id } });
  await refreshTargetQuietly(req.userId);
  res.status(204).end();
});

module.exports = router;
// Exposed for unit testing the pure shaping/validation helpers without Prisma.
module.exports.toDiaryShape = toDiaryShape;
module.exports.isDateStr = isDateStr;
module.exports.sanitizeSearchQuery = sanitizeSearchQuery;
module.exports.foodCaution = foodCaution;
module.exports.avoidNote = avoidNote;
module.exports.rankFoods = rankFoods;
module.exports.HIDDEN_SOURCES = HIDDEN_SOURCES;
module.exports.FOOD_SEARCH_MIN_Q = FOOD_SEARCH_MIN_Q;
module.exports.FOOD_SEARCH_LIMIT_MAX = FOOD_SEARCH_LIMIT_MAX;
module.exports.FOOD_SEARCH_SCAN_CAP = FOOD_SEARCH_SCAN_CAP;
