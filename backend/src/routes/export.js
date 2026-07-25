// ─────────────────────────────────────────────────────────────────────────────
// DATA EXPORT / IMPORT — the constitution's "data is never trapped" clause,
// finally implemented.
//
// CLAUDE.md has promised since the RECOMP days: "Data is never trapped:
// JSON+CSV export must always work." Measured 2026-07-24, before this file
// existed: a repo-wide search for `text/csv`, `Content-Disposition`,
// `createObjectURL`, `new Blob`, `showSaveDialog` and `.csv` returned ZERO hits
// outside node_modules — in the tree AND inside the shipped app.asar. Twelve
// routers were mounted in server.js and none of them exported anything. The
// promise had never once been true.
//
// So this file is the promise, not a feature request:
//   GET  /api/export?format=json   one JSON object, everything about the caller
//   GET  /api/export?format=csv    a ZIP, one CSV per entity
//   POST /api/import               the same JSON back, remapped onto the caller
//
// ── WHY THE CSV RULES BELOW ARE NOT PARANOIA ────────────────────────────────
// Measured against the LIVE library (14,122 foods + 889 recipes = 15,011 names)
// on 2026-07-24:
//   * 12,331 names contain a COMMA  ("Almond milk, unsweetened, plain")
//   *  1,008 names contain a literal DOUBLE QUOTE — USDA inch marks, e.g.
//            `Beef ... trimmed to 0" fat, choice, raw`. Quote-escaping is not a
//            hypothetical here; nearly 7% of the corpus needs it TODAY, and a
//            naive `cells.join(",")` corrupts every one of those rows.
//   *     45 names are NON-ASCII    (Gruyère, Smoky Aïoli, Tomato Purée) — hence
//            the UTF-8 BOM, without which Excel decodes the file as the system
//            codepage and shows "GruyÃ¨re".
//   *      0 names begin `= + - @` today. Zero is not "cannot": foods arrive
//            from barcode import and recipes from arbitrary URLs, and
//            foodValidation.js does not reject a leading `=`. Formula injection
//            is REACHABLE, so the guard ships before the payload does.
//
// ── AUTHORIZATION ───────────────────────────────────────────────────────────
// This endpoint returns a person's entire life in one response. Every query in
// this file is scoped by `req.userId` and NOTHING ELSE. There is deliberately
// no :id parameter, no ?userId, no email lookup, no admin "export any user"
// branch — not because an admin shouldn't have one, but because a surface with
// no selector cannot be tricked into selecting the wrong person. If a
// cross-user export is ever needed, it belongs in a separate, separately
// audited route.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const zlib = require("node:zlib");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");

// Mounted at /api, so requireAuth is attached PER ROUTE rather than with
// router.use(): a router-level middleware here would run for every /api request
// that reaches this mount point, including ones meant for the 404 handler.
const router = express.Router();

const FORMAT_VERSION = 1;

/** Thrown to roll a dry-run transaction back without pretending it failed. */
class DryRunRollback extends Error {
  constructor() {
    super("dry run — rolled back deliberately");
    this.name = "DryRunRollback";
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CSV
// ═════════════════════════════════════════════════════════════════════════════

// Excel/LibreOffice/Sheets all treat a cell whose text begins with one of these
// as a FORMULA rather than as text, so `=cmd|' /C calc'!A0` in a food name
// becomes command execution on the machine of whoever opens the export. The
// standard mitigation is a leading apostrophe, which every spreadsheet reads as
// "the rest of this cell is literal text" and does not display.
//
// TAB and CR are in the set because a leading control character can be trimmed
// by the importer, re-exposing the character after it.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

// RFC 4180 says quote when the field contains a quote, the delimiter, CR or LF.
// Leading/trailing whitespace is added because spreadsheets silently eat it,
// which is data loss even if it is not corruption.
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * One CSV cell, correct for the four things that actually break exports:
 * embedded quotes, embedded commas, non-ASCII text, and formula injection.
 *
 * The formula guard applies to STRINGS ONLY, never to a value that arrived as a
 * JS number. That distinction is deliberate and load-bearing: `RecipeRating
 * .rating` is legitimately `-1`, and prefixing a real number with `'` turns a
 * numeric column into a text column in every spreadsheet — breaking sums for
 * every user in order to defend against a value that cannot carry a payload
 * (a number stringifies to a bare numeral; there is no `=` to inject). Text is
 * where the attack lives, so text is where the guard goes.
 */
function csvCell(value) {
  if (value === null || value === undefined) return "";

  let s;
  let isText = false;
  if (value instanceof Date) {
    s = value.toISOString(); // ISO-8601, always — never a locale string
  } else if (typeof value === "number") {
    s = Number.isFinite(value) ? String(value) : ""; // NaN/Infinity are not data
  } else if (typeof value === "bigint") {
    s = value.toString();
  } else if (typeof value === "boolean") {
    s = value ? "true" : "false";
  } else if (typeof value === "object") {
    // Json columns (micros, steps, PlanSlot.ingredients, …). Serialised, never
    // dropped: a lossy export is a trapped export. The flattened child files
    // below make the same data usable; this keeps it complete.
    s = JSON.stringify(value);
    isText = true;
  } else {
    s = String(value);
    isText = true;
  }

  // Edge whitespace is judged on the ORIGINAL value, before the guard prefixes
  // an apostrophe — otherwise a value starting with a tab stops looking
  // whitespace-led the moment it is guarded, and the tab is then eaten on
  // import. Quoting is what preserves it.
  const edgeWhitespace = /^\s|\s$/.test(s);
  if (isText && FORMULA_LEAD.test(s)) s = `'${s}`;
  if (NEEDS_QUOTING.test(s) || edgeWhitespace) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const csvRow = (cells) => cells.map(csvCell).join(",");

/**
 * A complete CSV file as a Buffer.
 *
 * - Leading U+FEFF (UTF-8 BOM). Excel on Windows otherwise decodes the bytes as
 *   the system ANSI codepage, and "Gruyère" arrives as "GruyÃ¨re".
 * - CRLF line endings, per RFC 4180.
 * - Header row from `columns`; one row per object, columns read by key.
 */
// Written as an escape, never as a literal: a raw U+FEFF in source is invisible
// in every editor and the first person to "clean up whitespace" deletes it.
const UTF8_BOM = "\uFEFF";

function csvFile(columns, rows) {
  const lines = [csvRow(columns)];
  for (const row of rows) lines.push(csvRow(columns.map((c) => row[c])));
  return Buffer.from(`${UTF8_BOM}${lines.join("\r\n")}\r\n`, "utf8");
}

// ═════════════════════════════════════════════════════════════════════════════
// ZIP  (no dependency — `npm install` is not available to this change)
// ═════════════════════════════════════════════════════════════════════════════
//
// A ZIP is a concatenation of [local header + deflated bytes] records, then a
// central directory describing them, then an end-of-central-directory record.
// node:zlib supplies the only hard part (deflate); the rest is byte layout.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** MS-DOS packed date/time, which is the only timestamp format ZIP has. */
function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

/** files: [{ name, data: Buffer }] -> one ZIP Buffer. */
function zipSync(files, now = new Date()) {
  const { time, day } = dosDateTime(now);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const deflated = zlib.deflateRawSync(file.data, { level: 9 });
    // Never let "compression" make a file bigger (tiny CSVs can inflate).
    const stored = deflated.length >= file.data.length;
    const payload = stored ? file.data : deflated;
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flag bit 11: filename is UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(day, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(file.data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0, 38); // external attrs
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

// ═════════════════════════════════════════════════════════════════════════════
// COLLECTION
// ═════════════════════════════════════════════════════════════════════════════

// Food has NO owner column (see schema.prisma — there is no createdByUserId on
// Food, unlike Recipe). "The user's own foods" is therefore not representable
// in this schema, and inventing an answer would be worse than saying so. What
// IS representable, and what actually matters for "not trapped", is REACHABILITY:
// every Food row the user's own rows point at travels with the export, so a
// plan slot, a grocery list or a recipe ingredient never lands somewhere as a
// bare cuid with no meaning. The 14,122-row shared library is NOT dumped —
// that is the app's data, not the person's.

// Deliberately NO `select` on Food or Recipe.
//
// A hand-maintained column list is the wrong shape for an export: it silently
// drops every column added after it was written, which is precisely how data
// gets trapped. It also breaks outright against a Prisma client that is a
// migration behind the schema (Food.dataQualityFlag landed 2026-07-24 and a
// stale generated client rejects the field with "Unknown field"). Taking the
// whole row means a new column ships in the export the day it ships in the
// schema, with no edit here, and the CSV header derives from the rows.
//
// The cost is bounded: these queries only ever touch the food/recipe rows the
// caller's own data references, not the 14,122-row library.
const RECIPE_INCLUDE = { ingredients: true };

/**
 * Everything this app knows about one person, as one plain object.
 * Every query is `where: { userId }`. There is no other filter and no other
 * source of the id than `req.userId`.
 */
async function collectUserExport(userId) {
  const [
    user, profile, weighins, mealLogs, plans, trainingPlan, cartItems,
    recipeRatings, libraryEntries, ownedRecipes, brainPreference,
    brainConversations, llmUsage,
  ] = await Promise.all([
    // passwordHash is never selected. Not redacted after the fact — never read,
    // so no future refactor can accidentally spread it into the payload.
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, createdAt: true } }),
    prisma.profile.findUnique({ where: { userId } }),
    prisma.weighin.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    prisma.mealLog.findMany({ where: { userId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.plan.findMany({
      where: { userId },
      orderBy: { startDate: "asc" },
      include: {
        slots: { orderBy: [{ dayOfWeek: "asc" }, { slotType: "asc" }, { slotIndex: "asc" }] },
        groceryList: true,
      },
    }),
    prisma.trainingPlan.findUnique({
      where: { userId },
      include: {
        weeks: {
          orderBy: { weekNumber: "asc" },
          include: {
            sessions: {
              orderBy: { dayIndex: "asc" },
              include: { exercises: { orderBy: { order: "asc" } } },
            },
          },
        },
      },
    }),
    prisma.cartItem.findMany({ where: { userId }, orderBy: { addedAt: "asc" } }),
    prisma.recipeRating.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.userLibraryEntry.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.recipe.findMany({ where: { createdByUserId: userId }, include: RECIPE_INCLUDE, orderBy: { name: "asc" } }),
    prisma.brainPreference.findUnique({ where: { userId } }),
    prisma.brainConversation.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.llmUsage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);

  // Recipes the user does not own but their own rows point at (plan slots, cart,
  // ratings, library, meal-log provenance). Without these the plan history reads
  // as a list of opaque ids.
  const ownedIds = new Set(ownedRecipes.map((r) => r.id));
  const referencedRecipeIds = new Set();
  for (const p of plans) for (const s of p.slots) if (s.recipeId) referencedRecipeIds.add(s.recipeId);
  for (const c of cartItems) referencedRecipeIds.add(c.recipeId);
  for (const r of recipeRatings) referencedRecipeIds.add(r.recipeId);
  for (const e of libraryEntries) referencedRecipeIds.add(e.recipeId);
  for (const m of mealLogs) if (m.recipeId) referencedRecipeIds.add(m.recipeId);
  for (const id of ownedIds) referencedRecipeIds.delete(id);

  const referencedRecipes = referencedRecipeIds.size
    ? await prisma.recipe.findMany({ where: { id: { in: [...referencedRecipeIds] } }, include: RECIPE_INCLUDE, orderBy: { name: "asc" } })
    : [];

  // Every food id reachable from anything above.
  const foodIds = new Set();
  for (const r of [...ownedRecipes, ...referencedRecipes]) for (const i of r.ingredients) foodIds.add(i.foodId);
  for (const p of plans) {
    for (const s of p.slots) {
      for (const ing of asArray(s.ingredients)) if (ing?.foodId) foodIds.add(ing.foodId);
    }
    for (const item of asArray(p.groceryList?.items)) if (item?.foodId) foodIds.add(item.foodId);
  }
  const foods = foodIds.size
    ? await prisma.food.findMany({ where: { id: { in: [...foodIds] } }, orderBy: { name: "asc" } })
    : [];

  return {
    cutProtocolExport: {
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      userId,
      // Said out loud in the file itself, so nobody has to read this source to
      // know what they are holding.
      includes: [
        "user (identity only — the password hash is never exported)",
        "profile, weigh-ins, day-log entries (MealLog)",
        "meal plans with every slot and grocery list",
        "training plan with weeks, sessions and exercises",
        "cart, recipe ratings, saved-library entries",
        "recipes you created, with their ingredients",
        "recipes you did not create but your plans/cart/ratings point at",
        "every food row any of the above references",
        "brain preferences, chat history and AI-usage ledger",
      ],
      excludes: [
        "your password hash (a hash is a credential, not your data)",
        "the shared food library beyond the rows your own data references (14,122 rows that belong to the app, not to you)",
        "Food has no owner column in this schema, so 'foods I created' is not representable — reachable foods are exported instead",
      ],
    },
    user,
    profile,
    weighins,
    mealLogs,
    plans,
    trainingPlan,
    cartItems,
    recipeRatings,
    userLibraryEntries: libraryEntries,
    recipes: ownedRecipes,
    referencedRecipes,
    foods,
    brainPreference,
    brainConversations,
    llmUsage,
  };
}

/** Prisma Json columns arrive as parsed values, but a bad row could be anything. */
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

// ═════════════════════════════════════════════════════════════════════════════
// CSV BUNDLE
// ═════════════════════════════════════════════════════════════════════════════

const README = `Cut Protocol — data export
==========================

One CSV per table. Every file is UTF-8 with a byte-order mark so Excel shows
accented names (Gruyère, Ají de Aguacate) correctly, uses CRLF line endings,
and quotes any field containing a comma, a double quote or a line break —
doubling internal quotes, per RFC 4180.

Two things worth knowing:

* A cell that starts with an apostrophe (') followed by = + - or @ had that
  apostrophe ADDED by the export. Spreadsheets execute text starting with those
  characters as a formula; the apostrophe makes it literal text again. The
  apostrophe is not part of your data.

* Columns holding structured data (a plan slot's ingredient list, a food's
  micronutrients, a recipe's steps) are stored as JSON inside a single cell so
  nothing is lost. The same data is ALSO flattened into its own file
  (plan_slot_ingredients.csv, grocery_list_items.csv) so you can actually use it
  in a spreadsheet.

Dates are ISO-8601. Timestamps are UTC.

foods.csv contains only the food rows your own data references, not the whole
shared library — see export.json's "excludes" note if you took the JSON format.
`;

/**
 * Column list for a table: the preferred order first, then EVERY other key any
 * row actually carries.
 *
 * The tail is the point. A hand-written column list quietly drops the next
 * column somebody adds to the schema, and a dropped column in an export is the
 * exact failure this whole file exists to fix. Anything new appears at the end
 * of the CSV on the day it appears in the database.
 */
function columnsFor(rows, preferred) {
  const seen = new Set(preferred);
  const extra = [];
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) {
      // Relation arrays get their own file; a nested array in a cell is noise.
      if (Array.isArray(row[key]) && (key === "ingredients" || key === "slots" || key === "weeks" || key === "sessions" || key === "exercises" || key === "messages")) continue;
      if (!seen.has(key)) { seen.add(key); extra.push(key); }
    }
  }
  return [...preferred, ...extra];
}

function buildCsvBundle(data) {
  const files = [{ name: "README.txt", data: Buffer.from(README, "utf8") }];
  const add = (name, columns, rows) => files.push({ name, data: csvFile(columns, rows || []) });
  const addAuto = (name, preferred, rows) => add(name, columnsFor(rows, preferred), rows);

  add("user.csv", ["id", "email", "role", "createdAt"], data.user ? [data.user] : []);

  add(
    "profile.csv",
    data.profile ? Object.keys(data.profile) : ["id", "userId"],
    data.profile ? [data.profile] : []
  );

  add("weighins.csv", ["id", "userId", "date", "weightKg", "bodyFatPct", "createdAt"], data.weighins);

  add(
    "meal_logs.csv",
    ["id", "userId", "date", "source", "recipeId", "name", "kcal", "proteinG", "carbG", "fatG", "slotType", "createdAt"],
    data.mealLogs
  );

  add("plans.csv", ["id", "userId", "startDate", "createdAt"], data.plans.map((p) => ({ id: p.id, userId: p.userId, startDate: p.startDate, createdAt: p.createdAt })));

  const slots = data.plans.flatMap((p) => p.slots);
  add(
    "plan_slots.csv",
    ["id", "planId", "dayOfWeek", "slotType", "slotIndex", "recipeId", "proteinScale", "sidesScale", "kcal", "protein", "fat", "carb", "warning", "locked", "ingredients"],
    slots
  );
  add(
    "plan_slot_ingredients.csv",
    ["planSlotId", "planId", "dayOfWeek", "slotType", "slotIndex", "foodId", "name", "grams", "role"],
    slots.flatMap((s) =>
      asArray(s.ingredients).map((i) => ({
        planSlotId: s.id, planId: s.planId, dayOfWeek: s.dayOfWeek, slotType: s.slotType, slotIndex: s.slotIndex,
        foodId: i?.foodId ?? null, name: i?.name ?? null, grams: i?.grams ?? null, role: i?.role ?? null,
      }))
    )
  );

  const groceryLists = data.plans.map((p) => p.groceryList).filter(Boolean);
  add("grocery_lists.csv", ["id", "planId", "createdAt", "items"], groceryLists);
  add(
    "grocery_list_items.csv",
    ["groceryListId", "planId", "foodId", "name", "category", "grams"],
    groceryLists.flatMap((g) =>
      asArray(g.items).map((i) => ({
        groceryListId: g.id, planId: g.planId,
        foodId: i?.foodId ?? null, name: i?.name ?? null, category: i?.category ?? null, grams: i?.grams ?? null,
      }))
    )
  );

  const tp = data.trainingPlan;
  add(
    "training_plan.csv",
    ["id", "userId", "name", "style", "experience", "daysPerWeek", "sessionLengthMin", "equipment", "templateKey", "generator", "createdAt"],
    tp ? [tp] : []
  );
  const weeks = tp ? tp.weeks : [];
  add("training_weeks.csv", ["id", "planId", "weekNumber", "note"], weeks);
  const sessions = weeks.flatMap((w) => w.sessions);
  add("training_sessions.csv", ["id", "weekId", "dayIndex", "name", "focus"], sessions);
  add(
    "training_exercises.csv",
    ["id", "sessionId", "order", "name", "sets", "reps", "rpe", "restSec", "notes"],
    sessions.flatMap((s) => s.exercises)
  );

  add("cart_items.csv", ["id", "userId", "recipeId", "addedAt"], data.cartItems);
  add("recipe_ratings.csv", ["id", "userId", "recipeId", "rating", "createdAt", "updatedAt"], data.recipeRatings);
  add("user_library_entries.csv", ["id", "userId", "recipeId", "createdAt"], data.userLibraryEntries);

  const allRecipes = [
    ...data.recipes.map((r) => ({ ...r, owned: true })),
    ...data.referencedRecipes.map((r) => ({ ...r, owned: false })),
  ];
  addAuto(
    "recipes.csv",
    ["id", "name", "owned", "description", "slotType", "cuisine", "prepTimeMin", "source", "mealCategory", "kcal", "protein", "fat", "carb", "createdByUserId", "createdAt", "steps"],
    allRecipes
  );
  addAuto(
    "recipe_ingredients.csv",
    ["id", "recipeId", "recipeName", "foodId", "baseGrams", "scalable", "role"],
    allRecipes.flatMap((r) => r.ingredients.map((i) => ({ ...i, recipeId: r.id, recipeName: r.name })))
  );

  addAuto(
    "foods.csv",
    ["id", "name", "category", "fdcId", "upc", "brand", "kcal", "protein", "fat", "carb", "fiber", "source", "dataQuality", "createdAt"],
    data.foods
  );

  add("brain_preference.csv", ["id", "userId", "data", "updatedAt"], data.brainPreference ? [data.brainPreference] : []);
  add("brain_conversations.csv", ["id", "userId", "title", "createdAt", "updatedAt"], data.brainConversations);
  add(
    "brain_messages.csv",
    ["id", "conversationId", "role", "content", "createdAt"],
    data.brainConversations.flatMap((c) => c.messages)
  );
  add(
    "llm_usage.csv",
    ["id", "userId", "model", "phase", "intent", "inputTokens", "outputTokens", "cacheReadTokens", "costUsd", "createdAt"],
    data.llmUsage
  );

  return files;
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/export
// ═════════════════════════════════════════════════════════════════════════════

router.get("/export", requireAuth, async (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  if (format !== "json" && format !== "csv") {
    return res.status(400).json({ error: `Unknown export format "${format}". Use format=json or format=csv.` });
  }

  const data = await collectUserExport(req.userId);
  if (!data.user) return res.status(404).json({ error: "No account found for this session." });

  const stamp = new Date().toISOString().slice(0, 10);
  // Nothing here is derived from user input, so the filename cannot be injected.
  res.setHeader("Cache-Control", "no-store");

  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cut-protocol-export-${stamp}.json"`);
    return res.send(JSON.stringify(data, null, 2));
  }

  const zip = zipSync(buildCsvBundle(data));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="cut-protocol-export-${stamp}.zip"`);
  res.setHeader("Content-Length", String(zip.length));
  return res.end(zip);
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/import
// ═════════════════════════════════════════════════════════════════════════════
//
// The other half of "never trapped": an export you cannot restore is a
// souvenir, not a way out.
//
// WHAT IT DELIBERATELY DOES NOT IMPORT, and why — every one of these is a
// decision, not an omission:
//
//   * The `user` row. You are importing INTO an account you are already signed
//     in to; there is nothing to create. Critically this means `role` is never
//     read from the file — otherwise any user could hand themselves
//     `role: "admin"` by editing one line of their own export. Privilege
//     escalation via restore is a real class of bug and this is where it is
//     closed.
//   * `foods`. Food carries @unique fdcId/upc and a provenance tier the whole
//     app trusts; this repo already spent Phase 2 and a provenance repair
//     cleaning that table. Writing rows into the SHARED library from a file the
//     user can edit would reopen exactly that wound. Foods are RESOLVED against
//     the local library instead (by fdcId, then upc, then name).
//   * `llmUsage`. It is the spend ledger the cost caps read, not user content.
//   * Generated brain artifacts (GeneratedRecipe/Plan, BrainSolveRun). Derived
//     scratch, regenerable, and large.
//
// Everything else round-trips. Anything that could not be matched is REPORTED
// by name in the response — never silently dropped, never guessed at.

const MAX_IMPORT_ROWS = 200000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v, fallback = false) => (typeof v === "boolean" ? v : fallback);
const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
const date = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function countRows(payload) {
  let n = 0;
  for (const key of ["weighins", "mealLogs", "plans", "cartItems", "recipeRatings", "userLibraryEntries", "recipes", "brainConversations"]) {
    n += arr(payload[key]).length;
  }
  for (const p of arr(payload.plans)) n += arr(p.slots).length;
  for (const r of arr(payload.recipes)) n += arr(r.ingredients).length;
  return n;
}

/**
 * Map every foodId mentioned in the payload onto a LOCAL Food id.
 * Ladder, most to least certain: same id present locally -> same fdcId ->
 * same upc -> exact name (case-insensitive). Anything that falls off the end
 * stays unresolved and is reported.
 */
async function buildFoodMap(payload) {
  const exported = arr(payload.foods).filter(isObj);
  const ids = exported.map((f) => str(f.id)).filter(Boolean);
  const fdcIds = exported.map((f) => int(f.fdcId)).filter((v) => v !== null);
  const upcs = exported.map((f) => str(f.upc)).filter(Boolean);
  const names = exported.map((f) => str(f.name)).filter(Boolean);

  const [byIdRows, byFdcRows, byUpcRows, byNameRows] = await Promise.all([
    ids.length ? prisma.food.findMany({ where: { id: { in: ids } }, select: { id: true } }) : [],
    fdcIds.length ? prisma.food.findMany({ where: { fdcId: { in: fdcIds } }, select: { id: true, fdcId: true } }) : [],
    upcs.length ? prisma.food.findMany({ where: { upc: { in: upcs } }, select: { id: true, upc: true } }) : [],
    names.length ? prisma.food.findMany({ where: { name: { in: names } }, select: { id: true, name: true } }) : [],
  ]);

  const localIds = new Set(byIdRows.map((f) => f.id));
  const byFdc = new Map(byFdcRows.map((f) => [f.fdcId, f.id]));
  const byUpc = new Map(byUpcRows.map((f) => [f.upc, f.id]));
  // SQLite LIKE/IN on TEXT is case-sensitive for `in:`, so fold explicitly.
  const byName = new Map();
  for (const f of byNameRows) {
    const key = f.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, f.id);
  }

  const map = new Map();
  const unresolved = [];
  for (const f of exported) {
    const id = str(f.id);
    if (!id) continue;
    const hit =
      (localIds.has(id) && id) ||
      byFdc.get(int(f.fdcId)) ||
      byUpc.get(str(f.upc)) ||
      byName.get((str(f.name) || "").trim().toLowerCase()) ||
      null;
    if (hit) map.set(id, hit);
    else unresolved.push(str(f.name) || id);
  }
  return { map, unresolved };
}

/** Same ladder for recipes: local id, then exact name. */
async function buildRecipeMap(payload) {
  const all = [...arr(payload.recipes), ...arr(payload.referencedRecipes)].filter(isObj);
  const ids = all.map((r) => str(r.id)).filter(Boolean);
  const names = all.map((r) => str(r.name)).filter(Boolean);
  const [byIdRows, byNameRows] = await Promise.all([
    ids.length ? prisma.recipe.findMany({ where: { id: { in: ids } }, select: { id: true } }) : [],
    names.length ? prisma.recipe.findMany({ where: { name: { in: names } }, select: { id: true, name: true } }) : [],
  ]);
  const localIds = new Set(byIdRows.map((r) => r.id));
  const byName = new Map();
  for (const r of byNameRows) {
    const key = r.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, r.id);
  }
  const map = new Map();
  for (const r of all) {
    const id = str(r.id);
    if (!id) continue;
    const hit = (localIds.has(id) && id) || byName.get((str(r.name) || "").trim().toLowerCase()) || null;
    if (hit) map.set(id, hit);
  }
  return { map, byName, localIds };
}

router.post("/import", requireAuth, async (req, res) => {
  const payload = req.body;
  if (!isObj(payload) || !isObj(payload.cutProtocolExport)) {
    return res.status(400).json({ error: "That is not a Cut Protocol export — the file must contain a cutProtocolExport header." });
  }
  const version = payload.cutProtocolExport.formatVersion;
  if (version !== FORMAT_VERSION) {
    return res.status(400).json({ error: `Export format version ${version} cannot be read by this build (it understands version ${FORMAT_VERSION}).` });
  }
  const rowCount = countRows(payload);
  if (rowCount > MAX_IMPORT_ROWS) {
    return res.status(413).json({ error: `That export contains ${rowCount} rows, more than this endpoint will import in one go (${MAX_IMPORT_ROWS}).` });
  }

  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true" || payload.dryRun === true;
  const userId = req.userId;

  const [{ map: foodMap, unresolved: unresolvedFoods }, { map: recipeMap }] = await Promise.all([
    buildFoodMap(payload),
    buildRecipeMap(payload),
  ]);

  const imported = {
    profile: 0, weighins: 0, mealLogs: 0, plans: 0, planSlots: 0, groceryLists: 0,
    trainingPlan: 0, trainingWeeks: 0, trainingSessions: 0, trainingExercises: 0,
    cartItems: 0, recipeRatings: 0, userLibraryEntries: 0, recipes: 0, recipeIngredients: 0,
    brainPreference: 0, brainConversations: 0, brainMessages: 0,
  };
  const skipped = { recipes: [], cartItems: 0, recipeRatings: 0, userLibraryEntries: 0, planSlotRecipeLinks: 0, mealLogs: 0 };
  const warnings = [];

  const run = async (tx) => {
    // ── recipes the exporting user created ───────────────────────────────
    // Done FIRST so plan slots and cart items can point at them.
    for (const r of arr(payload.recipes).filter(isObj)) {
      const sourceId = str(r.id);
      if (sourceId && recipeMap.has(sourceId)) continue; // already here by id or name

      const ingredients = arr(r.ingredients).filter(isObj);
      const resolved = [];
      const missing = [];
      for (const i of ingredients) {
        const localFoodId = foodMap.get(str(i.foodId));
        if (!localFoodId) missing.push(str(i.foodId));
        else resolved.push({ foodId: localFoodId, baseGrams: num(i.baseGrams) ?? 0, scalable: bool(i.scalable, true), role: str(i.role) });
      }
      if (missing.length) {
        // A recipe missing an ingredient has WRONG macros, and a wrong number is
        // worse than an absent one (constitution: "wrong math = product death").
        // So it is skipped whole and named in the response, never half-imported.
        skipped.recipes.push({ name: str(r.name) || sourceId, reason: `${missing.length} ingredient food(s) not found in this library` });
        continue;
      }
      // @@unique([recipeId, foodId]) — an export from a pre-constraint DB can
      // still carry duplicates; merge grams exactly as migration 20260724203000 did.
      const merged = new Map();
      for (const i of resolved) {
        const prev = merged.get(i.foodId);
        if (prev) prev.baseGrams += i.baseGrams;
        else merged.set(i.foodId, { ...i });
      }

      let name = str(r.name) || "Imported recipe";
      const clash = await tx.recipe.findUnique({ where: { name }, select: { id: true } });
      if (clash) {
        name = `${name} (imported ${new Date().toISOString().slice(0, 10)})`;
        const second = await tx.recipe.findUnique({ where: { name }, select: { id: true } });
        if (second) name = `${name} ${Math.random().toString(36).slice(2, 7)}`;
        warnings.push(`A recipe named "${str(r.name)}" already existed; yours was imported as "${name}".`);
      }

      if (!dryRun) {
        const created = await tx.recipe.create({
          data: {
            name,
            description: str(r.description),
            steps: r.steps ?? [],
            slotType: str(r.slotType) || "meal",
            cuisine: str(r.cuisine),
            prepTimeMin: int(r.prepTimeMin),
            source: str(r.source) || "imported",
            mealCategory: str(r.mealCategory),
            kcal: num(r.kcal) ?? 0,
            protein: num(r.protein) ?? 0,
            fat: num(r.fat) ?? 0,
            carb: num(r.carb) ?? 0,
            costPerServing: num(r.costPerServing),
            difficulty: int(r.difficulty),
            filterProvenance: str(r.filterProvenance),
            createdByUserId: userId, // ownership is always the CALLER, never the file
            ingredients: { create: [...merged.values()] },
          },
          select: { id: true },
        });
        if (sourceId) recipeMap.set(sourceId, created.id);
      } else if (sourceId) {
        recipeMap.set(sourceId, `dry-run:${sourceId}`);
      }
      imported.recipes += 1;
      imported.recipeIngredients += merged.size;
    }

    // ── profile ──────────────────────────────────────────────────────────
    const p = payload.profile;
    if (isObj(p)) {
      const data = {
        sex: str(p.sex) === "F" ? "F" : "M",
        age: int(p.age) ?? 30,
        heightCm: num(p.heightCm) ?? 170,
        bodyFatPct: num(p.bodyFatPct) ?? 0,
        bodyFatSource: str(p.bodyFatSource),
        occupationKey: str(p.occupationKey) || "desk-office",
        activityOverride: num(p.activityOverride),
        sessionsPerWeek: int(p.sessionsPerWeek) ?? 0,
        trainingStyle: str(p.trainingStyle) || "mixed",
        minutesPerSession: int(p.minutesPerSession) ?? 45,
        startWeightKg: num(p.startWeightKg) ?? 0,
        goalWeightKg: num(p.goalWeightKg) ?? 0,
        startDate: str(p.startDate) || new Date().toISOString().slice(0, 10),
        unitPref: str(p.unitPref) || "imperial",
        rateLbPerWeek: num(p.rateLbPerWeek) ?? 1.0,
        rateAcknowledged: bool(p.rateAcknowledged),
        floorKcal: int(p.floorKcal),
        excludedFormulas: p.excludedFormulas ?? [],
        targetKcal: int(p.targetKcal) ?? 0,
        mealsPerDay: int(p.mealsPerDay) ?? 3,
        snacksPerDay: int(p.snacksPerDay) ?? 1,
        excludedFoods: p.excludedFoods ?? [],
        dietaryStyle: str(p.dietaryStyle),
        cuisinePreferences: p.cuisinePreferences ?? [],
        mealPreferencesNote: str(p.mealPreferencesNote),
        maxPrepMin: int(p.maxPrepMin),
        budgetTier: str(p.budgetTier),
        allowBatch: typeof p.allowBatch === "boolean" ? p.allowBatch : null,
        maxComplexity: int(p.maxComplexity),
        adaptiveTdee: bool(p.adaptiveTdee, true),
        proteinPriorityMode: bool(p.proteinPriorityMode, false),
      };
      if (!dryRun) await tx.profile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
      imported.profile = 1;
      warnings.push("Your calorie target is re-derived from your profile and weigh-ins on the next read — the imported number is a starting point, not an override.");
    }

    // ── weigh-ins ────────────────────────────────────────────────────────
    for (const w of arr(payload.weighins).filter(isObj)) {
      const d = str(w.date);
      const kg = num(w.weightKg);
      if (!d || kg === null) continue;
      if (!dryRun) {
        await tx.weighin.upsert({
          where: { userId_date: { userId, date: d } },
          update: { weightKg: kg, bodyFatPct: num(w.bodyFatPct) },
          create: { userId, date: d, weightKg: kg, bodyFatPct: num(w.bodyFatPct) },
        });
      }
      imported.weighins += 1;
    }

    // ── day log ──────────────────────────────────────────────────────────
    // MealLog has no unique constraint, so a second import would otherwise
    // double every meal. Dedupe on the tuple that identifies an entry to a
    // human: date + name + kcal + source.
    const existingLogs = new Set(
      (await tx.mealLog.findMany({ where: { userId }, select: { date: true, name: true, kcal: true, source: true } }))
        .map((m) => `${m.date}|${m.name}|${m.kcal}|${m.source}`)
    );
    for (const m of arr(payload.mealLogs).filter(isObj)) {
      const d = str(m.date);
      const name = str(m.name);
      const kcal = int(m.kcal);
      const source = str(m.source) === "planned" ? "planned" : "manual";
      if (!d || !name || kcal === null) continue;
      const key = `${d}|${name}|${kcal}|${source}`;
      if (existingLogs.has(key)) { skipped.mealLogs += 1; continue; }
      existingLogs.add(key);
      if (!dryRun) {
        await tx.mealLog.create({
          data: {
            userId, date: d, source, name, kcal,
            recipeId: recipeMap.get(str(m.recipeId)) ?? null,
            proteinG: num(m.proteinG) ?? 0, carbG: num(m.carbG) ?? 0, fatG: num(m.fatG) ?? 0,
            slotType: str(m.slotType),
          },
        });
      }
      imported.mealLogs += 1;
    }

    // ── plans ────────────────────────────────────────────────────────────
    for (const plan of arr(payload.plans).filter(isObj)) {
      const startDate = str(plan.startDate);
      if (!startDate) continue;
      let planId = null;
      if (!dryRun) {
        const existing = await tx.plan.findUnique({ where: { userId_startDate: { userId, startDate } }, select: { id: true } });
        if (existing) {
          // Replace the week wholesale — a half-merged plan is not a plan.
          planId = existing.id;
          await tx.groceryList.deleteMany({ where: { planId } });
          await tx.planSlot.deleteMany({ where: { planId } });
        } else {
          planId = (await tx.plan.create({ data: { userId, startDate }, select: { id: true } })).id;
        }
      }
      imported.plans += 1;

      for (const s of arr(plan.slots).filter(isObj)) {
        const exportedRecipeId = str(s.recipeId);
        const localRecipeId = exportedRecipeId ? recipeMap.get(exportedRecipeId) ?? null : null;
        if (exportedRecipeId && !localRecipeId) skipped.planSlotRecipeLinks += 1;
        if (!dryRun) {
          await tx.planSlot.create({
            data: {
              planId,
              dayOfWeek: int(s.dayOfWeek) ?? 0,
              slotType: str(s.slotType) || "meal",
              slotIndex: int(s.slotIndex) ?? 0,
              // A slot whose recipe is not in this library keeps its resolved
              // ingredient grams and macros, so the history stays TRUE even
              // though the link is gone. Nulling the link is honest; inventing
              // one would not be.
              recipeId: localRecipeId,
              proteinScale: num(s.proteinScale) ?? 1,
              sidesScale: num(s.sidesScale) ?? 1,
              ingredients: s.ingredients ?? [],
              kcal: num(s.kcal) ?? 0, protein: num(s.protein) ?? 0, fat: num(s.fat) ?? 0, carb: num(s.carb) ?? 0,
              warning: str(s.warning),
              locked: bool(s.locked),
            },
          });
        }
        imported.planSlots += 1;
      }

      const gl = plan.groceryList;
      if (isObj(gl)) {
        if (!dryRun) await tx.groceryList.create({ data: { planId, items: gl.items ?? [] } });
        imported.groceryLists += 1;
      }
    }

    // ── training ─────────────────────────────────────────────────────────
    const tp = payload.trainingPlan;
    if (isObj(tp)) {
      if (!dryRun) {
        // TrainingPlan.userId is @unique — v1 is one active plan, and the
        // generator already replaces transactionally. Same contract here.
        await tx.trainingPlan.deleteMany({ where: { userId } });
        await tx.trainingPlan.create({
          data: {
            userId,
            name: str(tp.name) || "Imported plan",
            style: str(tp.style) || "general",
            experience: str(tp.experience) || "beginner",
            daysPerWeek: int(tp.daysPerWeek) ?? 3,
            sessionLengthMin: int(tp.sessionLengthMin) ?? 45,
            equipment: tp.equipment ?? [],
            templateKey: str(tp.templateKey) || "imported",
            generator: str(tp.generator) || "imported",
            weeks: {
              create: arr(tp.weeks).filter(isObj).map((w) => ({
                weekNumber: int(w.weekNumber) ?? 1,
                note: str(w.note),
                sessions: {
                  create: arr(w.sessions).filter(isObj).map((sess) => ({
                    dayIndex: int(sess.dayIndex) ?? 0,
                    name: str(sess.name) || "Session",
                    focus: str(sess.focus),
                    exercises: {
                      create: arr(sess.exercises).filter(isObj).map((e) => ({
                        order: int(e.order) ?? 0,
                        name: str(e.name) || "Exercise",
                        sets: int(e.sets) ?? 1,
                        reps: str(e.reps) || "1",
                        rpe: num(e.rpe),
                        restSec: int(e.restSec),
                        notes: str(e.notes),
                      })),
                    },
                  })),
                },
              })),
            },
          },
        });
      }
      imported.trainingPlan = 1;
      imported.trainingWeeks = arr(tp.weeks).length;
      imported.trainingSessions = arr(tp.weeks).flatMap((w) => arr(w?.sessions)).length;
      imported.trainingExercises = arr(tp.weeks).flatMap((w) => arr(w?.sessions)).flatMap((s) => arr(s?.exercises)).length;
    }

    // ── recipe-linked collections ────────────────────────────────────────
    // In a dry run the map may hold `dry-run:<id>` placeholders for recipes that
    // WOULD have been created. They count as resolved for reporting purposes —
    // every write below is guarded by `!dryRun`, so a placeholder can never
    // reach the database, and reporting them as "skipped" would make a dry run
    // lie about what a real run will do.
    const linkRecipe = (exportedId) => recipeMap.get(str(exportedId)) ?? null;

    for (const c of arr(payload.cartItems).filter(isObj)) {
      const recipeId = linkRecipe(c.recipeId);
      if (!recipeId) { skipped.cartItems += 1; continue; }
      if (!dryRun) {
        await tx.cartItem.upsert({
          where: { userId_recipeId: { userId, recipeId } },
          update: {},
          create: { userId, recipeId },
        });
      }
      imported.cartItems += 1;
    }

    for (const r of arr(payload.recipeRatings).filter(isObj)) {
      const recipeId = linkRecipe(r.recipeId);
      const rating = int(r.rating);
      if (!recipeId || (rating !== 1 && rating !== -1)) { skipped.recipeRatings += 1; continue; }
      if (!dryRun) {
        await tx.recipeRating.upsert({
          where: { userId_recipeId: { userId, recipeId } },
          update: { rating },
          create: { userId, recipeId, rating },
        });
      }
      imported.recipeRatings += 1;
    }

    for (const e of arr(payload.userLibraryEntries).filter(isObj)) {
      const recipeId = linkRecipe(e.recipeId);
      if (!recipeId) { skipped.userLibraryEntries += 1; continue; }
      if (!dryRun) {
        await tx.userLibraryEntry.upsert({
          where: { userId_recipeId: { userId, recipeId } },
          update: {},
          create: { userId, recipeId },
        });
      }
      imported.userLibraryEntries += 1;
    }

    // ── brain ────────────────────────────────────────────────────────────
    if (isObj(payload.brainPreference)) {
      if (!dryRun) {
        await tx.brainPreference.upsert({
          where: { userId },
          update: { data: payload.brainPreference.data ?? {} },
          create: { userId, data: payload.brainPreference.data ?? {} },
        });
      }
      imported.brainPreference = 1;
    }
    for (const c of arr(payload.brainConversations).filter(isObj)) {
      const messages = arr(c.messages).filter(isObj);
      if (!dryRun) {
        await tx.brainConversation.create({
          data: {
            userId,
            title: str(c.title),
            messages: {
              create: messages.map((m) => ({
                role: str(m.role) === "assistant" ? "assistant" : "user",
                content: str(m.content) || "",
              })),
            },
          },
        });
      }
      imported.brainConversations += 1;
      imported.brainMessages += messages.length;
    }
  };

  if (dryRun) {
    // No writes at all — every write branch above is guarded by `!dryRun`, so
    // this just walks the payload and reports. It still runs inside a
    // transaction that is deliberately rolled back, so an unguarded write
    // introduced by a later edit cannot escape either.
    try {
      await prisma.$transaction(async (tx) => { await run(tx); throw new DryRunRollback(); }, { timeout: 120000, maxWait: 20000 });
    } catch (e) {
      if (!(e instanceof DryRunRollback)) throw e;
    }
  } else {
    await prisma.$transaction(run, { timeout: 120000, maxWait: 20000 });
  }

  if (unresolvedFoods.length) {
    warnings.push(
      `${unresolvedFoods.length} food(s) in the file are not in this install's library` +
      ` (e.g. ${unresolvedFoods.slice(0, 3).join(", ")}). Foods are never written into the shared library by an import;` +
      " recipes that needed them were skipped and are listed above."
    );
  }

  res.json({
    ok: true,
    dryRun,
    rowsSeen: rowCount,
    imported,
    skipped,
    warnings,
    notImported: [
      "user account + role (you are importing into the account you are signed in to)",
      "food library rows (resolved against this install's library instead)",
      "AI spend ledger and generated brain artifacts",
    ],
  });
});

module.exports = router;
// Exported for tests — the CSV rules are the part of this file most likely to be
// broken by a well-meaning refactor, so they are directly testable.
module.exports.csvCell = csvCell;
module.exports.csvFile = csvFile;
module.exports.zipSync = zipSync;
module.exports.collectUserExport = collectUserExport;
module.exports.buildCsvBundle = buildCsvBundle;
module.exports.FORMAT_VERSION = FORMAT_VERSION;
