#!/usr/bin/env node
/**
 * goldens-verify — byte-identical or stop the line.
 *
 * Two independent questions, both of which must answer yes:
 *
 *   1. WAS THE BASELINE TOUCHED? The locked golden file must be byte-identical
 *      to the committed version. A surgeon who "fixes" a golden has not fixed
 *      anything — proof you can edit is not proof.
 *   2. DOES THE ENGINE STILL MATCH IT? Run the repo's own golden test, which
 *      asserts BRAIN=off engine output against the locked baseline.
 *
 * Question 1 exists because question 2 can be made to pass by rewriting the
 * answer key. Checking only the test is how a relock hides.
 *
 * Exits nonzero on any diff or any failure. Read-only.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const BACKEND = path.join(REPO, 'backend');
const GOLDEN_DIR = 'backend/tests/golden';

let failed = 0;

function section(t) {
  console.log(`\n== ${t} ==`);
}

// --- 1. baseline untouched -------------------------------------------------
section('1. GOLDEN BASELINE UNTOUCHED');

const tracked = spawnSync('git', ['diff', '--exit-code', '--stat', 'HEAD', '--', GOLDEN_DIR], {
  cwd: REPO,
  encoding: 'utf8',
});
if (tracked.status === 0) {
  console.log(`PASS  git diff HEAD -- ${GOLDEN_DIR} is empty (no working-tree drift)`);
} else {
  failed++;
  console.log(`FAIL  ${GOLDEN_DIR} differs from HEAD:`);
  console.log(tracked.stdout || tracked.stderr);
}

const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', GOLDEN_DIR], {
  cwd: REPO,
  encoding: 'utf8',
});
const strays = (untracked.stdout || '').trim();
if (!strays) {
  console.log(`PASS  no untracked files under ${GOLDEN_DIR}`);
} else {
  failed++;
  console.log(`FAIL  untracked files under ${GOLDEN_DIR}:\n${strays}`);
}

// Report the baseline's identity so the verifier can compare it across runs.
const hash = spawnSync('git', ['hash-object', `${GOLDEN_DIR}/engine-baseline.golden.json`], {
  cwd: REPO,
  encoding: 'utf8',
});
console.log(`      baseline blob sha: ${(hash.stdout || '').trim() || '(unreadable)'}`);

// --- 2. engine still matches ----------------------------------------------
section('2. ENGINE MATCHES THE LOCKED BASELINE');

const run = spawnSync(process.execPath, ['scripts/runTests.mjs', 'tests/golden'], {
  cwd: BACKEND,
  encoding: 'utf8',
  env: Object.assign({}, process.env, { BRAIN: 'off' }),
});
const out = `${run.stdout || ''}${run.stderr || ''}`;
console.log(out.trim());
if (run.status === 0) {
  console.log('PASS  golden suite green under BRAIN=off');
} else {
  failed++;
  console.log(`FAIL  golden suite exited ${run.status}`);
}

section('RESULT');
console.log(failed === 0 ? 'GOLDENS INTACT' : `GOLDENS COMPROMISED — ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
