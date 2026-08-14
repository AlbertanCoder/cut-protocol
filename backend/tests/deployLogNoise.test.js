// REGRESSION GUARD — the production error channel must mean "error" (2026-08-14).
//
// A QC sweep of the live boot found the container printing ERROR-tagged lines
// that were not errors. Two sources, both from Prisma, both explained here
// because the fix for each lives in a different line of the Dockerfile:
//
//   1. "Prisma failed to detect the libssl/openssl version to use". Emitted by
//      Prisma's warn helper, which is `console.warn` — stderr — so the cloud log
//      collector types it level=error. FIXED at the source by commit f9d0846:
//      the runtime stage installs the `openssl` package, so engine detection
//      resolves instead of falling back. Test 2 below holds that install down;
//      if someone trims the apt line as "unused", the warning silently returns
//      and this suite says so.
//
//   2. "Update available 6.19.3 -> 7.9.1". The CLI renders this banner and ends
//      with `console.error(p)` — again stderr, again level=error. Verified in
//      the installed CLI (prisma 6.19.3, node_modules/prisma/build/index.js);
//      test 4 re-verifies the env var name against that same file so this suite
//      cannot pass on a switch Prisma does not actually read.
//
// WHY THIS IS WORTH A TEST. Log levels are a filter the owner uses under
// pressure. A boot that prints ERROR lines for non-errors trains the reader to
// skip ERROR, and the first line of a real incident is then already invisible.
// The failure mode is not noise; it is a disarmed alarm.
//
// AND THE OTHER DIRECTION, which tests 3 and 5 exist for: the cure must not be
// worse. Silencing genuine Prisma warnings (PRISMA_DISABLE_WARNINGS) or throwing
// away migrate's stderr (`2>/dev/null`) would make the logs quiet by making them
// blind — and docker-entrypoint.sh *parses* that stderr to tell a saturated
// connection pool apart from a broken migration, so discarding it would also
// break boot logic. Only the version banner may be suppressed.
//
// Everything here is a static read of two committed files. Nothing is built,
// nothing is spawned, and no cloud resource is touched.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "../..");
const DOCKERFILE = path.join(REPO, "Dockerfile");
const ENTRYPOINT = path.join(REPO, "docker-entrypoint.sh");

/** Read a committed file, failing with the path rather than a bare ENOENT. */
function readRepoFile(p) {
  assert.ok(fs.existsSync(p), `expected ${p} to exist — the deploy stack is committed at the repo root`);
  return fs.readFileSync(p, "utf8");
}

/**
 * Dockerfile instructions with backslash-continuations folded into one line and
 * comment lines dropped, so a `#`-commented example can never satisfy — or trip
 * — an assertion below.
 */
function instructions(dockerfile) {
  const folded = dockerfile.replace(/\\\r?\n/g, " ");
  return folded
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * The instructions belonging to the LAST build stage — the one that becomes the
 * shipped image. An ENV in the frontend-build stage is thrown away with it, so
 * asserting against the whole file would accept a fix that never reaches
 * production.
 */
function runtimeStage(dockerfile) {
  const lines = instructions(dockerfile);
  let lastFrom = -1;
  lines.forEach((l, i) => {
    if (/^FROM\s/i.test(l)) lastFrom = i;
  });
  assert.ok(lastFrom >= 0, "Dockerfile has no FROM instruction");
  return lines.slice(lastFrom);
}

test("the runtime stage suppresses Prisma's version banner — a release notice is not an error", () => {
  const stage = runtimeStage(readRepoFile(DOCKERFILE));
  // `ENV KEY=value` and the legacy `ENV KEY value` are both accepted forms.
  const hit = stage.find((l) => /^ENV\s+(.*\s)?PRISMA_HIDE_UPDATE_MESSAGE[=\s]/i.test(l));
  assert.ok(
    hit,
    "REGRESSION: the runtime stage does not set PRISMA_HIDE_UPDATE_MESSAGE.\n" +
      "  Prisma's CLI prints its 'Update available X -> Y' banner with console.error,\n" +
      "  so every boot files a version notice under level=error in production logs.\n" +
      "  Set `ENV PRISMA_HIDE_UPDATE_MESSAGE=1` in the final stage of the Dockerfile."
  );
  const value = hit.replace(/^ENV\s+/i, "").match(/PRISMA_HIDE_UPDATE_MESSAGE[=\s]+("?)([^"\s]*)\1/i);
  assert.ok(value && value[2].length > 0 && value[2] !== "0",
    `PRISMA_HIDE_UPDATE_MESSAGE must be set to a truthy value; found: ${hit}`);
});

test("the runtime stage still installs openssl — that warning is fixed at the source, not muted", () => {
  const stage = runtimeStage(readRepoFile(DOCKERFILE)).join("\n");
  assert.match(
    stage,
    /apt-get\s+install[^\n]*\bopenssl\b/,
    "REGRESSION: the runtime stage no longer installs openssl (commit f9d0846).\n" +
      "  Without it Prisma cannot detect a libssl version, warns on every boot via\n" +
      "  console.warn (stderr => level=error), and falls back to openssl-1.1.x — which\n" +
      "  becomes a hard engine-load failure after any base-image bump."
  );
});

test("nothing in the deploy stack silences GENUINE Prisma warnings or errors", () => {
  const docker = readRepoFile(DOCKERFILE);
  const entry = readRepoFile(ENTRYPOINT);

  for (const [name, body] of [["Dockerfile", docker], ["docker-entrypoint.sh", entry]]) {
    const live = body
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");

    assert.doesNotMatch(
      live,
      /PRISMA_DISABLE_WARNINGS/,
      `${name} sets PRISMA_DISABLE_WARNINGS. That switch silences real prisma:warn\n` +
        "  diagnostics — engine/OpenSSL detection, datasource problems — not just the\n" +
        "  version banner. Use PRISMA_HIDE_UPDATE_MESSAGE, which gates the banner alone."
    );

    // `2>&1` (a merge, kept) is fine; `2>/dev/null` (a discard) is not.
    assert.doesNotMatch(
      live,
      /2>\s*\/dev\/null/,
      `${name} discards stderr. docker-entrypoint.sh MATCHES ON that text to tell a\n` +
        "  saturated pool apart from a genuinely broken migration — throwing it away\n" +
        "  makes the logs quiet by making the boot blind."
    );

    assert.doesNotMatch(
      live,
      /prisma[^\n]*\|\s*grep\s+-v/,
      `${name} filters Prisma output through \`grep -v\`. A denylist over log text\n` +
        "  drops whichever real error happens to contain the filtered phrase."
    );
  }
});

test("the boot script still prints the migrate output it captured", () => {
  const entry = readRepoFile(ENTRYPOINT);
  assert.match(
    entry,
    /out=\$\(/,
    "the boot script must still capture migrate's combined output — the pool-vs-broken triage reads it"
  );
  assert.match(
    entry,
    /echo\s+"\$out"/,
    "REGRESSION: the captured migrate output is no longer echoed. Suppressing the\n" +
      "  version banner must not turn into suppressing the migration log itself —\n" +
      "  that log is the only record of which migrations a deploy applied."
  );
});

test("PRISMA_HIDE_UPDATE_MESSAGE is the name the INSTALLED CLI actually reads", () => {
  // Guards against a plausible-looking but wrong variable name: an env var that
  // nothing reads is a silent no-op, and this whole change would then be a
  // comment. `prisma` is a prod dependency, so its build is present after
  // `npm ci` — but say so out loud rather than pass silently if it is not.
  const cli = path.join(__dirname, "..", "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(cli)) {
    console.log("[deployLogNoise] prisma CLI build not present — env-var-name cross-check skipped");
    return;
  }
  const src = fs.readFileSync(cli, "utf8");
  assert.ok(
    src.includes("PRISMA_HIDE_UPDATE_MESSAGE"),
    "the installed Prisma CLI does not read PRISMA_HIDE_UPDATE_MESSAGE — the Dockerfile ENV would be a no-op"
  );
  assert.ok(
    src.includes("Update available"),
    "the installed Prisma CLI no longer renders an 'Update available' banner — re-verify what this suppresses"
  );
});
