# Agent 05 handoff — Wave 3, finding `onboarding-flow-1`

Branch: `qc/overnight-2026-07-23` · 2026-07-23 · **onboarding-flow-1: OPEN → CLOSED**

Scope built: the **local, single-machine** account system. No Supabase, no hosted
auth, no Stripe — none were added or referenced.

---

## 1. Server bind interface — already fixed by Agent 6, verified empirically

Reported here because the task asked me to confirm and report it, not fix it.

When I started, `backend/server.js` called `app.listen(PORT, cb)` with no host,
which binds every interface. By the time I ran the check, **Agent 6 had already
fixed it** — `backend/server.js:127` is now `const HOST = process.env.HOST || "127.0.0.1"`
and `:131` is `app.listen(PORT, HOST, …)`.

Verified empirically, not just by reading:

```
netstat -ano | findstr :3999
  TCP    127.0.0.1:3999         0.0.0.0:0              LISTENING       14568
```

Control: a bare `http.createServer().listen(3998)` in the same shell binds
`0.0.0.0:3998` **and** `[::]:3998`. So the 127.0.0.1-only bind is the app's doing,
not a platform default. Loopback-only confirmed.

**One residual note for Agent 6 / orchestrator (not a blocker):** the host is
overridable via `process.env.HOST`, and the packaging config ships a real
`backend/.env`. If a `HOST=0.0.0.0` line ever lands in an `.env` that gets
packaged, the app is network-exposed again with no other signal. Consider either
dropping the env override or having `dist:check` fail on a non-loopback `HOST`.
I did not touch `server.js`.

## 2. Requested change outside my ownership — `frontend/src/lib/api.js` (Agent 7)

`LoginScreen.jsx` needs two calls that do not exist on `api`. Rather than race an
edit into Agent 7's file, I put a local `authRequest()` helper inside
`LoginScreen.jsx` (`frontend/src/components/LoginScreen.jsx:20-36`) that mirrors
`api.js`'s `request()` exactly: same relative `/api` path, `credentials: "include"`,
same `{ error, fields }` unwrapping onto the thrown `Error`.

It works as-is and is fully verified in a browser. The only thing it misses is
`api.js`'s `logApi()` bug-report instrumentation. **Cleanup, low priority, safe
to defer:** add to `api.js`

```js
  authStatus: () => request("/auth/status"),
  register: (email, password, confirmPassword) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ email, password, confirmPassword }) }),
```

then swap the two `authRequest(...)` call sites in `LoginScreen.jsx` for
`api.authStatus()` / `api.register(...)` and delete the local helper. The thrown
error shape differs slightly — `api.js` puts the body on `err.body`, mine puts the
field map on `err.fields` — so the `RegisterForm` catch block needs
`err.body?.fields` instead of `err.fields`.

## 3. Login is NOT throttled — deliberate, and a real remaining gap

I added an in-memory attempt throttle (the repo had no rate-limiting mechanism of
any kind; grepped for rate-limit/throttle/backoff and found nothing) and applied
it to `/register` only.

**`/login` is left unthrottled on purpose**: `backend/scripts/qc/fuzz.mjs:65`
body-fuzzes `POST /api/auth/login` in bulk and then does a real login at
`fuzz.mjs:163`. Adding a login throttle would trip on the fuzz traffic and the
real login would 429, breaking the QC harness. That is a harness change, not an
auth change, so it is out of my lane tonight.

**Recommendation for whoever owns the QC harness:** make the fuzz harness reset or
bypass the throttle between phases, then apply the same `createAttemptThrottle`
(already exported from `backend/src/lib/auth.js`) to `/login`. Brute-forcing
`/login` is the one credential attack this build still has no brake on.

## 4. No schema change — "username" is the email

The task text said "non-empty username/email". The `User` model has `id`, `email`
(unique), `passwordHash`, `role`, `createdAt` — there is no `username` column, and
adding one means a migration + `schema.prisma`, neither of which is mine. Email is
the identity, matching `/login`. The "duplicate username rejected" requirement is
covered as duplicate-email → 409.

## 5. Role decision worth a second opinion

The first account created on a zero-user install gets `role: "admin"`
(`backend/src/routes/auth.js:107`). Rationale: on a local single-machine build the
first account is that machine's owner, and `admin` is what gates correcting the
shared food/recipe library (`backend/src/routes/recipes.js:165`, `FoodsTab`'s
`isAdmin` prop). Without it a fresh user cannot fix a bad food row on her own
machine. Additional profiles the owner creates later get `role: "user"`.

If the orchestrator disagrees, it is a one-word change on that line and one
assertion in `backend/tests/auth.registration.test.js`.
