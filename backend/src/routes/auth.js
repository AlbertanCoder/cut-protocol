const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { verifyPassword, signToken, setSessionCookie, clearSessionCookie, requireAuth } = require("../lib/auth.js");

const router = express.Router();

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
