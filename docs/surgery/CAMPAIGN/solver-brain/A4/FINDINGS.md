# A4 — Is the fat band defensible?

*Agent A4. Written to disk by the fleet coordinator from A4's returned deliverable —
the subagent could not create this file itself (see Blockers). Content is A4's.*

**Headline: the ±8 % band is real, but it is not the pass/fail boundary.** The
boundary that actually grades a day is **±33.1 %** around the same midpoint. The
question as posed tests a number that never decides anything.

## 1. Code verification (MEASURED — quoted from source)

- `backend/src/lib/bmrEngine.js:322` — `let fatLo = Math.round(lbmLb * 0.34);`
- `backend/src/lib/mealSolver.js:212` — `const DAY_FAT_TOLERANCE_PCT = 0.25;`
- `backend/src/lib/mealSolver.js:250` — `fatOk: !fatBand || (fat.shortPct <= DAY_FAT_TOLERANCE_PCT`
- `mealSolver.js:205` self-describes the band as *"about ±8% around the midpoint"* — accurate.

**DERIVED.** mid = 0.37·lbm; half-width 0.03·lbm → 0.03/0.37 = **±8.11 %**.
Brief CONFIRMED for the default path.

But `bandMiss` (`mealSolver.js:218-225`) divides by **mid**, not by the band edge:

- pass floor = 0.34·lbm − 0.25(0.37·lbm) = **0.2475·lbm**
- pass ceiling = 0.40·lbm + 0.25(0.37·lbm) = **0.4925·lbm**
- half-width 0.1225/0.37 = **±33.1 %** — **4.08× the nominal band**

## 2. Two contradictions of the brief (rule 12)

**(a) The band is not universal.** Keto (`bmrEngine.js:313`) and the carb-floored
path (`:341-342`) use `fatMid * 0.9 … * 1.12` — asymmetric, **±10.9 %** nominal /
**±35.9 %** effective. The brief's blanket `lbm × 0.34…0.40` describes only the
default path.

**(b) The grading rule passes days below the engine's own essential-fat floor.**
`bmrEngine.js:286` — `const ESSENTIAL_FAT_PER_LB_LBM = 0.3;`, described at
`:284-285` as *"fat never drops below this"*. The effective pass floor is
**0.2475·lbm — 17.5 % below it**. A day can grade in-band while sitting under the
constant the engine calls essential. **This is a defect independent of any
literature.**

## 3. Literature (all fetched and quoted; none cited from memory)

| Source | Fat guidance | Relative half-width |
|---|---|---|
| NASEM AMDR, adults | **20–35 % of energy** | ±27.3 % |
| Delany 2025, scoping review of expert groups | **15–30 % of energy**, 7 recommendations total | — |
| Cut Protocol nominal | 0.34–0.40 g/lb LBM | **±8.1 %** |
| Cut Protocol effective | 0.2475–0.4925 g/lb LBM | ±33.1 % |

**DERIVED:** AMDR relative half-width = 7.5/27.5 = ±27.3 %. The app's **nominal**
band is **3.4× tighter than the AMDR**. Its **effective** window (±33.1 %) is
slightly *looser* than the AMDR — as an actual pass/fail rule it is not too tight
at all.

Delany et al. found expert guidance on fat *"focussed minimal attention"* and
*"the language used was often vague, leaving significant room for
interpretation."* **No body expresses fat intake at ±8 % precision.** ESTIMATED:
none plausibly could — day-to-day biological need does not resolve at that scale.

## 4. The real exposure: units, not width

Fat is anchored to **LBM**; every cited guideline is a **% of energy**. The app's
fat share therefore floats with the calorie target.

**DERIVED**, worked example (ESTIMATED inputs: 180 lb male at the engine's own
`ASSUMED_BODY_FAT_PCT.M = 21` → LBM 142 lb; fatLo 48 g, fatHi 57 g, mid 52.5 g):

| target kcal | nominal band as % energy | vs AMDR floor 20 % |
|---|---|---|
| 2000 | 21.6 – 25.7 % | inside |
| 2400 | 18.0 – 21.4 % | **straddles / below** |
| 2800 | 15.4 – 18.3 % | **below AMDR and below 15 %** |

Break-even: 52.5 g × 9 = 472.5 kcal; 472.5/0.20 = **2362 kcal**. Above roughly a
2360 kcal target, this profile's fat midpoint falls **below the AMDR floor**.

## 5. Defensible alternative — a floor, not a wider band

The evidence supports **no** change to band width. It supports adding a rule of a
**different shape**:

> **Fat must be ≥ 20 % of target energy**, in addition to the existing band.
> Justification: NASEM AMDR lower bound (20 % of energy), corroborated by Delany
> 2025 reporting three expert papers advising against restriction below 15 %.

Second, **reconcile the effective pass floor with `ESSENTIAL_FAT_PER_LB_LBM`** —
the grading rule should not pass what the engine itself calls essential-fat
deficient.

**Changing the band is the owner's call, not mine.** Per integrity rule 1 this is
a nutrition question answered independently of its metric effect. **I did not
measure the metric effect — that is A15's, deliberately separated.** ESTIMATED: a
20 %-energy floor would *tighten*, not loosen, so it is not a metric-raising move.

## 6. Blockers

- **Guard block (recorded, not circumvented):** `fleet-sandbox.js` blocked Read of
  WebFetch's PDF cache under `~/.claude/projects/`. Cost two full texts. Pivoted
  to HTML-native sources.
- **Write block:** could not create this `FINDINGS.md` from the subagent; returned
  as text and persisted by the coordinator.
- `UNVERIFIED — could not fetch`: **Thomas, Erdman & Burke 2016** ACSM/AND/DC joint
  position stand (jandonline 402, drugfreesport PDF 403, LWW 402). Search snippets
  claim a "≥20 % of energy" athlete floor consistent with AMDR, **but the source
  could not be read and is not cited as support.**
- `UNVERIFIED — could not fetch`: **Whittaker & Wu 2021**, low-fat diets and
  testosterone, J Steroid Biochem Mol Biol 210:105878 — also carries a **2026
  corrigendum** that could not be read. Not used as evidence.

## Citations (fetched and read)

1. National Academies of Sciences, Engineering, and Medicine (2024). *Rethinking
   the Acceptable Macronutrient Distribution Range for the 21st Century: A Letter
   Report.* National Academies Press.
   https://www.nationalacademies.org/read/27957/chapter/5 — AMDR adults: fat
   20–35 %, carbohydrate 45–65 %, protein 10–35 % of energy.
2. Delany, L.V., Costello, N., Jones, B., Backhouse, S.H. (2025). *Dietary
   Recommendations for Body Mass and Composition Manipulation in Male and Female
   Athletes: a Scoping Review of Consensus Statements, Position Stands and
   Practice Guidelines from International Expert Groups.* Sports Medicine. DOI
   10.1007/s40279-025-02285-4 — https://pmc.ncbi.nlm.nih.gov/articles/PMC12513969/
   — fat recommendations *"ranging from 15 to 30% of energy intakes"*.
3. Aragon, A.A., Schoenfeld, B.J., Wildman, R., Kleiner, S., VanDusseldorp, T.,
   Taylor, L., Earnest, C.P., Arciero, P.J., Wilborn, C., Kalman, D.S., Stout,
   J.R., Willoughby, D.S., Campbell, B., Arent, S.M., Bannock, L., Smith-Ryan,
   A.E., Antonio, J. (2017). *International Society of Sports Nutrition position
   stand: diets and body composition.* JISSN 14:16. DOI
   10.1186/s12970-017-0174-y — https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/
   — *"The AMDR set protein at 10–35%, carbohydrate at 45–65%, and fat at 20–35%
   of total energy."*

**FALSIFIED**
