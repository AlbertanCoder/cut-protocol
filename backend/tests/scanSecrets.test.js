// Regression guard for the Stage 2 (v2) secret scanner. The scanner is a
// repo-root ESM script; this backend CJS test dynamic-imports its exports.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const SCANNER = path.resolve(__dirname, "../../scripts/scanSecrets.mjs");
const load = () => import(pathToFileURL(SCANNER).href);

test("scanSecrets RULES: catch real-shaped secrets", async () => {
  const { RULES } = await load();
  const byId = (id) => RULES.find((r) => r.id === id).re;
  assert.ok(byId("anthropic-key").test("ANTHROPIC_API_KEY=sk-ant-api03-" + "A".repeat(45)));
  assert.ok(byId("jwt-secret-filled").test("JWT_SECRET=" + "a1b2".repeat(10)));
  assert.ok(byId("usda-key-filled").test("USDA_API_KEY=" + "K".repeat(30)));
  assert.ok(byId("private-key-block").test("-----BEGIN OPENSSH PRIVATE KEY-----")); // scan:allow (test fixture, not a real key)
  assert.ok(byId("aws-access-key").test("AKIA" + "ABCDEFGH12345678"));
});

test("scanSecrets PLACEHOLDER: skips examples/dummies, not real values", async () => {
  const { PLACEHOLDER } = await load();
  assert.ok(PLACEHOLDER.test("JWT_SECRET=change-me"));
  assert.ok(PLACEHOLDER.test("SEED_PASSWORD=your-real-password"));
  assert.ok(PLACEHOLDER.test("JWT_SECRET: ci-only-not-a-real-secret"));
  assert.ok(PLACEHOLDER.test("SEED_EMAIL=you@example.com"));
  assert.ok(!PLACEHOLDER.test("JWT_SECRET=" + "a1b2c3d4".repeat(8)), "a real hex secret is NOT a placeholder");
  assert.ok(!PLACEHOLDER.test("sk-ant-api03-" + "Z".repeat(50)), "a real key is NOT a placeholder");
});

test("scanSecrets scanPaths: flags a real secret, clears a placeholder-only file", async () => {
  const { scanPaths } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-scan-"));
  try {
    const bad = path.join(dir, "leak.env");
    const good = path.join(dir, "placeholders.env");
    fs.writeFileSync(bad, "ANTHROPIC_API_KEY=sk-ant-api03-" + "Z".repeat(50) + "\n");
    fs.writeFileSync(good, "JWT_SECRET=change-me\nANTHROPIC_API_KEY=\nUSDA_API_KEY=\n");
    const badFindings = scanPaths([bad]);
    assert.ok(badFindings.length >= 1, "real key flagged");
    assert.equal(badFindings[0].rule, "anthropic-key");
    assert.equal(scanPaths([good]).length, 0, "placeholder + empty keys are clean");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scanSecrets scanPaths: skips a binary blob (NUL byte), never crashes", async () => {
  const { scanPaths } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-scan-"));
  try {
    const blob = path.join(dir, "data.bin");
    // a NUL-containing buffer that also holds a key-shaped string → still skipped
    fs.writeFileSync(blob, Buffer.concat([Buffer.from("sk-ant-api03-" + "Q".repeat(40)), Buffer.from([0]), Buffer.from("more")]));
    assert.equal(scanPaths([blob]).length, 0, "binary files are skipped");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
