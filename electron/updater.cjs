// Cut Protocol — auto-update channel (competitor-gap-1).
//
// THE PROBLEM THIS SOLVES
// A copy of this app handed to someone else is, today, frozen forever. Every
// allergen fix, solver fix and safety fix we ship stays on this machine. For
// a food app that hard-filters allergies, "the user is running a build with a
// known allergen bug and has no way to receive the fix" is the single worst
// property the product can have. This module gives a shipped copy a way to
// pull a fix.
//
// DESIGN RULES (all four are load-bearing, do not relax them)
//  1. THE APP MUST WORK FULLY OFFLINE. An update check is a nice-to-have that
//     runs beside the app, never in front of it. Nothing here is awaited on
//     the boot path; nothing here can keep the window from opening.
//  2. AN OFFLINE USER MUST NEVER SEE AN ERROR. Being on a plane is not a
//     failure state. Network errors are logged and swallowed. The ONLY time a
//     failure is shown is when the user explicitly asked ("Check for
//     updates") — then silence would be the dishonest answer.
//  3. DOWNLOAD IN BACKGROUND, ASK BEFORE RESTARTING. We never yank the window
//     out from under someone mid-meal-plan. The install happens on quit
//     unless they pick "Restart now".
//  4. DEGRADE IF THE DEPENDENCY IS ABSENT. electron-updater is required
//     lazily inside a try/catch: a tree where `npm install` has not been run
//     yet still boots, it just logs that updates are unavailable.
//
// Publishing is configured in the root package.json (build.publish → GitHub
// releases, repo AlbertanCoder/cut-protocol). No token lives in this repo;
// GH_TOKEN is supplied in the publish shell only. See docs/RELEASING.md.

const log = require("./logger.cjs");

let autoUpdater = null; // resolved lazily; stays null if the dep is missing
let wired = false;
let inFlight = false; // one check at a time
let state = "idle"; // idle | checking | none | downloading | ready | error
let lastError = null;

function loadUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    // eslint-disable-next-line global-require
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    log.write("updater", `electron-updater is not installed (${e.message}) - update checks disabled for this run`);
    return null;
  }
  return autoUpdater;
}

/**
 * Attach the event handlers exactly once.
 * @param {object} deps { app, dialog, BrowserWindow }
 */
function wire(deps) {
  if (wired) return autoUpdater;
  const u = loadUpdater();
  if (!u) return null;

  // Background download; install when the app next quits unless the user
  // chooses to restart now.
  u.autoDownload = true;
  u.autoInstallOnAppQuit = true;
  // electron-updater has its own electron-log integration; we do not want a
  // second logging stack, so route its noise through ours.
  u.logger = {
    info: (m) => log.write("updater", String(m)),
    warn: (m) => log.write("updater", `warn: ${m}`),
    error: (m) => log.write("updater", `error: ${m}`),
    debug: () => {},
  };

  u.on("checking-for-update", () => { state = "checking"; });

  u.on("update-not-available", (info) => {
    state = "none";
    log.write("updater", `up to date (${info?.version ?? "unknown"})`);
    if (pendingManualDialog) {
      const { dialog } = deps;
      dialog.showMessageBox({
        type: "info",
        title: "Cut Protocol",
        message: "You're on the latest version.",
        detail: `Version ${deps.app.getVersion()}.`,
        buttons: ["OK"],
      });
      pendingManualDialog = false;
    }
  });

  u.on("update-available", (info) => {
    state = "downloading";
    log.write("updater", `update ${info?.version ?? "?"} available - downloading in the background`);
    if (pendingManualDialog) {
      const { dialog } = deps;
      dialog.showMessageBox({
        type: "info",
        title: "Cut Protocol",
        message: `Version ${info?.version ?? ""} is downloading in the background.`,
        detail: "You can keep using the app. We'll ask before restarting to install it.",
        buttons: ["OK"],
      });
      pendingManualDialog = false;
    }
  });

  u.on("download-progress", (p) => {
    if (p && typeof p.percent === "number" && Math.round(p.percent) % 25 === 0) {
      log.write("updater", `download ${Math.round(p.percent)}%`);
    }
  });

  u.on("update-downloaded", async (info) => {
    state = "ready";
    log.write("updater", `update ${info?.version ?? "?"} downloaded - prompting`);
    const { dialog } = deps;
    const res = await dialog.showMessageBox({
      type: "question",
      title: "Update ready",
      message: `Cut Protocol ${info?.version ?? ""} is ready to install.`,
      detail: "Installing takes a few seconds and restarts the app. Your data stays where it is. You can also just keep working — it installs the next time you close the app.",
      buttons: ["Restart now", "Later"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (res.response === 0) {
      log.write("updater", "user chose restart-now");
      // isSilent=false so the NSIS UI shows; isForceRunAfter=true reopens us.
      u.quitAndInstall(false, true);
    } else {
      log.write("updater", "user deferred - will install on quit");
    }
  });

  u.on("error", (err) => {
    state = "error";
    lastError = err?.message || String(err);
    inFlight = false;
    // RULE 2: offline is not an error the user should see. Log it, move on.
    log.write("updater", `check failed (this is normal offline): ${lastError}`);
    if (pendingManualDialog) {
      const { dialog } = deps;
      dialog.showMessageBox({
        type: "info",
        title: "Cut Protocol",
        message: "Couldn't check for updates right now.",
        detail: `The app works fine offline — this only means we couldn't reach the release server.\n\n${lastError}\n\nLog: ${log.getLogPath() || "(not available)"}`,
        buttons: ["OK"],
      });
      pendingManualDialog = false;
    }
  });

  wired = true;
  return u;
}

let pendingManualDialog = false;

/**
 * Run one update check.
 *
 * @param {object} deps  { app, dialog, BrowserWindow }
 * @param {object} opts  { manual } — manual checks report their outcome to the
 *                       user (including failures); automatic ones never do.
 * @returns {Promise<{ started: boolean, reason?: string }>}
 */
async function checkForUpdates(deps, opts = {}) {
  const manual = !!opts.manual;
  const { app, dialog } = deps;

  // Never run against an unpackaged tree: electron-updater looks for
  // dev-app-update.yml and throws when it is absent. Dev gets a clear log
  // line (and, for a manual check, an honest dialog) instead of a stack.
  if (!app.isPackaged && !process.env.CUT_PROTOCOL_FORCE_UPDATE_CHECK) {
    log.write("updater", "skipped: not a packaged build (dev tree)");
    if (manual) {
      dialog.showMessageBox({
        type: "info",
        title: "Cut Protocol",
        message: "Updates only apply to an installed build.",
        detail: "You're running from the source tree, so there's nothing to update.",
        buttons: ["OK"],
      });
    }
    return { started: false, reason: "dev" };
  }

  const u = wire(deps);
  if (!u) {
    if (manual) {
      dialog.showMessageBox({
        type: "info",
        title: "Cut Protocol",
        message: "Update checking isn't available in this build.",
        detail: "The updater component is missing. Reinstall from the latest release to get updates again.",
        buttons: ["OK"],
      });
    }
    return { started: false, reason: "no-updater" };
  }

  if (inFlight) return { started: false, reason: "already-checking" };
  inFlight = true;
  pendingManualDialog = manual;

  try {
    await u.checkForUpdates();
    inFlight = false;
    return { started: true };
  } catch (e) {
    // checkForUpdates() rejects on DNS/offline before the 'error' event in
    // some paths — same policy applies: silent unless the user asked.
    inFlight = false;
    state = "error";
    lastError = e?.message || String(e);
    log.write("updater", `check failed (this is normal offline): ${lastError}`);
    if (manual && pendingManualDialog) {
      pendingManualDialog = false;
      dialog.showMessageBox({
        type: "info",
        title: "Cut Protocol",
        message: "Couldn't check for updates right now.",
        detail: `The app works fine offline — this only means we couldn't reach the release server.\n\n${lastError}\n\nLog: ${log.getLogPath() || "(not available)"}`,
        buttons: ["OK"],
      });
    }
    return { started: false, reason: "error" };
  }
}

/**
 * Launch-time check. Deliberately delayed and deliberately fire-and-forget:
 * the window is already open and usable before this runs, and nothing awaits
 * its result. An offline machine simply logs one line.
 */
function scheduleLaunchCheck(deps, delayMs = 8000) {
  const t = setTimeout(() => {
    checkForUpdates(deps, { manual: false }).catch(() => {});
  }, delayMs);
  if (typeof t.unref === "function") t.unref(); // never hold the process open
  return t;
}

function getState() {
  return { state, lastError, available: !!loadUpdater() };
}

module.exports = { checkForUpdates, scheduleLaunchCheck, getState };
