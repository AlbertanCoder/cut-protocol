// Brain v3 — output guard (Stage D, layer L4). postCheck(text) runs AFTER the
// model, assuming every earlier layer was bypassed: a leak scan (never echo the
// system prompt, the <user_data> delimiters, a key, or env access) and a
// fail-closed replacement with a canned refusal. Number-provenance on STRUCTURED
// plan output is already enforced by verifier.js; this guards the free-text chat
// surface (Stage D2).
const { refusalText } = require("./policy.js");

const LEAK_RE = /NON-NEGOTIABLE|<\/?\s*user_data|\bsk-ant[-a-z0-9]|JWT_SECRET|-----BEGIN|process\.env/i;

function postCheck(text, { refusalKey = "off_topic" } = {}) {
  const t = String(text ?? "");
  if (LEAK_RE.test(t)) return { ok: false, reason: "leak", response: refusalText(refusalKey) };
  return { ok: true, response: t };
}

module.exports = { postCheck, LEAK_RE };
