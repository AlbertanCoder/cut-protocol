const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  sweep, buildQueries, extractRecipeLinks, parseRobots, robotsAllows, loadRegistry,
} = require("../../src/lib/recipeBrain/sources/webSource.js");
const { buildSpec } = require("../../src/lib/recipeBrain/spec.js");

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE BRAIN — the web channel. NOTHING IN THIS FILE TOUCHES THE NETWORK:
// every fetch and import is an injected recorder. The claims under test are the
// conduct rules — ships disabled, robots fail-closed, same-host only, capped —
// because those ARE the feature; parsing is secondary.
// ─────────────────────────────────────────────────────────────────────────────

const SPEC = buildSpec({
  target: { slotType: "meal", kcalTarget: 620, proteinTarget: 45 },
  dailyTarget: { kcal: 2100, proteinLo: 150, proteinHi: 170, fatLo: 55, fatHi: 65, carbLo: 180, carbHi: 210 },
  filters: { cuisines: ["mexican"], protein: "chicken" },
  profile: {},
});

const SITE = {
  key: "testsite", name: "Test Site", homepage: "https://recipes.example.com",
  searchUrl: "https://recipes.example.com/?s={query}", linkPattern: "recipes.example.com/", enabled: true,
};
const REG = { maxImportsPerSite: 2, sources: [SITE] };

test("the SHIPPED registry has every site disabled — the channel is a no-op until the owner opts in", () => {
  const shipped = loadRegistry();
  assert.ok(shipped.sources.length >= 1, "the curated registry exists");
  for (const s of shipped.sources) assert.equal(s.enabled, false, `${s.key} must ship disabled`);
});

test("sweep with no enabled sites answers honestly and fetches nothing", async () => {
  const fetches = [];
  const out = await sweep({ spec: SPEC }, {
    registry: { maxImportsPerSite: 2, sources: [{ ...SITE, enabled: false }] },
    fetchTextImpl: async (u) => { fetches.push(u); return ""; },
    importImpl: async () => { throw new Error("must not import"); },
    delayImpl: async () => {},
  });
  assert.equal(out.drafts.length, 0);
  assert.equal(fetches.length, 0, "zero network on the default registry");
  assert.equal(out.attempts[0].outcome, "no-enabled-sites");
});

test("robots.txt fail-closed: unreachable robots skips the site, recorded", async () => {
  const out = await sweep({ spec: SPEC }, {
    registry: REG,
    fetchTextImpl: async (u) => { if (u.endsWith("/robots.txt")) throw new Error("timeout"); return ""; },
    importImpl: async () => { throw new Error("must not import"); },
    delayImpl: async () => {},
  });
  assert.equal(out.drafts.length, 0);
  assert.equal(out.attempts[0].outcome, "robots-unreachable-skipped");
});

test("robots.txt Disallow on the search path is honoured", async () => {
  const out = await sweep({ spec: SPEC }, {
    registry: REG,
    fetchTextImpl: async (u) => (u.endsWith("/robots.txt") ? "User-agent: *\nDisallow: /" : "<a href='/x'>"),
    importImpl: async () => { throw new Error("must not import"); },
    delayImpl: async () => {},
  });
  assert.equal(out.drafts.length, 0);
  assert.equal(out.attempts[0].outcome, "robots-disallows-search");
});

test("happy path: search → same-host links → import, capped, with the courtesy delay", async () => {
  const calls = { delays: 0, imports: [] };
  const html = `
    <a href="https://recipes.example.com/chicken-bowl/">Chicken Bowl</a>
    <a href="https://recipes.example.com/chicken-bowl/">dupe</a>
    <a href="https://recipes.example.com/steak-tacos/">Steak Tacos</a>
    <a href="https://recipes.example.com/lentil-soup/">Lentil Soup</a>
    <a href="https://evil.example.net/recipes.example.com/">offsite trick</a>
    <a href="https://recipes.example.com/?s=chicken">search page</a>`;
  const out = await sweep({ spec: SPEC }, {
    registry: REG,
    fetchTextImpl: async (u) => (u.endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : html),
    importImpl: async (url) => { calls.imports.push(url); return { name: "Imported", ingredients: [], steps: [], servings: 1 }; },
    delayImpl: async () => { calls.delays++; },
    maxTotalImports: 2,
  });
  assert.equal(out.drafts.length, 2, "capped at maxTotalImports");
  assert.ok(calls.imports.every((u) => u.startsWith("https://recipes.example.com/")), "same-host only — the offsite trick link never fetched");
  assert.ok(!calls.imports.some((u) => u.includes("?s=")), "search pages are not recipes");
  assert.equal(calls.delays, calls.imports.length, "one courtesy delay per page fetch");
  assert.ok(out.drafts[0].sourceUrl.includes("chicken-bowl"));
});

test("an import failure is recorded and the sweep continues to the next candidate", async () => {
  const html = `<a href="https://recipes.example.com/bad/">x</a><a href="https://recipes.example.com/good/">y</a>`;
  const out = await sweep({ spec: SPEC }, {
    registry: REG,
    fetchTextImpl: async (u) => (u.endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : html),
    importImpl: async (url) => {
      if (url.includes("bad")) throw new Error("no recipe markup found");
      return { name: "Good", ingredients: [], steps: [], servings: 1 };
    },
    delayImpl: async () => {},
  });
  assert.equal(out.drafts.length, 1);
  assert.ok(out.attempts.some((a) => a.outcome === "import-failed" && /no recipe markup/.test(a.message)));
});

// ── the small parsers, pinned ───────────────────────────────────────────────

test("buildQueries is deterministic, spec-driven, and leans when the spec says lean", () => {
  const q1 = buildQueries(SPEC);
  const q2 = buildQueries(SPEC);
  assert.deepEqual(q1, q2);
  assert.ok(q1[0].includes("mexican") && q1[0].includes("chicken"));
  const lean = buildQueries({ ...SPEC, emphasis: { fat: "lower" } });
  assert.match(lean[0], /^lean /);
  assert.ok(q1.length <= 2);
});

test("extractRecipeLinks: same host, pattern required, deduped, capped", () => {
  const html = `<a href="/one/">1</a><a href="/two/">2</a><a href="/three/">3</a><a href="https://other.com/x/">x</a>`;
  const links = extractRecipeLinks(html, SITE, 2);
  assert.equal(links.length, 2);
  assert.ok(links.every((l) => l.startsWith("https://recipes.example.com/")));
});

test("robots parser: longest match wins, Allow beats Disallow at equal length, no groups = allowed", () => {
  const groups = parseRobots(`
    User-agent: *
    Disallow: /private/
    Allow: /private/recipes/
  `);
  assert.equal(robotsAllows(groups, "cutprotocol", "/private/secret"), false);
  assert.equal(robotsAllows(groups, "cutprotocol", "/private/recipes/tacos"), true);
  assert.equal(robotsAllows(groups, "cutprotocol", "/public/"), true);
  assert.equal(robotsAllows([], "cutprotocol", "/anything"), true);
});

test("robots parser: a specific agent group overrides the wildcard for that agent", () => {
  const groups = parseRobots(`
    User-agent: cutprotocol
    Disallow: /

    User-agent: *
    Allow: /
  `);
  assert.equal(robotsAllows(groups, "cutprotocol importer", "/recipes/"), false, "our own UA group wins");
  assert.equal(robotsAllows(groups, "someone-else", "/recipes/"), true);
});
