// prescriptionRoute.test.js — the preview surface: real app, temp DB.
//
// The temp DB has an EMPTY recipe library on purpose: the route must fail
// honestly (ok:false with a pool diagnosis), never crash and never invent
// food. Solved-day quality is the persona harness's job (tests/personas/).

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.join(__dirname, "..");

let tmpDir, app, srv, base, prisma, cookie;

function buildFreshInstallDb(file) {
  const migrationsDir = path.join(BACKEND, "prisma", "migrations");
  const names = fs.readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  const db = new DatabaseSync(file);
  try {
    for (const name of names) db.exec(fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
  } finally { db.close(); }
}

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

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-rx-"));
  const dbFile = path.join(tmpDir, "rx.db");
  buildFreshInstallDb(dbFile);
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "prescription-route-test-only"; // scan:allow — fixture
  process.env.QC_NO_LISTEN = "1";
  process.env.SUPABASE_URL = "";
  process.env.BRAIN = "off";
  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  const r = await call("POST", "/api/auth/register", { email: "rx@example.test", password: "Preview!2026" });
  assert.ok([200, 201].includes(r.status));
  cookie = null; // set from header
  const res = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "rx@example.test", password: "Preview!2026" }),
  });
  cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const p = await call("PUT", "/api/profile", {
    sex: "M", age: 32, heightCm: 180, startWeightKg: 90, goalWeightKg: 84, rateLbPerWeek: 0.5,
  });
  assert.equal(p.status, 200, JSON.stringify(p.json));
});

test.after(async () => {
  try { srv?.close(); } catch { /* closed */ }
  try { await prisma?.$disconnect(); } catch { /* nothing */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("unauthenticated requests are 401", async () => {
  const saved = cookie; cookie = null;
  const r = await call("POST", "/api/prescription/preview", { days: 1 });
  assert.equal(r.status, 401);
  cookie = saved;
});

test("feasibility maps the engine's own numbers onto the ruler and answers", async () => {
  const r = await call("GET", "/api/prescription/feasibility");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Number.isFinite(r.json.targets.kcal));
  assert.ok(r.json.targets.proteinG.lo <= r.json.targets.proteinG.hi);
  assert.equal(typeof r.json.feasibility.feasible, "boolean");
  assert.match(r.json.note, /fiber allowance/);
});

test("an empty library previews as an HONEST failure — never a crash, never invented food", async () => {
  const r = await call("POST", "/api/prescription/preview", { days: 2, seed: 7 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.days.length, 2);
  for (const d of r.json.days) {
    assert.equal(d.ok, false);
    assert.match(d.diagnosis || "", /pool|recipes/i);
  }
});

test("keto gets no fiber subtraction — the net band is the total band under the ceiling", async () => {
  // Regression: the flat 25 g allowance against keto's 10-30 g TOTAL band
  // produced a {0,5} net band that failed honest 13 g-net keto days.
  const k = await call("PUT", "/api/profile", { dietaryStyle: "keto" });
  assert.equal(k.status, 200, JSON.stringify(k.json));
  const r = await call("GET", "/api/prescription/feasibility");
  assert.equal(r.status, 200);
  assert.equal(r.json.targets.netCarbG.lo, 0);
  assert.ok(r.json.targets.netCarbG.hi >= 20, `keto net band collapsed again: ${JSON.stringify(r.json.targets.netCarbG)}`);
  assert.equal(r.json.targets.netCarbMaxG, 30);
  const back = await call("PUT", "/api/profile", { dietaryStyle: "none" });
  assert.equal(back.status, 200);
});

test("the seed is deterministic and echoed — same seed, same preview", async () => {
  const a = await call("POST", "/api/prescription/preview", { days: 1, seed: 42 });
  const b = await call("POST", "/api/prescription/preview", { days: 1, seed: 42 });
  assert.equal(a.json.seed, 42);
  assert.deepEqual(a.json.days, b.json.days);
});

test("an off-band or unbuildable day carries a plain-language banner, and the response a summary", async () => {
  // Fleet, 2026-08-20: days marked ok:false were still read as fine — the
  // dishes rendered, the miss hid in verdict JSON. The banner is the
  // sentence a person actually reads.
  const r = await call("POST", "/api/prescription/preview", { days: 2, seed: 7 });
  assert.equal(r.status, 200);
  assert.match(r.json.summary || "", /None of these .*days lands fully in band/i);
  for (const d of r.json.days) {
    assert.equal(d.ok, false);
    assert.ok(d.banner, "a not-ok day must carry a banner");
    assert.match(d.banner, /could not be built|NOT fully on target|missed its targets/);
  }
});
