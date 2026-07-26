const express = require("express");
const { requireAuth, createAttemptThrottle } = require("../lib/auth.js");
// isBrainEnabled is no longer read directly here — relayStatus() wraps it so
// the route reports WHY it is off, not just that it is. Still the same single
// gate underneath; this file just stopped asking it the narrower question.
const { brainChat } = require("../lib/brain/chat.js");
const { MAX_HISTORY } = require("../lib/brain/historyGuard.js");
const {
  status: relayStatus, writeConfig, clearConfig, probeRelay,
} = require("../lib/brainRelayConfig.js");

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
//
// `reason` says WHY it is off. Until now a disabled brain and a broken one were
// indistinguishable from outside the process, which is exactly the ambiguity
// that costs hours when something is misconfigured. Reasons are stable strings
// (ok | no-config | incomplete-config | off | relay-unreachable) and never
// include the relay URL or any part of the token.
//
// ?probe=1 additionally pings the relay's /healthz. It is OPT-IN because
// BrainChat polls this endpoint on mount, and putting a network round-trip in
// that path would make the chat bar's appearance hostage to relay latency. Only
// the Settings screen's explicit "check connection" asks for it.
router.get("/status", async (req, res) => {
  const base = relayStatus();
  if (req.query.probe !== "1" || !base.enabled) return res.json(base);
  const probe = await probeRelay();
  if (probe.reachable) return res.json({ ...base, relayReachable: true });
  return res.json({ enabled: true, reason: "relay-unreachable", relayReachable: false });
});

// POST /api/brain/config { relayUrl, relayToken } -> { enabled, reason }
// Writes <userData>/brain.json. The token is accepted here and NEVER returned
// by any endpoint afterwards — there is no read path for it, deliberately, so
// a compromised renderer cannot exfiltrate it through the API it already has.
router.post("/config", (req, res) => {
  try {
    const { relayUrl, relayToken } = req.body || {};
    writeConfig({ relayUrl, relayToken });
    return res.json(relayStatus());
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.status ? e.message : "could not save relay settings" });
  }
});

// DELETE /api/brain/config -> the kill switch, from inside the app.
// Deletes the file and clears the live environment, so it takes effect on the
// next message rather than the next restart.
router.delete("/config", (req, res) => {
  clearConfig();
  return res.json(relayStatus());
});

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
