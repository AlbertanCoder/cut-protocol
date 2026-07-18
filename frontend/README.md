# Cut Protocol — frontend

React/Vite UI. Talks to the backend API in `../backend` — see the root
README for how to run both together.

```
npm install
npm run dev
```

Dev server proxies `/api/*` to `http://localhost:3001` (see `vite.config.js`),
so the backend must be running for anything beyond the login screen to work.
