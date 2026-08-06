const express = require("express");
const { verifyWebhookSignature, applyWebhookEvent } = require("../lib/lemonSqueezy.js");

const router = express.Router();

// POST /api/webhooks/lemonsqueezy — Lemon Squeezy's only entry point.
//
// NO session auth on purpose: the HMAC signature IS the authentication.
// server.js mounts express.raw() on this path ahead of the global JSON
// parser, so req.body is the raw Buffer the signature was computed over —
// verify FIRST, parse second, process third. Anything unverified is a 401
// that reveals nothing about why.
router.post("/", async (req, res) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed and say so server-side: a webhook endpoint with no secret
    // configured must reject everything, loudly, rather than trust anything.
    console.error("[ls-webhook] LEMONSQUEEZY_WEBHOOK_SECRET is not set — rejecting event");
    return res.status(503).json({ error: "webhook not configured" });
  }
  if (!Buffer.isBuffer(req.body)) {
    // The raw mount in server.js is missing/reordered — a deploy bug, not a
    // caller bug. Refuse rather than verify against a re-serialized body.
    console.error("[ls-webhook] raw body missing — express.raw mount must precede express.json");
    return res.status(500).json({ error: "server misconfiguration" });
  }
  if (!verifyWebhookSignature(req.body, req.get("X-Signature") || "", secret)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "invalid JSON" });
  }
  const eventName = payload?.meta?.event_name;
  if (typeof eventName !== "string" || !eventName) {
    return res.status(400).json({ error: "missing meta.event_name" });
  }

  const result = await applyWebhookEvent(eventName, payload);
  // Every event is logged — verified events are billing history.
  console.log(`[ls-webhook] ${eventName}: ${result.action}${result.userId ? ` user=${result.userId}` : ""}${result.why ? ` (${result.why})` : ""}`);
  res.json({ ok: true });
});

module.exports = router;
