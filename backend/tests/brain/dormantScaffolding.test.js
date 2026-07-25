// TASK E (third part) — verifier.js and telemetry.js are REAL but DORMANT, and
// were branded as though they were load-bearing.
//
// verifier.js opened "the gate the LLM can NEVER overrule". No live route
// reaches verifyPlan(). telemetry.js went further and asserted "CI FAILS on a
// non-empty result, so an untraceable number can't ship" — there is no such CI
// job and never was; the only caller is a unit test using its own fixtures.
//
// A false safety claim is worse than no claim, because it stops someone from
// building the real check. Neither module could be wired here without touching
// the solver/route files this agent does not own, so both were re-labelled as
// scaffolding — and this file is what keeps the label honest in BOTH directions:
//
//   • claims NOT WIRED while something calls it  -> fail (stale banner)
//   • is wired but the banner still says NOT WIRED -> fail (stale banner)
//   • banner removed while still uncalled          -> fail (silent re-branding)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..", "..");
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
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ALL = jsFiles(SRC);

// Each entry: the module, the entry points that would make it live, and the
// files allowed to reference it without that counting as "wired" (the barrel
// re-exports everything by design).
const DORMANT = [
  { module: "src/lib/brain/verifier.js", entries: ["verifyPlan"] },
  { module: "src/lib/brain/telemetry.js", entries: ["provenanceLint", "withTelemetry"] },
];
const BARREL = "src/lib/brain/index.js";

test("D-S1 each dormant module carries an explicit NOT WIRED banner", () => {
  for (const d of DORMANT) {
    const src = read(path.join(BACKEND, d.module));
    assert.ok(/NOT WIRED/.test(src), `${d.module} must say NOT WIRED in plain words — present-tense branding on a dormant control is a false safety claim`);
    assert.ok(/SCAFFOLDING/i.test(src), `${d.module} must be labelled as scaffolding`);
  }
});

test("D-S2 the NOT WIRED claim is TRUE — nothing in src/ actually calls these", () => {
  for (const d of DORMANT) {
    const callers = ALL
      .filter((f) => rel(f) !== d.module && rel(f) !== BARREL)
      .filter((f) => d.entries.some((e) => new RegExp(`\\b${e}\\s*\\(`).test(code(f))))
      .map(rel);
    assert.deepEqual(
      callers,
      [],
      `${d.module} is branded NOT WIRED but ${callers.join(", ")} now calls it. Either the banner is stale (remove it and describe the real protection), or this is an accidental live dependency on an unverified path.`
    );
  }
});

test("D-S3 telemetry.js no longer claims a CI job that does not exist", () => {
  const src = read(path.join(BACKEND, "src", "lib", "brain", "telemetry.js"));
  assert.ok(/NO CI JOB RUNS THIS LINT/.test(src), "the correction must be explicit, not merely a softened rewording");

  // The stale sentence was: CI FAILS on a non-empty result, so an untraceable
  // number can't ship. Quoting it to explain the correction is fine — RESTATING
  // it as fact is not. So flatten the comment block and strip quoted spans
  // before looking for it.
  const prose = src.replace(/^\s*\/\/ ?/gm, "").replace(/\n/g, " ");
  const unquoted = prose.replace(/"[^"]*"/g, "");
  assert.equal(/CI FAILS/.test(unquoted), false, "the unconditional CI claim must not be restated as fact outside a quotation");
  assert.ok(/CI FAILS/.test(prose), "the old claim should still be quoted, so the next reader knows what was corrected and why");
});

test("D-S4 the barrel may still re-export them — a re-export is not a call site", () => {
  const barrel = code(path.join(BACKEND, BARREL));
  for (const d of DORMANT) {
    for (const e of d.entries) {
      assert.equal(new RegExp(`(await\\s+)?${e}\\s*\\(`).test(barrel), false, `index.js invokes ${e}() — the barrel must only re-export`);
    }
  }
});

test("D-S5 the modules still WORK — dormant means unwired, not broken", () => {
  const { verifyPlan } = require("../../src/lib/brain/verifier.js");
  const { provenanceLint, validProv } = require("../../src/lib/brain/telemetry.js");

  // verifyPlan rejects an unknown recipe rather than waving it through.
  const v = verifyPlan({ slots: [{ recipeId: "ghost" }] }, { pool: { recipes: new Map() }, profile: {}, tools: null });
  assert.equal(v.ok, false);
  assert.equal(v.rejections[0].code, "unknown-or-excluded-recipe");

  // provenanceLint still flags an untraceable number.
  assert.deepEqual(provenanceLint({ slots: [{ value: 500 }] }), ["$.slots[0]"]);
  assert.equal(validProv({ formulaId: "x", inputs: {}, value: 1 }), true);
});
