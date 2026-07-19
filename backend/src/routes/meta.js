const express = require("express");
const path = require("path");

const router = express.Router();

// Public, non-personal build metadata for the bug-report footer (version + OS).
// Deliberately NOT behind requireAuth and deliberately carries zero user data.
let cached = null;
function buildMeta() {
  if (cached) return cached;
  let version = "unknown";
  try {
    version = require(path.join(__dirname, "..", "..", "..", "package.json")).version || "unknown";
  } catch {
    /* dev-tree layout differs; leave "unknown" */
  }
  cached = {
    version,
    platform: process.platform, // "win32" | "darwin" | "linux"
    arch: process.arch,
    node: process.versions.node,
    packaged: !!process.env.CUT_PROTOCOL_DB_PATH, // set only in the packaged Electron build
  };
  return cached;
}

router.get("/", (_req, res) => res.json(buildMeta()));

module.exports = router;
