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
// If a future need comes up for the renderer to call into Electron/Node
// (native file dialogs, app version info, etc.), expose it here explicitly
// via contextBridge — never by flipping nodeIntegration on.
//
// const { contextBridge } = require("electron");
// contextBridge.exposeInMainWorld("cutProtocol", {
//   // e.g. version: () => process.env.npm_package_version,
// });
