// Local, email-free password reset (added 2026-07-24). A desktop app has no mail
// server, so "prove you may reset this account" is LOCAL FILE ACCESS: the backend
// writes a one-time code to a file next to the database and never returns it over
// HTTP. These tests exercise the whole flow against a fresh install with one
// account, reading the code back out of the file the way a real user would.
//
// The recovery file is redirected into the test's temp dir by pointing
// CUT_PROTOCOL_DB_PATH at the throwaway DB (lib/passwordReset.js writes next to
// whatever that path names), so nothing lands in backend/prisma.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");
const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "a-brand-new-passphrase";

let tmpDir, dbFile, app, srv, base, prisma, authRouter, reset;

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

async function call(method, p, { body, cookie } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON kept in text */ }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

const sessionCookieFrom = (setCookie) => (setCookie || "").split(";")[0];

/** Read the one-time code out of the file the backend wrote, the way a user would. */
function codeFromFile() {
  const body = fs.readFileSync(reset.recoveryFilePath(), "utf8");
  const m = body.match(/Code:\s*([A-Z0-9-]+)/);
  assert.ok(m, "recovery file has no Code line");
  return m[1];
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-reset-"));
  dbFile = path.join(tmpDir, "fresh-install.db");
  buildFreshInstallDb(dbFile);

  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  // Redirect the recovery file into tmpDir. Deliberately NOT via
  // CUT_PROTOCOL_DB_PATH — that env var flips server.js into packaged-desktop
  // mode and runs the migration bootstrap, which fails against this raw-SQL DB.
  process.env.CUT_PROTOCOL_RECOVERY_DIR = tmpDir;
  process.env.JWT_SECRET = "auth-reset-test-only-secret"; // scan:allow — fixture, keeps the developer's real JWT_SECRET out of this process
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  authRouter = require(path.join(BACKEND, "src", "routes", "auth.js"));
  reset = require(path.join(BACKEND, "src", "lib", "passwordReset.js"));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  // One account on the machine — the genuine first-run register path.
  const r = await call("POST", "/api/auth/register", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  assert.equal(r.status, 201, "setup: owner registration should succeed");
});

test.beforeEach(() => {
  authRouter.__resetThrottle.reset();
  authRouter.__loginThrottle.reset();
  reset.__reset();
});

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── the happy path ───────────────────────────────────────────────────────────

test("begin writes a code file and never returns the code in the response", async () => {
  const r = await call("POST", "/api/auth/reset/begin", { body: { email: OWNER_EMAIL } });
  assert.equal(r.status, 200);
  assert.ok(r.json.filePath, "response names the recovery file");
  assert.ok(fs.existsSync(reset.recoveryFilePath()), "the code file exists on disk");
  const code = codeFromFile();
  // The secret must live only on disk — not anywhere in the HTTP body.
  assert.ok(!r.text.includes(code), "the one-time code must not appear in the response body");
});

test("complete with the file's code sets a new password and signs the user in", async () => {
  await call("POST", "/api/auth/reset/begin", { body: { email: OWNER_EMAIL } });
  const code = codeFromFile();

  const r = await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code, newPassword: NEW_PASSWORD } });
  assert.equal(r.status, 200);
  assert.equal(r.json.email, OWNER_EMAIL);
  assert.ok(sessionCookieFrom(r.setCookie).startsWith("cutprotocol_session="), "reset issues a working session");

  // New password logs in; old one no longer does.
  const good = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: NEW_PASSWORD } });
  assert.equal(good.status, 200, "the new password works");
  const old = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  assert.equal(old.status, 401, "the old password is dead");

  // Put it back so later tests keep using OWNER_PASSWORD.
  await call("POST", "/api/auth/reset/begin", { body: { email: OWNER_EMAIL } });
  await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code: codeFromFile(), newPassword: OWNER_PASSWORD } });
});

test("a consumed code cannot be replayed, and its file is deleted", async () => {
  await call("POST", "/api/auth/reset/begin", { body: { email: OWNER_EMAIL } });
  const code = codeFromFile();
  const first = await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code, newPassword: OWNER_PASSWORD } });
  assert.equal(first.status, 200);
  assert.ok(!fs.existsSync(reset.recoveryFilePath()), "the code file is removed once used");

  const replay = await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code, newPassword: "yet-another-pass" } });
  assert.equal(replay.status, 400, "the same code cannot be used twice");
});

// ── the guards ───────────────────────────────────────────────────────────────

test("a wrong code is rejected and does not change the password", async () => {
  await call("POST", "/api/auth/reset/begin", { body: { email: OWNER_EMAIL } });
  const r = await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code: "ZZZZ-ZZZZ", newPassword: NEW_PASSWORD } });
  assert.equal(r.status, 400);
  const stillOld = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  assert.equal(stillOld.status, 200, "the original password still works after a failed reset");
});

test("a too-short new password is rejected without burning the code", async () => {
  await call("POST", "/api/auth/reset/begin", { body: { email: OWNER_EMAIL } });
  const code = codeFromFile();
  const short = await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code, newPassword: "abc123" } });
  assert.equal(short.status, 400);
  assert.match(short.json.fields.newPassword, /at least 8/i);
  // The code survived the length rejection — it still works with a good password.
  const ok = await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code, newPassword: OWNER_PASSWORD } });
  assert.equal(ok.status, 200, "the code was not consumed by the length failure");
});

test("begin for an unknown email answers the same but issues no usable code", async () => {
  const r = await call("POST", "/api/auth/reset/begin", { body: { email: "nobody@example.test" } });
  assert.equal(r.status, 200, "same 200 shape — no account-existence oracle");
  assert.ok(r.json.filePath, "the (non-secret) file path is still returned");
  assert.ok(!fs.existsSync(reset.recoveryFilePath()), "no code file is written for a non-account");
  const complete = await call("POST", "/api/auth/reset/complete", { body: { email: "nobody@example.test", code: "AAAA-BBBB", newPassword: NEW_PASSWORD } });
  assert.equal(complete.status, 400, "there is nothing to complete");
});

test("begin and complete reject a non-string email as 400, never 500", async () => {
  for (const email of [{ $ne: null }, 42, null]) {
    const b = await call("POST", "/api/auth/reset/begin", { body: { email } });
    assert.equal(b.status, 400, `begin rejects ${JSON.stringify(email)}`);
    const c = await call("POST", "/api/auth/reset/complete", { body: { email, code: "x", newPassword: NEW_PASSWORD } });
    assert.equal(c.status, 400, `complete rejects ${JSON.stringify(email)}`);
  }
});

test("repeated wrong codes trip the reset throttle", async () => {
  await call("POST", "/api/auth/reset/begin", { body: { email: OWNER_EMAIL } }); // 1 record
  // begin already recorded once; drive failed completes until the budget (10) trips.
  let sawThrottle = false;
  for (let i = 0; i < 12; i++) {
    const r = await call("POST", "/api/auth/reset/complete", { body: { email: OWNER_EMAIL, code: "ZZZZ-ZZZZ", newPassword: NEW_PASSWORD } });
    if (r.status === 429) { sawThrottle = true; break; }
    assert.equal(r.status, 400);
  }
  assert.ok(sawThrottle, "a run of bad codes eventually returns 429");
});
