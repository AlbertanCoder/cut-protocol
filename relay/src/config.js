// Boot-time configuration. Every secret is read from the environment HERE and
// nowhere else, so there is exactly one place to audit for leakage.
//
// The two secrets (ANTHROPIC_API_KEY, RELAY_TOKEN) are returned as values on
// this object and must never be logged, echoed into an error body, or written
// to the usage file. `redactedSummary()` below is the ONLY thing that should
// ever be printed about this config.
const path = require("node:path");

const DEFAULTS = {
  port: 8787,
  host: "127.0.0.1",
  // Server-side ceiling on max_tokens, applied regardless of what the client
  // asked for. The client's own cap is advisory; this one costs money.
  maxTokens: 4096,
  // Body cap is checked BEFORE parsing — see server.js. 256 KB is far above a
  // legitimate coach turn (the route caps messages at 500 chars) and far below
  // anything that could be used to burn CPU on JSON.parse.
  maxBodyBytes: 256 * 1024,
  monthlyUsd: 20,
  dailyUsd: 2,
  perRequestUsd: 0.5,
  upstreamUrl: "https://api.anthropic.com",
  // Bounded, and generous enough for a slow Opus turn. An unbounded upstream
  // call is a hung socket, not an error anyone can see.
  timeoutMs: 120000,
};

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number (got: ${JSON.stringify(raw)})`);
  }
  return n;
}

/**
 * Reads and validates config. Throws on anything missing or malformed — a relay
 * that boots without a key would answer /healthz cheerfully and fail every real
 * request with a 500, which reads as "Anthropic is down" rather than "you
 * forgot the key". Fail at boot, loudly, once.
 */
function loadConfig(env = process.env) {
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
  const relayToken = String(env.RELAY_TOKEN || "").trim();

  const missing = [];
  if (!apiKey) missing.push("ANTHROPIC_API_KEY");
  if (!relayToken) missing.push("RELAY_TOKEN");
  if (missing.length) {
    throw new Error(
      `Relay cannot start: missing ${missing.join(" and ")}. ` +
        `Set them in the service environment — never in a file inside this directory.`
    );
  }

  // A short token is a guessable token. This is the only credential between a
  // user's machine and a service holding the real key.
  if (relayToken.length < 32) {
    throw new Error("Relay cannot start: RELAY_TOKEN must be at least 32 characters.");
  }

  // Refuse to run with the Anthropic key doubling as the device token. That
  // would hand the real key to every client — the exact thing this exists to
  // prevent — and it is an easy copy-paste mistake to make at 1am.
  if (relayToken === apiKey) {
    throw new Error("Relay cannot start: RELAY_TOKEN must not equal ANTHROPIC_API_KEY.");
  }

  return {
    apiKey,
    relayToken,
    port: num("RELAY_PORT", DEFAULTS.port),
    host: env.RELAY_HOST || DEFAULTS.host,
    maxTokens: num("RELAY_MAX_TOKENS", DEFAULTS.maxTokens),
    maxBodyBytes: num("RELAY_MAX_BODY_BYTES", DEFAULTS.maxBodyBytes),
    monthlyUsd: num("RELAY_MONTHLY_USD", DEFAULTS.monthlyUsd),
    dailyUsd: num("RELAY_DAILY_USD", DEFAULTS.dailyUsd),
    perRequestUsd: num("RELAY_PER_REQUEST_USD", DEFAULTS.perRequestUsd),
    upstreamUrl: (env.RELAY_UPSTREAM_URL || DEFAULTS.upstreamUrl).replace(/\/+$/, ""),
    timeoutMs: num("RELAY_TIMEOUT_MS", DEFAULTS.timeoutMs),
    usageFile: env.RELAY_USAGE_FILE || path.join(__dirname, "..", "usage.jsonl"),
  };
}

/**
 * The only safe-to-print view of the config. Secrets are reported by LENGTH
 * only — enough to tell "I pasted it twice" from "I pasted nothing", and not
 * enough to reconstruct a single character. No prefix, no suffix, no hash.
 */
function redactedSummary(cfg) {
  return {
    host: cfg.host,
    port: cfg.port,
    upstream: cfg.upstreamUrl,
    maxTokensCeiling: cfg.maxTokens,
    maxBodyBytes: cfg.maxBodyBytes,
    caps: { monthlyUsd: cfg.monthlyUsd, dailyUsd: cfg.dailyUsd, perRequestUsd: cfg.perRequestUsd },
    timeoutMs: cfg.timeoutMs,
    usageFile: cfg.usageFile,
    apiKeyLength: cfg.apiKey.length,
    relayTokenLength: cfg.relayToken.length,
  };
}

module.exports = { loadConfig, redactedSummary, DEFAULTS };
