# 04 — Multi-User Auth & Tenancy Design

Status: **spec only, not implemented.** No code was written for this doc. It's
a plan for the team to review and argue with before anyone touches
`backend/src/lib/auth.js`.

Scope: turn Cut Protocol from a single-seeded-account app into one strangers
can sign up for and use, without corrupting each other's data or the shared
recipe library, and without shipping the two security gaps both `AUDIT.md`
and `PABLO_REVIEW.md` already flagged (no CSRF protection, no login
rate-limiting).

---

## 0. Current state — what's actually there vs. actually missing

This matters because the honest answer is "more than you'd guess." Read
`backend/src/lib/auth.js`, `backend/src/routes/auth.js`,
`backend/prisma/schema.prisma`, and the routes in `backend/src/routes/` end
to end before writing this section — here's what's there.

**Already architecturally present, no changes needed:**

- `User` and `Profile` are already two separate Prisma models
  (`schema.prisma`), 1:1 via `Profile.userId @unique` with a proper foreign
  key. This is *not* a single flattened "user" blob — someone already did the
  work of separating identity (`User`: id, email, passwordHash) from
  domain data (`Profile`: physiology, targets, preferences). That split is
  exactly what you want for multi-tenancy and it's already done.
- `Weighin`, `Plan` (→ `PlanSlot` → `GroceryList`), and `CartItem` all carry a
  real `userId` foreign key to `User`, and — I spot-checked every route file
  that touches them (`weighins.js`, `cart.js`, `plans.js`,
  `routes/profile.js`) — every query is already scoped with
  `where: { userId: req.userId }`, sourced from `req.userId` set by
  `requireAuth` off the verified JWT, not from any client-supplied id. There
  is no query in these four routes today that reads or writes another user's
  row. If the app went multi-user tomorrow with zero changes to these models,
  cross-user data leakage through Weighin/Plan/CartItem would not be one of
  the bugs.
- Password hashing is real: `bcryptjs` at cost factor 12
  (`auth.js:hashPassword`). Fine as-is, no change needed.
- Cookie flags are already mostly right: `httpOnly: true`, `secure` gated on
  `NODE_ENV === "production"`, `sameSite: "lax"` (`auth.js:setSessionCookie`).

**So the multi-tenancy *data* groundwork is largely already there.** What's
actually missing is entirely in the *auth surface* and in two specific
authorization gaps this doc covers in §4.

**Actually missing:**

1. **No registration route at all.** `routes/auth.js` has `login`,
   `logout`, `me` — that's it. The only way a `User` row is created today is
   `scripts/seedUser.js`, a CLI script reading `SEED_EMAIL`/`SEED_PASSWORD`
   from `.env`, run manually. Zero self-service signup exists.
2. **No password strength validation anywhere.** `seedUser.js` hashes
   whatever string is in `SEED_PASSWORD` with no length or strength check.
   There is no equivalent check that would even exist for a hypothetical
   registration endpoint yet.
3. **No email verification, no password reset.** No token model, no email
   sending capability in the dependency tree at all (confirmed via
   `backend/package.json` — dependencies are `@anthropic-ai/sdk`,
   `@prisma/client`, `bcryptjs`, `cookie-parser`, `dotenv`, `express`,
   `jsonwebtoken`, `prisma`; no `nodemailer`, no `resend`, no `sendgrid`,
   nothing that sends an email).
4. **No rate limiting or lockout anywhere in the stack.** No
   `express-rate-limit` or equivalent in `package.json`. `/api/auth/login`
   is brute-forceable today with zero friction — confirmed by reading
   `routes/auth.js`: it's a bare `prisma.user.findUnique` + `bcrypt.compare`,
   no attempt counter, no delay, no lockout.
5. **No CSRF protection.** `sameSite: "lax"` is doing all the work right now.
   See §3.2 for why that's not enough on its own once this is a public,
   multi-user, state-changing app.
6. **JWT is fully stateless with a 30-day TTL and no revocation path.**
   `signToken`/`verifyToken` in `auth.js` are pure `jsonwebtoken` sign/verify
   against `JWT_SECRET` — there's no session table, no token version, no way
   to invalidate a specific session short of rotating the global secret
   (which would log out *every* user, not just one). This becomes a real
   problem the moment there's a password-reset flow: resetting a password
   must invalidate the old session, and today nothing does that. See §3.3.
7. **`defaultProfile()` (`routes/profile.js:41-51`) is a single hardcoded
   30yo/178cm/desk-job/2150kcal template, silently merged into any `PUT
   /api/profile` that doesn't supply every field.** In a single-seeded-account
   app this was never exercised for real. In a self-registration world it's
   a live correctness bug: a new user who lands on the profile form and
   submits a partial patch — or an onboarding wizard with a bug that skips a
   field — gets real physiological defaults for a stranger's body silently
   written into a row the rest of the pipeline (BMR engine, macro targets,
   meal planner) treats as ground truth. This needs to stop being reachable
   for real users; see §1.4.
8. **Recipe/Food CRUD has no ownership check at all, and this becomes a real
   multi-tenant abuse vector, not just a theoretical one.** See §4.2 — this
   is the one finding in this doc that isn't in either prior review, because
   neither review was looking at the app through a "what happens when
   strangers can log in" lens.

---

## 1. Self-registration flow

### 1.1 Endpoint

`POST /api/auth/register` — new route, same file (`routes/auth.js`) or split
into `routes/auth.js` (login/logout/me) + a new `routes/registration.js` if
the file is getting long; not a strong opinion either way.

Request: `{ email, password }`. No "confirm password" field server-side —
that's a frontend-only UX check (typing it twice), the server only ever sees
one password value; don't make the API care about a field that exists purely
to catch fat-fingering.

### 1.2 Email validation

- Normalize the same way `login` already does: `.trim().toLowerCase()`
  (`routes/auth.js` already does this for login — reuse the same
  normalization, don't reinvent it).
- Format check: a pragmatic regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) is enough.
  Don't reach for a full RFC 5322 validator — it buys nothing here and every
  "complete" email regex is famously wrong in some edge case; a cheap
  sanity check plus the fact that a dead/mistyped email just means that user
  never gets their verification or reset email (self-limiting, not a security
  issue) is the right amount of effort.
- Duplicate email → `409 { error: "email already registered" }`. Unlike
  password-reset (§2, where you must NOT reveal whether an email exists),
  leaking "this email is taken" on *registration* is normal, expected UX
  (every product does this) and low-risk — don't over-engineer enumeration
  resistance here, it's not the same threat model as reset.
- No disposable-email blocklist, no MX-record check for v1. Real cost for
  approximately zero benefit at this scale; revisit only if abuse is
  observed.

### 1.3 Password strength

Recommendation: **length over composition rules**, per current NIST 800-63B
guidance, which is also just less annoying for real users than the classic
"must contain 1 uppercase, 1 number, 1 symbol" theater:

- Minimum 10 characters. That's the whole server-side rule for v1.
- Reject if the password equals the email address or its local-part
  (trivial check, catches the laziest case).
- No forced complexity rules, no forced rotation.
- **Nice-to-have, not a v1 blocker:** a client-side strength meter using
  `zxcvbn` (or the lighter `zxcvbn-ts`) so users get real-time feedback
  ("this is guessable" vs. arbitrary rule-checking) before they submit. Not
  currently a dependency in `frontend/package.json` — flag as a follow-up,
  don't block registration shipping on it.

### 1.4 `defaultProfile()` / onboarding

Current `defaultProfile()` in `routes/profile.js` needs to stop being a
silent fallback for real users. Two concrete changes:

1. **Add `Profile.onboardingComplete Boolean @default(false)`** to the
   schema. A newly registered `User` has no `Profile` row at all until
   onboarding actually runs — don't lazily create one from
   `defaultProfile()` on first `PUT` the way it works today. Gate the main
   app UI behind `onboardingComplete === true`; every route that reads
   `Profile` for real computation (`weighins.js`'s `/summary`, `plans.js`'s
   `planContext`) already 404s cleanly when no `Profile` exists
   (`if (!profile) return res.status(404)...` — confirmed in both files),
   so this isn't a new failure mode to build, it's just making sure the
   *creation* path also requires the real onboarding wizard to run instead
   of accepting a partial patch.
2. **The actual onboarding wizard UX (multi-step form, what fields, in what
   order, how age/height/body-fat/activity get collected) is explicitly out
   of scope for this doc** — that's a UX design task, not an auth task. Flag
   the dependency: whoever owns onboarding UX needs to know the backend
   contract is "no `Profile` row exists until the wizard's final step calls
   `PUT /api/profile` with `onboardingComplete: true` and every
   `PROFILE_FIELDS` entry filled" — but don't block this auth doc on that
   work landing first. `defaultProfile()` can stay in the codebase as a dev/
   seed-script convenience (it's still useful for `seedUser.js`-style test
   fixtures) — it just shouldn't be reachable from a real user's `PUT
   /api/profile` call anymore once onboarding gating is in.

### 1.5 Email verification — needed for v1, or can it wait?

**Recommendation: don't gate login/usage on it for v1, but do implement it
as a soft/background flow, and use verification status to gate one specific
feature.**

Reasoning:
- Full hard-gating (can't use the app until you click an email link) adds
  signup friction for a product with no evidence yet of an abuse problem,
  and this is a small team shipping speed matters for.
- But open self-registration on a public Railway URL is a real spam/abuse
  surface, and this app specifically has an *outbound* abuse vector the
  team should know about: `PABLO_REVIEW.md §3.3` notes grocery-list
  generation has "SMS/email share links." An unverified, throwaway account
  that can trigger arbitrary outbound SMS/email sends *to addresses the
  registrant doesn't own* is a spam-relay vector, not just an annoyance —
  someone could use a free account to blast SMS/email at third parties
  through Cut Protocol's sending infrastructure/reputation.
- So: add `User.emailVerified Boolean @default(false)`, send a verification
  email on registration (same token mechanism as password reset, §2, just a
  different `type`), and **require `emailVerified === true` before the
  SMS/email share-link feature will fire.** Everything else in the app
  (profile, weigh-ins, plans, recipes) works on an unverified account. This
  keeps signup frictionless while closing the one feature that turns an
  unverified account into a spam gateway.
- Add basic IP-based rate limiting on `/api/auth/register` regardless (§3.1)
  — cheap, catches naive bulk-signup bots independent of the verification
  question.

---

## 2. Password reset flow

### 2.1 Token generation and storage

New Prisma model — one table, not two, reusing the same shape for both
password-reset and email-verification tokens (keeps the schema lean, matches
this codebase's existing preference for simple string-typed discriminators
over proliferating near-identical models — see `User.sex`, `Profile.job`,
`Recipe.source` all doing the same thing):

```
model AuthToken {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  type      String    // "reset" | "verify"
  tokenHash String    // sha256 of the raw token — never store the raw token
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, type])
}
```

- Raw token: `crypto.randomBytes(32).toString("hex")` (already the exact
  pattern `DEPLOY.md` recommends for generating `JWT_SECRET` — reuse the
  same idiom, the team's already comfortable with it).
- Store only `sha256(rawToken)` in the DB, same reasoning as password
  hashing: if the DB leaks, stored tokens shouldn't be directly usable.
  The raw token only ever exists in the email link and in memory for the
  duration of the request that mints it.
- Expiry: **30 minutes** for password reset (short-lived, high-value
  action), **24 hours** for email verification (low-stakes, no reason to
  rush a user who's slow to check their inbox).
- Single-use: `usedAt` set on successful redemption; check `usedAt === null
  AND expiresAt > now()` on verify.
- When a new reset token is requested, don't bother invalidating older
  unused ones explicitly — they'll expire on their own in 30 minutes, and
  the rate limit on the request endpoint (§3.1) already caps how many a user
  can mint. Simpler than a cleanup step for negligible security gain.

### 2.2 Endpoints

- `POST /api/auth/forgot-password { email }` → **always returns `200`
  regardless of whether the email exists.** This is the one place
  enumeration resistance actually matters (unlike registration, §1.2) —
  don't let this endpoint be usable to test "does this email have an
  account here." If the user exists, mint an `AuthToken{type: "reset"}` and
  send the email; if not, do nothing and return the same response either
  way, on a similar time budget (don't let response-time itself leak the
  answer — awaiting the token-mint+email-send path or an equivalent no-op
  delay on the not-found branch keeps timing roughly consistent).
- `POST /api/auth/reset-password { token, newPassword }` → validate password
  strength (§1.3 rules), look up `AuthToken` by `sha256(token)`, check type/
  expiry/unused, update `User.passwordHash`, mark token used, and — critical
  — **invalidate the user's existing session(s)**, see §3.3 for how, since
  today's stateless JWT has no revocation mechanism and "someone reset their
  password because their old one leaked" is exactly the scenario where the
  old session cookie needs to stop working immediately.

### 2.3 Email delivery — what to actually use

Confirmed via `backend/package.json`: **zero existing email-sending
capability in this codebase.** Nothing to build on top of.

**Recommendation: [Resend](https://resend.com) via its `resend` npm
package.** Reasoning, concretely against this project's constraints (small
team, shipping to Railway, minimal-dependency preference):

- Single small dependency (`resend`), first-class Node SDK, no SMTP
  transport config to get right.
- Generous free tier (3,000 emails/month at time of writing) — comfortably
  covers a new product's early user base for verification + reset emails,
  which are low-volume, transactional-only sends.
- API-based delivery has meaningfully better out-of-the-box deliverability
  than raw SMTP relay for a new sending domain — less likely to land in spam
  for the exact emails (password reset) where that's most damaging.
- No infrastructure to run — fits a Railway deploy with no extra service to
  provision.

**Alternative if the team wants to avoid a third-party API dependency
entirely:** `nodemailer` + an SMTP relay (Mailgun/Postmark/even a Gmail app
password for very early testing). More moving parts (SMTP credentials,
transport config, generally worse deliverability reputation to bootstrap),
but zero new SaaS account if that's a real constraint. Not the primary
recommendation, but a reasonable fallback — flagging it because the prompt
asked for "a reasonable minimal-dependency choice" and this is the more
minimal of the two in terms of "dependencies on outside services," even
though it's more code.

Either way: this needs `RESEND_API_KEY` (or SMTP creds) added to
`backend/.env` locally and to Railway's service variables per the existing
pattern in `DEPLOY.md` §4 — same secrets-handling story as `JWT_SECRET`
today, no new secrets-management mechanism needed for this (see §3.4).

---

## 3. Session / security hardening

### 3.1 Rate limiting and lockout

Two layers, not one — an IP-based limiter alone misses distributed/
rotating-IP attacks against a single account; an account-lockout alone
misses spray attacks (many accounts, few attempts each) or pure
registration-spam that never touches a specific account.

**Layer 1 — `express-rate-limit` (new dependency, ~9kb, no Redis needed at
this scale — in-memory store is fine for a single Railway instance):**

- `POST /api/auth/login`: 10 requests / 15 min / IP.
- `POST /api/auth/register`: 5 requests / hour / IP.
- `POST /api/auth/forgot-password`: 5 requests / hour / IP.
- Apply to `reset-password` too at a looser bound (it's already gated by
  needing a valid token, but no reason to leave it unbounded).

**Layer 2 — account-level lockout, needs two new `User` fields:**

```
failedLoginAttempts Int       @default(0)
lockedUntil         DateTime?
```

- On failed login: increment `failedLoginAttempts`. At 5, set `lockedUntil =
  now() + 15 minutes` and reject further attempts (even correct-password
  ones) until it passes, with a clear `423 { error: "account temporarily
  locked, try again in N minutes" }` — don't disguise this as a generic
  invalid-credentials error, a real user locked out by a typo storm deserves
  to know why.
- On successful login: reset `failedLoginAttempts` to 0.
- This is deliberately simple (no exponential backoff, no CAPTCHA
  integration for v1) — revisit only if real abuse is observed in
  production logs.

### 3.2 CSRF

**`sameSite: "lax"` alone is not sufficient for a real deployed product, and
both prior reviews were right to flag it.** What `Lax` actually buys: it
blocks the cookie from being sent on cross-site *subrequests* (images,
iframes, fetch/XHR from another origin) and on cross-site POSTs originating
from a `<form>` on another site. It does **not** protect against cross-site
top-level navigations that are GETs (not a problem here since this API
doesn't mutate on GET — confirmed, every mutating route in `routes/` is
POST/PUT/DELETE), but the real gap is that `Lax` is a browser-behavior
mitigation the app has zero control over if the assumption ever breaks
(older browsers, a future subdomain, a webview that doesn't fully respect
`SameSite`, a same-site subdomain compromise). It's a reasonable *baseline*,
not a substitute for the app-level protection every cookie-session app with
real users should have.

**Recommendation: double-submit-cookie CSRF, layered on top of the existing
`sameSite: "lax"` cookie (belt and suspenders, not either/or):**

- On login (and register), in addition to the `httpOnly` session cookie, set
  a second **non-`httpOnly`** cookie, `csrf_token`, holding a random value
  (same `crypto.randomBytes` idiom again).
- Frontend (`frontend/src/lib/api.js`, the existing fetch wrapper) reads
  `document.cookie` for `csrf_token` and attaches it as an `X-CSRF-Token`
  header on every mutating request (POST/PUT/DELETE) — small, contained
  change to one file.
- Backend middleware, applied to all mutating routes: compare the
  `X-CSRF-Token` header value to the `csrf_token` cookie value; reject with
  `403` on mismatch or absence.
- Why this works without a server-side session store: a cross-site attacker
  can trigger a request that *includes* the victim's cookies (that's the
  entire CSRF premise), but cannot *read* the victim's cookies to put the
  matching value in a custom header — that's the same-origin policy doing
  the actual work. This is the standard pattern for exactly this
  architecture (cookie session + no server-side session table) and needs no
  new infrastructure.
- **Alternative considered and rejected for v1:** move off cookies entirely
  to `Authorization: Bearer` header tokens (naturally CSRF-immune since
  nothing is auto-attached by the browser). Rejected because it's a bigger
  rework of `api.js` and the token-storage story (localStorage bearer tokens
  trade CSRF risk for XSS-token-theft risk, not obviously a win), and the
  double-submit pattern closes the actual gap both reviews flagged with a
  much smaller diff. Worth revisiting only if the app grows a
  non-browser/mobile client where cookies stop being the natural fit.

### 3.3 Session revocation (the gap this doc's password-reset flow exposes)

Today: `signToken`/`verifyToken` in `auth.js` is pure stateless JWT, 30-day
TTL, nothing else. There is no way to invalidate one session without
rotating `JWT_SECRET` for *everyone*. That's fine for a single seeded
account; it's not fine once "user resets their password because they think
their account was compromised" is a real flow, because the old session
cookie — on whatever device the attacker has it on — would otherwise stay
valid for up to 30 more days after the reset.

**Minimal fix, no session-store infrastructure needed:**

- Add `User.passwordChangedAt DateTime @default(now())`.
- Embed it in the JWT payload at sign time: `{ sub: userId, pwdAt:
  user.passwordChangedAt.getTime() }`.
- In `requireAuth`, after verifying the signature, compare the token's
  `pwdAt` claim against the current `User.passwordChangedAt` (one extra
  `select` on a query that likely already needs to touch `User` in most
  routes, or a light dedicated lookup) — reject with `401` if they don't
  match.
- On password reset, update `passwordChangedAt = now()`, which naturally
  invalidates every previously issued token without touching a session
  table.
- This is a lightweight, no-infrastructure version of session revocation —
  it only fires on password change, not a general "log out this one device"
  feature. A full multi-device session list/management UI is a real feature
  some products want, but it's out of scope here; flag it as a possible v2
  if the team wants "log out everywhere" as a user-facing button.

### 3.4 JWT secret in plaintext `.env` — acceptable, or does this need a real secrets manager?

**Recommendation: current approach (plaintext `.env` locally, Railway
service Variables in prod) is acceptable for this team's current size and
should NOT be replaced with a dedicated secrets manager (Vault, AWS Secrets
Manager, Doppler, etc.) right now.** Reasoning:

- It's already correctly gitignored and confirmed never committed
  (`AUDIT.md §1` verified this directly via `git ls-files`).
- `DEPLOY.md §4` already documents the right practice — generate a fresh
  `JWT_SECRET` for production, don't reuse the dev value.
- Railway's own service Variables store is not "nothing" — it's encrypted
  at rest and access-gated by Railway project membership, which for a small
  team *is* a basic secrets manager, just not a standalone product. Adding
  Vault or similar on top buys defense-in-depth the team doesn't have a
  concrete threat model for yet (who exactly is the plaintext `.env`
  protecting against, once the only people with prod access are the team
  members who already have full DB access anyway?).
- Introducing a dedicated secrets manager now is real ongoing operational
  cost (another service to run/pay for/manage access to) for a benefit that
  only materializes at a scale/compliance bar this product isn't at.

**Concrete near-term improvements that are worth doing, short of a new
tool:**
- Document a rotation runbook: rotating `JWT_SECRET` invalidates every
  active session immediately (everyone gets logged out) — that's a feature
  for incident response ("we think the secret leaked") but should be a
  known, deliberate action, not a surprise. One paragraph in `DEPLOY.md` is
  enough.
- Revisit this decision if/when: the team grows past a couple of people with
  production access, secret rotation needs to happen without a full
  logout (at which point the `passwordChangedAt`-style versioning pattern
  in §3.3 could be extended to a general key-versioning scheme), or there's
  an actual compliance requirement (PCI, SOC2, etc.) forcing the issue. None
  of those are true today.

---

## 4. Data model changes

### 4.1 Confirmed already correctly scoped (no changes needed)

Spot-checked directly against the running schema and route code:

- `Profile` — 1:1 with `User` via `userId @unique`, every route
  (`routes/profile.js`) scopes on `req.userId`.
- `Weighin` — `userId` FK, `@@unique([userId, date])`, every query in
  `routes/weighins.js` scoped on `req.userId`.
- `Plan` → `PlanSlot` → `GroceryList` — `Plan.userId` FK,
  `@@unique([userId, startDate])`; `PlanSlot`/`GroceryList` reach `userId`
  transitively through `Plan` and every route in `routes/plans.js` resolves
  through `planContext(userId)` first. Confirmed no route takes a raw
  `planId`/`slotId` from the client without also checking it belongs to
  `req.userId`'s plan (worth a final targeted look at every `routes/plans.js`
  handler before shipping, since this file is the largest and most complex —
  but the pattern used throughout is consistently userId-first).
- `CartItem` — `userId` FK, `@@unique([userId, recipeId])`,
  `routes/cart.js` scoped correctly.

**No structural changes needed to any of the above for multi-tenancy.** This
is the "already more done than you'd guess" finding from §0 — whoever
designed this schema was already thinking in per-user terms even though the
app only ever had one user.

### 4.2 Food / Recipe — the real architectural decision, and a live bug it's currently masking

`schema.prisma`'s own comment on `Food` says it directly: *"Foods/recipes are
a shared library, not per-user — this is a single-user app for now, and a
shared curated library is the simpler model regardless."* The question this
doc needs to answer: does that hold once real strangers can sign up?

**Recommendation: keep Food/Recipe as a shared global library by default —
do not fragment it into per-user silos — but add an additive opt-in path for
user-submitted private recipes, and separately, fix an authorization gap
that becomes a real abuse vector the moment signups open.**

Reasoning for keeping it shared:

- `PABLO_REVIEW.md §2.7` already identified the real bottleneck: 602 of 628
  recipes are unreviewed generic imports, only 24 are hand-curated, and the
  library's quality — not its architecture — is what's actually holding the
  meal planner back (dessert recipes tagged eligible as dinner slots, etc.).
  Splitting the library per-user doesn't fix that; it makes it worse, by
  multiplying one under-curated pool into N under-curated pools with no
  shared curation effort. A new user gets *zero* recipes on day one under a
  per-user model unless the product also builds a "start from a copy of the
  curated set" onboarding step — extra complexity for a worse outcome.
- A shared, professionally curated library is a real product asset (every
  user benefits from curation work done once) — this is the same model
  Cronometer/MyFitnessPal use for their base food database, layered with a
  *separate* per-user "my foods" concept for personal additions. That's a
  proven split, not a novel one.

Reasoning for the additive private-recipe path:

- Some users will want to add a personal recipe (grandma's chili, a specific
  meal-prep staple) without waiting on or polluting the shared curated pool.
  That's a real, common want in this product category.
- Additive schema change, non-breaking to the existing 628 rows:

```
model Recipe {
  ...existing fields...
  visibility   String  @default("public") // "public" | "private"
  authorUserId String?
  author       User?   @relation(fields: [authorUserId], references: [id])
}
```

  Existing rows: `visibility: "public"`, `authorUserId: null` (curated
  library, unchanged). New user-submitted recipes: `visibility: "private"`,
  `authorUserId: <creator>`. Recipe-pool queries (`plans.js`'s
  `planContext`, currently `prisma.recipe.findMany({...})` with no filter at
  all) need one added clause: `where: { OR: [{ visibility: "public" },
  { authorUserId: userId }] }` — pulls in the shared library plus that
  user's own private additions, nothing else.

**The authorization gap this decision exposes, confirmed by reading the
route code directly:** `routes/recipes.js` has `PUT /:id` and `DELETE /:id`
(lines 72 and 109) with **no ownership check of any kind** — any
authenticated user can edit or delete *any* recipe in the database, curated
or not, because today "any authenticated user" means "the one seeded
account." **The moment self-registration ships, this becomes a live
griefing/data-corruption vector**: any new signup could delete the entire
curated library, or silently mutate a shared recipe's macros in a way that
corrupts every other user's meal plans that reference it. This has to be
fixed as part of this work, not deferred:

- Add `User.role String @default("user")` // `"user" | "admin"` — minimal,
  no need for a real RBAC system at this stage, this is one flag.
- `PUT/DELETE /api/recipes/:id`: if `recipe.authorUserId === null` (shared/
  curated), require `req.user.role === "admin"`. If
  `recipe.authorUserId === req.userId` (their own private recipe), allow it.
  Otherwise (someone else's private recipe), `403`.
- Same ownership logic needs to extend to `routes/foods.js` if/when a
  "create food" endpoint ships — today `foods.js` is read-only (`GET /`
  only, confirmed), so there's no live gap there yet, but flag it now so
  whoever builds food-creation later doesn't reintroduce the same hole.

**Cross-check note:** this may overlap with a separate data-isolation-
focused review running in parallel on this same codebase. The Recipe
ownership gap above is exactly the kind of finding that review would also
be positioned to catch — worth a quick diff against their findings before
implementation starts, but this doc's recommendation doesn't depend on
that review landing first.

### 4.3 New models/fields summary (all additive, no migrations that touch existing data destructively)

```
model User {
  ...existing fields...
  role                String    @default("user")   // "user" | "admin"
  emailVerified       Boolean   @default(false)
  passwordChangedAt   DateTime  @default(now())
  failedLoginAttempts Int       @default(0)
  lockedUntil         DateTime?
  authTokens          AuthToken[]
  recipesAuthored     Recipe[]  @relation("RecipeAuthor")
}

model AuthToken {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  type      String    // "reset" | "verify"
  tokenHash String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, type])
}

model Profile {
  ...existing fields...
  onboardingComplete Boolean @default(false)
}

model Recipe {
  ...existing fields...
  visibility   String  @default("public") // "public" | "private"
  authorUserId String?
  author       User?   @relation("RecipeAuthor", fields: [authorUserId], references: [id])
}
```

---

## 5. Suggested sequencing

Not asked for explicitly but worth stating so the team doesn't try to ship
this as one giant PR:

**Phase 1 — must land before any public signup is possible:**
registration + email/password validation (§1.1-1.3) · rate limiting +
account lockout (§3.1) · CSRF double-submit (§3.2) · Recipe ownership fix
(§4.2) — this one specifically cannot wait, it's a data-corruption risk from
the first non-team signup · `Profile.onboardingComplete` gating (§1.4).

**Phase 2 — soon after, not launch-blocking:** password reset + email
delivery via Resend (§2) · email verification, soft-gating the SMS/email
share feature only (§1.5) · `passwordChangedAt` session invalidation (§3.3,
becomes actually necessary once reset exists).

**Phase 3 — revisit later, not urgent:** `zxcvbn` client-side strength
meter · admin role UI for managing the shared recipe library · secrets
manager reassessment (only if team/compliance situation changes, §3.4) ·
"log out all devices" as a general user-facing feature beyond the
password-reset-triggered version.

---

## Top recommendation and open question, for the human reviewing this

**Top recommendation:** ship Phase 1 as a single unit before opening
signups to anyone outside the team — of everything in this doc, the Recipe
ownership gap (§4.2) is the one item that isn't a hardening nice-to-have,
it's a live data-corruption bug waiting for the first stranger to hit "delete."

**Biggest open architectural question for a human to decide:** whether email
verification should be a soft gate (this doc's recommendation — free
signup, verified-only for the SMS/email share feature) or a hard gate
(can't use the app at all pre-verification). This doc picked soft on a
shipping-speed argument, but it's a real product-risk tradeoff, not a
technical one, and it depends on information this doc doesn't have: how
much does the team actually expect/fear spam signups at launch, and how
much does anyone care about a few days of friction on new-user activation.
Worth a five-minute team decision rather than defaulting to this doc's
guess.
