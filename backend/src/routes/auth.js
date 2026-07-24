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
  validateRegistration,
  createAttemptThrottle,
} = require("../lib/auth.js");

const router = express.Router();

// Defence in depth for /register (see the route for the real gate). 10 attempts
// per 15 minutes per client address is far above any honest use of an endpoint
// you touch once per account, and low enough to make a scripted attempt useless.
// NOT applied to /login: the QC fuzz harness (scripts/qc/fuzz.mjs) body-fuzzes
// POST /api/auth/login in bulk and would trip it. Login throttling is a real
// gap — flagged to the orchestrator in docs/qc/handoff/agent05.md.
const registerThrottle = createAttemptThrottle({ max: 10, windowMs: 15 * 60 * 1000 });

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
      data: { email, passwordHash, role: isFirstRun ? "admin" : "user" },
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
  // "account created, now go log in" second step.
  setSessionCookie(res, signToken(user.id));
  res.status(201).json(user);
});

router.post("/login", async (req, res) => {
  const body = req.body || {};
  // Type-check BEFORE any string method: a non-string email (e.g. a Prisma
  // operator object {"$ne":null}) used to hit .trim() and 500. Rejecting
  // non-strings up front both fixes that and stops such objects ever reaching
  // the prisma where-clause. (QC gauntlet v2, 2026-07-23.)
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return res.status(400).json({ error: "email and password required" });
  }
  const password = body.password;
  const email = body.email.trim().toLowerCase();
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "invalid credentials" });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid credentials" });

  setSessionCookie(res, signToken(user.id));
  res.json({ id: user.id, email: user.email });
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/me", requireAuth, async (req, res) => {
  // role included so the frontend can gate personal/legacy content
  // (frontend/src/data/constants.js's hardcoded RX/MILESTONES/FORK_DATE and
  // RecipesTab.jsx's "Reference" section - real personal data for the one
  // pre-multi-tenancy account, not computed for a generic user) behind
  // role === "admin" rather than showing it to every account. See
  // roadmap/09-ux-onboarding.md's finding on this.
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, role: true } });
  if (!user) return res.status(404).json({ error: "user not found" });
  res.json(user);
});

module.exports = router;
// In-process test seam only (tests/auth.registration.test.js requires this same
// module instance to clear the counter between groups). Not reachable over HTTP
// and not an env flag, so it cannot be used to disarm the throttle at runtime.
module.exports.__registerThrottle = registerThrottle;
