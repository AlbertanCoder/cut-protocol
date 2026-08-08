#!/usr/bin/env node
/**
 * pre-push-check — the logic behind .git/hooks/pre-push (H5).
 *
 * A push is refused unless docs/surgery/CURRENT/PUSH_APPROVED contains exactly
 * `go <run_id>` for the run_id named by the CURRENT manifest.
 *
 * No session can create that file: guard-bash denies the string PUSH_APPROVED
 * on the shell, and guard-edit denies it because docs/surgery/CURRENT/ is
 * sealed once the manifest is locked. Only the owner's hand writes it.
 *
 * Fail-closed everywhere: any missing file, any parse error, any mismatch, and
 * the push is refused.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const CURRENT_DIR = path.join(REPO, 'docs', 'surgery', 'CURRENT');
const MANIFEST = path.join(CURRENT_DIR, 'manifest.json');
const APPROVAL = path.join(CURRENT_DIR, 'PUSH_APPROVED');

function refuse(why) {
  process.stderr.write(
    '\n' +
      'PUSH REFUSED by .git/hooks/pre-push\n' +
      `  reason: ${why}\n` +
      '\n' +
      '  This repository is under an incision harness. Pushing is the owner\'s\n' +
      '  hand only. To approve, write the file yourself:\n' +
      '\n' +
      '      docs/surgery/CURRENT/PUSH_APPROVED   containing exactly:  go <run_id>\n' +
      '\n' +
      '  No agent session can write it — that is the entire point.\n' +
      '\n'
  );
  process.exit(1);
}

let runId;
try {
  runId = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).run_id;
} catch (e) {
  refuse(`the CURRENT manifest is unreadable (${e.message})`);
}
if (!runId) refuse('the CURRENT manifest names no run_id');

let approval;
try {
  approval = fs.readFileSync(APPROVAL, 'utf8');
} catch {
  refuse(`no approval file at docs/surgery/CURRENT/PUSH_APPROVED (run_id ${runId})`);
}

const want = `go ${runId}`;
if (approval.trim() !== want) {
  refuse(
    `approval file does not read exactly "${want}" ` +
      `(found ${JSON.stringify(approval.trim().slice(0, 80))})`
  );
}

process.stderr.write(`pre-push: approval present for ${runId} — allowing.\n`);
process.exit(0);
