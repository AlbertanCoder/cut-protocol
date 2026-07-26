// Stage 3 integration — brain.json all the way to the wire.
//
// Every other test in this build stubs something. This one stubs only
// Anthropic: it writes a real brain.json, boots the REAL relay as a separate
// process, and sends a real request through the real Anthropic SDK, and then
// asserts what arrived at the far end.
//
// The relay is spawned rather than required on purpose. relay/ does not import
// from backend/, and a test that reached across would be the first thing to
// blur that boundary — the one whose whole value is that a client-side
// assumption cannot become a server-side limit. A child process keeps it
// honest: this test can only interact with the relay the way the app does.
//
// What this DOES prove: brain.json is read, the gate opens, the SDK is pointed
// at the relay, the relay's checks run, and a reply comes back through the
// whole chain.
// What it does NOT prove: that any of this works against api.anthropic.com.
// Upstream here is a stub on loopback. That is Stage 5.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const store = require("../../src/lib/brainRelayConfig.js");
const { isBrainEnabled, askJSON, __setClient } = require("../../src/lib/brain/llm.js");

const RELAY_ENTRY = path.join(__dirname, "..", "..", "..", "relay", "src", "server.js");
const FAKE_UPSTREAM_KEY = "sk-ant-api03-STUB-UPSTREAM-KEY-NEVER-REAL-0123456789";
const DEVICE_TOKEN = "e2e-device-token-0123456789abcdef0123456789";

const ENV_KEYS = ["BRAIN", "ANTHROPIC_API_KEY", "BRAIN_RELAY_URL", "BRAIN_RELAY_TOKEN", "CUT_PROTOCOL_USERDATA"];

function waitForHealthz(base, tries = 80) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      fetch(`${base}/healthz`)
        .then((r) => (r.ok ? resolve() : retry(n)))
        .catch(() => retry(n));
      const retry = (k) => (k <= 0 ? reject(new Error("relay never became healthy")) : setTimeout(() => attempt(k - 1), 50));
    };
    attempt(tries);
  });
}

test("brain.json -> gate -> SDK -> real relay -> upstream, end to end", async (t) => {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];

  const received = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      received.push({ url: req.url, headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_e2e", type: "message", role: "assistant", model: "claude-haiku-4-5",
        content: [{ type: "text", text: '{"reply":"through the relay"}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 42, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const upstreamPort = upstream.address().port;

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cp-e2e-"));
  const relayUsage = path.join(userData, "relay-usage.jsonl");

  let relay;
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.CUT_PROTOCOL_USERDATA = userData;

    // Boot the real relay on an ephemeral port.
    const relayPort = 8900 + (process.pid % 400);
    relay = spawn(process.execPath, [RELAY_ENTRY], {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: FAKE_UPSTREAM_KEY,
        RELAY_TOKEN: DEVICE_TOKEN,
        RELAY_PORT: String(relayPort),
        RELAY_HOST: "127.0.0.1",
        RELAY_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}`,
        RELAY_USAGE_FILE: relayUsage,
        RELAY_PER_REQUEST_USD: "1",
        RELAY_DAILY_USD: "1",
        RELAY_MONTHLY_USD: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const relayBase = `http://127.0.0.1:${relayPort}`;
    await waitForHealthz(relayBase);

    // ── the app's side: write brain.json exactly as the Settings card does ──
    assert.equal(isBrainEnabled(), false, "before config: off, as a fresh install is");
    store.writeConfig({ relayUrl: relayBase, relayToken: DEVICE_TOKEN });
    __setClient(null);

    assert.equal(isBrainEnabled(), true, "a written brain.json turns the coach on");
    assert.deepEqual(store.status(), { enabled: true, reason: "ok" });
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "and with NO key anywhere in the app");

    const probe = await store.probeRelay();
    assert.deepEqual(probe, { reachable: true }, "the Settings card's connection check");

    // ── a real model call through the whole chain ──────────────────────────
    const out = await askJSON({ system: "s", user: "u", model: "claude-haiku-4-5" });
    assert.deepEqual(out, { reply: "through the relay" }, "the reply came back through the relay");

    assert.equal(received.length, 1, "exactly one upstream call");
    assert.equal(received[0].url, "/v1/messages", "not /v1/v1/messages");
    assert.equal(received[0].headers["x-api-key"], FAKE_UPSTREAM_KEY, "the relay swapped in its own key");
    assert.ok(!JSON.stringify(received[0].headers).includes(DEVICE_TOKEN), "the device token stopped at the relay");

    // ── the relay metered it ───────────────────────────────────────────────
    const rows = fs.readFileSync(relayUsage, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].input, 42);
    assert.equal(rows[0].output, 7);
    assert.ok(rows[0].usd > 0, "real spend was booked");

    // ── the kill switch, live ──────────────────────────────────────────────
    store.clearConfig();
    __setClient(null);
    assert.equal(isBrainEnabled(), false, "deleting brain.json turns it off immediately");
    assert.deepEqual(store.status(), { enabled: false, reason: "no-config" });
  } finally {
    if (relay) relay.kill();
    await new Promise((r) => upstream.close(r));
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __setClient(null);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("a relay that is not running reports relay-unreachable, not a crash", async () => {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cp-e2e-down-"));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.CUT_PROTOCOL_USERDATA = userData;
    // Port 1 on loopback: nothing is listening, and nothing ever will be.
    store.writeConfig({ relayUrl: "http://127.0.0.1:1", relayToken: DEVICE_TOKEN });
    __setClient(null);

    // The gate stays OPEN — config is complete and valid. Reachability is a
    // separate question, which is the whole reason the probe is separate: a
    // relay that is merely down should not look like a missing config.
    assert.equal(isBrainEnabled(), true);
    assert.equal(store.status().reason, "ok");

    const probe = await store.probeRelay({ timeoutMs: 1500 });
    assert.deepEqual(probe, { reachable: false, reason: "relay-unreachable" });
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __setClient(null);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
