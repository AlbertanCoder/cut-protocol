// Stage 2 relay tests. Entirely offline: a local http server stands in for
// api.anthropic.com, so nothing here reaches the network and no test can spend
// money.
//
// The suite is built around one question the DoD asks explicitly — can the
// upstream key ever escape? — plus each rejection path in the order the server
// applies them.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createServer } = require("../src/server.js");
const { UsageLedger } = require("../src/usage.js");
const { costUsd, estimateCostUsd } = require("../src/pricing.js");
const { loadConfig } = require("../src/config.js");

const REAL_KEY = "sk-ant-api03-THIS-IS-THE-UPSTREAM-KEY-AND-MUST-NEVER-LEAK"; // scan:allow
const DEVICE_TOKEN = "device-token-0123456789abcdef0123456789abcdef";

function anthropicReply(over = {}) {
  return {
    id: "msg_stub",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: '{"ok":true}' }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
    ...over,
  };
}

// Spins up: a fake Anthropic, a relay pointed at it, and a temp usage file.
// `upstream.calls` is the load-bearing assertion surface — a budget denial that
// still called upstream is a budget that does not exist.
async function withRelay(opts, fn) {
  const {
    reply = anthropicReply(),
    status = 200,
    caps = { monthlyUsd: 100, dailyUsd: 100, perRequestUsd: 100 },
    maxTokens = 4096,
    seedRows = [],
    upstreamHandler = null,
  } = opts || {};

  const calls = [];
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      calls.push({ url: req.url, headers: req.headers, body });
      if (upstreamHandler) return upstreamHandler(req, res, body);
      const payload = JSON.stringify(reply);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload);
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));

  const usageFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-")),
    "usage.jsonl"
  );
  for (const row of seedRows) fs.appendFileSync(usageFile, `${JSON.stringify(row)}\n`);

  const cfg = {
    apiKey: REAL_KEY,
    relayToken: DEVICE_TOKEN,
    maxTokens,
    maxBodyBytes: 256 * 1024,
    upstreamUrl: `http://127.0.0.1:${upstream.address().port}`,
    timeoutMs: 5000,
    usageFile,
    ...caps,
  };
  const ledger = new UsageLedger({ file: usageFile, ...caps });
  const relay = createServer(cfg, ledger);
  await new Promise((r) => relay.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${relay.address().port}`;

  try {
    return await fn({ base, upstreamCalls: calls, usageFile, ledger, cfg });
  } finally {
    await new Promise((r) => relay.close(r));
    await new Promise((r) => upstream.close(r));
  }
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": DEVICE_TOKEN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const okBody = (over = {}) => ({ model: "claude-haiku-4-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }], ...over });

// ── surface ──────────────────────────────────────────────────────────────────

test("healthz is unauthenticated and leaks nothing — no version, no config, no budget", async () => {
  await withRelay({}, async ({ base }) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json, { ok: true }, "liveness and nothing else");
  });
});

test("only /v1/messages and /healthz exist", async () => {
  await withRelay({}, async ({ base }) => {
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/v1/complete`)).status, 404);
    assert.equal((await fetch(`${base}/usage`)).status, 404);
    assert.equal((await fetch(`${base}/v1/messages`)).status, 405, "GET on the forward path");
  });
});

// ── 1. body cap ──────────────────────────────────────────────────────────────

test("bodies over the cap are refused before parsing", async () => {
  await withRelay({}, async ({ base, upstreamCalls }) => {
    const huge = JSON.stringify(okBody({ messages: [{ role: "user", content: "x".repeat(300 * 1024) }] }));
    const res = await post(base, huge);
    assert.equal(res.status, 413);
    assert.equal(upstreamCalls.length, 0);
  });
});

// ── 2. token ─────────────────────────────────────────────────────────────────

test("a bad token is 401 with no detail, and never reaches upstream", async () => {
  await withRelay({}, async ({ base, upstreamCalls }) => {
    for (const headers of [
      { "x-api-key": "wrong-token" },
      { "x-api-key": "" },
      { authorization: "Bearer wrong-token" },
      {},
    ]) {
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(okBody()),
      });
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.deepEqual(json, { error: "unauthorized" }, "no hint about what was wrong");
    }
    assert.equal(upstreamCalls.length, 0);
  });
});

test("both x-api-key (what the SDK sends) and Bearer (what curl sends) are accepted", async () => {
  await withRelay({}, async ({ base, upstreamCalls }) => {
    assert.equal((await post(base, okBody())).status, 200);
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${DEVICE_TOKEN}` },
      body: JSON.stringify(okBody()),
    });
    assert.equal(res.status, 200);
    assert.equal(upstreamCalls.length, 2);
  });
});

// ── 3. model allowlist ───────────────────────────────────────────────────────

test("model allowlist blocks anything not priced — the anti-bill-shock control", async () => {
  await withRelay({}, async ({ base, upstreamCalls }) => {
    for (const model of ["claude-fable-5", "claude-opus-4-8", "gpt-4", "", null, undefined]) {
      const res = await post(base, okBody({ model }));
      assert.equal(res.status, 400, `${model} must be rejected`);
      const json = await res.json();
      assert.equal(json.error, "model not allowed");
      assert.deepEqual(json.allowed, ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);
    }
    assert.equal(upstreamCalls.length, 0);
  });
});

test("the three allowed models pass", async () => {
  await withRelay({}, async ({ base, upstreamCalls }) => {
    for (const model of ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]) {
      assert.equal((await post(base, okBody({ model }))).status, 200);
    }
    assert.equal(upstreamCalls.length, 3);
  });
});

// ── 4. max_tokens ceiling ────────────────────────────────────────────────────

test("max_tokens is clamped server-side regardless of what the client asked", async () => {
  await withRelay({ maxTokens: 512 }, async ({ base, upstreamCalls }) => {
    await post(base, okBody({ max_tokens: 100000 }));
    assert.equal(JSON.parse(upstreamCalls[0].body).max_tokens, 512, "ceiling wins");

    await post(base, okBody({ max_tokens: 64 }));
    assert.equal(JSON.parse(upstreamCalls[1].body).max_tokens, 64, "a lower ask is honoured");

    await post(base, okBody({ max_tokens: undefined }));
    assert.equal(JSON.parse(upstreamCalls[2].body).max_tokens, 512, "absent => ceiling");
  });
});

// ── 5. budget ────────────────────────────────────────────────────────────────

test("over budget => 429 with an honest reason, and NO upstream call", async () => {
  await withRelay(
    { caps: { monthlyUsd: 100, dailyUsd: 100, perRequestUsd: 0.0000001 } },
    async ({ base, upstreamCalls }) => {
      const res = await post(base, okBody());
      assert.equal(res.status, 429);
      const json = await res.json();
      assert.equal(json.scope, "per-request");
      assert.match(json.reason, /per-request cap/);
      assert.equal(upstreamCalls.length, 0, "the whole point: denial spends nothing");
    }
  );
});

test("a spent daily cap denies, and says when it resets", async () => {
  const today = new Date().toISOString();
  await withRelay(
    {
      caps: { monthlyUsd: 100, dailyUsd: 1, perRequestUsd: 100 },
      seedRows: [{ at: today, model: "claude-opus-5", usd: 0.999999, outcome: "ok" }],
    },
    async ({ base, upstreamCalls }) => {
      const res = await post(base, okBody());
      assert.equal(res.status, 429);
      const json = await res.json();
      assert.equal(json.scope, "daily");
      assert.match(json.reason, /midnight UTC/);
      assert.equal(res.headers.get("retry-after"), "3600");
      assert.equal(upstreamCalls.length, 0);
    }
  );
});

test("a spent monthly cap denies", async () => {
  await withRelay(
    {
      caps: { monthlyUsd: 1, dailyUsd: 100, perRequestUsd: 100 },
      seedRows: [{ at: new Date().toISOString(), model: "claude-opus-5", usd: 0.999999, outcome: "ok" }],
    },
    async ({ base, upstreamCalls }) => {
      const res = await post(base, okBody());
      assert.equal(res.status, 429);
      assert.equal((await res.json()).scope, "monthly");
      assert.equal(upstreamCalls.length, 0);
    }
  );
});

test("prior spend survives a restart — the ledger replays its own file", async () => {
  await withRelay(
    {
      caps: { monthlyUsd: 100, dailyUsd: 100, perRequestUsd: 100 },
      seedRows: [
        { at: new Date().toISOString(), model: "claude-opus-5", usd: 0.25, outcome: "ok" },
        { at: new Date().toISOString(), model: "claude-opus-5", usd: 0.25, outcome: "ok" },
        "{ this line is torn",
      ],
    },
    async ({ ledger }) => {
      assert.equal(Number(ledger.today.toFixed(4)), 0.5, "a torn line is skipped, not fatal");
    }
  );
});

// ── 6/7. forwarding and accounting ───────────────────────────────────────────

test("usage accounting counts cache tokens, which bill differently and are easy to miss", async () => {
  const reply = anthropicReply({
    model: "claude-opus-5",
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 4000,
    },
  });
  await withRelay({ reply }, async ({ base, usageFile }) => {
    await post(base, okBody({ model: "claude-opus-5" }));
    const rows = fs.readFileSync(usageFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const row = rows.at(-1);
    assert.equal(row.cacheWrite, 2000);
    assert.equal(row.cacheRead, 4000);

    // Opus 5: $5/MTok in, $25/MTok out. Cache write 2x input, read 0.1x input.
    // (1000*5 + 500*25 + 2000*10 + 4000*0.5) / 1e6
    const expected = (1000 * 5 + 500 * 25 + 2000 * 5 * 2 + 4000 * 5 * 0.1) / 1_000_000;
    assert.ok(Math.abs(row.usd - expected) < 1e-9, `${row.usd} ≈ ${expected}`);
  });
});

test("a naive meter that ignored cache tokens would under-count — proving they matter", () => {
  const usage = { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 50_000, cache_read_input_tokens: 0 };
  const naive = (100 * 5 + 10 * 25) / 1_000_000;
  assert.ok(costUsd("claude-opus-5", usage) > naive * 100, "cache writes dominate this bill");
});

test("the estimate used for admission is an UPPER bound on the actual", async () => {
  const body = JSON.stringify(okBody({ model: "claude-opus-5", max_tokens: 1000 }));
  const estimate = estimateCostUsd("claude-opus-5", Buffer.byteLength(body), 1000);
  const actual = costUsd("claude-opus-5", { input_tokens: Math.ceil(Buffer.byteLength(body) / 3.5), output_tokens: 400 });
  assert.ok(estimate >= actual, "admission control must never under-estimate");
});

test("the request is forwarded to /v1/messages with the REAL key swapped in", async () => {
  await withRelay({}, async ({ base, upstreamCalls }) => {
    await post(base, okBody());
    const call = upstreamCalls[0];
    assert.equal(call.url, "/v1/messages");
    assert.equal(call.headers["x-api-key"], REAL_KEY, "upstream sees the real key");
    assert.equal(call.headers["anthropic-version"], "2023-06-01");
  });
});

test("the device token is NOT forwarded upstream", async () => {
  await withRelay({}, async ({ base, upstreamCalls }) => {
    await post(base, okBody());
    const serialized = JSON.stringify(upstreamCalls[0].headers);
    assert.ok(!serialized.includes(DEVICE_TOKEN), "the device token stops at the relay");
  });
});

// ── the key must never escape ────────────────────────────────────────────────

test("the upstream key appears in NO response body on any path", async () => {
  const paths = [];
  await withRelay({ caps: { monthlyUsd: 100, dailyUsd: 100, perRequestUsd: 0.0000001 } }, async ({ base }) => {
    paths.push(await (await post(base, okBody())).text());               // 429
    paths.push(await (await post(base, okBody(), { "x-api-key": "no" })).text()); // 401
    paths.push(await (await post(base, okBody({ model: "gpt-4" }))).text());      // 400
    paths.push(await (await post(base, "not json")).text());                      // 400
    paths.push(await (await fetch(`${base}/healthz`)).text());                     // 200
    paths.push(await (await fetch(`${base}/nope`)).text());                        // 404
  });
  await withRelay({ status: 500, reply: { error: "upstream exploded" } }, async ({ base }) => {
    paths.push(await (await post(base, okBody())).text());
  });
  for (const body of paths) {
    assert.ok(!body.includes(REAL_KEY), `key leaked into: ${body.slice(0, 120)}`);
    assert.ok(!body.includes("sk-ant"), `key-shaped string leaked into: ${body.slice(0, 120)}`);
  }
});

test("an upstream failure is not forwarded verbatim — its message could carry request detail", async () => {
  await withRelay(
    { upstreamHandler: (req, res) => { res.destroy(); } },
    async ({ base }) => {
      const res = await post(base, okBody());
      assert.equal(res.status, 502);
      assert.deepEqual(await res.json(), { error: "upstream unreachable" });
    }
  );
});

test("no request or response CONTENT is written to the usage file — this is health data", async () => {
  const secret = "I ate 3200 kcal and weigh 240lb";
  await withRelay(
    { reply: anthropicReply({ content: [{ type: "text", text: "you ate too much" }] }) },
    async ({ base, usageFile }) => {
      await post(base, okBody({ messages: [{ role: "user", content: secret }] }));
      const written = fs.readFileSync(usageFile, "utf8");
      assert.ok(!written.includes(secret), "no request content");
      assert.ok(!written.includes("you ate too much"), "no response content");
      assert.ok(!written.includes(REAL_KEY), "no key");
      assert.ok(written.includes('"usd"'), "but the money IS recorded");
    }
  );
});

// ── config refuses to boot unsafely ──────────────────────────────────────────

test("the relay refuses to start without both secrets", () => {
  assert.throws(() => loadConfig({ RELAY_TOKEN: DEVICE_TOKEN }), /ANTHROPIC_API_KEY/);
  assert.throws(() => loadConfig({ ANTHROPIC_API_KEY: REAL_KEY }), /RELAY_TOKEN/);
  assert.throws(() => loadConfig({}), /ANTHROPIC_API_KEY and RELAY_TOKEN/);
});

test("the relay refuses a device token that IS the Anthropic key — an easy 1am mistake", () => {
  assert.throws(
    () => loadConfig({ ANTHROPIC_API_KEY: REAL_KEY, RELAY_TOKEN: REAL_KEY }),
    /must not equal ANTHROPIC_API_KEY/
  );
});

test("the relay refuses a guessably short device token", () => {
  assert.throws(
    () => loadConfig({ ANTHROPIC_API_KEY: REAL_KEY, RELAY_TOKEN: "short" }),
    /at least 32 characters/
  );
});

test("redactedSummary reports secrets by length only", () => {
  const { redactedSummary } = require("../src/config.js");
  const cfg = loadConfig({ ANTHROPIC_API_KEY: REAL_KEY, RELAY_TOKEN: DEVICE_TOKEN });
  const printed = JSON.stringify(redactedSummary(cfg));
  assert.ok(!printed.includes(REAL_KEY));
  assert.ok(!printed.includes(DEVICE_TOKEN));
  assert.ok(printed.includes(`"apiKeyLength":${REAL_KEY.length}`));
});
