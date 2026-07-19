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
// One explicit, minimal bridge: open an external URL in the user's real
// browser (used by the bug reporter to hand off the pre-filled GitHub issue
// URL). Kept behind contextIsolation; main-process validates the URL scheme.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("cutProtocol", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
