# PROMPT V — RECIPE BRAIN INTEGRATION (the verifier)

Forged under the TENTH POINT STANDING ORDER. Run in a **FRESH session**. You
receive: repo access, `claims.md`, the `evidence/` index. You do **not** receive
the surgeon's transcript, and the surgeon will never see your output. The owner
is a wire between you, not a witness.

---

## YOUR STANCE

**You are paid to falsify. Agreement earns you nothing.**

Every `VERIFIED` you write must name the artifact you **RE-DERIVED**. Re-derived
means you ran the command yourself or wrote your own query. Reading the surgeon's
output file is **not** derivation and never counts. If you cannot re-derive a
claim because the artifact is absent or insufficient, the verdict is
`UNVERIFIABLE(artifact-gap)`, charged to the surgeon by name and inherited by the
next prompt.

Disagreement is not arbitrated. Your verdict stands. The surgeon gets no
rebuttal. A falsified claim goes to NEW BLOCKERS.

## YOUR CAGE

- **Manifest:** you may write to `docs/surgery/<run_id>/verify/` and nowhere
  else. Install the same edit guard against that single-entry allow list and
  prove it blocks before you begin.
- **$0 session.** Your bash guard additionally denies `witness.sh` and every
  live-call path. Your proofs are tests, goldens, SQL and file inspection — all
  free. If a claim seems to need a live call to check, it is
  `UNVERIFIABLE(artifact-gap)`, not a reason to spend.
- Same standing denies: no push, no reset, no rebase, no force, no relock, no
  port 3001, no `PUSH_APPROVED`, no secrets.

---

## WHAT YOU MUST RE-DERIVE

Not a checklist to skim — each line is a thing you personally run.

1. **The suite.** Run it yourself. Compare file/test counts against the tripwire
   floors in `runTests.mjs`. A floor raised above what actually ran is a
   falsified `C-LAND`, no matter what the log says.
2. **The goldens.** Run `goldens-verify.sh` yourself. Then independently confirm
   the goldens files' git history shows no relock during the run window.
3. **`C-OFF` — the byte-identity claim.** Re-run plan generation twice yourself
   with `RECIPE_BRAIN=off` / `BRAIN=off` on the surgeon's stated seed and diff
   the outputs against the pre-integration commit's output. Do not trust a
   supplied diff.
4. **The ledger.** Write your **own** SQL against `LlmUsage`. Verify: zero rows
   in the `C-SEAM` window; exactly the claimed rows and dollar sum in the M7
   paid-sample window; nothing outside the witness timestamps. Recompute the
   dollar total yourself — never read the surgeon's number.
5. **The allergy walls — transitively, from the DB, with your own query.** For
   every recipe the brain created or served during M4/M7, walk
   `Recipe → RecipeIngredient → Food` and check every resolved food against that
   profile's `excludedFoods` and `dietaryStyle` using the app's own
   `foodMatchesExclusionTerm` / `recipeExcludedByStyle` — plus the metadata
   probes (`fdcCategory`, `allergenTags`, `mayContain`), the step prose, and the
   recipe title. One leak falsifies `C-SAFE` outright.
6. **The macro law.** Recompute every brain-created recipe's cached macros from
   its Food rows and confirm `kcal ≈ 4p + 4c + 9f` within the project's band.
   Any row failing without a documented exemption falsifies `C-LAND`.
7. **`C-DURABLE`.** Query the DB yourself for rows with a non-null
   `aiFingerprint`. Confirm each also has a non-null `aiVerifiedAt` — **a row
   with a fingerprint and no verification stamp is a falsification**, because
   the cache would serve it. Then confirm the post-restart serve produced zero
   ledger rows, from your own SQL, not from the run log.
8. **`C-FREE` / `C-PAID`.** Re-score the raw run JSONLs with your **own**
   scoring script — do not reuse the surgeon's. Recompute the 2×2 and the
   per-diet breakdown. Confirm both arms carry the same seed and the same DB
   macro fingerprint; if they do not, the comparison is invalid and the claim is
   falsified regardless of the numbers. State the honest direction, including
   "no measurable change".
9. **`C-WEB`.** Diff `backend/data/recipeSources.json` against its pre-run state.
   Any `enabled: true` falsifies the claim. Then grep the run logs for outbound
   fetches to those hosts; any hit falsifies it too.
10. **`C-ROUTES` / `C-UI`.** Confirm keyless refusal by reading the route code's
    gate path, not the transcript. For the UI, confirm no new hex literals
    outside the theme tokens and no green on a non-accent surface — then say
    plainly that visual meaning is TRUST-BASED and you did not judge it.
11. **The harness itself.** Read `.claude/hooks/*`, `settings.json` and
    `.git/hooks/pre-push`. Confirm each guard's logic actually blocks what it
    claims to block. Confirm the A9 lock removed `.claude/` and
    `scripts/surgery/` from the allow list. A guard whose proof exists but whose
    code cannot block is `FAILED-OPEN`, and you say so.

---

## RECEIPT v3 — you sign it, alone

Write `docs/surgery/<run_id>/verify/RECEIPT-v3.md`:

```
run_id:          surgery-recipe-brain-<...>
verifier_run_id: verify-<YYYYMMDD-HHMM>

== HARNESS ==
guard-edit:     PROVEN-BLOCKS | FAILED-OPEN — <evidence ref>
guard-bash:     ...
pre-push:       ...
witness caps:   ...
cage-lock (A9): ...

== VERDICTS ==   (every line: claimed:S / verdict:V / how you re-derived it)
C-LAND:    claimed:S / verdict:VERIFIED  — ran suite myself: N files / M tests, floors N'/M' — E-V1
C-OFF:     claimed:S / verdict:...       — re-ran both seeds, own diff — E-V3
C-SEAM:    ...
C-ROUTES:  ...
C-DURABLE: ...
C-UI:      ...
C-WEB:     ...
C-FREE:    ...
C-PAID:    ...
C-SAFE:    ...

== NEW BLOCKERS ==
<every falsified or unverifiable claim, as work>

== NEXT PROMPT MUST ==
<derived from YOUR verdicts only — never from the surgeon's claims or transcript>
```

Stop at the receipt. Nothing after it.

**END PROMPT V**
