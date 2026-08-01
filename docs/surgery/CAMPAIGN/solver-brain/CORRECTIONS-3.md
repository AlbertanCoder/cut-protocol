# SOLVER BRAIN — mid-flight corrections, part 3

*Continues `CORRECTIONS.md` and `CORRECTIONS-2.md` (both immutable once written).
**Every Phase-4 and Phase-5 agent reads all three.***

---

## C14 — THE DISCRIMINATION FLOOR. ~3.5 points, not ±1.5. This governs every Phase-4 verdict.

**Status: A1, DERIVED from a measured positive control. Binding on A13–A21 and on A24's
audit.**

`BRIEF.md` says a delta inside ±1.5 points is noise. **That figure describes run-to-run
variance of the HTTP fleet. It is not the rig's ability to resolve a difference, and using it
as a significance threshold will manufacture false positives.**

A1 measured the rig's minimum detectable effect directly. Its positive control — pool thinned
to 2-of-3 recipes, a deliberately damaging treatment — moved satisfiable-only by **−2.05 pts**
and **the paired 95 % interval still spanned zero**.

McNemar, satisfiable-only, from the positive control: `b=50, c=39, n=536` →
`se = sqrt(89 − 121/536)/536 = 0.0176` → 1.76 pts → **95 % half-width 3.45 pts**.

**The rules that follow:**

1. **A treatment that churns days in both directions needs |delta| ≳ 3.5 pts before this study
   may call it real.** Between 1.5 and 3.5 points is *not* a small result — it is an
   **unresolved** one. Report it as "not distinguishable from zero at n=536", with the b/c
   discordant counts, and say what n would be needed.
2. **A treatment that only ever helps (b=0) is limited instead by the ±1.5 pt floor** — about
   **9 flipped days** at n=536. Report your b and c counts so the reader can tell which regime
   you are in. This distinction is the difference between a real finding and a discarded one.
3. **Use `compare.v2.mjs`, never `compare.mjs`.** v1 reports only the unpaired interval, ±5
   pts wide at n≈620, which would file a real +3 pt effect as zero. v1 could not be edited
   (create-only guard), so the fix shipped as a new file.
4. **Replicate at seeds 20260730 and 8675309 before believing any delta.** Cross-seed spread
   on the baseline is 0.9 pts (satisfiable) / 0.6 pts (all days). Within one seed the rig is
   exactly deterministic — there is no noise to average away, so a single-seed delta is a
   *point*, not an estimate.

**A21 in particular:** stacking several sub-3.5-point levers and reporting the sum is exactly
the inflation A24 is hunting. Measure the combination; do not add the parts.

---

## C15 — Cite the HTTP fleet for levels, the rig for deltas. Never mix them.

A1's rig reproduces the campaign's numbers on an **independent in-process path**: 77.1–78.0 %
satisfiable-only and 69.8–70.4 % all-days across three seeds, against the HTTP fleet's 77.8 %
and 70.1 %.

**That is corroboration, not the same measurement.** The rig judges **622 days** where the
fleet judges 578, from four documented deviations (`SCHEMA.md`): `startDayOfWeek` pinned to 0,
free-text exclusions not applied, no HTTP layer, adjusters re-assembled.

Two instruments landing within a point of each other after the previous campaign's 6.3 %-vs-
40.8 % harness disaster is a genuinely reassuring result — **and it is still two different
denominators.** Cite the HTTP fleet for a standalone level; cite the rig only for deltas
between its own runs.

---

## C16 — The rig does NOT check allergen leaks. Run the oracle separately.

`runRig.mjs` emits no leak column. The fleet's load-bearing "0 confirmed allergen leaks"
property **cannot be verified from rig output**.

**Any treatment that touches the recipe pool, the exclusion gate, or the macro closer's
candidate set must run `backend/scripts/qc/oracle.mjs` separately** and report the leak count
beside its compliance delta. `oracle.mjs` carries an independently curated `AUDIT_ALLERGENS`
list and imports no `src/lib` engine module — it is the defence against the engine grading
itself.

**This binds A16 and A17 hardest.** A17 widens the closer's gate, and C13 records a **latent
style-gate leak** (squirrel, wild pig, heart, an Isopure whey row all return
`isExcluded=false` for vegan) that is currently unreachable only because no recipe contains
those rows. Widening a gate into that pool is precisely the "raises compliance and leaks"
trade that is an automatic fail.

---

## C17 — A1 independently corroborates the C7 denominator ruling

A1's baseline shows the `IMPOSSIBLE` tier producing **21 of 86 judged days in band** (32
personas, 103 planned days). If the correct output for that tier were a refusal, those 21 days
would be impossible.

Derived from a different population construction and a different call path than A3's proof,
and it points the same way: **the tier is over-inclusive.** C7's ruling stands and now has two
independent supports.
