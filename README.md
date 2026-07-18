<img src="assets/icon/png/icon-128.png" width="96" height="96" align="left" alt="Cut Protocol — shield badge icon">

# Cut Protocol

[![CI](https://github.com/AlbertanCoder/cut-protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/AlbertanCoder/cut-protocol/actions/workflows/ci.yml)

A cutting-focused nutrition coach — calibrated calorie targets, AI-assisted weekly meal planning, and honest weigh-in trend tracking.

<br clear="left">

> **Branding:** the shield-badge mark (a geometric six-pack inside a shield, athletic green `#2FD576` on charcoal) lives in `assets/icon/` — SVG masters (`cutprotocol-outline.svg` for 48px+, inverted `cutprotocol-solid.svg` for small sizes), the rendered PNG set, and the multi-size `CutProtocol.ico` at the repo root that Electron and the Windows build consume. The in-app mark is `frontend/src/components/ui/CutMark.jsx`.

## What it does

Cut Protocol is built for someone running a calorie deficit who wants the math shown, not hidden. Once you're logged in, it:

- Computes your BMR from **six independent formulas** (Mifflin–St Jeor, Oxford/Henry, Harris–Benedict, Schofield/WHO, plus Katch–McArdle and Cunningham once you supply a body-fat %) and averages the applicable ones — with per-formula exclude toggles and the spread shown, rather than trusting any single equation.
- Builds TDEE from components you can see: BMR × a 36-occupation activity multiplier + MET-based training calories. Your calorie target is **derived** — TDEE minus the deficit your chosen rate of loss needs, clamped to a hard safety floor — and re-computes automatically as your weigh-ins move.
- Generates a full week of meals from a 600+ recipe library using a deterministic solver: three scored candidates per day, portion scaling, honest match percentages, per-slot swap with three alternates, slot locking, and a plain-language diagnosis whenever your targets are genuinely out of reach (it names the binding constraint — it never silently misses).
- Filters every recipe, plan, and AI generation through your dietary style (9 styles) and allergy checkboxes before anything reaches you. Allergy filtering is zero-tolerance and is never relaxed by a suggestion.
- Imports recipes from the web: paste a URL, it reads the site's schema.org markup, converts amounts to grams (flagging estimates honestly), matches ingredients to the validated food database, and lets you review before anything saves.
- Generates new recipes with AI (Anthropic API) that must pass the same nutrition validator as every other food before they can be saved.
- Builds a real grocery list from your week: raw/dry purchase quantities (not just as-cooked grams), practical retail units, store-section grouping, and rough CAD cost estimates that admit their coverage.
- Tracks daily weigh-ins, smooths them into a 7-day trend, verdicts the pace against your chosen band, and projects a goal date from your measured rate.
- Runs as a normal web app, or as a packaged Windows desktop app via Electron.

## Features

- Six-formula BMR engine (averaged, excludable, spread shown) + occupation/training TDEE build
- Derived calorie target with sex-based + user-set safety floors; unsafe rates require explicit acknowledgment
- Weekly meal-plan solver: scored day candidates, swaps with alternates, locks, batch-cooking mode, cuisine/protein/budget steering
- Recipe library grouped by cuisine / meal type / protein with search and protein-density sort
- Recipe URL importer (schema.org) with honest unit-conversion flags — no paid API
- AI recipe generation gated by the food-data validator; loud per-generation allergen override that auto-resets
- Dietary style + allergy hard-filtering applied server-side before recipes ever reach you
- Cart that totals macros, feeds today's plan, and produces its own grocery list
- Grocery lists with practical purchase units, store sections, checkboxes, and labeled cost estimates
- Weigh-in log with 7-day rolling average, rate verdicts, and goal-date projection
- USDA FoodData Central as the nutrition source of truth, with a validated 850+ food database
- Windows desktop build via Electron, alongside the standard web app

## Tech stack

- **Backend:** Node.js, Express 5, Prisma 6 (SQLite in dev), JWT auth
- **Frontend:** React 19, Vite 8, Tailwind CSS 4, Recharts
- **Desktop:** Electron + electron-builder (Windows installer)
- **AI:** Anthropic API for recipe generation
- **Nutrition data:** USDA FoodData Central API

## Setup & running locally

Prereqs: Node.js and npm.

**1. Clone and install dependencies:**

```
git clone <repo-url>
cd cut-protocol
npm install
cd backend && npm install
cd ../frontend && npm install
```

**2. Configure the backend:**

```
cd backend
cp .env.example .env
```

Fill in `backend/.env`:
- `JWT_SECRET` — generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `USDA_API_KEY` — free key from [fdc.nal.usda.gov/api-key-signup](https://fdc.nal.usda.gov/api-key-signup)
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
- `SEED_EMAIL` / `SEED_PASSWORD` — your own login, used once by the seed step below

**3. Set up the database and seed an account:**

```
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run seed:recipes
```

**4. Run it (two terminals):**

```
cd backend && npm run dev      # :3001
cd frontend && npm run dev     # :5173, proxies /api to :3001
```

Open `http://localhost:5173` and log in with the account you just seeded.

### Desktop build (optional)

From the repo root: `npm install`, then `npm run dist` builds a Windows installer via Electron.

## Screenshots

**Today** — daily target vs. planned macros, weigh-in log, and a rate-of-loss verdict.
![Today tab](screenshots/today.jpg)

**Trend** — 7-day weight average, projected goal date, and body-fat estimate.
![Trend tab](screenshots/trend.jpg)

**Engine** — the formula panel, TDEE component build, and the derived target. Every number shows its work.
![Engine tab](screenshots/engine.jpg)

**Plan** — the solver-fit weekly meal plan with steering filters, swaps, locks, and the sectioned grocery list.
![Plan tab](screenshots/plan.jpg)

**Recipes** — the grouped library, URL importer, AI generation, and cart.
![Recipes tab](screenshots/recipes.jpg)

---

© 2026 Shad. All rights reserved. This project is shared for demonstration purposes; please don't reuse the code without permission.
