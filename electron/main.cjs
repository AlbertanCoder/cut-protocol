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
function ensurePackagedSecrets() {
  if (!app.isPackaged) return; // dev: backend/.env owns JWT_SECRET/keys
  if (process.env.JWT_SECRET) return; // respect an explicitly-provided secret
  const crypto = require("crypto");
  const secretPath = path.join(app.getPath("userData"), "session-secret");
  let secret;
  try { secret = fs.readFileSync(secretPath, "utf8").trim(); } catch { /* first run */ }
  if (!secret) {
    secret = crypto.randomBytes(48).toString("hex");
    try {
      fs.mkdirSync(path.dirname(secretPath), { recursive: true });
      fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    } catch (e) {
      console.error("[electron/main] could not persist the session secret:", e.message);
    }
  }
  process.env.JWT_SECRET = secret;
}

ensurePackagedSecrets();

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
let bootState = { phase: "starting", message: "Starting up…" };

function setBootState(next) {
  bootState = { ...bootState, ...next };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("boot-state", bootState);
  }
}

ipcMain.handle("boot-state", () => bootState);
ipcMain.handle("open-log-folder", () => {
  const dir = log.getLogDir();
  if (dir) shell.openPath(dir);
  return dir;
});
ipcMain.handle("check-for-updates", () => updater.checkForUpdates({ app, dialog, BrowserWindow }, { manual: true }));
ipcMain.handle("updater-state", () => updater.getState());
// The renderer is served BY the backend, so it talks to its own origin with
// relative /api paths and never needs a hard-coded port. This is exposed only
// so the UI can display/diagnose the real port; the nonce is deliberately NOT
// exposed — identity is proven in the main process, before anything loads.
ipcMain.handle("backend-info", () => ({ port: Number(PORT), host: "127.0.0.1" }));

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
  mainWindow.loadFile(path.join(__dirname, "splash.html"));

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
async function boot() {
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
  // real screen rather than an uncaught main-process exception.
  if (backend && backend.server) {
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
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`${base}/`);

  // 4. Updates last, and only after the window is already usable. Fully
  //    fire-and-forget: offline machines log one line and carry on.
  updater.scheduleLaunchCheck({ app, dialog, BrowserWindow });
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
// the honest failure screen instead.
process.on("uncaughtException", (err) => {
  log.write("main", `uncaught: ${err && err.stack ? err.stack : err}`);
  if (bootState.phase === "starting") {
    setBootState({
      phase: "failed",
      title: "Cut Protocol hit an unexpected error while starting",
      message: (err && err.message) || String(err),
      detail: "Your data was not modified. Reopen the app; if it fails again, send the log below.",
      logPath: log.getLogPath(),
    });
  }
});

app.on("window-all-closed", () => {
  // Windows/Linux convention: quit fully when all windows close. (macOS
  // apps conventionally stay running in the dock instead — not relevant
  // for this Windows-only target, but excluded per platform convention.)
  if (process.platform !== "darwin") {
    app.quit();
  }
});
