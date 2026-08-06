// Supabase Auth verification for the web deployment (saas-launch).
//
// The desktop app never sets SUPABASE_URL, so this module is inert there:
// requireAuth consults it only when a request carries a Bearer token AND
// Supabase is configured. Tokens are verified LOCALLY — asymmetric signing
// keys via the project's JWKS endpoint (fetched and cached by jose), or the
// legacy shared HS256 secret when SUPABASE_JWT_SECRET is set. Neither path
// calls Supabase per-request.
//
// jose is ESM-only and this backend is CommonJS, so it is loaded via dynamic
// import once and cached. Node 20 cannot require() an ES module.

let joseModulePromise = null;
function jose() {
  return (joseModulePromise ||= import("jose"));
}

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function isSupabaseAuthEnabled() {
  return !!supabaseUrl();
}

// createRemoteJWKSet caches keys and re-fetches on rotation; keep ONE
// instance per configured URL so that cache actually gets to work.
let cachedJwks = null;
let cachedJwksUrl = null;
async function remoteJwks() {
  const base = supabaseUrl();
  if (!cachedJwks || cachedJwksUrl !== base) {
    const { createRemoteJWKSet } = await jose();
    cachedJwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    cachedJwksUrl = base;
  }
  return cachedJwks;
}

// "This token is bad" and "we could not check the token" are DIFFERENT
// failures (the same taxonomy rule as resolveSession in auth.js): a bad token
// is a 401, an unreachable JWKS endpoint or a DB error is a 500. Only jose
// errors that positively reject the token map to null.
const TOKEN_REJECTION_CODES = new Set([
  "ERR_JWT_EXPIRED",
  "ERR_JWT_INVALID",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWKS_NO_MATCHING_KEY",
]);
function isTokenRejection(e) {
  return !!(e && typeof e.code === "string" && TOKEN_REJECTION_CODES.has(e.code));
}

/**
 * Verify a Supabase access token and return its payload, or throw.
 * Deterministic key source: SUPABASE_JWT_SECRET (legacy HS256) when set,
 * otherwise the project's JWKS (current asymmetric signing keys).
 */
async function verifySupabaseToken(token) {
  const { jwtVerify } = await jose();
  const options = {
    issuer: `${supabaseUrl()}/auth/v1`,
    audience: "authenticated",
  };
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), options);
    return payload;
  }
  const { payload } = await jwtVerify(token, await remoteJwks(), options);
  return payload;
}

/**
 * Full session resolution for a Bearer token: verify, then map the Supabase
 * identity (`sub`) to a LOCAL User row so req.userId keeps meaning what it
 * has always meant — every existing route and query scoping is untouched.
 *
 * First sight of a Supabase identity:
 *   1. match by supabaseUserId — the normal case after the first request;
 *   2. else match by email and LINK (set supabaseUserId). Google is the only
 *      enabled provider and Google emails arrive verified, so an email match
 *      is the owner of that account signing in a new way — this is what lets
 *      an existing local account claim its data via Google;
 *   3. else create a fresh User. First user on an empty install is "admin",
 *      mirroring /register's first-run rule.
 *
 * Returns { userId } or null (bad token). Database errors propagate — a DB
 * hiccup must never read as "signed out".
 */
async function resolveSupabaseSession(token) {
  let payload;
  try {
    payload = await verifySupabaseToken(token);
  } catch (e) {
    if (isTokenRejection(e)) return null;
    throw e;
  }
  const sub = typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  if (!sub) return null;

  const { prisma } = require("./prisma.js");

  const bySub = await prisma.user.findUnique({
    where: { supabaseUserId: sub },
    select: { id: true },
  });
  if (bySub) return { userId: bySub.id };

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";

  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (byEmail) {
      await prisma.user.update({ where: { id: byEmail.id }, data: { supabaseUserId: sub } });
      return { userId: byEmail.id };
    }
  } else {
    // No email claim = nothing to link by and no unique email to create with.
    // Should not happen with Google; fail closed rather than invent identity.
    return null;
  }

  const existingUsers = await prisma.user.count();
  try {
    const created = await prisma.user.create({
      data: {
        email,
        supabaseUserId: sub,
        role: existingUsers === 0 ? "admin" : "user",
      },
      select: { id: true },
    });
    return { userId: created.id };
  } catch (e) {
    // Unique-constraint race: two concurrent first requests from the same new
    // sign-in. Whoever lost the race finds the winner's row.
    if (e.code === "P2002") {
      const winner = await prisma.user.findFirst({
        where: { OR: [{ supabaseUserId: sub }, { email }] },
        select: { id: true },
      });
      if (winner) return { userId: winner.id };
    }
    throw e;
  }
}

module.exports = {
  isSupabaseAuthEnabled,
  verifySupabaseToken,
  resolveSupabaseSession,
};
