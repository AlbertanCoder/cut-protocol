// Session token verification — the assertions the suite was missing.
//
// WHY THIS FILE EXISTS (2026-07-24). A mutation test replaced `jwt.verify` with
// `jwt.decode` in src/lib/auth.js — i.e. deleted signature checking entirely —
// and ALL 1043 tests still passed. That mutation is live account takeover: a
// token signed with a secret the attacker guessed wrong is admitted, and
// `req.userId` is set to whatever subject the attacker wrote in the payload.
//
// Nothing caught it because the one "forged cookie" test
// (auth.registration.test.js) forged a cookie for the subject "fake" — a user
// that does not exist — so the 403 it asserted was produced by the DOWNSTREAM
// user-existence check, which is literally the next test in that file. That
// test would keep passing with signature verification removed.
//
// Two different rejections were being conflated:
//   1. "this token was not signed by this install"  (cryptography)
//   2. "this token's subject is not a user here"     (database)
// Both end in 401/403, so a test that only ever triggers (2) proves nothing
// about (1). Every test below pins ONE of them, and the signature tests use a
// REAL, EXISTING user with a CORRECT password-epoch claim so that a bad
// signature is the only thing left that can reject them.
//
// verifyToken is exported for this file. It used to be private, reachable only
// through middleware — which is exactly why it could only ever be probed
// through a route that has check (2) standing in front of it.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");

const BACKEND = path.resolve(__dirname, "..");
const SECRET = "auth-token-verification-test-only-secret"; // scan:allow — fixture; it exists precisely so the developer's real JWT_SECRET stays out of this process
const WRONG_SECRET = "attacker-guessed-wrong";
const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD = "correct-horse-battery";
const SECOND_EMAIL = "second-profile@example.test";
const SECOND_PASSWORD = "second-profile-password";

let tmpDir, dbFile, app, srv, base, prisma, authLib, authRouter;
let ownerId, ownerEpoch, secondId, secondEpoch;

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
  try { json = JSON.parse(text); } catch { /* non-JSON body kept in text */ }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

const sessionCookieFrom = (setCookie) => (setCookie || "").split(";")[0];
const asCookie = (token) => `cutprotocol_session=${token}`;
const b64 = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutproto-token-"));
  dbFile = path.join(tmpDir, "fresh-install.db");
  buildFreshInstallDb(dbFile);

  process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
  process.env.CUT_PROTOCOL_RECOVERY_DIR = tmpDir;
  process.env.JWT_SECRET = SECRET;
  process.env.QC_NO_LISTEN = "1";
  process.env.BRAIN = "off";

  app = require(path.join(BACKEND, "server.js"));
  ({ prisma } = require(path.join(BACKEND, "src", "lib", "prisma.js")));
  authLib = require(path.join(BACKEND, "src", "lib", "auth.js"));
  authRouter = require(path.join(BACKEND, "src", "routes", "auth.js"));

  srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${srv.address().port}`;

  // Two REAL accounts. Everything below forges tokens for these — not for
  // invented subjects — so the user-existence check can never be what rejects.
  const owner = await call("POST", "/api/auth/register", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  assert.equal(owner.status, 201, `setup: owner registration failed — ${owner.text}`);
  const second = await call("POST", "/api/auth/register", {
    body: { email: SECOND_EMAIL, password: SECOND_PASSWORD },
    cookie: sessionCookieFrom(owner.setCookie),
  });
  assert.equal(second.status, 201, `setup: second profile registration failed — ${second.text}`);

  const ownerRow = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  const secondRow = await prisma.user.findUnique({ where: { email: SECOND_EMAIL } });
  ownerId = ownerRow.id;
  secondId = secondRow.id;
  ownerEpoch = authLib.passwordEpoch(ownerRow.passwordHash);
  secondEpoch = authLib.passwordEpoch(secondRow.passwordHash);
});

test.beforeEach(() => {
  authRouter.__registerThrottle.reset();
  authRouter.__loginThrottle.reset();
});

test.after(async () => {
  try { srv?.close(); } catch { /* already closed */ }
  try { await prisma?.$disconnect(); } catch { /* never connected */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ═══════════════════════════════════════════════════════════════════════════
// THE MISSING ASSERTION — a real user, a wrong secret, over HTTP.
// This is the test the jwt.verify -> jwt.decode mutation survived for want of.
// ═══════════════════════════════════════════════════════════════════════════

test("a token for a REAL, EXISTING user signed with the WRONG secret is refused", async () => {
  // Everything about this token is correct EXCEPT the signature: the subject is
  // a live account, the password-epoch claim is the account's current one, and
  // it is nowhere near expiry. If the request is admitted, the only possible
  // explanation is that the signature was never checked.
  const forged = jwt.sign({ sub: ownerId, pwe: ownerEpoch }, WRONG_SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });

  const r = await call("GET", "/api/auth/me", { cookie: asCookie(forged) });
  assert.equal(r.status, 401, `a wrong-secret token was ADMITTED — ${r.text}`);
  assert.ok(!r.text.includes(OWNER_EMAIL), "the forged session must not return the victim's account");

  // The same forgery against the registration gate, which is where the original
  // (insufficient) forged-cookie test lived.
  const reg = await call("POST", "/api/auth/register", {
    body: { email: "takeover@example.test", password: "a-perfectly-valid-password" },
    cookie: asCookie(forged),
  });
  assert.equal(reg.status, 403, `a wrong-secret token unlocked /register — ${reg.text}`);
  assert.equal(await prisma.user.findUnique({ where: { email: "takeover@example.test" } }), null);
});

test("the SAME token signed with the RIGHT secret is admitted — so the test above is about the signature and nothing else", async () => {
  // The control. Without it, "401" could just mean the payload shape is wrong.
  const genuine = jwt.sign({ sub: ownerId, pwe: ownerEpoch }, SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });
  const r = await call("GET", "/api/auth/me", { cookie: asCookie(genuine) });
  assert.equal(r.status, 200, `an identically-shaped, correctly-signed token was refused — ${r.text}`);
  assert.equal(r.json.email, OWNER_EMAIL);
});

test("a forged token cannot escalate a plain profile to the machine owner's admin role", async () => {
  // The second profile is a plain "user"; the owner is "admin" and can mutate
  // the shared recipe library. So a payload swap that verified is a privilege
  // escalation, not merely an impersonation.
  const genuine = await call("POST", "/api/auth/login", { body: { email: SECOND_EMAIL, password: SECOND_PASSWORD } });
  const asSecond = await call("GET", "/api/auth/me", { cookie: sessionCookieFrom(genuine.setCookie) });
  assert.equal(asSecond.status, 200, asSecond.text);
  assert.equal(asSecond.json.role, "user", "precondition: the second profile is not an admin");

  const escalated = jwt.sign({ sub: ownerId, pwe: ownerEpoch }, WRONG_SECRET, { algorithm: "HS256", expiresIn: "30d" });
  const r = await call("GET", "/api/auth/me", { cookie: asCookie(escalated) });
  assert.equal(r.status, 401, r.text);
  assert.ok(!r.text.includes("admin"), "no role material may come back from a forged session");
});

test("a genuine token with its PAYLOAD tampered — valid structure, stale signature — is refused", async () => {
  // Take the second profile's real, correctly-signed cookie and rewrite the
  // subject to the admin owner, leaving the original signature attached. The
  // token still parses perfectly; only the signature disagrees.
  const login = await call("POST", "/api/auth/login", { body: { email: SECOND_EMAIL, password: SECOND_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  const real = sessionCookieFrom(login.setCookie).split("=").slice(1).join("=");

  const [header, payloadPart, signature] = real.split(".");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  assert.equal(payload.sub, secondId, "precondition: the real token names the second profile");
  payload.sub = ownerId;
  payload.pwe = ownerEpoch;
  const tampered = `${header}.${b64(payload)}.${signature}`;

  assert.equal(jwt.decode(tampered).sub, ownerId, "precondition: the tampered token DECODES to the owner");

  const r = await call("GET", "/api/auth/me", { cookie: asCookie(tampered) });
  assert.equal(r.status, 401, `a tampered payload was accepted — ${r.text}`);
  assert.ok(!r.text.includes(OWNER_EMAIL));
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyToken, directly. No route in front of it, so nothing downstream can
// stand in for the check being asserted.
// ═══════════════════════════════════════════════════════════════════════════

test("verifyToken accepts a token this install actually signed", () => {
  const token = authLib.signToken(ownerId, "$2b$12$anything-well-formed-enough-to-hash");
  const payload = authLib.verifyToken(token);
  assert.equal(payload.sub, ownerId);
  assert.ok(payload.exp > Math.floor(Date.now() / 1000), "and it is not already expired");
});

test("verifyToken REJECTS a wrong-secret token", () => {
  const forged = jwt.sign({ sub: ownerId, pwe: ownerEpoch }, WRONG_SECRET, { algorithm: "HS256", expiresIn: "30d" });
  assert.throws(() => authLib.verifyToken(forged), /invalid signature/i);
});

test("verifyToken REJECTS an unsigned `alg: none` token", () => {
  // The classic downgrade: valid structure, empty signature, "trust me".
  const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: ownerId, pwe: ownerEpoch })}.`;
  assert.equal(jwt.decode(none).sub, ownerId, "precondition: it decodes fine — decoding is not verifying");
  assert.throws(() => authLib.verifyToken(none), /jwt signature is required|invalid algorithm|invalid signature/i);
});

test("verifyToken REJECTS an expired token", () => {
  const stale = jwt.sign({ sub: ownerId, pwe: ownerEpoch }, SECRET, { algorithm: "HS256", expiresIn: -60 });
  assert.throws(() => authLib.verifyToken(stale), (e) => e.name === "TokenExpiredError");
  // jwt.decode does not look at exp at all, which is half of why the mutation
  // was invisible.
  assert.equal(jwt.decode(stale).sub, ownerId);
});

test("verifyToken REJECTS malformed input without throwing something unhandleable", () => {
  const isError = (e) => e instanceof Error;
  const garbage = ["", "not-a-jwt", "a.b", "a.b.c", "....", "null", `${b64({ alg: "HS256" })}.notbase64.sig`];
  for (const bad of garbage) {
    assert.throws(() => authLib.verifyToken(bad), isError, `${JSON.stringify(bad)} must be rejected`);
  }
  // Non-strings too: requireAuth reads this straight off a client-controlled
  // cookie, so a hostile type must be a clean throw, never a crash of a
  // different shape that some caller forgets to catch.
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.throws(() => authLib.verifyToken(bad), isError, `${JSON.stringify(bad)} must be rejected`);
  }
});

// ── TASK B: the algorithm is pinned ─────────────────────────────────────────
// NOT a live vulnerability today: jsonwebtoken 9 with a STRING secret already
// restricts verification to HS256/384/512 and refuses `alg: none`. The pin is a
// tripwire for the refactor that swaps requireSecret() for an asymmetric key —
// at which point an unpinned verify would happily accept a token signed with
// the PUBLIC key as HS256. These tests fail if the pin is ever removed.

test("verifyToken accepts ONLY HS256, even from the correct secret", () => {
  assert.equal(authLib.SESSION_ALGORITHM, "HS256");
  for (const algorithm of ["HS384", "HS512"]) {
    const otherAlg = jwt.sign({ sub: ownerId, pwe: ownerEpoch }, SECRET, { algorithm, expiresIn: "30d" });
    // Correct secret, live user, correct epoch — the algorithm is the only fault.
    assert.throws(() => authLib.verifyToken(otherAlg), /invalid algorithm/i, `${algorithm} must be refused`);
  }
});

test("tokens this install issues are HS256, so the pin can never lock out its own users", () => {
  const token = authLib.signToken(ownerId, "$2b$12$anything-well-formed-enough-to-hash");
  const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  assert.equal(header.alg, "HS256");
});

// ═══════════════════════════════════════════════════════════════════════════
// The OTHER rejection — a perfectly signed token whose subject is gone. Kept
// separate on purpose: conflating this with the signature checks is the exact
// mistake that hid the mutation.
// ═══════════════════════════════════════════════════════════════════════════

test("a correctly signed token for a DELETED user verifies cryptographically but is refused as a session", async () => {
  const ghost = await prisma.user.create({
    data: { email: "ghost@example.test", passwordHash: "$2b$12$placeholder-hash-for-a-user-about-to-be-deleted", role: "user" },
  });
  const token = authLib.signToken(ghost.id, ghost.passwordHash);

  // Cryptography says yes …
  assert.equal(authLib.verifyToken(token).sub, ghost.id);
  // … and the session still works while the row exists.
  const alive = await call("GET", "/api/auth/me", { cookie: asCookie(token) });
  assert.equal(alive.status, 200, alive.text);

  await prisma.user.delete({ where: { id: ghost.id } });

  // … the database says no. Different check, same 401.
  assert.equal(authLib.verifyToken(token).sub, ghost.id, "the signature is still perfectly valid");
  assert.equal(await authLib.resolveSession(token), null, "but there is no session behind it");
  const dead = await call("GET", "/api/auth/me", { cookie: asCookie(token) });
  assert.equal(dead.status, 401, dead.text);
});

// ── the session-pinning contract (TASK C support) ───────────────────────────

test("signToken refuses to mint a session without the password hash to pin it to", () => {
  // A session with no password epoch is the un-revocable token the pinning
  // exists to remove — so it must be impossible to create one by accident.
  for (const bad of [undefined, null, "", 42, {}]) {
    assert.throws(() => authLib.signToken(ownerId, bad), /password hash is required/i);
  }
});

test("the token carries a one-way epoch tag, never the bcrypt hash itself", async () => {
  // A JWT payload is base64, not encryption — whoever holds the cookie can read
  // every claim in it. The stored credential must not be one of them.
  const row = await prisma.user.findUnique({ where: { id: ownerId } });
  const token = authLib.signToken(ownerId, row.passwordHash);
  const payload = jwt.decode(token);
  assert.equal(payload.pwe, authLib.passwordEpoch(row.passwordHash));
  assert.ok(!token.includes(row.passwordHash), "the raw hash must never travel in the cookie");
  assert.ok(!JSON.stringify(payload).includes(row.passwordHash));
  assert.ok(!JSON.stringify(payload).includes(row.passwordHash.slice(-20)), "not even a tail of it");
});

test("resolveSession refuses a correctly signed token whose epoch claim is missing or wrong", async () => {
  const row = await prisma.user.findUnique({ where: { id: ownerId } });

  // No claim at all — signed by this install, so ONLY the missing epoch can reject it.
  const noEpoch = jwt.sign({ sub: ownerId }, SECRET, { algorithm: "HS256", expiresIn: "30d" });
  assert.equal(authLib.verifyToken(noEpoch).sub, ownerId, "precondition: the signature is genuine");
  assert.equal(await authLib.resolveSession(noEpoch), null, "a session with no epoch must not be honoured");

  // A stale epoch — what a pre-reset cookie looks like.
  const staleEpoch = jwt.sign({ sub: ownerId, pwe: authLib.passwordEpoch("some-older-hash") }, SECRET, {
    algorithm: "HS256",
    expiresIn: "30d",
  });
  assert.equal(await authLib.resolveSession(staleEpoch), null);

  // Another account's epoch on this account's subject.
  const crossed = jwt.sign({ sub: ownerId, pwe: secondEpoch }, SECRET, { algorithm: "HS256", expiresIn: "30d" });
  assert.equal(await authLib.resolveSession(crossed), null);

  // The genuine article still resolves — the check is specific, not blanket.
  const good = authLib.signToken(ownerId, row.passwordHash);
  assert.deepEqual(await authLib.resolveSession(good), { userId: ownerId });
});

// ── one sentence per fact (TASK E) ──────────────────────────────────────────

test("every session rejection says the same one sentence, and it is written for a person", async () => {
  const expected = authLib.SESSION_EXPIRED_MESSAGE;
  assert.match(expected, /sign in again/i);

  const cases = {
    "no cookie at all": undefined,
    "garbage cookie": asCookie("not-a-jwt"),
    "wrong secret": asCookie(jwt.sign({ sub: ownerId, pwe: ownerEpoch }, WRONG_SECRET, { algorithm: "HS256", expiresIn: "30d" })),
    "expired": asCookie(jwt.sign({ sub: ownerId, pwe: ownerEpoch }, SECRET, { algorithm: "HS256", expiresIn: -60 })),
    "unknown subject": asCookie(authLib.signToken("cuid-that-does-not-exist", "$2b$12$some-well-formed-looking-hash")),
  };
  for (const [label, cookie] of Object.entries(cases)) {
    const r = await call("GET", "/api/auth/me", cookie ? { cookie } : {});
    assert.equal(r.status, 401, `${label} -> ${r.status}`);
    assert.equal(r.json.error, expected, `${label} used a different sentence: ${r.json.error}`);
  }
});

test("a wrong password and a wrong email give the same person-readable sentence", async () => {
  const expected = authLib.BAD_CREDENTIALS_MESSAGE;
  assert.match(expected, /^Wrong email or password\.$/);

  const wrongPassword = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: `${OWNER_PASSWORD}!` } });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.json.error, expected);

  const wrongEmail = await call("POST", "/api/auth/login", { body: { email: "nobody@example.test", password: OWNER_PASSWORD } });
  assert.equal(wrongEmail.status, 401);
  // Identical, or the message becomes an account-existence oracle.
  assert.equal(wrongEmail.json.error, wrongPassword.json.error);
});

test("a rejected session cookie is CLEARED, so the browser stops replaying a dead token", async () => {
  // The cookie is scoped to the host, not the port or the database, and lives 30
  // days — without an explicit clear, a token rejected once is re-sent on every
  // request and every boot forever.
  const r = await call("GET", "/api/auth/me", {
    cookie: asCookie(jwt.sign({ sub: ownerId, pwe: ownerEpoch }, WRONG_SECRET, { algorithm: "HS256", expiresIn: "30d" })),
  });
  assert.equal(r.status, 401);
  assert.match(r.setCookie || "", /cutprotocol_session=/, "the 401 must clear the session cookie");
});

// ── the guards that were already working — do not let them rot ──────────────

test("the session cookie stays HttpOnly and bcrypt stays at cost 12", async () => {
  const login = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  assert.match(login.setCookie, /HttpOnly/i, "a session cookie readable from JS is a one-XSS takeover");

  const row = await prisma.user.findUnique({ where: { id: ownerId } });
  assert.match(row.passwordHash, /^\$2[aby]\$12\$/, "cost 12 — a lower cost is a cheaper offline crack");

  const wrong = await call("POST", "/api/auth/login", { body: { email: OWNER_EMAIL, password: "definitely-not-the-password" } });
  assert.equal(wrong.status, 401, "the password check must actually compare");
});
