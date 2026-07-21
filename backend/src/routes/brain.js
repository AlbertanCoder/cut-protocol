const express = require("express");
const { requireAuth } = require("../lib/auth.js");
const { isBrainEnabled } = require("../lib/brain/llm.js");
const { brainChat } = require("../lib/brain/chat.js");

const router = express.Router();
router.use(requireAuth);

// The frontend calls this to decide whether to render the chat bar AT ALL — with
// the brain off, the bar is never shown, so the app is byte-identical to today.
router.get("/status", (req, res) => res.json({ enabled: isBrainEnabled() }));

// POST /api/brain/chat { message, depth? } -> { available, refused?, reply? }
router.post("/chat", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const depth = ["fast", "balanced", "thorough"].includes(req.body?.depth) ? req.body.depth : "balanced";
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    if (!message) return res.status(400).json({ error: "message is required" });
    if (message.length > 500) return res.status(400).json({ error: "message too long (max 500 characters)" });
    res.json(await brainChat({ userId: req.userId, message, depth, history }));
  } catch (e) {
    res.status(e.status || 500).json({ error: "chat failed" });
  }
});

module.exports = router;
