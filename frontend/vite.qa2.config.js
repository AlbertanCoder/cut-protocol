import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Isolated QA instance #2 — bound to 127.0.0.1 (a DIFFERENT cookie origin from
// localhost) so a destructive first-run walk can register its own account
// without evicting the session the other reviewers share on localhost:5173.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3002", changeOrigin: true },
    },
  },
})
