#!/usr/bin/env node
// Cut Protocol — the backend test entrypoint. Replaces `node --test tests/**/*.test.js`.
//
// WHY THIS SCRIPT EXISTS (2026-07-23, fleet finding tests-quality-1):
// the old npm script was `node --test tests/**/*.test.js`. That string is
// expanded by whatever shell npm hands it to, and the two platforms disagree:
//
//   - Windows (cmd.exe): no glob expansion at all, so node received the literal
//     pattern and Node's own globber matched all 62 files. 667 tests, green.
//   - CI (ubuntu-latest, bash, globstar OFF): bash collapses `**` to a single
//     `*`, so the pattern became `tests/*/*.test.js` — matching ONLY the 35
//     files in tests/brain, tests/golden and tests/qc, and silently skipping
//     all 27 top-level suites. Among the skipped: allergySweep.test.js (the
//     14,144-food allergen sweep), dietaryFilter.test.js, bmrEngine.test.js,
//     mealSolver.test.js, solverHonesty.test.js and scanSecrets.test.js.
//
// So every green check on CI was certifying 35 of 62 files, and the P0 allergen
// sweep had never run there once. A skip that costs nothing to make and is
// invisible when made is the worst kind of test bug — hence the tripwires below.
//
// Discovery happens HERE, in JS, where no shell can touch it. The floors turn a
// silent skip into a loud failure: if discovery ever finds fewer files or the
// run ever reports fewer tests than the committed floor, this exits non-zero and
// says so. Both floors are meant to be raised deliberately as the suite grows —
// see MIN_TEST_FILES / MIN_TESTS below.
//
//   node scripts/runTests.mjs            exit 0 all green · 1 failure or tripwire
//   node scripts/runTests.mjs --list     discovery only: print the files, run none
//   node scripts/runTests.mjs tests/qc   SCOPED run (tripwires off — see below)
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const BACKEND = path.resolve(path.join(import.meta.dirname, ".."));
const TESTS_DIR = path.join(BACKEND, "tests");

// ── tripwire floors ──────────────────────────────────────────────────────
// Raise these when you add tests; never lower one to make CI pass without
// understanding WHY the count dropped. A drop is the bug this file exists to
// catch.
//
// MEASURED, not assumed — every number below was produced by an actual run:
//   2026-07-23  62 files / 667 tests   (first measurement, when this file landed)
//   2026-07-23  63 files / 676 tests   (Wave 1 agent 01: +1 file / +9 tests —
//               tests/golden/goldenBmr.test.js, the BMR golden lock that finding
//               tests-quality-3 showed had been committed but never compared)
//   2026-07-23  80 files / 926 tests   (overnight fleet, all 10 agents landed:
//               migration-runner safety, ingredient-resolver ladder, allergen
//               metadata + alias map, registration, login throttle, port/identity
//               + license gate, solver locks/macro tolerance/keto ceiling,
//               adaptive step cap + intake recency + target reconcile, and the
//               LLM governance door)
const MIN_TEST_FILES = 80;
// ~2.5% headroom under the measured total so ordinary churn (merging or deleting
// a redundant case) doesn't wedge CI, while still catching a mass skip — the
// bash glob dropped 27 of 62 files, which is hundreds of tests, not single digits.
const MIN_TESTS = 903;

const argv = process.argv.slice(2);
const listOnly = argv.includes("--list");
const scopes = argv.filter((a) => !a.startsWith("--"));

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith(".test.js")) out.push(p);
  }
}

// Unscoped (the CI path) walks all of tests/. A scoped run walks only the given
// directories/files — used by `qc:all` so that lane never needs a shell glob
// either. Scoped runs DISABLE the floors (they are floors for the whole suite),
// which is why CI must always invoke this with no scope arguments.
const roots = scopes.length ? scopes.map((s) => path.resolve(BACKEND, s)) : [TESTS_DIR];
const files = [];
for (const root of roots) {
  if (fs.existsSync(root) && fs.statSync(root).isFile()) files.push(root);
  else walk(root, files);
}
files.sort();

if (files.length === 0) {
  console.error(`[runTests] FAIL — no test files found under ${roots.join(", ")}`);
  process.exit(1);
}

const scoped = scopes.length > 0;
if (scoped) {
  console.log(`[runTests] SCOPED run (${scopes.join(", ")}) — ${files.length} files. Tripwire floors DISABLED for a scoped run; only \`npm test\` with no arguments enforces them.`);
} else if (files.length < MIN_TEST_FILES) {
  console.error(
    `[runTests] TRIPWIRE — discovered ${files.length} test files, floor is ${MIN_TEST_FILES}.\n` +
    `  Files vanished from tests/ rather than failing. That is the silent-skip bug\n` +
    `  this floor exists to catch (see the header of this file). Investigate before\n` +
    `  touching MIN_TEST_FILES.`
  );
  process.exit(1);
} else {
  console.log(`[runTests] ${files.length} test files discovered (floor ${MIN_TEST_FILES})`);
}

if (listOnly) {
  for (const f of files) console.log(path.relative(BACKEND, f));
  console.log(`[runTests] --list: ${files.length} files, nothing executed.`);
  process.exit(0);
}

// The test suite may never bill the owner's Anthropic account.
//
// backend/.env carries BRAIN=on and a real ANTHROPIC_API_KEY, and Prisma loads
// .env into process.env for anything that imports it. So on the owner's machine
// a suite that reaches the transport would make a REAL, paid call — and the
// failure mode is silent: the tests still pass, the money is just gone.
//
// Neutralising it here, at the one entrypoint every test run goes through, is
// what makes it reliable. Doing it per-file means remembering it in each new
// test forever, which is the same "wiring, not structure" mistake that let the
// ungated LLM route exist in the first place.
//
// Tests that need to exercise a model path inject a fake client through the
// sanctioned __setClient seam, which does not consult these variables.
const childEnv = {
  ...process.env,
  BRAIN: "off",
  ANTHROPIC_API_KEY: "",
  AI_RECIPE_DRAFTS: "",
};

// Explicit paths — node never sees a glob, so no shell can eat one.
const child = spawn(
  process.execPath,
  ["--test", "--test-reporter=spec", ...files],
  { cwd: BACKEND, stdio: ["inherit", "pipe", "inherit"], env: childEnv }
);

let captured = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);      // stream live for humans
  captured += chunk.toString("utf8"); // and keep a copy for the tripwire
});

child.on("close", (code) => {
  // The spec reporter prints "ℹ tests N"; the tap reporter prints "# tests N".
  // Accept either so switching reporters later can't quietly disarm the floor.
  // Take the LAST match, not the first: a test that prints a line like
  // "# tests 3" to stdout (fixtures, TAP samples, a captured child run) would
  // otherwise be read as the suite total and could satisfy — or spuriously
  // trip — the floor. The runner's own summary is always last.
  // Strip ANSI SGR codes before matching. node --test colourises when it thinks
  // a TTY is attached, and whether it does depends on how the run was invoked
  // (`npm test --prefix backend` colourised where `cd backend && npm test` did
  // not). The summary then arrives as "\x1b[34mℹ tests 926\x1b[39m", the anchored
  // regex misses it, and the tripwire fails a suite that passed 926/926. A gate
  // that reports failure on a green run trains people to ignore it, which is
  // the one thing this file exists to prevent.
  const plain = captured.replace(/\[[0-9;]*m/g, "");
  const lastMatch = (re) => {
    let m, last = null;
    const g = new RegExp(re.source, "gm");
    while ((m = g.exec(plain)) !== null) last = m;
    return last;
  };
  const testsMatch = lastMatch(/^(?:ℹ|#)\s*tests\s+(\d+)/);
  const failMatch = lastMatch(/^(?:ℹ|#)\s*fail\s+(\d+)/);

  if (!testsMatch) {
    console.error("[runTests] TRIPWIRE — could not read a test count from the runner output.");
    process.exitCode = 1;
    return;
  }

  const total = Number(testsMatch[1]);
  const failed = failMatch ? Number(failMatch[1]) : 0;

  if (!scoped && total < MIN_TESTS) {
    console.error(
      `\n[runTests] TRIPWIRE — ran ${total} tests, floor is ${MIN_TESTS}.\n` +
      `  Files were discovered but the tests inside them did not run. Investigate\n` +
      `  before touching MIN_TESTS.`
    );
    process.exitCode = 1;
    return;
  }

  if (failed > 0 || code !== 0) {
    console.error(`\n[runTests] ${failed} failing test(s).`);
    process.exitCode = code === 0 ? 1 : code;
    return;
  }

  console.log(`\n[runTests] OK — ${files.length} files, ${total} tests, 0 failures.`);
  process.exitCode = 0;
});
