#!/usr/bin/env node
/**
 * guard-selftest — unit proof of the H2/H3 guard LOGIC.
 *
 * Spawns the real hook scripts with crafted PreToolUse payloads and reports
 * whether each was allowed (exit 0) or blocked (exit 2). Payloads are built
 * here, inside the file, so that running this script does not itself put a
 * forbidden literal on a Bash command line.
 *
 * This proves the guards DECIDE correctly. It does NOT prove Claude Code
 * INVOKES them — that is a separate, empirical, tool-call-level proof.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const EDIT_HOOK = path.join(REPO, '.claude', 'hooks', 'guard-edit.js');
const BASH_HOOK = path.join(REPO, '.claude', 'hooks', 'guard-bash.js');

function run(hook, payload) {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { code: r.status, err: (r.stderr || '').trim() };
}

function editPayload(file) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } };
}
function bashPayload(command) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } };
}

const KEY_SHAPE = 'sk-' + 'ant-' + 'FAKE0000';
const RELOCK =
  'cd backend && BRAIN=off node -e "require(\'./tests/golden/fixtures\').computeBaseline()' +
  '.then(o=>require(\'fs\').writeFileSync(\'tests/golden/engine-baseline.golden.json\', ' +
  'JSON.stringify(o,null,2)+String.fromCharCode(10)))"';

const CASES = [
  // --- guard-edit -----------------------------------------------------------
  ['EDIT  on-manifest  weeklyPlanner.js', EDIT_HOOK, editPayload('backend/src/lib/weeklyPlanner.js'), 'ALLOW'],
  ['EDIT  on-manifest  mealRouter.js', EDIT_HOOK, editPayload('backend/src/lib/mealRouter.js'), 'ALLOW'],
  ['EDIT  on-manifest  tests/ subtree', EDIT_HOOK, editPayload('backend/tests/brain/anything.test.js'), 'ALLOW'],
  ['EDIT  on-manifest  run docs subtree', EDIT_HOOK, editPayload('docs/surgery/surgery-20260727-1010/REPORT.md'), 'ALLOW'],
  ['EDIT  OFF-manifest bmrEngine.js', EDIT_HOOK, editPayload('backend/src/lib/bmrEngine.js'), 'BLOCK'],
  ['EDIT  OFF-manifest CLAUDE.md', EDIT_HOOK, editPayload('CLAUDE.md'), 'BLOCK'],
  ['EDIT  OFF-manifest package.json', EDIT_HOOK, editPayload('package.json'), 'BLOCK'],
  ['EDIT  SEALED golden baseline', EDIT_HOOK, editPayload('backend/tests/golden/engine-baseline.golden.json'), 'BLOCK'],
  ['EDIT  SEALED golden fixtures', EDIT_HOOK, editPayload('backend/tests/golden/fixtures.js'), 'BLOCK'],
  ['EDIT  OFF-manifest sibling run dir', EDIT_HOOK, editPayload('docs/surgery/surgery-20260727-0217/REPORT.md'), 'BLOCK'],
  ['EDIT  escape the repo', EDIT_HOOK, editPayload(path.join(REPO, '..', 'outside.txt')), 'BLOCK'],
  // --- guard-bash -----------------------------------------------------------
  ['BASH  benign npm test', BASH_HOOK, bashPayload('npm test'), 'ALLOW'],
  ['BASH  benign git status', BASH_HOOK, bashPayload('git status --short'), 'ALLOW'],
  ['BASH  git ' + 'push', BASH_HOOK, bashPayload('git ' + 'push origin HEAD'), 'BLOCK'],
  ['BASH  git ' + 'push --dry-run', BASH_HOOK, bashPayload('git ' + 'push --dry-run'), 'BLOCK'],
  ['BASH  git ' + 'reset', BASH_HOOK, bashPayload('git ' + 'reset --hard HEAD~1'), 'BLOCK'],
  ['BASH  git ' + 'rebase', BASH_HOOK, bashPayload('git ' + 'rebase -i HEAD~3'), 'BLOCK'],
  ['BASH  --force flag', BASH_HOOK, bashPayload('npm install --force'), 'BLOCK'],
  ['BASH  rm -rf', BASH_HOOK, bashPayload('rm -rf backend/node_modules'), 'BLOCK'],
  ['BASH  golden relock verbatim', BASH_HOOK, bashPayload(RELOCK), 'BLOCK'],
  ['BASH  port 3001 probe', BASH_HOOK, bashPayload('curl -s http://127.0.0.1:3001/healthz'), 'BLOCK'],
  ['BASH  packaged DB touch', BASH_HOOK, bashPayload('ls -la backend/prisma/dev.db.template'), 'BLOCK'],
  ['BASH  write PUSH_APPROVED', BASH_HOOK, bashPayload('echo "go surgery-20260727-1010" > docs/surgery/CURRENT/PUSH_APPROVED'), 'BLOCK'],
  ['BASH  cat .env', BASH_HOOK, bashPayload('cat backend/.env'), 'BLOCK'],
  ['BASH  printenv KEY', BASH_HOOK, bashPayload('printenv ANTHROPIC_API_KEY'), 'BLOCK'],
  ['BASH  literal key shape', BASH_HOOK, bashPayload('echo ' + KEY_SHAPE), 'BLOCK'],
];

let pass = 0;
let fail = 0;
const lines = [];

for (const [label, hook, payload, want] of CASES) {
  const { code, err } = run(hook, payload);
  const got = code === 0 ? 'ALLOW' : 'BLOCK';
  const expected = want.startsWith('ALLOW') ? 'ALLOW' : 'BLOCK';
  const ok = got === expected;
  if (ok) pass++;
  else fail++;
  lines.push(
    `${ok ? 'PASS' : 'FAIL'}  want=${expected.padEnd(5)} got=${got.padEnd(5)}  ${label}` +
      (code !== 0 ? `\n        -> ${err.split('\n')[0]}` : '')
  );
}

console.log(lines.join('\n'));
console.log(`\nguard-selftest: ${pass} passed, ${fail} failed, ${CASES.length} total`);
process.exit(fail === 0 ? 0 : 1);
