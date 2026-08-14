const express = require("express");
const { prisma } = require("../lib/prisma.js");
const {
  hashPassword,
  verifyPassword,
  signToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  optionalAuth,
  normalizeEmail,
  validateRegistration,
  createAttemptThrottle,
  MIN_PASSWORD_LENGTH,
  SESSION_EXPIRED_MESSAGE,
  BAD_CREDENTIALS_MESSAGE,
} = require("../lib/auth.js");
const { beginReset, verifyResetCode, recoveryDisplayPath } = require("../lib/passwordReset.js");
const { isSupabaseAuthEnabled } = require("../lib/supabaseAuth.js");

const router = express.Router();

// Defence in depth for /register (see the route for the real gate). 10 attempts
// per 15 minutes per client address is far above any honest use of an endpoint
// you touch once per account, and low enough to make a scripted attempt useless.
const registerThrottle = createAttemptThrottle({ max: 10, windowMs: 15 * 60 * 1000 });

// Login brute-force brake. This was deliberately left off in the first pass
// because the QC fuzz harness (scripts/qc/fuzz.mjs) body-fuzzes
// POST /api/auth/login in bulk and a throttle would 429 it.
//
// That was the wrong trade, in both directions. Leaving it off meant password
// guessing had no brake at all on a build we hand to other people. And turning
// it on naively would have made the harness WORSE, not just noisier: the fuzz
// asserts that hostile bodies don't 500, so if every hostile body bounces at
// the throttle it never reaches the handler and the whole login fuzz becomes
// vacuous while still reporting green.
//
// So the harness resets this counter between batches through the in-process
// seam below (it already boots the app in-process via app.listen). Production
// keeps a real throttle; the fuzz keeps real coverage. Note there is no env
// flag and no HTTP route that clears it — an env-var bypass would just be the
// brake with a switch an attacker can reach.
//
// Only FAILED attempts count, and a success clears the caller's counter, so a
// legitimate user logging in repeatedly can never lock themselves out.
const loginThrottle = createAttemptThrottle({ max: 10, windowMs: 15 * 60 * 1000 });

// Password-reset brake. Same budget as login: begin + complete share it, keyed on
// address AND email, so guessing the one-time code is capped per target the same
// way password guessing is. Only failures count; a completed reset clears it.
const resetThrottle = createAttemptThrottle({ max: 10, windowMs: 15 * 60 * 1000 });

// GET /api/auth/status — unauthenticated, and deliberately says nothing except
// "does this install have any account yet". The frontend uses it to choose
// between "Create your account" and "Sign in". No usernames, no counts: a
// boolean is all the login screen needs and all an unauthenticated caller gets.
router.get("/status", async (req, res) => {
  const count = await prisma.user.count();
  res.json({ needsSetup: count === 0 });
});

// POST /api/auth/register
//
// SECURITY GATE (the important part): this is NOT an open endpoint. The backend
// binds beyond loopback, so an always-open register route would be a one-request
// account-creation path for anyone on the same network. Registration is allowed
// only when EITHER:
//   (a) the install has zero users — the genuine first-run case, or
//   (b) the caller already holds a valid session, i.e. the existing owner
//       adding another local profile on their own machine.
// Anything else is 403, with a message that confirms nothing about who exists.
router.post("/register", optionalAuth, async (req, res) => {
  const key = req.ip || "unknown";
  const gate = registerThrottle.check(key);
  if (!gate.allowed) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again.", retryAfterSec: gate.retryAfterSec });
  }
  registerThrottle.record(key);

  const existingUsers = await prisma.user.count();
  const isFirstRun = existingUsers === 0;

  if (!isFirstRun) {
    // A session cookie for a user that no longer exists must not count as
    // authenticated (deleted account, restored DB, stale 30-day token).
    const caller = req.userId
      ? await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true } })
      : null;
    if (!caller) {
      return res.status(403).json({ error: "This machine already has an account. Sign in to add another profile." });
    }
  }

  const { ok, email, password, errors } = validateRegistration(req.body);
  if (!ok) {
    return res.status(400).json({ error: "Check the highlighted fields.", fields: errors });
  }

  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) {
    return res.status(409).json({ error: "That email already has an account on this machine.", fields: { email: "That email already has an account on this machine." } });
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await prisma.user.create({
      // The first account on a machine is that machine's owner, so it gets
      // "admin" — the role that can correct the shared food/recipe library
      // (see routes/recipes.js canMutateRecipe and FoodsTab's isAdmin gate).
      // Additional profiles the owner creates later are plain users, who can
      // only mutate what they created.
      //
      // NOT ON A HOSTED DEPLOY (found live 2026-08-13, minutes after the first
      // green Railway deploy). The rule above is safe on a desktop install
      // because the first account IS the machine's owner. On a freshly seeded
      // cloud database the user table is empty, so `isFirstRun` is true for
      // whichever STRANGER posts here first — handing them admin and the
      // food-library writes it unlocks. This is the same hole supabaseAuth.js
      // closed for the Google path (QC audit 2026-08-11 item 1); that fix
      // never covered this one. Hosted mode grants admin to nobody; use
      // scripts/grantAdmin.mjs instead.
      data: { email, passwordHash, role: isFirstRun && !isSupabaseAuthEnabled() ? "admin" : "user" },
      // select, not a delete-the-field-afterwards: the hash can never fall out
      // of this handler because it is never read out of the database here.
      select: { id: true, email: true, role: true },
    });
  } catch (e) {
    // Unique-constraint race between the findUnique above and this create.
    if (e.code === "P2002") {
      return res.status(409).json({ error: "That email already has an account on this machine.", fields: { email: "That email already has an account on this machine." } });
    }
    throw e;
  }

  // Same session issuance as /login, so registering IS signing in — no dead
  // "account created, now go log in" second step. The hash is passed so the
  // session is pinned to the password epoch it was minted under (lib/auth.js
  // passwordEpoch) — that is what makes a later reset able to revoke it.
  setSessionCookie(res, signToken(user.id, passwordHash));
  res.status(201).json(user);
});

router.post("/login", async (req, res) => {
  const body = req.body || {};
  // Type-check BEFORE any string method: a non-string email (e.g. a Prisma
  // operator object {"$ne":null}) used to hit .trim() and 500. Rejecting
  // non-strings up front both fixes that and stops such objects ever reaching
  // the prisma where-clause. (QC gauntlet v2, 2026-07-23.)
  //
  // This block runs BEFORE the throttle on purpose: a malformed body is a client
  // bug or a fuzzer, not a password guess, and letting it consume the budget
  // would hand anyone a lockout primitive against a real user.
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return res.status(400).json({ error: "email and password required" });
  }
  const password = body.password;
  const email = body.email.trim().toLowerCase();
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  // Keyed on address AND the email being guessed — NOT address alone.
  //
  // This app binds 127.0.0.1 only, so req.ip is 127.0.0.1 for every caller and
  // an address-keyed throttle is really one global bucket: failed guesses at any
  // account would lock out every account. Including the email caps guessing per
  // target instead, which is the thing brute force actually does.
  //
  // Note the alternative was trusting X-Forwarded-For to tell callers apart —
  // which on a loopback server means letting the client pick its own throttle
  // key, i.e. a one-header bypass. `trust proxy` stays off.
  const throttleKey = `${req.ip || "unknown"}|${email}`;
  const gate = loginThrottle.check(throttleKey);
  if (!gate.allowed) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again.", retryAfterSec: gate.retryAfterSec });
  }

  // Both wrong-email and wrong-password record identically — recording only one
  // would turn the throttle into an account-existence oracle, which is exactly
  // the leak the shared "invalid credentials" message exists to avoid.
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    loginThrottle.record(throttleKey);
    return res.status(401).json({ error: BAD_CREDENTIALS_MESSAGE });
  }

  // saas-launch: an account created through Google sign-in has no password
  // (passwordHash is null) — nothing to compare, so this can only fail. Same
  // sentence as every other failure: "use Google for this email" would be an
  // account-existence oracle.
  if (!user.passwordHash) {
    loginThrottle.record(throttleKey);
    return res.status(401).json({ error: BAD_CREDENTIALS_MESSAGE });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    loginThrottle.record(throttleKey);
    return res.status(401).json({ error: BAD_CREDENTIALS_MESSAGE });
  }

  // A success clears the budget, so someone who mistypes twice and then gets it
  // right starts clean rather than carrying the failures for 15 minutes.
  loginThrottle.clear(throttleKey);

  setSessionCookie(res, signToken(user.id, user.passwordHash));
  res.json({ id: user.id, email: user.email });
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

// POST /api/auth/reset/begin — start a local, email-free password reset.
//
// The registration policy above gates account creation on "first-run OR already
// signed in". A forgot-password caller is, by definition, NEITHER — so it needs a
// different proof of who's allowed. That proof is LOCAL FILE ACCESS: the one-time
// code is written to a file next to the database (see lib/passwordReset.js) and
// never returned here. Reading that file is the same local access that reading
// the SQLite DB requires, so this endpoint can't hand an account to a remote
// caller even if the backend were ever bound past loopback.
router.post("/reset/begin", async (req, res) => {
  const body = req.body || {};
  if (typeof body.email !== "string") return res.status(400).json({ error: "email required" });
  const email = normalizeEmail(body.email);
  if (!email) return res.status(400).json({ error: "email required" });

  const key = `${req.ip || "unknown"}|${email}`;
  const gate = resetThrottle.check(key);
  if (!gate.allowed) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again.", retryAfterSec: gate.retryAfterSec });
  }
  resetThrottle.record(key);

  // Write a code ONLY for a real account, but answer identically either way so
  // this can't be used to test which emails have accounts — the same
  // account-existence-oracle guard /login keeps with its single bad-credentials
  // message. The file LOCATION is not secret; the code inside it is, and that's
  // only written when the account exists.
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) beginReset(email);

  // A DISPLAY path (`~\…`), never the absolute one.
  //
  // This route is unauthenticated by necessity, so anything it returns is
  // readable by any caller that reaches the port — and an absolute Windows path
  // is `C:\Users\<username>\…`, i.e. the machine's account name handed out for
  // free. routes/meta.js suppresses paths in its responses for exactly this
  // reason, and Phase 9 rewrote this repo's history to scrub that same username
  // before going public. See lib/passwordReset.js recoveryDisplayPath.
  //
  // Note the path derives from the email the CALLER supplied, so it is the same
  // shape whether or not the account exists — no oracle.
  res.json({
    ok: true,
    filePath: recoveryDisplayPath(email),
    message: "If that account exists, a one-time code was written to the file below. Open it, then enter the code to set a new password. The code expires in 15 minutes.",
  });
});

// POST /api/auth/reset/complete — finish the reset with the code from the file.
router.post("/reset/complete", async (req, res) => {
  const body = req.body || {};
  if (typeof body.email !== "string" || typeof body.code !== "string" || typeof body.newPassword !== "string") {
    return res.status(400).json({ error: "email, code and newPassword are required" });
  }
  const email = normalizeEmail(body.email);
  const { code, newPassword } = body;

  const key = `${req.ip || "unknown"}|${email}`;
  const gate = resetThrottle.check(key);
  if (!gate.allowed) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again.", retryAfterSec: gate.retryAfterSec });
  }

  // Length is checked BEFORE the code is verified so a too-short new password
  // doesn't burn a valid one-time code (verifyResetCode consumes it on success).
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      fields: { newPassword: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
    });
  }

  const okCode = verifyResetCode(email, code);
  if (!okCode) {
    resetThrottle.record(key);
    return res.status(400).json({ error: "That code is incorrect or has expired. Start the reset again." });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) {
    // Code verified but the account vanished mid-flow (deleted, DB swapped). The
    // same opaque message — never confirm which half failed.
    return res.status(400).json({ error: "That code is incorrect or has expired. Start the reset again." });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // A successful reset clears the attempt budget and signs the user straight in —
  // same session issuance as /login, so there's no "now go sign in" dead end.
  //
  // The NEW hash pins the new session, which is what kills every session issued
  // under the old password. bcrypt salts, so this holds even when the "new"
  // password is the same string as the old one: the hash differs, the epoch
  // differs, and the stolen 30-day cookie the user is resetting BECAUSE of is
  // dead on the next request. See lib/auth.js passwordEpoch/resolveSession.
  resetThrottle.clear(key);
  setSessionCookie(res, signToken(user.id, passwordHash));
  res.json({ id: user.id, email: user.email });
});

router.get("/me", requireAuth, async (req, res) => {
  // role included so the frontend can gate personal/legacy content
  // (frontend/src/data/constants.js's hardcoded RX/MILESTONES/FORK_DATE and
  // RecipesTab.jsx's "Reference" section - real personal data for the one
  // pre-multi-tenancy account, not computed for a generic user) behind
  // role === "admin" rather than showing it to every account. See
  // roadmap/09-ux-onboarding.md's finding on this.
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, role: true } });
  if (!user) {
    // A cryptographically valid token whose user no longer exists is an INVALID
    // SESSION, not a missing resource — so 401, not 404.
    //
    // 404 was a real dead end, hit in the wild: the session cookie is scoped to
    // the HOST (localhost), not the port or the database, so a cookie minted
    // against one database is replayed against another — e.g. the packaged
    // build's cutprotocol.db vs the dev tree's dev.db, where the same user id
    // does not exist. The client only treats 401 as an auth failure, so a 404
    // fell into the "server never answered" bucket and rendered
    // "Can't reach the app's server / user not found / You are not signed out"
    // — three mutually contradictory claims — with a Retry that could never
    // succeed and no route to sign-in. Cookie TTL is 30 days, so it did not
    // time itself out.
    //
    // Clearing the cookie is the other half: without it the next boot replays
    // the same dead token forever.
    // Belt and braces: requireAuth now resolves the user itself, so this branch
    // only fires on a delete that lands between the two reads. Same sentence
    // either way — the user does not care which of the two noticed.
    clearSessionCookie(res);
    return res.status(401).json({ error: SESSION_EXPIRED_MESSAGE });
  }
  // saas-launch Stage 2: the tier rides along so the frontend can mount the
  // lock overlays without a second request. Desktop installs report premium
  // (status "local") — see lib/entitlement.js.
  const entitlement = await require("../lib/entitlement.js").getEntitlement(user.id);
  res.json({ ...user, premium: entitlement.premium, premiumStatus: entitlement.status, premiumEndsAt: entitlement.endsAt });
});

module.exports = router;
// In-process test seam only (tests/auth.registration.test.js requires this same
// module instance to clear the counter between groups). Not reachable over HTTP
// and not an env flag, so it cannot be used to disarm the throttle at runtime.
module.exports.__registerThrottle = registerThrottle;
module.exports.__loginThrottle = loginThrottle;
module.exports.__resetThrottle = resetThrottle;
