# Tester invite — the honest version

Replaces the unsent 2026-07-21 draft, which promised "nothing gets uploaded
anywhere." That was true of the desktop build and is **untrue of the hosted
web app** testers will actually use. This version says what the server
stores, plainly, so nobody signs up on a false premise. The old draft was
never sent and is not in the repo; only its quote survives
(`docs/qc/session-findings-2026-08-10.md`, open item 4).

Ground rules for every message below: no hype, no medical claims, no
"private/local-only" claims. The app stores data in the cloud and the
invite says so.

---

## A. The invite message

### DM / text version (send this)

> Hey — I built a nutrition app and I need real people to test it for 14
> days. It's a web app: you punch in your height, weight, age, and what you
> do for work, and it calculates your calories, builds weekly meal plans
> with a grocery list, and tracks your daily weigh-ins against the plan.
>
> The ask: about 2 minutes a day for 14 days. Weigh in each morning, glance
> at the plan, and tell me what's confusing or broken.
>
> Straight up about the data: your account email, your profile numbers,
> your weigh-ins, and your meal plans live on the app's server in the
> cloud — it is not local-only, and I'm the one running the server. If
> that's a dealbreaker, no hard feelings.
>
> It's free for the whole test. It's a calculator and meal planner, not
> medical advice — and there's a wellbeing check with support resources
> built into the app.
>
> Want the link?

### Ultra-short version (SMS, notice board, forwarding)

> I built a calorie/meal-plan web app and need testers: 2 min a day for 14
> days, free. Heads up — your email, weigh-ins, and plans are stored on my
> server in the cloud, not just on your phone. Not medical advice. In?

---

## B. 60-second onboarding blurb

Send this after someone says yes, with the link.

> Day one takes about five minutes, then it's ~2 minutes a day.
>
> 1. Open the link and sign in with Google.
> 2. The setup wizard asks your height, weight, age, what you do for work,
>    how you train, and any foods you can't or won't eat. Answer honestly —
>    every number comes from these.
> 3. It shows your daily calorie target (the math is on screen if you want
>    to check it) and builds your first weekly meal plan.
> 4. Tomorrow morning: weigh yourself, enter it, glance at the day. That's
>    the whole daily routine.
>
> You don't have to follow the meal plan perfectly — or at all. What I need
> is the daily weigh-in and your honest reaction: what confused you, what
> broke, what you ignored. There's a "Report a bug" button in the app; use
> it freely, even for small stuff.
>
> If any of the dieting side ever feels off, the app has a wellbeing check
> with real support resources — it's in the sidebar, never hidden.

---

## C. Recruitment checklist — 20 strangers, realistically

The honest math first: strangers flake. Expect roughly half of "sure, I'm
in" to never sign in, and more to drop off before day 14. To end with ~20
who last the window, collect **30–35 yeses**, which means asking **60–100
people**. Budget 1–2 weeks of asking, not one evening.

The ask never grows: 2 minutes a day for 14 days, free, cloud-hosted, not
medical advice. Same pitch in every channel.

- [ ] **Friends-of-friends** (best conversion). Don't recruit friends
      directly — they'll be polite instead of honest, and they're not
      strangers. Ask 5–10 people you know to each forward the ultra-short
      version to 2–3 people who've mentioned wanting to lose weight.
      Target: ~10 yeses.
- [ ] **Trades coworkers / job site.** Other crews, apprentices, the lunch
      trailer — people who already talk about cutting weight. Face-to-face
      pitch, then text them the link. Target: ~8 yeses.
- [ ] **Local gym.** Ask the front desk **before** posting anything. A
      small notice with the ultra-short version and a QR code, or just talk
      to people you already nod at. Target: ~5 yeses.
- [ ] **Reddit — per each sub's self-promo rules, no exceptions.**
      Beta-recruiting subs exist for exactly this: r/SideProject,
      r/alphaandbetausers, r/betatests. Weight-loss subs (r/loseit and
      similar) generally **ban** self-promo — message the mods first and
      take no for an answer. Same for r/Edmonton. One post per sub, the
      honest pitch including the data disclosure, no DM campaigns, no
      reposting on a timer. Target: ~7 yeses.
- [ ] **Track it.** A plain list: name/handle, channel, date asked,
      yes/no, signed in yes/no. Stop asking when sign-ins hit ~30.

### Before the first invite goes out (preflight, from the measured checklist)

- [ ] The Railway deploy is live and the production URL works from a phone
      (`docs/qc/session-findings-2026-08-10.md`, "Railway deploy — the
      measured checklist").
- [ ] Google OAuth is still in **Testing (External)** — real testers cannot
      sign in until they're added as test users or the app is published.
      Verified 2026-08-10; must be resolved first.
- [ ] First-stranger-admin fix is deployed (owner ruling 2026-08-12 #3) —
      otherwise tester #1 owns the database.
- [ ] The paid gate: the 14-day trial is **unbuilt**, and free accounts
      currently hit "Premium feature" on the core plan screen. Until the
      trial mechanism exists, each tester's account needs premium flipped
      (`backend/scripts/flipPremiumCloud.mjs`) or day one is a paywall.
- [ ] Terms/privacy placeholders (`[SUPPORT EMAIL]`, 7-day vs 14-day grace)
      are filled — testers will be sent to pages that currently contain
      placeholders.
