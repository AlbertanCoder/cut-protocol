// A tiny in-memory ring buffer of recent app activity for bug reports.
//
// PRIVACY BY CONSTRUCTION: this records only what HAPPENED — an HTTP
// method+path+status, a navigation, or an error message+stack — never a
// request or response BODY. So weights, allergies, food logs, and names
// cannot enter the log in the first place. The scrubber (scrub.js) is a
// second belt-and-suspenders pass applied when a report is assembled.

const MAX = 50;
const buffer = [];

export function logEvent(type, detail) {
  buffer.push({
    t: new Date().toISOString().slice(11, 19), // HH:MM:SS, no date/timezone
    type,
    detail: String(detail ?? "").slice(0, 300),
  });
  if (buffer.length > MAX) buffer.shift();
}

export function recentLogs() {
  return [...buffer];
}

// Log an API call as method + path + status ONLY (never the body). Called by
// the api.js request wrapper.
export function logApi(method, path, status) {
  logEvent("api", `${method} ${path} → ${status}`);
}

let dialogHandler = null;
// The App registers a handler that opens the "Something went wrong" dialog.
export function onUncaughtError(handler) {
  dialogHandler = handler;
}

let lastShown = 0;
function surface(err) {
  // Debounce so a burst of errors doesn't stack dialogs.
  const now = Date.now();
  if (dialogHandler && now - lastShown > 1500) {
    lastShown = now;
    dialogHandler(err);
  }
}

// Global catch-all for uncaught sync errors and unhandled promise rejections.
// Both are LOGGED; genuine uncaught ones also surface the friendly dialog.
export function installGlobalHandlers() {
  window.addEventListener("error", (e) => {
    // Ignore ResourceLoadingError-style events (no error object, e.g. an
    // <img> failing) — those aren't app crashes.
    if (!e.error && !e.message) return;
    logEvent("uncaught", `${e.message}${e.filename ? ` @ ${e.filename.split("/").pop()}:${e.lineno}` : ""}`);
    surface(e.error instanceof Error ? e.error : new Error(e.message || "Uncaught error"));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    const msg = (r && r.message) || String(r);
    logEvent("rejection", msg);
    surface(r instanceof Error ? r : new Error(msg));
  });
}
