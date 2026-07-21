# Cut Protocol — Brain v2 build log (owner-facing, newest first)

*Plain-English record of the v2 program. One entry per meaningful step:
what got finished · what's next · anything needed from Shad.*

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
