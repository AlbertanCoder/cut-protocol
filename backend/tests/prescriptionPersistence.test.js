// prescriptionPersistence.test.js — Option C's routes, end to end.
//
// Harness: a TEMP COPY of rebuild-qa.db (never the QA db itself, never
// dev.db) so commit/current/swap run against a real solvable pool and a
// real fleet account. Skips loudly when the QA db hasn't been built.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const QA_DB = path.join(BACKEND, "prisma", "rebuild-qa.db");
const EMAIL = "cust-0252@qa.local"; // provisioned, unused by both fleets
const PASSWORD = "Fleet!2026";

let tmpDir, app, srv, base, prisma, cookie;
const haveQa = fs.existsSync(QA_DB);

async function call(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

test.before(async (t) => {
  if (!haveQa) return;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-optc-"));
  const dbFile = path.join(tmpDir, "optc.db");
  fs.copyFileSync(QA_DB, dbFile);
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "optc-persistence-test-only"; // scan:allow — fixture
  process.env.QC_NO_LISTEN = "1";
  process.env.SUPABASE_URL = "";
  process.env.BRAIN = "off";
  process.env.CUT_SAFETY_EVENTS_PATH = path.join(tmpDir, "safety.jsonl");
  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(login.status, 200, "fleet account login");
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const p = await call("PUT", "/api/profile", {
    unitPref: "metric", sex: "M", age: 32, heightCm: 180, startWeightKg: 90, goalWeightKg: 84,
    occupationKey: "desk-office", sessionsPerWeek: 3, trainingStyle: "mixed", minutesPerSession: 45,
    rateLbPerWeek: 0.5, dietaryStyle: "none", excludedFoods: [], mealsPerDay: 3, snacksPerDay: 1,
  });
  assert.equal(p.status, 200, JSON.stringify(p.json));
});

test.after(async () => {
  try { srv?.close(); } catch { /* closed */ }
  try { await prisma?.$disconnect(); } catch { /* nothing */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("commit re-solves the SAME days the preview showed, and stores them", { skip: !haveQa && "rebuild-qa.db not built" }, async () => {
  const seed = 4242;
  const prev = await call("POST", "/api/prescription/preview", { days: 2, seed });
  assert.equal(prev.status, 200, JSON.stringify(prev.json).slice(0, 300));

  const com = await call("POST", "/api/prescription/commit", { days: 2, seed, startDate: "2026-08-21" });
  assert.equal(com.status, 200, JSON.stringify(com.json).slice(0, 300));
  assert.deepEqual(com.json.committed, ["2026-08-21", "2026-08-22"]);
  // Determinism is the contract that makes "Save this day" honest:
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(com.json.days[i].totals, prev.json.days[i].totals, `day ${i + 1} totals must match the preview`);
    assert.equal(com.json.days[i].scanLine, prev.json.days[i].scanLine);
  }
  const rows = await prisma.prescriptionDay.findMany({ where: { date: { gte: "2026-08-21" } }, include: { dishes: true } });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.dishes.length > 0), "stored days carry dishes");
  assert.ok(rows.every((r) => r.scanLine.includes("PASS")), "the §3.3.4 line travels with the stored food");
});

test("commit is an upsert — recommitting a date replaces, never duplicates", { skip: !haveQa && "rebuild-qa.db not built" }, async () => {
  const again = await call("POST", "/api/prescription/commit", { days: 1, seed: 777, startDate: "2026-08-21" });
  assert.equal(again.status, 200);
  const rows = await prisma.prescriptionDay.findMany({ where: { date: "2026-08-21" } });
  assert.equal(rows.length, 1, "one committed day per user-date");
  assert.equal(rows[0].seed, 777, "the recommit replaced the stored day");
});

test("current returns today-and-forward in the preview's day shape, banner included when off-band", { skip: !haveQa && "rebuild-qa.db not built" }, async () => {
  const cur = await call("GET", "/api/prescription/current?from=2026-08-21");
  assert.equal(cur.status, 200);
  assert.equal(cur.json.days.length, 2);
  const day = cur.json.days[0];
  assert.equal(day.date, "2026-08-21");
  assert.ok(Array.isArray(day.slots) && day.slots.length > 0);
  assert.ok(day.slots[0].dishes[0].ingredients.length > 0, "frozen ingredients travel back");
  assert.ok(day.targets && day.verdict && day.scanLine, "the day carries what certified it");
  if (day.verdict.inBand === false) assert.ok(day.banner, "an off-band stored day still says so");
});

test("swap replaces ONE stored dish, re-verifies the day, and never re-uses a dish already on it", { skip: !haveQa && "rebuild-qa.db not built" }, async () => {
  const before = await call("GET", "/api/prescription/current?from=2026-08-22");
  const day = before.json.days.find((d) => d.date === "2026-08-22");
  assert.ok(day, "the committed 2026-08-22 day exists");
  const slot = day.slots.find((s) => s.dishes.length > 0);
  const oldName = slot.dishes[0].recipeName;
  const namesOnDay = new Set(day.slots.flatMap((s) => s.dishes.map((x) => x.recipeName)));

  const sw = await call("POST", "/api/prescription/swap", { date: "2026-08-22", slotType: slot.slotType, slotIndex: slot.slotIndex, dishIndex: 0 });
  assert.equal(sw.status, 200, JSON.stringify(sw.json).slice(0, 300));
  assert.notEqual(sw.json.swapped.to, oldName, "the dish actually changed");
  assert.ok(!namesOnDay.has(sw.json.swapped.to), "the replacement was not already on the day");
  const after = sw.json.day;
  assert.ok(after.verdict && after.scanLine, "the day was re-verified and re-certified");
  const newSlot = after.slots.find((s) => s.slotType === slot.slotType && s.slotIndex === slot.slotIndex);
  assert.equal(newSlot.dishes[0].recipeName, sw.json.swapped.to);
});

test("swap on a day that was never committed is a clean 404", { skip: !haveQa && "rebuild-qa.db not built" }, async () => {
  const sw = await call("POST", "/api/prescription/swap", { date: "2031-01-01", slotType: "meal", slotIndex: 0, dishIndex: 0 });
  assert.equal(sw.status, 404);
});

test("grocery consolidates the committed days through the existing engine", { skip: !haveQa && "rebuild-qa.db not built" }, async () => {
  const g = await call("GET", "/api/prescription/grocery?from=2026-08-21&days=2");
  assert.equal(g.status, 200, JSON.stringify(g.json).slice(0, 300));
  assert.equal(g.json.daysFound, 2);
  assert.ok(g.json.items.length > 0, "committed dishes yield grocery items");
  const item = g.json.items[0];
  assert.ok(item.section && item.purchase && Number.isFinite(item.preparedGrams), "existing groceryList shape: section/purchase/preparedGrams");
  assert.ok(g.json.bySection && Array.isArray(g.json.bySection.protein), "bySection survives");
  // An ingredient plated on both days aggregates into ONE line with summed grams.
  const dup = g.json.items.find((i) => i.occurrences > 1);
  if (dup) assert.ok(dup.preparedGrams > 0);
  // A window with nothing committed is an honest empty, not an error.
  const empty = await call("GET", "/api/prescription/grocery?from=2031-01-01&days=7");
  assert.equal(empty.status, 200);
  assert.equal(empty.json.daysFound, 0);
  assert.deepEqual(empty.json.items, []);
});
