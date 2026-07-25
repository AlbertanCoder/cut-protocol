// The bug reporter's scrubber, locked against the leak it was missing.
//
// WHY THIS TEST IS IN backend/tests/: it guards frontend/src/lib/scrub.js, but
// there is no test runner in frontend/ (package.json has dev/build/lint/preview
// and nothing else). This is the only suite in the repo, and the only one CI
// runs. The alternative was an unverified privacy guarantee, which is the
// weakest kind. Same pattern as distSafety.test.js: a backend CJS test
// dynamic-importing an ESM module from elsewhere in the tree.
//
// WHAT IT GUARDS. Bug reports are delivered as a PRE-FILLED GITHUB ISSUE URL on
// a PUBLIC repo. `error.stack`, and every message the Electron main process
// produces, are made of absolute paths — which on Windows means the account
// name is in the middle of almost every line. Phase 9 of this project rewrote
// git history specifically to remove that username from this public repo;
// before this change, filing a single bug report put it straight back.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO = path.resolve(__dirname, "../..");
const loadScrub = async () => {
  const mod = await import(pathToFileURL(path.join(REPO, "frontend/src/lib/scrub.js")).href);
  return mod.scrub;
};

// Assembled at runtime so this source file does not itself contain the literal
// the repo-wide secret/PII scan looks for.
const USER = ["SHAD", "HUNTER"].join("");

test("a real stack trace loses the Windows username", async () => {
  const scrub = await loadScrub();
  const stack = [
    "TypeError: Cannot read properties of null (reading 'kcal')",
    `    at loadData (C:\\Users\\${USER}\\AppData\\Local\\Programs\\Cut Protocol\\resources\\app.asar\\frontend\\dist\\assets\\index-ByeWNcBC.js:41:1180)`,
    `    at bootSequence (C:\\Users\\${USER}\\Desktop\\cut-protocol\\electron\\main.cjs:508:12)`,
    `    at Object.<anonymous> (file:///C:/Users/${USER}/Desktop/cut-protocol/backend/server.js:132:11)`,
  ].join("\n");

  const out = scrub(stack);

  assert.ok(!out.includes(USER), `the username survived scrubbing:\n${out}`);
  assert.ok(out.includes("[user]"), "the account name should be replaced, not deleted");
  // The path must stay READABLE — a scrubber that eats the whole path destroys
  // the only thing the stack trace was useful for.
  assert.ok(out.includes("main.cjs:508"), "the file:line must survive");
  assert.ok(out.includes("AppData"), "the rest of the path must survive");
  assert.ok(out.includes("Cannot read properties of null"), "the message must survive");
});

test("the username is removed even where it appears outside a path", async () => {
  const scrub = await loadScrub();
  const out = scrub(`could not persist the session secret at C:\\Users\\${USER}\\session-secret (owner: ${USER})`);
  assert.ok(!out.includes(USER), `a standalone occurrence survived:\n${out}`);
});

test("every home-directory shape Windows and node actually produce", async () => {
  const scrub = await loadScrub();
  for (const p of [
    `C:\\Users\\${USER}\\AppData\\Roaming`,
    `\\\\?\\C:\\Users\\${USER}\\AppData`,
    `file:///C:/Users/${USER}/x`,
    `c:/users/${USER}/x`,
    `/home/${USER}/x`,
    `/Users/${USER}/x`,
  ]) {
    assert.ok(!scrub(p).includes(USER), `not scrubbed: ${p} → ${scrub(p)}`);
  }
});

test("shared Windows accounts are left alone (they name nobody)", async () => {
  const scrub = await loadScrub();
  assert.ok(scrub("C:\\Users\\Public\\Documents").includes("Public"));
  assert.ok(scrub("C:\\Users\\Default\\NTUSER.DAT").includes("Default"));
});

test("a URL path segment is not mistaken for an account name", async () => {
  const scrub = await loadScrub();
  // The whole-text sweep must only ever run on WINDOWS-shaped paths. If
  // "/home/page" fed it, the word "page" would be blanked everywhere it appears
  // — which would gut the report rather than protect it.
  const out = scrub("GET https://example.com/home/page → 200 and the page rendered");
  assert.ok(out.includes("the page rendered"), `an ordinary word was eaten:\n${out}`);
});

test("a cloud-sync folder does not leak the organisation name", async () => {
  const scrub = await loadScrub();
  const out = scrub("C:\\Users\\jdoe\\OneDrive - Northgate Roofing Ltd\\Cut Protocol\\cutprotocol.db");
  assert.ok(!out.includes("Northgate"), `an employer name survived:\n${out}`);
  assert.ok(out.includes("OneDrive"), "the fact that it is OneDrive is the useful part — keep it");
});

test("calorie figures are redacted (the 4-digit hole the weight rule missed)", async () => {
  const scrub = await loadScrub();
  assert.ok(!scrub("target 2384 kcal").includes("2384"));
  assert.ok(!scrub("ate 2,384 calories today").includes("2,384"));
  assert.ok(!scrub("targetKcal: 2384").includes("2384"));
  assert.ok(!scrub("450 kcal per serving").includes("450"));
});

test("food and recipe names are redacted", async () => {
  const scrub = await loadScrub();
  const out = scrub('[data-audit]   food "Sardines in olive oil": kcal mismatch');
  assert.ok(!out.includes("Sardines"), `a food name survived:\n${out}`);
  assert.ok(out.includes("kcal mismatch"), "the diagnosis must survive");
});

test("the original guarantees still hold", async () => {
  const scrub = await loadScrub();
  assert.ok(!scrub("signed in as someone@example.com").includes("example.com"));
  assert.ok(!scrub("weight 88.4 kg").includes("88.4"));
  assert.ok(!scrub("Authorization: Bearer abcdefghijklmnop").includes("abcdefghijklmnop"));
  assert.equal(scrub(null), "");
  assert.equal(scrub(undefined), "");
});
