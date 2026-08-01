# A23 — Adversarial verification of every external citation in Phase 2 (A4–A8)

*Agent A23. Persisted to disk by the fleet coordinator from A23's returned deliverable —
subagents cannot create report files (see C4 in `CORRECTIONS.md`). Content is A23's.
A23's `a23-claims-fragment.tsv` and 24 `CLAIMS.tsv` rows DID land.*

**No fabricated citation exists in Phase 2.** All 20 external sources cited by A4, A5, A6, A7 and A8 were located, fetched, and confirmed to say what the citing agent said they say. Every load-bearing number reproduces from primary text. The failure mode this assignment was launched to catch did not occur.

Two sources were *correctly* self-labelled `UNVERIFIED — could not fetch` (A4's Thomas 2016, Whittaker & Wu 2021) and neither was used as support. Two more (A6's Strongr Fastr, Cronometer forum) carry accurate honesty tags. That discipline is the reason this report is short.

## Three corrections — none is a fake source

**1. A7 mislabels the nutritional-yeast provenance.** A7 cites "USDA FoodData Central #1946780 (Bob's Red Mill)" for 13.3 g protein/100 kcal. The Wikipedia table it read labels those values `"Bob's Red Mill brand, manufacturer reported values"` — a manufacturer label, not a USDA analysis. The **figure is right**; the **tier is wrong**. Under CLAUDE.md's provenance rule this is LABEL, not USDA-VERIFIED. A7's recommendation ("one authored concentrate row clears the wall") rests on it, so the report must say LABEL when it quotes 13.3.

**2. A5's formulation class is not in the literature.** A5 writes "This is structurally Leung, Wanitprapha & Quinn (1995)" and classifies the app a **goal-programming MMKP**. Leung 1995 is real and does say "mixed-integer programming", "895 popular recipes", one-week plans — but it never uses MMKP or goal programming. A5 marks the class **DERIVED**, which is correct. **A25 must not upgrade it to "the literature classifies this app as…"** — no source does.

**3. The contaminated tier is worse than A6 said, and did not spread.** The "120-day Macro Tracker Lab study" is not an external study A6 failed to find — macro-trackers.com publishes it about **itself**, on its own methodology page, with no protocol, named author or institution. Its top pick claims portion error "under ±2 %" and 1.8-second logging; the identical ranking is syndicated through openpr.com, a paid press-release wire. **Discard tier confirmed.** Propagation check: a case-insensitive grep for all five domains across `docs/surgery/CAMPAIGN` returns hits only in `A6/FINDINGS.md:64-65` and `CORRECTIONS.md:117-118` — the flag itself. Nothing downstream leaned on them.

## Load-bearing numbers, re-derived independently

| number | who depends on it | verdict |
|---|---|---|
| NASEM AMDR fat **20–35 %E** | A4, C1, A15 | VERIFIED — Table 3-1, *"Fat: 20–35 percent of energy"* |
| AMDR half-width **±27.3 %** | C1 §1, A15's 1.83× | VERIFIED arithmetic — 7.5/27.5 = 27.27 %; A15's 50/27.3 = 1.83 ✓ |
| IIFYM **+5 g / −10 g** | C1 §2 ("2.4× wider") | VERIFIED verbatim — Healthline/Julson; 35.5 g ÷ 15 g = **2.37×** ✓ |
| `ESSENTIAL_FAT_PER_LB_LBM = 0.3` | A4 §2(b), C3, A15 row 5 | VERIFIED in tree — `bmrEngine.js:286`, comment *"fat never drops below this"* |
| Fat 20 %-energy floor | A4 §5, A15 row 4 | VERIFIED — AMDR lower bound + Delany *"three papers advised against excessive restriction below 15%"* |
| A5's **single-digit** greedy-vs-joint gap | A19 | Not a citation — A5's own ESTIMATED prediction with a stated falsifier (>10 pts). Legitimately labelled |

## Full verification table

| Agent | Claim | Source as cited | Verdict | What the source actually says |
|---|---|---|---|---|
| A4 | Adult AMDR fat 20–35 %E | NASEM 2024, *Rethinking the AMDR for the 21st Century: A Letter Report* | **VERIFIED** | Table 3-1: fat 20–35, carb 45–65, protein 10–35 % of energy |
| A4 | Expert fat guidance 15–30 %E; vague language | Delany, Costello, Jones, Backhouse 2025, *Sports Medicine*, PMC12513969 | **VERIFIED** | *"Seven different recommendations… ranging from 15 to 30% of energy intakes, and three papers advised against excessive restriction below 15%"*; *"focussed minimal attention"*; *"often vague, leaving significant room for interpretation"* |
| A4 | ISSN restates AMDR | Aragon et al. 2017, JISSN 14:16, PMC5470183 | **VERIFIED** | Verbatim: *"The AMDR set protein at 10–35%, carbohydrate at 45–65%, and fat at 20–35% of total energy."* |
| A4 | ACSM/AND/DC athlete fat floor | Thomas, Erdman & Burke 2016 | **CORRECTLY UNVERIFIABLE** | Paper exists (JAND 116:501-528 / MSSE 48:543-568). A4 could not fetch it and did **not** cite it as support. Proper handling |
| A4 | Low-fat/testosterone | Whittaker & Wu 2021 | **CORRECTLY UNVERIFIABLE** | A4 excluded it from evidence. Not used, not checked further |
| A5 | 77 foods, 9 nutrients, $39.93 vs $39.69 | Stigler 1945 / NEOS Guide | **VERIFIED** | *"9 equations in 77 unknowns"*; *"His guess… was $39.93 per year"*; simplex optimum $39.69 |
| A5 | 52 studies, 5–37 constraints, three quotes | van Dooren 2018, *Front. Nutr.* 5:48 | **VERIFIED** | All three quotes verbatim; *"The total number of studies included for analysis are 52"*. Search window 2000–2014 **plus** stated 2015–2016 additions, so A5's "2000–2016" is defensible |
| A5 | 1,171 individuals, 32 nutrients, all feasible | Maillot et al. 2010, AJCN 91(2):421–30 | **VERIFIED** | *"a new nutritionally adequate diet was obtained for each individual"*; *"In half the modeled diets, <5 of the foods usually consumed were replaced"* |
| A5 | MIP over 895 recipes, weekly plans | Leung, Wanitprapha, Quinn 1995, BJN 74(2) | **VERIFIED** | *"mixed-integer programming"*, *"895 popular recipes found in Hawaii"*, one-week period |
| A5 | 810 instances; 100 % vs 48 %; 66 %; <100 ms | Aguilera Moreno 2026, arXiv:2605.13849 | **VERIFIED** | *"810 instances (30 USDA foods, 9 configurations, 3 methods)"*; *"strictly better… in 66% of cases… while maintaining 100% feasibility; hard-constraint IP achieves only 48%"*; *"Solve times stay under 100 ms"*. Single-author preprint; the date-vs-ID discrepancy A5 flagged is real (Submitted 12 Mar 2026, ID 2605) |
| A5 | MMKP NP-hard in the strong sense | Htiouech & Alzaidi 2017, IJCA 174(6) | **VERIFIED** | *"The MMKP is an NP-Hard optimization problem in strong sense."* |
| A5 | App is a "goal-programming MMKP", "structurally Leung 1995" | — | **DERIVED, not cited** | No source classifies Cut Protocol. Leung 1995 uses neither term. A5 labelled it DERIVED correctly; downstream must not promote it |
| A6 | Fitia ±10 %, calories only | Fitia help article | **VERIFIED** | *"±10% margin… Lower limit: 1,800 kcal Upper limit: 2,200 kcal"*; no per-macro tolerance on the page |
| A6 | MacroFactor refuses adherence feedback | Nuckols, MacroFactor, upd. 12 Sep 2025 | **VERIFIED** | *"if you exceed your calorie or macronutrient allotments"*; the ~300 kcal figure **is** framed as a user's own standard, as A6 said |
| A6 | MacroFactor streaks ≠ adherence rate | Kekelishvili, MacroFactor, upd. 25 Sep 2024 | **VERIFIED** | *"emphasize the habit of tracking, effort, and consistency over perfection"*; no adherence rate |
| A6 | Carbon: "optimal range", no numbers | joincarbon.com/how-it-works | **VERIFIED** | *"sticking within the optimal range"* — never numerically defined |
| A6 | Eat This Much: loose, user-set ranges | eatthismuch.com/how-to | **VERIFIED** | *"We also suggest fairly loose ranges"*; no percentage published |
| A6 | Prospre: undefined accuracy levels | prospre.io/features | **VERIFIED** | *"how accurate you need your macros to be"* — levels never defined |
| A6 | RP Diet Coach publishes no tolerance | RP Strength, 29 Sep 2025 | **VERIFIED (negative)** | Page defines no numeric band. Date correct |
| A6 | Cronometer target/threshold | forums.cronometer.com #5721 | **VERIFIED as labelled** | User "Beat": *"set a 'Daily Target' and 'Maximum Treshold'"*; no staff reply; 2023. A6's UNVERIFIED-as-official tag stands |
| A6 | Strongr Fastr upper/lower limits | — | **CORRECTLY UNVERIFIABLE** | A6 marked it UNVERIFIED (search-summary only). Not reached by A23 either. Nothing rests on it |
| A6 | IIFYM +5 g / −10 g | Julson, Healthline, 14 Jun 2023 | **VERIFIED** | Verbatim: *"don't go over each macronutrient by more than 5 grams, or under by more than 10 grams"* |
| A6 | Contaminated SEO tier | macro-trackers.com et al. | **CONFIRMED, and sharpened** | The "120-day study" is macro-trackers.com's own self-published methodology, not a locatable third-party study. Zero downstream citations of the tier |
| A7 | Nutritional yeast 13.3 g P/100 kcal | Wikipedia citing FDC #1946780 | **FIGURE VERIFIED / PROVENANCE MISATTRIBUTED** | Table reads *"Bob's Red Mill brand, manufacturer reported values"* — 8 g P / 60 kcal per 15 g. LABEL tier, not USDA-VERIFIED |
| A8 | Three medal categories | SAT Competition 2024 medals | **VERIFIED** | *"all categories of the main track, i.e., SAT, UNSAT, SAT+UNSAT"* |
| A8 | Certificate requirement + DQ rule | SAT Competition 2024 rules | **VERIFIED** | *"Printing a model… is required for all tracks expect for 'No-limits'. Additionally, UNSAT certificates (proofs) are required for the Main track."*; *"if a solver reports UNSAT on an instance that was proven to be SAT by some other solver"* |
| A8 | IIS definition | Gurobi support article 360041448572 | **VERIFIED** | *"a minimal subset of constraints and variable bounds that, if isolated from the rest of the model, is still infeasible"*. A8's own note to check the support article, not the docs page, was right |
| A8 | Infeasible Set, 44 instances | MIPLIB 2017, ZIB | **VERIFIED** | *"The Infeasible Set"*, 44 instances |
| A8 | INFEASIBLE distinct from TIME_LIMIT | Gurobi status codes | **VERIFIED** | INFEASIBLE(3) *"Model was proven to be infeasible"*; TIME_LIMIT(9) separate |
| A8 | MUS algorithms | Liffiton & Sakallah 2008, JAR 40:1–33 | **VERIFIED bibliographically** | Springer 303s to an auth endpoint; title/authors/journal/volume/pages/year confirmed. No A8 claim rests on it — decorative |

## Method and limits

Every verdict above comes from a fetch of the cited URL in this session, not from memory. Where a host refused (Springer), the record was confirmed by search plus the author's hosted PDF and marked bibliographic-only. I did **not** re-verify A7's botanical classifications, nor A4/A6/A7's internal arithmetic beyond re-deriving the six load-bearing figures in the table above (all six reproduce). Read-only throughout; no DB touched; port 3001 never probed.

**Blockers, recorded not circumvented:**

1. Appending via `printf` with quoted source text tripped a shell-quoting failure in the Bash tool. Staged the 24 rows through the Write tool into `docs/surgery/CAMPAIGN/solver-brain/A23/a23-claims-fragment.tsv` and appended with `cat … >> CLAIMS.tsv`. All 24 rows present, all 6 fields.
2. **C4 reproduces.** The Write tool refused `A23/FINDINGS.md` with *"Subagents should return findings as text, not write report files."* Returned as text per C4's mitigation.
3. Note for the coordinator: `CLAIMS.tsv` grew by 2 lines from other agents *between* two consecutive `wc -l` calls. It is being written concurrently — any line-count audit of it is a moving figure and should key on `grep -c "^A<id>"`, not totals.

**CONFIRMED**
