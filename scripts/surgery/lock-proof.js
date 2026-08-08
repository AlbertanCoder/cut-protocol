#!/usr/bin/env node
/**
 * lock-proof — H8. With locked:true in the CURRENT manifest, prove that the
 * occupant can no longer weaken its own cage.
 *
 * Spawns the real guard-edit hook against the paths H8 names, plus the
 * still-permitted incision sites, so the proof shows the lock is a seal and
 * not a shutdown.
 *
 * This proves the guard DECIDES correctly under lock. Whether Claude Code
 * INVOKES it is a separate question, answered (badly) in evidence/E4.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const EDIT_HOOK = path.join(REPO, '.claude', 'hooks', 'guard-edit.js');

function attempt(file) {
  const r = spawnSync(process.execPath, [EDIT_HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file },
    }),
    encoding: 'utf8',
  });
  return { code: r.status, err: (r.stderr || '').trim() };
}

const CASES = [
  // H8 names these two explicitly.
  ['a hook edit', '.claude/hooks/guard-edit.js', 'BLOCK'],
  ['a manifest edit', 'docs/surgery/surgery-20260727-1010/manifest.json', 'BLOCK'],
  // The rest of the seal.
  ['the CURRENT copy', 'docs/surgery/CURRENT/manifest.json', 'BLOCK'],
  ['the settings file', '.claude/settings.json', 'BLOCK'],
  ['the harness scripts', 'scripts/surgery/witness.js', 'BLOCK'],
  ['this proof script', 'scripts/surgery/lock-proof.js', 'BLOCK'],
  ['the golden baseline', 'backend/tests/golden/engine-baseline.golden.json', 'BLOCK'],
  // The lock must NOT close the operating theatre.
  ['the M1 site', 'backend/src/lib/weeklyPlanner.js', 'ALLOW'],
  ['the M2 site', 'backend/src/lib/mealRouter.js', 'ALLOW'],
  ['the M3 governor', 'backend/src/routes/plans.js', 'ALLOW'],
  ['the M4 site', 'backend/src/lib/brainRelayConfig.js', 'ALLOW'],
  ['a new test file', 'backend/tests/brain/dayTolerance.test.js', 'ALLOW'],
  ['the run report', 'docs/surgery/surgery-20260727-1010/REPORT.md', 'ALLOW'],
];

let fail = 0;
console.log('== LOCK PROOF (locked:true) ==\n');
for (const [label, file, want] of CASES) {
  const { code, err } = attempt(file);
  const got = code === 0 ? 'ALLOW' : 'BLOCK';
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  want=${want.padEnd(5)} got=${got.padEnd(5)}  ${label}  (${file})`);
  if (code !== 0) console.log(`        -> ${err.split('\n')[0]}`);
}
console.log(`\nlock-proof: ${CASES.length - fail} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
