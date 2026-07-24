// Cut Protocol — tiny main-process file logger.
//
// Why this exists: once a built copy leaves this machine there is no console
// to read. Boot failures, update checks and license decisions all need to
// land somewhere the user can be POINTED AT ("couldn't reach the local
// server — here's the log path"), because the alternative is an outside user
// staring at a dead window with nothing to send back.
//
// Deliberately dependency-free and deliberately boring:
//   - appends one line per event, ISO timestamp first;
//   - never throws (a logger that can crash boot is worse than no logger);
//   - truncates itself when it passes ~512 KB so it can't grow forever;
//   - writes ONLY to the per-user writable dir, never into the install dir.
//
// It records diagnostics, not user data: no food, weight, email, or token
// values ever go through here.

const fs = require("fs");
const path = require("path");

const MAX_BYTES = 512 * 1024;

let logDir = null;
let logFile = null;

/**
 * Resolve the log location. Called once from main.cjs after app.setName()
 * (so userData already points at "%AppData%\Cut Protocol"). Safe to call
 * more than once; safe to call before it and fall back to a temp dir.
 */
function init(app) {
  try {
    logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, "cut-protocol.log");
  } catch {
    logDir = null;
    logFile = null;
  }
  return logFile;
}

function getLogPath() {
  return logFile;
}

function getLogDir() {
  return logDir;
}

function write(scope, message) {
  const line = `${new Date().toISOString()} [${scope}] ${message}`;
  // Always mirror to stdout so `npm start` still shows everything in dev.
  console.log(line);
  if (!logFile) return;
  try {
    // Cheap self-rotation: one generation, no dependency, no scheduler.
    const size = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    if (size > MAX_BYTES) fs.renameSync(logFile, `${logFile}.1`);
    fs.appendFileSync(logFile, line + "\n");
  } catch {
    /* logging must never break the app */
  }
}

module.exports = { init, write, getLogPath, getLogDir };
