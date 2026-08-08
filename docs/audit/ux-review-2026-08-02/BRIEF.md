# Cut Protocol — UX simplification review: shared brief

You are one of ten reviewers looking at the SAME running app from a DIFFERENT angle.
Read this whole brief before you touch anything.

## The app

Cut Protocol is a desktop cutting / body-recomposition app. Electron shell around an
Express + Prisma + SQLite backend and a React + Tailwind frontend.

- **Running frontend (Vite dev server): http://localhost:5173/**
- Backend API: http://localhost:3001 (this is the REAL dev database — treat as read-mostly)
- Throwaway API clone: http://127.0.0.1:3002 (a COPY of the database, no frontend attached).
  Safe for destructive API probing with `curl`. Nothing you do here affects the browser app.
- Repo on disk: `<local>/cut-protocol/`
  - Frontend components: `frontend/src/components/*.jsx`, entry `frontend/src/App.jsx`
  - Backend routes: `backend/src/routes/*.js`
  - Project rules and design laws: `CLAUDE.md` at the repo root

## Who this is actually for

One user: Shad. He is the app's sole user and its author. He is cutting (fat loss).
He is a numbers person — he *likes* seeing the underlying math — but he told us in an
interview that his single biggest complaint is **"too much jargon / busy" at the front door.**
The resolution he chose: keep the full math visible in the **Engine** tab, but de-jargon
**Today** and every default surface. He lives in **Today**. He wants **Training** improved,
not hidden. He wants a lightweight "ate as planned" toggle, not food-by-food logging.

## The brief, in one line

**Find what to cut, merge, rename, reorder, or default — so the app is simpler and easier
to use.** Removal and consolidation beat addition. A finding that adds a feature had
better be replacing two.

## Ground rules — read these, they matter

1. **You share ONE browser session with nine other reviewers.** The app is already logged
   in as `design-qa@local`.
   - **NEVER click "Log out".** It signs out every other reviewer.
   - **NEVER change the password, delete the account, or delete recipes/foods.**
   - Other reviewers are clicking at the same time. State may shift under you between
     screenshots (a plan may regenerate, a diary entry may appear). That is expected —
     do not report it as a bug, just re-read the screen.
2. **Get your own tab.** Call `tabs_context_mcp` once, then `tabs_create_mcp` to get a tab
   ID that is yours. Navigate it to `http://localhost:5173/`. Use only that tab ID.
   Do not act on tabs you did not create.
3. **Do not trigger `alert()`/`confirm()` dialogs.** A native modal freezes the whole
   extension for everyone. If a control looks like it confirms a destructive action, read
   the code instead of clicking it.
4. **Actually use the app.** Screenshot, scroll, hover, open the dialogs, tab through with
   the keyboard, resize the window. Reading source code alone is not this job — but do read
   the source to confirm what you think you saw, and to cite it.
5. Do not modify repo files. You are reviewing, not fixing. The only file you write is your
   own report.

## Browser budget — the failure mode that already bit us

A previous run of this exact review lost a reviewer: it hung on a screenshot call and was
killed at 600 seconds having written **nothing**. Nine other agents were competing for the
same Chrome extension. Protect yourself:

- **Budget ~25 browser tool calls.** Prefer `get_page_text` and `find` over screenshots.
  Screenshot only when the *visual* is the point (layout, density, something that looks
  broken). Never screenshot the same state twice.
- **Do the code and API work FIRST**, then use the browser to confirm what you concluded.
  `curl` never contends — lean on it hard.
- **Create your report file EARLY and append to it as you go.** A partial report on disk
  beats a perfect report you never got to write.
- **Never retry a hung call more than once.** Drop that thread, write "could not verify on
  screen" in the report, and move on to the next thing.
- `tabs_create_mcp` fails inside `browser_batch` — call it standalone.

If your lens has a priority order, do the top items first. Assume you may be cut off.

## Evidence standard

Shad has been burned before by reports that inflate a problem to sound impressive. Every
finding must survive this test:

- **Show it.** Either a specific thing you saw on screen (say which screen, which control,
  what it said) or a `file.jsx:line` citation. Both is better.
- **Say the cost in his terms.** "Three clicks to do X" / "the word Y appears before it is
  ever defined" / "this card is 400px tall and shows one number." Not "suboptimal UX."
- **If you are guessing, mark it a guess.** A hunch labelled as a hunch is useful. A hunch
  dressed as a finding is not.
- **Report what is already good, too.** If a screen is genuinely clean, say so and move on.
  We need to know what NOT to touch as much as what to change.

## Your report

Write ONE markdown file to the path given in your task prompt. Structure:

```markdown
# <NN> — <your lens>

## Verdict
2-4 sentences. Is this area simple already, or is it the problem? Where's the worst of it?

## What's already working
Bullets. Things that should survive any redesign, and why.

## Findings
For each, in descending order of how much friction it removes:

### F<n>. <short imperative title, e.g. "Merge the two protein rows into one">
- **Saw:** <concrete observation + screen/control, and/or file.jsx:line>
- **Costs:** <the friction, in concrete terms>
- **Do:** <the specific change. Name the file if you know it.>
- **Size:** trivial / small / medium / large
- **Confidence:** high / medium / hunch

## Cut list
Anything on this screen you believe should simply be DELETED, with one line of why.

## Open questions for Shad
Only things you genuinely could not resolve by looking.
```

Aim for depth over breadth: 5-12 real findings beats 30 nitpicks. Rank them honestly —
if your area only yielded two things worth doing, submit two.
