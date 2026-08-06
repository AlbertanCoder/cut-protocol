// Premium entitlement (saas-launch Stage 2).
//
// One question, answered from the Subscription row that Lemon Squeezy
// webhooks will maintain (Stage 3 — until then scripts/flipPremium.mjs is
// the only writer): does this user get portion-solved output right now?
//
// Entitlement is DERIVED at read time, never stored:
//   active | on_trial               -> premium
//   cancelled + endsAt in future    -> premium (the period already paid for)
//   past_due  + graceUntil future   -> premium (7-day payment-retry window)
//   anything else                   -> free
//
// DESKTOP INSTALLS ARE NEVER PAYWALLED. With SUPABASE_URL unset (every
// desktop/local install) requirePremium is a pass-through and getEntitlement
// answers premium — the paywall is a property of the hosted web product,
// not of the app itself.

const { isSupabaseAuthEnabled } = require("./supabaseAuth.js");

/** Pure rule — exported for tests and for scripts/flipPremium.mjs to echo. */
function isEntitled(sub, now = new Date()) {
  if (!sub) return false;
  if (sub.status === "active" || sub.status === "on_trial") return true;
  if (sub.status === "cancelled") return !!sub.endsAt && sub.endsAt > now;
  if (sub.status === "past_due") return !!sub.graceUntil && sub.graceUntil > now;
  return false;
}

/**
 * Entitlement summary for a user — what /api/auth/me ships to the frontend.
 * Dates ride along so the UI can say "Premium until Aug 20" honestly instead
 * of a bare boolean.
 */
async function getEntitlement(userId) {
  if (!isSupabaseAuthEnabled()) {
    return { premium: true, status: "local", plan: null, endsAt: null, graceUntil: null };
  }
  const { prisma } = require("./prisma.js");
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return {
    premium: isEntitled(sub),
    status: sub?.status || "none",
    plan: sub?.plan || null,
    endsAt: sub?.endsAt || null,
    graceUntil: sub?.graceUntil || null,
  };
}

/**
 * The server-side gate. Mount AFTER requireAuth (needs req.userId).
 *
 * 403 with code "premium_required" — the frontend keys on the code (see
 * api.js isPremiumRequired), never on the sentence, so the copy can change
 * without breaking the lock UI. 403 and not 401 on purpose: the session is
 * fine, the plan isn't — a 401 here would sign the user out.
 */
async function requirePremium(req, res, next) {
  const ent = await getEntitlement(req.userId);
  if (ent.premium) return next();
  res.status(403).json({
    error: "This is a Premium feature — portion-solved meal plans with exact portions and grocery quantities.",
    code: "premium_required",
  });
}

module.exports = { isEntitled, getEntitlement, requirePremium };
