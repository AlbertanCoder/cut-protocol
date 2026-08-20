// safetyRails.js — the directive's §8.2 rate discipline, additively.
//
// The shipped rules stay exactly as they are: a fixed rate menu, and >1.0%
// of bodyweight per week (or a floored target) requiring an explicit
// acknowledgement (422, ack:"rate"). This module adds the one rule the app
// never had: an ABSOLUTE cap. Above 1.5% of bodyweight per week there is no
// acknowledgement path — the request is refused (400), the same shape as the
// goal-weight hard floor. A menu rate of 2.0 lb/wk is 1% on a 200 lb body
// and 2% on a 100 lb body; the menu alone cannot express this rule.

"use strict";

const RATE_ACK_PCT = 1.0;  // above this, explicit confirmation (shipped rule)
const RATE_ABS_CAP_PCT = 1.5; // above this, refusal — no override exists

// pctOfBw: the rate as % of bodyweight per week (rateSafety computes it).
function classifyRatePct(pctOfBw) {
  if (!Number.isFinite(pctOfBw)) return "ok";
  if (pctOfBw > RATE_ABS_CAP_PCT) return "refused";
  if (pctOfBw > RATE_ACK_PCT) return "needs-ack";
  return "ok";
}

function absoluteCapRefusal(pctOfBw) {
  const msg =
    `${pctOfBw.toFixed(2)}% of your body weight per week is past the ${RATE_ABS_CAP_PCT}% absolute cap. ` +
    `There is no confirmation for this one — pick a slower rate. ` +
    `Sustainable cuts run 0.5–1% of body weight per week.`;
  return { gate: "rate-absolute-cap", error: msg, fields: { rateLbPerWeek: msg } };
}

module.exports = { RATE_ACK_PCT, RATE_ABS_CAP_PCT, classifyRatePct, absoluteCapRefusal };
