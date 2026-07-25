"use strict";
// ── The food picker in the diary (GET /api/diary/food-search) ─────────────
//
// THE GAP THIS CLOSES. The diary's "Add item" row took free text and four
// numbers. The app ships 14,122 searchable foods one screen away, so logging
// "chicken breast, 200 g" required already knowing it is 330/62/0/7 and typing
// all four from memory. Nobody does that three times a day, which is also why
// the adaptive engine never received the real intake it is waiting for.
//
// WHAT THESE TESTS PIN, in order of how badly each one bites:
//   1. ROUTE ORDER. "/food-search" is declared above "/:date". Declared below
//      it, Express matches "/:date" first and answers every search with a 400
//      about date formats — a total, silent feature outage.
//   2. NO KNOWN-WRONG NUMBER REACHES A DIARY SILENTLY. 976 rows in the shipped
//      library carry dataQuality "exception:provenance-cleared", whose own text
//      says the macros are a DIFFERENT food's values verbatim. Those are
//      flagged and demoted; anything quarantined outright is never returned.
//   3. SQLite's LIKE wildcards. Prisma does not escape "%" or "_", so
//      contains:"2%" matches "3.25% milkfat" (verified against the real DB).
//      The query is stripped for SQL and re-applied exactly in JS.
//   4. The error voice. "date must be yyyy-mm-dd" is an API contract string; a
//      human must never see it, and a developer must never lose it.
//   5. The stale-target report. A failed recompute used to vanish into an empty
//      catch block; the write still succeeds, but it now says so.
//
// No database is touched: src/lib/prisma.js and src/lib/profileTarget.js are
// replaced in the module cache before the route loads, so PrismaClient is never
// constructed. The fake `food.findMany` deliberately reproduces SQLite's
// wildcard behaviour, which is what makes test 3 mean anything.

const { test, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");
const cookieParser = require("cookie-parser");

process.env.JWT_SECRET = process.env.JWT_SECRET || "diary-food-search-test-secret";
// Shape-only: never a real credential, only the value the session's password
// epoch is derived from so requireAuth's revocation check has something to
// compare against.
const PASSWORD_HASH = "$2b$12$diaryFoodSearchTestHashNotACredential";

// ── module-cache stubs ───────────────────────────────────────────────────
const db = {
  foods: [],
  profile: null,
  mealLogs: [],
  plan: null,
  recomputes: 0,
  recomputeThrows: false,
  transactions: [],
};

function stubModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[resolved] = stub;
}

// SQLite LIKE, warts and all: case-insensitive for ASCII, and "%"/"_" inside
// the *needle* act as wildcards because Prisma passes them through unescaped.
function sqliteLike(name, needle, anchor) {
  const rx = needle
    .split("")
    .map((ch) => (ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(anchor === "start" ? `^${rx}` : rx, "i").test(name);
}

function matchesWhere(food, where) {
  if (!where) return true;
  if (Array.isArray(where.AND)) return where.AND.every((w) => matchesWhere(food, w));
  if (where.name?.startsWith != null) return sqliteLike(food.name, where.name.startsWith, "start");
  if (where.name?.contains != null) return sqliteLike(food.name, where.name.contains, "any");
  if (where.source?.notIn) return !where.source.notIn.includes(food.source);
  return true;
}

const fakePrisma = {
  food: {
    findMany: async ({ where, take } = {}) => {
      const hits = db.foods.filter((f) => matchesWhere(f, where));
      return (take ? hits.slice(0, take) : hits).map((f) => ({ ...f }));
    },
  },
  profile: {
    findUnique: async () => (db.profile ? { ...db.profile } : null),
  },
  mealLog: {
    findMany: async ({ where }) => db.mealLogs.filter((m) => m.date === where.date).map((m) => ({ ...m })),
    create: async ({ data }) => { const row = { id: `ml${db.mealLogs.length + 1}`, createdAt: new Date(), ...data }; db.mealLogs.push(row); return row; },
    deleteMany: async ({ where }) => { const before = db.mealLogs.length; db.mealLogs = db.mealLogs.filter((m) => !(m.date === where.date && m.source === where.source)); return { count: before - db.mealLogs.length }; },
    createMany: async ({ data }) => { for (const d of data) db.mealLogs.push({ id: `ml${db.mealLogs.length + 1}`, createdAt: new Date(), ...d }); return { count: data.length }; },
    findFirst: async ({ where }) => db.mealLogs.find((m) => m.id === where.id) || null,
    delete: async ({ where }) => { db.mealLogs = db.mealLogs.filter((m) => m.id !== where.id); return {}; },
  },
  plan: { findUnique: async () => db.plan },
  // requireAuth pins a session to the password hash it was minted under
  // (src/lib/auth.js resolveSession), so the harness needs a user row.
  user: { findUnique: async () => ({ passwordHash: PASSWORD_HASH }) },
  $transaction: async (ops) => { db.transactions.push(ops.length); return Promise.all(ops); },
};

stubModule("../src/lib/prisma.js", { prisma: fakePrisma });
stubModule("../src/lib/profileTarget.js", {
  recomputeTarget: async () => {
    if (db.recomputeThrows) throw new Error("adaptive resolver exploded");
    db.recomputes += 1;
  },
});

const diaryRouter = require("../src/routes/diary.js");
const { rankFoods, foodCaution, sanitizeSearchQuery, avoidNote, HIDDEN_SOURCES, FOOD_SEARCH_SCAN_CAP } = diaryRouter;
const { signToken } = require("../src/lib/auth.js");

// ── HTTP harness ─────────────────────────────────────────────────────────
const COOKIE = `cutprotocol_session=${signToken("u1", PASSWORD_HASH)}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/diary", diaryRouter);
  return app;
}

async function call(path, { method = "GET", body } = {}) {
  const srv = buildApp().listen(0);
  await new Promise((r) => srv.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/diary${path}`, {
      method,
      headers: { cookie: COOKIE, ...(body ? { "content-type": "application/json" } : null) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    srv.close();
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────
const food = (over = {}) => ({
  id: over.id || `f${Math.random().toString(36).slice(2, 9)}`,
  name: "Chicken breast, cooked, skinless",
  category: "protein",
  kcal: 165, protein: 31, carb: 0, fat: 3.6,
  source: "usda-verified",
  dataQuality: "pass — fiber-adjusted Atwater within tolerance",
  fdcCategory: null, allergenTags: null, mayContain: null,
  ...over,
});

const LIBRARY = [
  food({ id: "clean-exact", name: "Chicken" }),
  food({ id: "clean-prefix", name: "Chicken breast, cooked, skinless" }),
  food({ id: "clean-prefix-long", name: "Chicken or turkey, breaded, fried, garden salad with bacon and cheese, chicken and/or turkey, bacon, cheese, lettuce and/or greens, tomato and/or carrots, other vegetables, no dressing", kcal: 120, protein: 9, carb: 5, fat: 7 }),
  food({ id: "word-start", name: "Grilled chicken thigh" }),
  food({ id: "substring", name: "Unchickened stock powder" }),
  food({ id: "unrelated", name: "Rolled oats" }),
];

before(() => { db.foods = LIBRARY.map((f) => ({ ...f })); });
beforeEach(() => {
  db.foods = LIBRARY.map((f) => ({ ...f }));
  db.profile = null;
  db.mealLogs = [];
  db.plan = null;
  db.recomputes = 0;
  db.recomputeThrows = false;
  db.transactions = [];
});

// ═══════════════════════════════════════════════════════════════════════
// 1 · route order — the outage test
// ═══════════════════════════════════════════════════════════════════════

test("food-search is reachable: /:date does not swallow it", async () => {
  const res = await call("/food-search?q=chicken");
  assert.equal(res.status, 200, "a 400 here means /:date matched first — the whole picker is dead");
  assert.ok(Array.isArray(res.json.results));
  assert.notEqual(res.json.error, "date must be yyyy-mm-dd");
});

test("a real date still routes to the diary, not the search", async () => {
  const res = await call("/2026-07-24");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.entries));
  assert.ok(res.json.totals);
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · empty and short queries are a resting state, not an error
// ═══════════════════════════════════════════════════════════════════════

test("no query returns an empty result set, never a 400", async () => {
  for (const q of ["", "c", "   ", " a "]) {
    const res = await call(`/food-search?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, `q=${JSON.stringify(q)} must not be an error`);
    assert.deepEqual(res.json.results, []);
    assert.equal(res.json.total, 0);
    assert.equal(res.json.minChars, 2);
  }
});

test("a query with no matches is an empty list, not a failure", async () => {
  const res = await call("/food-search?q=zzzzquux");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.results, []);
  assert.equal(res.json.total, 0);
  assert.equal(res.json.truncated, false);
});

test("sanitizeSearchQuery: strips SQL wildcards for the DB, keeps the true query", () => {
  assert.equal(sanitizeSearchQuery("c"), null);
  assert.equal(sanitizeSearchQuery("   "), null);
  assert.equal(sanitizeSearchQuery(null), null);
  assert.deepEqual(sanitizeSearchQuery("  2%  "), { q: "2%", lower: "2%", dbContains: "2", dbPrefix: "2" });
  // The trap: DELETING the wildcard would ask SQLite for "chck", which
  // "ch_cken" does not contain — the search would return nothing. Splitting
  // into fragments and asking for the longest one keeps the superset.
  assert.deepEqual(sanitizeSearchQuery("ch_cken"), { q: "ch_cken", lower: "ch_cken", dbContains: "cken", dbPrefix: "ch" });
  assert.deepEqual(sanitizeSearchQuery("%%%"), { q: "%%%", lower: "%%%", dbContains: "", dbPrefix: "" });
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · SQLite wildcard leakage is caught in JS
// ═══════════════════════════════════════════════════════════════════════

test("a '%' in the query is a literal, not a wildcard", async () => {
  db.foods = [
    food({ id: "two-pct", name: "Milk, 2%" }),
    food({ id: "three-pct", name: "Milk, whole, 3.25% milkfat, with added vitamin D" }),
    food({ id: "no-pct", name: "Milk, skim, 2 cup serving" }),
  ];
  const res = await call("/food-search?q=2%25");
  const names = res.json.results.map((r) => r.name);
  assert.deepEqual(names, ["Milk, 2%"], `SQLite's LIKE would also return 3.25% and "2 cup" — got ${JSON.stringify(names)}`);
});

test("an '_' in the query is a literal, not a single-character wildcard", async () => {
  db.foods = [food({ id: "u", name: "Protein_powder" }), food({ id: "v", name: "Protein powder" })];
  const res = await call("/food-search?q=Protein_p");
  assert.deepEqual(res.json.results.map((r) => r.name), ["Protein_powder"]);
});

test("search is case-insensitive", async () => {
  const upper = await call("/food-search?q=CHICKEN");
  const lower = await call("/food-search?q=chicken");
  assert.deepEqual(upper.json.results.map((r) => r.id), lower.json.results.map((r) => r.id));
  assert.ok(lower.json.results.length > 0);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · ranking — the everyday food must be findable in one or two keystrokes
// ═══════════════════════════════════════════════════════════════════════

test("ranking: exact, then prefix, then word-start, then substring", async () => {
  const res = await call("/food-search?q=chicken");
  assert.deepEqual(res.json.results.map((r) => r.id), [
    "clean-exact",         // name === query
    "clean-prefix",        // starts with, short
    "clean-prefix-long",   // starts with, 184 chars
    "word-start",          // "Grilled |chicken| thigh"
    "substring",           // "Un|chicken|ed"
  ]);
});

test("ranking: the short everyday name beats the 184-character USDA description", () => {
  const { results } = rankFoods(LIBRARY, "chicken", { limit: 10 });
  const shortIdx = results.findIndex((r) => r.name === "Chicken breast, cooked, skinless");
  const longIdx = results.findIndex((r) => r.name.length > 150);
  assert.ok(shortIdx < longIdx, "a 184-char survey description must never outrank the food a person eats");
});

test("a very long name survives the round trip intact", async () => {
  const res = await call("/food-search?q=chicken");
  const long = res.json.results.find((r) => r.id === "clean-prefix-long");
  assert.equal(long.name.length, 184, "names are never truncated server-side — that is the UI's job");
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · THE SAFETY RULE — no known-wrong number reaches a diary silently
// ═══════════════════════════════════════════════════════════════════════

test("quarantined rows are never returned, flagged or otherwise", async () => {
  db.foods = [
    food({ id: "ok", name: "Chicken breast" }),
    food({ id: "bad", name: "Chicken breast, quarantined copy", source: "quarantined" }),
  ];
  const res = await call("/food-search?q=chicken");
  assert.deepEqual(res.json.results.map((r) => r.id), ["ok"]);
  assert.ok(HIDDEN_SOURCES.includes("quarantined"));
});

test("rankFoods drops quarantined rows even when the WHERE clause forgot to", () => {
  const { results } = rankFoods(
    [food({ id: "bad", name: "Cucumber", source: "quarantined" }), food({ id: "ok", name: "Cucumber, raw" })],
    "cucumber",
    { limit: 10 }
  );
  assert.deepEqual(results.map((r) => r.id), ["ok"]);
});

test("a provenance-cleared row is flagged in plain English, not served clean", () => {
  const cleared = food({
    name: "Cucumber",
    source: "manual",
    dataQuality: 'exception:provenance-cleared — carried fdcId 169225 ("Cucumber, peeled, raw"), whose description does not denote this food; this row\'s macros are that record\'s values verbatim and are therefore NOT this food\'s numbers',
  });
  const c = foodCaution(cleared);
  assert.equal(c.level, "high");
  assert.match(c.reason, /different food's record/);
  assert.doesNotMatch(c.reason, /fdcId|dataQuality|provenance-cleared/, "the caution a user reads must not quote the storage format");
});

test("an unverified row sorts BELOW every clean match for the same query", async () => {
  db.foods = [
    food({ id: "dirty", name: "Chicken", source: "manual", dataQuality: "exception:provenance-cleared — carried fdcId 1 (\"Something else\")" }),
    food({ id: "clean", name: "Chicken thigh, cooked" }),
  ];
  const res = await call("/food-search?q=chicken");
  // "Chicken" is an EXACT match and would otherwise rank first; the demotion
  // is what stops a known-wrong row from being the default keyboard target.
  assert.deepEqual(res.json.results.map((r) => r.id), ["clean", "dirty"]);
  assert.equal(res.json.results[1].caution.level, "high");
  assert.equal(res.json.results[0].caution, null);
});

test("a warn: verdict — in either the prose or the structured column — is high caution", () => {
  assert.equal(foodCaution(food({ dataQuality: "warn:atwater" })).level, "high");
  assert.equal(foodCaution(food({ dataQuality: null, dataQualityFlag: "warn" })).level, "high");
});

test("a zero-macro placeholder says so instead of quietly logging nothing", async () => {
  db.foods = [food({ id: "ph", name: "Chipotle in adobo", source: "manual-placeholder", kcal: 0, protein: 0, carb: 0, fat: 0, dataQuality: null })];
  const res = await call("/food-search?q=chipotle");
  const row = res.json.results[0];
  assert.equal(row.caution.level, "high");
  assert.match(row.caution.reason, /placeholder/);
  assert.deepEqual(row.per100g, { kcal: 0, proteinG: 0, carbG: 0, fatG: 0 }, "the zeroes are still reported honestly");
});

test("a legitimately zero-calorie food is NOT cautioned — water is not a data defect", async () => {
  db.foods = [food({ id: "w", name: "Water, bottled", kcal: 0, protein: 0, carb: 0, fat: 0, source: "usda-verified", dataQuality: "pass — zero-energy food" })];
  const res = await call("/food-search?q=water");
  assert.equal(res.json.results[0].caution, null);
  assert.equal(res.json.results[0].per100g.kcal, 0);
});

test("documented exceptions are surfaced quietly, not demoted", () => {
  const alcohol = foodCaution(food({ dataQuality: "exception:alcohol-energy — ethanol supplies ~7 kcal/g" }));
  assert.equal(alcohol.level, "low");
  const usda = foodCaution(food({ dataQuality: "exception:usda-source-model — name is USDA's own description" }));
  assert.equal(usda.level, "low");
  assert.equal(foodCaution(food()), null, "an ordinary passing row carries no caution at all");
});

test("an unrecognised source tier is shown cautiously, never silently trusted", () => {
  // schema.prisma calls `source` an OPEN vocabulary and asks every consumer for
  // a default branch — the owner's installed DB carries a "usda" tier nobody
  // documented, and the next one is not predictable.
  const c = foodCaution(food({ source: "some-future-tier" }));
  assert.equal(c.level, "low");
  assert.equal(foodCaution(food({ source: "usda" })), null, "the undocumented-but-known 'usda' tier is a real USDA row");
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · the user's own exclusions — flagged and demoted, never hidden
// ═══════════════════════════════════════════════════════════════════════

test("a food that trips the user's exclusions is flagged and sorted last", async () => {
  db.profile = { userId: "u1", excludedFoods: ["peanuts"] };
  db.foods = [
    food({ id: "pb", name: "Peanut butter", category: "fats-nuts-oils" }),
    food({ id: "sb", name: "Butter, salted", category: "dairy-eggs" }),
  ];
  const res = await call("/food-search?q=butter");
  const pb = res.json.results.find((r) => r.id === "pb");
  assert.ok(pb, "an excluded food must still be LOGGABLE — a diary records what was eaten, not what was allowed");
  assert.deepEqual(pb.avoid.terms, ["peanuts"]);
  assert.match(pb.avoid.reason, /avoid/i);
  assert.equal(res.json.results.find((r) => r.id === "sb").avoid, null);
  // "Peanut butter" is a word-start match and "Butter, salted" an exact-prefix
  // one, so ordering alone doesn't prove the demotion — but the excluded row
  // must be last regardless of how well it matched.
  assert.equal(res.json.results[res.json.results.length - 1].id, "pb", "it sorts last");
});

test("no exclusions configured means no avoid flags anywhere", async () => {
  db.profile = { userId: "u1", excludedFoods: [] };
  const res = await call("/food-search?q=chicken");
  assert.ok(res.json.results.every((r) => r.avoid === null));
});

test("a malformed exclusion term cannot break the search", () => {
  assert.equal(avoidNote(food(), null), null);
  assert.equal(avoidNote(food(), ["", "   ", 42, null]), null);
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · shape, limits, and honest counting
// ═══════════════════════════════════════════════════════════════════════

test("every row carries per-100 g macros and a plain-English provenance", async () => {
  const res = await call("/food-search?q=chicken");
  const row = res.json.results.find((r) => r.id === "clean-prefix");
  assert.deepEqual(row.per100g, { kcal: 165, proteinG: 31, carbG: 0, fatG: 3.6 });
  assert.equal(row.provenance, "USDA");
  assert.equal(row.category, "protein");
  assert.ok(row.id && row.name);
});

test("provenance is plain English for every documented tier", () => {
  const label = (source) => rankFoods([food({ source, name: "X" })], "x", { limit: 1 }).results[0].provenance;
  assert.equal(label("usda-verified"), "USDA");
  assert.equal(label("community"), "Community label");
  assert.equal(label("label"), "Package label");
  assert.equal(label("ai-estimated"), "AI estimate");
  assert.equal(label("manual"), "Hand-entered");
  assert.equal(label("whatever-comes-next"), "Hand-entered", "an unknown tier still renders — and carries a caution");
});

test("limit is honoured and clamped", async () => {
  db.foods = Array.from({ length: 120 }, (_, i) => food({ id: `f${i}`, name: `Chicken variant ${i}` }));
  assert.equal((await call("/food-search?q=chicken&limit=5")).json.results.length, 5);
  assert.equal((await call("/food-search?q=chicken&limit=9999")).json.results.length, 50, "clamped to FOOD_SEARCH_LIMIT_MAX");
  assert.equal((await call("/food-search?q=chicken&limit=abc")).json.results.length, 20, "a junk limit falls back to the default");
  assert.equal((await call("/food-search?q=chicken&limit=-3")).json.results.length, 20);
});

test("200+ matches: total is reported and the scan cap is declared", async () => {
  db.foods = Array.from({ length: 260 }, (_, i) => food({ id: `f${i}`, name: `Chicken variant ${i}` }));
  const res = await call("/food-search?q=chicken");
  assert.equal(res.json.total, 260, "the UI needs the real count to say '260 matches'");
  assert.equal(res.json.results.length, 20);
  assert.equal(res.json.truncated, false, "260 is under the scan cap, so the count is exact");
});

test("beyond the scan cap the response says the count is a floor", async () => {
  db.foods = Array.from({ length: FOOD_SEARCH_SCAN_CAP + 40 }, (_, i) => food({ id: `f${i}`, name: `Chicken variant ${i}` }));
  const res = await call("/food-search?q=chicken");
  assert.equal(res.json.truncated, true, "never present a capped scan as an exact count");
});

test("a search failure is a 500 with a human sentence, not a stack trace", async () => {
  const original = fakePrisma.food.findMany;
  fakePrisma.food.findMany = async () => { throw new Error("SQLITE_BUSY: database is locked"); };
  try {
    const res = await call("/food-search?q=chicken");
    assert.equal(res.status, 500);
    assert.equal(res.json.error, "Couldn't search your food library just now.");
    assert.match(res.json.detail, /SQLITE_BUSY/, "the machine form is kept for the log, off the screen");
  } finally {
    fakePrisma.food.findMany = original;
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 8 · the error voice — contract strings never reach a person
// ═══════════════════════════════════════════════════════════════════════

test("a bad date says something a person can act on, and keeps the contract form", async () => {
  for (const path of ["/not-a-date", "/2026-13-99x"]) {
    const res = await call(path);
    assert.equal(res.status, 400);
    assert.doesNotMatch(res.json.error, /yyyy-mm-dd/, "an API contract string must never be shown to a human");
    assert.match(res.json.error, /reload/i);
    assert.equal(res.json.code, "bad_date");
    assert.equal(res.json.detail, "date must be yyyy-mm-dd", "the machine form survives, for the log");
  }
});

test("POST /entry validation speaks English and names the field a user sees", async () => {
  const bad = [
    [{ date: "nope", name: "X", kcal: 1, proteinG: 0, carbG: 0, fatG: 0 }, "bad_date"],
    [{ date: "2026-07-24", name: "", kcal: 1, proteinG: 0, carbG: 0, fatG: 0 }, "bad_name"],
    [{ date: "2026-07-24", name: "X", kcal: "300", proteinG: 0, carbG: 0, fatG: 0 }, "bad_kcal"],
    [{ date: "2026-07-24", name: "X", kcal: 99999, proteinG: 0, carbG: 0, fatG: 0 }, "bad_kcal"],
    [{ date: "2026-07-24", name: "X", kcal: 1, proteinG: -1, carbG: 0, fatG: 0 }, "bad_proteinG"],
    [{ date: "2026-07-24", name: "X", kcal: 1, proteinG: 0, carbG: 9999, fatG: 0 }, "bad_carbG"],
    [{ date: "2026-07-24", name: "X", kcal: 1, proteinG: 0, carbG: 0, fatG: null }, "bad_fatG"],
  ];
  for (const [body, code] of bad) {
    const res = await call("/entry", { method: "POST", body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.json.code, code);
    assert.ok(res.json.detail, "every rejection keeps its machine form");
    assert.doesNotMatch(res.json.error, /must be a number|yyyy-mm-dd|1-200 chars/, `contract string leaked: ${res.json.error}`);
    assert.match(res.json.error, /[a-z] [a-z]/, "the human message is a sentence");
  }
});

test("a 0 kcal entry is accepted — black coffee is a real diary row", async () => {
  const res = await call("/entry", { method: "POST", body: { date: "2026-07-24", name: "Black coffee", kcal: 0, proteinG: 0, carbG: 0, fatG: 0 } });
  assert.equal(res.status, 201);
  assert.equal(res.json.entries.length, 1);
  assert.equal(res.json.totals.kcal, 0);
});

test("a picked library food logs the scaled macros it was shown", async () => {
  // 200 g of a 165/31/0/3.6-per-100 g row.
  const res = await call("/entry", { method: "POST", body: { date: "2026-07-24", name: "Chicken breast, cooked, skinless (200 g)", kcal: 330, proteinG: 62, carbG: 0, fatG: 7.2 } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.json.totals, { kcal: 330, protein: 62, carb: 0, fat: 7.2 });
  assert.equal(res.json.entries[0].source, "manual");
});

// ═══════════════════════════════════════════════════════════════════════
// 9 · the target recompute is best-effort, but never silent
// ═══════════════════════════════════════════════════════════════════════

test("a write still succeeds when the target recompute throws — and says the target is stale", async () => {
  db.recomputeThrows = true;
  const res = await call("/entry", { method: "POST", body: { date: "2026-07-24", name: "Almonds", kcal: 180, proteinG: 6, carbG: 6, fatG: 15 } });
  assert.equal(res.status, 201, "a derived-state failure must never lose the user's food log");
  assert.equal(res.json.targetStale, true, "the old empty catch block left the user's target quietly wrong");
  assert.equal(res.json.entries.length, 1);
});

test("a healthy write reports a fresh target", async () => {
  const res = await call("/entry", { method: "POST", body: { date: "2026-07-24", name: "Almonds", kcal: 180, proteinG: 6, carbG: 6, fatG: 15 } });
  assert.equal(res.json.targetStale, false);
  assert.equal(db.recomputes, 1);
});

// ═══════════════════════════════════════════════════════════════════════
// 10 · "ate as planned" — the one-click path must not regress
// ═══════════════════════════════════════════════════════════════════════

const PLAN = {
  slots: [
    { dayOfWeek: 4, recipeId: "r1", recipe: { name: "Chicken and rice" }, kcal: 620, protein: 48, carb: 70, fat: 12, slotType: "meal" },
    { dayOfWeek: 4, recipeId: "r2", recipe: { name: "Greek yoghurt" }, kcal: 180, protein: 20, carb: 12, fat: 5, slotType: "snack" },
    { dayOfWeek: 4, recipeId: null, recipe: null, kcal: 0, protein: 0, carb: 0, fat: 0, slotType: "meal" },
    { dayOfWeek: 1, recipeId: "r3", recipe: { name: "Other day" }, kcal: 500, protein: 30, carb: 40, fat: 15, slotType: "meal" },
  ],
};

test("ate-as-planned copies only that day's SOLVED slots", async () => {
  db.plan = PLAN;
  const res = await call("/log-planned", { method: "POST", body: { date: "2026-07-24" } }); // a Friday → dayOfWeek 4
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.entries.map((e) => e.name), ["Chicken and rice", "Greek yoghurt"]);
  assert.equal(res.json.totals.kcal, 800);
  assert.ok(res.json.entries.every((e) => e.source === "planned"), "the tag the read side needs in order to tell plan from measurement");
});

test("ate-as-planned is idempotent under 4 concurrent calls", async () => {
  db.plan = PLAN;
  await Promise.all([1, 2, 3, 4].map(() => call("/log-planned", { method: "POST", body: { date: "2026-07-24" } })));
  const planned = db.mealLogs.filter((m) => m.source === "planned");
  assert.equal(planned.length, 2, "a double-click must not duplicate the day");
  assert.equal(db.transactions.length, 4, "each call is one delete-then-create transaction");
});

test("ate-as-planned leaves hand-logged entries alone", async () => {
  db.plan = PLAN;
  await call("/entry", { method: "POST", body: { date: "2026-07-24", name: "Job-site coffee", kcal: 15, proteinG: 1, carbG: 2, fatG: 0 } });
  await call("/log-planned", { method: "POST", body: { date: "2026-07-24" } });
  await call("/log-planned", { method: "POST", body: { date: "2026-07-24" } });
  const manual = db.mealLogs.filter((m) => m.source === "manual");
  assert.equal(manual.length, 1, "re-logging the plan must never wipe what the user actually ate");
  assert.equal(manual[0].name, "Job-site coffee");
});

test("a bad date on ate-as-planned uses the same human voice", async () => {
  const res = await call("/log-planned", { method: "POST", body: { date: "24/07/2026" } });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, "bad_date");
  assert.doesNotMatch(res.json.error, /yyyy-mm-dd/);
});
