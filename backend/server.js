// Must run before dotenv and before any route file is required, since the
// route files require src/lib/prisma.js which constructs the PrismaClient
// (and resolves DATABASE_URL) at module-load time. In packaged Electron
// mode, CUT_PROTOCOL_DB_PATH/DATABASE_URL are already set in process.env by
// electron/main.cjs before this file is ever required, so this is safe to
// call even ahead of dotenv/config (dotenv never overwrites existing vars).
const { ensureDatabaseReady } = require("./src/lib/desktopBootstrap.js");
ensureDatabaseReady();

require("dotenv/config");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const authRoutes = require("./src/routes/auth.js");
const profileRoutes = require("./src/routes/profile.js");
const weighinRoutes = require("./src/routes/weighins.js");
const recipeRoutes = require("./src/routes/recipes.js");
const planRoutes = require("./src/routes/plans.js");
const foodRoutes = require("./src/routes/foods.js");
const cartRoutes = require("./src/routes/cart.js");
const trainingRoutes = require("./src/routes/training.js");

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/weighins", weighinRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/foods", foodRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/training", trainingRoutes);
app.use("/api/meta", require("./src/routes/meta.js")); // public: build version/OS for bug reports

// Unmatched /api routes return clean JSON, not the SPA index.html (the
// catch-all below only handles non-/api paths).
app.use("/api", (req, res) => res.status(404).json({ error: "not found" }));

// Serve the built frontend as static files, same origin as the API â€”
// no CORS needed. Falls back to index.html for client-side routing.
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(frontendDist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// Terminal error middleware (Stage-C #23). Express 5 auto-forwards async
// route rejections here, so every route's errors now leave as a clean
// { error } JSON with a sane status — instead of framework stack-trace HTML
// that the frontend could only surface as a generic "request failed: 500".
// Common Prisma codes map to meaningful statuses; stack traces are logged
// server-side only, never sent to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const prismaStatus = { P2002: 409, P2025: 404, P2021: 500, P2022: 500 }[err.code];
  const status = err.status || prismaStatus || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, err.message);
  res.status(status).json({ error: status < 500 ? err.message : "something went wrong on our end" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Cut Protocol backend listening on :${PORT}`);
  // Phase 2 guardrail: bad food/recipe data can never come back silently â€”
  // every boot re-audits the library and says so out loud.
  const { runDataQualityAudit } = require("./src/lib/dataQualityAudit.js");
  runDataQualityAudit()
    .then((s) => {
      const status = s.empty ? "EMPTY — database may not have initialized" : s.clean ? "CLEAN" : "ATTENTION NEEDED";
      console.log(`[data-audit] ${status} â€” foods ${s.foods} (${s.foodFailures.length} failing), recipes ${s.recipes} (${s.recipeFailures.length} failing), duplicate groups ${s.duplicateGroups}`);
      if (!s.clean) {
        for (const f of s.foodFailures.slice(0, 10)) console.log(`[data-audit]   food "${f.name}": ${f.issues.join(", ")}`);
        for (const r of s.recipeFailures.slice(0, 10)) console.log(`[data-audit]   recipe "${r.name}": ${r.issues.join(", ")}`);
      }
    })
    .catch((e) => console.error("[data-audit] failed to run:", e.message));
});
