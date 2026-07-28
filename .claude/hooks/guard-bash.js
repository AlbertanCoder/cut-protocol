#!/usr/bin/env node
/**
 * guard-bash — PreToolUse hook for Bash | PowerShell.
 *
 * Enforces H3 of the M-HARNESS. Denies the acts that are irreversible, that
 * touch the owner's live app or packaged data, that would let the session
 * relock its own goldens, that would let the session approve its own push,
 * or that would exfiltrate a key.
 *
 * Fail-closed: an unreadable manifest still denies the whole list, and an
 * unreadable payload denies outright.
 *
 * Exit 0 = allow. Exit 2 = block (stderr is shown to the model).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRole, describeRole, BUILDER } = require('./role');

const REPO = path.resolve(__dirname, '..', '..');
const CURRENT = path.join(REPO, 'docs', 'surgery', 'CURRENT', 'manifest.json');

function die(what, why) {
  process.stderr.write(
    `BLOCKED: ${what} not on the incision manifest. ${why}\n` +
      'A guard block is a stop sign, not a puzzle — report it, do not rephrase around it.\n'
  );
  process.exit(2);
}

// Rules are [label, RegExp, why]. Tested against the raw command string.
const RULES = [
  ['git push', /\bgit\s+push\b/i, 'Pushing is the owner\'s hand only (see .git/hooks/pre-push).'],
  ['git reset', /\bgit\s+reset\b/i, 'History rewriting is forbidden inside the cage.'],
  ['git rebase', /\bgit\s+rebase\b/i, 'History rewriting is forbidden inside the cage.'],
  ['a --force flag', /--force\b|(^|\s)-f(\s|$)/i, 'Forced operations are forbidden inside the cage.'],
  ['rm -rf', /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/i, 'Recursive force-delete is forbidden inside the cage.'],
  [
    'the golden relock invocation',
    /engine-baseline\.golden\.json|computeBaseline/i,
    'Relocking the goldens is mechanically impossible for this session — that is the point of the lock.',
  ],
  ['port 3001', /:3001\b|port\s*3001/i, 'The owner\'s live app on 3001 is sacred and is never touched.'],
  ['the packaged DB', /dev\.db\.template/i, 'The packaged/template DB is sacred and is never touched.'],
  ['PUSH_APPROVED', /PUSH_APPROVED/, 'No session may write its own push approval. Only the owner\'s hand.'],
  ['a key-read', /\bcat\s+[^\n|;]*\.env\b|\btype\s+[^\n|;]*\.env\b|Get-Content[^\n|;]*\.env\b/i, 'Secrets are never read into the transcript.'],
  ['a key-dump', /\bprintenv\b[^\n]*KEY|\benv\b[^\n]*\|\s*grep[^\n]*KEY|Get-ChildItem\s+env:/i, 'Secrets are never read into the transcript.'],
  ['a literal API key', /sk-ant-/, 'An API key shape may never appear in a command.'],
];

// The architect reads and runs; the builder commits (I5). These are EXTRA
// denials layered on top of RULES, never a relaxation of them — the list below
// only ever grows the deny set, which is what "role narrows" means in a gate
// that is already deny-by-pattern.
//
// witness.js is deliberately NOT here. Whether the architect may spend is an M3
// question and is left exactly as it was found; the only witness rule remains
// the mode-keyed one below.
const ARCHITECT_EXTRA = [
  ['git add', /\bgit\s+add\b/i, 'The architect does not stage; the builder commits.'],
  ['git commit', /\bgit\s+commit\b/i, 'The architect does not commit; it orders, verifies and signs.'],
  ['git checkout', /\bgit\s+checkout\b/i, 'The architect does not move the working tree.'],
  ['git switch', /\bgit\s+switch\b/i, 'The architect does not move the working tree.'],
  ['git stash', /\bgit\s+stash\b/i, 'The architect does not hide the builder\'s tree.'],
  ['git tag', /\bgit\s+tag\b/i, 'The architect does not mark history.'],
  ['git merge', /\bgit\s+merge\b/i, 'The architect does not mutate history.'],
  ['git cherry-pick', /\bgit\s+cherry-pick\b/i, 'The architect does not mutate history.'],
  [
    'a branch deletion',
    /\bgit\s+branch\b[^\n]*\s(?:-[dD]\b|--delete\b)/,
    'Branches are evidence; the architect does not delete them.',
  ],
];

// Verifier mode may not spend the owner's money.
const VERIFIER_EXTRA = [
  [
    'the witness invocation',
    /witness\.js/i,
    'Only the surgeon runs the witness. A verifier re-derives, it does not spend.',
  ],
];

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    die('this command', `guard-bash could not read the tool payload (${e.message}). Fail-closed.`);
  }

  const input = payload.tool_input || {};
  const cmd = String(input.command || '');
  if (!cmd) process.exit(0);

  let mode = 'surgeon';
  try {
    mode = JSON.parse(fs.readFileSync(CURRENT, 'utf8')).mode || 'surgeon';
  } catch {
    // Unreadable manifest: keep the full deny list, assume nothing.
  }

  let rules = mode === 'verifier' ? RULES.concat(VERIFIER_EXTRA) : RULES;

  // Role layers ON TOP of the existing rules, which continue to bind every
  // role. Anything that is not a recognized builder gets the architect's extra
  // denials — absent, blank and unknown values included (I2, fail-closed).
  const r = resolveRole();
  if (!(r.recognized && r.role === BUILDER)) {
    rules = rules.concat(
      ARCHITECT_EXTRA.map(([label, re, why]) => [label, re, `${why} (role: ${describeRole(r)})`])
    );
  }

  for (const [label, re, why] of rules) {
    if (re.test(cmd)) die(label, why);
  }

  process.exit(0);
}

main();
