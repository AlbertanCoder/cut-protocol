# Cut Protocol — Brain Turn-On Runbook

**Purpose:** the exact, dummy-proof steps to arm the AI "brain" for the first time.
Until every step here is done, the brain stays **off** and the app behaves
byte-identically to the deterministic-only engine.

**Do not skip a step. If any check fails, STOP and fix it before continuing.**

---

## 0. What "on" means (scope for v1)

**v1 ships the CHAT COACH only.** When armed, a "✦ Coach" chat bar appears; it
answers food/diet questions in words. It is wired behind four guards:

1. **Gate** — runs only when `ANTHROPIC_API_KEY` is set **AND** `BRAIN=on`.
2. **Cost cap** — every model call is pre-checked against the caps; a breach
   degrades to a notice, it never overspends. Actual spend is recorded.
3. **Injection guard** — a Tier-0 regex + a Tier-1 Haiku classifier; anything
   not clearly food/diet, or any prompt-injection, is refused.
4. **Number guard** — a reply that states calories/macros is replaced with a
   "use the Plan tab" redirect (the coach never emits a number it authored).

**Still DORMANT in v1 (reachable by no route):** the meal planner, recipe
generator, brain grocery list, and preference store. They are built + verified
but not wired live. A later phase arms them with the same gate + cap + guard.

---

## 1. Prerequisites (already done — confirm, don't redo)

- [ ] All build stages A–J complete; `cd backend && npm test` → **all green**,
      including `golden: BRAIN=off engine output is byte-identical`.
- [ ] Turn-on gates G1–G3 closed (cost cap, injection classifier, number guard).
- [ ] `backend/prisma` migrations applied (the `LlmUsage` table exists — the cost
      ledger writes there). Check: `npx prisma migrate status` → up to date.

---

## 2. Add the key + set the caps (your hands)

> Handle the API key yourself — never paste it into chat.

1. Get an Anthropic API key from the Anthropic Console.
2. In the **Anthropic Console**, set a **hard monthly billing limit** (belt +
   suspenders — e.g. **$20/mo**, just above the app's $15 cap). This is your real
   backstop if the app cap is ever misconfigured.
3. In `backend/.env`, add the key and (optionally) confirm the caps. The caps
   below are the built-in defaults — you only need these lines to CHANGE them:
   ```
   ANTHROPIC_API_KEY=sk-ant-...            # your key
   BRAIN_MONTHLY_COST_CAP_USD=15           # default 15
   BRAIN_DAILY_COST_CAP_USD=5              # default 5
   BRAIN_PER_REQUEST_CAP_USD=0.5           # default 0.5
   # models (defaults shown): chat + critic = sonnet-5, classifier = haiku-4-5
   ```
   **Do NOT set `BRAIN=on` yet.** Adding the key alone changes nothing (the gate
   also needs `BRAIN=on`).

---

## 3. Three green lights (BEFORE you flip it on)

**Light 1 — off-state is byte-identical.** With `BRAIN` unset/off:
```
cd backend && npm test
```
→ all green, including the `golden … byte-identical` line. (This proves adding
the key changed nothing while off.)

**Light 2 — the keyless brain suite is green.** Same run covers it (the
`tests/brain/*` + `tests/golden/*` suites). Confirm 0 failures.

**Light 3 — the LIVE smoke test.** This is the only step that spends real money
(a few cents). Run it with the key present and the brain temporarily on:
```
cd backend
BRAIN=on node scripts/brainSmokeTest.mjs
```
It must print **PASS** for all four checks:
- **cap DENY** — with a $0 cap, a chat turn degrades (no spend, no crash);
- **real chat turn** — a food question returns a coach reply;
- **injection refused** — an injection/prompt-extraction attempt is refused;
- **number redirect** — a reply stating macros is swapped for the Plan-tab line.

If any check is FAIL, STOP. Do not arm.

---

## 4. Arm it

1. Set `BRAIN=on` in `backend/.env` (or the app's environment).
2. Restart the backend.
3. In the app, confirm the **"✦ Coach" bar appears** (the frontend shows it only
   when `GET /api/brain/status` returns `{enabled:true}`).
4. Ask one real food question. Confirm a sensible, number-free reply.

---

## 5. Watch it (first day)

- **Spend:** the `LlmUsage` table records every call's cost. Check it (or the
  Anthropic Console) after the first few turns; confirm it's a few cents, not
  dollars, per turn.
- **Cap behavior:** if you hit the daily cap, the coach politely says it's paused
  and points to the Plan tab — that's correct, not a bug.
- The deterministic Plan tab, engine, and every existing feature are **unchanged**
  whether the brain is on or off.

---

## 6. Rollback (instant, always safe)

Set `BRAIN=off` (or remove `ANTHROPIC_API_KEY`) and restart. The chat bar
disappears and the app is byte-identical to the deterministic-only build. No data
migration, no cleanup — the gate simply closes.

---

## Appendix — where the guards live (for the next maintainer)

| Guard | File | Note |
|---|---|---|
| Enable gate | `src/lib/brain/llm.js` `isBrainEnabled()` | key **AND** `BRAIN==="on"` — the single gate |
| Cost cap | `src/lib/brain/ledger.js` `guardedCall` / `pricing.js` `estimateUsd` | precheck → degrade; records actual usage |
| Injection (Tier-0/1) | `src/lib/brain/guard.js` / `classifier.js` | regex floor + Haiku classifier; fail-closed |
| Number guard | `src/lib/brain/outputGuard.js` `NUMBER_CLAIM_RE` | LAW 1 on the chat reply |
| Chat entry | `src/lib/brain/chat.js` `brainChat` + `src/routes/brain.js` | the only live model path in v1 |
