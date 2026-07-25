// GET /api/export + POST /api/import — the constitution's "data is never
// trapped" clause, which had NO implementation until 2026-07-24 (a repo-wide
// search for `text/csv`, `Content-Disposition`, `new Blob`, `showSaveDialog`
// and `.csv` returned zero hits outside node_modules, in the tree and in the
// shipped app.asar).
//
// Two halves are tested here, and the CSV half is the one most likely to rot:
//
//  1. AUTHORIZATION. This endpoint returns a person's entire life in one
//     response. There must be no way — parameter, query, body, header — to make
//     it emit someone else's rows.
//
//  2. CSV CORRECTNESS, against the shapes the LIVE library actually contains
//     (measured 2026-07-24 over 14,122 foods + 889 recipes = 15,011 names):
//     12,331 names carry a comma, 1,008 carry a literal double quote (USDA inch
//     marks — `trimmed to 0" fat`), 45 are non-ASCII. Zero begin with `=` today,
//     but nothing stops one: foods arrive by barcode import and recipes from
//     arbitrary URLs, and foodValidation.js does not reject a leading `=`.
//
// Runs against a throwaway SQLite file built from the shipped migrations, same
// pattern as tests/auth.registration.test.js — never the developer's dev.db.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");

let tmpDir, dbFile, app, srv, base, prisma, exportModule;
let userA, userB, cookieA, cookieB;
let foodPlain, foodComma, foodQuote, foodAccent, foodFormula;

function buildFreshInstallDb(file) {
  const migrationsDir = path.join(BACKEND, "prisma", "migrations");
  const names = fs
    .readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  assert.ok(names.length > 0, "no migrations found — cannot build a fresh-install DB");
  const db = new DatabaseSync(file);
  try {
    for (const name of names) db.exec(fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  } finally {
    db.close();
  }
}

async function call(method, p, { body, cookie, raw } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON kept in text */ }
  return { status: res.status, json, text, headers: res.headers, setCookie: res.headers.get("set-cookie") };
}

const cookieFrom = (setCookie) => (setCookie || "").split(";")[0];

/** Minimal ZIP reader: name -> Buffer, straight off the local file headers. */
function unzip(buffer) {
  const out = new Map();
  let i = 0;
  while (i + 4 <= buffer.length && buffer.readUInt32LE(i) === 0x04034b50) {
    const method = buffer.readUInt16LE(i + 8);
    const compressedSize = buffer.readUInt32LE(i + 18);
    const nameLen = buffer.readUInt16LE(i + 26);
    const extraLen = buffer.readUInt16LE(i + 28);
    const name = buffer.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    const payload = buffer.subarray(start, start + compressedSize);
    out.set(name, method === 0 ? Buffer.from(payload) : zlib.inflateRawSync(payload));
    i = start + compressedSize;
  }
  return out;
}

/** RFC 4180 parser — deliberately independent of the writer under test. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* CRLF: handled at \n */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-export-"));
  dbFile = path.join(tmpDir, "export-test.db");
  buildFreshInstallDb(dbFile);

  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "export-route-test-only-secret"; // scan:allow — fixture; keeps the developer's real secret out of this process
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";
  process.env.CUT_PROTOCOL_AUDIT = "off";

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  exportModule = require(path.join(BACKEND, "src", "routes", "export.js"));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  // Two accounts. B exists solely to prove A can never reach B's rows.
  // The first account on an empty install registers freely and lands as admin —
  // which makes A the strongest possible attacker for the scoping tests below.
  const regA = await call("POST", "/api/auth/register", { body: { email: "a@example.test", password: "correct-horse-battery" } });
  assert.ok(regA.status < 300, `register failed: ${regA.status} ${regA.text}`);
  cookieA = cookieFrom(regA.setCookie);
  userA = (await prisma.user.findUnique({ where: { email: "a@example.test" } })).id;

  // Registration is gated once an account exists, so B is created directly.
  const { hashPassword, signToken } = require(path.join(BACKEND, "src", "lib", "auth.js"));
  const hashB = await hashPassword("correct-horse-battery-2");
  const b = await prisma.user.create({ data: { email: "b@example.test", passwordHash: hashB } });
  userB = b.id;
  cookieB = `cutprotocol_session=${signToken(userB, hashB)}`;

  // ── the four CSV hazards, as real food rows ────────────────────────────
  const mk = (name, over = {}) => prisma.food.create({
    data: { name, category: "pantry", kcal: 100, protein: 5, fat: 2, carb: 15.5, fiber: 0, source: "manual", ...over },
  });
  foodPlain = await mk("Chicken breast");
  foodComma = await mk("Almond milk, unsweetened, plain, refrigerated");
  foodAccent = await mk("Gruyère, aged");
  foodQuote = await mk('Beef, tri-tip, trimmed to 0" fat, choice, raw');
  foodFormula = await mk("=cmd|' /C calc'!A0");

  // A's data. Every table the export claims to cover gets at least one row.
  await prisma.profile.create({
    data: {
      userId: userA, sex: "M", age: 35, heightCm: 180, bodyFatPct: 20,
      sessionsPerWeek: 3, startWeightKg: 100, goalWeightKg: 90, startDate: "2026-01-01",
      excludedFormulas: [], excludedFoods: ["shellfish"], cuisinePreferences: ["mexican"],
      targetKcal: 2400, mealPreferencesNote: "no dairy",
    },
  });
  await prisma.weighin.create({ data: { userId: userA, date: "2026-01-02", weightKg: 99.5, bodyFatPct: 19.8 } });
  await prisma.weighin.create({ data: { userId: userA, date: "2026-01-09", weightKg: 98.9 } });
  await prisma.mealLog.create({
    data: { userId: userA, date: "2026-01-02", source: "manual", name: "Gruyère, aged — 30 g", kcal: 120, proteinG: 8, carbG: 0.5, fatG: 9.5, slotType: "snack" },
  });

  const ownedRecipe = await prisma.recipe.create({
    data: {
      name: "A's =risky, \"quoted\" dish", steps: ["Mix", "Eat"], kcal: 400, protein: 30, fat: 12, carb: 40,
      createdByUserId: userA, source: "imported",
      ingredients: { create: [
        { foodId: foodComma.id, baseGrams: 200 },
        { foodId: foodAccent.id, baseGrams: 30 },
        { foodId: foodFormula.id, baseGrams: 10 },
      ] },
    },
  });
  const libraryRecipe = await prisma.recipe.create({
    data: {
      name: "Shared library stew", steps: ["Simmer"], kcal: 500, protein: 25, fat: 20, carb: 45,
      ingredients: { create: [{ foodId: foodQuote.id, baseGrams: 150 }] },
    },
  });

  const plan = await prisma.plan.create({ data: { userId: userA, startDate: "2026-01-05" } });
  await prisma.planSlot.create({
    data: {
      planId: plan.id, dayOfWeek: 0, slotType: "meal", slotIndex: 0, recipeId: libraryRecipe.id,
      ingredients: [{ foodId: foodQuote.id, name: foodQuote.name, grams: 150, role: "protein" }],
      kcal: 500, protein: 25, fat: 20, carb: 45,
    },
  });
  await prisma.groceryList.create({
    data: { planId: plan.id, items: [{ foodId: foodQuote.id, name: foodQuote.name, category: "protein", grams: 150 }] },
  });
  await prisma.cartItem.create({ data: { userId: userA, recipeId: libraryRecipe.id } });
  await prisma.recipeRating.create({ data: { userId: userA, recipeId: libraryRecipe.id, rating: -1 } });
  await prisma.userLibraryEntry.create({ data: { userId: userA, recipeId: ownedRecipe.id } });
  await prisma.trainingPlan.create({
    data: {
      userId: userA, name: "3-Day Full Body", style: "hypertrophy", experience: "beginner",
      daysPerWeek: 3, sessionLengthMin: 60, equipment: ["barbell"], templateKey: "full-body-3",
      weeks: { create: [{ weekNumber: 1, note: "Add reps", sessions: { create: [{ dayIndex: 0, name: "Full Body A", exercises: { create: [{ order: 0, name: "Squat", sets: 3, reps: "8-12", rpe: 7, restSec: 120 }] } }] } }] },
    },
  });

  // B's data — none of it may ever appear in A's export.
  await prisma.weighin.create({ data: { userId: userB, date: "2026-02-02", weightKg: 70 } });
  await prisma.mealLog.create({ data: { userId: userB, date: "2026-02-02", source: "manual", name: "B-ONLY-SECRET-MEAL", kcal: 1, proteinG: 0, carbG: 0, fatG: 0 } });
  await prisma.recipe.create({ data: { name: "B-ONLY-SECRET-RECIPE", steps: [], kcal: 1, protein: 0, fat: 0, carb: 0, createdByUserId: userB } });
});

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── the unit the whole format rests on ──────────────────────────────────────

test("csvCell: a comma forces quoting, and the value survives a round trip", () => {
  const { csvCell } = exportModule;
  assert.equal(csvCell("Almond milk, unsweetened, plain, refrigerated"), '"Almond milk, unsweetened, plain, refrigerated"');
});

test("csvCell: an embedded double quote is DOUBLED, not dropped or escaped with a backslash", () => {
  const { csvCell } = exportModule;
  // 1,008 live library names look like this (USDA inch marks).
  assert.equal(csvCell('Beef, trimmed to 0" fat'), '"Beef, trimmed to 0"" fat"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

test("csvCell: a leading = + - or @ in TEXT is neutralised with a leading apostrophe", () => {
  const { csvCell } = exportModule;
  assert.equal(csvCell("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
  assert.equal(csvCell("+1-555-0100"), "'+1-555-0100");
  assert.equal(csvCell("@SUM(A1:A9)"), "'@SUM(A1:A9)");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("\t=1+1"), '"\'\t=1+1"');
});

test("csvCell: a NUMBER is never apostrophe-prefixed — -1 must stay a number", () => {
  const { csvCell } = exportModule;
  // RecipeRating.rating is legitimately -1. Prefixing it turns a numeric column
  // into text in every spreadsheet, breaking sums for every user to defend
  // against a value that cannot carry a payload.
  assert.equal(csvCell(-1), "-1");
  assert.equal(csvCell(-12.5), "-12.5");
  assert.equal(csvCell(0), "0");
});

test("csvCell: nulls are empty, booleans are words, dates are ISO-8601", () => {
  const { csvCell } = exportModule;
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(true), "true");
  assert.equal(csvCell(new Date("2026-07-24T12:34:56.000Z")), "2026-07-24T12:34:56.000Z");
  assert.equal(csvCell(NaN), "");
});

test("csvCell: a newline inside a value forces quoting instead of breaking the row", () => {
  const { csvCell } = exportModule;
  assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
});

test("csvFile: every file opens with a UTF-8 BOM and uses CRLF", () => {
  const buf = exportModule.csvFile(["name"], [{ name: "Gruyère" }]);
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], "Excel needs the BOM or accents render as GruyÃ¨re");
  assert.ok(buf.toString("utf8").includes("\r\n"));
  assert.ok(buf.toString("utf8").includes("Gruyère"));
});

// ── authorization ───────────────────────────────────────────────────────────

test("GET /api/export requires a session", async () => {
  const r = await call("GET", "/api/export");
  assert.equal(r.status, 401);
});

test("POST /api/import requires a session", async () => {
  const r = await call("POST", "/api/import", { body: { cutProtocolExport: { formatVersion: 1 } } });
  assert.equal(r.status, 401);
});

test("the export contains ONLY the caller's rows — no parameter can widen it", async () => {
  // Every shape someone would try to smuggle another user's id through.
  const attempts = [
    "/api/export",
    `/api/export?userId=${userB}`,
    `/api/export?id=${userB}`,
    "/api/export?email=b@example.test",
    `/api/export?format=json&userId=${userB}`,
  ];
  for (const url of attempts) {
    const r = await call("GET", url, { cookie: cookieA });
    assert.equal(r.status, 200, `${url} -> ${r.status}`);
    assert.equal(r.json.user.id, userA, `${url} exported the wrong user`);
    const blob = JSON.stringify(r.json);
    assert.ok(!blob.includes("B-ONLY-SECRET-MEAL"), `${url} leaked another user's day log`);
    assert.ok(!blob.includes("B-ONLY-SECRET-RECIPE"), `${url} leaked another user's recipe`);
    assert.ok(!blob.includes("b@example.test"), `${url} leaked another user's email`);
  }
});

test("B's own export is B's own data — the scoping is per-session, not per-first-user", async () => {
  const r = await call("GET", "/api/export", { cookie: cookieB });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.id, userB);
  assert.equal(r.json.weighins.length, 1);
  assert.equal(r.json.weighins[0].date, "2026-02-02");
  assert.ok(!JSON.stringify(r.json).includes("a@example.test"));
});

test("the password hash never leaves the building", async () => {
  const r = await call("GET", "/api/export", { cookie: cookieA });
  const blob = JSON.stringify(r.json);
  assert.ok(!blob.includes("passwordHash"), "the key itself must not appear");
  assert.ok(!/\$2[aby]\$\d\d\$/.test(blob), "no bcrypt hash may appear anywhere in the payload");
});

// ── JSON completeness ───────────────────────────────────────────────────────

test("the JSON export carries every entity the promise names", async () => {
  const r = await call("GET", "/api/export?format=json", { cookie: cookieA });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.match(r.headers.get("content-disposition"), /attachment; filename="cut-protocol-export-\d{4}-\d{2}-\d{2}\.json"/);

  const d = r.json;
  assert.equal(d.cutProtocolExport.formatVersion, exportModule.FORMAT_VERSION);
  assert.equal(d.user.email, "a@example.test");
  assert.equal(d.profile.targetKcal, 2400);
  assert.deepEqual(d.profile.excludedFoods, ["shellfish"]);
  assert.equal(d.weighins.length, 2);
  assert.equal(d.mealLogs.length, 1);
  assert.equal(d.plans.length, 1);
  assert.equal(d.plans[0].slots.length, 1, "a plan without its slots is not an exported plan");
  assert.ok(d.plans[0].groceryList, "the grocery list travels with its plan");
  assert.equal(d.trainingPlan.weeks[0].sessions[0].exercises[0].name, "Squat");
  assert.equal(d.cartItems.length, 1);
  assert.equal(d.recipeRatings.length, 1);
  assert.equal(d.userLibraryEntries.length, 1);
  assert.equal(d.recipes.length, 1, "the user's own recipe");
  assert.equal(d.recipes[0].ingredients.length, 3, "with its ingredients — a recipe without them is not exportable data");
  assert.equal(d.referencedRecipes.length, 1, "and the library recipe their plan/cart points at");
  // Every food id any of the above references must be resolvable inside the file.
  const foodIds = new Set(d.foods.map((f) => f.id));
  for (const rec of [...d.recipes, ...d.referencedRecipes]) {
    for (const i of rec.ingredients) assert.ok(foodIds.has(i.foodId), `ingredient food ${i.foodId} is a dangling id`);
  }
  for (const s of d.plans[0].slots) {
    for (const i of s.ingredients) assert.ok(foodIds.has(i.foodId), "plan slot ingredient is a dangling id");
  }
});

test("the shared 14k food library is NOT dumped — only rows the user's data reaches", async () => {
  const r = await call("GET", "/api/export", { cookie: cookieA });
  const names = r.json.foods.map((f) => f.name);
  assert.ok(names.includes("Gruyère, aged"));
  assert.ok(!names.includes("Chicken breast"), "an unreferenced library food is the app's data, not the user's");
});

test("an unknown format is a 400 that names the legal values", async () => {
  const r = await call("GET", "/api/export?format=xlsx", { cookie: cookieA });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /format=json or format=csv/);
});

// ── the CSV/ZIP bundle ──────────────────────────────────────────────────────

test("format=csv returns a real ZIP with one file per entity", async () => {
  const r = await call("GET", "/api/export?format=csv", { cookie: cookieA, raw: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/zip");
  assert.match(r.headers.get("content-disposition"), /\.zip"$/);
  assert.deepEqual([...r.buffer.subarray(0, 2)], [0x50, 0x4b], "PK magic — this must be openable by the OS zip handler");

  const files = unzip(r.buffer);
  for (const name of [
    "README.txt", "user.csv", "profile.csv", "weighins.csv", "meal_logs.csv", "plans.csv",
    "plan_slots.csv", "plan_slot_ingredients.csv", "grocery_lists.csv", "grocery_list_items.csv",
    "training_plan.csv", "training_weeks.csv", "training_sessions.csv", "training_exercises.csv",
    "cart_items.csv", "recipe_ratings.csv", "user_library_entries.csv", "recipes.csv",
    "recipe_ingredients.csv", "foods.csv",
  ]) {
    assert.ok(files.has(name), `${name} missing from the export bundle`);
  }
});

test("PROOF: the four hazardous names survive the CSV round trip byte-for-byte", async () => {
  const r = await call("GET", "/api/export?format=csv", { cookie: cookieA, raw: true });
  const files = unzip(r.buffer);
  const raw = files.get("foods.csv").toString("utf8");

  // The BOM is a real byte in the file, and it is stripped before parsing.
  assert.equal(raw.charCodeAt(0), 0xfeff);
  const rows = parseCsv(raw.slice(1));
  const header = rows[0];
  const nameCol = header.indexOf("name");
  const names = rows.slice(1).map((row) => row[nameCol]);

  // 1. comma — must arrive whole, not split across three columns
  assert.ok(names.includes("Almond milk, unsweetened, plain, refrigerated"), "comma-bearing name did not survive");
  // 2. non-ASCII — the accent must be intact after a UTF-8 decode
  assert.ok(names.includes("Gruyère, aged"), "accented name did not survive");
  // 3. embedded double quote
  assert.ok(names.includes('Beef, tri-tip, trimmed to 0" fat, choice, raw'), "quote-bearing name did not survive");
  // 4. formula injection — the apostrophe is ADDED, and it is the only change
  const guarded = names.find((n) => n.includes("cmd|"));
  assert.equal(guarded, "'=cmd|' /C calc'!A0", "the formula guard must prefix exactly one apostrophe");
  assert.equal(guarded.slice(1), "=cmd|' /C calc'!A0", "and must not otherwise alter the value");

  // Every data row has exactly as many columns as the header. This is the
  // assertion that actually catches a broken escape: a mis-quoted comma or
  // quote shifts a row's width, and every downstream column silently misaligns.
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0] === "") continue;
    assert.equal(row.length, header.length, `row width drift on: ${row[nameCol]}`);
  }
});

test("PROOF: raw bytes show correct quoting, not just a lucky parse", async () => {
  const r = await call("GET", "/api/export?format=csv", { cookie: cookieA, raw: true });
  const raw = unzip(r.buffer).get("foods.csv").toString("utf8");
  assert.ok(raw.includes('"Almond milk, unsweetened, plain, refrigerated"'), "comma value must be wrapped in quotes");
  assert.ok(raw.includes('"Beef, tri-tip, trimmed to 0"" fat, choice, raw"'), "internal quote must be DOUBLED inside a quoted field");
  assert.ok(raw.includes("'=cmd|"), "the leading apostrophe must be present in the bytes");
  assert.ok(!raw.includes(",=cmd|"), "an unguarded formula cell must not exist");
});

test("a recipe named with a leading = and an embedded quote is guarded too", async () => {
  const r = await call("GET", "/api/export?format=csv", { cookie: cookieA, raw: true });
  const raw = unzip(r.buffer).get("recipes.csv").toString("utf8");
  // Name is: A's =risky, "quoted" dish  — no leading =, but a comma and quotes.
  assert.ok(raw.includes('"A\'s =risky, ""quoted"" dish"'));
});

test("negative numbers stay numeric in the CSV (rating -1)", async () => {
  const r = await call("GET", "/api/export?format=csv", { cookie: cookieA, raw: true });
  const raw = unzip(r.buffer).get("recipe_ratings.csv").toString("utf8");
  assert.ok(raw.includes(",-1,"), "rating must appear as -1, not '-1");
  assert.ok(!raw.includes("'-1"), "a numeric column must not be turned into text");
});

test("JSON columns are flattened into usable child files as well as kept whole", async () => {
  const r = await call("GET", "/api/export?format=csv", { cookie: cookieA, raw: true });
  const files = unzip(r.buffer);
  const slotIngredients = parseCsv(files.get("plan_slot_ingredients.csv").toString("utf8").slice(1));
  assert.equal(slotIngredients.length, 2, "header + one flattened ingredient");
  assert.ok(slotIngredients[1].includes('Beef, tri-tip, trimmed to 0" fat, choice, raw'));

  const grocery = parseCsv(files.get("grocery_list_items.csv").toString("utf8").slice(1));
  assert.equal(grocery.length, 2);

  // …and the lossless JSON is still in the parent row.
  const slots = files.get("plan_slots.csv").toString("utf8");
  assert.ok(slots.includes("foodId"), "the raw ingredients JSON must still be present");
});

test("the ZIP the writer produces is readable by an independent inflater", async () => {
  const bundle = exportModule.zipSync([
    { name: "a.txt", data: Buffer.from("hello ".repeat(200), "utf8") },
    { name: "b.txt", data: Buffer.from("x", "utf8") },
  ]);
  const files = unzip(bundle);
  assert.equal(files.get("a.txt").toString("utf8"), "hello ".repeat(200));
  assert.equal(files.get("b.txt").toString("utf8"), "x");
  // The trailing end-of-central-directory record must be present or Windows
  // Explorer refuses the file even though the members are intact.
  assert.equal(bundle.readUInt32LE(bundle.length - 22), 0x06054b50);
});

// ── import ──────────────────────────────────────────────────────────────────

test("import rejects a file that is not a Cut Protocol export", async () => {
  const r = await call("POST", "/api/import", { cookie: cookieA, body: { hello: "world" } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not a Cut Protocol export/);
});

test("import rejects a format version it does not understand", async () => {
  const r = await call("POST", "/api/import", { cookie: cookieA, body: { cutProtocolExport: { formatVersion: 99 } } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /version 99/);
});

test("a dry run reports what it would do and writes nothing", async () => {
  const exported = (await call("GET", "/api/export", { cookie: cookieA })).json;
  const before = {
    weighins: await prisma.weighin.count({ where: { userId: userB } }),
    plans: await prisma.plan.count({ where: { userId: userB } }),
    recipes: await prisma.recipe.count(),
  };
  const r = await call("POST", "/api/import?dryRun=1", { cookie: cookieB, body: exported });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.dryRun, true);
  assert.ok(r.json.imported.weighins >= 2);
  assert.equal(await prisma.weighin.count({ where: { userId: userB } }), before.weighins, "a dry run must not write");
  assert.equal(await prisma.plan.count({ where: { userId: userB } }), before.plans);
  assert.equal(await prisma.recipe.count(), before.recipes);
});

test("A's export restored into B's account lands on B — ids are remapped, never trusted", async () => {
  const exported = (await call("GET", "/api/export", { cookie: cookieA })).json;
  const r = await call("POST", "/api/import", { cookie: cookieB, body: exported });
  assert.equal(r.status, 200, r.text);

  // B now has A's history, filed under B.
  const bWeighins = await prisma.weighin.findMany({ where: { userId: userB }, orderBy: { date: "asc" } });
  assert.deepEqual(bWeighins.map((w) => w.date), ["2026-01-02", "2026-01-09", "2026-02-02"]);
  const bProfile = await prisma.profile.findUnique({ where: { userId: userB } });
  assert.equal(bProfile.targetKcal, 2400);
  const bPlans = await prisma.plan.findMany({ where: { userId: userB }, include: { slots: true, groceryList: true } });
  assert.equal(bPlans.length, 1);
  assert.equal(bPlans[0].slots.length, 1);
  assert.ok(bPlans[0].groceryList);
  const bTraining = await prisma.trainingPlan.findUnique({ where: { userId: userB }, include: { weeks: { include: { sessions: { include: { exercises: true } } } } } });
  assert.equal(bTraining.weeks[0].sessions[0].exercises[0].name, "Squat");

  // A's rows are untouched — an import is not a move.
  assert.equal(await prisma.weighin.count({ where: { userId: userA } }), 2);
  assert.equal((await prisma.profile.findUnique({ where: { userId: userA } })).targetKcal, 2400);
});

test("importing the same file twice does not duplicate the day log or the weigh-ins", async () => {
  const exported = (await call("GET", "/api/export", { cookie: cookieA })).json;
  const first = await prisma.mealLog.count({ where: { userId: userB } });
  const r = await call("POST", "/api/import", { cookie: cookieB, body: exported });
  assert.equal(r.status, 200, r.text);
  assert.equal(await prisma.mealLog.count({ where: { userId: userB } }), first, "MealLog has no unique key — the import must dedupe it itself");
  assert.equal(await prisma.weighin.count({ where: { userId: userB } }), 3);
  assert.equal(await prisma.plan.count({ where: { userId: userB } }), 1, "a re-imported week replaces, never stacks");
});

test("an import can NEVER grant a role — the user row in the file is ignored", async () => {
  const exported = (await call("GET", "/api/export", { cookie: cookieA })).json;
  exported.user = { id: userB, email: "b@example.test", role: "admin", createdAt: new Date().toISOString() };
  const r = await call("POST", "/api/import", { cookie: cookieB, body: exported });
  assert.equal(r.status, 200, r.text);
  const b = await prisma.user.findUnique({ where: { id: userB } });
  assert.equal(b.role, "user", "privilege escalation via restore must be impossible");
  assert.equal(b.email, "b@example.test");
});

test("an import never writes into the shared food library", async () => {
  const exported = (await call("GET", "/api/export", { cookie: cookieA })).json;
  const before = await prisma.food.count();
  exported.foods.push({
    id: "totally-made-up-id", name: "INJECTED LIBRARY FOOD", category: "pantry",
    kcal: 999, protein: 0, fat: 0, carb: 0, fiber: 0, source: "usda-verified", fdcId: 987654321,
  });
  const r = await call("POST", "/api/import", { cookie: cookieB, body: exported });
  assert.equal(r.status, 200, r.text);
  assert.equal(await prisma.food.count(), before, "a user-supplied file must not be able to add rows to the shared library");
  assert.equal(await prisma.food.count({ where: { name: "INJECTED LIBRARY FOOD" } }), 0);
});

test("a recipe whose ingredients cannot be resolved is skipped WHOLE and named, never half-imported", async () => {
  const exported = (await call("GET", "/api/export", { cookie: cookieA })).json;
  // Break every food link so the owned recipe cannot be reconstructed.
  exported.foods = exported.foods.map((f) => ({ ...f, id: `${f.id}-gone`, fdcId: null, upc: null, name: `${f.name} (nowhere)` }));
  for (const rec of exported.recipes) rec.ingredients = rec.ingredients.map((i) => ({ ...i, foodId: `${i.foodId}-gone` }));
  for (const rec of exported.recipes) rec.name = "Recipe with no resolvable ingredients";
  exported.recipes.forEach((rec) => { rec.id = "unseen-recipe-id"; });

  const r = await call("POST", "/api/import?dryRun=1", { cookie: cookieB, body: exported });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.imported.recipes, 0);
  assert.equal(r.json.skipped.recipes.length, 1);
  assert.match(r.json.skipped.recipes[0].reason, /ingredient food\(s\) not found/);
  assert.ok(r.json.warnings.some((w) => /not in this install's library/.test(w)));
});

test("an export round-trips through import with no data loss for the caller's own history", async () => {
  // The end-to-end claim of the whole feature: what comes out can go back in.
  const exported = (await call("GET", "/api/export", { cookie: cookieA })).json;
  const reimported = await call("POST", "/api/import", { cookie: cookieA, body: exported });
  assert.equal(reimported.status, 200, reimported.text);
  const after = (await call("GET", "/api/export", { cookie: cookieA })).json;
  assert.equal(after.weighins.length, exported.weighins.length);
  assert.equal(after.mealLogs.length, exported.mealLogs.length, "re-importing your own file must not duplicate your day log");
  assert.equal(after.plans.length, exported.plans.length);
  assert.equal(after.plans[0].slots.length, exported.plans[0].slots.length);
  assert.equal(after.recipes.length, exported.recipes.length, "your own recipe already exists — it is matched, not cloned");
  assert.equal(after.trainingPlan.weeks.length, exported.trainingPlan.weeks.length);
});
