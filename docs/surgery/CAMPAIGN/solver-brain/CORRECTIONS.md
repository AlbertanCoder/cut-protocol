# SOLVER BRAIN — mid-flight corrections

**Every agent launched after this file exists must read it alongside `BRIEF.md`.**
These are claims in the mission prompt and in `BRIEF.md` that did not survive
contact with the data. The brief warned it contained at least one such number.
It did.

---

## C1 — The fat band is ±8 %. The fat *pass/fail rule* is ±33.1 %.

**Status: CONFIRMED by three independent derivations** — agent A4, agent A6
(neither coordinating with the other), and the fleet coordinator reading
`backend/src/lib/mealSolver.js` directly.

The mission prompt §2 and `BRIEF.md` both describe fat as
`lbm_lb × 0.34…0.40`, *"roughly ±8 % around its own midpoint — tighter than any
published dietary guideline expresses."* The band is real. **It is not the
boundary that grades a day.**

`bandMiss()` (`mealSolver.js:218-225`) measures the miss as a fraction of the
band **midpoint**, not of the band edge:

```js
function bandMiss(v, lo, hi) {
  const mid = (lo + hi) / 2;
  ...
  if (val < lo) return { shortPct: (lo - val) / mid, overPct: 0, mid };
  if (val > hi) return { shortPct: 0, overPct: (val - hi) / mid, mid };
```

With `const DAY_FAT_TOLERANCE_PCT = 0.25;` (`mealSolver.js:212`) and
`fatOk: !fatBand || (fat.shortPct <= DAY_FAT_TOLERANCE_PCT && fat.overPct <= DAY_FAT_TOLERANCE_PCT)`
(`:250`):

```
mid       = (0.34 + 0.40)/2      = 0.37·lbm
allowance = 0.25 × 0.37          = 0.0925·lbm
pass band = [0.34 − 0.0925, 0.40 + 0.0925] = [0.2475, 0.4925]·lbm
half-width/mid = 0.1225/0.37     = ±33.1 %   ← 4.08× the nominal band
```

The code says so in its own comment (`mealSolver.js:205-209`): judging strictly
inside the band *"would fail nearly every real plan and make the flag
meaningless."*

**Consequences for the fleet, and they are large:**

1. **The premise "the ruler is too tight on fat" is dead.** Do not build on it.
   A4 measured the NASEM AMDR at ±27.3 % relative half-width — the app's
   *effective* fat gate is **looser** than the AMDR, not tighter.
2. **A6 found the gate is ~2.4× wider than the only published per-macro gram
   convention** (IIFYM +5 g/−10 g). Tightening fat would *lower* the 70.1 %.
   Any lever that raises the number by relaxing fat is therefore not just
   against integrity rule 1 — it is pushing on an already-loose constraint.
3. **A15 (ruler variants) must re-baseline.** Re-scoring under "fat ±10 %,
   ±15 %, ±20 %" as the mission prompt lists would be *tightening* from the true
   ±33.1 %, not loosening from ±8 %. Report both the nominal and effective
   framing, and state which one each variant is relative to.
4. The same midpoint-relative arithmetic applies to **carbs**
   (`DAY_CARB_TOLERANCE_PCT = 0.25`), with zero upward allowance on keto.

---

## C2 — The fat band is not universal across diets.

**Status: reported by A4 (MEASURED, quoted from source). Not yet independently
re-verified by a second agent.**

Keto (`bmrEngine.js:313`) and the carb-floored path (`:341-342`) use
`fatMid * 0.9 … * 1.12` — asymmetric, ±10.9 % nominal / ±35.9 % effective. The
blanket `lbm × 0.34…0.40` in the mission prompt and `BRIEF.md` describes only the
**default** path. Any agent slicing by diet must not assume one fat rule.

---

## C3 — The grading rule passes days below the engine's own essential-fat floor.

**Status: reported by A4 (MEASURED). A defect, independent of any literature.
Flagged for A24 and A25; not yet independently re-verified.**

`bmrEngine.js:286` declares `const ESSENTIAL_FAT_PER_LB_LBM = 0.3;`, described at
`:284-285` as *"fat never drops below this"*. The effective pass floor derived in
C1 is **0.2475·lbm — 17.5 % below it**. A day can grade in-band while sitting
under the constant the engine itself calls essential.

This is not a compliance-rate question. It is a correctness question about the
ruler, and it belongs in the report regardless of what it does to the number.

---

## C4 — Subagents cannot create their own `FINDINGS.md`.

**Operational, not scientific.** Agents can write files via shell redirection
(several have written `.mjs`, `.jsonl` and `.csv` artifacts successfully) but the
Write tool is refused for report files. Two agents hit this and correctly recorded
it as a blocker rather than silently dropping their deliverable.

**Mitigation in force:** the fleet coordinator persists each agent's returned
deliverable to `<AGENT-ID>/FINDINGS.md` verbatim as it lands. Agents should keep
appending numbers to `CLAIMS.tsv` with `>>` (that path works) and should not spend
tool calls fighting the Write block — return the deliverable as text.

---

## C5 — The market has no published fat tolerance to compare against.

**Status: A6, MEASURED (documentary).** Of MacroFactor, Eat This Much, Fitia,
Prospre, Carbon, RP Diet Coach, Cronometer and Strongr Fastr, **none publishes a
per-macro fat tolerance** and **none reports a computed days-in-band hit rate.**
Only Fitia publishes any numeric tolerance at all (±10 %, calories only).

So Cut Protocol's 70.1 % is **comparable to nothing any competitor publishes**, in
either direction. A25 must not frame it against an implied industry norm.

**Contaminated source tier, flagged by A6:** several 2026 "best macro app" pages
(macro-trackers.com, hootfitness, nutriscan, caleye, nutrola) read as generated
SEO content; one cites a "120-day Macro Tracker Lab study" A6 could not locate.
If any later agent surfaces these, discard them.
