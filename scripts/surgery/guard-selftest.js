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
 *
 * ROLE IS PINNED PER CASE, NEVER INHERITED (M0.1). Every case states the
 * CP_ROLE it is testing and the runner builds that environment explicitly,
 * deleting the variable for the "unset" cases. This is not tidiness: the
 * architect grades this file by running it from an ARCHITECT terminal, and if
 * cases inherited the ambient role, every builder-ALLOW case would block there
 * and the same file would disagree with itself depending on who ran it. A test
 * whose result depends on which terminal invoked it proves nothing.
 *
 * WINDOW COUPLING: the ALLOW expectations below name real paths on the live
 * incision manifest, so they are coupled to whichever window is open. The
 * WINDOW preflight case makes that coupling loud — if the manifest moves on,
 * one case fails saying exactly that, instead of several failing in ways that
 * look like a broken guard.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const EDIT_HOOK = path.join(REPO, '.claude', 'hooks', 'guard-edit.js');
const BASH_HOOK = path.join(REPO, '.claude', 'hooks', 'guard-bash.js');
const MANIFEST = path.join(REPO, 'docs', 'surgery', 'CURRENT', 'manifest.json');

/** The window these expectations were authored against. */
const EXPECTED_WINDOW = 'orchestration-2026-08-08';

/** Sentinel roles. `UNSET` means "delete CP_ROLE from the child environment". */
const UNSET = Symbol('CP_ROLE unset');

function run(hook, payload, role) {
  const env = Object.assign({}, process.env);
  delete env.CP_ROLE;
  if (role !== UNSET) env.CP_ROLE = role;

  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
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

/**
 * A path under CAMPAIGN/ that must NOT exist, for the architect create case.
 * Its absence is asserted in the preflight rather than assumed, because if it
 * ever came to exist this case would silently flip from testing CREATE to
 * testing EDIT and would still pass for the wrong reason.
 */
const CAMPAIGN_NEW = 'docs/surgery/CAMPAIGN/checkpoints/_selftest-must-not-exist.md';
const CAMPAIGN_LEDGER = 'docs/surgery/CAMPAIGN/ledger.md';
const CAMPAIGN_EXISTING = 'docs/surgery/CAMPAIGN/orders/order-M0.1.md';

/**
 * Window fixtures, re-pointed 2026-08-08 from campaign-p2-m0 to
 * orchestration-2026-08-08 — the same operation M0.1 performed once before
 * (see the note above CASES). The assertion each case makes is unchanged;
 * only the example paths moved, because the allow list moved under them.
 *
 * Naming them here instead of inlining them means the NEXT window re-points
 * seven constants rather than hunting twenty string literals, which is how
 * this file drifted stale in the first place.
 */
// Granted by a "/"-suffixed prefix entry. Never written — the hook decides on
// the path string alone.
const ON_MANIFEST_PREFIX = 'frontend/src/_selftest-probe.jsx';
// Granted by an exact entry.
const ON_MANIFEST_EXACT = 'CLAUDE.md';
// This window's own run directory.
const ON_MANIFEST_RUNDIR = 'docs/surgery/orchestration-2026-08-08/evidence/x.txt';
// NOT granted, deliberately: ORCHESTRATION.md puts migrations on the
// ESCALATE, NEVER DECIDE list, so this is a stable negative control.
const OFF_MANIFEST_MIGRATION = 'backend/prisma/schema.prisma';
// Proves an exact entry is not a prefix of deeper paths: "package.json" is
// granted, "frontend/package.json" is a different file and must not be.
const OFF_MANIFEST_NESTED_PKG = 'frontend/package.json';
// Sealed by locked:true even though "scripts/" IS on the allow list. If this
// ever passes, the lock stopped binding and the cage can be edited from inside.
const LOCK_SEALED_SURGERY = 'scripts/surgery/witness.js';
const LOCK_SEALED_CLAUDE = '.claude/settings.json';

// [label, hook, payload, want, role]
const CASES = [
  // --- guard-edit · manifest layer, as builder ------------------------------
  // Re-pointed in M0.1 from the surgery-20260727-1010 window to campaign-p2-m0,
  // and again on 2026-08-08 to orchestration-2026-08-08. The assertion each
  // case makes is unchanged — "a path the manifest grants is allowed" — only
  // the paths moved, because the window moved under them.
  //
  // Three of the old negative controls (CLAUDE.md, package.json,
  // backend/src/lib/bmrEngine.js) became GRANTED in this window, which is why
  // they could not stay as BLOCK cases: MISSION 0 requires the manifest to
  // grant exactly those. They are replaced by controls this window really does
  // refuse, and by two new cases covering locked:true, which campaign-p2-m0
  // never exercised because it ran with locked:false.
  ['EDIT  on-manifest  src/ subtree (prefix entry)', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'ALLOW', 'builder'],
  ['EDIT  on-manifest  CLAUDE.md (exact entry)', EDIT_HOOK, editPayload(ON_MANIFEST_EXACT), 'ALLOW', 'builder'],
  ['EDIT  on-manifest  run docs subtree', EDIT_HOOK, editPayload(ON_MANIFEST_RUNDIR), 'ALLOW', 'builder'],
  ['EDIT  exact entry is not a prefix', EDIT_HOOK, editPayload('package.json.bak'), 'BLOCK', 'builder'],
  ['EDIT  exact entry is not nested', EDIT_HOOK, editPayload(OFF_MANIFEST_NESTED_PKG), 'BLOCK', 'builder'],
  ['EDIT  OFF-manifest migration (escalate-only)', EDIT_HOOK, editPayload(OFF_MANIFEST_MIGRATION), 'BLOCK', 'builder'],
  ['EDIT  LOCK-sealed scripts/surgery/ (scripts/ IS granted)', EDIT_HOOK, editPayload(LOCK_SEALED_SURGERY), 'BLOCK', 'builder'],
  ['EDIT  LOCK-sealed .claude/', EDIT_HOOK, editPayload(LOCK_SEALED_CLAUDE), 'BLOCK', 'builder'],
  ['EDIT  SEALED golden baseline', EDIT_HOOK, editPayload('backend/tests/golden/engine-baseline.golden.json'), 'BLOCK', 'builder'],
  ['EDIT  SEALED golden fixtures', EDIT_HOOK, editPayload('backend/tests/golden/fixtures.js'), 'BLOCK', 'builder'],
  ['EDIT  OFF-manifest sibling run dir', EDIT_HOOK, editPayload('docs/surgery/surgery-20260727-0217/REPORT.md'), 'BLOCK', 'builder'],
  ['EDIT  escape the repo', EDIT_HOOK, editPayload(path.join(REPO, '..', 'outside.txt')), 'BLOCK', 'builder'],

  // --- guard-bash · pattern layer, as builder -------------------------------
  ['BASH  benign npm test', BASH_HOOK, bashPayload('npm test'), 'ALLOW', 'builder'],
  ['BASH  benign git status', BASH_HOOK, bashPayload('git status --short'), 'ALLOW', 'builder'],
  ['BASH  git ' + 'push', BASH_HOOK, bashPayload('git ' + 'push origin HEAD'), 'BLOCK', 'builder'],
  ['BASH  git ' + 'push --dry-run', BASH_HOOK, bashPayload('git ' + 'push --dry-run'), 'BLOCK', 'builder'],
  ['BASH  git ' + 'reset', BASH_HOOK, bashPayload('git ' + 'reset --hard HEAD~1'), 'BLOCK', 'builder'],
  ['BASH  git ' + 'rebase', BASH_HOOK, bashPayload('git ' + 'rebase -i HEAD~3'), 'BLOCK', 'builder'],
  ['BASH  --force flag', BASH_HOOK, bashPayload('npm install --force'), 'BLOCK', 'builder'],
  ['BASH  rm -rf', BASH_HOOK, bashPayload('rm -rf backend/node_modules'), 'BLOCK', 'builder'],
  ['BASH  golden relock verbatim', BASH_HOOK, bashPayload(RELOCK), 'BLOCK', 'builder'],
  ['BASH  port 3001 probe', BASH_HOOK, bashPayload('curl -s http://127.0.0.1:3001/healthz'), 'BLOCK', 'builder'],
  ['BASH  packaged DB touch', BASH_HOOK, bashPayload('ls -la backend/prisma/dev.db.template'), 'BLOCK', 'builder'],
  ['BASH  write PUSH_APPROVED', BASH_HOOK, bashPayload('echo "go surgery-20260727-1010" > docs/surgery/CURRENT/PUSH_APPROVED'), 'BLOCK', 'builder'],
  ['BASH  cat .env', BASH_HOOK, bashPayload('cat backend/.env'), 'BLOCK', 'builder'],
  ['BASH  printenv KEY', BASH_HOOK, bashPayload('printenv ANTHROPIC_API_KEY'), 'BLOCK', 'builder'],
  ['BASH  literal key shape', BASH_HOOK, bashPayload('echo ' + KEY_SHAPE), 'BLOCK', 'builder'],

  // === M0.1 · THE ROLE MATRIX ==============================================
  // --- A2/A3/A4 · the architect door is CREATE-ONLY, ledger excepted --------
  ['ROLE  architect · CREATE new file under CAMPAIGN/', EDIT_HOOK, editPayload(CAMPAIGN_NEW), 'ALLOW', 'architect'],
  ['ROLE  architect · EDIT ledger.md (the one mutable file)', EDIT_HOOK, editPayload(CAMPAIGN_LEDGER), 'ALLOW', 'architect'],
  ['ROLE  architect · EDIT existing order (immutable)', EDIT_HOOK, editPayload(CAMPAIGN_EXISTING), 'BLOCK', 'architect'],
  ['ROLE  architect · EDIT existing charter (immutable)', EDIT_HOOK, editPayload('docs/surgery/CAMPAIGN/charter-builder.md'), 'BLOCK', 'architect'],

  // --- A5 · outside CAMPAIGN/, and off-manifest anyway ----------------------
  ['ROLE  architect · WRITE off-manifest source', EDIT_HOOK, editPayload(OFF_MANIFEST_MIGRATION), 'BLOCK', 'architect'],

  // --- A6/A7 · THE INTERSECTION PROOF --------------------------------------
  // Same path, on the manifest allow list in both rows. Allowed for builder,
  // denied for architect. If the architect row ever passes, role has become a
  // union and the entire design is wrong regardless of what else is green.
  ['ROLE  architect · WRITE on-manifest path  (INTERSECTION)', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'BLOCK', 'architect'],
  ['ROLE  builder   · WRITE on-manifest path  (INTERSECTION)', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'ALLOW', 'builder'],

  // --- A8 · role adds no permission to the builder --------------------------
  ['ROLE  builder   · WRITE off-manifest source', EDIT_HOOK, editPayload(OFF_MANIFEST_MIGRATION), 'BLOCK', 'builder'],
  ['ROLE  builder   · CANNOT reach CAMPAIGN-only logic to widen', EDIT_HOOK, editPayload('docs/surgery/surgery-20260727-1010/REPORT.md'), 'BLOCK', 'builder'],

  // --- A9/A10 · fail-closed on absent, blank and unknown --------------------
  ['ROLE  UNSET     · WRITE on-manifest path', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'BLOCK', UNSET],
  ['ROLE  ""        · WRITE on-manifest path', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'BLOCK', ''],
  ['ROLE  "   "     · WRITE on-manifest path', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'BLOCK', '   '],
  ['ROLE  "admin"   · WRITE on-manifest path', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'BLOCK', 'admin'],
  ['ROLE  "surgeon" · WRITE on-manifest path', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'BLOCK', 'surgeon'],
  ['ROLE  UNSET     · CREATE under CAMPAIGN/ (architect door)', EDIT_HOOK, editPayload(CAMPAIGN_NEW), 'ALLOW', UNSET],

  // --- A10 · normalization: trim + case-fold, per I2 ------------------------
  // SETTLED 2026-07-28 by owner ruling, passphrase given: I2 stands, A10
  // amended. A padded, upper-cased BUILDER is a builder. A forgotten space is
  // a typo, not an intrusion.
  ['ROLE  "  BUILDER  " · normalizes to builder (SETTLED, I2)', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'ALLOW', '  BUILDER  '],
  ['ROLE  "Architect"   · normalizes to architect', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'BLOCK', 'Architect'],

  // === M0.2 · G2 — THE BLACK BOX IS CLOSED TO THE BUILDER ==================
  // The builder is the party CAMPAIGN/ grades. A graded party that can edit its
  // own verdicts, orders and charters is not being graded. R2-R7.
  ['G2    builder   · EDIT existing order', EDIT_HOOK, editPayload(CAMPAIGN_EXISTING), 'BLOCK', 'builder'],
  ['G2    builder   · EDIT its OWN charter', EDIT_HOOK, editPayload('docs/surgery/CAMPAIGN/charter-builder.md'), 'BLOCK', 'builder'],
  ['G2    builder   · EDIT the ARCHITECT charter', EDIT_HOOK, editPayload('docs/surgery/CAMPAIGN/charter-architect.md'), 'BLOCK', 'builder'],
  ['G2    builder   · EDIT the verdict that grades it', EDIT_HOOK, editPayload('docs/surgery/CAMPAIGN/verdicts/verdict-M0.1.md'), 'BLOCK', 'builder'],
  ['G2    builder   · CREATE new file under CAMPAIGN/', EDIT_HOOK, editPayload(CAMPAIGN_NEW), 'BLOCK', 'builder'],
  ['G2    builder   · EDIT ledger.md (architect\'s file)', EDIT_HOOK, editPayload(CAMPAIGN_LEDGER), 'BLOCK', 'builder'],
  // The pair that proves G2 cut the right width: CAMPAIGN/ closed, everything
  // else the manifest grants still open. If the builder loses those too, the
  // door was cut too wide; if it keeps CAMPAIGN/, nothing was cut at all.
  //
  // CHANGED 2026-08-08 — and unlike every other edit in this pass, this one
  // changes what is ASSERTED, not just which path asserts it. The first row
  // used to read "still reaches the manifest (.claude/hooks/)". The
  // orchestration-2026-08-08 window deliberately does NOT grant .claude/ or
  // scripts/surgery/, so that row can no longer be true. Rationale:
  // ORCHESTRATION.md puts "widening a permission or editing the manifest" on
  // the ESCALATE, NEVER DECIDE list, and MISSION 1 item 3 tells the
  // orchestrator to REPORT the settings.json denial rather than widen it — an
  // orchestrator that can rewrite .claude/settings.json can grant itself the
  // very thing it was told to ask about.
  //
  // The width test survives intact against any other granted path. What is
  // ABANDONED for this window is the narrower invariant "the builder can edit
  // its own cage". That is an OWNER decision, recorded not taken: to restore
  // it, add .claude/hooks/, .claude/settings.json and
  // scripts/surgery/guard-selftest.js to the allow list, set locked:false, and
  // point the first row back at .claude/hooks/guard-edit.js. The two
  // LOCK-sealed cases at the top of CASES are what currently pin the opposite
  // choice, so flip those to ALLOW in the same edit or they will contradict.
  ['G2    builder   · still reaches non-CAMPAIGN manifest paths', EDIT_HOOK, editPayload(ON_MANIFEST_PREFIX), 'ALLOW', 'builder'],
  ['G2    builder   · still reaches its own run dir', EDIT_HOOK, editPayload('docs/surgery/orchestration-2026-08-08/claims-M0.1.md'), 'ALLOW', 'builder'],

  // --- A11 · the goldens are sealed above every role ------------------------
  ['ROLE  builder   · WRITE goldens', EDIT_HOOK, editPayload('backend/tests/golden/anything.json'), 'BLOCK', 'builder'],
  ['ROLE  architect · WRITE goldens', EDIT_HOOK, editPayload('backend/tests/golden/anything.json'), 'BLOCK', 'architect'],
  ['ROLE  UNSET     · WRITE goldens', EDIT_HOOK, editPayload('backend/tests/golden/anything.json'), 'BLOCK', UNSET],

  // --- A12 · the shell gate: the architect reads and runs, builder commits --
  ['ROLE  architect · git commit', BASH_HOOK, bashPayload('git commit -m x'), 'BLOCK', 'architect'],
  ['ROLE  builder   · git commit', BASH_HOOK, bashPayload('git commit -m x'), 'ALLOW', 'builder'],
  ['ROLE  architect · git add', BASH_HOOK, bashPayload('git add -A'), 'BLOCK', 'architect'],
  ['ROLE  architect · git checkout', BASH_HOOK, bashPayload('git checkout master'), 'BLOCK', 'architect'],
  ['ROLE  architect · git switch', BASH_HOOK, bashPayload('git switch master'), 'BLOCK', 'architect'],
  ['ROLE  architect · git stash', BASH_HOOK, bashPayload('git stash'), 'BLOCK', 'architect'],
  ['ROLE  architect · git tag', BASH_HOOK, bashPayload('git tag v1'), 'BLOCK', 'architect'],
  ['ROLE  architect · git merge', BASH_HOOK, bashPayload('git merge feature'), 'BLOCK', 'architect'],
  ['ROLE  architect · git cherry-pick', BASH_HOOK, bashPayload('git cherry-pick abc1234'), 'BLOCK', 'architect'],
  ['ROLE  architect · git branch -D', BASH_HOOK, bashPayload('git branch -D old-branch'), 'BLOCK', 'architect'],
  ['ROLE  architect · git branch --delete', BASH_HOOK, bashPayload('git branch --delete old-branch'), 'BLOCK', 'architect'],
  ['ROLE  UNSET     · git commit (fail-closed)', BASH_HOOK, bashPayload('git commit -m x'), 'BLOCK', UNSET],
  ['ROLE  architect · git status (reads, allowed)', BASH_HOOK, bashPayload('git status --short'), 'ALLOW', 'architect'],
  ['ROLE  architect · git log (reads, allowed)', BASH_HOOK, bashPayload('git log --oneline -5'), 'ALLOW', 'architect'],
  ['ROLE  architect · git branch (lists, allowed)', BASH_HOOK, bashPayload('git branch --show-current'), 'ALLOW', 'architect'],
  ['ROLE  architect · node script (runs, allowed)', BASH_HOOK, bashPayload('node scripts/surgery/goldens-verify.js'), 'ALLOW', 'architect'],
  ['ROLE  architect · still bound by every existing rule', BASH_HOOK, bashPayload('git ' + 'push origin HEAD'), 'BLOCK', 'architect'],
];

// --- preflight: assertions about the world these cases assume ---------------
const preflight = [];

let window_ = null;
try {
  window_ = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).run_id;
} catch (e) {
  window_ = `<unreadable: ${e.message}>`;
}
preflight.push([
  `WINDOW  live manifest is ${EXPECTED_WINDOW}`,
  window_ === EXPECTED_WINDOW,
  `manifest run_id is "${window_}" but the ALLOW expectations in this file were ` +
    `authored against "${EXPECTED_WINDOW}". The guard is probably fine and the ` +
    `expectations are stale — re-point the on-manifest cases to the live allow list.`,
]);

preflight.push([
  `FIXTURE ${CAMPAIGN_NEW} does not exist`,
  !fs.existsSync(path.join(REPO, CAMPAIGN_NEW)),
  'that path must stay absent — it is the CREATE case for the architect door, and if it ' +
    'exists the case silently becomes an EDIT case and passes for the wrong reason.',
]);

let pass = 0;
let fail = 0;
const lines = [];

for (const [label, ok, why] of preflight) {
  if (ok) {
    pass++;
    lines.push(`PASS  ${'preflight'.padEnd(17)}  ${label}`);
  } else {
    fail++;
    lines.push(`FAIL  ${'preflight'.padEnd(17)}  ${label}\n        -> ${why}`);
  }
}

for (const [label, hook, payload, want, role] of CASES) {
  const { code, err } = run(hook, payload, role);
  const got = code === 0 ? 'ALLOW' : 'BLOCK';
  const expected = want.startsWith('ALLOW') ? 'ALLOW' : 'BLOCK';
  const ok = got === expected;
  if (ok) pass++;
  else fail++;
  const shown = role === UNSET ? '<unset>' : JSON.stringify(role);
  lines.push(
    `${ok ? 'PASS' : 'FAIL'}  want=${expected.padEnd(5)} got=${got.padEnd(5)} role=${String(shown).padEnd(13)} ${label}` +
      (code !== 0 ? `\n        -> ${err.split('\n')[0]}` : '')
  );
}

console.log(lines.join('\n'));
console.log(`\nguard-selftest: ${pass} passed, ${fail} failed, ${CASES.length + preflight.length} total`);
process.exit(fail === 0 ? 0 : 1);
