// Cut Protocol relay — a narrow Anthropic forwarding service.
//
// It holds the only copy of the ANTHROPIC_API_KEY and accepts a per-device
// token instead, so a packaged desktop build can reach the brain without the
// installer ever carrying a secret.
//
// THE TRUST MODEL, stated plainly: the device token sits on a user's machine
// and must be assumed extractable. Everything enforced on the client is
// therefore advisory. The limits that actually bound the bill — model
// allowlist, max_tokens ceiling, USD caps — live here, and only here.
//
// Surface is exactly two endpoints. Anything else is a 404.
const http = require("node:http");
const crypto = require("node:crypto");
const { loadConfig, redactedSummary } = require("./config.js");
const { isAllowedModel, estimateCostUsd, ALLOWED_MODELS } = require("./pricing.js");
const { UsageLedger } = require("./usage.js");

// Constant-time token comparison.
//
// timingSafeEqual throws on length mismatch, and branching on that would leak
// the token's length through timing. Hashing both sides to a fixed 32 bytes
// first removes the length signal entirely and lets one comparison cover every
// case.
function tokensMatch(presented, expected) {
  if (typeof presented !== "string" || presented.length === 0) return false;
  const a = crypto.createHash("sha256").update(presented, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// The Anthropic SDK sends the configured apiKey as `x-api-key`, NOT as
// `Authorization: Bearer`. A relay that only checked for a bearer token would
// reject every request the desktop app makes, so both are accepted — bearer as
// well, because that is what a human reaches for with curl.
function presentedToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && /^Bearer /i.test(auth)) return auth.slice(7).trim();
  const key = req.headers["x-api-key"];
  if (typeof key === "string" && key.trim()) return key.trim();
  return null;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

// Read the body with a HARD byte ceiling enforced as bytes arrive, so an
// oversized payload is refused before it is buffered and before JSON.parse ever
// sees it. Checking content-length alone would trust a header the client sets.
// The cap that matters is on what we BUFFER, not on what arrives. Past the
// limit we drop every further chunk and keep draining, so memory is bounded at
// maxBytes while the client is still allowed to finish writing and then read
// its 413.
//
// Cutting the socket the moment the limit trips does not work: the client is
// mid-upload, its write fails first, and it reports ECONNRESET instead of ever
// seeing the response — which reads as a network fault and invites a retry of
// the very request we just refused. That is the bug this shape exists to avoid.
//
// DRAIN_MULTIPLIER is the backstop for the abuse case that would otherwise
// abuse this politeness: a sender streaming without end gets the socket cut,
// because at that point there is no client waiting for an answer.
const DRAIN_MULTIPLIER = 8;

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let over = false;
    const tooLarge = () => Object.assign(new Error("body too large"), { tooLarge: true });

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        if (!over) {
          over = true;
          chunks.length = 0; // release what we already held
        }
        if (total > maxBytes * DRAIN_MULTIPLIER) {
          req.destroy();
          reject(tooLarge());
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => (over ? reject(tooLarge()) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

// Structured, content-free logging. Shape and token counts only — never a
// message, never a system prompt, never a header value.
function log(fields) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...fields })}\n`);
}

function createApp(cfg, ledger) {
  return async function handle(req, res) {
    const started = Date.now();
    const url = (req.url || "").split("?")[0];

    // ── /healthz — unauthenticated liveness, and NOTHING else ───────────────
    // No version, no config, no budget state. This endpoint is reachable by
    // anyone who can open a socket; every byte it returns is reconnaissance.
    if (req.method === "GET" && url === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }

    if (url !== "/v1/messages") return sendJson(res, 404, { error: "not found" });
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });

    // ── 1. Body size cap, before parsing ────────────────────────────────────
    let raw;
    try {
      raw = await readBody(req, cfg.maxBodyBytes);
    } catch (e) {
      if (e && e.tooLarge) {
        log({ event: "reject", why: "body-too-large", limit: cfg.maxBodyBytes });
        // The oversized body was drained, not buffered — nothing was parsed and
        // the client is free to read this.
        if (!res.writableEnded) sendJson(res, 413, { error: "request too large" });
        return;
      }
      return sendJson(res, 400, { error: "could not read request" });
    }

    // ── 2. Token check, constant-time. 401 carries no detail ────────────────
    // Not whether the header was missing, not whether it was the wrong shape,
    // not how close it was. An attacker learns nothing from a failure.
    if (!tokensMatch(presentedToken(req), cfg.relayToken)) {
      log({ event: "reject", why: "bad-token" });
      return sendJson(res, 401, { error: "unauthorized" });
    }

    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return sendJson(res, 400, { error: "invalid JSON" });
    }
    if (!body || typeof body !== "object") return sendJson(res, 400, { error: "invalid body" });

    // ── 3. Model allowlist ──────────────────────────────────────────────────
    // This is what stops an extracted token from billing the most expensive
    // model available at scale. It names the permitted models in the error
    // because that is configuration, not a secret.
    const model = body.model;
    if (!isAllowedModel(model)) {
      log({ event: "reject", why: "model-not-allowed", model: String(model).slice(0, 64) });
      return sendJson(res, 400, {
        error: "model not allowed",
        allowed: ALLOWED_MODELS,
      });
    }

    // ── 4. max_tokens ceiling, enforced server-side ─────────────────────────
    // Whatever the client asked for, the ceiling wins. Silently clamping is
    // correct here: the alternative is rejecting a request that would have
    // been fine at a lower cap.
    const requested = Number(body.max_tokens);
    const clamped = Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : cfg.maxTokens,
      cfg.maxTokens
    );
    body.max_tokens = clamped;

    // ── 5. Budget check BEFORE forwarding — no upstream call on denial ──────
    const estimate = estimateCostUsd(model, raw.length, clamped);
    const verdict = ledger.check(estimate);
    if (!verdict.allowed) {
      ledger.recordDenied({ model, scope: verdict.scope, estimateUsd: estimate });
      log({ event: "denied", scope: verdict.scope, model, estimateUsd: Number(estimate.toFixed(6)) });
      res.setHeader("retry-after", verdict.scope === "daily" ? "3600" : "86400");
      return sendJson(res, 429, { error: "budget exceeded", reason: verdict.reason, scope: verdict.scope });
    }

    // ── 6. Forward with the real key. Bounded timeout. Zero retries ─────────
    // Retrying a judgment call that already failed spends money twice for the
    // same answer; the client already treats a throw as a no-op fallback.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    let upstream;
    try {
      upstream = await fetch(`${cfg.upstreamUrl}/v1/messages`, {
        method: "POST",
        signal: ac.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
          ...(req.headers["anthropic-beta"] ? { "anthropic-beta": req.headers["anthropic-beta"] } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e && e.name === "AbortError";
      log({ event: "upstream-error", model, aborted: Boolean(aborted) });
      // The upstream error is NOT forwarded. Its message could contain request
      // detail, and there is no version of "the relay could not reach
      // Anthropic" that the client needs more words for.
      return sendJson(res, aborted ? 504 : 502, { error: aborted ? "upstream timeout" : "upstream unreachable" });
    }
    clearTimeout(timer);

    const text = await upstream.text();

    // ── 7. Record ACTUAL usage, cache tokens included ───────────────────────
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON upstream response — forwarded as-is, nothing to meter */
    }
    let booked = null;
    if (parsed && parsed.usage) {
      booked = ledger.record({
        model: parsed.model || model,
        usage: parsed.usage,
        outcome: upstream.ok ? "ok" : `http:${upstream.status}`,
        durationMs: Date.now() - started,
      });
    }

    log({
      event: "forward",
      model,
      status: upstream.status,
      maxTokens: clamped,
      bytesIn: raw.length,
      bytesOut: Buffer.byteLength(text),
      durationMs: Date.now() - started,
      ...(booked
        ? {
            input: booked.input,
            output: booked.output,
            cacheWrite: booked.cacheWrite,
            cacheRead: booked.cacheRead,
            usd: booked.usd,
            todayUsd: Number(ledger.today.toFixed(6)),
            monthUsd: Number(ledger.month.toFixed(6)),
          }
        : {}),
    });

    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
    });
    res.end(text);
  };
}

function createServer(cfg, ledger) {
  return http.createServer(createApp(cfg, ledger));
}

function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
    return;
  }
  const ledger = new UsageLedger({
    file: cfg.usageFile,
    monthlyUsd: cfg.monthlyUsd,
    dailyUsd: cfg.dailyUsd,
    perRequestUsd: cfg.perRequestUsd,
  });
  const server = createServer(cfg, ledger);
  server.listen(cfg.port, cfg.host, () => {
    log({ event: "listening", config: redactedSummary(cfg) });
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}

if (require.main === module) main();

module.exports = { createServer, createApp, tokensMatch, presentedToken };
