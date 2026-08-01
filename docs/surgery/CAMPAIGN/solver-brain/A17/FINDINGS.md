# A17 — Closer expansion: what gates it, and what happens as the gate widens

*Agent A17. Persisted to disk by the fleet coordinator from A17's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A17's.
A17's 12 new artifacts and 20 `CLAIMS.tsv` rows DID land.*

**Null result first: widening the closer's candidate set does not work, and it leaks.**
Density-ranked widening (+8 rows per role, both product gates applied) moved satisfiable-only
**+0.19 pts** (b=5, c=6) — unresolved at C14's 3.45 pt floor. All-days moved +1.61 pts (b=5,
c=15), also below the floor for a two-directional treatment. **DERIVED:** all-days gained 10
days, satisfiable-only gained 1 — so **9 of the 10 gained days sit in the IMPOSSIBLE tier**,
whose correct output is a refusal (C7). The widening scores points on customers the app should
decline.

**And it realizes the C13 latent leak.** MEASURED, s424242: the widened set offered
`Sea cucumber, yane (Alaska Native)` as a *protein adjuster* on 439 vegan and 229 vegetarian
invocations, and **placed** it 309 times (277 vegan / 32 vegetarian) — 13.3 % of 2,320
placements. **Automatic fail, integrity rule 2.**

**Contradiction with C16, stated loudly:** `oracle.mjs` **misses 12 of the 13 C13 rows**
(only the `Seal, bearded (Oogruk), meat` row is CAUGHT — the literal token `meat` is in its
`ANIMAL_MEAT` list, `oracle.mjs:80`). Run over the leaking arm, oracle reported **0 leaks**.
The mandated independent verifier shares the product gate's blind spot. *"oracle says zero"
is not a safety warrant for a candidate-set widening.*

## The premise number is wrong

The prompt's "240 of 2,432 slots (9.9 %)" uses a denominator the closer cannot reach.
`macroCloser.js:116` reads `const host = slots.find(` — **one** host slot per day.
**MEASURED:** 957 of 2,072 invocations fire = **46.2 %**. **DERIVED:** the structural cap on
any per-filled-slot rate is 622 judged days / 2,818 filled slots = **22.1 %**. The per-slot
framing understates the gate ~4.5×.

## What actually gates it (n=2,072 invocations, s424242, MEASURED)

| terminal state | n | share |
|---|---|---|
| `noGap` — no *shortfall* left (includes every OVER-band day) | 983 | 47.4 % |
| `allCandsHarmful` — `wouldHarm` blocked every candidate | 909 | 43.9 % |
| `capReached` — the 3-addition cap (`:128`) | 90 | 4.3 % |
| `noHost` | 85 | 4.1 % |
| `noSlots` | 5 | 0.2 % |
| `noAdjusters` / `noTarget` | 0 | 0 % |

Candidate scarcity binds only on protein: **270 of 1,140** round-0 protein gaps had zero
available protein adjuster (23.7 %); fat 0/348; carb 15/339. The 10-row list is not the
binding gate — `wouldHarm` and the absence of any shortfall are.

## The trimmer (C9 scope) — priced, and disqualified as prototyped

| | s424242 | s20260730 |
|---|---|---|
| satisfiable-only | 77.1 → **92.0 %**, **+14.93 pts**, b=4 c=84, CI +11.74…+18.11 | 77.8 → **92.4 %**, **+14.55 pts**, b=2 c=80 |
| all days | 69.8 → 83.1 %, +13.34 | 70.4 → 83.4 %, +13.02 |

Cross-seed spread 0.38 pts; 4× the C14 floor. **87 days gained, 4 lost; 53 of the 87 had been
failing on fat.** I independently confirm C9/A15: baseline fat-failing days are **97 OVER, 1
SHORT**.

**Cost — what it breaks.** (a) **Honesty regression, disqualifying:** s424242 produced 1
verdict-disagreement and 1 silent miss (`p237#6`, EASY, style `none`: engine claims
`inBand=true, matchPct=87`, grader says false, `hasWarning=false hasDiagnosis=false`).
Baseline 0/0; s20260730 0/0. Structural, not a one-off — the trimmer mutates totals *after*
the solver forms its warning. Any shipped version must run inside the solver's verdict, not
after it. (b) **Plate acceptability:** 2,034 cuts over 890 firings; **median 48.9 % of a real
component deleted**, 46.6 % pinned at the 0.5 cap, 20.0 % leave under 20 g. Most-trimmed:
Olive Oil ×135, Beef jerky ×134, Hummus ×102. This is the "13 g of cabbage in a cabbage stew"
shape `macroCloser.js:16` says customers rejected — reintroduced from the other side.
**ESTIMATED** build cost: ~150 lines mirroring `wouldHarm`, plus rewiring so the verdict is
computed post-trim; the honesty rewire, not the arithmetic, is the work. Test: re-run this
prototype with the verdict recomputed after trim and require verdict-disagreements = 0.

## Instrument validation — the chain passed, and it earned its keep

| arm | byte-identical day records | satisfiable-only delta |
|---|---|---|
| passthrough (hook installed, original fn called) | **639/639** | +0.00, b=0 c=0 |
| re-implementation **v1** | 559/639 | −0.37 (b=5 c=3) |
| re-implementation **v2** | **639/639** | +0.00, b=0 c=0 |

v1 was **wrong** — `out.indexOf(target)` returned −1 after round 1, silently discarding
additions 2 and 3. The control caught it. Every A17 delta is measured against the v2 clone,
proven identical to the shipping closer.

**C18:** I did not run `checkdb.mjs` and did not re-copy. All six arms carry
`dbHash=e55f52e53658a086`, `foodFingerprint=423e7279ed6af641`, `foodRows=14151` — the fleet
baseline.

## Verdict on the assigned question

Widening the closer's candidate set is **falsified** as a lever: no resolvable gain, gain
concentrated in the refusal tier, and a realized diet-style leak the independent oracle cannot
see. The mechanism that *does* move the number is the one the closer structurally lacks —
subtraction — worth ~+14.7 pts satisfiable-only, contingent on being built inside the honesty
layer rather than after it.

**FALSIFIED**
