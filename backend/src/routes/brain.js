const express = require("express");
const { requireAuth, createAttemptThrottle } = require("../lib/auth.js");
const { isBrainEnabled } = require("../lib/brain/llm.js");
const { brainChat } = require("../lib/brain/chat.js");
const { MAX_HISTORY } = require("../lib/brain/historyGuard.js");

const router = express.Router();
router.use(requireAuth);

// ── Rate limit ───────────────────────────────────────────────────────────────
// There was NO rate limiting anywhere in src/ except the login throttle, and the
// chat route is the one authenticated endpoint that spends money per call. The
// per-user cost cap ($1/day) bounds the bill, but it does not bound the RATE:
// nothing stopped a script from emptying that cap in seconds, and every denial
// still costs a DB round-trip. Reusing the login throttle's mechanism rather
// than inventing a second one — same Map-in-process, no dependency, resets on
// restart. It is defence in depth in front of the cost cap, not the cap itself.
//
// 20 turns / 5 minutes is generous for a human typing questions (one every 15
// seconds, sustained) and useless for a loop.
const CHAT_RATE = { max: Number(process.env.BRAIN_CHAT_RATE_MAX) > 0 ? Number(process.env.BRAIN_CHAT_RATE_MAX) : 20, windowMs: 5 * 60 * 1000 };
const chatThrottle = createAttemptThrottle(CHAT_RATE);

// The frontend calls this to decide whether to render the chat bar AT ALL — with
// the brain off, the bar is never shown, so the app is byte-identical to today.
router.get("/status", (req, res) => res.json({ enabled: isBrainEnabled() }));

// POST /api/brain/chat { message, depth?, history? } -> { available, refused?, reply?, replyToken? }
router.post("/chat", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const depth = ["fast", "balanced", "thorough"].includes(req.body?.depth) ? req.body.depth : "balanced";
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    if (!message) return res.status(400).json({ error: "message is required" });
    if (message.length > 500) return res.status(400).json({ error: "message too long (max 500 characters)" });
    // Bound the array BEFORE it reaches the guard. sanitizeHistory keeps only
    // the last MAX_HISTORY entries, but it has to walk the whole array to get
    // there — a 10,000-entry body would be free CPU for the sender. Anything
    // over a small multiple of the cap is not a client we wrote.
    if (history.length > MAX_HISTORY * 4) return res.status(400).json({ error: "history too long" });

    // Throttle is keyed on the authenticated user, not the IP: the cost this
    // protects is per-account, and requireAuth already ran.
    const key = `chat:${req.userId}`;
    const gate = chatThrottle.check(key);
    if (!gate.allowed) {
      res.set("Retry-After", String(gate.retryAfterSec));
      return res.status(429).json({ error: "Too many messages — give the coach a moment.", retryAfterSec: gate.retryAfterSec });
    }
    chatThrottle.record(key);

    res.json(await brainChat({ userId: req.userId, message, depth, history }));
  } catch (e) {
    res.status(e.status || 500).json({ error: "chat failed" });
  }
});

module.exports = router;
// Test seam only — lets a suite reset the in-process counter between cases.
module.exports.__chatThrottle = chatThrottle;
