const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { LLM_CALL_SITES, FEATURES } = require("../src/lib/brain/governance.js");

// ─────────────────────────────────────────────────────────────────────────────
// THE ANTI-RECURRENCE TEST (fleet finding brain-stack-1).
//
// The bug was not "one route forgot the cost cap". The bug was that the cost
// cap, the gate, the ledger and the guards were things a NEW ROUTE HAD TO
// REMEMBER. POST /api/recipes/generate-drafts didn't, and nothing failed —
// no test, no lint, no review artefact — because governance was wiring, not
// structure. The seven behavioural tests in aiGovernance.test.js prove that
// route is governed TODAY; this file is what stops the NEXT one repeating it.
//
// It reads source, not behaviour:
//   S1  only the single transport module may import the Anthropic SDK;
//   S2  every module that reaches the transport must be in the call-site
//       registry — an unregistered LLM caller fails the build;
//   S3  every registered call site that a route can reach must show real cost
//       control (governance.js, or ledger.guardedCall — the same enforcement
//       point the pre-existing brain routes wire directly);
//   S4  a call site registered with NO cost control must genuinely be
//       unreachable — the moment anything outside src/lib/brain/ calls it,
//       this fails;
//   S5  the drafting route imports the governed entry point, not a client;
//   S6  the barrel re-exports the transport but never invokes it;
//   S7  every registered feature is default-OFF and reachable only via an
//       explicit opt-in flag.
//
// No network, no database, no model call: this suite only reads files.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = path.join(__dirname, "..");
const SRC = path.join(BACKEND, "src");

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(BACKEND, f).split(path.sep).join("/");
const read = (f) => fs.readFileSync(f, "utf8");
// Comments describe the bug that was fixed; they must not be mistaken for it.
// (This file's own subject matter guarantees the words "new Anthropic()" appear
// in prose right next to the code that no longer does it.)
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// assert.match dumps the whole haystack on failure; on a 250-line source file
// that buries the message. Assert a boolean with a message instead.
const has = (src, re) => re.test(src);

const ALL = jsFiles(SRC);
const TRANSPORT_MODULE = "src/lib/brain/llm.js";
const TRANSPORT_SYMBOLS = /\b(askJSON|askSchemaJSON|runToolLoop)\b/;
const REQUIRES_TRANSPORT = /require\(["'][^"']*llm\.js["']\)/;

// A module "reaches the transport" if it requires llm.js AND names one of the
// transport functions. (Requiring llm.js only for isBrainEnabled/DEPTH_PROFILES
// is not a call site — planner.js and routes/brain.js do exactly that.)
const transportUsers = ALL.filter((f) => rel(f) !== TRANSPORT_MODULE && REQUIRES_TRANSPORT.test(read(f)) && TRANSPORT_SYMBOLS.test(read(f))).map(rel);

test("S1: only the single transport module may import the Anthropic SDK", () => {
  const importers = ALL.filter((f) => /require\(["']@anthropic-ai\/sdk["']\)/.test(read(f))).map(rel);
  assert.deepEqual(
    importers,
    [TRANSPORT_MODULE],
    `A second Anthropic client exists. Every model call must go through ${TRANSPORT_MODULE} — that is the only place a timeout, a mock seam and the governed wrapper can be applied. This is exactly how POST /api/recipes/generate-drafts became an ungoverned second LLM stack.`
  );
});

test("S2: every module that reaches the model transport is in the call-site registry", () => {
  const registered = new Set(LLM_CALL_SITES.map((s) => s.module));
  const unregistered = transportUsers.filter((m) => !registered.has(m));
  assert.deepEqual(
    unregistered,
    [],
    `Unregistered LLM call site(s): ${unregistered.join(", ")}. Add each to LLM_CALL_SITES in src/lib/brain/governance.js AND route it through governedModelCall() — an LLM call the registry doesn't know about is an LLM call nobody is metering.`
  );
});

test("S2b: the registry has no stale entries (every registered module still exists and still calls the transport)", () => {
  for (const site of LLM_CALL_SITES) {
    const abs = path.join(BACKEND, site.module);
    assert.ok(fs.existsSync(abs), `registry entry "${site.id}" points at a missing file: ${site.module}`);
    assert.ok(transportUsers.includes(site.module), `registry entry "${site.id}" (${site.module}) no longer reaches the transport — remove it so the registry stays an honest map`);
  }
});

test("S3: every governed call site shows real cost control in its source", () => {
  const evidence = {
    governance: /require\(["'][^"']*governance\.js["']\)/,
    "ledger.guardedCall": /require\(["'][^"']*ledger\.js["']\)[\s\S]*guardedCall|guardedCall[\s\S]*require\(["'][^"']*ledger\.js["']\)/,
  };
  for (const site of LLM_CALL_SITES) {
    if (site.costControl === "none" || site.costControl === "n/a") continue;
    const src = code(path.join(BACKEND, site.module));
    const re = evidence[site.costControl];
    assert.ok(re, `unknown costControl "${site.costControl}" on ${site.id}`);
    assert.ok(has(src, re), `${site.id} (${site.module}) claims costControl "${site.costControl}" but its source shows no such wiring — an unmetered model call.`);
  }
});

test("S3b: every call site that serves an HTTP route declares a gate feature and a cost control", () => {
  for (const site of LLM_CALL_SITES) {
    if (!site.route) continue;
    assert.ok(site.feature, `${site.id} serves ${site.route} but declares no gate feature — it would run whether or not the AI layer is armed`);
    assert.ok(FEATURES[site.feature], `${site.id} declares feature "${site.feature}", which is not in the FEATURES table`);
    assert.notEqual(site.costControl, "none", `${site.id} serves ${site.route} with NO cost cap — that is the brain-stack-1 bug`);
  }
});

test("S4: a call site registered with no cost control must be genuinely unreachable (dormant)", () => {
  // The claim "dormant" is not taken on trust: if anything outside
  // src/lib/brain/ ever calls one of these entry points, it has become a live,
  // unmetered path and this test fails on the spot.
  const outsideBrain = ALL.filter((f) => !rel(f).startsWith("src/lib/brain/"));
  for (const site of LLM_CALL_SITES) {
    if (site.costControl !== "none") continue;
    assert.equal(site.dormant, true, `${site.id} has no cost control and is not marked dormant`);
    const callRe = new RegExp(`\\b${site.entry}\\s*\\(`);
    const callers = outsideBrain.filter((f) => callRe.test(read(f))).map(rel);
    assert.deepEqual(
      callers,
      [],
      `${site.id} is registered as DORMANT with no cost cap, but ${callers.join(", ")} now calls ${site.entry}(). Wire it through governedModelCall() before using it — a live model call with no cap is a money bleed.`
    );
  }
});

test("S5: the recipe-drafting route calls the governed entry point, never a raw client", () => {
  const route = code(path.join(SRC, "routes", "recipes.js"));
  assert.ok(has(route, /require\(["']\.\.\/lib\/aiRecipeClient\.js["']\)/), "the route must use the governed drafting entry point");
  assert.ok(!has(route, /@anthropic-ai\/sdk/), "the route must never construct its own model client");
  assert.ok(has(route, /isGovernance/), "the route must render a governance refusal as its honest status, not as a 500");

  const client = code(path.join(SRC, "lib", "aiRecipeClient.js"));
  assert.ok(has(client, /governedModelCallOrThrow|governedModelCall/), "the drafting client must go through the governed wrapper");
  assert.ok(!has(client, /new Anthropic\s*\(/), "the drafting client must not construct an SDK client");
});

test("S6: the brain barrel re-exports the transport but never invokes it", () => {
  const barrel = code(path.join(SRC, "lib", "brain", "index.js"));
  for (const sym of ["askJSON", "askSchemaJSON", "runToolLoop"]) {
    assert.ok(!has(barrel, new RegExp(`(await\\s+)?${sym}\\s*\\(`)), `brain/index.js invokes ${sym}() — the barrel must only re-export, so it is not itself an ungoverned call site`);
  }
});

test("S7: every registered feature is OFF unless an explicit flag is set", () => {
  const src = code(path.join(SRC, "lib", "brain", "governance.js"));
  // The gate must require a key AND an explicit opt-in; there is no default-on
  // branch and no implicit fallback.
  assert.ok(has(src, /if \(!process\.env\.ANTHROPIC_API_KEY\)/), "the keyless refusal must be the first thing the gate does");
  assert.ok(has(src, /isBrainEnabled\(\)/), "the gate must reuse the single BRAIN=on implementation, not re-derive it");
  for (const [name, f] of Object.entries(FEATURES)) {
    assert.ok(f.flag === null || typeof f.flag === "string", `feature "${name}" has a malformed flag`);
    if (typeof f.flag === "string") {
      assert.notEqual(process.env[f.flag], "on", `feature "${name}" is armed in the ambient test environment via ${f.flag} — tests must not depend on that`);
    }
  }
});

test("S8: BRAIN=off keeps the whole LLM layer dormant — no call site is armed", () => {
  const saved = { BRAIN: process.env.BRAIN, KEY: process.env.ANTHROPIC_API_KEY };
  const flags = Object.values(FEATURES).map((f) => f.flag).filter(Boolean);
  const savedFlags = Object.fromEntries(flags.map((f) => [f, process.env[f]]));
  try {
    process.env.ANTHROPIC_API_KEY = "test-key-not-used";
    delete process.env.BRAIN;
    for (const f of flags) delete process.env[f];

    const { isBrainEnabled } = require("../src/lib/brain/llm.js");
    const { isFeatureEnabled } = require("../src/lib/brain/governance.js");
    assert.equal(isBrainEnabled(), false, "BRAIN unset must leave the brain off");
    for (const feature of Object.keys(FEATURES)) {
      assert.equal(isFeatureEnabled(feature), false, `feature "${feature}" is live with BRAIN off — the staged build must stay dormant`);
    }
  } finally {
    if (saved.BRAIN === undefined) delete process.env.BRAIN; else process.env.BRAIN = saved.BRAIN;
    if (saved.KEY === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.KEY;
    for (const [k, v] of Object.entries(savedFlags)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
