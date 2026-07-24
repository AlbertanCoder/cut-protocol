// Unit tests for the offline entitlement gate — electron/license.cjs.
//
// The gate is deliberately simple, which is exactly why it needs tests: a
// signature check that silently accepts everything is worse than no check,
// because it looks like protection. These exercise the REAL verifier against
// a throwaway Ed25519 keypair generated here (no key material in the repo).
//
// Note the default-state test: with no public key compiled in, the gate is
// INERT and must report ok. A shipped build that suddenly refused to start
// because licensing was never configured would be a self-inflicted outage.
//
// No electron, no filesystem, no network — verifyKeyString is pure.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { verifyKeyString } = require("../../electron/license.cjs");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUB_B64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Mint a key exactly the way electron/licenseTool.cjs does. */
function mint(payload, signer = privateKey) {
  const buf = Buffer.from(JSON.stringify(payload), "utf8");
  return `CP1.${b64url(buf)}.${b64url(crypto.sign(null, buf, signer))}`;
}

test("DEFAULT STATE: with no public key configured the gate is inert, not blocking", () => {
  // This is the state of the repo as committed. It must never brick a build.
  const res = verifyKeyString("anything at all");
  assert.equal(res.ok, true);
  assert.equal(res.state, "unconfigured");
});

test("a properly signed key verifies and names the licensee", () => {
  const key = mint({ licensee: "Jane Doe", plan: "personal", issued: "2026-07-23" });
  const res = verifyKeyString(key, { publicKeyB64: PUB_B64 });
  assert.equal(res.ok, true);
  assert.equal(res.state, "licensed");
  assert.equal(res.licensee, "Jane Doe");
});

test("a key signed by SOMEONE ELSE'S private key is rejected", () => {
  const other = crypto.generateKeyPairSync("ed25519").privateKey;
  const forged = mint({ licensee: "Attacker" }, other);
  const res = verifyKeyString(forged, { publicKeyB64: PUB_B64 });
  assert.equal(res.ok, false);
  assert.equal(res.state, "invalid");
});

test("editing the payload after signing invalidates the key", () => {
  const key = mint({ licensee: "Jane Doe", plan: "personal" });
  const [prefix, payloadB64, sig] = key.split(".");
  const tampered = Buffer.from(JSON.stringify({ licensee: "Jane Doe", plan: "enterprise" }), "utf8");
  assert.notEqual(b64url(tampered), payloadB64, "the tampered payload must actually differ");
  const res = verifyKeyString(`${prefix}.${b64url(tampered)}.${sig}`, { publicKeyB64: PUB_B64 });
  assert.equal(res.ok, false);
  assert.equal(res.state, "invalid");
});

test("an expired key is rejected, and says when it expired", () => {
  const key = mint({ licensee: "Jane Doe", exp: "2020-01-01" });
  const res = verifyKeyString(key, { publicKeyB64: PUB_B64 });
  assert.equal(res.ok, false);
  assert.equal(res.state, "expired");
  assert.match(res.reason, /2020-01-01/);
});

test("a key whose expiry is still in the future verifies", () => {
  const key = mint({ licensee: "Jane Doe", exp: "2099-01-01" });
  const res = verifyKeyString(key, { publicKeyB64: PUB_B64 });
  assert.equal(res.ok, true);
  assert.equal(res.expires, "2099-01-01");
});

test("garbage input is a clean refusal, never a throw", () => {
  for (const bad of ["", null, undefined, "CP1.only-two-parts", "XX1.a.b", "CP1.!!!.???", "CP1..", 42, {}]) {
    const res = verifyKeyString(bad, { publicKeyB64: PUB_B64 });
    assert.equal(res.ok, false, `expected refusal for ${JSON.stringify(bad)}`);
    assert.ok(typeof res.reason === "string" && res.reason.length > 0, "a refusal must say why");
  }
});

test("a valid signature over non-JSON is refused rather than trusted", () => {
  const buf = Buffer.from("not json at all", "utf8");
  const key = `CP1.${b64url(buf)}.${b64url(crypto.sign(null, buf, privateKey))}`;
  const res = verifyKeyString(key, { publicKeyB64: PUB_B64 });
  assert.equal(res.ok, false);
  assert.equal(res.state, "malformed");
});
