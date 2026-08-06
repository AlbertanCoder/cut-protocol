// Lemon Squeezy integration (saas-launch Stage 3) — checkout creation and
// webhook processing. Everything here was written against the CURRENT docs
// (verified 2026-08-06): signature = HMAC-SHA256 hex over the RAW request
// body in the `X-Signature` header; events carry `meta.event_name` and (for
// order/subscription events) `meta.custom_data`; checkout creation is
// JSON:API `POST /v1/checkouts` with `checkout_data.custom` for our user id.
//
// LS subscription statuses: on_trial | active | paused | past_due | unpaid |
// cancelled | expired. We store them as received; entitlement.js derives
// access (cancelled keeps premium until endsAt, past_due until graceUntil —
// LS's own semantics line up with the locked business rules). Two statuses
// are ours, not LS's: "none" (no purchase yet) and "refunded" (revoked now).

const crypto = require("crypto");

const LS_API = "https://api.lemonsqueezy.com/v1";

// The 7-day grace window is OUR business rule (locked): LS itself retries for
// up to ~2 weeks, but this account downgrades 7 days after a failed payment
// unless a retry succeeds first (payment_success/recovered clears the clock).
const GRACE_DAYS = 7;

function cfg() {
  return {
    apiKey: process.env.LEMONSQUEEZY_API_KEY || "",
    storeId: process.env.LEMONSQUEEZY_STORE_ID || "",
    webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "",
    variantMonthly: process.env.LEMONSQUEEZY_VARIANT_MONTHLY || "",
    variantAnnual: process.env.LEMONSQUEEZY_VARIANT_ANNUAL || "",
    // Stage 6 only: the hidden penny-test variant. Buying it MUST go through
    // our checkout endpoint (period "penny") so user_id custom data rides
    // along and the webhook can flip the right account — a bare LS checkout
    // link carries no custom data and proves nothing about the pipeline.
    variantPenny: process.env.LEMONSQUEEZY_VARIANT_PENNY || "",
  };
}

function isBillingConfigured() {
  const c = cfg();
  return !!(c.apiKey && c.storeId && c.variantMonthly && c.variantAnnual);
}

/**
 * Verify the X-Signature header against the raw body. Timing-safe, length
 * guard first (timingSafeEqual throws on length mismatch). Returns boolean —
 * the route turns false into a 401 and never says which part failed.
 */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || !Buffer.isBuffer(rawBody) || typeof signatureHeader !== "string" || !signatureHeader) return false;
  const digest = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
  const signature = Buffer.from(signatureHeader, "utf8");
  return digest.length === signature.length && crypto.timingSafeEqual(digest, signature);
}

/**
 * Create a hosted checkout for the signed-in user and return its URL.
 * The user id rides in checkout_data.custom and comes back on every webhook
 * as meta.custom_data.user_id — that is the whole account-linking mechanism.
 * Email prefill keeps the LS customer tied to the Google account's address.
 */
async function createCheckout({ userId, email, period, origin }) {
  const c = cfg();
  const variantId =
    period === "annual" ? c.variantAnnual : period === "penny" ? c.variantPenny : c.variantMonthly;
  const redirectBase = process.env.APP_URL || origin || "http://localhost:5173";

  const res = await fetch(`${LS_API}/checkouts`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${c.apiKey}`,
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: email || undefined,
            custom: { user_id: userId },
          },
          product_options: {
            redirect_url: `${redirectBase}/?upgraded=1`,
          },
        },
        relationships: {
          store: { data: { type: "stores", id: String(c.storeId) } },
          variant: { data: { type: "variants", id: String(variantId) } },
        },
      },
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail || `HTTP ${res.status}`;
    const err = new Error(`Lemon Squeezy checkout failed: ${detail}`);
    err.status = 502;
    throw err;
  }
  const url = body?.data?.attributes?.url;
  if (!url) {
    const err = new Error("Lemon Squeezy answered without a checkout URL");
    err.status = 502;
    throw err;
  }
  return url;
}

const asDate = (v) => (v ? new Date(v) : null);

function planFromVariant(variantId, variantName) {
  const c = cfg();
  const id = variantId == null ? "" : String(variantId);
  if (id && id === String(c.variantMonthly)) return "monthly";
  if (id && id === String(c.variantAnnual)) return "annual";
  const name = String(variantName || "").toLowerCase();
  if (name.includes("year") || name.includes("annual")) return "annual";
  if (name.includes("month")) return "monthly";
  return null;
}

// Events whose payload IS the subscription object — synced wholesale.
// subscription_updated is LS's own recommended catch-all; the others are
// listed so a deployment that subscribes to them individually behaves
// identically. Payment events carry a subscription-INVOICE payload instead
// and are handled separately below.
const SUBSCRIPTION_SYNC_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
]);

/**
 * Apply one verified webhook event to the Subscription table. Idempotent by
 * construction: every branch is a state SET derived from the event, so a
 * replayed event writes the same row again. Returns {action, userId?} for
 * the route's log line; unresolvable events return {action:"ignored", why}
 * rather than throwing — LS retries non-2xx, and a replay cannot fix an
 * event we cannot map, so those are acknowledged and logged loudly instead.
 */
async function applyWebhookEvent(eventName, payload) {
  const { prisma } = require("./prisma.js");
  const custom = payload?.meta?.custom_data || {};
  const data = payload?.data || {};
  const attrs = data.attributes || {};

  const findByCustomUser = async () => {
    const userId = typeof custom.user_id === "string" && custom.user_id ? custom.user_id : null;
    if (!userId) return null;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    return user ? user.id : null;
  };

  if (SUBSCRIPTION_SYNC_EVENTS.has(eventName)) {
    const lsSubscriptionId = String(data.id || "");
    let userId = await findByCustomUser();
    if (!userId && lsSubscriptionId) {
      const existing = await prisma.subscription.findUnique({
        where: { lsSubscriptionId },
        select: { userId: true },
      });
      userId = existing?.userId || null;
    }
    if (!userId) return { action: "ignored", why: `no user resolvable for ${eventName} sub=${lsSubscriptionId}` };

    const status = typeof attrs.status === "string" && attrs.status ? attrs.status : "active";
    // The grace clock runs from the FIRST failure: a repeat past_due event
    // (another failed retry, or the updated event that rides along) must not
    // restart the 7 days — that would stretch the window for as long as LS
    // keeps retrying. Not past_due => any old clock is stale, clear it.
    const current = await prisma.subscription.findUnique({
      where: { userId },
      select: { status: true, graceUntil: true },
    });
    const graceUntil =
      status !== "past_due"
        ? null
        : current?.status === "past_due" && current.graceUntil
          ? current.graceUntil
          : new Date(Date.now() + GRACE_DAYS * 864e5);
    const sync = {
      status,
      plan: planFromVariant(attrs.variant_id, attrs.variant_name),
      renewsAt: asDate(attrs.renews_at),
      endsAt: asDate(attrs.ends_at),
      lsCustomerId: attrs.customer_id != null ? String(attrs.customer_id) : undefined,
      lsSubscriptionId: lsSubscriptionId || undefined,
      graceUntil,
    };
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, ...sync },
      update: sync,
    });
    return { action: `synced ${status}`, userId };
  }

  if (eventName === "subscription_payment_failed") {
    // Payload is a subscription-invoice; the subscription id lives in attrs.
    const lsSubscriptionId = String(attrs.subscription_id || "");
    const bySub = lsSubscriptionId
      ? await prisma.subscription.findUnique({ where: { lsSubscriptionId }, select: { userId: true } })
      : null;
    const userId = bySub?.userId || (await findByCustomUser());
    if (!userId) return { action: "ignored", why: `payment_failed for unknown sub=${lsSubscriptionId}` };
    const current = await prisma.subscription.findUnique({
      where: { userId },
      select: { status: true, graceUntil: true },
    });
    // First failure starts the 7-day clock; repeat failures do NOT restart it
    // (see the sync branch above for why). Upsert, not update: a failure
    // arriving before any other event still fails closed into past_due.
    const graceUntil =
      current?.status === "past_due" && current.graceUntil
        ? current.graceUntil
        : new Date(Date.now() + GRACE_DAYS * 864e5);
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, status: "past_due", graceUntil, lsSubscriptionId: lsSubscriptionId || undefined },
      update: { status: "past_due", graceUntil },
    });
    return { action: "past_due, grace running", userId };
  }

  if (eventName === "subscription_payment_success" || eventName === "subscription_payment_recovered") {
    const lsSubscriptionId = String(attrs.subscription_id || "");
    const bySub = lsSubscriptionId
      ? await prisma.subscription.findUnique({ where: { lsSubscriptionId }, select: { userId: true, status: true } })
      : null;
    const userId = bySub?.userId || (await findByCustomUser());
    // First payment can land before subscription_created builds the row —
    // nothing to clear yet; the created/updated sync carries the real state.
    if (!userId || !bySub) return { action: "ignored", why: `payment ok for unknown sub=${lsSubscriptionId} (created event will sync)` };
    await prisma.subscription.update({
      where: { userId },
      data: { graceUntil: null, ...(bySub.status === "past_due" ? { status: "active" } : null) },
    });
    return { action: "payment ok, grace cleared", userId };
  }

  if (eventName === "order_refunded") {
    // Locked rule: refund/chargeback revokes immediately.
    let userId = await findByCustomUser();
    if (!userId && attrs.customer_id != null) {
      const row = await prisma.subscription.findFirst({
        where: { lsCustomerId: String(attrs.customer_id) },
        select: { userId: true },
      });
      userId = row?.userId || null;
    }
    if (!userId) return { action: "ignored", why: "refund for unknown customer" };
    await prisma.subscription.upsert({
      where: { userId },
      create: { userId, status: "refunded", renewsAt: null, endsAt: null, graceUntil: null },
      update: { status: "refunded", renewsAt: null, endsAt: null, graceUntil: null },
    });
    return { action: "refunded — premium revoked", userId };
  }

  // order_created and anything LS adds later: acknowledged, logged, no-op.
  return { action: "ignored", why: `unhandled event ${eventName}` };
}

module.exports = {
  isBillingConfigured,
  verifyWebhookSignature,
  createCheckout,
  applyWebhookEvent,
  planFromVariant,
};
