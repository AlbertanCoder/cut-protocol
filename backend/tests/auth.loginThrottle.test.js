"use strict";
// Login brute-force brake (orchestrator follow-up to Agent 05, 2026-07-23).
//
// /register shipped with a throttle; /login deliberately shipped without one
// because the QC fuzz harness body-fuzzes it in bulk. That left password
// guessing with no brake at all on a build we hand to other people.
//
// These tests pin the three properties that make the brake worth having, each
// of which is a way the naive version gets it wrong:
//   1. failed credential attempts are capped, and the cap actually 429s;
//   2. a success clears only THAT caller (a global reset would let any one
//      successful login wipe an attacker's counter against another account);
//   3. malformed bodies do not consume a real user's budget.

const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const cookieParser = require("cookie-parser");

const authRouter = require("../src/routes/auth.js");
const { __loginThrottle } = authRouter;

// The route module reads prisma at call time, so stubbing the module cache
// before the handler runs is enough — no DB, no dev.db, no network.
const prismaLib = require("../src/lib/prisma.js");
const { hashPassword } = require("../src/lib/auth.js");

const PASSWORD = "correct-horse-battery";
let PASSWORD_HASH;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  return app;
}

async function post(app, body, ip) {
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = srv.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally {
    srv.close();
  }
}

test.before(async () => {
  PASSWORD_HASH = await hashPassword(PASSWORD);
  // Two known users, so per-account isolation is actually observable.
  const USERS = {
    "real@local": { id: 1, email: "real@local", role: "admin" },
    "other@local": { id: 2, email: "other@local", role: "user" },
  };
  prismaLib.prisma.user = {
    findUnique: async ({ where }) =>
      USERS[where.email] ? { ...USERS[where.email], passwordHash: PASSWORD_HASH } : null,
  };
});

test.beforeEach(() => __loginThrottle.reset());

test("login: failed credential attempts are capped and then 429", async () => {
  const app = buildApp();
  for (let i = 0; i < 10; i++) {
    const res = await post(app, { email: "real@local", password: "wrong" });
    assert.strictEqual(res.status, 401, `attempt ${i + 1} should still be 401`);
  }
  const blocked = await post(app, { email: "real@local", password: "wrong" });
  assert.strictEqual(blocked.status, 429, "the 11th failure must be throttled");
  assert.ok(blocked.json.retryAfterSec > 0, "429 must say how long to wait");
});

test("login: the throttle blocks even the CORRECT password once tripped", async () => {
  // Otherwise the brake is decorative — an attacker who guesses right on
  // attempt 11 still gets in.
  const app = buildApp();
  for (let i = 0; i < 10; i++) await post(app, { email: "real@local", password: "wrong" });
  const res = await post(app, { email: "real@local", password: PASSWORD });
  assert.strictEqual(res.status, 429);
});

test("login: throttling one account does not lock out a different account", async () => {
  // The reason the key includes the email. This app binds loopback only, so
  // req.ip is 127.0.0.1 for everyone; an address-keyed throttle would be a
  // single global bucket and guessing at ANY account would lock out ALL of
  // them — a trivial denial-of-service against the machine's real owner.
  const app = buildApp();

  for (let i = 0; i < 10; i++) await post(app, { email: "real@local", password: "wrong" });
  assert.strictEqual((await post(app, { email: "real@local", password: "wrong" })).status, 429);

  const other = await post(app, { email: "other@local", password: PASSWORD });
  assert.strictEqual(other.status, 200, "a different account must still be able to log in");
});

test("login: a success clears only that key, not everyone's counter", async () => {
  // The bug this pins: createAttemptThrottle.reset() empties the WHOLE map, so
  // a success path calling reset() instead of clear(key) would let any single
  // successful login wipe an attacker's budget against another account.
  const app = buildApp();

  for (let i = 0; i < 10; i++) await post(app, { email: "real@local", password: "wrong" });
  assert.strictEqual((await post(app, { email: "real@local", password: "wrong" })).status, 429);

  assert.strictEqual((await post(app, { email: "other@local", password: PASSWORD })).status, 200);

  const stillBlocked = await post(app, { email: "real@local", password: "wrong" });
  assert.strictEqual(stillBlocked.status, 429, "the other account's success must NOT have cleared this budget");
});

test("login: mistyping then succeeding leaves a clean budget", async () => {
  const app = buildApp();
  for (let i = 0; i < 3; i++) await post(app, { email: "real@local", password: "typo" });
  assert.strictEqual((await post(app, { email: "real@local", password: PASSWORD })).status, 200);
  // Full budget again: 10 more failures must all be reachable.
  for (let i = 0; i < 10; i++) {
    assert.strictEqual((await post(app, { email: "real@local", password: "wrong" })).status, 401);
  }
});

test("login: malformed bodies do not consume the credential budget", async () => {
  // A fuzzer or a buggy client must not be able to lock out a real user.
  const app = buildApp();
  for (let i = 0; i < 25; i++) {
    const res = await post(app, { email: { $ne: null }, password: 12345 });
    assert.strictEqual(res.status, 400);
  }
  assert.strictEqual((await post(app, { email: "real@local", password: PASSWORD })).status, 200);
});

test("login: an unknown email and a wrong password are throttled identically", async () => {
  // Recording only one of them would turn the throttle into an account-existence
  // oracle — the same leak the shared "invalid credentials" message avoids.
  const app = buildApp();
  for (let i = 0; i < 10; i++) {
    assert.strictEqual((await post(app, { email: "nobody@local", password: "x" })).status, 401);
  }
  assert.strictEqual((await post(app, { email: "nobody@local", password: "x" })).status, 429);
});
