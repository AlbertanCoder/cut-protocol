const { test } = require("node:test");
const assert = require("node:assert/strict");

const { llmAvailability, FEATURES } = require("../../src/lib/brain/governance.js");

// ─────────────────────────────────────────────────────────────────────────────
// M2 — THE GATE. Regression lock for root cause #1 of autopsy-20260727-0126.
//
// governance.js refused every governed feature with reason "no-api-key" whenever
// process.env.ANTHROPIC_API_KEY was absent — and it did so BEFORE the
// relay-aware isBrainEnabled() below it could speak. A packaged install ships no
// key BY DESIGN (the relay exists precisely to replace it), so in the only build
// the owner actually runs, all four features 503'd while the app's own status
// route reported {"enabled":true,"reason":"ok"}.
//
// These tests pin the two transports llm.js:91 accepts, and pin the direction of
// failure: with NEITHER transport the gate still refuses, 503, fail-closed.
//
// NOTHING HERE TOUCHES THE NETWORK. llmAvailability() reads env and returns a
// verdict; no Anthropic client is constructed and no ledger row is written.
// ─────────────────────────────────────────────────────────────────────────────

const GOVERNED = Object.keys(FEATURES); // chat, critic, classify, recipeDrafts

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const out = fn();
  return out && typeof out.then === "function" ? out.finally(restore) : (restore(), out);
}

// Every case sets all four vars explicitly — the gate must never be decided by
// whatever happened to be in the ambient environment.
const KEY_ONLY = {
  ANTHROPIC_API_KEY: "test-key-not-used", BRAIN: "on",
  BRAIN_RELAY_URL: undefined, BRAIN_RELAY_TOKEN: undefined, AI_RECIPE_DRAFTS: undefined,
};
const RELAY_ONLY = {
  ANTHROPIC_API_KEY: undefined, BRAIN: "on",
  BRAIN_RELAY_URL: "https://relay.example.com", BRAIN_RELAY_TOKEN: "device-token-not-used",
  AI_RECIPE_DRAFTS: undefined,
};
const NEITHER = {
  ANTHROPIC_API_KEY: undefined, BRAIN: "on",
  BRAIN_RELAY_URL: undefined, BRAIN_RELAY_TOKEN: undefined, AI_RECIPE_DRAFTS: undefined,
};

test("M2 (key transport): a direct key with no relay arms every governed feature", () => {
  withEnv(KEY_ONLY, () => {
    for (const f of GOVERNED) {
      const a = llmAvailability(f);
      assert.equal(a.enabled, true, `${f} must be enabled on a direct key`);
    }
  });
});

test("M2 (relay transport): NO key + a complete relay arms every governed feature — the packaged-install case", () => {
  withEnv(RELAY_ONLY, () => {
    for (const f of GOVERNED) {
      const a = llmAvailability(f);
      assert.equal(
        a.enabled, true,
        `${f} was refused with reason="${a.reason}" despite a configured relay — this is the exact regression that made every packaged install 503`
      );
    }
  });
});

test("M2 (fail-closed): NEITHER a key NOR a relay refuses 503 on every governed feature", () => {
  withEnv(NEITHER, () => {
    for (const f of GOVERNED) {
      const a = llmAvailability(f);
      assert.equal(a.enabled, false, `${f} must refuse with no transport at all`);
      assert.equal(a.reason, "no-api-key");
      assert.equal(a.status, 503);
      assert.match(a.message, /no API key is configured/i);
      assert.doesNotMatch(a.message, /sk-ant|device-token|relay\.example/, "a refusal must never echo credential or endpoint material");
    }
  });
});

test("M2 (uniformity): all four governed features return the identical verdict for a given transport state", () => {
  for (const env of [KEY_ONLY, RELAY_ONLY, NEITHER]) {
    withEnv(env, () => {
      const verdicts = GOVERNED.map((f) => llmAvailability(f).enabled);
      assert.equal(
        new Set(verdicts).size, 1,
        `features disagreed for the same transport state: ${JSON.stringify(Object.fromEntries(GOVERNED.map((f, i) => [f, verdicts[i]])))}`
      );
    });
  }
});

// ── The relay must be a COMPLETE, LEGAL relay — llm.js relayConfig() rules ──
// These pin that M2 widened the gate by exactly one transport and not by an
// inch more. Each of these is "configured" only in the loosest sense, and each
// must still fail closed.

test("M2 (fail-closed): half a relay is not a relay — URL without token still refuses", () => {
  withEnv({ ...NEITHER, BRAIN_RELAY_URL: "https://relay.example.com" }, () => {
    const a = llmAvailability("recipeDrafts");
    assert.equal(a.enabled, false);
    assert.equal(a.reason, "no-api-key");
  });
});

test("M2 (fail-closed): a token without a URL still refuses", () => {
  withEnv({ ...NEITHER, BRAIN_RELAY_TOKEN: "device-token-not-used" }, () => {
    const a = llmAvailability("recipeDrafts");
    assert.equal(a.enabled, false);
    assert.equal(a.reason, "no-api-key");
  });
});

test("M2 (fail-closed): cleartext http to a NON-loopback host is not a usable relay", () => {
  withEnv({ ...RELAY_ONLY, BRAIN_RELAY_URL: "http://relay.example.com" }, () => {
    const a = llmAvailability("recipeDrafts");
    assert.equal(a.enabled, false, "a token must never be sent to a public host in cleartext");
    assert.equal(a.reason, "no-api-key");
  });
});

test("M2 (loopback exception preserved): http on loopback IS a usable relay", () => {
  withEnv({ ...RELAY_ONLY, BRAIN_RELAY_URL: "http://127.0.0.1:8787" }, () => {
    assert.equal(llmAvailability("recipeDrafts").enabled, true);
  });
});

// ── BRAIN=on remains a required, explicit opt-in ────────────────────────────
// Widening the transport test must not turn the relay into a second on-switch.

test("M2 (opt-in preserved): a relay with BRAIN unset does NOT arm the brain-gated features", () => {
  withEnv({ ...RELAY_ONLY, BRAIN: undefined }, () => {
    for (const f of ["chat", "critic", "classify"]) {
      const a = llmAvailability(f);
      assert.equal(a.enabled, false, `${f} must stay off until BRAIN=on`);
      assert.equal(a.reason, "feature-off", `${f} must refuse as switched-off, not as keyless`);
    }
  });
});

test("M2 (per-feature flag preserved): a relay + AI_RECIPE_DRAFTS=on arms drafting without waking the brain", () => {
  withEnv({ ...RELAY_ONLY, BRAIN: undefined, AI_RECIPE_DRAFTS: "on" }, () => {
    assert.equal(llmAvailability("recipeDrafts").enabled, true);
    assert.equal(llmAvailability("chat").enabled, false);
  });
});

test("M2 (registry): an unregistered feature is still refused regardless of transport", () => {
  withEnv(RELAY_ONLY, () => {
    const a = llmAvailability("not-a-real-feature");
    assert.equal(a.enabled, false);
    assert.equal(a.reason, "unknown-feature");
  });
});
