// TASK C — prompt caching was written and never called.
//
// cache.js has shipped a fully-implemented planCacheBreakpoints() since Stage J,
// and prompts/system.js said breakpoints were "wired in Stage J". They were not:
// nothing called it, `cache_control` appeared in zero request bodies, and the
// static PERSONA+SCOPE+LAWS+NARRATION prefix was re-billed at full input price on
// every single turn.
//
// TASK D — model currency. config.js pinned escalation to claude-opus-4-8 while
// claude-opus-5 is current at the SAME $5/$25, and llm.js carried a SECOND
// hardcoded model default that shadowed config.js for any caller omitting
// `model`. Opus 5 and Sonnet 5 also flipped the thinking default to ON, which
// silently eats a 1024-token output budget.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { planCacheBreakpoints, toSystemParam, cachedSystemParam } = require("../../src/lib/brain/cache.js");
const { buildSystemBlocks, buildSystemPrompt, PERSONA, SCOPE, LAWS, NARRATION } = require("../../src/lib/brain/prompts/system.js");
const { MODELS } = require("../../src/lib/brain/config.js");
const { PRICING, costUsd } = require("../../src/lib/brain/pricing.js");
const { thinkingParam, THINKING_OFF_MODELS, DEFAULT_MODEL } = require("../../src/lib/brain/llm.js");
const { brainChat } = require("../../src/lib/brain/chat.js");
const { makeLedger, memoryStore } = require("../../src/lib/brain/ledger.js");

const SRC = path.join(__dirname, "..", "..", "src");
const PROFILE = { dietaryStyle: "vegan", excludedFoods: ["peanuts"], targetKcal: 2000 };

// ── C: the blocks, and the breakpoints on them ───────────────────────────────

test("C1 the static prefix is ONE contiguous block — persona, scope, laws AND narration", () => {
  const [staticBlock] = buildSystemBlocks({ profile: PROFILE, depth: "balanced", toolNames: ["searchRecipes"] });
  assert.equal(staticBlock.role, "static");
  for (const [name, text] of [["PERSONA", PERSONA], ["SCOPE", SCOPE], ["LAWS", LAWS], ["NARRATION", NARRATION]]) {
    assert.ok(staticBlock.text.includes(text), `${name} must sit inside the cacheable static block`);
  }
  assert.equal(/DEPTH:/.test(staticBlock.text), false, "the depth line is volatile and must not contaminate the static prefix");
});

test("C2 the static block is byte-identical across depths AND across profiles (that is what makes it cacheable)", () => {
  const s = (depth, profile) => buildSystemBlocks({ profile, depth, toolNames: ["searchRecipes"] })[0].text;
  assert.equal(s("fast", PROFILE), s("thorough", PROFILE), "depth must not move a byte of the static prefix");
  assert.equal(s("balanced", PROFILE), s("balanced", { dietaryStyle: "keto", excludedFoods: ["dairy"] }), "the profile must not either");
});

test("C3 security ordering survives the reshuffle: laws precede <user_data>, which precedes the tool list", () => {
  const p = buildSystemPrompt({ profile: { mealPreferencesNote: "note" }, toolNames: ["searchRecipes"] });
  const lawsAt = p.indexOf("NON-NEGOTIABLE");
  const dataAt = p.lastIndexOf("<user_data>");
  const toolsAt = p.indexOf("Tools available");
  assert.ok(lawsAt >= 0 && dataAt > lawsAt, "nothing inside <user_data> may precede the laws");
  assert.ok(toolsAt > dataAt);
});

test("C4 breakpoints land on the static and profile blocks, NEVER on the volatile one", () => {
  const planned = planCacheBreakpoints(buildSystemBlocks({ profile: PROFILE, depth: "balanced", toolNames: ["searchRecipes"] }));
  assert.deepEqual(planned.map((b) => [b.role, !!b.cache]), [["static", true], ["profile", true], ["volatile", false]]);
});

test("C5 toSystemParam emits the WIRE form — text blocks with cache_control on the breakpoints", () => {
  const param = cachedSystemParam(buildSystemBlocks({ profile: PROFILE, depth: "fast", toolNames: ["searchRecipes"] }));
  assert.ok(Array.isArray(param), "the system parameter must be a block array, not a string — a string cannot carry cache_control");
  assert.equal(param.length, 3);
  for (const b of param) assert.equal(b.type, "text");
  assert.deepEqual(param[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(param[1].cache_control, { type: "ephemeral" });
  assert.equal("cache_control" in param[2], false, "the volatile block is never cached");
  const marked = param.filter((b) => b.cache_control).length;
  assert.ok(marked <= 4, "the API allows at most 4 breakpoints per request");
});

test("C6 the block form joins back to exactly the string form (no content drift between the two entry points)", () => {
  const opts = { profile: PROFILE, depth: "thorough", toolNames: ["searchRecipes", "searchFoods"] };
  assert.equal(buildSystemBlocks(opts).map((b) => b.text).join("\n\n"), buildSystemPrompt(opts));
});

test("C7 chat.js actually SENDS the cache-marked system param (the step that was missing)", async () => {
  let seenSystem = null;
  await brainChat({ userId: "u", message: "high-protein lunch ideas" }, {
    enabled: true,
    loadProfile: async () => PROFILE,
    loadLibrary: async () => ({ recipes: [], foods: [] }),
    ledger: makeLedger({ store: memoryStore() }),
    classify: null,
    planContext: async () => { throw new Error("no plan context"); },
    runLoop: async ({ system }) => { seenSystem = system; return { content: [{ type: "text", text: "Try lentils." }], usage: {} }; },
  });
  assert.ok(Array.isArray(seenSystem), "the live chat path must send blocks, not a plain string");
  assert.ok(seenSystem.some((b) => b.cache_control), "at least one breakpoint must reach the wire");
});

test("C8 caching is priced correctly: writes at 1.25x input, reads at 0.1x", () => {
  const M = "claude-sonnet-5";
  const inPerM = PRICING[M].inputPerM;
  assert.equal(costUsd(M, { input_tokens: 1_000_000, output_tokens: 0 }), inPerM);
  assert.equal(costUsd(M, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }), inPerM * 1.25);
  // costUsd rounds to the microdollar, so compare within it rather than fighting
  // float noise (3 * 0.1 === 0.30000000000000004).
  assert.ok(Math.abs(costUsd(M, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }) - inPerM * 0.1) < 1e-6);
});

test("C9 MEASURED saving: 100 turns of a ~1200-token static prefix, uncached vs cached", () => {
  const M = MODELS.workhorse;
  const PREFIX = 1200;
  const TURNS = 100;
  const uncached = costUsd(M, { input_tokens: PREFIX * TURNS, output_tokens: 0 });
  // One write (1.25x) + 99 reads (0.1x each).
  const cached = costUsd(M, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: PREFIX, cache_read_input_tokens: PREFIX * (TURNS - 1) });
  assert.ok(cached < uncached * 0.15, `caching must cut the prefix cost by >85%: ${uncached} -> ${cached}`);
  // Break-even is 2 requests inside the 5-minute TTL: 1.25x + 0.1x < 2x.
  const twoUncached = costUsd(M, { input_tokens: PREFIX * 2, output_tokens: 0 });
  const twoCached = costUsd(M, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: PREFIX, cache_read_input_tokens: PREFIX });
  assert.ok(twoCached < twoUncached, "caching must already pay for itself on the SECOND request");
});

test("C10 the cacheable prefix is MEASURED against the model's silent minimum, not assumed", () => {
  // Failing the minimum is silent (cache_creation_input_tokens: 0, no error), so
  // the size has to be pinned or the "89% saving" quietly becomes fiction.
  // Char/3.7 is an estimate — an exact count needs the count_tokens endpoint,
  // i.e. a live API call — so this asserts the BAND, not a single number.
  const { TOOL_DEFS } = require("../../src/lib/brain/selector.js");
  const chatTools = TOOL_DEFS.filter((t) => t.name === "searchRecipes" || t.name === "searchFoods");
  const tok = (chars) => Math.round(chars / 3.7);
  const blocks = buildSystemBlocks({ profile: PROFILE, depth: "balanced", toolNames: chatTools.map((t) => t.name) });
  const toolTok = tok(JSON.stringify(chatTools).length);
  const staticTok = tok(blocks[0].text.length);
  const profileTok = tok(blocks[1].text.length);
  const atProfileBreakpoint = toolTok + staticTok + profileTok;

  // MIN_CACHEABLE_PREFIX by model (platform docs, cached 2026-07):
  const MIN = { "claude-sonnet-5": 1024, "claude-opus-5": 512 };

  assert.ok(atProfileBreakpoint > 600 && atProfileBreakpoint < 1400,
    `prefix estimate ${atProfileBreakpoint} tok is outside the expected band — re-measure before trusting any caching claim`);

  // The honest current state: the prefix does NOT clear sonnet-5's minimum, so
  // the breakpoints are correct wiring that is not yet saving anything on the
  // live workhorse. When this flips, the assertion below fails and the comment
  // in cache.js (and any saving quoted downstream) must be updated.
  assert.equal(atProfileBreakpoint >= MIN["claude-sonnet-5"], false,
    `the prefix now clears sonnet-5's ${MIN["claude-sonnet-5"]}-token minimum (${atProfileBreakpoint} tok) — caching has started paying; update the measurement note in cache.js`);
  assert.equal(atProfileBreakpoint >= MIN["claude-opus-5"], true,
    "it does clear opus-5's 512-token minimum, so the escalation tier caches today");
});

// ── D: model currency ────────────────────────────────────────────────────────

test("D1 every configured model tier is PRICED — an unpriced tier fails the cap closed", () => {
  for (const [tier, id] of Object.entries(MODELS)) {
    assert.ok(PRICING[id], `tier "${tier}" (${id}) has no price, so estimateUsd() returns Infinity and that tier can never run`);
  }
});

test("D2 escalation tracks Opus 5, at the same $5/$25 Opus 4.8 cost", () => {
  assert.equal(MODELS.escalation, "claude-opus-5");
  assert.deepEqual(PRICING["claude-opus-5"], PRICING["claude-opus-4-8"], "the upgrade must be cost-neutral, or it is not free");
});

test("D3 config.js is the SINGLE source of model ids — llm.js's second hardcoded default is gone", () => {
  const src = fs.readFileSync(path.join(SRC, "lib", "brain", "llm.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/BRAIN_MODEL\s*=/.test(src), false, "llm.js must not redeclare a model default that shadows config.js");
  assert.ok(/require\(["']\.\/config\.js["']\)/.test(src), "llm.js must take its default FROM config.js");
  assert.equal(DEFAULT_MODEL, MODELS.workhorse, "the transport default is the configured workhorse, not a literal");
});

test("D4 the dormant tailor.js no longer silently defaults to the Opus tier", () => {
  const src = fs.readFileSync(path.join(SRC, "lib", "brain", "tailor.js"), "utf8");
  assert.equal(/claude-opus/.test(src), false, "tailor.js must name no model at all — it inherits the workhorse default");
  assert.ok(DEFAULT_MODEL.startsWith("claude-sonnet"), `a judgment layer that omits \`model\` must land on the workhorse, got ${DEFAULT_MODEL}`);
});

test("D5 thinking is explicitly DISABLED on the models whose default flipped to adaptive", () => {
  // Opus 5 / Sonnet 5: omitting `thinking` now runs adaptive thinking, and
  // max_tokens caps thinking + reply TOGETHER. With maxTokens 1024 a judgment
  // call would burn its whole budget thinking and return truncated or nothing.
  assert.deepEqual(thinkingParam("claude-opus-5"), { type: "disabled" });
  assert.deepEqual(thinkingParam("claude-sonnet-5"), { type: "disabled" });
  assert.ok(THINKING_OFF_MODELS.has(MODELS.workhorse) && THINKING_OFF_MODELS.has(MODELS.escalation),
    "both live tiers must be covered, or the truncation bug is still armed");
});

test("D6 older models are left ALONE — they default to no thinking and an unexpected param risks a 400", () => {
  assert.equal(thinkingParam("claude-haiku-4-5"), undefined);
  assert.equal(thinkingParam(MODELS.classifier), undefined);
  assert.equal(thinkingParam("something-unknown"), undefined);
});

test("D7 every transport entry point sends the disabled-thinking param", () => {
  const src = fs.readFileSync(path.join(SRC, "lib", "brain", "llm.js"), "utf8");
  const bodies = src.split(/async function /).filter((s) => /^(askJSON|askSchemaJSON|runToolLoop)\b/.test(s));
  assert.equal(bodies.length, 3, "expected the three transport functions");
  for (const b of bodies) {
    assert.ok(/thinking/.test(b), `${b.slice(0, 20).trim()} must apply the thinking policy`);
  }
});
