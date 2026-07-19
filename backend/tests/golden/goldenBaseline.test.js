const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Force the deterministic (BRAIN=off) path regardless of the ambient shell —
// guards against a dev environment that happens to export BRAIN=on + a key.
// This test defines the meaning of "the app with the brain off": every later
// Brain-v3 stage must keep this output byte-identical.
process.env.BRAIN = "off";

const { computeBaseline } = require("./fixtures.js");

const GOLDEN_PATH = path.join(__dirname, "engine-baseline.golden.json");
const REGEN = `cd backend && BRAIN=off node -e "require('./tests/golden/fixtures').computeBaseline().then(o=>require('fs').writeFileSync('tests/golden/engine-baseline.golden.json', JSON.stringify(o,null,2)+'\\n'))"`;

test("golden: BRAIN=off engine output is byte-identical to the locked baseline", async () => {
  assert.ok(fs.existsSync(GOLDEN_PATH), `missing golden baseline — regenerate with:\n  ${REGEN}`);
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
  const actual = await computeBaseline();

  // Section-by-section, serialized identically on both sides — a true byte-level
  // compare that is also robust to undefined/key-order and gives a scoped diff.
  for (const section of ["solver", "grocery", "trend", "diary"]) {
    const got = JSON.stringify(actual[section], null, 2);
    const want = JSON.stringify(golden[section], null, 2);
    assert.equal(got, want, `${section} output drifted from the locked BRAIN=off baseline. If this change is intentional, regenerate:\n  ${REGEN}`);
  }
});
