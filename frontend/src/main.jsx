import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts bundled locally (@fontsource) — imported here (not via CSS @import)
// so Vite resolves and fingerprints the woff2 files into the build.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/sora/latin-700.css'
import '@fontsource/sora/latin-800.css'
// SIGNAL BLACK direction heading font (Sora stays until legacy screens drain)
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import './index.css'
// Legacy CSS quarantine (Phase 1 Step 2): the pre-restyle stylesheet,
// imported AFTER index.css. Drained per-screen in Phases 2–5.
import './legacy.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installGlobalHandlers } from './lib/bugLog.js'

// Catch uncaught sync errors and unhandled promise rejections app-wide (they
// get logged and surface the friendly "Something went wrong" dialog) — and
// subscribe to the Electron main process's own faults, which previously had no
// listener anywhere in frontend/src and therefore vanished silently.
installGlobalHandlers()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
