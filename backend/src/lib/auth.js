const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "cutprotocol_session";
const TOKEN_TTL = "30d";

// Registration policy (fleet finding onboarding-flow-1, 2026-07-23). The app
// shipped with /login and /logout but no way to CREATE an account, so a fresh
// install booted to a sign-in screen nobody could get past. These are the
// shared, pure pieces of the registration path; the wiring lives in
// src/routes/auth.js.
const MIN_PASSWORD_LENGTH = 8;
// Deliberately permissive: this is a local single-user desktop app, the email
// is an identity string not a delivery address, and a regex that rejects a
// valid-but-unusual address is a worse bug than one that accepts a typo.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET env var");
  return secret;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, requireSecret(), { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  return jwt.verify(token, requireSecret());
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "not authenticated" });
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "invalid or expired session" });
  }
}

// Same session mechanism as requireAuth, but a missing/expired/garbage cookie
// is not an error — it just leaves req.userId undefined. /register needs this:
// the route is reachable both by a brand-new install (nobody is signed in) and
// by the existing owner adding a second local profile, and it must be able to
// tell those apart without 401-ing the first case.
function optionalAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      req.userId = verifyToken(token).sub;
    } catch {
      // fall through unauthenticated
    }
  }
  next();
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Pure validation for a registration payload. Returns field-level errors so
 * the UI can put the message next to the input that caused it, instead of one
 * anonymous banner.
 *
 * Type-checks before any string method for the same reason /login does (QC
 * gauntlet v2): a non-string field (e.g. a Prisma operator object) must be a
 * 400, never a 500, and must never reach a where-clause.
 *
 * `confirmPassword` is optional — the browser form sends it, an API caller
 * need not. It is only compared when present.
 */
function validateRegistration(body) {
  const raw = body && typeof body === "object" ? body : {};
  const errors = {};

  const email = normalizeEmail(raw.email);
  const password = typeof raw.password === "string" ? raw.password : "";
  const confirm = typeof raw.confirmPassword === "string" ? raw.confirmPassword : null;

  if (typeof raw.email !== "string" || !email) errors.email = "Email is required.";
  else if (!EMAIL_SHAPE.test(email)) errors.email = "That doesn't look like an email address.";

  if (typeof raw.password !== "string" || !password) errors.password = "Password is required.";
  else if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

  if (confirm !== null && confirm !== password) errors.confirmPassword = "Passwords don't match.";

  return { ok: Object.keys(errors).length === 0, email, password, errors };
}

/**
 * Dead-simple in-memory fixed-window attempt counter.
 *
 * The repo had no rate-limiting mechanism of any kind (grepped 2026-07-23), so
 * this is a new, deliberately minimal one: a Map in the server process, no
 * dependency, no persistence. It resets on restart — acceptable, because it is
 * defence in depth behind the real gate (registration requires either a
 * zero-user install or an authenticated caller), not the gate itself.
 */
function createAttemptThrottle({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  const fresh = (entry, now) => entry && now - entry.first <= windowMs;

  return {
    /** Does NOT count the attempt — call record() for that. */
    check(key) {
      const now = Date.now();
      for (const [k, v] of hits) if (!fresh(v, now)) hits.delete(k);
      const entry = hits.get(key);
      if (!fresh(entry, now)) return { allowed: true, remaining: max };
      if (entry.count >= max) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - entry.first)) / 1000)) };
      }
      return { allowed: true, remaining: max - entry.count };
    },
    record(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!fresh(entry, now)) hits.set(key, { first: now, count: 1 });
      else entry.count += 1;
    },
    reset() {
      hits.clear();
    },
  };
}

module.exports = {
  COOKIE_NAME,
  MIN_PASSWORD_LENGTH,
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
};
