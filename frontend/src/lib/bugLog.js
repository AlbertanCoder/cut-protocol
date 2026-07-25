// A tiny ring buffer of recent app activity for bug reports.
//
// PRIVACY BY CONSTRUCTION: this records only what HAPPENED — an HTTP
// method+path+status, a navigation, or an error message+stack — never a
// request or response BODY. So weights, allergies, food logs, and names
// cannot enter the log in the first place. The scrubber (scrub.js) is a
// second belt-and-suspenders pass applied when a report is assembled.
//
// ── WHY IT IS NO LONGER MEMORY-ONLY ────────────────────────────────────────
// It used to live purely in a module-scoped array, which meant a page reload
// wiped it. The reload that wiped it most reliably was ErrorBoundary's own
// "Reload" button — so the single moment the app most needed the fifty events
// leading up to a crash was the exact moment it threw them away, and the user
// arrived at the report dialog with "(no recent activity captured)". It is now
// mirrored into sessionStorage: survives a reload and a navigation, dies with
// the window, never touches the disk-backed profile.

const MAX = 50;
const STORE_KEY = "cutprotocol:activityLog";

function stamp() {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS, no date/timezone
}

function session() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // storage disabled/partitioned — the in-memory buffer still works
  }
}

function hydrate() {
  const store = session();
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(STORE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e.detail === "string")
      .slice(-MAX)
      .map((e) => ({ t: String(e.t || ""), type: String(e.type || ""), detail: e.detail }));
  } catch {
    return [];
  }
}

const buffer = hydrate();
if (buffer.length) {
  buffer.push({ t: stamp(), type: "session", detail: `— reloaded (${buffer.length} events kept from before the reload) —` });
}

// Coalesced: a burst of API calls must not turn into a burst of synchronous
// JSON.stringify + storage writes on the render path.
let flushHandle = null;
function persist() {
  if (flushHandle !== null) return;
  flushHandle = setTimeout(() => {
    flushHandle = null;
    const store = session();
    if (!store) return;
    try {
      store.setItem(STORE_KEY, JSON.stringify(buffer));
    } catch {
      // Quota exceeded / storage blocked. Drop the mirror, keep the buffer —
      // a failure to persist diagnostics must never break the app.
    }
  }, 250);
}

export function logEvent(type, detail) {
  buffer.push({
    t: stamp(),
    type,
    detail: String(detail ?? "").slice(0, 300),
  });
  if (buffer.length > MAX) buffer.shift();
  persist();
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

  // ── the desktop shell's own faults ───────────────────────────────────────
  // The Electron main process runs the backend in-process. When something
  // throws or rejects there, this window is not notified by anything the web
  // platform provides — and the shell's previous attempt to notify it pushed
  // down the "boot-state" channel, which had zero subscribers in frontend/src.
  // Every post-boot main-process fault therefore disappeared. This is the
  // subscriber: it lands in the same report dialog as the renderer's own
  // crashes, so the user can actually file it.
  const off = window.cutProtocol?.onMainProcessError?.((info) => {
    const kind = (info && info.kind) || "main-process error";
    const message = (info && info.message) || "The app's local engine hit an error.";
    logEvent("main-process", `${kind}: ${message}`);
    surface(
      new Error(
        `${message}\n\n(This happened in Cut Protocol's local engine, not in the window. ` +
        "Your data is on disk and unchanged. If the app stops responding, press Ctrl+R to reload the window.)"
      )
    );
  });
  return typeof off === "function" ? off : () => {};
}
