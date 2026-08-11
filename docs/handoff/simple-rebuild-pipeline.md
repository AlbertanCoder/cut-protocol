# The simple-rebuild pipeline

Built 2026-08-11. Where the restyle gets built, how to run it, and the four
things that were broken when it was first booted.

Branch `simple-rebuild`, cut from `recipe-brain` at `983accc`.
Worktree `.claude/worktrees/ux-simplify` — the directory is reused; the branch
it used to hold (`ux/simplify-2026-08`) is untouched and still exists.

---

## Why this worktree and not a new one

It was already provisioned and proven: real `node_modules` in all three
locations (root, backend, frontend), its own 22 MB `dev.db`, and an absolute
`DATABASE_URL`. A fresh worktree means a ~1 GB install and re-earning the
isolation guarantee. The branch it was carrying was dead — five harness commits,
190 behind trunk, and the UX review it existed to apply is already on trunk.

`git worktree list` still shows four. Nothing was pruned.

---

## Ports and isolation

| | Main checkout | This worktree |
|---|---|---|
| Backend | `:3001` — **the owner's live app, never touch it** | `127.0.0.1:3003` |
| Frontend | `localhost:5173` | `127.0.0.1:5176` |
| Database | `backend/prisma/dev.db` — real personal data | its own copy |

`127.0.0.1` not `localhost` is deliberate: cookies key on host and ignore port,
so both can be signed in at once without killing each other's session.

**Isolation is verified, not assumed.** `backend/.env` here carries an absolute
`DATABASE_URL` pointing inside the worktree, and the main `dev.db` sha was taken
before and after this whole session:

```
4d2c1efa3cb282392776ec21c0cfa14d  (unchanged)
```

---

## Run it

Backend:

```
cd C:\Users\SHADHUNTER\Desktop\cut-protocol\.claude\worktrees\ux-simplify\backend
```

```
node server.js
```

Frontend, in a second terminal:

```
cd C:\Users\SHADHUNTER\Desktop\cut-protocol\.claude\worktrees\ux-simplify\frontend
```

```
npx vite --config vite.worktree.config.js --port 5176 --strictPort false
```

Then open `http://127.0.0.1:5176/`. To see the simple surface, in the browser
console:

```
localStorage.setItem("shadcut:uiMode","simple"); location.reload()
```

To go back:

```
localStorage.setItem("shadcut:uiMode","full"); location.reload()
```

Test account on this worktree's DB only — `simple.qa@local` / `QaPipeline!2026`.

---

## Four things that were broken on first boot

All four were invisible to `npm run build`, which is why the gates were green
while the app could not start.

1. **`vite.worktree.config.js` had no `@` alias.** Written before shadcn landed.
   `Failed to resolve import "@/components/theme-provider" from "src/App.jsx"` —
   the app could not boot at all here. Fixed.
2. **It also had no `tailwindcss()` plugin.** Had the alias resolved, every
   screen would have rendered unstyled. Fixed.
   Both are now mirrored from `frontend/vite.config.js`. **That file is a copy
   and copies rot** — if the main config gains a plugin, this one must follow.
   Only `server` should ever differ.
3. **`frontend/node_modules` predated Tailwind v4.** `@tailwindcss/vite` was in
   `package.json` and not on disk. `npm install` in `frontend/` and `backend/`.
4. **`dev.db` predated the saas-launch migrations** — no `supabaseUserId`
   column, so every write threw. `npx prisma migrate deploy` applied 1 pending
   migration. **Stop the backend first** or SQLite answers `database is locked`.

`vite.worktree.config.js` stays **untracked**, the same treatment
`DO-NOT-TOUCH.md` gives `vite.qa2.config.js`. It is a harness, not product.

---

## What was verified live

The six-question flow, end to end, against a real server — the thing that had
never been run:

| Step | Result |
|---|---|
| `GET /profile` on a fresh account | `null` → the six questions fire |
| `PUT /profile` with `buildPatch()`'s exact payload | `422 requiresAck, ack:"rate"` |
| the 422 handler | routes to the review screen and shows the confirm box |
| resend with `rateAcknowledged` | profile created, `targetKcal 1849` (floor-clamped) |
| `GET /plans/current` · `GET /diary/:date` | 200 · 200 |
| `GET /weighins` · `POST /weighins` | 200 · 200 |

Every module also transforms through Vite with a real 200 and a real byte count.

**Still not done: no human has clicked through it.** The Chrome extension was
not connected this session. Everything above is HTTP-level. A browser walk at
390px and 1440px, in both themes, is the remaining gate.

---

## Order of work

Rooms share the primitives in `frontend/src/simple/parts.jsx`, so **the first
lane cannot be parallel** — two agents editing that file is exactly what
standing rule 6 forbids. Sequence, then fan out:

1. **Extend `parts.jsx`** into a full vocabulary — list rows, tabs, tables,
   search, sheets. One lane, no parallelism.
2. **Food › Plan** (37 caps), then **Recipes** (36), then **Shopping**. These
   *can* be parallel lanes once step 1 lands, since they touch separate files.
3. **You › Your details** (28 + 4 body-fat picker).
4. Progress, Engine, Training, Wellbeing, Coach — after the tester window.

Parallel lanes need one worktree each, and each needs **its own real
`node_modules` or an absolute `DATABASE_URL`** — a junction silently shares the
main database. That has already cost this project one incident.

---

## Before any session touches the repo

`CP_ROLE=builder` must be set **by the hand that launches the terminal** — it
cannot be set from inside a session, and without it `guard-edit.js` refuses
every write regardless of the manifest. Launch Claude **from the project
directory**, not from the home dir, or none of the project settings or hooks
load at all.
