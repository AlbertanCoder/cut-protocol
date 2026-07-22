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
const http = require("http");
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");

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

// Same port every time so we know what URL to poll/load below. If PORT is
// already set in the environment (e.g. by whoever launched Electron), leave
// it alone; otherwise default to 3001 to match backend/.env's own default.
process.env.PORT = process.env.PORT || "3001";
const PORT = process.env.PORT;

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
//    calls app.listen(PORT, ...) near the bottom of the file. We intentionally
//    keep this in-process (no child_process/spawn) — simplest possible
//    lifecycle, and it dies naturally when the Electron main process exits.
// ---------------------------------------------------------------------------
require("../backend/server.js");

// ---------------------------------------------------------------------------
// 3. Window management.
// ---------------------------------------------------------------------------

let mainWindow = null;

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

  const serverUrl = `http://localhost:${PORT}/`;

  waitForServer(serverUrl)
    .then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(serverUrl);
      }
    })
    .catch((err) => {
      console.error("[electron/main] " + err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        const message = encodeURIComponent(err.message);
        mainWindow.loadURL(
          `data:text/html,<body style="font-family:sans-serif;padding:2rem"><h2>Cut Protocol failed to start</h2><p>${message}</p></body>`
        );
      }
    });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    // macOS convention (re-create a window when the dock icon is clicked
    // and there are none open). Harmless to include even though this is a
    // Windows-only target.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Windows/Linux convention: quit fully when all windows close. (macOS
  // apps conventionally stay running in the dock instead — not relevant
  // for this Windows-only target, but excluded per platform convention.)
  if (process.platform !== "darwin") {
    app.quit();
  }
});
