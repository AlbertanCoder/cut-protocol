// Relay config for the packaged desktop app.
//
// THE PROBLEM THIS SOLVES: a distributed build ships no secrets, so the brain
// can never turn on in an installed app — there is no key and no place to put
// one. The relay (see relay/) removes the need for a key, but the app still has
// to learn the relay's address and its device token, and NEITHER may enter the
// installer payload. So they live in a file in the writable userData directory,
// alongside the session secret and cutprotocol.db, written at runtime by the
// user and never by the build.
//
// This module is deliberately OUTSIDE src/lib/brain/. It is desktop plumbing,
// not judgment: it decides where a config file lives and how to read it, and it
// touches no prompt, no model, and no gate. llm.js stays the single gate;
// everything here does is populate the environment that gate already reads.
const fs = require("node:fs");
const path = require("node:path");
const { isBrainEnabled, relayConfig } = require("./brain/llm.js");

const FILENAME = "brain.json";

/**
 * Where brain.json lives. Resolution order mirrors how electron/main.cjs
 * already hands paths to the backend:
 *
 *   1. CUT_PROTOCOL_USERDATA  — set by main.cjs, the real answer in the app
 *   2. dirname(CUT_PROTOCOL_DB_PATH) — same directory, derived; a fallback in
 *      case an older main.cjs is in play during an upgrade
 *   3. null — standalone `node server.js` in dev, where backend/.env owns the
 *      brain config and a file-based one would be a confusing second source
 *
 * Returning null rather than guessing a path matters: a wrong guess would write
 * a file containing a device token somewhere nobody is looking for it.
 */
function configDir() {
  const explicit = process.env.CUT_PROTOCOL_USERDATA;
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  const dbPath = process.env.CUT_PROTOCOL_DB_PATH;
  if (dbPath && String(dbPath).trim()) return path.dirname(String(dbPath).trim());
  return null;
}

function configPath() {
  const dir = configDir();
  return dir ? path.join(dir, FILENAME) : null;
}

function fileExists() {
  const p = configPath();
  return Boolean(p && fs.existsSync(p));
}

/**
 * Read and validate. Returns { relayUrl, relayToken } or null.
 *
 * Malformed is treated exactly like absent — not as an error. A half-written
 * file from a crashed save must degrade to "the coach doesn't appear", never to
 * a boot failure that takes the whole deterministic app down with it. The
 * distinction is preserved for the status route via fileExists(), so the user
 * can still be told the difference.
 */
function readConfig() {
  const p = configPath();
  if (!p) return null;
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const relayUrl = typeof parsed.relayUrl === "string" ? parsed.relayUrl.trim() : "";
  const relayToken = typeof parsed.relayToken === "string" ? parsed.relayToken.trim() : "";
  if (!relayUrl || !relayToken) return null; // half a relay is not a relay
  return { relayUrl, relayToken };
}

/**
 * Populate process.env from brain.json at boot.
 *
 * NEVER CLOBBERS AN EXISTING VALUE — the same non-destructive rule dotenv and
 * main.cjs already follow. An explicitly-set BRAIN=off in the environment must
 * win over a stale config file, or there is no way to turn the thing off from
 * outside the app.
 *
 * A complete brain.json IS the opt-in. Writing one is a deliberate user action
 * through the Settings screen, so it sets BRAIN=on — which also makes deleting
 * the file a complete kill switch, with no second flag to remember.
 */
function applyToEnv(env = process.env) {
  const cfg = readConfig();
  if (!cfg) return { applied: false };
  if (!env.BRAIN_RELAY_URL) env.BRAIN_RELAY_URL = cfg.relayUrl;
  if (!env.BRAIN_RELAY_TOKEN) env.BRAIN_RELAY_TOKEN = cfg.relayToken;
  if (!env.BRAIN) env.BRAIN = "on";
  return { applied: true };
}

function writeConfig({ relayUrl, relayToken }) {
  const p = configPath();
  if (!p) throw Object.assign(new Error("no writable config location"), { status: 500 });
  const url = String(relayUrl || "").trim();
  const token = String(relayToken || "").trim();
  if (!url || !token) throw Object.assign(new Error("both a relay URL and a token are required"), { status: 400 });

  // Validate through the SAME predicate the gate uses, by setting the candidate
  // into a throwaway env and asking relayConfig() what it thinks. Re-checking
  // the rules here would let the Settings screen accept a config the transport
  // then refuses — the exact class of bug where the app says "saved" and the
  // coach silently never appears.
  const saved = { u: process.env.BRAIN_RELAY_URL, t: process.env.BRAIN_RELAY_TOKEN };
  let ok;
  try {
    process.env.BRAIN_RELAY_URL = url;
    process.env.BRAIN_RELAY_TOKEN = token;
    ok = relayConfig();
  } finally {
    if (saved.u === undefined) delete process.env.BRAIN_RELAY_URL; else process.env.BRAIN_RELAY_URL = saved.u;
    if (saved.t === undefined) delete process.env.BRAIN_RELAY_TOKEN; else process.env.BRAIN_RELAY_TOKEN = saved.t;
  }
  if (!ok) {
    throw Object.assign(
      new Error("that relay address isn't usable — it must be an https:// address (http:// is only allowed for localhost)"),
      { status: 400 }
    );
  }

  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 0600: the file holds a credential. On Windows this is advisory, but it
  // costs nothing and is correct everywhere else.
  fs.writeFileSync(p, `${JSON.stringify({ relayUrl: url, relayToken: token }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  process.env.BRAIN_RELAY_URL = url;
  process.env.BRAIN_RELAY_TOKEN = token;
  process.env.BRAIN = "on";
  return { relayUrl: url };
}

/**
 * The kill switch. Deletes the file AND clears the live environment, because
 * this process was started with the old values and would otherwise keep using
 * them until restart — a kill switch you have to reboot to trust is not one.
 */
function clearConfig() {
  const p = configPath();
  if (p) { try { fs.unlinkSync(p); } catch { /* already gone is success */ } }
  delete process.env.BRAIN_RELAY_URL;
  delete process.env.BRAIN_RELAY_TOKEN;
  delete process.env.BRAIN;
}

/**
 * WHY the brain is off, without ever revealing the token.
 *
 * Right now a disabled brain and a broken one are indistinguishable from the
 * outside, and that ambiguity is expensive precisely when something is wrong.
 * Reasons are stable strings the UI maps to plain-English copy:
 *
 *   ok                 — enabled
 *   no-config          — nothing configured; the normal state of a fresh install
 *   incomplete-config  — a brain.json exists but is unreadable or half-filled
 *   off                — configured, but BRAIN is not "on"
 *   relay-unreachable  — configured, but the relay did not answer (probe only)
 */
function status() {
  if (isBrainEnabled()) return { enabled: true, reason: "ok" };
  if (relayConfig() || process.env.ANTHROPIC_API_KEY) return { enabled: false, reason: "off" };
  if (fileExists()) return { enabled: false, reason: "incomplete-config" };
  return { enabled: false, reason: "no-config" };
}

/**
 * Liveness probe against the relay's /healthz.
 *
 * NOT run on the ordinary status poll: BrainChat asks for status on every
 * mount, and a network round-trip there would make the chat bar's appearance
 * depend on relay latency. This is for the Settings screen's explicit check,
 * where the user is waiting for exactly this answer.
 *
 * The device token is deliberately NOT sent — /healthz is unauthenticated, and
 * a probe is not a reason to put a credential on the wire.
 */
async function probeRelay({ timeoutMs = 4000 } = {}) {
  const cfg = relayConfig();
  if (!cfg) return { reachable: false, reason: "no-config" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseURL}/healthz`, { signal: ac.signal });
    return res.ok ? { reachable: true } : { reachable: false, reason: "relay-unreachable" };
  } catch {
    return { reachable: false, reason: "relay-unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  FILENAME,
  configDir,
  configPath,
  fileExists,
  readConfig,
  applyToEnv,
  writeConfig,
  clearConfig,
  status,
  probeRelay,
};
