const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");
const { isBillingConfigured, createCheckout } = require("../lib/lemonSqueezy.js");

const router = express.Router();
router.use(requireAuth);

// POST /api/billing/checkout { period: "monthly" | "annual" } -> { url }
//
// Creates a Lemon Squeezy hosted checkout for the signed-in user with their
// user id embedded in checkout custom data (the webhook's account link) and
// their email prefilled. The frontend redirects to the returned URL; after
// payment LS sends the buyer back to /?upgraded=1.
router.post("/checkout", async (req, res) => {
  const period = req.body?.period;
  // "penny" is the Stage 6 self-test path: valid ONLY while the hidden
  // penny variant is configured, so it cannot linger as a live discount.
  const pennyEnabled = !!process.env.LEMONSQUEEZY_VARIANT_PENNY;
  const valid = period === "monthly" || period === "annual" || (period === "penny" && pennyEnabled);
  if (!valid) {
    return res.status(400).json({ error: "period must be 'monthly' or 'annual'" });
  }
  if (!isBillingConfigured()) {
    // Honest and specific: this fires until the LS dashboard values land in
    // .env. 503 (not 500) — the request was fine, the service isn't ready.
    return res.status(503).json({ error: "Payments aren't set up on this server yet." });
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true } });
  if (!user) return res.status(401).json({ error: "Your sign-in has expired — sign in again." });

  const url = await createCheckout({
    userId: user.id,
    email: user.email,
    period,
    origin: req.get("origin"),
  });
  res.json({ url });
});

module.exports = router;
