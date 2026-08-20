// p7Rails.test.js — the override attempter (§7 P7, §12 test_floors_hold).
//
// P7 repeatedly sets 900 kcal and a 2%-of-bodyweight/week rate. The gates:
// 100/100 below-floor attempts refused; the absolute rate cap refuses with
// no acknowledgement path; the §8.3 check-in fires ONCE per pattern (never a
// nag loop); and the derived target is never below the floor.
//
// Real app, real routes, fresh temp DB built from migrations — the same
// boot pattern as auth.registration.test.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.join(__dirname, "..", "..");

let tmpDir, dbFile, eventsFile, app, srv, base, prisma, cookie, safetyEvents;

function buildFreshInstallDb(file) {
  const migrationsDir = path.join(BACKEND, "prisma", "migrations");
  const names = fs.readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  const db = new DatabaseSync(file);
  try {
    for (const name of names) db.exec(fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  } finally {
    db.close();
  }
}

async function call(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-p7-"));
  dbFile = path.join(tmpDir, "p7.db");
  eventsFile = path.join(tmpDir, "safety-events.jsonl");
  buildFreshInstallDb(dbFile);
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "p7-rails-test-only-secret"; // scan:allow — fixture, never a real secret
  process.env.QC_NO_LISTEN = "1";
  process.env.SUPABASE_URL = "";
  process.env.BRAIN = "off";

  safetyEvents = require(path.join(BACKEND, "src", "lib", "safetyEvents.js"));
  safetyEvents._setStorePath(eventsFile);

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const r = await call("POST", "/api/auth/register", { email: "p7@example.test", password: "OverrideMe!99" });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
  cookie = (r.setCookie || "").split(";")[0];

  // A light adult body, so the menu's 2.0 lb/wk is genuinely past 1.5% BW/wk:
  // 2.0 lb/wk on 55 kg = 1.65%.
  const p = await call("PUT", "/api/profile", {
    sex: "F", age: 28, heightCm: 165, startWeightKg: 55, goalWeightKg: 52, rateLbPerWeek: 0.5,
  });
  assert.equal(p.status, 200, JSON.stringify(p.json));
});

test.after(async () => {
  try { srv?.close(); } catch { /* closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("GATE: 100/100 below-floor attempts are refused — not warn-and-proceed (test_floors_hold)", async () => {
  for (let i = 1; i <= 100; i++) {
    const r = await call("PUT", "/api/profile", { floorKcal: 900 });
    assert.equal(r.status, 400, `attempt ${i}: a 900 kcal floor ask must be a 400, got ${r.status}`);
    assert.match(r.json.fields.floorKcal, /1200 kcal is the lowest/);
  }
  const still = await call("GET", "/api/profile");
  assert.notEqual(still.json?.floorKcal, 900, "no attempt may have persisted");
});

test("GATE: the 2%-of-bodyweight rate is refused ABSOLUTELY — no acknowledgement path exists", async () => {
  for (let i = 1; i <= 20; i++) {
    // Even with the tick pre-checked, past 1.5% there is nothing to confirm.
    const r = await call("PUT", "/api/profile", { rateLbPerWeek: 2.0, rateAcknowledged: true });
    assert.equal(r.status, 400, `attempt ${i}: got ${r.status} ${JSON.stringify(r.json)}`);
    assert.equal(r.json.gate, "rate-absolute-cap");
    assert.match(r.json.error, /absolute cap/);
  }
});

test("GATE: the check-in fired ONCE per pattern during the storm above — not a nag loop (§8.3)", () => {
  const events = JSON.parse("[" + fs.readFileSync(eventsFile, "utf8").trim().split("\n").join(",") + "]");
  const shown = events.filter((e) => e.type === "check-in-shown");
  const floorAttempts = events.filter((e) => e.type === "floor-breach-attempt");
  const capPushes = events.filter((e) => e.type === "rate-cap-push");
  assert.ok(floorAttempts.length >= 100, `all floor attempts logged (${floorAttempts.length})`);
  assert.ok(capPushes.length >= 20, `all cap pushes logged (${capPushes.length})`);
  // 120 refusals, at most one check-in per PATTERN (floor + rate = 2), not 60.
  assert.ok(shown.length >= 1, "the check-in must fire when the pattern trips");
  assert.ok(shown.length <= 2, `once per pattern means ≤2 here, got ${shown.length}`);
});

test("the check-in payload rode along on the refusal that tripped it, plainly worded", async () => {
  // Fresh pattern in a fresh window is not needed — verify shape from the
  // ledger-adjacent behaviour instead: a brand-new user tripping the floor
  // twice sees checkIn exactly on the second refusal.
  const r2 = await call("POST", "/api/auth/register", { email: "p7b@example.test", password: "OverrideMe!99" });
  const c2 = (r2.setCookie || "").split(";")[0];
  const call2 = (body) => fetch(base + "/api/profile", {
    method: "PUT", headers: { "content-type": "application/json", cookie: c2 }, body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));
  await call2({ sex: "M", age: 30, heightCm: 180, startWeightKg: 80, goalWeightKg: 75, rateLbPerWeek: 0.5 });
  const first = await call2({ floorKcal: 900 });
  assert.equal(first.status, 400);
  assert.equal(first.json.checkIn, undefined, "one attempt is not a pattern");
  const second = await call2({ floorKcal: 900 });
  assert.equal(second.status, 400);
  assert.ok(second.json.checkIn?.due, "two attempts are the pattern — the check-in rides the refusal");
  assert.match(second.json.checkIn.note, /no judgment/i);
  const third = await call2({ floorKcal: 900 });
  assert.equal(third.json.checkIn, undefined, "and it does not repeat on the third");
});

test("a stored rate past the cap cannot be laundered through a floor-only PUT — no acknowledgement path exists (review finding)", async () => {
  // Store a legal-at-the-time rate on a heavier body, drift the weight down
  // (startWeightKg is unguarded — the drift path the cap comment records),
  // then try to slip a floor-only PUT through with the tick pre-checked.
  const r = await call("POST", "/api/auth/register", { email: "p7c@example.test", password: "OverrideMe!99" });
  const c3 = (r.setCookie || "").split(";")[0];
  const call3 = (body) => fetch(base + "/api/profile", {
    method: "PUT", headers: { "content-type": "application/json", cookie: c3 }, body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));
  await call3({ sex: "M", age: 30, heightCm: 180, startWeightKg: 80, goalWeightKg: 70, rateLbPerWeek: 0.5 });
  const stored = await call3({ rateLbPerWeek: 2.0, rateAcknowledged: true }); // 1.13% on 80 kg — legal with ack
  assert.equal(stored.status, 200, JSON.stringify(stored.json));
  await call3({ startWeightKg: 55 }); // stored 2.0 lb/wk is now 1.65% of bodyweight
  const laundered = await call3({ floorKcal: 1600, rateAcknowledged: true });
  assert.equal(laundered.status, 400, `expected the absolute cap, got ${laundered.status}: ${JSON.stringify(laundered.json)}`);
  assert.equal(laundered.json.gate, "rate-absolute-cap");
});

test("the floor holds in the DERIVED target — a floored ask lands AT the floor, never below", async () => {
  // 1.5 lb/wk on 55 kg is 1.24% BW/wk — inside the absolute cap, but the
  // ~750 kcal/day deficit it asks for drives the raw target under the floor.
  // With the acknowledgement it SAVES — and the derived target clamps AT the
  // floor and says so, instead of prescribing below it.
  const ack = await call("PUT", "/api/profile", { rateLbPerWeek: 1.5, rateAcknowledged: true });
  assert.equal(ack.status, 200, JSON.stringify(ack.json));
  const s = await call("GET", "/api/weighins/summary");
  assert.equal(s.status, 200);
  const t = s.json.target;
  assert.ok(t.floored === true, `a 1.5 lb/wk ask on 55 kg must be floor-clamped: ${JSON.stringify(t)}`);
  assert.ok(t.target >= t.floor, `target ${t.target} sits below floor ${t.floor}`);
});
