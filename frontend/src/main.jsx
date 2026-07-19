import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installGlobalHandlers } from './lib/bugLog.js'

// Catch uncaught sync errors and unhandled promise rejections app-wide (they
// get logged and surface the friendly "Something went wrong" dialog).
installGlobalHandlers()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
