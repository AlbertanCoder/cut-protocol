# V2-DELTA — corrections to the saas-launch build

Written 2026-08-06 from the "Subscription Build Prompt v2" review, checked against
the actual tree at `8a63af6` (branch `saas-launch`), not against the plan.

**What this is.** v2 was drafted as if this repo were greenfield. It is not — Stages
0–6 are CODE DONE with 1633 tests green, and what remains is mostly owner dashboard
work. So v2 is not a script to run; it is a **list of corrections**, and this file is
that list, ordered by what has to be true before real money moves.

**How to use it.** Open Claude Code *from* `Desktop\cut-protocol` (settings, hooks and
permissions do not follow you from the home directory). Work items in order. As each
lands, fold it into `BUILD_PLAN.md` and strike it here.

**Verification status.** Every P0 item below was confirmed by reading the source, with
file and line. Items marked `[UNVERIFIED]` are v2's claim, not yet checked against the
tree — check before acting.

---

## Decisions locked 2026-08-06

| Decision | Value | Note |
|---|---|---|
| Currency | **USD** | Settled. Do not re-ask at product creation. Every user-facing price must read "$24.99 USD/month", never a bare "$24.99" — first customers are Canadian and see ~$34 CAD hit the card. |
| Free trial | **BUILD IT** — 7 days, card up front | Biggest change in this file. Drives P1 entirely. |
| Failed-payment grace | **7 → 14 days** | Lemon Squeezy's retry schedule is 4 attempts over 2 weeks and is not configurable. A 7-day cutoff downgrades customers LS is still trying to charge. |
| Approach | Patch the existing build | Do not restart. Do not re-run Stage 0 recon. |

---

## P0 — confirmed defects in code that is already written

These are live in the tree. Nothing real should be charged until all eight are closed.

### 1. `Subscription.userId` is `@unique` and must not be

`backend/prisma/schema.prisma:130`

A user who cancels and later resubscribes needs a *second* row. With uniqueness on
`userId`, the new subscription overwrites the old one, and a late-arriving webhook
about the dead subscription then clobbers the live one. Uniqueness belongs on
`lsSubscriptionId` (which is already `@unique`) because that is what webhooks key on.

**This is the expensive item, so budget it properly.** Dropping the constraint is one
line; the consequence is that *every* `upsert` in `backend/src/lib/lemonSqueezy.js`
currently keyed on `userId` (see `:224`, `:259`, and the payment-failed/refund paths)
has to be re-keyed on `lsSubscriptionId`, and `entitlement.js` has to change from
"fetch the row" to "premium if **any** row qualifies". Also make `userId` nullable, so
an event that arrives before it can be mapped to an account is still recorded rather
than dropped.

Do this **before** the table holds anyone's data but yours. Additive-only migration
rules bind the moment a real customer exists.

### 2. `GRACE_DAYS = 7`, and there is no `firstPaidAt`

`backend/src/lib/lemonSqueezy.js:21`

Two changes, and the second matters more than the first:

- `GRACE_DAYS` → `14`.
- Add `firstPaidAt DateTime?`, set to now on the first successful payment for that
  subscription and only while still NULL.

Without `firstPaidAt`, the trial you are about to build in P1 becomes free money: a
trial whose *first* charge fails lands in `past_due`, and the grace rule then hands out
7 trial days plus a 14-day retry window — roughly three weeks of free Premium,
repeatable with any new email address. The rule is: `past_due` **and** `firstPaidAt IS
NOT NULL` gets grace; `past_due` with `firstPaidAt` NULL goes free immediately.

### 3. The penny test cannot work as built

`backend/src/routes/billing.js:19-20`, `backend/src/lib/lemonSqueezy.js:34`

`LEMONSQUEEZY_VARIANT_PENNY` assumes a $0.01 variant. Lemon Squeezy settles card
payments on Stripe rails and **Stripe's minimum charge is $0.50 USD** — a one-cent
variant is declined at checkout. The Stage 6 real-money test would fail on the night.

Change to **$1.00** (nets about $0.45 after fees). The plumbing is otherwise right —
routing it through the real checkout endpoint so `user_id` custom data rides along is
correct and worth keeping.

Rename the env var and the `period === "penny"` literal while you are in there, or the
next session will recreate a $0.01 variant to match the name.

### 4. `subscription_payment_refunded` is not handled

`backend/src/lib/lemonSqueezy.js:146` onward handles `order_refunded` only.

`order_refunded` fires for refunds of an **order**, which for a subscription means the
*initial* purchase. Refunding a **renewal** fires `subscription_payment_refunded` — a
different event. As written, a refunded renewal leaves Premium switched on.

Both must revoke. Also: refunding does **not** cancel the subscription in Lemon
Squeezy. On either refund event, call the LS API to cancel so it stops renewing, and
log that you did.

### 5. There is no way for a customer to cancel

`backend/src/routes/billing.js` contains exactly one route: `POST /checkout`.

No customer portal link, no "Manage subscription", no update-card surface. A customer
who wants to cancel and cannot find how files a chargeback instead — which costs the
payment **plus** a $15 fee, and counts against you with the processor.

Add an endpoint that fetches the subscription from the LS API and redirects to
`urls.customer_portal`. Generate it fresh on every click: those signed URLs expire 24
hours after the API call that created them, so they can never be stored or emailed.

### 6. The annual savings line is arithmetically wrong

`frontend/src/components/pricing-section.jsx:19` (and the comment at `:11-12`)

Currently `"5 months free — about $10.42/mo"`. Check it: 24.99 × 12 = **299.88**, and
125 is 58% less — that part is right. But 125 buys **five months** at the monthly
price, so the customer receives twelve months for the price of five. That is **7 months
free, not 5.** You are underselling your own deal.

While fixing it, do what v2 asks and make it structural: one pricing constants module
(`MONTHLY_PRICE`, `ANNUAL_PRICE`, `CURRENCY`, `TRIAL_DAYS`) with every displayed figure
*derived* — monthly-equivalent = annual/12, savings = 1 − annual/(monthly×12), months
free = 12 − round(annual/monthly) — plus one test asserting those derive to 58%,
$10.42 and 7. Then a future price change fails loudly instead of silently shipping a
false savings claim. No component may contain a hand-typed price or percentage.

Final string: `"Save 58% — 7 months free ($125 USD/year vs $299.88 billed monthly)"`.

### 7. The Google OAuth app is being left in Testing mode

`BUILD_PLAN.md` Part A step 3 reads "ADD YOURSELF AS TEST USER", and nothing anywhere
publishes the app.

You are the owner, so you will pass every checkpoint you run. **The first stranger who
tries to sign in gets refused.** Part E step 1 does mention publishing, but that is at
go-live, which means every test between now and then proves nothing about whether
sign-in works for anyone but you.

Publish now: Google Auth Platform → Audience → "Publish app". Scopes are only `openid`,
`email`, `profile` — non-sensitive, no review, no warning screen. Then verify it with
the throwaway second Google account, which is the only thing that can actually prove it.

### 8. The GitHub repo is PUBLIC and `saas-launch` has never been pushed

Confirmed: `origin` = `AlbertanCoder/cut-protocol`, visibility **PUBLIC**.

Railway deploys from GitHub. So Stage 4 cannot proceed without resolving this, and the
resolution must not be "push the payment branch to a public repo". Create a **private**
repo and push `saas-launch` there.

Note the interaction with the scrubbed public lineage described in `HANDOFF-CURRENT.md`
— the public branch is `fleet/ruler-fixes-2026-08` with different SHAs. Do not
cross-push. Pushing is the owner's hand only; decide the remote layout in session first.

---

## P1 — the free trial (decided: build it)

New product surface. None of this exists in the tree today — confirmed absent:
`trialUsed`, `trialEndsAt`, `firstPaidAt`.

1. **Four LS variants, not two.** Lemon Squeezy attaches trials to the *variant*, so
   every checkout against a trial variant hands out a fresh free week — including to
   someone who already trialled, cancelled and came back. Needed:
   `MONTHLY_TRIAL`, `ANNUAL_TRIAL`, `MONTHLY_NOTRIAL`, `ANNUAL_NOTRIAL`.
   The four IDs must be four *different* numbers — check them when they arrive.
2. **`Profile.trialUsed Boolean @default(false)`**, set true by the webhook the first
   time a trial starts. The checkout endpoint reads it to pick trial vs no-trial
   variant. One free trial per account, ever.
3. **`Subscription.trialEndsAt DateTime?`** — the in-app countdown derives from this
   and nothing else. Never compute `now + 7 days` in the browser.
4. **Grant on `subscription_created` with status `on_trial`.** Do not wait for a
   payment event: no money moves at trial start, so there may be no payment webhook at
   all, and the very first trial would unlock nothing.
5. **Checkout endpoint hardening.** Accept exactly one field — `plan`, enum
   `monthly|annual` — with `extra: "forbid"`. Variant looked up server-side, never
   taken from the request. Never forward `custom_price`, a discount code, or an email
   from the client. Today's `period` parameter accepts `"penny"` from the client
   (`billing.js:20`); that shape needs the same treatment.
6. **Already-premium guard.** Load subscription state before creating any checkout. If
   already premium, return 409 with a fresh portal URL instead. A double-click or a
   stale tab otherwise creates a second real subscription — and because premium is
   "any qualifying row", the app looks completely normal while billing twice.
7. **Trial disclosure, always visible, never in a tooltip.** Directly under every trial
   CTA: *"7 days free, then $24.99 USD/month. Cancel any time before your trial ends
   and you will not be charged."* Nothing in LS's docs promises a trial-ending
   reminder, so the in-app countdown is the only notice you control.
8. **Toggle defaults to MONTHLY.** A surprise $125 charge at the end of a free trial is
   the most expensive thing that can happen to a brand-new store.
9. **Lock card gets four states, not one:** never subscribed → "Start 7-day free
   trial"; trial in progress → no lock card, slim countdown banner instead; was premium
   now free → "Your Premium access has ended / Resubscribe" (**never** "Start free
   trial" to someone who already used theirs); `past_due` → not locked, persistent
   "update your card" banner.
10. **Stage 6 consequence.** A trial variant charges nothing for seven days, so the
    real-money test cannot run through the real product. It needs the separate
    no-trial $1.00 product from P0 item 3 — which is why that item and this one are
    linked.

---

## P2 — hardening v2 adds that this build has no equivalent for

Confirmed absent from the tree.

- **`WebhookEvent` audit table.** Events are processed but never persisted, so there is
  nothing to replay and nothing to look at when a customer says they paid. Write the
  row *before* processing, **redact the payload first** (drop customer name, email,
  billing address, card details — keep event name, IDs, status, dates, variant ID,
  custom data), return 200 fast, then process. Add a documented 30-day prune.
- **`compPremiumUntil DateTime?`.** The obvious manual fix for a broken customer —
  setting `status = 'active'` by hand — gets silently reverted by the next webhook,
  hours after you have told them it is fixed. A separate column evaluated independently
  of LS status cannot be clobbered. It is also what keeps *you* able to see your own
  product after the Stage 6 test subscription is cancelled. Add it in the same
  migration as P0 item 1, not later.
- **Fail-closed webhook secret.** The idiomatic `if (secret) { verify }` shape silently
  accepts *anything* when the env var is missing — which is exactly the state of a
  fresh Railway service. If the secret is empty, return 500 and log it. There must be
  no branch that skips verification. Verify the current implementation reads this way;
  test it by blanking the var and sending a valid request, which must 500, not 200.
- **`resync_user` / `replay_events` / nightly `reconcile`.** Webhooks do get lost — LS
  retries only 3 times over ~2.5 minutes, so a Railway redeploy can eat one
  permanently. Most customers who lose access do not email you; they charge back.
  Reconcile should also warn on the two patterns that look like a dropped webhook from
  the inside: a local row still `active`/`on_trial` whose `renewsAt` is more than a day
  past, and an LS subscription with no local row.
- **Admin lookup endpoints** gated on `ADMIN_EMAILS` (empty by default so they are
  inert unless configured): read-only user lookup, comp grant, single-subscription
  resync. Curl commands into `RUNBOOK.md` — SQL-by-hand at 11pm is not a plan.
- **Uptime monitor.** Railway's healthcheck runs only at *deploy* time, so after a good
  deploy the process can crash, Supabase can pause, or the domain can lapse with no
  signal. A free UptimeRobot check on `/health/deep` every 5 minutes doubles as the
  database touch that stops the Supabase free tier pausing after ~a week of low
  activity — one thing, two jobs.
- **Status vocabulary drift.** `lemonSqueezy.js:259` writes `status: "refunded"`, which
  is not one of LS's seven statuses (`on_trial`, `active`, `paused`, `past_due`,
  `unpaid`, `cancelled`, `expired`). Entitlement treats unknown as free so it behaves
  correctly today — but a reconcile job comparing local status against LS status will
  flag that row as drifted forever. Decide: keep LS vocabulary in `status` and record
  the refund elsewhere, or teach reconcile the exception.

---

## P3 — legal and copy

- **Alberta PIPA is the primary statute**, not PIPEDA (PIPEDA governs the cross-border
  commercial flows). Current drafts are PIPEDA-aware; they need PIPA.
- **Named privacy contact** — PIPA specifically requires a human who answers questions
  about service providers outside Canada. "Privacy contact: [name], Founder —
  support@<domain>". This is the part everyone omits.
- **Cross-border disclosure clause** naming the countries: Supabase, Railway and Lemon
  Squeezy are all US.
- **"nutritionist" is a protected title in Alberta**, same as "dietitian" — unregistered
  use is finable, and generated marketing copy loves "your personal nutritionist". Ban
  it in landing copy, lock cards, meta tags and emails. Grep the tree for existing use.
- **No outcome claims.** No weight loss, no results, no timelines — the terms page
  disclaims any guarantee of results, and a Lemon Squeezy reviewer reads the live site
  during store activation.
- **`[BRACKETED]` placeholders** in `frontend/public/terms.html` and `privacy.html`
  must be filled before anything is public.
- **Refund policy**: 14-day money-back from first charge, in the terms and in the LS
  store settings.

---

## Open questions — check, do not assume

1. **Are there any MIXED endpoints at all?** v2 devotes a large section to returning a
   stripped free-tier shape built from an allow-list. But this repo's gate list is
   all-or-nothing: `/api/plans/*` is entirely premium, recipes browse is entirely free.
   If nothing is genuinely mixed, that whole section is moot and should not be built.
   Answer this before writing any stripping code. `[UNVERIFIED]`
2. **Does the Stage 6 cleanup actually remove the test product?** Hiding a $1 variant is
   not enough — a hidden variant that still exists is a $1/month subscription waiting
   for anyone who finds the ID. It must be deleted outright.
3. **Should the LS integration move behind one module boundary?** `lemonSqueezy.js`
   already is largely that, but `billing.js` and `lsWebhook.js` both reach in. LS is
   mid-migration into Stripe under new ownership; a provider swap should be a
   one-module rewrite, not a hunt. Worth 20 minutes to check the seam is clean.

---

## What v2 got wrong about THIS repo — do not reintroduce

Recorded so a future session pasting from v2 does not reimplement these.

- **v2 says FastAPI / Python throughout.** The backend is **Express 5 + Prisma 6
  (Node)**. Stage 1's entire VERIFIED FACTS block — PyJWT, `PyJWKClient`,
  `APIRouter(prefix="/api", dependencies=[Depends(require_user)])`, `timezone.utc`
  datetimes — is unusable here. This exact error was already caught and corrected in
  `CLAUDE.md` (Part II reconciliation record #5) on 2026-08-04, and v2 reintroduced it.
- **v2 assumes greenfield.** Stage 0's recon, persistence map, and free/premium
  inventory were all done on 2026-08-05 and are committed in `BUILD_PLAN.md`. Re-running
  them wastes a session and risks contradicting decisions already made.
- **v2's stage order differs from this build's.** v2 puts deploy at Stage 3 and Lemon
  Squeezy at Stage 4; this repo has LS at Stage 3 and Railway at Stage 4. Since both
  are code-done, the ordering argument is now moot — but do not renumber the tracker.
- **v2's Supabase key guidance is right and worth keeping**: no `anon` key, no
  `service_role` key, no shared JWT secret; `sb_publishable_` / `sb_secret_` and ES256
  via JWKS. The tree's `.env.example` lists `SUPABASE_JWT_SECRET` as optional — confirm
  the legacy HS256 path is genuinely dead-lettered and not the path being taken.
- **v2's "$0.01 penny test" correction is the one to act on**, but note v2 itself calls
  the old plan "my original plan" — the $0.01 assumption is baked into this tree's code,
  not just its docs. See P0 item 3.

---

## Sequencing

P0 items 1 + 2 + P2's `compPremiumUntil` are **one migration** — do them together,
before any customer data exists, because additive-only rules bind afterwards.

P0 items 3–6 are code-only and independent.

P0 items 7 + 8 are yours, not a session's, and 8 blocks the Railway deploy.

P1 depends on P0 items 1–3. P2 and P3 are independent of everything and can run in
parallel or last.

---

# PASTE BLOCKS — one per sitting, in order

Copy everything inside a fence, nothing outside it. Paste into a Claude Code session
opened **from this directory**. Wait for the checkpoint to pass before moving to the
next one. Each block is self-contained, so a fresh session with no memory can run it.

---

## BLOCK 1 — the migration (do this first, it gets harder later)

```
Read V2-DELTA.md and BUILD_PLAN.md at the repo root, then run git log --oneline -5.
In two lines, tell me what state you think the repo is in. If it doesn't match
"all 6 stages code-done, V2-DELTA.md written, no delta items fixed yet", STOP and ask.

Then do P0 items 1 and 2 from V2-DELTA.md, plus compPremiumUntil from P2. These are
ONE migration and must land together, before any real customer data exists.

1. Take a backup of backend/prisma/dev.db first. Copy it, do not open the shared file.
2. Schema changes to model Subscription:
   - Remove @unique from userId. Make userId nullable.
   - Add firstPaidAt DateTime?
   - Add compPremiumUntil DateTime?
   - Leave lsSubscriptionId @unique — that is the real key.
3. Generate the migration with `prisma migrate diff` + `prisma migrate deploy`.
   NEVER `prisma migrate dev` — three migrations carry checksum drift and it will
   demand a full database reset. This trap is documented in HANDOFF-CURRENT.md.
   Regenerate prisma/postgres/ too, and confirm its drift test still passes.
4. Re-key every upsert in backend/src/lib/lemonSqueezy.js from userId to
   lsSubscriptionId. There are several — find them all, do not guess from this list.
5. Rewrite backend/src/lib/entitlement.js: premium if ANY subscription row for the
   user qualifies, not "the" row. Add the two new rules:
   - compPremiumUntil > now  -> premium, regardless of everything else
   - past_due + firstPaidAt IS NULL -> FREE IMMEDIATELY, no grace
   Every date comparison must be null-safe. If a comparison throws, catch it, log the
   row id, return false. The gate fails closed, never with a 500.
6. Change GRACE_DAYS from 7 to 14 in backend/src/lib/lemonSqueezy.js.
7. Set firstPaidAt to now on the first successful payment, and only while it is NULL.
8. Update scripts/flipPremium.mjs and scripts/flipPremiumCloud.mjs: because a user can
   now hold multiple rows, the flip must DELETE all their rows then INSERT exactly one.
   One forgotten active row would silently keep me premium and make every later
   free-tier check a false pass.

Unit-test every branch of entitlement, including: grace one second either side of now,
endsAt one second either side of now, past_due with graceUntil NULL, past_due with
firstPaidAt NULL, cancelled with endsAt NULL, an unknown status string, a user with no
rows, and a user with TWO rows where only one qualifies. None may raise.

Then: run the full backend suite, show me it green, commit as one clearly-messaged
piece, and update both BUILD_PLAN.md and V2-DELTA.md. Do not push. Then stop.
```

---

## BLOCK 2 — the other four code defects

```
Read V2-DELTA.md and BUILD_PLAN.md, run git log --oneline -5, and tell me in two
lines where we are. Block 1 (the migration) should already be done. If not, STOP.

Do P0 items 3, 4, 5 and 6 from V2-DELTA.md.

3. The test-purchase variant is $0.01 and Stripe's minimum charge is $0.50, so it
   would be declined and the go-live test could not run. Change it to $1.00. Rename
   the env var and the "penny" literal in backend/src/routes/billing.js and
   backend/src/lib/lemonSqueezy.js so nobody recreates a $0.01 variant to match the
   name. Keep it routing through the real checkout endpoint — that is correct.
4. Handle subscription_payment_refunded, which is a DIFFERENT event from
   order_refunded and currently unhandled, so a refunded renewal keeps Premium on.
   Both must revoke. On either one, also call the Lemon Squeezy API to cancel the
   subscription so it stops renewing, and log that you did.
5. Add a "Manage subscription" path. Backend endpoint fetches the subscription from
   the LS API and redirects to urls.customer_portal. Generate it FRESH on every click
   — those signed URLs expire 24 hours after the API call that created them, so they
   can never be stored or cached. Wire a button for premium users in the frontend.
6. Fix the pricing arithmetic. It currently says "5 months free"; $125 buys five
   months at $24.99, so the customer gets twelve for the price of five = 7 months free.
   Create ONE pricing constants module (MONTHLY_PRICE, ANNUAL_PRICE, CURRENCY="USD",
   TRIAL_DAYS=7) and DERIVE every displayed figure from it. No component may contain a
   hand-typed price, percentage or months-free string. Add a test asserting the
   current constants derive to 58%, $10.42 and 7, so a future price change fails
   loudly instead of silently shipping a false savings claim.
   Every user-facing price must say the currency: "$24.99 USD/month", never a bare
   "$24.99" — my first users are Canadian and see roughly $34 CAD hit their card.
   Final savings string: "Save 58% — 7 months free ($125 USD/year vs $299.88 billed
   monthly)".

Full suite green, commit each item separately, update BUILD_PLAN.md and V2-DELTA.md,
do not push, then stop.
```

---

## BLOCK 3 — the 7-day free trial

```
Read V2-DELTA.md and BUILD_PLAN.md, run git log --oneline -5, tell me where we are
in two lines. Blocks 1 and 2 should be done. If not, STOP.

Build P1 from V2-DELTA.md — the 7-day free trial, card required up front. I have
decided to build this; do not relitigate it.

The part that is easy to get wrong: Lemon Squeezy attaches trials to the VARIANT, so
every checkout against a trial variant hands out a fresh free week — including to
someone who already trialled, cancelled and came back. So the product needs FOUR
variants (monthly and annual, each with and without a trial) and the server picks
based on whether this account has ever trialled. One free trial per account, ever.

1. Schema: Profile.trialUsed Boolean @default(false), Subscription.trialEndsAt
   DateTime?. Same migration rules as Block 1 — migrate diff + deploy, never dev.
2. Four env vars for the four variant IDs. Add a startup config check that logs a
   PASS/FAIL table of every required payment variable — name, present, shape valid,
   last four characters — so after any deploy I can read one log block and see what
   the live service is running against. A missing or malformed payment variable must
   make checkout and webhook fail loudly, never fall back to a default.
3. Checkout endpoint: accept exactly ONE field, plan, an enum of "monthly"|"annual",
   and reject any other field. Look the variant up SERVER-SIDE from trialUsed — never
   take it from the request. Never accept or forward a custom price, a discount code
   or an email from the client. Right now the endpoint accepts a "period" string from
   the client including "penny"; that shape needs the same treatment.
4. Already-premium guard: load subscription state before creating any checkout. If
   already premium, return 409 with a fresh customer-portal URL instead. A double
   click or a stale tab otherwise creates a second real subscription, and because
   premium is "any qualifying row" the app looks completely normal while billing
   twice. That surfaces as a chargeback.
5. Webhook: on subscription_created with status on_trial, GRANT PREMIUM RIGHT THERE
   and set trialUsed = true. Do not wait for a payment event — no money moves at trial
   start, so there may be no payment webhook at all and the very first trial would
   unlock nothing.
6. Frontend, four lock-card states, not one:
   - never subscribed  -> "Start 7-day free trial" + the monthly/annual toggle
   - trial in progress -> NO lock card; a slim banner "Free trial — N days left"
   - was premium, now free -> "Your Premium access has ended" + "Resubscribe".
     NEVER say "Start free trial" to someone who has already used one.
   - past_due -> not locked, a persistent "Your payment didn't go through. Update your
     card to keep Premium." banner linking to the customer portal.
   "N days left" derives from trialEndsAt and nothing else. Never compute now+7days
   in the browser.
7. The toggle DEFAULTS TO MONTHLY. A surprise $125 charge at the end of a free trial
   is the most expensive thing that can happen to a brand-new store.
8. Trial disclosure, always visible, never in a tooltip or modal, directly under every
   trial button: "7 days free, then $24.99 USD/month. Cancel any time before your
   trial ends and you will not be charged." Nothing in Lemon Squeezy's docs promises a
   trial-ending reminder email, so the in-app countdown is the only notice we control.

Full suite green, commit in small pieces, update both docs, do not push, then stop.
```

---

## BLOCK 4 — recovery, monitoring and the audit trail

```
Read V2-DELTA.md and BUILD_PLAN.md, run git log --oneline -5, tell me where we are.
Blocks 1-3 should be done. If not, STOP.

Build P2 from V2-DELTA.md. The theme: webhooks DO get lost — Lemon Squeezy retries
only 3 times over about 2.5 minutes, so a redeploy can eat one permanently. And most
customers who lose access do not email me, they charge back.

1. A WebhookEvent table, written BEFORE processing: event name, subscription id, user
   id (nullable — an unmapped event is still recorded, never dropped), signature ok,
   redacted payload, received/processed timestamps, error. REDACT before insert: drop
   customer name, email, billing address and card details; keep event name, IDs,
   status, dates, variant id, custom data. Otherwise this becomes a personal-data
   store my privacy policy has to account for. Add a documented 30-day prune.
   Order is: insert the row -> return 200 within the same second -> then process. If
   processing throws, record the error on the row and STILL return 200.
2. Check the webhook signature verification FAILS CLOSED. The natural way to write it
   — "if the secret is set, verify it" — silently accepts anything when the env var is
   missing, which is exactly the state of a fresh deploy. If the secret is empty,
   return 500 and log it. There must be no branch that skips verification. Prove it
   with a test that blanks the variable and sends a valid request: it must 500.
3. resync_user (rewrite one user's row from the Lemon Squeezy API), replay_events
   (reprocess rows where processed_at is null), and a daily reconcile that pages LS
   subscriptions, rewrites any row whose status or dates differ, and logs every
   correction. Have reconcile also warn on the two patterns that look like a dropped
   webhook from the inside: a local row still active or on_trial whose renewsAt is
   more than a day past, and an LS subscription with no local row at all. Print a
   one-line summary even on a clean run so I can see it working in the logs.
4. Three admin-only JSON endpoints gated on an ADMIN_EMAILS env var that is EMPTY by
   default so they are inert unless configured, comparing against the verified token
   email, 403 otherwise, every call logged: read-only user lookup (profile,
   subscription rows, last 20 webhook events for an email), a comp grant setting
   compPremiumUntil, and a single-subscription resync. No admin UI — put the exact
   curl commands with placeholders into the runbook.
5. backend/src/lib/lemonSqueezy.js writes status: "refunded", which is not one of
   Lemon Squeezy's seven real statuses. Entitlement treats unknown as free so it
   behaves correctly today, but the reconcile job in item 3 will flag that row as
   drifted forever. Decide which way to fix it, tell me which you chose and why.

Logging rules for all of the above: never log raw webhook bodies, the signature
header, any token or key, or a customer's name, email or address. DO log per webhook:
event name, LS subscription id, our user id, resulting status, action taken.

Full suite green, commit in small pieces, update both docs, do not push, then stop.
```

---

## BLOCK 5 — legal and copy

```
Read V2-DELTA.md and BUILD_PLAN.md, run git log --oneline -5, tell me where we are.

Do P3 from V2-DELTA.md. I am a sole proprietor in Alberta, Canada. You are not a
lawyer and neither am I — flag anything you are unsure about rather than inventing
confident-sounding boilerplate, and mark the pages as drafts for my review.

1. The existing /terms and /privacy drafts are PIPEDA-aware. Alberta PIPA is my
   PRIMARY statute; PIPEDA governs the cross-border commercial flows. Cover both.
2. PIPA specifically requires two things people omit. First, naming the countries the
   data goes to: Supabase, Railway and Lemon Squeezy are all United States. Second, a
   NAMED human privacy contact who answers questions about that. Ask me for my name.
3. Body stats and macros are health-adjacent sensitive data, which needs express
   consent — confirm the signup consent checkbox exists and stores a UTC timestamp.
4. Grep the whole tree for "nutritionist", "dietitian" and "R.D." In Alberta these are
   PROTECTED TITLES and unregistered use is finable — "nutritionist" included, which
   surprises people. Say "meal planning tool" or "nutrition information". Report what
   you find before changing it.
5. No outcome claims anywhere in the product or marketing copy — no weight loss, no
   results, no timelines. Describe what the app does, never what my body will do. A
   Lemon Squeezy reviewer reads the live site during store activation.
6. Fill every [BRACKETED] placeholder in frontend/public/terms.html and privacy.html.
   Ask me for the values you need; do not invent them.
7. Refund policy in the terms: 14 days from the first charge, no questions asked.
8. Confirm Terms, Privacy, Disclaimer and the support email are linked in a footer on
   every page including the signed-out landing page.

Show me the final wording for approval BEFORE committing. Then commit, update both
docs, do not push, and stop.
```

