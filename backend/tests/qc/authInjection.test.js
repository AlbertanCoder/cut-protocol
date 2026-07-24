// Regression for the QC gauntlet v2 login-injection finding (2026-07-23).
// A non-string email (a Prisma operator object) hit .trim() and 500'd. It must
// now 400, and must never reach the prisma where-clause as an object.
//
// Uses supertest-free real HTTP against the app on an ephemeral port, isolated
// on a throwaway DB copy — same harness the fuzz scripts use.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.resolve(__dirname, "..", "..");
const liveDb = path.join(BACKEND, "prisma", "dev.db");
const testDb = path.join(BACKEND, "prisma", "dev.db.qcauth");

// Source DB to clone. Locally that's dev.db. On CI dev.db is gitignored and
// never exists — the migrated+seeded database lives wherever DATABASE_URL points
// (the workflow sets file:./ci.db, which prisma resolves next to schema.prisma).
// Without this, the whole file threw ENOENT on CI and its tests never ran — one
// of the suites the broken `**` glob had been hiding from CI entirely.
function resolveSourceDb() {
  if (fs.existsSync(liveDb)) return liveDb;
  const m = /^file:(.*)$/.exec(process.env.DATABASE_URL || "");
  if (m) {
    const raw = m[1].replace(/^\.\//, "");
    const p = path.isAbsolute(raw) ? raw : path.join(BACKEND, "prisma", raw);
    if (fs.existsSync(p)) return p;
  }
  throw new Error("authInjection: no source DB — neither dev.db nor the DATABASE_URL file exists");
}

let app, srv, base, prisma;
test.before(async () => {
  for (const s of ["", "-journal", "-wal", "-shm"]) { try { fs.rmSync(testDb + s, { force: true }); } catch {} }
  fs.copyFileSync(resolveSourceDb(), testDb);
  process.env.DATABASE_URL = `file:${testDb.replace(/\\/g, "/")}`;
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";
  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  srv = app.listen(0); await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  try { srv?.close(); } catch {}
  try { await prisma?.$disconnect(); } catch {}
  for (const s of ["", "-journal", "-wal", "-shm"]) { try { fs.rmSync(testDb + s, { force: true }); } catch {} }
});

async function login(body) {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status };
}

test("login with a Prisma-operator object email returns 400, not 500", async () => {
  for (const body of [{ email: { $ne: null }, password: "x" }, { email: { $gt: "" }, password: { $ne: null } }, { email: 42, password: "x" }, { email: ["a"], password: "x" }]) {
    const r = await login(body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} should 400, got ${r.status}`);
  }
});

test("login with normal-but-wrong credentials still returns 401", async () => {
  const r = await login({ email: "nobody@example.com", password: "wrong" });
  assert.equal(r.status, 401);
});
