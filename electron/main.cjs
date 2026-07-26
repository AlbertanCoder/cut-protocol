// Cut Protocol — Electron main process.
//
// This boots the existing Express backend (backend/server.js) in-process
// and points a single BrowserWindow at it. backend/server.js already serves
// frontend/dist as static files same-origin and falls back to index.html
// for client-side routing, and the frontend's api.js already calls relative
// `/api/*` paths — so there is no need to run a separate frontend dev
// server or worry about CORS. Electron's only job is: set a couple of env
// vars, require the backend so it starts listening, wait until it actually
// answers HTTP requests, then load that URL into a window.
//
// CommonJS (.cjs) is used deliberately: backend/server.js is CommonJS
// (`require`-based, backend/package.json has no "type": "module"), so
// requiring it directly from an ESM file would need interop workarounds.
// Using .cjs here sidesteps that entirely.

const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const util = require("util");
const crypto = require("crypto");
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");

const log = require("./logger.cjs");
const updater = require("./updater.cjs");
const license = require("./license.cjs");

// Bug reporter: hand a pre-filled GitHub issue URL to the OS browser. Only
// http/https is ever opened (never a file:// or app-internal scheme).
ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// electron-builder's `build.productName` only brands the installer/.exe —
// it is never written into the packaged app's package.json (which keeps
// just name/version/private/description/main; verified by extracting
// app.asar). Electron's own app.getName() therefore falls back to the npm
// package name ("cut-protocol-desktop"), which would make
// app.getPath("userData") resolve to "%AppData%\cut-protocol-desktop"
// instead of the intended "%AppData%\Cut Protocol" that
// desktopBootstrap.js's getTemplateDbPath() docstring and this file's own
// dbPath comment below assume. Set the display name explicitly, before any
// app.getPath() call, so the on-disk folder matches the product branding.
app.setName("Cut Protocol");

// Diagnostics file, opened as early as possible (right after setName, so
// userData already resolves to "%AppData%\Cut Protocol"). Everything after
// this point that can fail on someone else's machine writes a line here, and
// the boot-failure screen shows the path so the user can send it.
log.init(app);
log.write("main", `boot - version ${app.getVersion()}, packaged=${app.isPackaged}, ${process.platform}/${process.arch}`);

// ── console → log file bridge ───────────────────────────────────────────────
//
// THE PROBLEM: a packaged Windows GUI app has no stdout. Nothing is attached to
// it, nothing captures it, and there is no console window to read. Every
// console.* call in backend/server.js and everything it requires therefore
// writes into the void once the app is installed — including the 500-logging
// middleware (`[error] POST /api/x: <message>`), the listen-error branch, the
// desktopBootstrap schema failure, and the whole [data-audit] boot report. The
// only errors a shipped copy could ever surface were the handful this file
// happened to route through log.write() itself.
//
// Fixing it HERE rather than in backend/server.js is deliberate: the backend is
// required in-process (see bootBackend below), so patching the shared console
// object before that require captures every console call in the process — the
// backend's, its dependencies', and Electron's own — with no edit to any
// backend file and no import of an Electron-only logger into code that also
// runs under plain `node server.js`.
//
// The one hazard is recursion: logger.cjs mirrors every line it writes to
// console.log, which is the function being replaced. Its output has a fixed
// shape (`<ISO timestamp> [scope] message`), so a line in that shape is
// recognised as the logger's own mirror and passed straight to the real
// console — printed once, never re-logged.
const LOGGER_MIRROR_LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[[^\]]+\] /;
const MAX_CONSOLE_LINE = 4000;

function bridgeConsoleToLog() {
  for (const level of ["log", "info", "warn", "error"]) {
    const native = console[level].bind(console);
    console[level] = (...args) => {
      if (args.length === 1 && typeof args[0] === "string" && LOGGER_MIRROR_LINE.test(args[0])) {
        native(args[0]); // logger.cjs's own stdout mirror — already on disk
        return;
      }
      let line;
      try {
        line = util.format(...args);
      } catch {
        line = String(args[0]);
      }
      if (line.length > MAX_CONSOLE_LINE) line = `${line.slice(0, MAX_CONSOLE_LINE)} …[truncated]`;
      // log.write() mirrors to the real console itself (via the branch above),
      // so this both prints and persists — exactly one line of each.
      log.write(level === "log" || level === "info" ? "console" : `console:${level}`, line);
    };
  }
}

bridgeConsoleToLog();

// backend/.env is deliberately excluded from electron-builder's `files`
// whitelist (it holds JWT_SECRET plus the USDA/Anthropic API keys — not
// something to leave sitting in plain form in the general packaging list).
// But that means a packaged app has literally no .env on disk: backend/
// server.js's `require("dotenv/config")` resolves relative to process.cwd()
// and finds nothing, so JWT_SECRET etc. are all undefined and every login
// attempt throws ("Missing JWT_SECRET env var") — auth is completely broken
// in a packaged build without this. This is a personal, single-user desktop
// build that never leaves this machine, so package.json's `extraResources`
// intentionally ships the real `backend/.env` (not a placeholder) as
// "backend.env.template"; this loads whatever's in that shipped file at
// startup, using the same non-destructive semantics as dotenv itself (never
// clobber a var the environment already set).
// M4 FIX (Doc 2): a distributed build ships NO secrets. Each install generates
// its OWN JWT/session secret on first run and persists it in the writable
// userData dir — never bundled, never in git. API keys (Anthropic/USDA) are
// simply absent in a shared build: the brain gate stays off and the app degrades
// gracefully (deterministic solver + everything else works fully offline). In
// dev (not packaged) nothing changes — backend/.env supplies these as before.

/**
 * Plain-English cause for the filesystem errno codes that actually reach a
 * desktop app on someone else's machine. Nothing in this tree handled any of
 * them before — `e.message` for EROFS reads "EROFS: read-only file system,
 * open '...'", which tells a user nothing they can act on.
 */
function ioReason(e) {
  switch (e && e.code) {
    case "EACCES":
    case "EPERM":
      return "Windows refused permission to write there — antivirus, a locked-down profile, or a folder owned by another account.";
    case "EROFS":
      return "That location is read-only.";
    case "ENOSPC":
      return "The disk is full.";
    case "EBUSY":
      return "Another program is holding that file open.";
    case "EMFILE":
    case "ENFILE":
      return "The system ran out of open file handles.";
    case "ENOENT":
      return "That folder does not exist and could not be created.";
    default:
      return (e && e.message) || String(e);
  }
}

// Set when the per-install session secret cannot be persisted. THIS IS FATAL
// NOW, and it was not before.
//
// The old code console.error'd and carried on. Two things followed. First, the
// message went to a stdout a packaged Windows GUI app does not have, so nobody
// ever saw it. Second — and this is the actual damage — carrying on means
// generating a FRESH random JWT_SECRET on every launch, which invalidates every
// cookie the previous launch issued. The user is silently signed out every
// single time they open the app, forever, with no error anywhere and nothing to
// suggest a cause. A permanent broken state presented as normal behaviour is
// worse than a refusal to start, so this now lands on the boot-failure screen
// that already exists, naming the path and the cause.
let secretFailure = null;

function ensurePackagedSecrets() {
  if (!app.isPackaged) return; // dev: backend/.env owns JWT_SECRET/keys
  if (process.env.JWT_SECRET) return; // respect an explicitly-provided secret
  const secretPath = path.join(app.getPath("userData"), "session-secret");
  let secret;
  try { secret = fs.readFileSync(secretPath, "utf8").trim(); } catch { /* first run */ }
  if (!secret) {
    secret = crypto.randomBytes(48).toString("hex");
    try {
      fs.mkdirSync(path.dirname(secretPath), { recursive: true });
      fs.writeFileSync(secretPath, secret, { mode: 0o600 });
      // Prove it actually landed. A write that "succeeds" into a virtualised or
      // sync-managed folder and reads back as something else fails in exactly
      // the same way as not writing at all — new secret every launch, signed
      // out every launch — so it has to be caught here, not assumed.
      if (fs.readFileSync(secretPath, "utf8").trim() !== secret) {
        throw Object.assign(new Error("the file did not read back as written"), { code: "EIO" });
      }
    } catch (e) {
      secretFailure = { path: secretPath, reason: ioReason(e), code: (e && e.code) || "" };
      log.write("main", `FATAL: could not persist the session secret at ${secretPath}: ${(e && e.code) || ""} ${(e && e.message) || e}`);
      return; // JWT_SECRET deliberately left unset — boot() refuses to continue
    }
  }
  process.env.JWT_SECRET = secret;
}

ensurePackagedSecrets();

// ── userData health (disk/IO edge cases) ────────────────────────────────────
//
// Everything writable this app owns lives under one directory: the SQLite
// database, the session secret, and the log. If it is not writable, or if a
// sync client owns it, every one of those is compromised — so it is probed
// once, up front, instead of failing later as three unrelated mysteries.
function inspectUserData() {
  const dir = app.getPath("userData");
  const notes = { dir, writable: true, reason: null, code: "", synced: false };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
  } catch (e) {
    notes.writable = false;
    notes.reason = ioReason(e);
    notes.code = (e && e.code) || "";
  }
  // %AppData%\Roaming is OneDrive-redirectable ("Known Folder Move") and IS
  // redirected on some machines. SQLite on a synced path is a documented
  // corruption vector: the database and its -wal/-shm sidecars are three files
  // a sync client can upload, restore, or lock out of step with each other,
  // and the app has no way to notice it happened. Detect and say so.
  notes.synced = /[\\/](OneDrive[^\\/]*|Dropbox|Google ?Drive|iCloudDrive)([\\/]|$)/i.test(dir);
  return notes;
}

const userData = inspectUserData();
log.write("main", `userData ${userData.dir} — writable=${userData.writable}${userData.writable ? "" : ` (${userData.code} ${userData.reason})`}${userData.synced ? " — WARNING: this path is managed by a file-sync client" : ""}`);

// Stage-C fix (M3): single-instance lock. Without it, double-launching the
// installed app started a SECOND in-process backend that raced for port 3001;
// the loser threw an uncaught EADDRINUSE dialog and then rode the first
// instance's server (or, if a foreign process held 3001, silently read the
// wrong database). Acquire the lock BEFORE requiring the backend so the second
// instance never binds the port — it just focuses the existing window and quits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ---------------------------------------------------------------------------
// 1. Resolve env vars BEFORE requiring the backend. backend/server.js's very
//    first line is `require("dotenv/config")`, and dotenv does NOT overwrite
//    keys already present in process.env — so anything we set here wins over
//    backend/.env, and anything we DON'T set here falls through to
//    backend/.env unchanged.
// ---------------------------------------------------------------------------

// ── Port selection (resilience-errors-2) ────────────────────────────────────
//
// The old code did `process.env.PORT ||= "3001"` and then loaded
// http://localhost:3001/ unconditionally. Two bad things followed from that
// when something else already held 3001:
//   1. the in-process backend's app.listen() threw an uncaught EADDRINUSE and
//      Electron put a stack trace in the user's face, and
//   2. — far worse — the shell then loaded whatever WAS on 3001. Another
//      Node dev server, a random Electron app, or a hostile local process
//      would have been rendered as if it were Cut Protocol, and the renderer
//      would have posted this user's email, password and food data into it.
//
// Fix: probe for a genuinely free loopback port before the backend is even
// required, prefer 3001 so the common case is unchanged, and prove identity
// after the fact with a per-launch nonce (see verifyOwnBackend below). The
// probe alone is not enough — between probing and binding, someone else can
// take the port — so the nonce is the actual safety property, not the probe.
const PREFERRED_PORT = Number(process.env.PORT) || 3001;
const PORT_PROBE_LIMIT = 20; // 3001..3020, then give up and let :0 assign one

/** Resolve true if nothing is listening on 127.0.0.1:port right now. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/** Ask the OS for any free loopback port (bind :0, read it back, release). */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function choosePort() {
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + PORT_PROBE_LIMIT; p += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p)) {
      if (p !== PREFERRED_PORT) {
        log.write("main", `port ${PREFERRED_PORT} is taken by another process - using ${p} instead`);
      }
      return p;
    }
  }
  const p = await ephemeralPort();
  log.write("main", `ports ${PREFERRED_PORT}-${PREFERRED_PORT + PORT_PROBE_LIMIT - 1} all taken - OS assigned ${p}`);
  return p;
}

// Per-launch shared secret. The backend echoes it from /api/meta/whoami; a
// foreign service on the same port cannot. Random per launch, never written
// to disk, never sent anywhere but our own loopback socket.
const LAUNCH_NONCE = crypto.randomBytes(24).toString("hex");
process.env.CUT_PROTOCOL_NONCE = LAUNCH_NONCE;

// Loopback only. The backend defaults to this too, but being explicit HERE —
// before the backend module is required, and therefore before its
// `require("dotenv/config")` runs — is what makes it unconditional: dotenv
// never overwrites a var that already exists, so even a shipped backend/.env
// carrying `HOST=0.0.0.0` cannot put this user's food and auth API on the LAN.
// (Raised as a residual risk in docs/qc/handoff/agent05.md §1; this closes it
// for the desktop path. The container deploy path never goes through Electron
// and still honours its own HOST.)
process.env.HOST = "127.0.0.1";

let PORT = String(PREFERRED_PORT); // real value assigned in bootBackend()

// Contract with the backend-adaptation agent: when packaged, we point the
// Prisma SQLite DB at a writable per-user location (the app install
// directory under Program Files is not writable, and must never hold user
// data anyway). We hand the backend both:
//   - DATABASE_URL, in Prisma's own "file:<path>" connection-string form
//     (what backend/server.js's `require("dotenv/config")` chain expects),
//   - CUT_PROTOCOL_DB_PATH, the same path as a plain filesystem path with NO
//     "file:" prefix, so backend code can fs.existsSync()/fs.copyFileSync()
//     it directly when deciding whether to seed a fresh DB from a bundled
//     template on first run.
// Exact env var name "CUT_PROTOCOL_DB_PATH" is the agreed contract — the
// backend agent's first-run-template-copy logic depends on this exact name.
//
// In dev (not packaged), we deliberately do NOT touch DATABASE_URL — we
// leave it undefined here so backend/.env's own DATABASE_URL="file:./dev.db"
// keeps working exactly as it does today when running the backend standalone.
if (app.isPackaged) {
  const dbPath = path.join(app.getPath("userData"), "cutprotocol.db");
  // Prisma's SQLite connection strings are happiest with forward slashes even
  // on Windows; normalize so "file:C:\Users\...\cutprotocol.db" doesn't trip
  // up URL-style parsing.
  const dbPathForUrl = dbPath.replace(/\\/g, "/");
  process.env.DATABASE_URL = `file:${dbPathForUrl}`;
  process.env.CUT_PROTOCOL_DB_PATH = dbPath;
}

// The writable directory the backend may keep runtime config in — currently
// just brain.json (relay URL + device token for the coach). Set in BOTH dev and
// packaged, unlike DATABASE_URL above: brain.json is written by the user at
// runtime rather than supplied by backend/.env, so there is nothing for it to
// conflict with, and having it work identically in dev is what makes the
// Settings screen testable without building an installer.
//
// It is the same directory that already holds session-secret and
// cutprotocol.db. That is the point: it is writable, per-user, outside the
// install tree, and — critically — NOT part of the installer payload, so a
// device token can never end up inside a shared build.
process.env.CUT_PROTOCOL_USERDATA = app.getPath("userData");

// ---------------------------------------------------------------------------
// 2. Boot the backend in-process. Requiring this module runs it top-to-
//    bottom exactly like `node server.js` would, which as a side effect
//    calls app.listen(PORT, HOST, ...) near the bottom of the file. We
//    intentionally keep this in-process (no child_process/spawn) — simplest
//    possible lifecycle, and it dies naturally when the Electron main process
//    exits.
//
//    This is now async and deferred, because the port has to be CHOSEN first
//    (see choosePort above) and written into process.env.PORT before the
//    backend module is evaluated.
// ---------------------------------------------------------------------------
let backend = null;

async function bootBackend() {
  // require() is cached: a second call would return the same module WITHOUT
  // binding a second listener, so re-running boot() (the retry path) must not
  // re-pick a port and must not re-require. Reuse what is already listening.
  if (backend) {
    log.write("main", `reusing the backend already listening on port ${PORT}`);
    return backend;
  }
  const port = await choosePort();
  PORT = String(port);
  process.env.PORT = PORT;
  log.write("main", `backend port ${PORT} (loopback only)`);
  backend = require("../backend/server.js");
  return backend;
}

// ---------------------------------------------------------------------------
// 3. Window management.
// ---------------------------------------------------------------------------

let mainWindow = null;

// Boot state the splash page reads (and re-reads on load, so there is no race
// between "main sends" and "splash is ready"). Never contains user data.
//
// PHASES: starting → ready (the app URL loaded) · failed · blocked.
// "ready" is new. Without it the phase stayed "starting" for the entire life of
// the process, which made every guard written as `if (phase === "starting")`
// permanently true — see the uncaughtException handler at the bottom of this
// file for what that cost.
let bootState = { phase: "starting", message: "Starting up…" };

// True while the window is showing splash.html rather than the app itself.
// Tracked because it decides HOW a failure can be shown: pushing IPC at the app
// page is useless if the app page is the thing that broke.
let onSplash = true;
// The verified app origin, once the handshake has passed. Used by the reload
// path so a retry doesn't have to redo port selection or re-require the backend.
let appBaseUrl = null;

function splashPath() {
  return path.join(__dirname, "splash.html");
}

function setBootState(next) {
  bootState = { ...bootState, ...next };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const failing = bootState.phase === "failed" || bootState.phase === "blocked";
  if (failing && !onSplash) {
    // A failure AFTER the app loaded cannot be delivered by IPC to a page that
    // may itself be broken (and, until this change, was delivered to a channel
    // with no subscriber at all). Put the splash back instead — it PULLS the
    // current state on load via getBootState(), so nothing can be missed.
    onSplash = true;
    mainWindow.loadFile(splashPath()).catch((e) => log.write("main", `could not show the failure screen: ${e.message}`));
    return;
  }
  mainWindow.webContents.send("boot-state", bootState);
}

// ── runtime faults (everything after phase === "ready") ─────────────────────
//
// A boot failure and a fault three hours in are different problems with
// different exits, and the old code had only the first. These are the second.
let lastFaultAt = 0;
let recoveryDialogOpen = false;
let rendererAutoRecovered = false;

const FAULT_TITLE = {
  "uncaught exception": "Cut Protocol hit an unexpected error",
  "unhandled rejection": "Something the app started never finished",
  "renderer gone": "Cut Protocol's window crashed",
  unresponsive: "Cut Protocol has stopped responding",
  "page load failed": "Cut Protocol couldn't display its window",
};

/**
 * Reload the window without restarting the local engine. This is the recovery
 * for a wedged/crashed renderer; the backend keeps running in this same
 * process, so its data and its port are untouched.
 */
function reloadApp() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    boot();
    return;
  }
  if (appBaseUrl) {
    log.write("main", `reloading ${appBaseUrl}`);
    mainWindow
      .loadURL(appBaseUrl)
      .then(() => {
        onSplash = false;
        // Back to a working app: clear whatever failure state got us here, so
        // the next fault is judged on its own merits.
        setBootState({ phase: "ready", message: "", title: null, detail: null });
        log.write("main", "window reloaded (phase=ready)");
      })
      .catch((e) => {
        log.write("main", `reload failed: ${e.message}`);
        setBootState({
          phase: "failed",
          title: "Cut Protocol couldn't reload its window",
          message: e.message,
          detail: "The local engine is still running and your data is untouched. Try again, or close and reopen Cut Protocol.",
          logPath: log.getLogPath(),
        });
      });
    return;
  }
  boot(); // never got as far as a verified origin — run the whole sequence again
}

async function promptRecovery(kind, err, { offerWait = false } = {}) {
  if (recoveryDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  recoveryDialogOpen = true;
  const buttons = offerWait
    ? ["Keep waiting", "Reload the window", "Open log folder", "Close Cut Protocol"]
    : ["Reload the window", "Open log folder", "Close Cut Protocol"];
  try {
    const res = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Cut Protocol",
      message: FAULT_TITLE[kind] || "Cut Protocol hit an unexpected error",
      detail:
        `${(err && err.message) || String(err || "")}\n\n` +
        "Your data is on disk and was not changed. Reloading redraws the window — it does not restart the local engine, and it does not sign you out.\n\n" +
        `Log: ${log.getLogPath() || "(not available)"}`,
      buttons,
      defaultId: offerWait ? 1 : 0,
      cancelId: 0,
      noLink: true,
    });
    const choice = buttons[res.response];
    log.write("main", `recovery dialog (${kind}): user chose "${choice}"`);
    if (choice === "Reload the window") reloadApp();
    else if (choice === "Open log folder") { const d = log.getLogDir(); if (d) shell.openPath(d); }
    else if (choice === "Close Cut Protocol") app.quit();
  } catch (e) {
    log.write("main", `recovery dialog failed to open: ${e.message}`);
  } finally {
    recoveryDialogOpen = false;
  }
}

/**
 * The post-boot equivalent of the boot-failure screen.
 *
 * @param {string} kind          one of FAULT_TITLE's keys
 * @param {Error|*} err
 * @param {object} opts
 *   nativePrompt  "always"   the OS dialog is the only thing that can be seen
 *                 "fallback" only if the renderer could not be told
 *                 false      log + renderer only
 *   offerWait     add a "Keep waiting" button (unresponsive only)
 */
function reportRuntimeFault(kind, err, { nativePrompt = false, offerWait = false } = {}) {
  log.write("main", `${kind}: ${(err && err.stack) || (err && err.message) || String(err)}`);
  const now = Date.now();
  const burst = now - lastFaultAt < 2000; // one storm, one report
  lastFaultAt = now;

  // Tell the renderer. This lands in the SAME "Something went wrong" report
  // dialog the app already opens for its own uncaught errors (bugLog.js
  // subscribes and calls the handler App registers), so a main-process fault is
  // finally reportable by the user instead of vanishing. That subscriber is the
  // whole point: the old code pushed "boot-state" here, and nothing in
  // frontend/src listened to "boot-state" at all.
  let notified = false;
  if (!onSplash && mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (!burst) {
        mainWindow.webContents.send("main-process-error", {
          kind,
          message: (err && err.message) || String(err),
        });
      }
      notified = true; // a live renderer, whether or not this one was debounced
    } catch { /* renderer already gone — the native prompt below covers it */ }
  }
  if (burst) return;
  // An OS-level modal on top of a report dialog the renderer is already showing
  // is two interruptions for one fault. Only prompt natively when the renderer
  // cannot speak for itself, or when the window itself is the thing that broke.
  if (nativePrompt === "always" || (nativePrompt === "fallback" && !notified)) {
    promptRecovery(kind, err, { offerWait });
  }
}

ipcMain.handle("boot-state", () => bootState);
ipcMain.handle("open-log-folder", () => {
  const dir = log.getLogDir();
  if (dir) shell.openPath(dir);
  return dir;
});
// Splash's "Try again" button. Safe to call repeatedly: boot() is guarded and
// bootBackend() reuses the listener it already started.
ipcMain.handle("retry-boot", () => {
  log.write("main", "retry requested from the failure screen");
  if (appBaseUrl) reloadApp(); else boot();
  return true;
});
// The diagnostic log, for attaching to a bug report. Tail only, capped, and
// handed to the renderer for scrubbing + explicit user review before it can go
// anywhere (frontend/src/lib/bugReport.js). Without this the user had to find
// %AppData%\Cut Protocol\logs themselves and email it.
ipcMain.handle("read-log-tail", (_e, maxBytes) => {
  const file = log.getLogPath();
  if (!file) return { path: null, text: "", truncated: false };
  const cap = Math.min(Math.max(Number(maxBytes) || 16 * 1024, 1024), 128 * 1024);
  try {
    const { size } = fs.statSync(file);
    const start = Math.max(0, size - cap);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop the half line
      return { path: file, text, truncated: start > 0 };
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    // A log we cannot read must not break the reporter that wanted it.
    return { path: file, text: "", truncated: false, error: ioReason(e) };
  }
});
ipcMain.handle("check-for-updates", () => updater.checkForUpdates({ app, dialog, BrowserWindow }, { manual: true }));
ipcMain.handle("updater-state", () => updater.getState());
// The renderer is served BY the backend, so it talks to its own origin with
// relative /api paths and never needs a hard-coded port. This is exposed only
// so the UI can display/diagnose the real port; the nonce is deliberately NOT
// exposed — identity is proven in the main process, before anything loads.
ipcMain.handle("backend-info", () => ({
  port: Number(PORT),
  host: "127.0.0.1",
  logPath: log.getLogPath(),
  // Environment facts a bug report should carry and a user can't be expected
  // to know. No user data — a directory path and two booleans.
  userDataDir: userData.dir,
  userDataWritable: userData.writable,
  userDataSynced: userData.synced,
}));

/**
 * Fetch a loopback URL and return { status, body } — small, no dependency.
 */
function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

/**
 * Poll a URL with plain HTTP GETs until it responds (any response at all —
 * we don't care about the status code, just that Express is up and
 * accepting connections) or the timeout elapses.
 */
function waitForServer(url, { timeoutMs = 10000, intervalMs = 150 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume(); // drain the response so the socket can close cleanly
        resolve();
      });

      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(`Backend did not respond at ${url} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, intervalMs);
      });

      // Guard against a hung connection eating the whole timeout budget.
      req.setTimeout(intervalMs, () => req.destroy());
    };

    attempt();
  });
}

/**
 * THE HANDSHAKE (resilience-errors-2).
 *
 * Ask the origin we are about to load "who are you?" and require it to echo
 * this launch's nonce. Only our own backend process — which received the
 * nonce through its own environment — can. Anything else on that port fails
 * here and we refuse to load it, rather than handing it a login form.
 *
 * Two origins are tried in order because `localhost` and `127.0.0.1` are
 * different origins to Chromium (cookies included). We prefer `localhost` so
 * an existing logged-in session survives this change, and fall back to the
 * literal loopback address if name resolution sends `localhost` somewhere
 * else (e.g. ::1, where our 127.0.0.1-bound server is not listening).
 *
 * @returns {Promise<string|null>} the verified base URL, or null
 */
async function verifyOwnBackend(port) {
  const candidates = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  let sawForeign = false;
  for (const base of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { body } = await getJson(`${base}/api/meta/whoami`);
      if (body && body.app === "cut-protocol" && body.nonce && body.nonce === LAUNCH_NONCE) {
        log.write("main", `handshake OK on ${base} (pid ${body.pid})`);
        return base;
      }
      sawForeign = true;
      log.write("main", `handshake REJECTED on ${base}: something else is answering there`);
    } catch (e) {
      log.write("main", `handshake could not reach ${base}: ${e.message}`);
    }
  }
  if (sawForeign) {
    const err = new Error(
      `Another program is answering on port ${port}. Cut Protocol refused to talk to it — ` +
      "your data was not sent anywhere. Close whatever else is using that port, or just restart Cut Protocol."
    );
    err.foreign = true;
    throw err;
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    resizable: true,
    title: "Cut Protocol",
    icon: path.join(__dirname, "..", "CutProtocol.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // This is a real app, not a browser — no menu bar.
  Menu.setApplicationMenu(null);

  // frontend/index.html's own <title> is the lowercase Vite scaffold default
  // ("cut-protocol"), which would otherwise clobber the "Cut Protocol"
  // window title above the moment the real app finishes loading. This is a
  // desktop shell, not a browser tab — the window chrome's title is ours to
  // control, independent of whatever the served page's <title> says.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // Show a minimal loading state immediately while we wait for Express to
  // come up, instead of a blank/frozen window.
  onSplash = true;
  mainWindow.loadFile(splashPath());

  const wc = mainWindow.webContents;

  // Menu.setApplicationMenu(null) above removes the entire default accelerator
  // table with it — including Ctrl+R and F5. So a renderer that wedged had
  // exactly one exit: Task Manager. Put reload back, scoped to this window's
  // input. Deliberately NOT globalShortcut, which would steal Ctrl+R from every
  // other application on the machine for as long as this one is running.
  wc.on("before-input-event", (event, input) => {
    if (!input || input.type !== "keyDown") return;
    const key = String(input.key || "").toLowerCase();
    const reload = ((input.control || input.meta) && key === "r") || key === "f5";
    if (!reload) return;
    event.preventDefault();
    log.write("main", "reload requested from the keyboard");
    reloadApp();
  });

  // The main frame failed to load. Until now this was silent: the window sat on
  // whatever it had (often nothing) with no message and no way back.
  wc.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return; // ERR_ABORTED — a superseded navigation, not a failure
    log.write("main", `page failed to load: ${code} ${desc} (${url})`);
    if (bootState.phase === "ready") {
      setBootState({
        phase: "failed",
        title: "Cut Protocol couldn't display its window",
        message: `${desc || "The page failed to load"} (${code}).`,
        detail: "The local engine is still running and your data is untouched. Press Try again below, or Ctrl+R, to reload the window.",
        logPath: log.getLogPath(),
      });
    }
  });

  // The renderer process died (out of memory, a GPU fault, a crash).
  wc.on("render-process-gone", (_e, details) => {
    const reason = (details && details.reason) || "unknown";
    log.write("main", `renderer gone: ${reason} (exit ${details && details.exitCode})`);
    if (reason === "clean-exit") return;
    if (!rendererAutoRecovered) {
      // One silent recovery. More than one would hide a reproducible crash
      // behind a flicker, which is how a broken build looks "fine".
      rendererAutoRecovered = true;
      log.write("main", "recovering the window once, automatically");
      reloadApp();
      return;
    }
    reportRuntimeFault("renderer gone", new Error(`The window crashed (${reason}) and reloading did not fix it.`), { nativePrompt: "always" });
  });

  // The renderer stopped pumping its event loop. It may recover; it may not.
  wc.on("unresponsive", () => {
    reportRuntimeFault("unresponsive", new Error("The window stopped responding to input."), { nativePrompt: "always", offerWait: true });
  });
  wc.on("responsive", () => log.write("main", "the window started responding again"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * The whole boot sequence, in one place, with an honest failure at every step.
 *
 * resilience-errors-5: the old version's failure path was a `data:text/html`
 * page with a raw exception string on it. An outside user got a white page
 * saying "Backend did not respond at http://localhost:3001/ within 10000ms"
 * and had nothing to do next and nothing to send anyone. Every branch below
 * ends in splash.html's failure state instead: what happened, what it means,
 * what to try, and the log path — with a button that opens the log folder.
 */
let booting = false;
let listenErrorWired = false;

async function boot() {
  if (booting) return; // the retry path can call this again; one at a time
  booting = true;
  try {
    await bootSequence();
  } finally {
    booting = false;
  }
}

async function bootSequence() {
  // 0. Can we write where we keep everything? The database, the session secret
  //    and the log all live in one directory; if it is not writable, all three
  //    fail, and failing here with the reason beats three separate mysteries
  //    later (a login that won't stick, a database that won't open, a log that
  //    doesn't exist).
  if (!userData.writable) {
    setBootState({
      phase: "failed",
      title: "Cut Protocol can't write to its own data folder",
      message: `${userData.reason} (${userData.code})`,
      detail: `Folder:\n${userData.dir}\n\nThis is where your database, your sign-in and this app's log live — it can't run without being able to write there. Check that the folder exists, that you have permission to write to it, and that the disk isn't full.`,
      logPath: log.getLogPath(),
    });
    return;
  }

  // 0b. The session secret. Fatal now — see ensurePackagedSecrets().
  if (secretFailure) {
    setBootState({
      phase: "failed",
      title: "Cut Protocol couldn't save your sign-in key",
      message: `${secretFailure.reason}${secretFailure.code ? ` (${secretFailure.code})` : ""}`,
      detail:
        `File:\n${secretFailure.path}\n\n` +
        "Without it the app would sign you out every single time you open it, silently and forever, so it stops here instead. " +
        "Free up disk space or fix the folder's permissions and reopen Cut Protocol — your data is untouched.",
      logPath: log.getLogPath(),
    });
    return;
  }

  // 1. Entitlement gate (inert until a public key is configured; always
  //    bypassed in dev). Runs before anything expensive so a blocked build
  //    never even opens a database.
  const lic = license.check(app);
  if (!lic.ok) {
    setBootState({
      phase: "blocked",
      title: "This copy isn't activated yet",
      message: lic.reason || "No valid license key was found.",
      detail: `Drop your license.key file here and reopen Cut Protocol:\n${lic.path}`,
      logPath: log.getLogPath(),
    });
    return;
  }

  // 2. Pick a port and start the backend.
  setBootState({ phase: "starting", message: "Starting the local engine…" });
  try {
    await bootBackend();
  } catch (e) {
    log.write("main", `backend failed to load: ${e.message}`);
    setBootState({
      phase: "failed",
      title: "Cut Protocol couldn't start its local engine",
      message: e.message,
      detail: "This is a fault in the app, not in your data — nothing was changed. Restarting usually clears it; if it doesn't, send the log below.",
      logPath: log.getLogPath(),
    });
    return;
  }

  // A bind error arrives asynchronously on the server object. Surface it as a
  // real screen rather than an uncaught main-process exception. Attached once:
  // bootSequence() is re-runnable now (the retry path), and a fresh listener on
  // every attempt would leak and multi-report the same failure.
  if (backend && backend.server && !listenErrorWired) {
    listenErrorWired = true;
    backend.server.on("error", (err) => {
      log.write("main", `backend listen error: ${err.code || ""} ${err.message}`);
      setBootState({
        phase: "failed",
        title: "Cut Protocol couldn't open its local port",
        message: err.code === "EADDRINUSE"
          ? `Port ${PORT} was taken between checking it and using it.`
          : err.message,
        detail: "Close any other copy of Cut Protocol and reopen it.",
        logPath: log.getLogPath(),
      });
    });
  }

  // 3. Wait for it to answer, then PROVE it is ours before loading anything.
  const probeUrl = `http://127.0.0.1:${PORT}/`;
  try {
    await waitForServer(probeUrl);
  } catch (e) {
    log.write("main", e.message);
    setBootState({
      phase: "failed",
      title: "Couldn't reach the local server",
      message: `The app's own engine didn't answer on port ${PORT}.`,
      detail: "Your data is untouched. Close Cut Protocol completely (check the taskbar for a second copy) and open it again. If it keeps happening, the log below has the details.",
      logPath: log.getLogPath(),
    });
    return;
  }

  let base;
  try {
    base = await verifyOwnBackend(PORT);
  } catch (e) {
    log.write("main", `REFUSED to load a foreign service on port ${PORT}`);
    setBootState({
      phase: "failed",
      title: "Something else is using Cut Protocol's port",
      message: e.message,
      detail: "Cut Protocol will not load a page it can't verify — that is what stops another program from collecting your login.",
      logPath: log.getLogPath(),
    });
    return;
  }
  if (!base) {
    setBootState({
      phase: "failed",
      title: "Couldn't reach the local server",
      message: `Nothing answered the identity check on port ${PORT}.`,
      detail: "Close Cut Protocol completely and open it again. The log below has the details.",
      logPath: log.getLogPath(),
    });
    return;
  }

  log.write("main", `loading ${base}/ (license: ${lic.state})`);
  appBaseUrl = `${base}/`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    let loadFailure = null;
    try {
      await mainWindow.loadURL(appBaseUrl);
    } catch (e) {
      // ERR_ABORTED means this navigation was SUPERSEDED by another one, not
      // that it failed — treating it as a failure would put a crash screen over
      // a page that is about to load fine.
      if (String(e && e.code) === "ERR_ABORTED" || (e && e.errno === -3)) {
        log.write("main", `loadURL superseded (${e.message}) — letting the newer navigation finish`);
      } else {
        loadFailure = e;
      }
    }
    if (loadFailure) {
      // The window never left the splash document, so the failure screen can
      // still be shown there.
      log.write("main", `could not load ${appBaseUrl}: ${loadFailure.message}`);
      setBootState({
        phase: "failed",
        title: "Cut Protocol couldn't open its own window",
        message: loadFailure.message,
        detail: "The local engine started and answered — it was displaying the page that failed. Press Try again below; if it keeps failing, send the log.",
        logPath: log.getLogPath(),
      });
      return;
    }
    onSplash = false;
    // ── THE SUCCESS TRANSITION ──────────────────────────────────────────────
    // Everything from here on is a RUNTIME fault, not a boot failure, and takes
    // reportRuntimeFault() instead of the splash screen. Without this line the
    // phase stayed "starting" for the life of the process, so the
    // uncaughtException guard below stayed armed forever and turned an error at
    // hour three into a boot-failure message pushed at a channel nobody read.
    setBootState({ phase: "ready", message: "", title: null, detail: null });
    log.write("main", "window is up (phase=ready)");
  }

  // 3b. Sync-managed data folder. Not fatal — the app works — but SQLite plus a
  //     file-sync client is a real corruption vector and the user is the only
  //     one who can move it. Said once per install, never nagged.
  if (app.isPackaged && userData.synced) warnAboutSyncedDataFolder();

  // 4. Updates last, and only after the window is already usable. Fully
  //    fire-and-forget: offline machines log one line and carry on.
  updater.scheduleLaunchCheck({ app, dialog, BrowserWindow });
}

/**
 * One-time warning that userData sits inside OneDrive/Dropbox/etc. Gated on a
 * marker file so it appears once per install, not once per launch — a warning
 * shown every time is a warning nobody reads (and this app's own rules forbid
 * nagging).
 */
function warnAboutSyncedDataFolder() {
  const marker = path.join(userData.dir, ".sync-warning-shown");
  try { if (fs.existsSync(marker)) return; } catch { /* fall through and warn */ }
  try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* warn anyway */ }
  log.write("main", `WARNING: ${userData.dir} is inside a synced folder — SQLite on a synced path can be corrupted by the sync client`);
  dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Cut Protocol",
    message: "Your Cut Protocol data folder is being synced to the cloud",
    detail:
      `${userData.dir}\n\n` +
      "This folder is managed by a file-sync client (OneDrive, Dropbox or similar). Cut Protocol keeps your data in a database file there, and sync clients can copy, lock or restore that file while the app is using it — which can damage it.\n\n" +
      "Nothing is wrong right now. But if you can, exclude this folder from syncing. Keep your own exports (Profile → export) either way.",
    buttons: ["OK"],
    noLink: true,
  }).catch(() => {});
}

app.whenReady().then(() => {
  createWindow();
  boot();

  app.on("activate", () => {
    // macOS convention (re-create a window when the dock icon is clicked
    // and there are none open). Harmless to include even though this is a
    // Windows-only target.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Last-resort net: an unexpected main-process throw used to be a raw Electron
// error dialog. Log it and, if we never got as far as loading the app, show
// the honest failure screen instead — otherwise take the runtime path, which
// now exists.
process.on("uncaughtException", (err) => {
  if (bootState.phase === "starting") {
    log.write("main", `uncaught during boot: ${err && err.stack ? err.stack : err}`);
    setBootState({
      phase: "failed",
      title: "Cut Protocol hit an unexpected error while starting",
      message: (err && err.message) || String(err),
      detail: "Your data was not modified. Reopen the app; if it fails again, send the log below.",
      logPath: log.getLogPath(),
    });
    return;
  }
  // Post-boot. The window is up and the user is mid-something; a boot screen
  // would be a lie and (before this) went nowhere anyway. Log it, tell the
  // renderer so it can offer a report, and — because a throw that reached here
  // may well have left the backend mid-request — offer the recovery dialog.
  reportRuntimeFault("uncaught exception", err, { nativePrompt: "fallback" });
});

// ── unhandled promise rejections ────────────────────────────────────────────
//
// There was no handler for these ANYWHERE in the tree, and the consequence is
// specific rather than theoretical. Verified empirically on this Node 24
// runtime: with an uncaughtException handler registered, an unhandled rejection
// is routed to THAT handler and the process survives (exit 0). So this process
// — which is also the backend — quietly absorbed every stray rejection: no
// crash, no zombie window, nothing in any log. What the user got instead was a
// request that never received a response, and a spinner that ran until the
// client-side budget expired (15s reads / 45s solver / 120s LLM) with no error
// to show for it. Now it is written down, and the user is told something broke.
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(`Unhandled rejection: ${util.inspect(reason, { depth: 2 })}`);
  if (bootState.phase === "starting") {
    log.write("main", `unhandled rejection during boot: ${err.stack || err.message}`);
    setBootState({
      phase: "failed",
      title: "Cut Protocol hit an unexpected error while starting",
      message: err.message,
      detail: "Your data was not modified. Reopen the app; if it fails again, send the log below.",
      logPath: log.getLogPath(),
    });
    return;
  }
  // No native dialog here. A rejection is usually one failed request rather
  // than a broken window, and an OS-level modal for each would be worse than
  // the silence it replaces. The renderer gets it and can offer a report.
  reportRuntimeFault("unhandled rejection", err);
});

app.on("window-all-closed", () => {
  // Windows/Linux convention: quit fully when all windows close. (macOS
  // apps conventionally stay running in the dock instead — not relevant
  // for this Windows-only target, but excluded per platform convention.)
  if (process.platform !== "darwin") {
    app.quit();
  }
});
