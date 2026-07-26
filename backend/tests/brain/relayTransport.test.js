// Stage 1 — relay-aware transport.
//
// A packaged install ships no ANTHROPIC_API_KEY by design, so the brain can only
// ever turn on there via a RELAY: a forwarding service holding the real key,
// addressed with a per-device token. These tests cover the gate (which configs
// count as a transport) and the wire (where a relay-configured client actually
// sends bytes).
//
// The wire tests run a REAL http server on loopback rather than stubbing the
// SDK. A mock would happily confirm whatever URL we told it to expect; only an
// actual socket proves the SDK's `new URL(baseURL + "/v1/messages")` join lands
// where the relay is listening. That join is the single most breakable thing in
// this stage — see the `/v1` normalization cases.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { isBrainEnabled, relayConfig, askJSON, __setClient } = require("../../src/lib/brain/llm.js");

const ENV_KEYS = ["BRAIN", "ANTHROPIC_API_KEY", "BRAIN_RELAY_URL", "BRAIN_RELAY_TOKEN"];

// Every test here mutates process-wide env. Snapshot/restore all four keys and
// reset the memoized client, or case N+1 inherits case N's transport.
function withEnv(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  try {
    for (const k of ENV_KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    __setClient(null);
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __setClient(null);
  }
}

// ── the gate ─────────────────────────────────────────────────────────────────

test("isBrainEnabled: a complete relay config is a transport — no ANTHROPIC_API_KEY needed", () => {
  withEnv({ BRAIN: "on", ANTHROPIC_API_KEY: undefined, BRAIN_RELAY_URL: "https://relay.example.com", BRAIN_RELAY_TOKEN: "dev-token" }, () => {
    assert.equal(isBrainEnabled(), true, "relay URL + token + BRAIN=on => enabled, this is the packaged-install path");
  });
});

test("isBrainEnabled: a direct key still works exactly as before (dev, backend/.env)", () => {
  withEnv({ BRAIN: "on", ANTHROPIC_API_KEY: "sk-test", BRAIN_RELAY_URL: undefined, BRAIN_RELAY_TOKEN: undefined }, () => {
    assert.equal(isBrainEnabled(), true);
  });
});

test("isBrainEnabled: BRAIN=on is still required — a relay alone does not opt you in", () => {
  withEnv({ BRAIN: undefined, ANTHROPIC_API_KEY: undefined, BRAIN_RELAY_URL: "https://relay.example.com", BRAIN_RELAY_TOKEN: "dev-token" }, () => {
    assert.equal(isBrainEnabled(), false, "no BRAIN=on => off");
  });
  withEnv({ BRAIN: "off", ANTHROPIC_API_KEY: undefined, BRAIN_RELAY_URL: "https://relay.example.com", BRAIN_RELAY_TOKEN: "dev-token" }, () => {
    assert.equal(isBrainEnabled(), false, "BRAIN=off => off even with a complete relay");
  });
});

test("isBrainEnabled: PARTIAL relay config is not config — half a relay stays off", () => {
  withEnv({ BRAIN: "on", ANTHROPIC_API_KEY: undefined, BRAIN_RELAY_URL: "https://relay.example.com", BRAIN_RELAY_TOKEN: undefined }, () => {
    assert.equal(isBrainEnabled(), false, "URL without a token: points somewhere, authenticates to nothing");
  });
  withEnv({ BRAIN: "on", ANTHROPIC_API_KEY: undefined, BRAIN_RELAY_URL: undefined, BRAIN_RELAY_TOKEN: "dev-token" }, () => {
    assert.equal(isBrainEnabled(), false, "token without a URL: a credential pointing nowhere");
  });
  withEnv({ BRAIN: "on", ANTHROPIC_API_KEY: undefined, BRAIN_RELAY_URL: "   ", BRAIN_RELAY_TOKEN: "  " }, () => {
    assert.equal(isBrainEnabled(), false, "whitespace is absence, not configuration");
  });
});

test("relayConfig: rejects a malformed URL rather than handing the SDK garbage", () => {
  withEnv({ BRAIN: "on", BRAIN_RELAY_URL: "not a url", BRAIN_RELAY_TOKEN: "dev-token" }, () => {
    assert.equal(relayConfig(), null);
    assert.equal(isBrainEnabled(), false);
  });
});

test("relayConfig: cleartext http is refused off-loopback, allowed on it", () => {
  // The device token is the ONLY credential between a user's machine and a
  // service holding the real key. Sending it in cleartext over the internet
  // hands it over without anyone touching either box.
  withEnv({ BRAIN: "on", BRAIN_RELAY_URL: "http://relay.example.com", BRAIN_RELAY_TOKEN: "dev-token" }, () => {
    assert.equal(relayConfig(), null, "public http => not a usable relay config");
    assert.equal(isBrainEnabled(), false);
  });
  for (const host of ["127.0.0.1", "localhost"]) {
    withEnv({ BRAIN: "on", BRAIN_RELAY_URL: `http://${host}:8787`, BRAIN_RELAY_TOKEN: "dev-token" }, () => {
      assert.ok(relayConfig(), `loopback http (${host}) stays legal — Stage 3 tests against a local relay`);
    });
  }
  withEnv({ BRAIN: "on", BRAIN_RELAY_URL: "ftp://relay.example.com", BRAIN_RELAY_TOKEN: "dev-token" }, () => {
    assert.equal(relayConfig(), null, "only http/https are transports");
  });
});

test("relayConfig: a pasted trailing /v1 is normalized away (the SDK appends its own)", () => {
  const cases = [
    ["https://relay.example.com", "https://relay.example.com"],
    ["https://relay.example.com/", "https://relay.example.com"],
    ["https://relay.example.com/v1", "https://relay.example.com"],
    ["https://relay.example.com/v1/", "https://relay.example.com"],
    ["https://relay.example.com/V1", "https://relay.example.com"],
    ["https://relay.example.com/brain/v1", "https://relay.example.com/brain"],
  ];
  for (const [input, want] of cases) {
    withEnv({ BRAIN: "on", BRAIN_RELAY_URL: input, BRAIN_RELAY_TOKEN: "dev-token" }, () => {
      assert.equal(relayConfig().baseURL, want, `${input} => ${want}`);
    });
  }
});

// ── the wire ─────────────────────────────────────────────────────────────────

// Minimal Anthropic-shaped reply. askJSON wants a text block of parseable JSON.
const OK_BODY = JSON.stringify({
  id: "msg_stub", type: "message", role: "assistant", model: "claude-haiku-4-5",
  content: [{ type: "text", text: '{"ok":true}' }],
  stop_reason: "end_turn",
  usage: { input_tokens: 11, output_tokens: 7 },
});

// Stands in for the relay. Records what actually arrived on the socket.
async function withRelayStub(fn) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      received.push({ url: req.url, method: req.method, headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(OK_BODY);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    return await fn({ base: `http://127.0.0.1:${port}`, received });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("a relay-configured client sends to the RELAY at /v1/messages — never to api.anthropic.com", async () => {
  await withRelayStub(async ({ base, received }) => {
    const saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    try {
      process.env.BRAIN = "on";
      delete process.env.ANTHROPIC_API_KEY; // the packaged-install condition
      process.env.BRAIN_RELAY_URL = base;
      process.env.BRAIN_RELAY_TOKEN = "device-token-abc";
      __setClient(null);

      assert.equal(isBrainEnabled(), true);
      const out = await askJSON({ system: "s", user: "u", model: "claude-haiku-4-5" });
      assert.deepEqual(out, { ok: true }, "the relayed reply parses back through askJSON unchanged");

      assert.equal(received.length, 1, "exactly one request, and it reached the relay");
      const req = received[0];
      // The whole point: NOT /v1/v1/messages, which is what a baseURL ending
      // in /v1 would have produced against this same SDK.
      assert.equal(req.url, "/v1/messages");
      assert.equal(req.method, "POST");
      // The SDK sends the configured apiKey as x-api-key (NOT Authorization:
      // Bearer). The relay's token check must accept this header.
      assert.equal(req.headers["x-api-key"], "device-token-abc");
      assert.equal(req.headers.authorization, undefined, "no bearer header when apiKey is used");
      assert.ok(!JSON.stringify(req.headers).includes("sk-ant"), "no Anthropic key on the wire");
      assert.equal(JSON.parse(req.body).model, "claude-haiku-4-5");
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      __setClient(null);
    }
  });
});

test("a relay URL pasted WITH /v1 still lands on /v1/messages", async () => {
  await withRelayStub(async ({ base, received }) => {
    const saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    try {
      process.env.BRAIN = "on";
      delete process.env.ANTHROPIC_API_KEY;
      process.env.BRAIN_RELAY_URL = `${base}/v1`; // the form the docs invite
      process.env.BRAIN_RELAY_TOKEN = "device-token-abc";
      __setClient(null);

      await askJSON({ system: "s", user: "u", model: "claude-haiku-4-5" });
      assert.equal(received[0].url, "/v1/messages", "normalization prevents /v1/v1/messages");
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      __setClient(null);
    }
  });
});

test("relay config WINS over a stray direct key — no silent bypass of the relay's caps", async () => {
  await withRelayStub(async ({ base, received }) => {
    const saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    try {
      process.env.BRAIN = "on";
      process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-be-used"; // both present
      process.env.BRAIN_RELAY_URL = base;
      process.env.BRAIN_RELAY_TOKEN = "device-token-abc";
      __setClient(null);

      await askJSON({ system: "s", user: "u", model: "claude-haiku-4-5" });
      assert.equal(received.length, 1, "the call went to the relay, not straight to Anthropic");
      assert.equal(received[0].headers["x-api-key"], "device-token-abc", "the device token authenticated, not the real key");
      assert.ok(!JSON.stringify(received[0].headers).includes("sk-ant"), "the direct key never reached the wire");
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      __setClient(null);
    }
  });
});
