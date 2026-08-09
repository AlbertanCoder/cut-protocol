# LIGHT-MIGRATION — read this first

Active on branch `light-migration` only. Full text + stack + phase gates:
**`MIGRATION/CONTRACT.md`**. Inventory: `MIGRATION/INVENTORY.md` (287 IDs).

> **SCOPE CORRECTION 2026-08-08 (ORCHESTRATION.md MISSION 1 item 2).** Reading the line
> above as "I am not on `light-migration`, so the six rules below do not bind me" is wrong
> on any branch that descends from it — which currently includes the one you are most
> likely reading this on.
>
> Measured today: `git merge-base --is-ancestor light-migration recipe-brain` succeeds. The
> migration's commits are ON this branch — `41f45f4` (phase-0 recon), `b90b5b7` (phase-1
> golden fixtures), `5ae57f4` (phase-4). `MIGRATION/` and its `CONTRACT.md` are in this
> working tree, and `MIGRATION/golden/`'s fixtures lock *this* branch's derived-number
> chain. Rule 2 in particular — never change a calorie, macro, TDEE, BMR, target or
> portion calculation — is enforced here by fixtures that no role can relock
> (`guard-edit.js:138`).
>
> The original line is about which branch the migration is being *driven from*, not about
> where its constraints stop. Flagged rather than reworded: the owner decides the wording
> of a rules file.

1. NEVER delete a file, function, component, branch of logic, or test — not
   "unused", not "superseded", not commented-out. Append it to
   `MIGRATION/DELETE-CANDIDATES.md` instead.
2. NEVER change a calorie, macro, protein, TDEE, BMR, target or portion
   calculation. Any phase. Ever.
3. NEVER rename or reshape a persisted key, table, column, migration, storage
   key, or API payload.
4. NEVER bump a persistence version without the migrate function in the same commit.
5. NEVER reference a file you have not read this session. `ls` the parent before
   writing a new path, and paste the output.
6. NEVER improve, reformat, reorganise, lint-sweep, upgrade or modernise anything
   not explicitly asked for. No dependency bumps. No renames. No "while I was in here".

Commands — build `npm run build` (frontend/) · lint `npm run lint` (frontend/) ·
test `npm test` (backend/) · run `npm start` (root). **There is no typecheck** —
no TypeScript in this repo; `lint` is its stand-in at every gate.

Gate: build 0 · lint 0 · `node scripts/parity-check.js` 0 ·
`node scripts/no-hardcoded-colours.js` 0 · diff only in the phase's allowed files ·
`git diff --diff-filter=D --name-only` empty · PROGRESS.md updated. Then commit,
print `PHASE N COMPLETE — AWAITING REVIEW`, stop.

This app is **Electron desktop**, not mobile. The runbook's iOS/Android clauses are void.

---

# Recomp — Claude Code Rules

Standing guardrails for every session in this repo. Read fully before changing anything.

## Project

- **Recomp**: body-recomposition / cut-protocol app.
- Frontend: React + Vite. Backend: Express 5 + Prisma 6 (Node).
- The recomp/cut-protocol logic is the **sellable asset** of this business. It is **UNTOUCHABLE** and must be provably unmodified — every diff should read as styling-only.
- Current mission: buyer-facing UI restyle (demo-quality polish). Presentation layer only.

## The Boundary: Styling Only

**Allowed to change:**

- JSX structure/markup (layout, hierarchy, wrapper elements)
- classNames / Tailwind utilities
- Style and theme files: CSS entry, theme tokens, `components.json`, files in the `components/ui` folder
- `index.html`, fonts, and static assets (favicon, images)
- New purely presentational component files (e.g. theme provider, mode toggle, chart wrappers, pricing cards)

**NEVER change:**

- State management (hooks, stores, context, reducers). Sole carve-out: purely visual local component state (active tab, dialog open/closed, selected pricing period, theme choice) is presentation and allowed. State that reaches the network, storage (other than the theme storageKey `"vite-ui-theme"`), or a global store is logic and forbidden.
- API calls, endpoints, fetching, request/response handling
- Calculations, formulas, protocol logic — anything that computes numbers
- Data flow: which data props are passed, transformations, business logic
- Event-handler wiring (handlers may move with their JSX, never be rewritten)
- Anything in the backend (Express + Prisma)
- **If `DO-NOT-TOUCH.md` exists in the repo root, its list is BINDING.** Do not edit, reformat, rename, or move any file on it — not even "harmless cleanup." If `DO-NOT-TOUCH.md` does NOT exist, STOP — no restyle work is permitted until the Phase 0 audit has produced and committed it (running that read-only audit is the only permitted work in that state).

No drive-by refactors. If a file mixes presentation and logic, change only the presentational lines.

## Sole Exception: Chart Migration

Existing charts may be swapped for shadcn charts (`npx shadcn@latest add chart` — installs Recharts automatically; do not npm-install it separately) under one strict rule:

- The replacement chart component must consume the **exact same data props/shape** as the old one.
- **Zero changes** to data computation, fetching, or transformation code — only the render layer swaps.
- Any reshaping the new chart needs happens inside the presentational chart component, never upstream. If that can't work, stop and ask.

## Form Safety (data-entry, logging, and selection controls)

1. Submission logic, validation logic, state hooks, and API calls are untouchable. Never add react-hook-form, zod, or the shadcn `form` component.
2. Native `<input>`/`<textarea>`: restyle via shadcn `Input`/`Textarea` (styled native elements — value/onChange/name/id/type carry over unchanged) or via classNames alone.
3. Radix-based controls (Select, Checkbox, RadioGroup, Switch) change the event contract (onChange(event) → onValueChange(value)). Swap to one ONLY when a one-line inline JSX adapter can call the EXISTING handler unchanged, and flag every such swap "CONTROL SWAP — verify behavior" in the diff summary. Otherwise keep the native element styled with Tailwind.
4. Keep native date/number input types. No calendar/date-picker components — changed value formats are a logic risk.
5. Preserve label/id/htmlFor associations, required/min/max/step, autocomplete, and inputMode.

## Workflow (all mandatory)

1. All work on the `ui-restyle` branch — never on main.
2. One component/screen at a time; finish it before starting the next.
3. Show the diff and **wait for explicit approval** before continuing.
4. One commit per approved screen.
5. Before a screen is "done": visual check at **390px** (mobile) and **1440px** (desktop), in **dark AND light** themes — all four must pass.
6. Never push, rebase, amend published history, or run destructive git commands (`reset --hard`, `checkout --`, `clean`) unless the owner or the current phase prompt explicitly instructs it for a named file.

## Styling Conventions

- Stack: **Tailwind CSS v4 + shadcn/ui**. v4 is CSS-first — config lives in the CSS entry (`@import "tailwindcss"`, `@theme`). Never create a `tailwind.config.js` or use `@tailwind` directives; those are stale v3 patterns.
- Reuse existing components in the `components/ui` folder first. Need one that isn't there? Add it via the CLI: `npx shadcn@latest add <name>` — never hand-roll a shadcn-style component.
- Theme via **CSS variable tokens only**: `bg-background`, `text-muted-foreground`, `border-border`, `var(--chart-1)`, etc. **No hardcoded hex** (or raw oklch) in components. New colors: define in `:root` + `.dark`, map in `@theme inline`.
- **Dark is the default theme**; light is available via the toggle (`.dark` class on `<html>`, ThemeProvider `defaultTheme="dark"`). Every change must look right in **both** themes.
- Charts: shadcn wrappers (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig`) from `@/components/ui/chart`; primitives imported from `recharts`. Give `ChartContainer` a height (`min-h-*` or `aspect-*`). Colors as `var(--chart-N)` — not the old `hsl(var(--chart-1))` wrapper.
- Paywall/pricing UI: placeholder prices, stubbed CTA. Do **not** wire Stripe or any real payments — explicitly out of scope.

## Escalation: Stop and Ask

If a requested change appears to require touching logic — state, an API call, a calculation, a data transformation, a backend file, or anything on the DO-NOT-TOUCH.md list — **STOP**. Do not proceed, do not work around it, do not "just quickly fix" it. Report the conflict and wait for a decision.

When unsure whether something counts as styling or logic: it's logic. Stop and ask.

---

# Part II — Cut Protocol standing knowledge (pre-restyle)

Part I above governs the UI restyle on the `ui-restyle` branch. Everything
below is the repo's accumulated standing ruleset and history — still binding
wherever it does not conflict with Part I.

**Reconciliation record (owner-approved 2026-08-04, Phase 1):**

1. **Design system** — the AURORA RINGLIGHT constitution below is SUPERSEDED
   on `ui-restyle` by the SIGNAL BLACK direction (shadcn semantic tokens in
   `frontend/src/index.css`). The safety-derived UX laws survive ANY visual
   direction (also recorded in DO-NOT-TOUCH.md): never red on food or body
   data (over-target = calm amber + supportive copy); the macro triad stays
   colorblind-distinguishable and always carries P/C/F letter labels; the
   Wellbeing entry and its support resources are never hidden or greyed out;
   progress indicators never fabricate percentages; `prefers-reduced-motion`
   support and the a11y utilities survive.
2. **Git** — standing rule 4's "push to GitHub (`origin master`)" is
   SUSPENDED on `ui-restyle`: never push; one commit per approved unit;
   Part I's workflow governs.
3. **Theming** — "single dark mode / light mode retired" is superseded: dark
   is the shipped default, light must keep working via the theme toggle.
4. **Fonts** — the never-a-CDN law STANDS. Phase 1 Step 6 self-hosts the
   direction fonts via @fontsource (`@fontsource/space-grotesk` + the
   already-installed Inter) as JS imports in `main.jsx`, instead of the
   restyle pack's Google Fonts `@import` line. Owner-approved deviation.
5. **Stack correction** — the restyle pack's canonical text described the
   backend as FastAPI (Python). The actual backend is Express 5 + Prisma 6
   (Node); Part I is corrected accordingly. The boundary is unchanged: the
   entire `backend/` tree is untouchable.
6. **Rule 8 (no hardcoded colors)** — the principle carries forward
   unchanged; on `ui-restyle` the token home migrates to the shadcn semantic
   tokens in `frontend/src/index.css` as screens are restyled. `lib/theme.js`
   keeps serving un-restyled legacy screens until they migrate.

# Cut Protocol — Project Rules

Desktop cutting/body-recomp app: TDEE engine, meal-plan solver, tracking.
Owner: Shad. This file is the standing ruleset for every session and every
phase of the staged overhaul (Phases 0–8, driven by an external prompt pack).

## Stack (verified 2026-07-18, Phase 0)

- **Shell:** Electron 43 (`electron/main.cjs`), packaged by electron-builder
  into a Windows NSIS installer under `release/`. App icon: `CutProtocol.ico`
  at repo root, wired in root `package.json > build.win.icon`.
- **Backend:** Express 5 + Prisma 6 on SQLite (`backend/prisma/dev.db`).
  JWT auth. Anthropic SDK for AI recipe generation, USDA FDC client for
  nutrition lookups. Business logic in `backend/src/lib/` (bmrEngine,
  weeklyPlanner solver, dietaryFilter, groceryList, …), routes in
  `backend/src/routes/`.
- **Frontend:** React 19 + Vite 8 + Tailwind 4 + Recharts in `frontend/`.
  Screens in `frontend/src/components/`. Single theme file:
  `frontend/src/lib/theme.js`.
- **Food/recipe seed data:** `backend/src/lib/portedFromRecomp/`
  (foodLibrary / recipeLibrary / fdcMacroCache) seeded into SQLite via
  `backend/scripts/`. Runtime data lives in the DB, not in code.
- **Commands:** backend dev `npm run dev` (in `backend/`) · frontend dev
  `npm run dev` (in `frontend/`) · desktop shell `npm start` (root) ·
  package installer `npm run dist` (root) · tests `npm test` (in `backend/`)
  · lint `npm run lint` (in `frontend/`).
- **CI:** GitHub Actions runs backend tests + frontend lint/build on push.
- **Packaging — the installer payload is an ALLOWLIST, never a denylist.**
  This is a standing rule, not a status note. Read it before touching
  `build.files` in the root `package.json`.

  The safe-share split IS wired: `extraResources` ships only
  `backend/prisma/dev.db.template` (a depersonalized seed DB), and `predist`
  runs `backend/scripts/buildTemplateDb.mjs && scripts/distPrecheck.mjs`
  before every `npm run dist`. Do NOT write that the installer "deliberately
  ships the real `.env` and `dev.db`" — it does not, and the earlier version
  of this section saying so sent sessions chasing a bug that was already
  fixed.

  **But the leak did not go away.** It moved. The historical `build.files`
  list excluded secrets and personal data **by name** — `!backend/.env`,
  `!backend/prisma/dev.db`, `!backend/prisma/dev.db.backup-*`,
  `!backend/prisma/*.db.backup*`. A denylist only blocks the names someone
  thought of. Two files created later slipped straight past it:
  - `backend/.env.qc` — not `.env`, not `.env.local`; matches no pattern.
  - `backend/prisma/dev.db.snapshot-agentcontam-20260721-212858` — a real
    3.2 MB user DB. `dev.db.backup-*` and `*.db.backup*` both miss it,
    because it is a *snapshot*, not a *backup*.

  That is the whole lesson: **a denylist over a directory that agents and
  scripts keep writing new files into is structurally unable to stay
  correct.** Every new `.env.<something>`, `.db.<something>`, dump, or
  scratch file defaults to SHIPPED. The fix is to invert it — enumerate the
  exact files and directories the app needs at runtime and ship nothing else,
  so an unrecognized new file defaults to EXCLUDED. That conversion is in
  progress; if `build.files` still reads as a list of `!` exclusions when you
  open it, the inversion is not finished and the payload is not trustworthy.
  Never add a new `!pattern` as the fix for a leak — that is re-committing
  the original error.

  Guards, which are checks and not the fix: `npm run dist:check` scans a
  built `release/` and FAILS on secrets or personal data; `npm run
  scan:secrets` scans tracked files (also a CI job). Neither auto-strips, and
  neither can vouch for a build it was not run against — see
  `security/scan-report.md`'s void header.

## Standing rules (every phase, every session)

1. **Desktop first.** This is a DESKTOP app. Every screen is designed for a
   full desktop window first. No phone-width centered columns, no bottom
   tab bars.
2. **One design system — AURORA RINGLIGHT (v2).** *[Superseded on
   `ui-restyle` — see Part II reconciliation record #1.]* Dark, athletic, calm:
   green-tinted near-black canvas, glass cards with gradient hairlines,
   subtle layered aurora ambience + film grain, Sora display type over
   Inter body, oversized tabular stat numbers. All color/spacing/type
   tokens live in `frontend/src/index.css` (mirrored by
   `frontend/src/lib/theme.js`); every screen consumes tokens. No one-off
   styles. The color laws below are CONSTITUTIONAL.
3. **Nothing user-specific hardcoded.** No hardcoded calories, allergies,
   names, weights, or personal defaults anywhere in app code. Everything
   flows from the user's Profile. The app must work for ANY user from first
   launch onward. (The user-#1 calibration fixture in tests is the one
   sanctioned exception — it is test data, never an app default.)
4. **Verify, then commit.** After every meaningful change: actually run the
   app and confirm the change works before moving on. At the end of every
   phase: commit with a clear message and push to GitHub (`origin master`).
   *[Push clause SUSPENDED on `ui-restyle` — never push; see reconciliation
   record #2.]*
5. **Nutrition sanity gate.** Every food/recipe entry must satisfy
   kcal ≈ 4×protein + 4×carbs + 9×fat within ~15%, or carry a documented
   exception. Water, black coffee, plain spices ≈ 0 kcal. Anything failing
   is flagged, never silently accepted.
6. **Parallel subagents welcome, never colliding.** Independent workstreams
   (e.g. one on UI, one on data) may run as parallel subagents — but never
   two agents editing the same files at once.
7. **Navigation order lives in code, not in this file.** The `NAV` array in
   `frontend/src/components/Sidebar.jsx` is the single source of truth. As of
   2026-07-24 it is Profile · Today · Plan · Recipes · Training · Trend ·
   Engine, with **Wellbeing landing below Trend**; Training is flag-gated
   (`frontend/src/lib/flags.js`: `"on" | "soon" | "hidden"`) and Foods is a
   child view of Recipes, never a top-level item. Compare ("How it compares")
   and the Wellbeing check are launched from the sidebar footer, not from
   NAV. The old "Profile/Today/Plan/Recipes/Trend/Engine" order quoted in the
   Phase 1 log below predates Training, Compare and Wellbeing — read the
   array, not the log.
8. **No hardcoded colors outside the theme tokens.** Every color comes from
   `frontend/src/index.css` (mirrored in `frontend/src/lib/theme.js`). A
   literal hex or `rgba()` in a component is a defect regardless of how close
   it looks to a token — near-duplicates are worse than obvious ones, because
   they survive a token change and silently drift. This is a RULE about what
   must be true, not a claim that it currently is: Phase 7's "zero hardcoded
   hexes confirmed" is stale, and violations have since reappeared (see the
   corrections block below). If you need a tint of an existing token, add a
   token — do not inline the rgba.
9. **`dietaryFilter.js` HAS NUL BYTES — grep calls it a binary and hides the
   lines.** `backend/src/lib/dietaryFilter.js` (~118 KB) carries 3 NUL bytes,
   so `file` reports it as `data` and both grep and ripgrep classify it as
   binary. A **match** then prints one opaque line — `Binary file
   dietaryFilter.js matches` — with **no line numbers and no content**, even
   when the term is present seven times. Skimming that as "nothing found"
   inverts the truth, and it has already cost one session ten minutes. Use
   `grep -a` / `rg --text` (both restore normal output), or the Read tool /
   Node, which are unaffected. Counts (`grep -c`) and genuine negatives are
   still correct — what you lose is the located line. Two riders:
   - The file is **CommonJS** (`module.exports = {` at the end). `grep
     "^export"` finding nothing there is CORRECT and is *not* a NUL artifact —
     the file contains no `export` statements. A Node import still reports 39
     names, because cjs-module-lexer reads the `module.exports` object. Do not
     go hunting NUL bytes to explain that one.
   - `scripts/scanSecrets.mjs:84` returns early on any file containing a NUL
     (`if (buf.includes(0)) return;`), so this file — the allergen and dietary
     filter, among the most safety-critical source in the repo — is
     **permanently exempt from the secret scan**, and
     `backend/tests/scanSecrets.test.js:50` asserts that skip is correct, so a
     passing suite defends the exemption. Verified 2026-08-01 on a copy: a
     key-shaped literal appended to the file yields 0 findings with the NULs
     intact and 1 with them stripped. Recorded, not fixed — do not rediscover
     it a third time.

## Design constitution — AURORA RINGLIGHT color laws *[superseded on `ui-restyle` by SIGNAL BLACK — safety laws b/c and reduced-motion survive; see Part II reconciliation record #1]*

From the design research (2026-07-18). These are laws, not preferences:

- **a) GREEN SCARCITY.** `--accent` #2FD576 (gradient tail `--accent-tail`
  #7EFFB2, gradients only) may ONLY mean: on-target, primary action,
  success, the hero ring, the trend line. Nowhere else — not selected
  states, not badges, not category dots, not active nav. Its power is
  everything around it staying quiet. Selection/active states are a
  LIGHTNESS step (`--card-2` + `--faint-light` border), never green.
- **b) NO RED, EVER, ON FOOD OR BODY DATA.** Red on food reads as moral
  judgment and makes beginners under-log and quit. Over target = calm
  amber `--warn` #E5A83B + supportive re-planning copy ("Over by 340 —
  tomorrow already adjusts"). The calorie ring LAPS past 100% Apple-style;
  it never turns red. `--red` exists solely for system errors and
  destructive confirms (delete buttons, crash screens, the allergen
  override warning).
- **c) FIXED MACRO TRIAD** (Okabe-Ito, colorblind-safe, non-green
  non-red): protein `--protein` #56B4E9 (blue), carbs `--carb` #E69F00
  (amber-orange), fat `--fat` #CC79A7 (pink-mauve). Used identically in
  every ring, bar, chip, chart, and solver card, ALWAYS with P/C/F letter
  labels. Zero exceptions app-wide — these three hues may never be
  borrowed for anything that isn't that macro.
- **Elevation is LIGHTNESS, never drop shadows.** Surface ladder: canvas
  `--paper` #0B0D0C → card `--card` #161A18 → nested/hover `--card-2`
  #1D2320, with 1px `--rule` rgba(255,255,255,0.06) hairlines, 16–20px
  radius. There is no shadow token; do not reintroduce one.
- **Text is one off-white at three opacity tiers** (87% / 60% / 38% —
  `--ink` / `--faint` / `--faint-light`). Tabular figures on every number
  that can change.
- **Type:** Sora 700/800 for headings + all hero numerals, Inter for
  body. Fonts are bundled locally (@fontsource) — never a CDN.
- **Ambience stays SUBTLE:** the layered slow-rotating aurora
  (transform-only), glass-card gradient hairline, and film grain are
  ambience, not spectacle. All motion freezes under
  `prefers-reduced-motion`.
- `docs/design/` holds exactly two things: `inspiration/` (the local-only
  scouting library) and `v2/` (shipped screenshots). **There is no design
  research report and no "final direction" HTML.** They were referenced by
  the original prompt pack but never landed on this machine, and the color
  laws above were written from the prompt spec + the inspiration library,
  Shad-approved. Do not go looking for those files and do not cite them —
  the laws in this section ARE the source of truth.

## Constitution (retained from the RECOMP master doc — still binding)

- Wrong math = product death. Displayed numbers can reveal their formula and
  inputs; engines are unit-tested before ship.
- Provenance on every food entry: USDA-VERIFIED (+FDC id) | LABEL |
  AI-ESTIMATED (always verify-prompted). Sources never silently mixed.
- Hard floors: never prescribe below max(RMR×0.95, 1500 kcal men / 1200
  women); user floors may be stricter. Floor blocks are shown, not hidden.
- Every automatic adjustment is logged, visible, and reversible.
- Data is never trapped: JSON+CSV export must always work.
- Solver declares "unsolvable + why" — silent target misses are forbidden.
- No engagement bait: no streak-shaming, no notification spam. Instrument,
  not slot machine.
- The user's observed data beats the model's prediction.

## Comms style

Blunt, data-first, no filler. Tables for numbers. Show the math when
challenged. Never suggest intake below the safety floor.

## Superseded claims in the phase log below — READ THIS FIRST (2026-07-24)

The phase tracker is an append-only **history**: each entry records what was
true on the day it was written. Several entries have since been overtaken by
reality, and sessions have been reading them as current law. The log stays as
written; these corrections override it.

| Claim in the log | Reality as of 2026-07-24 |
|---|---|
| Phase 2: "969→854 foods"; Phase 4: "exhaustive **854-name** food-table audit"; `security/scan-report.md`: "864 foods" | The library is **14,122 foods / 889 recipes**. Every count in the 800s is historical. Any rule, test, or audit described as sweeping "the 854-name food table" covers roughly 6% of today's corpus and must not be cited as exhaustive. |
| Phase 2: "Audit exits clean: 0 failures" | **470 food rows carry another food's macros verbatim** and say so in their own `dataQuality` string. They pass the Atwater check perfectly, because the numbers are real numbers — just the wrong food's. Atwater consistency is not a correctness warrant. See `docs/qc/integrity-sweep.md`'s void header. |
| Phase 1: nav order "Profile/Today/Plan/Recipes/Trend/Engine" | Predates Training, Compare and Wellbeing. See standing rule 7 — `Sidebar.jsx`'s `NAV` array is authoritative. |
| Phase 7: "zero hardcoded hexes confirmed outside theme tokens" | Was true then, is not now. Known live violations: `WellbeingCheck.jsx:95` (`#04150b`, an invented near-duplicate of `--accent-ink` #05130B) and `CompareDialog.jsx` (literal `rgba(47,213,118,0.05)`). Both are being fixed. Treat standing rule 8 as the law and re-verify rather than trusting this line. |
| Phase 9 / packaging notes: installer ships real `.env` + `dev.db` | False — see the Packaging section above. The real, current problem is that the payload is a **denylist**, and `backend/.env.qc` plus `dev.db.snapshot-agentcontam-*` slip past it. |
| `docs/design/` "research report + final direction HTML" | Never existed. See the design constitution above. |
| `backend/prisma/schema.prisma:2` — "one-line provider swap (`sqlite` → `postgresql`)" | Overstated, and echoed unqualified in `DEPLOY.md` and `roadmap/10-backend-readiness-and-testing.md`. The *schema* does avoid Postgres-only features, but **8 of the 25 migrations carry SQLite `PRAGMA foreign_keys` / `defer_foreign_keys` statements** for table-rebuild steps. Postgres rejects those, so the migration history would have to be squashed and regenerated against Postgres first. Budget that work; it is not one line. |

### Added 2026-08-08 — the theme default flipped, and two places still say otherwise

The table above is dated 2026-07-24. This correction is newer and overrides both
statements it names.

| Claim, still present above | Reality as of 2026-08-08 |
|---|---|
| Part I → Styling Conventions: "**Dark is the default theme**; light is available via the toggle … ThemeProvider `defaultTheme="dark"`" | **False since `5ae57f4`** ("migration(phase-4): ship warm paper as the default"), landed 2026-08-08. `frontend/src/App.jsx:452` reads `<ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">` — verified by reading the line, not inferred from the commit subject. |
| Part II → reconciliation record #3: "dark is the shipped default, light must keep working via the theme toggle" | Same. The *requirement* survives with its polarity swapped: **light** is now the shipped default and **dark** must keep working via the toggle. `storageKey` is unchanged, so a user who already chose a theme keeps it — only first-run changes. |

Both statements need the same one-word swap. Flagged, not rewritten: MISSION 1 item 2
says reconcile and flag, and silently editing a rules file is how a rules file stops
being trusted. Everything else in Part I's Styling Conventions still stands — both themes
must look right, which is unchanged by which one loads first.

## Overhaul phase tracker (append-only; newest last)

- 2026-07-18 · **Phase 0 complete.** Checkpoint commit + `backup/pre-overhaul`
  branch + `pre-overhaul` tag pushed to GitHub; repo flipped PRIVATE;
  `.claude/settings.json` permission config added; this rules file rewritten
  (old RECOMP master archived). Next: Phase 1 — desktop layout + dark theme.
- 2026-07-18 · **Phase 1 complete.** Dark-only athletic theme (tokens in
  `frontend/src/index.css`, accent #2FD576, CVD-validated macro trio; light
  mode retired). Collapsible left sidebar replaces bottom tab bar; nav order
  Profile/Today/Plan/Recipes/Trend/Engine; Foods demoted to child view of
  Recipes/Engine. New ProfileTab (inputs moved out of Engine) + 3-step
  first-run SetupWizard (fires when GET /profile is null). Today rebuilt as
  12-col dashboard (ring + macros + verdict + weigh-in + trend snapshot +
  log). All screens converted to desktop grids. Verified in Chrome at
  1568px: full tab walk on live account (read-only), complete wizard→
  dashboard→weigh-in flow on a throwaway account (`phase1.test@local`, kept
  in dev.db for future phase testing), zero console errors, oxlint + vite
  build clean. Sub-1280px stacking is Tailwind mobile-first default —
  re-verify visually in Phase 7 QA. Next: Phase 2 — food & recipe data
  integrity.
- 2026-07-18 · **Phase 2 complete.** Food library audited + repaired: 969→854
  foods (115 case/plural/synonym duplicates merged with recipe-ingredient
  re-pointing), 192 bad rows fixed (zero-kcal USDA Foundation records
  recomputed via fiber-adjusted Atwater; ~90 wrong-record matches corrected
  through curated `backend/data/foodOverrides.json` with per-entry provenance
  notes — Water 19kcal→0, Salt carried butter data, Eggs carried egg-white
  data, Porridge oats/Walnuts/Sardines/Avocado carried OIL records, Milk
  carried powder data). All foods recategorized to the 7 grocery-store
  categories; every recipe's cached macros recomputed from ingredients (616
  recipes total across both passes). Guardrails: shared validator
  (`foodValidation.js` — fiber-adjusted Atwater ±15%, high-fiber 30% band,
  name-shape rules incl. pure-fat-under-non-oil-name, documented exemptions
  for alcohol/acetic acid/carbonates), startup `[data-audit]` log, validated
  admin-only PUT /foods/:id that recomputes affected recipe caches, hardened
  ingredientResolver/usdaClient/seeder, 22 new CI-safe tests (79 total pass).
  Foods UX: collapsed category groups + search + detail card (edit,
  add-to-recipe; "Log today" disabled until a food diary exists — no such
  feature yet, deliberately not faked). Audit exits clean: 0 failures,
  0 dupes, 0 recipe drift. Next: Phase 3 — profile + TDEE engine.
- 2026-07-18 · **Phase 3 complete** (commit d9bbbf1). Profile + TDEE engine
  fully generic — last personal hardcodes purged (constants.js deleted;
  verdict bands/floors derive from profile). New profile model:
  occupationKey (36-occupation searchable table + manual override),
  trainingStyle/minutesPerSession (additive MET-based kcal), rateLbPerWeek
  menu, stricter-only floorKcal over 1500M/1200F, excludedFormulas,
  unitPref wired app-wide. BMR = mean of applicable formulas (KM/Cunningham
  unlock with BF%, exclude toggles, spread); TDEE = BMR × occupation +
  training kcal/day. targetKcal DERIVED server-side (TDEE − rate×500,
  floor-clamped, re-materialized on profile/weigh-in changes); unsafe rates
  422 until explicit rateAcknowledged. 9 dietary styles, 10 allergy
  checkboxes (peanuts ≠ tree nuts), GET /recipes hard-filters with visible
  hiddenCount. 4-step wizard. Admin floor 2000 preserved as row data.
  Verified via verifyPhase3.mjs (3 fake users) + full browser walk; 94
  tests green. Next: Phase 4 — the meal-plan solver.
- 2026-07-18 · **Phase 4 complete.** Meal solver: 3+ scored complete-day
  candidates (honest match % — 0.55 kcal / 0.30 protein-shortfall / 0.075
  fat+carb range weights), best-of-3 scored week generation, portion scaling
  clamped to the spec's 0.5–2× with 5 g practical rounding, variety cap 2×/
  week (4× with batch-cooking opt-in), soft biases (8-cuisine classifier
  backfilled onto 608 imports, protein preference, CAD budget tiers) over
  hard filters (diet/allergies/max-prep), 3-alternate swap with
  server-rebuilt compliance-checked apply, accept-day → week plan → Today
  dashboard, grocery list with practical purchase units (packs/cans/pieces,
  grams as ground truth) + persisted checkboxes. Honesty layer:
  result-driven diagnosis (never silent, never suggests loosening
  allergies) whenever a week lands <6/7 days or candidates are rough.
  **Safety find:** live verification caught fish/meat reaching a vegan
  account — dietaryFilter's style matching was exact-word (plural species
  names like "Prawns"/"Sardines"/"Pilchards" passed) and the species list
  was thin. Fixed: plural-aware matching + exhaustive 854-name food-table
  audit closing every gap (cheese varieties, barramundi, dulce de leche,
  curry pastes, etc.), locked by regression tests. Real-pool verification:
  1–15 ms week solves, 7/7 days for omnivore/keto/halal, diagnosed
  closest-fit for the genuinely thin vegan (51 recipes) and vegetarian
  pools, zero leaks across ~1,000 shipped ingredients. 110 tests green.
  Known cosmetic quirk: grocery SECTION classifier files "Butter Beans"
  under Dairy (name-keyword artifact; Phase 7 polish). Next: Phase 5 —
  recipes, cart, importer.
- 2026-07-18 · **Phase 5 complete.** Recipe library rebuilt as grouped
  browse — cuisine / meal-type / primary-protein groups (display taxonomy
  from ingredient keywords), search, sort by name / kcal / protein density
  (g P per 100 kcal shown per row) — no more endless scroll. Expandable
  detail view: ×0.5–×2 serving scale with live macros+grams, add-to-plan-
  slot picker (new POST /plans/place-recipe — server re-validates pool
  membership, 409s locked slots, clamps scale 0.5–2), cart toggle, inline
  edit, confirmed delete. Cart card: macro totals, one-click grocery list,
  and POST /plans/fill-today-from-cart (scales each cart recipe to today's
  slot targets via scaleRecipe, skips locked slots, honest skipped/leftover
  note). AI generation kept but hardened: every draft passes the Phase 2
  food validator before save (422 names offenders incl. zero-macro
  placeholders), cuisine auto-classified, source tagged — AI (green) /
  IMPORTED (blue) badges; allergen override rebuilt as a loud red
  per-generation checkbox that auto-resets after every generation. New URL
  importer (`backend/src/lib/recipeImporter.js`): fetch → schema.org/Recipe
  JSON-LD (@graph walk, HowToStep, ISO-8601 durations) → ingredient-line
  parser (unicode fractions, ranges→midpoint, weight units exact, volume
  via density table with `estimated` flags, piece weights, honest null when
  unconvertible) → resolveIngredient match to the validated food DB →
  per-serving grams → review DraftCard (amber importNotes, editable grams,
  red placeholder warnings) → validated save tagged `imported`. Provider
  seam (`PROVIDERS` array) structured for Spoonacular/Edamam later; NO paid
  API integrated; USDA stays nutrition truth. Verified live in Chrome on
  the vegan test account: real BudgetBytes import end-to-end (404 error
  path also exercised honestly), density sort, ×2 placement confirmed in
  Plan tab (fill-from-cart later re-scaled that unlocked slot, as
  designed), cart fill-today, loud allergen box, 578 recipes hidden
  honestly, protein grouping (Plant protein 19 / Other 33 — meat groups
  correctly absent for vegan). 119 backend tests green (9 new importer),
  oxlint + vite build clean. Known cosmetics: cuisine classifier misses
  "Curried" (keys on "curry"; row editable), unit-after-name piece lines
  ("2 garlic cloves", "2 15 oz. cans") fall to honest set-manually notes
  rather than guessed grams. Browser-automation lesson: setting a React
  input via scripted DOM setter leaves component state stale — the UI looks
  cleared but filters don't reset; always drive React inputs with real key
  events. Next: Phase 6 — app icon.
- 2026-07-18 · **Phase 6 complete.** New brand mark: shield badge with a
  geometric six-pack grid (2×3 rounded blocks, bottom row tapered into the
  shield's point), athletic green #2FD576 on charcoal #131715 — both theme
  tokens. Two SVG masters in `assets/icon/`: `cutprotocol-outline.svg`
  (green outline shield + green blocks, used ≥48px) and
  `cutprotocol-solid.svg` (inverted: solid green shield, dark carved
  blocks, wider gaps sized so every separation ≥1px at 16px — used ≤32px).
  All four spec sizes rendered and approved by Shad before applying
  (16px taskbar legibility confirmed on dark AND light taskbar sims).
  Applied: `CutProtocol.ico` regenerated (256/64/48 outline + 32/24/16
  solid; directory entries parse-verified) — filename unchanged so
  electron/main.cjs and build.win.icon needed no edits; PNG set in
  `assets/icon/png/`; `frontend/public/favicon.svg` (link in index.html
  was dangling scaffold — now real); index.html title "cut-protocol" →
  "Cut Protocol"; new `ui/CutMark.jsx` (bare solid shield on theme tokens)
  replaces the TrendingDown-in-green-tile mark in Sidebar, LoginScreen,
  and SetupWizard; README gets the icon + a branding section. Verified:
  oxlint + vite build clean, Electron dev boot clean, `npm run dist` exit
  0, and the icon EXTRACTED from both the built `Cut Protocol.exe` and the
  NSIS installer visually confirmed as the new shield (ExtractAssociatedIcon
  → PNG → eyeball). Sidebar mark zoom-checked crisp in Chrome. Icon build
  tooling (sharp + png-to-ico) lives in the session scratchpad, NOT the
  repo — rebuilding the .ico needs those two packages against the SVG
  masters. Next: Phase 7 — polish/QA.
- 2026-07-18 · **Phase 7 complete.** Professional-polish sweep. CONSISTENCY: terminology
  unified on "meal plan" (PlanTab buttons/copy), dead light-mode theme
  script removed from index.html (`.dark` class had no consumers), zero
  hardcoded hexes confirmed outside theme tokens, login's narrow card is
  intentional. EMPTY STATES: shared `EmptyNote` component; Today + Trend
  charts get a "First point logged — curve starts with your second
  weigh-in" state instead of a floating single dot (0-entry states
  already existed). ERROR STATES: shared `ErrorNote` panel (icon + what
  happened + what to DO); applied to PlanTab (top + slot), ProfileTab,
  FoodsTab (names the Atwater rule), RecipesTab (import hint);
  solver slot warnings now carry "→ Fix it with the swap button…" action
  line; App-level refresh banner copy explains recovery. DATA FIXES:
  grocery store-section classifier — fresh peppers (bell/jalapeño/…) now
  produce not spices, dairy words with plant/legume qualifiers (Butter
  Beans, Peanut Butter, Almond Milk) now veto dairy, "buttermilk" added
  as real dairy (was silently "other"); cuisine classifier learned
  "curried"; 18 legacy occasion-tag cuisines (weeknight/steakhouse/
  breakfast/weekend) reclassified through the real classifier; the
  imported Curried Chickpeas re-tagged indian. Tests updated: the two
  "known limitation" tests now assert the fixes (120 green). QA SCRIPT:
  fresh user qa7.test@local ran the whole journey in Chrome — wizard
  (4 steps, lb/in, carpenter ×1.45) → Engine math verified (BMR 2,050 avg
  of 4, TDEE 3,134, target 2,384 floor-clamped) → generate meal plan
  (instant; day 2,396 vs 2,384) → swap flagged slot via 3 alternates
  (warning cleared, server rebuilt) → grocery list (Bell peppers under
  PRODUCE proves fix live) → weigh-in via UI + 7 backdated fixture points
  via API → Trend (curve, rate 2.4 lb/wk, goal date Oct 4 2026, target
  re-derived 2,384→2,399 from moving average). SPEED: tab switches
  render sub-second, week solve ms-level, no fixes needed (CDP screenshot
  stalls are the automation harness, not the app). README: rewritten
  feature list (fixed wrong "median" claim — engine takes the MEAN),
  accurate importer/solver/derived-target descriptions, 5 fresh
  screenshots from the QA account. Known punch list → next session:
  Vite chunk >500 kB (code-split someday; local desktop app so cosmetic),
  protein/mealtype group taxonomy is display-keyword based (fine), no
  food diary yet (Today shows planned, honestly labeled), Est. total on
  grocery hides when coverage low (by design). Next: Phase 8 (optional
  training scaffold) or backlog.
- 2026-07-18 · **Phase 8 complete — the staged overhaul is DONE (0–8).**
  Training scaffold, deliberately v1 and deliberately separate from the
  meal engine (own Prisma models, own `src/lib/training/` + route file;
  zero imports across the boundary). Data model: TrainingPlan →
  TrainingWeek → TrainingSession → TrainingExercise (sets / reps-as-string
  for ranges+time / nullable RPE / rest), cascade deletes, one active plan
  per user (regenerate replaces transactionally). Migration
  `20260718203518_training_scaffold`. v1 generator (`generator.js`, pure
  functions): four templates (2-day + 3-day full body, 4-day upper/lower,
  3-day conditioning circuits) matched from inputs — conditioning style
  overrides, otherwise days pick the split, >4 days told honestly "walk,
  don't add junk volume"; equipment tiers resolve exercise variants
  (barbell > dumbbells > bands > bodyweight; full-gym implies all);
  style×experience prescription tables (strength 4-6 @RPE7-8,
  hypertrophy 8-12, general 8-10, conditioning timed circuits w/ null
  RPE); session length trims accessories never mains; 4 weeks with honest
  double-progression notes, not fake periodization. Routes:
  GET /api/training(+/meta), POST /generate (422 w/ reasons), DELETE.
  UI: `flags.js` — TRAINING = "on" | "soon" | "hidden" (soon = greyed
  SOON-chip nav item; hidden = gone; App falls back to Today if the flag
  flips while the tab is active); TrainingTab = functional inputs
  (days/length/style/experience/equipment pills) + V1 TEMPLATES badge +
  week-chip plan view with per-session exercise tables. Verified live on
  qa7: generated 3-Day Full Body (beginner hypertrophy: mains 3×8-12
  @RPE7, barbell variants from full-gym), flag toggled to "soon" and back
  with HMR — both states confirmed in the sidebar. 130 tests green
  (10 new generator tests incl. equipment-floor and trim-never-mains
  guards), oxlint + vite build clean.
- 2026-07-18 · **Phase 9 complete — repo PUBLIC.** Final pre-public audit
  (18 commits, full history): JWT/Anthropic/USDA key values, seed
  email+password, any sk-ant pattern, .env, dev.db, personal docs
  (AUDIT/PABLO/RECOMP archive), test passwords — all confirmed never
  committed. Two notes: old constants.js (history-only, deleted Phase 3)
  is self-labeled demo data naming nobody; roadmap/00-synthesis.md row 21
  leaked the Windows username + an off-repo personal file path — reworded
  in tree AND scrubbed from all history via git-filter-repo replace-text
  (Shad chose rewrite-then-flip; SHAs changed, force-pushed all refs).
  Showcase: README rewritten as a work-in-progress project page (problem →
  what it does → status: works today / rough / ideas-not-promises → 4
  fresh 1568px screenshots incl. Training → plain-language engine
  explainer → tech stack → about note: construction by day, built with AI
  dev tools, not medical advice → rights notice). docs/linkedin-kit.md:
  Projects entry, About line, understated "what I've been working on" post
  (no launch language, 3 hashtags), Featured caption.
  assets/social-preview.png (1280×640, shield + wordmark — upload manually
  at Settings→Social preview; API can't set it). Repo description +
  11 topics set via gh. Profile README repo AlbertanCoder/AlbertanCoder
  created + pushed (construction by day / builds at night / Cut Protocol
  link); profile PIN is manual (Customize your pins — API has no
  mutation). Visibility flipped to PUBLIC via gh after Shad's confirm.
  THE 9-PHASE OVERHAUL IS COMPLETE.

- 2026-07-18 · **Design v2 (1/3) complete — AURORA RINGLIGHT foundation.**
  Tokens rewritten in `index.css`/`theme.js`: surface ladder #0B0D0C →
  #161A18 → #1D2320 with rgba hairlines, one off-white ink at 87/60/38%
  opacity tiers, accent + #7EFFB2 gradient tail, calm amber #E5A83B,
  Okabe-Ito macro triad (protein BLUE #56B4E9 / carbs AMBER #E69F00 /
  fat PINK #CC79A7 — a full swap from v1's green-teal/blue/orange),
  `--shadow` deleted (elevation = lightness only). Sora 700/800 +
  Inter bundled locally via @fontsource (JS imports in main.jsx — CSS
  @import loses woff2 resolution through the Tailwind PostCSS pipe).
  Ambience: 2-blob transform-only aurora + static SVG grain + glass-card
  gradient-hairline Card; all frozen under prefers-reduced-motion.
  Chassis: new slim HeaderBar (Day/Target moved out of Sidebar footer),
  sidebar 240px de-greened active state, Skeleton/SkeletonCard/
  SkeletonRows replace every "Loading…" + the one spinner, hover-revealed
  row actions (lock stays visible — it's state), desktop arrow-cursor
  convention, PlanTab real 7-column week board at ≥xl (compact picker
  below) with ←/→ day navigation. Color-law sweep: verdict "bad" → amber,
  goal ReferenceLines de-redded, Ring laps past 100% (never red, number
  goes amber) + breathing glow + accent→tail gradient, over-target coach
  line on Today, MacroBar letter badges, P/F/C legend on Engine strip,
  AI/IMPORTED badges + category dots + all selected-state pills/toggles
  de-greened (selection = lightness step). CAVEAT: the two reference
  files (research report + final-direction HTML) never landed on this
  machine — foundation built from the prompt spec + the inspiration
  library, Shad-approved; drop them in `docs/design/` when found.
  Verified: oxlint + vite build clean, read-only Chrome walk on the live
  session (arrow keys, hover reveal, board confirmed), scripted
  puppeteer walk on throwaway design-qa@local (wizard→API setup→all 8
  tabs, zero console/page errors), 12 screenshots at 1920×1080 + 1100×720
  in `docs/design/v2/01-foundation/`. Known notes: header shows the
  section name while PageHead repeats it (reconcile in prompt 2);
  optimistic-UI pattern only on cheap toggles so far; Sora tabular
  figures asserted via font-feature-settings "tnum" — verify alignment
  when real changing numbers run. Next: Design v2 (2/3) — per-screen
  content redesign.

## Archive

The full RECOMP Master Build Prompt v2.0 — including the user-#1 calibration
fixture, which contains personal data — is preserved locally in
`CLAUDE_RECOMP_ARCHIVE.md` (gitignored on purpose; personal data stays out
of the repo even though it is private). `AUDIT.md` and `PABLO_REVIEW.md`
are likewise local-only.

The **2026-07-29 systems audit** (10 stages, 169 findings) lives at
`docs/audit/systems-2026-07-29/` — 41 files, gitignored, start at
`00-EXECUTIVE-SUMMARY.md`; `01-FINDINGS.md` is the 250 KB main body.
It is recorded here because it spent three days existing in exactly ONE
place — untracked, inside a throwaway clone at `Desktop/cut-protocol-audit`
that was queued for deletion — and nothing in the repo mentioned it.
Rescued into the live tree 2026-08-02.

Two caveats travel with it, both from its own stage-9 self-audit: check
whether a number was machine-measured or model arithmetic before quoting it
(corrections are marked in place with `CORRECTED BY STAGE 9` / `!!`), and
treat it as evidence about the ~28% of tracked files it actually names and
silent about the rest. Known-live and unfixed from it: `docs/DISCLAIMER.md`
is not in the installer allowlist so it never ships, and the API keys it
names still want rotating.
