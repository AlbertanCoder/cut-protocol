// safetyEvents.js — the local, private ledger of safety-rail events (§8.4),
// and the once-per-pattern check-in trigger (§8.3).
//
// Before this file, a floor-clamp attempt or a rate refusal left NO
// structured record anywhere (AUDIT §3.8) — the §8.3 trigger had nothing to
// count. Storage is an append-only JSONL file on the user's own disk
// (backend/data/safety-events.jsonl, gitignored): local, private, no
// analytics, no server table, trivially deletable — the same posture as the
// SCOFF result in localStorage.
//
// The trigger: two floor-breach attempts, or two pushes past the rate cap,
// within a 30-day window since the last check-in — then ONE respectful
// check-in rides along on the refusal payload. Marking happens at the
// moment of inclusion, so it can never nag-loop. Event writes must never
// break the route that logs them: every disk failure degrades to a warn.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TRIGGER_TYPES = new Set(["floor-breach-attempt", "rate-cap-push"]);
const TRIGGER_COUNT = 2;
const WINDOW_DAYS = 30;

// Overridable for tests and harnesses (runTests.mjs points the whole suite
// at a temp file so route tests never write into the owner's real ledger).
let storePath = process.env.CUT_SAFETY_EVENTS_PATH ||
  path.join(__dirname, "..", "..", "data", "safety-events.jsonl");
let warned = false;

function _setStorePath(p) { storePath = p; }

function readAll() {
  try {
    if (!fs.existsSync(storePath)) return [];
    return fs.readFileSync(storePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function record(userId, type, detail = {}, now = Date.now()) {
  try {
    fs.appendFileSync(storePath, JSON.stringify({ userId, type, at: now, ...detail }) + "\n");
  } catch (e) {
    if (!warned) { console.warn(`[safety-events] cannot write ${storePath}: ${e.message}`); warned = true; }
  }
}

function eventsFor(userId, now = Date.now()) {
  const since = now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return readAll().filter((e) => e.userId === userId && e.at >= since);
}

/**
 * checkInFor(userId) — returns the check-in payload ONCE when the pattern
 * trips, null otherwise. Calling it marks the check-in as shown (the caller
 * includes it in the response it is about to send). The counters restart
 * from the mark, so the check-in appears once per PATTERN, never per event.
 */
function checkInFor(userId, now = Date.now()) {
  const events = eventsFor(userId, now);
  // Once per pattern PER WINDOW. The first cut restarted the counters at
  // each mark, which re-fired every TRIGGER_COUNT attempts — the P7 storm
  // measured 60 check-ins in 120 refusals, a textbook nag loop. A shown
  // check-in of a kind silences that kind for the whole window.
  const shownKinds = new Set(events.filter((e) => e.type === "check-in-shown").map((e) => e.kind));
  const counts = {};
  for (const e of events) {
    if (!TRIGGER_TYPES.has(e.type)) continue;
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  const kind = counts["floor-breach-attempt"] >= TRIGGER_COUNT && !shownKinds.has("pattern-floor") ? "pattern-floor"
    : counts["rate-cap-push"] >= TRIGGER_COUNT && !shownKinds.has("pattern-rate") ? "pattern-rate"
    : null;
  if (!kind) return null;
  record(userId, "check-in-shown", { kind }, now);
  return {
    due: true,
    kind,
    // Plainly worded, no shame, per §8.3. The client renders the relocated
    // questionnaire content and the support resources with this framing, and
    // always offers "continue at the capped values".
    note: "You've hit this limit a couple of times. Quick honest check-in — no judgment, and you can carry on at the capped values either way.",
  };
}

module.exports = { record, eventsFor, checkInFor, _setStorePath, TRIGGER_COUNT, WINDOW_DAYS };
