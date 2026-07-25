> # ⚠ VERDICT VOID — 2026-07-24
> **This report's headline — 25 leak candidates across 3 categories, and
> "recipes affected: 0" in every row — is a large undercount.** A later
> adversarial sweep found **200 leaking food rows** and **210 recipe×allergy
> pairs** reachable by a user. The numbers are void; the method is kept.
>
> **Why it is void — the oracle was thinner than real food composition.**
> The method compares the app's matcher against *"the QC oracle's INDEPENDENT
> curated list."* That makes the report a measure of the oracle, not of the
> food library. Where the oracle had never heard of an ingredient, both sides
> agreed there was nothing to exclude, and the pair was scored clean. The
> examples it *did* surface (infant formula, Japanese chestnuts, quiche) are
> the shallow end — it missed carriers like sodium caseinate in non-dairy
> whipped topping, fish and shellfish in kimchi, fish in tapenade and pho, egg
> in dressings (~36 rows), and gluten in granola bars.
>
> **The "0 recipes affected" column is the most misleading part.** It was
> computed over ingredient *names* only. The real leaks reach users through
> surfaces the solver correctly hides but other code paths do not: library
> browse (`recipes.js`), cart (`cart.js`), AI swap (`weeklyPlanner.js`) and the
> brain pool (`exclusions.js`) match ingredient names alone, while
> `planContext.filterRecipePool` also scans step prose and the title. So
> `Sushi` ("half a prawn" in step 3) reaches a shellfish-allergic user and a
> tahini recipe with tahini only in its title reaches a sesame-allergic one —
> none of which this report could see. A "0" here means "the oracle and the app
> agreed," never "no user can reach an allergen."
>
> **Read the false-exclusion section as understated too.** Over-blocking is
> also worse than reported: gluten excludes 47 explicitly gluten-free products,
> and tree-nuts excludes 57 peanut-butter rows (`"nut butter"` matched as a
> substring inside `peanut butter`) plus 15 coconut rows.
>
> **What is actually needed:** one shared filter across every surface (title +
> step prose + ingredient metadata), an oracle built from composition rather
> than name lists, and per-surface tests. Tracked in `BATTLE-PLAN.md` (Phase 1).
> Until then, `WellbeingCheck.jsx`'s disclaimer — *"It cannot guarantee any plan
> is free of a given allergen; always read labels"* — is the honest statement of
> where this app stands, and no surface may promise more than it.

# Cut Protocol — 14k allergen sweep (Phase 1D)

- Corpus: 14124 foods · 889 recipes · 10 allergen categories.
- Method: app matcher (dietaryFilter) vs the QC oracle's INDEPENDENT curated list.

## Leak candidates — a real allergen the app's list does NOT exclude (P0)
| category | distinct foods | recipes affected | examples |
|---|--:|--:|---|
| **dairy** | 3 | 0 | Infant formula, ABBOTT NUTRITION, SIMILA · Infant formula, ABBOTT NUTRITION, SIMILA · Infant formula, ABBOTT NUTRITION, SIMILA |
| **tree nuts** | 15 | 0 | Nuts, chestnuts, japanese, boiled and st · Nuts, chestnuts, japanese, roasted · Nuts, chestnuts, japanese, dried |
| **eggs** | 7 | 0 | Quiche with meat, poultry or fish · Spinach quiche, meatless · Cheese quiche, meatless |

## False exclusions — a known-safe food the app WRONGLY excludes (own ZERO bar)
- **gluten**: Rice flour, Corn tortilla
- **peanuts**: Tree nut mix (no peanut)

_Generated 2026-07-23T03:06:40.504Z. Leak candidates are oracle-flagged; each needs a same-day human confirm before a synonym fix (the oracle list can over-claim)._
