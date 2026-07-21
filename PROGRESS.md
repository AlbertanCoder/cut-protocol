# Cut Protocol — Brain v2 build log (owner-facing, newest first)

*Plain-English record of the v2 program. One entry per meaningful step:
what got finished · what's next · anything needed from Shad.*

---

## 2026-07-21 · Stage 3 DONE — E1 10-formula BMR (Option A, byte-identical)

**What you get:** the Engine tab's BMR panel now offers **10 published formulas**
instead of 6 — FAO/WHO/UNU, Owen, Livingston, Nelson added — each with a citation.
Crucially **your target does not move**: the 4 new ones are **default-off**, so the
average still runs on today's 6. Tick any new one on (same toggle) to include it.

**How (Option A = default-preserving):**
- A0 first (8230772): added a BMR golden capturing today's 6-formula mean, so the
  change is provably byte-identical. null and 0 body-fat confirmed identical.
- 4 formulas appended + `leanBodyMass` extracted (single-sources the 3 LBM
  formulas). `DEFAULT_ENABLED` + `isFormulaOn` flip: `excludedFormulas` membership
  FLIPS a formula from its default — for the legacy 6 this is byte-identical to the
  old opt-out; the 4 new are default-off (opt-in via the same toggle).
- Added `sd` + `spreadPct` (+ an honest "dispersion, not a CI" caveat on the tab)
  and `prov {formulaId, inputs, value, citation}` on every row (Law 3). Engine now
  dual-accepts body-fat `null` OR `0` as unknown (readies E2).
- Frontend: EngineTab toggle made flip-aware (reads server `defaultOn`); "6 of 10"
  shows automatically; spread caveat added.

**Verified:** 379/379 tests green (+5 E1 regressions incl. published values for all
4 new formulas + flip semantics). **Golden BRAIN=off byte-identical PASSES** — proof
no target moved. oxlint + vite build clean. (Not browser-verified — dev servers were
stopped; logic is tested + data-driven.)

**Next:** Stage 4 — E2 body-fat visual picker (nullable migration — a real DB change;
data-preserving table rebuild, I'll flag it as a rebuild, not destructive).

---

## 2026-07-20 (later 4) · Stage 2 DONE — security safety net (secret scan + dist gate)

**What you get:** it's now hard to leak secrets by accident.
- `npm run scan:secrets` — scans every tracked file for real secrets (Anthropic/
  JWT/USDA/AWS/PEM keys, seed passwords). **Also a CI job** — a committed secret
  now fails the build. Repo scans CLEAN today (279 files).
- `npm run dist:check` — before sharing an installer, scans a built `release/`
  for secrets AND personal data (emails in the shipped DB/env). PROVEN: it FAILS
  the current-style build (catches all 4 real .env secrets + your email + DB
  personal data, redacted) and PASSES a secretless build.
- Placeholder-aware (skips `change-me`/`ci-only`/`example`…) so docs/CI dummies
  don't false-positive, without weakening the catch on a real key.

**Brain-purity guard:** already covered — `brainMock.test.js` asserts BRAIN=off →
zero LLM calls, and the golden test asserts byte-identical output. No new test needed.

**Deliberately deferred (needs your call):** the fully-automatic safe `dist:share`
(secretless env + depersonalized seed DB) needs a decision on which DB tables are
LIBRARY (ship: Food/Recipe) vs PERSONAL (strip: User/Profile/WeighIn/Plan/Diary/
Training/Brain*). I won't guess that with your personal data at stake — it's the
one Stage 2 item flagged for you. The scan+gate above already PREVENT an accidental
leak in the meantime. Dropped the wip-branch/save-resume ceremony (low value).

**Verified:** 374/374 tests green (+4 scanner self-tests), scanner proven live
(clean repo / catches real .env), gate proven both ways. CLAUDE.md caveat updated.

**Next:** Stage 3 — E1 10-formula BMR (Option A, byte-identical).

---

## 2026-07-20 (later 3) · Stage 1 DONE — coach builds a real numbered plan in chat

**What you get:** ask the coach "plan me a high-protein day" (or build/generate/
make … a day/meal plan) and it now returns a **real, engine-computed day** as a
card in the chat bar — each meal with its recipe name + P/C/F, a day total, and
your target. Every number is the deterministic solver's (LAW 1); the coach's
text states no number. Ideas/swaps/follow-ups ("vegan dinner ideas", "why not
fish?") still get the normal conversational reply — the plan-route is narrow.

**How it's built (all additive, byte-identical-off):**
- Extracted `planContext`/`filterRecipePool`/`parseFilters` out of `routes/plans.js`
  into `lib/planContext.js` so the chat planner and every /plans route build the
  SAME exclusion-filtered pool (M8 single-source). Route re-exports filterRecipePool
  so `planLogic.test.js` is untouched. Verbatim move — zero behavior change.
- New `lib/brain/chatPlan.js`: `looksLikePlanRequest` (narrow intent regex) +
  `generateDayForChat` (calls the deterministic `generateDayCandidates` with NO
  profile → no LLM, no spend; pool already compliant) + `planIntro` (number-free).
- `chat.js`: plan-route fires AFTER the domain gate (injection still refused first),
  BEFORE any model call; failure falls through to the coach (LAW 7).
- Frontend `BrainChat.jsx`: constitution-compliant `PlanCard` (macro triad only,
  no green/no red, lightness elevation, "computed by the engine" microcopy).

**Verified:** 370/370 backend tests green (was 359) — incl. golden BRAIN=off
byte-identical + planLogic (extraction held) + 11 new plan tests. oxlint + vite
build clean. Not yet browser-verified live (next: a quick real-key smoke).

**Next:** Stage 2 — governance/security Tier-1.

---

## 2026-07-20 (later 2) · All 4 v2 designs in — consolidated build order

4 parallel design agents delivered implementation-ready plans (K library, T taste,
E1/E2 BMR+body-fat, S+governance). Build order (each additive, byte-identical-off,
committed, pause-able):
1. Coach planner-wiring — deterministic day-solver → engine numbers → plan card in the bar
2. Governance/security Tier-1 — gitleaks secrets + brain-purity regression guard + save/resume
3. E1 — 10-formula BMR (Option A default-preserving → targets unchanged)
4. E2 — body-fat picker (nullable migration; shares E1 engine)
5. T — taste tier (dependency-free types.js; scorer/pool/constraints; opt-in)
6. K — pre-solved library (~$0 common case; ends with a one-time ~$20-50 generation on Shad's go)

Decisions: E1 Option A (recommended) vs B (shifts every target); K generation spend
(Shad's go, LAST step of K); rest take agent-recommended defaults — dependency-free
enums (no zod dep), nullable body-fat, drop wip-branch ceremony, S3 advisory-first.

⚠️ Landmine (S agent, HIGH): the INSTALLER bundles the REAL .env + dev.db renamed
`.template` (extraResources) — fine for the personal build, MUST be stripped before
sharing. Split dist:local (keeps secrets) vs dist:share (placeholders + empty DB) +
S4 installer gate scans extracted CONTENTS (filename globs miss the renamed files).
Other reconciliations found: bodyFatPct is currently Float NOT NULL (0=unknown), not
null — engine must dual-accept 0 OR null; A0 null-BF BMR golden doesn't exist yet
(add before touching FORMULAS); UserLibraryEntry lands in K (not I).

Next: start #1 (coach planner-wiring) on Shad's go.

---

## 2026-07-20 (later) · Coach: useful + memory done; design fleet running

**Finished (live-verified on the real key):**
- Coach #1 — genuinely useful replies: conversational classifier (greets, follows
  up), search-only toolset (was flailing on the plan-building tools), no-numbers
  prompt. Greets, gives real meal ideas from the pool, refuses off-topic. (cc4c1e5, fee0555)
- Coach #2 — conversation memory: client sends recent turns; brainChat caps +
  validates + prepends. "why not fish?" now stays in context. (d54b584)
- Empty tool-loop degrades honestly instead of a false off-topic refusal.

**In flight:** 4 parallel DESIGN agents scoping the independent v2 stages (K
library, E1/E2 BMR+body-fat, T taste, S+governance). S+governance landed — drop
the wip-branch ceremony (keep crash-safe state); installer ships real secrets (S4
scans extracted contents); 2 decisions for Shad (S3 dep-pinning enforce-vs-advisory;
distribution extraResources split). Tier-1 security to build first: gitleaks
secret scan + brain-purity regression guard + .agent/save-resume.

**Next:** coach #3 — wire the deterministic day-solver into chat so "plan me a
day" returns a real math-checked numbered plan (engine numbers = LAW-1-safe).

**Needed from Shad:** nothing blocking; the 2 security decisions can wait.

---

## 2026-07-20 · v2 kicked off (coach-first)

**Where we are:** the original A–J brain is built, verified (12-agent fleet), and
LIVE on a real key — every safety guard proven (no invented numbers, off-topic
refused, injection-safe). Live testing showed the v1 Beta Coach is *thin*: it
redirects to the Plan tab on any number, can't follow up ("Why not?"), and can't
generate a plan in chat.

**v2 plan (coach-first ordering):**
1. **Make the coach's replies useful** — prompt tuning so it gives real food
   guidance instead of a bare redirect. *(this step)*
2. **Conversation memory** (v2's fuller Stage I: `BrainConversation` /
   `BrainMessage`) → follow-ups like "Why not?" work.
3. **Wire the planner into chat** → the coach produces real, verifier-checked
   plans in the bar (not a bounce to the Plan tab).
4. Then the rest of v2 — E1 (10-formula BMR), E2 (body-fat picker), T (taste),
   **K (pre-solved library → ~$0 common case)**, L (fitness, deferred) — with the
   governance/RESUME infra + anti-slop + security lane layered in as we go.

**Finished this step:** _(see next entry once committed)_
**Next:** conversation memory (Stage I).
**Needed from Shad:** nothing right now — re-test the coach after the prompt fix.

**Standing invariants (unchanged from the original build):** every stage leaves
`main` green and, with `BRAIN=off`, byte-identical to today; the 7 LAWS win over
everything; no push without Shad's say-so; keys are Shad's to place (never handled
in chat).
