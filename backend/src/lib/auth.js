const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const COOKIE_NAME = "cutprotocol_session";
const TOKEN_TTL = "30d";

// The ONE algorithm this app's sessions are ever signed or verified with.
//
// jsonwebtoken 9 with a string secret already refuses `alg: none` and refuses
// asymmetric algs, so pinning this is NOT closing a live hole today — it is a
// tripwire for tomorrow. The moment someone swaps requireSecret() for a public
// key (multi-device sync, a real server), an unpinned verify would accept a
// token signed with that PUBLIC key as HS256 — the classic algorithm-confusion
// takeover. Pinning here means that refactor fails loudly instead of silently
// minting an admin session for anyone who can read the public key.
const SESSION_ALGORITHM = "HS256";

// ── one fact, one sentence ───────────────────────────────────────────────────
// These used to be three different strings ("not authenticated", "invalid or
// expired session", "session expired") and two casings of "invalid credentials"
// for two facts. The user does not care which of the three internal branches
// fired, and the login message reaches the screen raw whenever the client can't
// special-case it — so both facts get exactly one sentence, written for a person.
const SESSION_EXPIRED_MESSAGE = "Your sign-in has expired — sign in again.";
const BAD_CREDENTIALS_MESSAGE = "Wrong email or password.";

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

/**
 * A short, ONE-WAY fingerprint of the stored password hash — the "password
 * epoch" a session is pinned to.
 *
 * WHY THIS EXISTS (the 30-day-stolen-cookie hole): a JWT is stateless, so
 * changing a password could not invalidate a session that was already issued.
 * TOKEN_TTL is 30 days, so a stolen cookie kept working for a month AFTER the
 * victim reset their password — which defeats the entire reason a person resets
 * a password. Killing it needs per-user state that changes on reset, and the
 * schema already has exactly one such column: passwordHash. bcrypt salts every
 * hash, so even resetting to the SAME password produces a new hash, a new
 * epoch, and a dead cookie.
 *
 * It is a truncated SHA-256, never the hash itself: a JWT payload is base64,
 * not encryption, so anything put in a claim is readable by whoever holds the
 * cookie. 64 bits is far more than enough to detect a change; it is not a
 * secret to be brute-forced, it is a version tag to be compared.
 */
function passwordEpoch(passwordHash) {
  return crypto.createHash("sha256").update(String(passwordHash), "utf8").digest("hex").slice(0, 16);
}

/** Length-safe constant-time compare for two short ASCII tags. */
function tagsMatch(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Issue a session for `userId`, pinned to the password hash it was issued
 * under. The hash is REQUIRED — a caller that doesn't have it doesn't know
 * which password epoch it is minting a session for, and a session with no
 * epoch is exactly the un-revocable token this whole mechanism removes.
 */
function signToken(userId, passwordHash) {
  if (typeof passwordHash !== "string" || !passwordHash) {
    throw new Error("signToken(userId, passwordHash): the current password hash is required to pin the session");
  }
  return jwt.sign({ sub: userId, pwe: passwordEpoch(passwordHash) }, requireSecret(), {
    algorithm: SESSION_ALGORITHM,
    expiresIn: TOKEN_TTL,
  });
}

/**
 * Verify a session token's SIGNATURE and expiry. Throws on anything that is not
 * a live token signed by this install's secret with this install's algorithm.
 *
 * Exported deliberately. It used to be private, reachable only through
 * requireAuth — which meant the only tests that could touch it went through a
 * route, and every one of those routes has a downstream check (does this user
 * exist?) that returns the same rejection status. A mutation that replaced
 * jwt.verify with jwt.decode — i.e. deleted signature checking entirely —
 * therefore passed the whole suite, because the forged-cookie test named a user
 * that never existed and was being rejected by the user-existence check, not by
 * cryptography. Direct tests on this function are what make that impossible.
 */
function verifyToken(token) {
  return jwt.verify(token, requireSecret(), { algorithms: [SESSION_ALGORITHM] });
}

/**
 * Full session resolution: signature + expiry (verifyToken) AND the password
 * epoch the token was pinned to (see passwordEpoch). Returns { userId } or null.
 *
 * A database error is NOT swallowed — it propagates. "The server hit an error"
 * and "you are signed out" are different failures, and turning the first into
 * the second would sign a user out every time SQLite hiccups. Only a genuinely
 * bad, stale, or superseded token returns null.
 */
async function resolveSession(token) {
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return null; // bad signature, wrong alg, expired, malformed
  }
  const userId = payload?.sub;
  if (typeof userId !== "string" || !userId) return null;
  // No epoch claim = a token minted before sessions were revocable, or one an
  // attacker stripped the claim out of. Fail closed either way.
  if (typeof payload.pwe !== "string" || !payload.pwe) return null;

  // Required lazily so the pure helpers in this module (validateRegistration,
  // createAttemptThrottle, …) stay importable without a configured database.
  const { prisma } = require("./prisma.js");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) return null; // deleted account, restored DB, cookie from another install
  if (!tagsMatch(payload.pwe, passwordEpoch(user.passwordHash))) return null; // password changed since
  return { userId };
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

async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: SESSION_EXPIRED_MESSAGE });
  const session = await resolveSession(token);
  if (!session) {
    // Clearing the dead cookie is the other half of the answer. Without it the
    // browser replays the same rejected token on every subsequent request and
    // every boot, forever — the cookie is scoped to the HOST, not the port or
    // the database, and its TTL is 30 days, so it never times itself out.
    clearSessionCookie(res);
    return res.status(401).json({ error: SESSION_EXPIRED_MESSAGE });
  }
  req.userId = session.userId;
  next();
}

// Same session mechanism as requireAuth, but a missing/expired/garbage cookie
// is not an error — it just leaves req.userId undefined. /register needs this:
// the route is reachable both by a brand-new install (nobody is signed in) and
// by the existing owner adding a second local profile, and it must be able to
// tell those apart without 401-ing the first case.
async function optionalAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const session = await resolveSession(token);
    if (session) req.userId = session.userId;
    // else: fall through unauthenticated
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
    /**
     * Clear ONE caller's budget — used after a successful login so a user who
     * mistypes then succeeds doesn't carry the failures. Deliberately separate
     * from reset(): reset() empties the whole map, so calling it on success
     * would let any one successful login anywhere wipe an attacker's counter
     * against a different account. That is the throttle defeating itself.
     */
    clear(key) {
      hits.delete(key);
    },
    /** Empties every counter. Test/harness seam only — never call it per-request. */
    reset() {
      hits.clear();
    },
  };
}

module.exports = {
  COOKIE_NAME,
  MIN_PASSWORD_LENGTH,
  SESSION_ALGORITHM,
  SESSION_EXPIRED_MESSAGE,
  BAD_CREDENTIALS_MESSAGE,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  passwordEpoch,
  resolveSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  optionalAuth,
  normalizeEmail,
  validateRegistration,
  createAttemptThrottle,
};
