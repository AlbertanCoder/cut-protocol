// Cut Protocol — offline entitlement gate.
//
// WHAT THIS IS
// A way to have something to sell later. Nothing more. It is a local check of
// a signed key file that the owner issues by hand. It is deliberately NOT
// DRM: no obfuscation, no anti-tamper, no hardware fingerprint, and above all
//
//   *** IT NEVER PHONES HOME. ***
//
// There is no network call anywhere in this file, by design. The app must
// work on a plane, in a basement gym, forever, with no account and no server.
// A licensing scheme that can strand a paying user offline is worse than no
// licensing scheme.
//
// HOW IT WORKS
//   - The owner holds an Ed25519 PRIVATE key (generated with
//     `node electron/licenseTool.cjs keygen`, kept OFF this repo).
//   - The matching PUBLIC key is pasted into PUBLIC_KEY_B64 below. A public
//     key in a public repo is fine — that is the whole point of asymmetric
//     signing. Anyone can verify; only the owner can issue.
//   - A customer gets a `license.key` file to drop in their user data dir.
//     It is `CP1.<base64url(payload JSON)>.<base64url(ed25519 signature)>`.
//   - At boot the app verifies the signature over the exact payload bytes and
//     checks the expiry, if the payload carries one.
//
// HONEST LIMITS (say them out loud rather than pretend):
//   - Anyone can edit this file in an unpacked build and delete the check.
//     That is true of every client-side gate ever written. This stops casual
//     copying, not a determined person, and it is not trying to.
//   - A shared key file works on any machine. Intentional: no fingerprints,
//     no activation servers, no "this device is not authorized" on a laptop
//     the user legitimately owns.
//
// DEFAULT STATE IN THIS REPO: PUBLIC_KEY_B64 is empty, so the gate is INERT —
// `check()` returns ok with state "unconfigured" and the app runs normally.
// Licensing only starts existing when a real public key is pasted in.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const log = require("./logger.cjs");

// Base64 (standard, not url) of the DER SPKI Ed25519 public key.
// Empty string = licensing not configured = gate inert. Fill this in from
// `node electron/licenseTool.cjs keygen` when there is something to sell.
const PUBLIC_KEY_B64 = "";

const LICENSE_FILENAME = "license.key";
const PREFIX = "CP1";

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function publicKeyObject(b64) {
  if (!b64) return null;
  return crypto.createPublicKey({
    key: Buffer.from(b64, "base64"),
    format: "der",
    type: "spki",
  });
}

/**
 * Verify a key STRING. Pure — no filesystem, no app object — so it is
 * testable on its own.
 *
 * `publicKeyB64` defaults to the compiled-in key and exists so tests can
 * exercise the real verifier against a throwaway keypair. It is NOT a bypass:
 * the boot path (check() below) never passes it, so nothing an attacker can
 * set changes which key a shipped build trusts.
 *
 * @returns {{ok:boolean, state:string, reason?:string, licensee?:string, expires?:string}}
 */
function verifyKeyString(raw, { now = Date.now(), publicKeyB64 = PUBLIC_KEY_B64 } = {}) {
  const key = publicKeyObject(publicKeyB64);
  if (!key) return { ok: true, state: "unconfigured" };
  if (!raw || typeof raw !== "string") return { ok: false, state: "missing", reason: "no key file" };

  const parts = raw.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { ok: false, state: "malformed", reason: "the key file isn't in the expected format" };
  }
  const [, payloadB64, sigB64] = parts;

  let payloadBuf;
  let sigBuf;
  try {
    payloadBuf = b64urlToBuf(payloadB64);
    sigBuf = b64urlToBuf(sigB64);
  } catch {
    return { ok: false, state: "malformed", reason: "the key file isn't readable" };
  }

  // Ed25519 verification: algorithm arg is null, the key type selects it.
  let good = false;
  try {
    good = crypto.verify(null, payloadBuf, key, sigBuf);
  } catch (e) {
    return { ok: false, state: "invalid", reason: `signature check failed: ${e.message}` };
  }
  if (!good) return { ok: false, state: "invalid", reason: "this key wasn't issued for Cut Protocol" };

  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return { ok: false, state: "malformed", reason: "the key payload isn't valid JSON" };
  }

  if (payload.exp) {
    const expMs = Date.parse(payload.exp);
    if (Number.isFinite(expMs) && expMs < now) {
      return { ok: false, state: "expired", reason: `this key expired on ${payload.exp}`, licensee: payload.licensee, expires: payload.exp };
    }
  }

  return { ok: true, state: "licensed", licensee: payload.licensee || "(unnamed)", expires: payload.exp || null };
}

function licensePath(app) {
  return path.join(app.getPath("userData"), LICENSE_FILENAME);
}

/**
 * Boot-time gate.
 *
 * DEVELOPMENT BYPASS — clearly marked, exactly as required:
 *   - any unpackaged run (source tree / `npm start`), or
 *   - CUT_PROTOCOL_DEV_LICENSE_BYPASS=1 in the environment.
 * Both log a loud line so a bypassed build can never be mistaken for a
 * licensed one when reading the log.
 *
 * @returns {{ok:boolean, state:string, reason?:string, licensee?:string, expires?:string, path:string}}
 */
function check(app) {
  const p = licensePath(app);

  // ── development bypass ───────────────────────────────────────────────────
  if (!app.isPackaged) {
    log.write("license", "DEV BYPASS: unpackaged build - entitlement check skipped");
    return { ok: true, state: "dev-bypass", path: p };
  }
  if (process.env.CUT_PROTOCOL_DEV_LICENSE_BYPASS === "1") {
    log.write("license", "DEV BYPASS: CUT_PROTOCOL_DEV_LICENSE_BYPASS=1 - entitlement check skipped");
    return { ok: true, state: "dev-bypass", path: p };
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (!PUBLIC_KEY_B64) {
    log.write("license", "not configured (no public key compiled in) - running unlicensed, gate inert");
    return { ok: true, state: "unconfigured", path: p };
  }

  let raw = null;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    log.write("license", `no key file at ${p}`);
    return { ok: false, state: "missing", reason: "no license key found", path: p };
  }

  const res = verifyKeyString(raw);
  log.write("license", `state=${res.state}${res.licensee ? ` licensee=${res.licensee}` : ""}${res.reason ? ` reason=${res.reason}` : ""}`);
  return { ...res, path: p };
}

module.exports = { check, verifyKeyString, licensePath, LICENSE_FILENAME, PREFIX };
