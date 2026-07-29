#!/usr/bin/env node
/**
 * guard-edit — PreToolUse hook for Edit | Write | MultiEdit.
 *
 * Enforces H2 of the M-HARNESS: a session may only write to paths its own
 * incision manifest names. Fail-closed in every direction — a missing,
 * unreadable or unparseable manifest BLOCKS, it does not wave through.
 *
 * Exit 0 = allow. Exit 2 = block (stderr is shown to the model).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveRole, describeRole, BUILDER } = require('./role');

const REPO = path.resolve(__dirname, '..', '..');
const CURRENT = path.join(REPO, 'docs', 'surgery', 'CURRENT', 'manifest.json');

// The black box. Lower-cased for the Windows-safe comparison used throughout.
const CAMPAIGN = 'docs/surgery/campaign/';
const LEDGER = 'docs/surgery/campaign/ledger.md';

function die(msg) {
  process.stderr.write(
    `BLOCKED: ${msg}\n` +
      'A guard block is a stop sign, not a puzzle — report it, do not rephrase around it.\n'
  );
  process.exit(2);
}

/** Repo-relative, forward-slashed, case-folded for Windows comparison. */
function rel(abs) {
  const r = path.relative(REPO, abs).split(path.sep).join('/');
  return r;
}

/**
 * The role door (I3/I4).
 *
 * Called ONLY after the manifest has already answered "yes", and it can do
 * exactly one thing: turn that yes into a no. It has no branch that returns
 * "allowed" for anything the manifest refused, and it must never grow one --
 * that would invert the law from intersection to union.
 *
 * builder (I4): returns immediately. Role adds no permission; the manifest,
 * the goldens hard-deny and the lock seals govern exactly as they did before
 * roles existed. If builder behaviour changes here, something was widened.
 *
 * architect (I3), and every value that fails closed onto it: may CREATE new
 * files under docs/surgery/CAMPAIGN/, may EDIT only CAMPAIGN/ledger.md, may
 * touch nothing else anywhere. Create-vs-edit is decided by existence on disk
 * rather than by which tool was used, so a Write that would clobber an
 * existing order is refused on the same footing as an Edit of it.
 */
function roleGate(relPath, lower, abs) {
  const r = resolveRole();
  const who = describeRole(r);

  // builder (G2): the manifest governs everywhere EXCEPT the black box, which
  // is closed to it entirely. The builder is the party CAMPAIGN/ grades, and a
  // graded party that can edit its own verdicts, orders and charters is not
  // being graded. It keeps the duty to COMMIT that directory as found — hooks
  // gate the Edit/Write tools, not git.
  if (r.recognized && r.role === BUILDER) {
    if (lower.startsWith(CAMPAIGN)) {
      die(
        `${relPath} is closed to the ${who} door — docs/surgery/CAMPAIGN/ is the black box, ` +
          'and the builder is the party it grades. Builder claims, asks and evidence belong in ' +
          'the run directory. Committing this directory as found is still the builder\'s duty; ' +
          'writing to it is not.'
      );
    }
    return;
  }

  if (!lower.startsWith(CAMPAIGN)) {
    die(
      `${relPath} is outside the ${who} door — that role may write only under ` +
        'docs/surgery/CAMPAIGN/. A role NARROWS the incision manifest and never widens it, ' +
        'so being on the allow list is not enough on its own.'
    );
  }

  if (lower === LEDGER) return;

  if (fs.existsSync(abs)) {
    die(
      `${relPath} already exists, and the ${who} door is CREATE-ONLY under ` +
        'docs/surgery/CAMPAIGN/ with ledger.md as the single mutable file. Orders, verdicts, ' +
        'receipts, sitreps and checkpoints are immutable the moment they are written — the ' +
        'black box cannot be doctored after the fact, including by the role that wrote it.'
    );
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    die(`guard-edit could not read the tool payload (${e.message}). Fail-closed.`);
  }

  const input = payload.tool_input || {};
  // Edit/Write use file_path; MultiEdit uses file_path too (edits[] share it).
  const target = input.file_path || input.notebook_path;
  if (!target) die('guard-edit found no file_path on the tool call. Fail-closed.');

  const abs = path.resolve(REPO, target);
  const relPath = rel(abs);

  if (relPath.startsWith('..')) {
    die(`${relPath} is outside the repository. Only paths on the incision manifest may be written.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(CURRENT, 'utf8'));
  } catch (e) {
    die(
      `${relPath} not on the incision manifest — docs/surgery/CURRENT/manifest.json is unreadable ` +
        `(${e.message}). No manifest, no writes.`
    );
  }

  const runId = manifest.run_id;
  const mode = manifest.mode;
  const locked = manifest.locked === true;
  const lower = relPath.toLowerCase();

  // --- hard deny, above every allow list ------------------------------------
  // The goldens are evidence, not editable material. `backend/tests/` is on the
  // surgeon's allow list so that new test files can be authored, and that
  // subtree would otherwise swallow the locked baseline — letting a Write
  // relock the goldens while guard-bash was busy watching the shell. Relocking
  // must be impossible through EVERY door, not just the one we expected.
  if (lower.startsWith('backend/tests/golden/')) {
    die(
      `${relPath} not on the incision manifest — backend/tests/golden/ is sealed to every mode. ` +
        'Relocking the goldens is mechanically impossible; goldens are proof, and proof you can ' +
        'edit is not proof.'
    );
  }

  // --- locked: the cage cannot be weakened by its occupant -----------------
  if (locked) {
    const forbidden = [
      { test: () => /(^|\/)manifest\.json$/.test(lower), what: 'the manifest itself' },
      { test: () => lower.startsWith('docs/surgery/current/'), what: 'docs/surgery/CURRENT/' },
      { test: () => lower.startsWith('.claude/'), what: '.claude/' },
      { test: () => lower.startsWith('scripts/surgery/'), what: 'scripts/surgery/' },
    ];
    for (const f of forbidden) {
      if (f.test()) {
        die(
          `${relPath} not on the incision manifest — the harness is LOCKED (${runId}) and ` +
            `${f.what} is sealed. The cage cannot be weakened by its occupant.`
        );
      }
    }
  }

  // --- verifier mode: evidence only ----------------------------------------
  if (mode === 'verifier') {
    const only = `docs/surgery/${runId}/verify/`.toLowerCase();
    if (!lower.startsWith(only)) {
      die(`${relPath} not on the incision manifest — verifier mode may write only docs/surgery/${runId}/verify/.`);
    }
    roleGate(relPath, lower, abs);
    process.exit(0);
  }

  // --- surgeon mode: the allow list ----------------------------------------
  if (mode !== 'surgeon') {
    die(`${relPath} not on the incision manifest — manifest mode "${mode}" is not a writing mode.`);
  }

  const allow = Array.isArray(manifest.allow) ? manifest.allow : [];
  const ok = allow.some((entry) => {
    const e = String(entry).toLowerCase();
    return e.endsWith('/') ? lower.startsWith(e) : lower === e;
  });

  if (!ok) die(`${relPath} not on the incision manifest.`);

  // The manifest has said yes. The role may still say no; it cannot say yes.
  roleGate(relPath, lower, abs);
  process.exit(0);
}

main();
