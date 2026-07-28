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

const REPO = path.resolve(__dirname, '..', '..');
const CURRENT = path.join(REPO, 'docs', 'surgery', 'CURRENT', 'manifest.json');

// ---- TEMPORARY I1 PROBE — mission M0.1, removed in the same mission --------
// Records what this hook CHILD PROCESS can see of CP_ROLE. Wrapped so that a
// probe failure can never alter a guard verdict: the probe may not make the
// cage more permissive, so it may not throw.
try {
  fs.appendFileSync(
    path.join(REPO, 'docs', 'surgery', 'campaign-p2-m0', 'evidence', 'I1-hook-env-probe.jsonl'),
    JSON.stringify({
      hook: 'guard-edit',
      present: Object.prototype.hasOwnProperty.call(process.env, 'CP_ROLE'),
      raw: process.env.CP_ROLE === undefined ? null : process.env.CP_ROLE,
      typeof_raw: typeof process.env.CP_ROLE,
      pid: process.pid,
      ppid: process.ppid,
      at: new Date().toISOString(),
    }) + '\n'
  );
} catch {
  /* probe is diagnostic only; never let it speak for the guard */
}
// ---- END TEMPORARY I1 PROBE ------------------------------------------------

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
  process.exit(0);
}

main();
