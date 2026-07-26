// Stage 3 — desktop relay config (<userData>/brain.json).
//
// The claim these tests exist to defend is the DoD's first line: on a fresh
// profile with no brain.json, the app is byte-identical to one that never had
// this feature. Everything else here is about the failure modes of a config
// file a human types into by hand.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const store = require("../../src/lib/brainRelayConfig.js");
const { isBrainEnabled, __setClient } = require("../../src/lib/brain/llm.js");

const ENV_KEYS = [
  "BRAIN", "ANTHROPIC_API_KEY", "BRAIN_RELAY_URL", "BRAIN_RELAY_TOKEN",
  "CUT_PROTOCOL_USERDATA", "CUT_PROTOCOL_DB_PATH",
];

// Each case gets a throwaway userData dir and a clean env. Without the reset,
// a case that writes a config leaks BRAIN=on into the next one.
function withProfile(fn, { seed = null, env = {} } = {}) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-userdata-"));
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.CUT_PROTOCOL_USERDATA = dir;
    Object.assign(process.env, env);
    if (seed !== null) {
      fs.writeFileSync(path.join(dir, "brain.json"), typeof seed === "string" ? seed : JSON.stringify(seed));
    }
    __setClient(null);
    return fn({ dir, file: path.join(dir, "brain.json") });
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __setClient(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = { relayUrl: "https://relay.example.com", relayToken: "device-token-0123456789abcdef" };

// ── the degrade path: a fresh profile behaves exactly like today ─────────────

test("no brain.json: nothing is set, the brain stays off, and the reason is honest", () => {
  withProfile(() => {
    const r = store.applyToEnv();
    assert.equal(r.applied, false);
    assert.equal(process.env.BRAIN, undefined, "BRAIN untouched — no silent opt-in");
    assert.equal(process.env.BRAIN_RELAY_URL, undefined);
    assert.equal(isBrainEnabled(), false);
    assert.deepEqual(store.status(), { enabled: false, reason: "no-config" });
  });
});

test("a malformed brain.json degrades to off — it never takes the app down with it", () => {
  for (const junk of ["{ not json", "null", "[]", '"a string"', ""]) {
    withProfile(({ file }) => {
      assert.ok(fs.existsSync(file));
      assert.doesNotThrow(() => store.applyToEnv(), `junk: ${JSON.stringify(junk)}`);
      assert.equal(isBrainEnabled(), false);
      // The file EXISTS but is unusable — the user gets told that, rather than
      // "no config", which would send them looking for a file that is right
      // there.
      assert.deepEqual(store.status(), { enabled: false, reason: "incomplete-config" });
    }, { seed: junk });
  }
});

test("a half-filled brain.json is incomplete-config, not a working relay", () => {
  for (const partial of [
    { relayUrl: "https://relay.example.com" },
    { relayToken: "device-token-0123456789abcdef" },
    { relayUrl: "  ", relayToken: "  " },
    { relayUrl: 42, relayToken: true },
  ]) {
    withProfile(() => {
      store.applyToEnv();
      assert.equal(isBrainEnabled(), false);
      assert.equal(store.status().reason, "incomplete-config");
    }, { seed: partial });
  }
});

// ── the working path ─────────────────────────────────────────────────────────

test("a complete brain.json turns the brain on with no key present anywhere", () => {
  withProfile(() => {
    assert.equal(store.applyToEnv().applied, true);
    assert.equal(process.env.BRAIN, "on");
    assert.equal(process.env.BRAIN_RELAY_URL, GOOD.relayUrl);
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "the packaged-install condition");
    assert.equal(isBrainEnabled(), true);
    assert.deepEqual(store.status(), { enabled: true, reason: "ok" });
  }, { seed: GOOD });
});

test("applyToEnv never clobbers the environment — an explicit BRAIN=off wins", () => {
  withProfile(() => {
    store.applyToEnv();
    assert.equal(process.env.BRAIN, "off", "a config file must not override an operator's off switch");
    assert.equal(isBrainEnabled(), false);
    assert.equal(store.status().reason, "off", "configured, but deliberately disabled");
  }, { seed: GOOD, env: { BRAIN: "off" } });
});

test("applyToEnv does not overwrite relay values already in the environment", () => {
  withProfile(() => {
    store.applyToEnv();
    assert.equal(process.env.BRAIN_RELAY_URL, "https://from-env.example.com");
  }, { seed: GOOD, env: { BRAIN_RELAY_URL: "https://from-env.example.com" } });
});

// ── writing ──────────────────────────────────────────────────────────────────

test("writeConfig persists, takes effect immediately, and writes exactly two fields", () => {
  withProfile(({ file }) => {
    store.writeConfig(GOOD);
    assert.equal(isBrainEnabled(), true, "live, without a restart");
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(onDisk).sort(), ["relayToken", "relayUrl"], "no extra fields smuggled in");
    assert.equal(onDisk.relayUrl, GOOD.relayUrl);
  });
});

test("writeConfig rejects what the TRANSPORT would reject — no 'saved' that silently never works", () => {
  withProfile(() => {
    // Cleartext http to a public host: refused by relayConfig() in llm.js. If
    // this route validated separately it could accept a config the transport
    // then ignores, and the coach would never appear with no error anywhere.
    assert.throws(
      () => store.writeConfig({ relayUrl: "http://relay.example.com", relayToken: GOOD.relayToken }),
      /https/
    );
    assert.throws(() => store.writeConfig({ relayUrl: "not a url", relayToken: GOOD.relayToken }), /https/);
    assert.throws(() => store.writeConfig({ relayUrl: GOOD.relayUrl, relayToken: "" }), /required/);
    assert.equal(isBrainEnabled(), false);
    assert.equal(store.fileExists(), false, "a rejected config writes no file");
  });
});

test("loopback http IS accepted — this is how a local relay gets tested", () => {
  withProfile(() => {
    store.writeConfig({ relayUrl: "http://127.0.0.1:8787", relayToken: GOOD.relayToken });
    assert.equal(isBrainEnabled(), true);
  });
});

test("writeConfig leaves the environment unchanged when it rejects", () => {
  withProfile(() => {
    try { store.writeConfig({ relayUrl: "http://public.example.com", relayToken: GOOD.relayToken }); } catch { /* expected */ }
    assert.equal(process.env.BRAIN_RELAY_URL, undefined, "no residue from the validation probe");
    assert.equal(process.env.BRAIN_RELAY_TOKEN, undefined);
  });
});

// ── the kill switch ──────────────────────────────────────────────────────────

test("clearConfig kills it in the LIVE process, not just on disk", () => {
  withProfile(({ file }) => {
    store.writeConfig(GOOD);
    assert.equal(isBrainEnabled(), true);

    store.clearConfig();
    assert.equal(fs.existsSync(file), false, "file gone");
    assert.equal(isBrainEnabled(), false, "and off NOW — a kill switch you must reboot to trust is not one");
    assert.deepEqual(store.status(), { enabled: false, reason: "no-config" });
  });
});

test("clearConfig on a profile that never had a config is a no-op, not an error", () => {
  withProfile(() => {
    assert.doesNotThrow(() => store.clearConfig());
    assert.equal(store.status().reason, "no-config");
  });
});

// ── path resolution ──────────────────────────────────────────────────────────

test("the config path is derived from the DB path when USERDATA is absent", () => {
  withProfile(() => {
    delete process.env.CUT_PROTOCOL_USERDATA;
    process.env.CUT_PROTOCOL_DB_PATH = path.join("/some", "userdata", "cutprotocol.db");
    assert.equal(store.configPath(), path.join("/some", "userdata", "brain.json"));
  });
});

test("standalone dev with no path contract writes nowhere rather than guessing", () => {
  withProfile(() => {
    delete process.env.CUT_PROTOCOL_USERDATA;
    // A guessed path would write a file containing a device token somewhere
    // nobody is looking for it.
    assert.equal(store.configPath(), null);
    assert.equal(store.readConfig(), null);
    assert.throws(() => store.writeConfig(GOOD), /no writable config location/);
  });
});

// ── the token is write-only ──────────────────────────────────────────────────

test("no exported function returns the token except the raw file read", () => {
  withProfile(() => {
    store.writeConfig(GOOD);
    const exposed = JSON.stringify({ status: store.status(), path: store.configPath(), exists: store.fileExists() });
    assert.ok(!exposed.includes(GOOD.relayToken), "status/path/exists never carry the credential");
  });
});
