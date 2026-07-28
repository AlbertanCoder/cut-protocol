#!/usr/bin/env node
/**
 * role — resolve the campaign role of the session a hook is serving.
 *
 * One module, required by BOTH guards, because I2's fail-closed rule has to be
 * the same rule in both doors. Two copies of "what counts as a builder" is two
 * chances to drift, and the drift would only ever be discovered by something
 * getting through.
 *
 * THE LAW THIS SERVES: permissions INTERSECT, never union. A role may only
 * narrow what the incision manifest already grants. Nothing in this file, and
 * nothing that consumes it, may return "allowed" for a path or command the
 * manifest denies. Role is a ceiling, not a key.
 *
 * Trust model, stated so it is not mistaken for something stronger: CP_ROLE is
 * set outside the cage, by the hand that launches the terminal. That is the
 * same trust model the manifest already runs on. What is excluded here is the
 * accident and the in-session shortcut -- a forgotten variable fails closed,
 * and a session cannot widen itself mid-flight (proved: a shell mutation does
 * not survive the tool call and never enters the hook's parent chain).
 */
'use strict';

const ARCHITECT = 'architect';
const BUILDER = 'builder';

/** The only two roles that exist. Anything else is not a role. */
const RECOGNIZED = new Set([ARCHITECT, BUILDER]);

/**
 * Resolve CP_ROLE, fail-closed (I2).
 *
 * Absent, empty, whitespace-only, or unrecognized ALL resolve to ARCHITECT --
 * the tighter of the two doors. A forgotten env var must never mint an unbound
 * builder, so "I don't know who you are" is answered with the smaller key, not
 * the larger one.
 *
 * Normalization is trim + case-fold, so "  BUILDER  " is a builder. That is
 * deliberate leniency about SHAPE only; it is not leniency about VALUE, and
 * "admin", "root" and "surgeon" are all strangers here.
 *
 * CONTESTED — see ASK M0.1-a, unresolved at the time of writing. Order M0.1
 * says two incompatible things about this exact value:
 *   I2  "normalized (trim, case-fold). Recognized: architect, builder"
 *         -> "  BUILDER  " normalizes to "builder" and IS recognized.
 *   A10 "CP_ROLE='  BUILDER  ' / 'admin' / '' -> each resolves
 *        architect-or-tighter"
 *         -> "  BUILDER  " must NOT be recognized.
 * Both cannot hold: architect is a strict subset of builder in this window, so
 * there is no resolution that satisfies each. Implemented per I2, because I2
 * specifies the mechanism and its trim/case-fold clause has no other purpose
 * than to accept exactly this shape. If the owner or architect rules for A10
 * instead, the change is small and local: drop `.trim().toLowerCase()` from
 * recognition here and flip the two normalization rows in guard-selftest.js.
 * Flagged rather than silently decided, because picking one and staying quiet
 * is how a wall ends up with a door nobody remembers agreeing to.
 *
 * @returns {{role: string, raw: string|null, recognized: boolean, reason: string}}
 */
function resolveRole(env) {
  const source = env || process.env;
  const raw = source.CP_ROLE;

  if (typeof raw !== 'string') {
    return { role: ARCHITECT, raw: null, recognized: false, reason: 'absent' };
  }

  const norm = raw.trim().toLowerCase();

  if (norm === '') {
    return { role: ARCHITECT, raw, recognized: false, reason: 'empty-or-whitespace' };
  }
  if (!RECOGNIZED.has(norm)) {
    return { role: ARCHITECT, raw, recognized: false, reason: 'unrecognized' };
  }

  return { role: norm, raw, recognized: true, reason: 'recognized' };
}

/**
 * How to name the role in a block message. An unrecognized role is reported as
 * what it RESOLVED to and what it CLAIMED, because a message that only says
 * "architect" to a terminal that said "admin" hides the reason for the block.
 */
function describeRole(r) {
  if (r.recognized) return r.role;
  if (r.reason === 'absent') return `${ARCHITECT} (CP_ROLE absent — fail-closed)`;
  if (r.reason === 'empty-or-whitespace') return `${ARCHITECT} (CP_ROLE empty — fail-closed)`;
  return `${ARCHITECT} (CP_ROLE ${JSON.stringify(r.raw)} is not a role — fail-closed)`;
}

module.exports = { resolveRole, describeRole, ARCHITECT, BUILDER };
