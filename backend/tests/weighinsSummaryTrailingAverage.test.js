// GET /api/weighins/summary — the "7-day average" must be SEVEN DAYS.
//
// WHY THIS TEST EXISTS, AND WHY IT TESTS THE ROUTE AND NOT THE PRIMITIVE.
//
// bmrEngine.trailingAverage() was correct, documented and unit-tested from the
// day it was written (tests/trendRateWindow.test.js). It had ZERO production
// callers. `grep -rn "trailingAverage" src/ | grep -v bmrEngine.js` returned
// nothing, while this route, adaptiveTarget.js and weightNow.js each carried
// their own `slice(-7)` — the last seven ROWS.
//
// So the defect was never "the average is computed wrongly". It was "the
// correct function is not the one being called", and a unit test of the correct
// function cannot see that. This test asserts the WIRING: given a weigh-in
// series where the row-window and the day-window give measurably different
// answers, the route must return the day-window one.
//
// What it cost while it was live (measured on the owner's account, 2026-08-02):
// Today's Verdict rendered 208.0 lb and Trend's Numbers card rendered 206.5 lb
// — same statistic, same label, same moment — because TrendTab computed the
// calendar window itself and this route did not. And it was not cosmetic:
// resolveEnergy() feeds this weight into computeEnergy(), so every BMR formula,
// the TDEE, the derived target and all four macro ranges were built on the
// wrong number, and two different goal dates fell out of it.
//
// Runs against a throwaway SQLite file built from the shipped migrations, same
// pattern as tests/exportRoute.test.js — never the developer's dev.db.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");

let tmpDir, dbFile, app, srv, base, prisma, dates, bmrEngine;
let cookie;

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

async function call(method, p, { body, cookie: c } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(c ? { cookie: c } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON kept in text */ }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

const cookieFrom = (setCookie) => (setCookie || "").split(";")[0];

/** Replace the whole weigh-in series with `[{ offset, kg }]`, offsets in days back from today. */
async function setSeries(userId, points) {
  await prisma.weighin.deleteMany({ where: { userId } });
  for (const { offset, kg } of points) {
    await prisma.weighin.create({
      data: { userId, date: dates.addDays(dates.todayStr(), -offset), weightKg: kg },
    });
  }
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

let userId;

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-avg7-"));
  dbFile = path.join(tmpDir, "avg7-test.db");
  buildFreshInstallDb(dbFile);

  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "avg7-route-test-only-secret"; // scan:allow — fixture; keeps the developer's real secret out of this process
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";
  process.env.CUT_PROTOCOL_AUDIT = "off";

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  dates = require(path.join(BACKEND, "src", "lib", "dates.js"));
  bmrEngine = require(path.join(BACKEND, "src", "lib", "bmrEngine.js"));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const reg = await call("POST", "/api/auth/register", {
    body: { email: "avg7@example.test", password: "correct-horse-battery" },
  });
  assert.ok(reg.status < 300, `register failed: ${reg.status} ${reg.text}`);
  cookie = cookieFrom(reg.setCookie);
  userId = (await prisma.user.findUnique({ where: { email: "avg7@example.test" } })).id;

  await prisma.profile.create({
    data: {
      userId, sex: "M", age: 35, heightCm: 180, bodyFatPct: 20,
      sessionsPerWeek: 3, startWeightKg: 100, goalWeightKg: 85,
      startDate: dates.addDays(dates.todayStr(), -60),
      excludedFormulas: [], excludedFoods: [], cuisinePreferences: [],
      targetKcal: 2400,
    },
  });
});

test.after(async () => {
  await prisma?.$disconnect?.();
  await new Promise((r) => (srv ? srv.close(r) : r()));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* tmp */ }
});

// The shape that breaks: 3×/week weighing. Seven ROWS span twenty days, so the
// row-window drags three-week-old weight into a number labelled "7-day".
const SPARSE = [
  { offset: 20, kg: 95.0 },
  { offset: 18, kg: 94.5 },
  { offset: 16, kg: 94.0 },
  { offset: 6, kg: 90.0 },
  { offset: 4, kg: 89.5 },
  { offset: 2, kg: 89.0 },
  { offset: 0, kg: 88.5 },
];
const IN_WINDOW = SPARSE.filter((p) => p.offset <= 6).map((p) => p.kg); // 4 rows
const ALL_ROWS = SPARSE.map((p) => p.kg); // 7 rows

test("avg7Kg averages seven DAYS, not seven rows", async () => {
  await setSeries(userId, SPARSE);
  const { status, json } = await call("GET", "/api/weighins/summary", { cookie });
  assert.equal(status, 200);

  const byDays = mean(IN_WINDOW); // 89.25
  const byRows = mean(ALL_ROWS);  // ~91.5 — what the old slice(-7) returned

  // Guard the fixture itself: if these ever converge the test proves nothing.
  assert.ok(Math.abs(byDays - byRows) > 1.5, "fixture must make the two methods disagree");

  assert.ok(
    Math.abs(json.avg7Kg - byDays) < 1e-9,
    `avg7Kg should be the 7-DAY mean ${byDays}, got ${json.avg7Kg}`
  );
  assert.ok(
    Math.abs(json.avg7Kg - byRows) > 1.5,
    `avg7Kg is still the 7-ROW mean (${byRows}) — the route reverted to slice(-7)`
  );
});

test("avg7Meta reports what it actually averaged", async () => {
  await setSeries(userId, SPARSE);
  const { json } = await call("GET", "/api/weighins/summary", { cookie });

  assert.ok(json.avg7Meta, "avg7Meta must ship alongside avg7Kg");
  assert.equal(json.avg7Meta.count, IN_WINDOW.length, "count is the rows inside the window, not all rows");
  assert.equal(json.avg7Meta.windowDays, 7);
  assert.equal(json.avg7Meta.stale, false);
  assert.equal(json.avg7Meta.staleDays, 0);
  assert.equal(json.avg7Meta.toDate, dates.todayStr());
  assert.equal(json.avg7Meta.fromDate, dates.addDays(dates.todayStr(), -6));
});

// The structural assertion. Anything that recomputes the average locally —
// rather than delegating to the one primitive — drifts from it eventually.
// That is the exact failure this whole test file exists for.
test("the route delegates to bmrEngine.trailingAverage rather than reimplementing it", async () => {
  await setSeries(userId, SPARSE);
  const { json } = await call("GET", "/api/weighins/summary", { cookie });

  const entries = SPARSE
    .map((p) => ({ date: dates.addDays(dates.todayStr(), -p.offset), weightLb: bmrEngine.kg2lb(p.kg) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const expected = bmrEngine.trailingAverage(entries, (e) => e.weightLb, { asOf: dates.todayStr() });

  assert.ok(Math.abs(json.avg7Kg - expected.avg / 2.20462) < 1e-9);
  assert.equal(json.avg7Meta.count, expected.count);
  assert.equal(json.avg7Meta.fromDate, expected.fromDate);
  assert.equal(json.avg7Meta.toDate, expected.toDate);
});

// An empty window must not return null. Callers that fall back on null land on
// profile.startWeightKg (ProfileTab.jsx:63) — i.e. a lapsed user's screen would
// silently jump back to their day-one weight. The primitive falls back to the
// newest reading and SAYS it is stale; the route has to pass that through.
test("a window with no weigh-ins falls back to the newest reading and says so", async () => {
  await setSeries(userId, [{ offset: 30, kg: 97.0 }, { offset: 25, kg: 96.4 }]);
  const { json } = await call("GET", "/api/weighins/summary", { cookie });

  assert.ok(Math.abs(json.avg7Kg - 96.4) < 1e-9, "should fall back to the most recent weigh-in");
  assert.equal(json.avg7Meta.stale, true);
  assert.equal(json.avg7Meta.count, 1);
  assert.equal(json.avg7Meta.staleDays, 25);
});

test("no weigh-ins at all -> avg7Kg null, avg7Meta null", async () => {
  await setSeries(userId, []);
  const { json } = await call("GET", "/api/weighins/summary", { cookie });
  assert.equal(json.avg7Kg, null);
  assert.equal(json.avg7Meta, null);
});
