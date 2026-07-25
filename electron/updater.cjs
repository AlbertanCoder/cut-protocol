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
// idle | checking | none | no-release | downloading | ready | offline | error
let state = "idle";
let lastError = null;
let lastFailureKind = null; // "no-release" | "offline" | "rate-limited" | "error"

// ── "check failed (this is normal offline)" was hiding a permanent break ─────
//
// The owner's log carries five consecutive failures of the form
//   Unable to find latest version on GitHub … HttpError: 406
// and every one of them was written down as "this is normal offline". The
// machine was online. `gh api` reports ZERO published releases on
// AlbertanCoder/cut-protocol, so electron-updater's GitHub provider has nothing
// to read and never will until a release is cut. The honest-sounding copy is
// exactly what made a permanently dead update channel look like weather.
//
// "There is no release yet", "the network is down" and "GitHub throttled us"
// are three different facts with three different fixes, and the log — and any
// dialog the user asked for — must say which one happened.
function classifyUpdateError(err) {
  const msg = String((err && err.message) || err || "");
  const code = String((err && err.code) || "");
  const status = Number(err && (err.statusCode || err.status)) ||
    Number((msg.match(/HttpError:\s*(\d{3})/) || [])[1]) ||
    Number((msg.match(/\bstatus(?:Code)?[ =:]+(\d{3})\b/i) || [])[1]) ||
    0;

  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNABORTED|net::ERR_/i.test(`${code} ${msg}`)) {
    return "offline";
  }
  if (status === 403 || status === 429 || /rate limit/i.test(msg)) return "rate-limited";
  // 404: no releases endpoint / no latest.yml. 406: what GitHub returns for the
  // releases feed of a repo that has never published one — the exact code in
  // the owner's log.
  if (status === 404 || status === 406 || /Unable to find latest version|no published versions|latest\.yml/i.test(msg)) {
    return "no-release";
  }
  return "error";
}

const FAILURE_COPY = {
  "no-release": {
    logLine: "no release has been published for this app yet — there is nothing to update to. This is NOT a network problem and will not fix itself.",
    message: "There are no updates published yet.",
    detail: "Cut Protocol reached the release server fine — there simply hasn't been a release posted for it to offer. Nothing is wrong with your copy.",
  },
  offline: {
    logLine: "could not reach the release server (network)",
    message: "Couldn't reach the update server.",
    detail: "The app works fully offline — this only means the check couldn't get through right now. It'll try again next time you open Cut Protocol.",
  },
  "rate-limited": {
    logLine: "the release server refused the check (rate limited)",
    message: "The update server asked us to slow down.",
    detail: "Too many checks in a short window. Try again in a few minutes — nothing is wrong with your copy.",
  },
  error: {
    logLine: "update check failed",
    message: "Couldn't check for updates.",
    detail: "This isn't a problem with your data or your copy of the app — the check itself failed.",
  },
};

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

  // DOWNLOAD ONLY WHEN THE USER SAYS SO.
  //
  // autoDownload was true against a PUBLIC repo whose binaries are not code
  // signed (Get-AuthenticodeSignature reports NotSigned on both the installer
  // and the app .exe, and the electron-builder config carries no
  // certificateFile). With signing absent, the only thing standing between this
  // app and an arbitrary executable is the sha512 recorded in latest.yml on
  // that public release feed. Silently pulling a payload down and queueing it
  // to install on quit is the wrong default for that, and doubly wrong while
  // the feed is empty and untested. The user is asked first; the install still
  // happens on quit once they have agreed to the download.
  u.autoDownload = false;
  u.autoInstallOnAppQuit = true;
  // electron-updater has its own electron-log integration; we do not want a
  // second logging stack, so route its noise through ours.
  u.logger = {
    info: (m) => log.write("updater", String(m)),
    warn: (m) => log.write("updater", `warn: ${m}`),
    error: (m) => log.write("updater", `error: ${m}`),
    debug: () => {},
  };

  u.on("checking-for-update", () => { state = "checking"; lastFailureKind = null; });

  u.on("update-not-available", (info) => {
    state = "none";
    lastFailureKind = null;
    lastError = null;
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

  u.on("update-available", async (info) => {
    state = "available";
    const version = info?.version ?? "?";
    log.write("updater", `update ${version} is available - asking before downloading (autoDownload is off)`);
    const { dialog } = deps;
    pendingManualDialog = false;
    const res = await dialog.showMessageBox({
      type: "question",
      title: "Update available",
      message: `Cut Protocol ${version} is available.`,
      detail:
        `You're on ${deps.app.getVersion()}. The download runs in the background and installs when you next close the app — we'll ask before restarting.\n\n` +
        "These builds aren't code signed yet, so Windows may warn you when the installer runs.",
      buttons: ["Download it", "Not now"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (res.response !== 0) {
      state = "none";
      log.write("updater", `user declined the ${version} download`);
      return;
    }
    state = "downloading";
    log.write("updater", `downloading ${version} at the user's request`);
    u.downloadUpdate().catch((e) => {
      // The 'error' event usually fires too, but a rejection here must not
      // become an unhandled one.
      log.write("updater", `download failed: ${e?.message || e}`);
    });
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
    inFlight = false;
    reportFailure(deps, err);
  });

  wired = true;
  return u;
}

let pendingManualDialog = false;

/**
 * One place that turns a failed check into a log line and (only when the user
 * asked) a dialog. RULE 2 still holds — an automatic check never interrupts
 * anyone — but "silent to the user" is not the same as "unlabelled in the log",
 * which is what the old single "this is normal offline" line made it.
 */
function reportFailure(deps, err) {
  const kind = classifyUpdateError(err);
  const copy = FAILURE_COPY[kind] || FAILURE_COPY.error;
  lastError = err?.message || String(err);
  lastFailureKind = kind;
  state = kind === "no-release" ? "no-release" : kind === "offline" ? "offline" : "error";
  log.write("updater", `${copy.logLine}: ${lastError}`);
  if (!pendingManualDialog) return;
  pendingManualDialog = false;
  deps.dialog.showMessageBox({
    type: "info",
    title: "Cut Protocol",
    message: copy.message,
    detail: `${copy.detail}\n\nDetail: ${lastError}\n\nLog: ${log.getLogPath() || "(not available)"}`,
    buttons: ["OK"],
  });
}

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
    // some paths — same policy applies: silent unless the user asked, but
    // always classified in the log.
    inFlight = false;
    reportFailure(deps, e);
    return { started: false, reason: lastFailureKind || "error" };
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
  // `failureKind` is what any UI should branch on. "no-release" must not be
  // drawn as a network problem — it is a publishing gap, and telling the user
  // their connection failed when it didn't is the bug this file just fixed.
  return { state, lastError, failureKind: lastFailureKind, available: !!loadUpdater() };
}

module.exports = { checkForUpdates, scheduleLaunchCheck, getState };
