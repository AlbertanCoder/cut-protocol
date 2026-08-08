# RESTYLE AUDIT — what already exists vs what the runbook asks for

Written in Phase 0 at the owner's instruction (2026-08-07): *audit both, then the
owner decides at the review gate.* Nothing here has been acted on.

**Headline: Phases 2 and 3 of the runbook are already done in this repo, and
Phase 4 is half done. The app already has a two-layer token system, screens
already consume it, and a working light theme already ships behind a toggle.**

---

## 1. The token layer already exists

`frontend/src/index.css` carries a complete two-layer system under the name
**SIGNAL BLACK**:

- **Primitive layer** — raw `oklch(…)` values, written inline per role.
- **Semantic layer** — shadcn's role vocabulary, mapped into Tailwind via
  `@theme inline` at `index.css:10-52`.
- **Light palette** on bare `:root` (`index.css:57-100`), commented
  *"performance paper"*, with its contrast ratios recorded in the comments.
- **Dark palette** on `.dark` (`index.css:105-143`), the shipped default.
- A documented compat block (`index.css:176-193`) holding the theme-invariant
  values that `lib/theme.js` snapshots.

The runbook's Phase 2 asks for exactly this shape. It exists.

## 2. Screens already consume tokens

`scripts/no-hardcoded-colours.js` was run across the whole tree in Phase 0. Once
comments are stripped and `var(--token, fallback)` pairs are excluded, the only
colour literals left in `frontend/src` are **four hex values in the Google
sign-in SVG** (`LoginScreen.jsx:197-200`) — a third-party brand mark, now
allowlisted with a stated reason.

Everything else already reads `var(--foreground)`, `var(--muted-foreground)`,
`var(--border)`, `var(--warn)`, `var(--primary)` and friends. The runbook's
Phase 3 — "replace every hardcoded colour with the matching semantic token" —
has effectively already been carried out, screen by screen, on this branch's
ancestry.

## 3. A light theme already ships, and it is a shipped capability

- `frontend/index.html:2` boots `<html lang="en" class="dark">`.
- `App.jsx:450-456` wraps everything in `ThemeProvider defaultTheme="dark"
  storageKey="vite-ui-theme"`.
- `theme-provider.jsx:20-33` swaps the `light` / `dark` class on the root and
  honours `system` via `prefers-color-scheme`.
- `mode-toggle.jsx:11-30` is a real, reachable Light / Dark / System control,
  mounted in `HeaderBar.jsx:23` — inventoried as **F-023**.

So "flip to light" is not a migration in this codebase; it is **changing the
default and re-tuning the light palette that is already there.** And under
constraint 1, the `.dark` block cannot simply be deleted afterwards — dark is a
feature a user can select.

## 4. Where the two directions actually conflict

| Role | Runbook Phase 4 asks for | What `index.css` ships today (light) |
|---|---|---|
| `surface` | `#FBF7F1` warm cream | `--background: oklch(0.985 0.002 250)` — cool near-white |
| `surfaceRaised` | `#FFFFFF` | `--card: oklch(1 0 0)` — same intent, matches |
| `textPrimary` | `#23201D` warm near-black | `--foreground: oklch(0.17 0.01 260)` — cool near-black |
| `textSecondary` | `#6B6256` warm grey | `--muted-foreground: oklch(0.50 0.015 255)` — cool grey |
| `accent` (fills) | `#B4460E` burnt orange | `--primary: oklch(0.52 0.11 162)` — deep emerald |
| `accentTint` | `#FDEFE7` | `--accent: oklch(0.945 0.014 168)` — faint mint wash |
| `positive` | `#3F6B47` | *(rides `--primary`; `--good` aliases it, `index.css:184`)* |
| `warning` | `#8A6516` | `--warn: oklch(0.52 0.12 75)` — already amber, already AA-checked |
| `danger` | `#A8332F` | `--destructive: oklch(0.577 0.245 27.3)` |
| `border` | `#E2D8C8` warm hairline | `--border: oklch(0.91 0.006 250)` — cool hairline |

These are **two complete, separately contrast-checked systems**, not one
finished and one unfinished. The disagreement is a taste decision — warm cream
with a burnt-orange accent, versus cool paper with an emerald accent — and it is
the owner's call, not a technical gap.

Both satisfy the runbook's two structural rules independently of palette: cards
are never identified by edge alone (`--card` is white on a tinted background in
both), and every number is already tabular app-wide (`index.css:198-202` sets
`font-variant-numeric: tabular-nums` on `body`).

## 5. Four traps a Phase-4 flip would hit here

1. **`lib/theme.js` is snapshot-once and theme-INVARIANT by design.** It reads
   the CSS custom properties into a plain `C` object at module load
   (`theme.js:26`) and never re-reads them on a theme flip — this is deliberate
   and documented at `index.css:169-175`. Every `C.*` consumer (Recharts series,
   macro chips, `getStampStyle`) therefore keeps dark-derived values whatever the
   theme is. Flipping the default without understanding this produces a light app
   with dark-tuned chart ink.
2. **`C.paper` (`#0B0D0C`) is used as *ink on top of* macro-triad fills**, e.g.
   `TodayTab.jsx:107` draws the P/C/F letter badge in `C.paper` on a `C.protein`
   background. That is correct and must stay dark even in a light theme. It is
   not a stray dark literal to "fix".
3. **The macro triad is constitutional and must not be re-toned.** Protein
   `#56B4E9` / carbs `#E69F00` / fat `#CC79A7` (Okabe-Ito, `index.css:186-192`)
   are fixed by design law (c) and carry P/C/F letter labels everywhere. The
   runbook's palette does not name macro colours, so they survive untouched.
4. **`index.html:8` hardcodes `theme-color` to the dark background** with a
   comment saying so. It is outside `frontend/src`, so
   `no-hardcoded-colours.js` will not catch it; a light-first flip must update it
   by hand or the OS window chrome stays dark.

## 6. The branch situation

- `DO-NOT-TOUCH.md` says restyle work happens **only on `ui-restyle`**, baselined
  at tag `ui-restyle-baseline` = `ccd1372` on `fleet/measure-2026-08`.
- This migration is on `light-migration`, cut from `saas-launch` @ `d47316b`.
- Both `ui-restyle` and `fleet/measure-2026-08` exist as local branches and have
  **not** been diffed against `saas-launch` in this session — that was not in
  scope for Phase 0 recon and would need its own pass.

## 7. What this means for the plan — for the owner to decide

Three honest options. None has been chosen.

**A. Re-tune, don't rebuild.** Accept that Phases 2 and 3 are done, treat Phase 4
as "swap the `:root` values to the warm palette, flip the default to light, keep
`.dark` working", and go straight to Phase 1 (golden fixtures) → Phase 4. Saves
the most work; loses nothing, because the token layer the runbook wanted is the
token layer that exists.

**B. Keep SIGNAL BLACK's light palette and skip the recolour entirely.** The app
already has a contrast-checked light theme. If the goal is "ship a light
default", changing `defaultTheme` and `index.html`'s class is close to the whole
job. The cream/orange direction would be dropped.

**C. Follow the runbook literally.** Build `frontend/src/theme/` as a parallel
token layer, re-point screens at it, then flip. This duplicates work already
done, and would leave two token systems live at once — which is the condition
that produces drift.

**Recommendation: A.** It respects the six constraints, keeps the theme toggle
working, and does not re-do 3,000 lines of already-tokenised screens. But the
palette itself — warm cream vs cool paper — is a taste call and stays open.
