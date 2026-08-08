#!/usr/bin/env node
/**
 * guard-migration — PreToolUse hook for Bash | PowerShell, light-migration only.
 *
 * Blocks the four irreversible acts the migration runbook names:
 *   rm · git clean · git reset --hard · git checkout -- .
 *
 * This LAYERS ON TOP of guard-bash.js; it never relaxes it. guard-bash already
 * denies `git push`, all of `git reset`, `git rebase`, `--force`, lowercase
 * `-f`, and `rm -rf`. What it does NOT deny, and this file does:
 *
 *   · a plain `rm` / `Remove-Item` with no -rf (deletes a file just as dead)
 *   · `git clean` in any form
 *   · `git checkout -- .` and `git checkout .` (silently reverts the tree —
 *     the exact failure recorded in the repo's concurrent-edit notes, where a
 *     parallel session's working-tree edits vanished)
 *
 * Constraint 1 of MIGRATION/CONTRACT.md is the reason: nothing gets deleted
 * before Phase 10, and Phase 10 deletes only what DELETE-CANDIDATES.md lists.
 *
 * Exit 0 = allow. Exit 2 = block (stderr is shown to the model).
 */
'use strict';

const fs = require('fs');

function die(what, why) {
  process.stderr.write(
    `BLOCKED: ${what}. ${why}\n` +
      'MIGRATION/CONTRACT.md constraint 1: nothing is deleted before Phase 10, and Phase 10 ' +
      'deletes only what MIGRATION/DELETE-CANDIDATES.md lists.\n' +
      'A guard block is a stop sign, not a puzzle — report it, do not rephrase around it.\n'
  );
  process.exit(2);
}

const RULES = [
  [
    'a file deletion (rm / Remove-Item / del)',
    /(^|[\s;&|(])(rm|unlink|del|erase)\s|\bRemove-Item\b/i,
    'Deleting a file is exactly what constraint 1 forbids. If it looks obsolete, append it to MIGRATION/DELETE-CANDIDATES.md and move on.',
  ],
  [
    'git clean',
    /\bgit\s+clean\b/i,
    'git clean destroys untracked work with no reflog and no undo.',
  ],
  [
    'git reset --hard',
    /\bgit\s+reset\b[^\n]*--hard/i,
    'A hard reset discards the working tree. Reverting a bad phase is the owner\'s call, from the owner\'s hand.',
  ],
  [
    'git checkout of the whole tree',
    /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)|\bgit\s+checkout\s+--\s+\./i,
    'This silently reverts every uncommitted edit in the tree — including a parallel session\'s.',
  ],
];

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    die('this command', `guard-migration could not read the tool payload (${e.message}). Fail-closed.`);
  }

  const cmd = String((payload.tool_input || {}).command || '');
  if (!cmd) process.exit(0);

  for (const [what, re, why] of RULES) {
    if (re.test(cmd)) die(what, why);
  }

  process.exit(0);
}

main();
