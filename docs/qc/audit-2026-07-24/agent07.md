# Agent 07 — free-text exclusion path, end to end through the real generator

**Scope:** FREE-TEXT `excludedFoods` entries only (checkbox allergens = agents 05/06).
**Method:** read-only. `backend/prisma/dev.db` copied to scratchpad; every run
loaded the REAL modules — `planContext.filterRecipePool()` →
`mealSolver.generateBestWeekPlan()` (28 slots, 3 meals + 1 snack, 2200 kcal /
165 P) — then walked every SHIPPED ingredient row (`slot.ingredients[]`, with
grams) and every recipe `steps[]` string of the generated week.
Corpus: **889 recipes, 14,122 foods.** Base pool (no exclusions) = 889 recipes.
No source file was modified; nothing was written to the real DB; port 3001 untouched.
Scripts: scratchpad `a07/probe2.mjs` (generator walk), `a07/probe3.mjs` (edges),
`a07/probe4.mjs` (false friends / dead terms).

---

## 1. Per-term result for the 27 requested strings

`kind` is `resolveExclusionTerm()`'s verdict. `pool` = recipes surviving
`filterRecipePool` out of 889. "Leak" = a member of the family the user meant,
found in the SHIPPED week.

| term | kind | category | pool | leak in generated week |
|---|---|---|---|---|
| lactose | alias | dairy | 582 | none |
| casein | alias | dairy | 582 | none |
| whey | alias | dairy | 582 | none |
| wheat | alias | gluten | 458 | none |
| semolina | alias | gluten | 458 | none |
| durum | alias | gluten | 458 | none |
| spelt | alias | gluten | 458 | none |
| farro | alias | gluten | 458 | none |
| seitan | alias | gluten | 458 | none |
| gluten | category | gluten | 458 | none |
| albumen | alias | egg | 653 | none |
| groundnut | alias | peanuts | 855 | none |
| arachis | alias | peanuts | 855 | none |
| prawn | alias | shellfish | 812 | none |
| crustacean | alias | shellfish | 812 | none |
| shrimp | alias | shellfish | 812 | none |
| **cow's milk** | **literal** | — | **889 (0 removed)** | **YES — 16 dairy rows shipped** |
| **dairy-free** | **literal** | — | **889 (0 removed)** | **YES — 16 dairy rows shipped** |
| nuts | category | nuts | 791 | none |
| **seafood** | **literal** | — | 886 (3 removed) | **YES — White Fish shipped** |
| **red meat** | **literal** | — | **889 (0 removed)** | **YES — Beef jerky, Pork rinds shipped** |
| **pork** | **literal** | — | 857 | **YES — "Bacon, cooked" shipped** |
| gelatin | literal | — | 886 | none this week (matches only literal "gelatin"/"gelatine") |
| MSG | literal | — | 889 (0 removed) | none this week; matches nothing but a literal "MSG" name |
| **nightshades** | **literal** | — | **889 (0 removed)** | **YES — Russet Potato, Bell peppers shipped** |
| soya | alias | soy | 753 | none |
| **sulphites** | **category** (recognised) | sulphites | **889 (0 removed)** | inert — see F4 |

**Verdict on the alias map itself: it works.** All 18 alias/category terms above
resolved to the right category and shipped a clean week through the real
generator. The failures are all terms the map does not contain.

---

## F1 (P0) — "cow's milk" and "dairy-free" exclude NOTHING; the week ships dairy

Both fall through to literal substring. Neither string appears in any food name,
so **0 of 889 recipes are removed** and the generated week served:

- `Cottage Cheese` (82 kcal/100 g) in 6 different shipped slots
- `Greek Yogurt` / `Greek yogurt, 0%` in 2 shipped slots
- step prose: *"Cook the cottage cheese."*, *"Stir almonds and berries into the yogurt."*

`matchesExclusionTerm("Cottage Cheese", "cow's milk") === false`;
`("Whole Milk", "cow's milk") === false`; `("Cheddar Cheese", "dairy-free") === false`.

"cow's milk" is the single most likely phrasing on a milk-allergy label; "dairy-free"
is how the constraint is written on every package the user owns. Both are one
`FREE_TEXT_ALIASES` line away from working.

## F2 (P0) — a whole class of natural phrasings excludes nothing

Every one of these resolves `literal` and removes **0** recipes (pool stays 889):

| typed | probe result |
|---|---|
| `gluten free`, `gluten-free` | Wholewheat Bread / Spaghetti / Semolina all LEAK |
| `lactose free`, `lactose-free`, `no dairy`, `dairy free`, `dairies` | Whole Milk / Cottage Cheese LEAK |
| `milk allergy`, `nut allergy`, `peanut allergy`, `shellfish allergy`, `soy allergy`, `wheat allergy` | every family member LEAKS |
| `lactose-intolerant` | LEAKS (but bare `lactose intolerance` IS an alias — inconsistent) |
| `dairy!`, `dairy.` | LEAK (punctuation is never stripped) |
| `cows milk` (no apostrophe) | LEAKS |
| `nightshade` / `nightshades`, `red meat`, `MSG`, `shellfish/seafood` | LEAK |

Root cause: `resolveExclusionTerm()` normalises only `trim().toLowerCase()`.
It never strips trailing punctuation, the `-free` / `free` / `allergy` /
`intolerant` / `no ` affixes, or a plural `s`. Note the asymmetry that proves it
is an accident: `lactose intolerance` and `coeliac` ARE aliases, `lactose-intolerant`
and `gluten free` are not.

**Normalisation that DOES hold** (verified): `"Lactose "`, `" LACTOSE"`,
`"LaCtOsE"`, `"  dairy  "`, `"Dairy"` all resolve identically to their category.
Case and surrounding whitespace are fine. Hyphens, punctuation and affixes are not.

## F3 (P0) — the `describeExclusionTerms()` flag is produced but rendered NOWHERE

The flag is correct and complete:

```
{term:"cow's milk", kind:"literal", recognised:false,
 note:"not a recognised allergen — matching on text only"}
```

Grep for `describeExclusionTerms` / `resolveExclusionTerm` across
`backend/src/routes/**` and `frontend/src/**`: **zero hits outside
`dietaryFilter.js` itself and `backend/tests/dietaryAliasMap.test.js`.**
No route returns it; the only free-text UI is a bare input in
`frontend/src/components/ProfileTab.jsx:553` (`placeholder="Add your own —
e.g. cilantro, mushrooms"`) plus `SetupWizard.jsx:169`, neither of which renders
any per-term status. So a user who types "cow's milk" is never told it matched
nothing. Combined with F1/F2 this is the finding: the fail-safe fires, the
honesty layer that was supposed to expose it was never wired to a screen.

## F4 (P1) — `sulphites` is "recognised" and still protects nothing

`sulphites` is a real `CATEGORY_SYNONYMS` key (family `sulphites`), so the UI
would call it recognised — yet it removes **0 of 889 recipes**: no ingredient
name literally says "sulphite", and the metadata probe that was built for exactly
this case is dead. `Food.fdcCategory`, `allergenTags`, `mayContain` are populated
on **0 of 14,122 rows**. `exclusionEvidence()`'s probes 2–4 therefore never fire —
and `planContext.filterRecipePool()` does not call `foodMatchesExclusionTerm()`
at all, only the name-only `matchesExclusionTerm(ing.name, term)`. Same shape
applies to `celery`, `mustard`, `lupin`.

## F5 (P1) — over-exclusion IS excessive on the singular alias `nut`

`nuts` / `tree nuts` are category keys and behave: coconut, nutmeg, butternut,
water chestnut, doughnuts all stay (89% / 92% of pool kept). But the alias branch
of `matchesExclusionTerm()` adds an **unbounded substring probe**:

```js
if (resolved.kind === "alias" && name.toLowerCase().includes(key)) return true;
```

`nut` is an alias (→ tree nuts), so `"coconut".includes("nut")` fires. Measured
against `COMPOUND_FALSE_FRIENDS`, the file's own executable contract:

| name | `nuts` | `tree nuts` | `nut` |
|---|---|---|---|
| Nutmeg, ground | false | false | **true** |
| Butternut squash, raw | false | false | **true** |
| Coconut, raw | false | false | **true** |
| Water chestnut, canned | false | false | **true** |
| Doughnuts, glazed | false | false | **true** |

Same mechanism on the dairy aliases, defeating the documented plant-milk guards:
`milk` excludes Almond/Soy/Oat/Coconut Milk **and** Milkfish; `butter` excludes
Peanut Butter, Butter Beans, Butternut Squash; `cream` excludes Cream of Tartar
and Coconut Cream. Pool cost: `nut` 727 vs `tree nuts` 818; `milk` 551 vs `dairy` 582.
No pool COLLAPSE (the answer to the brief's question is: `nuts` keeps 89%, nothing
close to starvation) — but the alias literal probe silently deletes the plant
substitutes the user was going to eat instead, and it contradicts a contract the
tests assert elsewhere.

## F6 (P2) — `pork` / `red meat` / `gelatin` / `nightshades` have keyword lists that free text cannot reach

`PORK_KEYWORDS` (bacon, ham, chorizo, prosciutto, pancetta, lard, …) exists in
`dietaryFilter.js` but is reachable ONLY from the halal/kosher STYLE branch.
Typing `pork` as an exclusion gets literal matching: `Pork rinds` BLOCKED,
`Bacon, cooked` / `Ham` / `Chorizo` / `Prosciutto` / `Sausages` all LEAK — and
"Bacon, cooked" shipped in the generated week. Same for `red meat` (0 removed,
Beef jerky shipped) and `nightshades` (0 removed, Russet Potato + Bell peppers
shipped). These are religious/medical constraints users plausibly type.

---

## Edges that PASSED — no finding

**Add-only holds.** For nine pairs (`lactose`+`gluten`, `dairy-free`+`dairy`,
`nut`+`tree nuts`, `milk`+`dairy`, `.*`+`dairy`, `""`+`dairy`, `seafood`+`shellfish`,
`red meat`+`pork`, `a`+`gluten`) the two-term pool was always the exact
intersection of the single-term pools: **0 violations**. A free-text term can
never remove an exclusion another probe raised — structurally, because
`filterRecipePool` is `excludedFoods.some(...)` and `matchesExclusionTerm` has no
negative branch.

**Adversarial input does not crash and does not over-match.**
`""`, `"   "`, `"\t\n"` → `kind:"empty"`, pool 889 (correctly ignored, not
matching everything). `.*`, `(?:`, `a|b`, `^$`, `\`, `?`, `+`, `[`, `"*"×50`,
`milk|gluten` → all pool 889, no throw: the literal branch is `String.includes()`,
not a regex, and every regex branch escapes via `escapeRe`/inline escaping.
`"(" `and `")"` remove 4 recipes each — real parenthesised ingredient names,
correct behaviour. A 5,000-char string: pool 889, 76 ms. `MILK`×1000: pool 889,
59 ms. Non-string terms (`42`, `true`, `{}`, `[]`, `null`, `undefined`) all
handled — `null`/`undefined` → `empty`, the rest → harmless literal. No 500.

**Single-character terms are handled but brutal:** `a` → 26 recipes (2.9% kept),
`e` → 3 (0.3%). No crash, and the solver still filled 28/28 slots, but nothing
warns the user their typo emptied the library. Lower priority than F1–F3 because
it is self-evidently visible in the resulting plan.

---

## Top finding

**A milk-allergic user who types "cow's milk" (or "dairy-free") gets a meal week
containing cottage cheese and Greek yogurt, and is never told the term matched
nothing.** F1 + F3 together. F2 generalises it to ~15 other phrasings including
`gluten free` for a coeliac.
