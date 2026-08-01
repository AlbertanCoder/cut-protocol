# Harness incident — the false cross-account leak, and how it was caught

**This is a defect in MY fleet, not in Cut Protocol.** It is written up in full
because it nearly became the headline of the night, and because the owner needs
to know exactly which pieces of evidence it touched.

## What the agent reported

The first Phase-4 deep-dive agent (persona **p005** — F, 76, keto, walls
`eggs` + `pork`) returned a card scoring the app **1/10** with
`allergenRespect.ok = false` and six pork leaks, plus:

- keto ignored — 75–147 g carbs/day
- `targetKcal` 1263 while being served 2,219–2,523 kcal
- 7 snack slots when the profile says `snacksPerDay: 0`
- and, buried in its defect list, this:

> *"The plan handed to me under my own login carries a different userId than my
> profile does."*
> `GET /api/profile` → `cms6wyfdn0004wlpc3vmj7hth`
> `GET /api/plans/current` → `cms6wyf0c0003wlpc5575p8a7`

Taken at face value that is a cross-account data leak — one customer served
another customer's meal plan — which would have been the single worst finding of
the campaign and the headline of the report.

## What was actually true

Direct queries against raw rows, by user id:

| | p005 | p004 |
|---|---|---|
| user id | `cms6wyfdn0004wlpc3vmj7hth` | `cms6wyf0c0003wlpc5575p8a7` |
| sex / age | F / 76 | F / 74 |
| `mealsPerDay` / `snacksPerDay` | 3 / **0** | 3 / **1** |
| `dietaryStyle` | **keto** | **none** |
| `targetKcal` | **1263** | **2221** |
| `excludedFoods` | `eggs, pork` | `dairy, eggs, gluten, soy` |
| plan slots | 21 | **28** |
| snack slots | **0** | **7** |

The second id is **persona p004's account**. Every single symptom the agent
reported maps onto p004's plan and not its own: 7 snack slots, ~2,221 kcal days,
no keto rule, and no pork wall — so pork was never a violation on that plan at
all. p005's own plan carries **zero** snack slots, exactly as its profile asks.

Two agents (p005 and p004) ran **concurrently in the same working directory**,
and my persona sheet told them to hold the session with `curl -c jar -b jar` — a
**relative** filename. That is one shared file. p004's agent logged in between
two of p005's agent's requests and overwrote it, so p005's agent read its profile
as itself and then read the plan as p004.

Corroborating checks:

- Independently, across all 250 fleet accounts: **0 of 250** profiles carry a
  `targetKcal` below the sex floor (`SAFE_FLOOR` M 1500 / F 1200), and **0 of 58**
  personas who asked for zero snacks have a single snack slot. Both of the
  agent's structural claims are refuted at fleet scale.
- `GET /api/plans/current` looks up on the compound unique key
  `userId_startDate` with `req.userId`. It has no path by which it could return
  another user's row. The session was crossed on the client, not the server.

**There is no cross-account leak in Cut Protocol.** The app's session handling
was never implicated; my cookie handling was.

## Blast radius, measured

| persona | plan state | verdict |
|---|---|---|
| **p004** | 28 slots / 7 days — was a **1-day** request in Phase 2, overwritten to a full week when the crossed p005 agent called `POST /plans/generate {"horizon":"week"}` while holding p004's session | **plan MUTATED**; card confounded → quarantined + re-run |
| **p005** | 21 slots / 7 days, 2 filled — its original Phase-2 plan, untouched | **plan intact**, only misread → card quarantined + re-run |
| **p019** | 5 slots / 1 day, matches its own `3 meals + 2 snacks` | **clean**, ran alone against its own data → card kept |

Nothing else is affected:

- **Phase 2 (all 250 personas) is untouched.** It never used a cookie file — it
  holds an in-process `Jar` object per persona, and every grade was re-derived by
  querying the database *by user id*, not by session. The pork/beef leak finding,
  the 40.8 % macro-compliance figure and the $0.00 verification all stand on that
  evidence and none of it passes through a cookie.
- **Phase 3 (brain cohort) is untouched** — same in-process jar, run serially.
- The one mutated plan (p004) changed *after* its Phase-2 row was written and
  captured, so `results.jsonl` and `raw/p004.json` still hold the original
  1-day plan.

## The fix

The persona sheet now mandates an **absolute, per-persona jar path**
(`cards/jar-<id>.txt`), forbids relative jar names in as many words, explains
why, and adds a **mandatory self-check**: right after logging in, compare the
`userId` on `GET /api/profile` against the one on `GET /api/plans/current` and
report `sessionCrossed: true` and stop if they differ. Sheets were regenerated
and the two affected agents re-run.

## Why this is in the report

Two reasons.

1. **The owner should be able to trust the leak count.** A campaign that reports
   "0 clinical-allergen leaks" has to be able to say how it would have known if
   it were wrong — and here it was wrong once, in the alarming direction, and the
   verification caught it before it reached the report. The pork/beef leaks that
   *did* survive verification came from the automated fleet, by direct DB query,
   with the offending ingredient row named.

2. **It is a live warning about agent-driven testing.** An agent given a
   plausible-but-shared credential store will produce a confident, richly
   evidenced, entirely wrong safety report. Every quoted string in that card was
   real; only the account it came from was wrong. Any future fleet must isolate
   credentials per agent and assert session identity before grading.

## Addendum — the same collision tried again, and the fix caught it twice

After the jar-isolation fix, **two later agents independently hit the same class of
collision in a different file** — not the cookie jar, but a *scratch* file they had
written their fetched plan into under a shared relative name. Both caught it
themselves, because the sheet now told them what the symptom looks like and gave
them a self-check:

> *"Mid-session a re-read of my own temp file returned a 5-slot plan full of cottage
> cheese, eggs, Greek yogurt and Swiss cheese — every one of my walls, on my
> account. It looked like a textbook data leak. It was not: my scratch file had been
> clobbered by a neighbouring process. A clean re-fetch showed
> `plan.userId == profile.userId` and my real 3-slot plan. The cookie jar was never
> crossed. `sessionCrossed` is false. Anyone reading a dairy/egg leak for p084 from
> a shared temp path should discard it."*

> *"partway through, a shared-filename scratch file I was using was overwritten with
> a different account's plan (3 slots, Greek yogurt and Cacik — dairy, one of my
> walls). I caught it, re-fetched to a p040-unique path, and re-verified ownership
> before grading… that near-miss would have manufactured exactly the false
> dairy-leak report the sheet warns about. The collision was in local scratch files,
> not in the product."*

**Two false allergen leaks prevented, by agents policing themselves.** That is the
fix working, and it is also the lesson repeating: *any* shared filename in a
concurrent agent fleet — jar, scratch, output — will eventually cross two identities
and manufacture a safety finding out of nothing. Later sheets add "put your persona
id in every filename you write" for this reason.

A third agent showed the same discipline on a different axis: offered Raw King
Prawns while its profile excluded `fish`, it checked `/api/profile/meta`, found
`shellfish` and `fish` are **independent toggles**, confirmed it had only ticked
`fish`, and **declined to file a leak** — logging it instead as a trust trap. That
judgment is why the campaign's leak count can be believed.

*Recorded 2026-07-30. Report only — no product code was changed at any point.*
