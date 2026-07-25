// Cut Protocol — Electron preload script.
//
// The renderer just loads the app's own served frontend (http://localhost:
// <PORT>/, served by the same Express app that answers /api/*), so it's a
// normal web page making relative fetch() calls — it doesn't need any
// Node/Electron bridge to function. This file exists mainly so
// webPreferences.preload has somewhere valid to point, keeping
// contextIsolation on and nodeIntegration off (the safe defaults) rather
// than reaching for nodeIntegration:true just to skip writing a preload
// file.
//
// Everything exposed here is deliberately minimal, one-way, and validated on
// the main-process side. Note what is NOT here: the launch nonce. Identity of
// the backend is proven in the main process BEFORE any page is loaded, so the
// renderer never needs (and never gets) the secret that proves it.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cutProtocol", {
  // Bug reporter: hand a pre-filled GitHub issue URL to the real browser.
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Boot/splash channel. `getBootState` is pull-based so splash.html can ask
  // for the current state the moment it loads — there is no race where a
  // pushed message arrives before the page exists. `onBootState` then streams
  // subsequent transitions.
  getBootState: () => ipcRenderer.invoke("boot-state"),
  onBootState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on("boot-state", handler);
    return () => ipcRenderer.removeListener("boot-state", handler);
  },
  openLogFolder: () => ipcRenderer.invoke("open-log-folder"),
  // Splash's "Try again" button. The main process decides what a retry means
  // (reload the loaded app vs. re-run the whole boot sequence).
  retryBoot: () => ipcRenderer.invoke("retry-boot"),

  // MAIN-PROCESS FAULTS, POST-BOOT. The old code pushed these down the
  // "boot-state" channel, which had exactly zero subscribers in frontend/src —
  // so an uncaught throw at hour three was logged and then vanished. This
  // channel has a real subscriber: frontend/src/lib/bugLog.js wires it into the
  // same "Something went wrong" report dialog as the renderer's own uncaught
  // errors. Payload is a kind + a message; never user data.
  onMainProcessError: (cb) => {
    const handler = (_e, info) => cb(info);
    ipcRenderer.on("main-process-error", handler);
    return () => ipcRenderer.removeListener("main-process-error", handler);
  },

  // The tail of %AppData%\Cut Protocol\logs\cut-protocol.log, for attaching to
  // a bug report. Read-only, capped, and scrubbed + shown to the user for
  // review in the renderer before it can go anywhere.
  readLogTail: (maxBytes) => ipcRenderer.invoke("read-log-tail", maxBytes),

  // Update channel. A "Check for updates" button anywhere in the UI can call
  // this; it reports its own outcome (including failures) because the user
  // explicitly asked. Automatic launch checks stay silent.
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getUpdaterState: () => ipcRenderer.invoke("updater-state"),

  // Which loopback port the backend actually got. The app itself does not
  // need this (it is served from that origin and uses relative /api paths) —
  // it exists for diagnostics and bug reports.
  getBackendInfo: () => ipcRenderer.invoke("backend-info"),
});
