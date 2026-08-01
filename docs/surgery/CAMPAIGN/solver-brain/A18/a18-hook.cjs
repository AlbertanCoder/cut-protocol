// A18/a18-hook.cjs — objective-constant patcher for the A1 rig.
//
// WHY THIS EXISTS. The rig's treatment contract (A1/rig/SCHEMA.md) patches
// INPUTS only — {target, pool, mealConfig, filters, adjusters, solveOpts}. A18's
// assignment is to sweep OBJECTIVE CONSTANTS, which are module-level `const`s
// inside backend/src/lib/*.js and are therefore unreachable from a treatment.
//
// BRIEF.md forbids modifying backend/src. This hook does NOT: it intercepts
// CommonJS compilation, applies an exact string substitution to the source TEXT
// in memory, and compiles that. `backend/src` on disk is never opened for write.
// Verify with: git status --porcelain backend/  (must be unchanged from session start)
//
// It FAILS LOUD. If a `find` string is not present verbatim in the target file,
// the process exits 3 rather than silently measuring an unpatched baseline —
// the single most likely way this experiment could manufacture a false null.
//
// Usage:
//   A18_EDITS='[{"file":"mealSolver.js","find":"...","replace":"..."}]' \
//     node --require ./a18-hook.cjs ../A1/rig/runRig.mjs --agent=A18 ...
//
// Every applied edit is echoed to stderr so the run log carries its own diff.

const Module = require("node:module");
const fs = require("node:fs");

let EDITS = [];
try {
  EDITS = JSON.parse(process.env.A18_EDITS || "[]");
} catch (e) {
  console.error("[a18-hook] A18_EDITS is not valid JSON: " + e.message);
  process.exit(3);
}
if (!Array.isArray(EDITS)) {
  console.error("[a18-hook] A18_EDITS must be a JSON array");
  process.exit(3);
}

const applied = new Set();
const origJs = Module._extensions[".js"];

Module._extensions[".js"] = function (mod, filename) {
  const norm = filename.replace(/\\/g, "/");
  const mine = EDITS.filter((e) => norm.endsWith("/backend/src/lib/" + e.file));
  if (!mine.length) return origJs(mod, filename);

  let src = fs.readFileSync(filename, "utf8");
  for (const e of mine) {
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error(
        `[a18-hook] FATAL: find-string occurs ${n} times (need exactly 1) in ${e.file}\n` +
        `  find: ${e.find}`
      );
      process.exit(3);
    }
    src = src.split(e.find).join(e.replace);
    applied.add(e.file + "::" + e.find.slice(0, 60));
    console.error(`[a18-hook] PATCHED ${e.file}`);
    console.error(`[a18-hook]   -  ${e.find}`);
    console.error(`[a18-hook]   +  ${e.replace}`);
  }
  mod._compile(src, filename);
};

process.on("exit", () => {
  if (applied.size !== EDITS.length) {
    console.error(
      `[a18-hook] FATAL: ${EDITS.length} edit(s) requested, ${applied.size} applied — ` +
      `a target module was never loaded. THIS RUN IS INVALID.`
    );
    process.exitCode = 3;
  }
});
