// Fleet finding onboarding-flow-1 (P0, 2026-07-23): the app shipped with
// /auth/login and /auth/logout and NO way to create an account. A fresh
// install booted straight to a sign-in screen that nobody could ever get past.
//
// These tests exercise the whole first-run path against a genuinely EMPTY
// install: a throwaway SQLite file in the OS temp dir with every shipped Prisma
// migration applied and zero rows in it. That is what a new machine looks like.
// It is built from prisma/migrations, NOT copied from prisma/dev.db, because
// dev.db is gitignored (it holds real personal data) and does not exist on CI —
// and because "zero users" is precisely the state under test.
//
// Covers, per the finding's acceptance list:
//   - register on an empty install succeeds and returns a WORKING session
//   - register when a user already exists + caller unauthenticated -> REJECTED
//   - password below the minimum -> rejected
//   - duplicate email -> rejected
//   - no password material in any response body
//   - the stored value is a bcrypt hash, not plaintext
//   - login with the newly registered credentials succeeds
//   - /auth/status flips needsSetup true -> false
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");
const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD = "correct-horse-battery";
const SECOND_EMAIL = "second-profile@example.test";

let tmpDir, dbFile, app, srv, base, prisma, authRouter;

/** A fresh-install database: current schema, zero rows. */
function buildFreshInstallDb(file) {
  const migrationsDir = path.join(BACKEND, "prisma", "migrations");
  const names = fs
    .readdirSync(migrationsDir)
    .filter((n) => fs.existsSync(path.join(migrationsDir, n, "migration.sql")))
    .sort();
  assert.ok(names.length > 0, "no migrations found — cannot build a fresh-install DB");
  const db = new DatabaseSync(file);
  try {
    for (const name of names) {
      db.exec(fs.readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
    }
    assert.equal(db.prepare("SELECT count(*) AS c FROM User").get().c, 0, "fresh-install DB must have zero users");
  } finally {
    db.close();
  }
  return names.length;
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
  try { json = JSON.parse(text); } catch { /* non-JSON body kept in text */ }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

const sessionCookieFrom = (setCookie) => (setCookie || "").split(";")[0];

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-auth-"));
  dbFile = path.join(tmpDir, "fresh-install.db");
  buildFreshInstallDb(dbFile);

  // Set before requiring server.js: prisma.js constructs the client (resolving
  // DATABASE_URL) at module load, and dotenv never overwrites an existing var —
  // so this also keeps the developer's real JWT_SECRET out of the test process.
  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.JWT_SECRET = "auth-registration-test-only-secret";
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  authRouter = require(path.join(BACKEND, "src", "routes", "auth.js"));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

// The throttle is real and shared across the whole file; clear it between tests
// so ordinary cases never trip it. The throttle itself is tested explicitly at
// the bottom, inside a single test.
test.beforeEach(() => authRouter.__registerThrottle.reset());

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── the empty install ────────────────────────────────────────────────────────

test("GET /auth/status on an empty install reports needsSetup and nothing else", async () => {
  const r = await call("GET", "/api/auth/status");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { needsSetup: true });
  // No usernames, no counts — the boolean is the entire public surface.
  assert.deepEqual(Object.keys(r.json), ["needsSetup"]);
});

test("register rejects a password below the minimum, with a field-level error", async () => {
  const r = await call("POST", "/api/auth/register", { body: { email: "short@example.test", password: "abc1234" } });
  assert.equal(r.status, 400);
  assert.match(r.json.fields.password, /at least 8/i);
  assert.equal(await prisma.user.count(), 0, "a rejected registration must not create a user");
});

test("register rejects an empty or whitespace-only email", async () => {
  for (const email of ["", "   ", undefined]) {
    const r = await call("POST", "/api/auth/register", { body: { email, password: OWNER_PASSWORD } });
    assert.equal(r.status, 400, `email ${JSON.stringify(email)} should 400`);
    assert.ok(r.json.fields.email, "expected a field-level email error");
  }
  assert.equal(await prisma.user.count(), 0);
});

test("register rejects a non-string email with 400, never 500", async () => {
  for (const email of [{ $ne: null }, 42, ["a@b.co"]]) {
    const r = await call("POST", "/api/auth/register", { body: { email, password: OWNER_PASSWORD } });
    assert.equal(r.status, 400, `${JSON.stringify(email)} -> ${r.status}`);
  }
  assert.equal(await prisma.user.count(), 0);
});

test("register rejects a mismatched password confirmation", async () => {
  const r = await call("POST", "/api/auth/register", {
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, confirmPassword: `${OWNER_PASSWORD}x` },
  });
  assert.equal(r.status, 400);
  assert.ok(r.json.fields.confirmPassword);
  assert.equal(await prisma.user.count(), 0);
});

test("register on an empty install succeeds and returns a working session", async () => {
  const r = await call("POST", "/api/auth/register", {
    body: { email: `  ${OWNER_EMAIL.toUpperCase()}  `, password: OWNER_PASSWORD, confirmPassword: OWNER_PASSWORD },
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.email, OWNER_EMAIL, "email must be trimmed and lowercased");
  assert.equal(r.json.role, "admin", "the first account on a machine is that machine's owner");

  // No dead second step: the register response itself carries the session.
  assert.ok(/cutprotocol_session=/.test(r.setCookie || ""), "register must issue the session cookie");
  assert.match(r.setCookie, /HttpOnly/i);
  const me = await call("GET", "/api/auth/me", { cookie: sessionCookieFrom(r.setCookie) });
  assert.equal(me.status, 200, "the session issued by register must authenticate immediately");
  assert.equal(me.json.email, OWNER_EMAIL);
});

test("no response body ever carries the password or its hash", async () => {
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  const login = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  const me = await call("GET", "/api/auth/me", { cookie: sessionCookieFrom(login.setCookie) });

  for (const [label, r] of [["login", login], ["me", me]]) {
    assert.ok(!r.text.includes(OWNER_PASSWORD), `${label} body leaked the plaintext password`);
    assert.ok(!r.text.includes(owner.passwordHash), `${label} body leaked the password hash`);
    assert.match(r.text, /^(?!.*passwordHash).*$/s, `${label} body mentions passwordHash`);
  }
});

test("the stored credential is a bcrypt hash, not the plaintext", async () => {
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  assert.notEqual(owner.passwordHash, OWNER_PASSWORD);
  assert.ok(!owner.passwordHash.includes(OWNER_PASSWORD));
  // bcrypt modular-crypt format, cost 12 — matches lib/auth.js hashPassword.
  assert.match(owner.passwordHash, /^\$2[aby]\$12\$/);
  assert.equal(owner.passwordHash.length, 60);
});

test("GET /auth/status flips to needsSetup:false once an account exists", async () => {
  const r = await call("GET", "/api/auth/status");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { needsSetup: false });
});

test("login with the newly registered credentials succeeds; a wrong password does not", async () => {
  const good = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  assert.equal(good.status, 200, good.text);
  assert.ok(/cutprotocol_session=/.test(good.setCookie || ""));

  const bad = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: `${OWNER_PASSWORD}!` } });
  assert.equal(bad.status, 401);
});

// ── the gate: /register is not an open endpoint once an account exists ───────

test("register is REFUSED once an account exists and the caller is unauthenticated", async () => {
  const before = await prisma.user.count();
  const r = await call("POST", "/api/auth/register", {
    body: { email: "intruder@example.test", password: "a-perfectly-valid-password" },
  });
  assert.equal(r.status, 403, r.text);
  assert.equal(await prisma.user.count(), before, "a refused registration must not create a user");
  // The refusal must not confirm who exists on this machine.
  assert.ok(!r.text.includes(OWNER_EMAIL));
});

test("a forged or expired session cookie cannot unlock register", async () => {
  for (const cookie of [
    "cutprotocol_session=not-a-jwt",
    "cutprotocol_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  ]) {
    const r = await call("POST", "/api/auth/register", {
      body: { email: "forged@example.test", password: "a-perfectly-valid-password" },
      cookie,
    });
    assert.equal(r.status, 403, `${cookie} -> ${r.status}`);
  }
});

test("a valid session for a DELETED user cannot unlock register", async () => {
  // Stale 30-day token / restored database: the cookie verifies, the user is gone.
  const { signToken } = require(path.join(BACKEND, "src", "lib", "auth.js"));
  const r = await call("POST", "/api/auth/register", {
    body: { email: "ghost@example.test", password: "a-perfectly-valid-password" },
    cookie: `cutprotocol_session=${signToken("cuid-that-does-not-exist")}`,
  });
  assert.equal(r.status, 403, r.text);
});

test("duplicate email is rejected even for the authenticated owner", async () => {
  const login = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  const before = await prisma.user.count();
  const r = await call("POST", "/api/auth/register", {
    body: { email: OWNER_EMAIL, password: "another-valid-password" },
    cookie: sessionCookieFrom(login.setCookie),
  });
  assert.equal(r.status, 409, r.text);
  assert.ok(r.json.fields.email);
  assert.equal(await prisma.user.count(), before);
});

test("an authenticated owner CAN add another local profile, and it is not an admin", async () => {
  const login = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  const r = await call("POST", "/api/auth/register", {
    body: { email: SECOND_EMAIL, password: "second-profile-password" },
    cookie: sessionCookieFrom(login.setCookie),
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.email, SECOND_EMAIL);
  assert.equal(r.json.role, "user", "only the first account is the machine owner");

  const asSecond = await call("POST", "/api/auth/login", { body: { email: SECOND_EMAIL, password: "second-profile-password" } });
  assert.equal(asSecond.status, 200);
});

test("repeated register attempts are throttled", async () => {
  authRouter.__registerThrottle.reset();
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const r = await call("POST", "/api/auth/register", { body: { email: `spray${i}@example.test`, password: "x" } });
    statuses.push(r.status);
  }
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses.join(",")}`);
  const first429 = statuses.indexOf(429);
  assert.ok(first429 >= 5, `throttle tripped too early (attempt ${first429 + 1})`);
  authRouter.__registerThrottle.reset();
});

// ── pure units (no HTTP, no DB) ─────────────────────────────────────────────

test("validateRegistration normalizes and reports every bad field at once", () => {
  const { validateRegistration, MIN_PASSWORD_LENGTH } = require(path.join(BACKEND, "src", "lib", "auth.js"));
  assert.equal(MIN_PASSWORD_LENGTH, 8);

  const bad = validateRegistration({ email: "nope", password: "1234567", confirmPassword: "x" });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["confirmPassword", "email", "password"]);

  const good = validateRegistration({ email: "  Mixed.Case@Example.TEST ", password: "12345678" });
  assert.equal(good.ok, true);
  assert.equal(good.email, "mixed.case@example.test");
  assert.deepEqual(good.errors, {});

  // confirmPassword is optional for API callers, enforced only when sent.
  assert.equal(validateRegistration({ email: "a@b.co", password: "12345678" }).ok, true);
  assert.equal(validateRegistration({}).ok, false);
  assert.equal(validateRegistration(null).ok, false);
});

test("createAttemptThrottle counts per key inside its window", () => {
  const { createAttemptThrottle } = require(path.join(BACKEND, "src", "lib", "auth.js"));
  const t = createAttemptThrottle({ max: 3, windowMs: 60_000 });
  for (let i = 0; i < 3; i++) {
    assert.equal(t.check("a").allowed, true);
    t.record("a");
  }
  const blocked = t.check("a");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
  assert.equal(t.check("b").allowed, true, "throttling is per key, not global");
  t.reset();
  assert.equal(t.check("a").allowed, true);
});
