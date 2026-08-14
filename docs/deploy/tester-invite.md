# Tester invite — the honest version

**STATUS 2026-08-14 · DO NOT SEND. The app is live; the invite is not
sendable.** The gate below is the whole reason this file opens with a
checklist instead of a message. Section 0 is the send gate. Read it first;
everything after it is copy that stays unsent until section 0 is all ticked.

---

## 0. Send gate — the blockers, checkable

**Nothing in this file goes to a stranger until every box in "Still
blocking" is ticked.** These are not nice-to-haves. Blocker 1 alone means a
tester who gets the link cannot sign in at all.

### Cleared (evidence, not vibes)

- [x] **The app is live.** <https://cut-protocol-app-production.up.railway.app>
      is deployed and serving real accounts (~5 QA users). *This line is
      carried from the deploy session, not re-measured while writing this —
      re-check `/api/health` on the prod domain before you send anything.*
- [x] **The food/recipe library is seeded** in the cloud database
      (`backend/scripts/seedCloudLibrary.mjs`), so a new account gets a real
      pool to solve against rather than an empty one.
- [x] **The support email is filled in the legal pages.** The real address is
      **armwrestlingalbertan@gmail.com** — rendered in
      `frontend/public/terms.html` (refunds, deletion, contact) and
      `frontend/public/privacy.html` (deletion, contact). The old
      `[SUPPORT EMAIL]` placeholder is gone from both.
- [x] **The 7-day vs 14-day grace-period contradiction is resolved** —
      `terms.html:66` says 14 days, matching the pricing ruling.

### Still blocking

- [ ] **1. Google OAuth is still in Testing mode — and Google is the ONLY
      way in.** On the hosted build there is *no password form at all*:
      `frontend/src/components/LoginScreen.jsx:154` renders `<GoogleSignIn />`
      whenever `supabaseEnabled` is true, and `supabaseEnabled` is true
      whenever the two `VITE_SUPABASE_*` vars are baked in
      (`frontend/src/lib/supabase.js:19-29`) — which they are on the deploy.
      The email/password forms further down that file are the **desktop**
      build's path and never render in the browser. So while the consent
      screen sits in Testing (External), a stranger with the link gets a
      Google error and a dead end — there is no fallback to fall back to.
      Fix: add each tester as a test user in Google Cloud Console, or publish
      the consent screen to production. Same open item as
      `docs/deploy/TONIGHT-RUNBOOK.md` §3.5.
- [ ] **2. The paid gate: the 14-day trial is unbuilt.** No trial fields
      exist in the schema (`trialUsed` / `trialEndsAt` / `firstPaidAt`: zero
      hits in `backend/prisma/schema.prisma`), and free accounts hit
      "Premium feature" on the core plan screen. Until the trial mechanism
      exists, every tester's account needs premium flipped by hand
      (`backend/scripts/flipPremiumCloud.mjs`) or day one is a paywall.
- [ ] **3. The legal pages still announce themselves as drafts.** Both
      `terms.html:22` and `privacy.html:24` render a yellow banner reading
      "DRAFT — written for the owner's review and **not yet reviewed by a
      lawyer**", and both still show `Last updated: [DATE — set at go-live]`.
      `privacy.html:58` still has `[REGION — …]` for the Supabase region, and
      `privacy.html:74` still carries an owner-facing `[NOTE FOR OWNER: …]`
      about in-app account deletion not being built. Sign-in links straight
      to these pages (`LoginScreen.jsx:214-215`), so a tester reads them at
      the moment they consent. Either finish them or accept — out loud, in
      the invite — that testers are agreeing to draft terms.
- [ ] **4. First-stranger-admin — confirm the running deploy carries the
      fix.** The code is correct at HEAD: `backend/src/routes/auth.js:125`
      only mints an admin when `isFirstRun && !isSupabaseAuthEnabled()`, and
      `backend/src/lib/supabaseAuth.js:87` creates every fresh Supabase user
      as role `"user"`. That landed in `16124bc`. What is *not* verified here
      is which commit the Railway service is actually running — check that
      before tester #1, or tester #1 may own the database.
- [ ] **5. Your own phone pass on the live URL.** Open the production link on
      a phone, sign in, walk the wizard, and see a plan. If that has already
      happened, tick it; do not tick it on the strength of this sentence.

---

## Why this file exists

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
> Sign-in is Google only — there's no password option, so you need a Google
> account to get in at all.
>
> Straight up about the data: your account email, your profile numbers,
> your weigh-ins, and your meal plans live on the app's server in the
> cloud — it is not local-only, and I'm the one running the server. If
> that's a dealbreaker, no hard feelings. Want your account and everything
> in it deleted, during or after? Email armwrestlingalbertan@gmail.com and
> I'll do it by hand.
>
> It's free for the whole test. It's a calculator and meal planner, not
> medical advice — and there's a wellbeing check with support resources
> built into the app.
>
> Want the link?

### Ultra-short version (SMS, notice board, forwarding)

> I built a calorie/meal-plan web app and need testers: 2 min a day for 14
> days, free. Google sign-in only. Heads up — your email, weigh-ins, and
> plans are stored on my server in the cloud, not just on your phone. Not
> medical advice. In?

---

## B. 60-second onboarding blurb

Send this after someone says yes, with the link.

> Day one takes about five minutes, then it's ~2 minutes a day.
>
> 1. Open the link and sign in with Google. That's the only way in — there
>    is no password to create.
> 2. The setup wizard asks your height, weight, age, what you do for work,
>    how you train, and any foods you can't or won't eat. Answer honestly —
>    every number comes from these.
> 3. It shows your daily calorie target (the math is on screen if you want
>    to check it) and builds your first weekly meal plan.
> 4. Tomorrow morning: weigh yourself, enter it, glance at the day. That's
>    the whole daily routine.
>
> Two honest heads-ups. The Terms and Privacy pages you'll see at sign-in
> are still marked DRAFT and haven't been through a lawyer — they describe
> what I actually do with your data, but they're my writing, not a
> solicitor's. And there's no delete-my-account button yet; email
> armwrestlingalbertan@gmail.com and I'll delete it manually.
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

The ask never grows: 2 minutes a day for 14 days, free, cloud-hosted,
Google sign-in only, not medical advice. Same pitch in every channel.

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

### Before the first invite goes out

The preflight that used to live here is now **section 0 at the top of this
file** — one list, kept current, so it can't drift out of sync with a second
copy. Recruiting ahead of that gate is fine (asking costs nothing and takes
1–2 weeks); *sending the link* is what's blocked. If you collect yeses now,
sit on the link until section 0 is clear — a tester who hits the Google
Testing-mode wall is a tester you don't get a second shot at.
