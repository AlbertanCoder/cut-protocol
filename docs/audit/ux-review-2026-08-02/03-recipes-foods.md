# 03 — Recipes and Foods: browsing, searching, the food library

## Verdict

Two very different screens wearing one nav item. **Recipes is in good shape** — plain-English
sorts, honest trust banners, a row that tells you protein-per-calorie before you click. **Foods
is the problem, and the problem is ranking, not data.** The corruption scare is largely over
(80 bad rows, correctly flagged — not the 470 the code comments still claim), but food search has
*no relevance ranking at all*: it filters by substring and renders in category-then-alphabet
order. I typed "chicken" on screen and got **"824 matches"** with thirteen visible rows of
burritos, Carrabba's chicken parmesan and fast-food fillet sandwiches — "Chicken Breast" is at
**position 230**. The sharpest trust failure is smaller and nastier: 29 zero-macro placeholder
rows render with **no warning of any kind**. Searching "greek yogurt" returns four rows; three are
real (59/59/61 kcal) and the fourth, **"Non-fat Greek yogurt", shows `0  0P 0F 0C`** in identical
chrome to the other three.

Answering the question behind the brief: on Recipes, **yes** — he can find and trust something in
15 seconds. On Foods, **no** on both counts.

---

## What's already working

Do not touch these.

- **The quarantine flagging is real and accurate.** `quarantineNote()`
  (`frontend/src/data/foodCategories.js:129-144`) matches on what the row *asserts*
  (`carried fdcId <n> "<name>"`) rather than a code whitelist. I ran that exact regex over all
  14,151 live rows: it fires on **exactly 80**, and exactly 80 rows mention a carried record. No
  false positives, no misses. The detail sentence names the food whose numbers you're looking at
  and explains *why the calorie check didn't catch it*.
- **The Foods header refuses to oversell the Atwater check.** On screen: "14,151 foods · per 100 g
  · calories are cross-checked against each row's own protein, carbs and fat — that catches
  impossible numbers, not another food's numbers filed under the right name"
  (`FoodsTab.jsx:549`). That is the honest sentence, and it is rare. Keep it.
- **Recipe sort labels are already de-jargoned.** `RecipesTab.jsx:1068-1070` — "Sort A–Z",
  "Fewest calories first", "Most protein per calorie". The comment at :1064 records that "Protein
  density" was deliberately killed. This is the plain-English pattern Shad asked for; propagate it
  elsewhere rather than reverting it here.
- **The recipe row is well-designed for a cutter.** `RecipesTab.jsx:1155-1171` puts name, slot
  type, cuisine, prep time, **g protein per 100 kcal**, source badge and kcal on one line. He can
  triage without opening anything.
- **The recipe trust banner is proportional.** Seen on screen: "132 of 910 recipes here use at
  least one food whose stored numbers belong to a different food, so their calorie totals are
  estimates. In 6 of them that is most of the total — those are marked. This is a problem with the
  food library, not with these recipes." (`RecipesTab.jsx:1079-1088`, `MATERIAL_SHARE = 0.6` at
  :112.) It quantifies, it scopes, and it assigns blame correctly.
- **Load-failure states are distinct from empty states** in both words and shape
  (`FoodsTab.jsx:603-621`, `RecipesTab.jsx:1093-1108`). A failed fetch never renders as "your
  database is gone."

---

## Findings

### F1. Give the 29 zero-macro placeholder rows a warning icon in the list

- **Saw:** `foodWarning()` (`foodCategories.js:147-149`) returns `quarantineNote(food) ||
  dataQualityFlag(food)`. Neither branch tests `source === "manual-placeholder"`. That check exists
  *only* inside the detail panel (`FoodsTab.jsx:295`, :310, :323-327), so `FoodRow`
  (`FoodsTab.jsx:102-128`) draws a placeholder with no triangle — identical chrome to a verified
  row. **Confirmed on screen:** searching `greek yogurt` in Food database returns "4 matches" —
  `Greek Yogurt 59`, `Greek yogurt, 0% 59`, `Greek yogurt, plain, nonfat (skyr-style) 61`, and
  `Non-fat Greek yogurt` **`0  0P 0F 0C`**. Same grey dot, same bold white name, no icon. The amber
  banner directly above it ("80 of these rows are known to carry another food's numbers") does not
  cover this class of row at all.
  Same shape for `cottage cheese` → 7 results, #7 is `low-fat cottage cheese` at 0 kcal. Also among
  the 29: "cooked chicken breast", "Ground chicken breast, cooked", "Pork tenderloin, cooked",
  "shelled cooked edamame".
- **Costs:** Four of his six staples have a 0-kcal impostor sitting in their results, visually
  indistinguishable from the real row. Because `suspectCount` (`FoodsTab.jsx:529`) counts only
  `quarantineNote` rows, these 29 are also absent from the library's own honesty count — nothing on
  the screen admits they exist. **Mitigating, and I checked:** **zero** of the 910 recipes use a
  placeholder, so no recipe total is wrong today. This is a picking hazard, not live corruption.
- **Do:** Add a third branch to `foodWarning()` in `frontend/src/data/foodCategories.js:147`:
  `if (food?.source === "manual-placeholder") return { label: "NO REAL DATA", detail: "This row has
  no macros entered — 0 kcal is a placeholder, not a measurement." }`. One function, one branch;
  `FoodRow` and the summary count both pick it up for free.
- **Size:** trivial
- **Confidence:** high

### F2. Rank food search by match quality instead of alphabet

- **Saw:** `FoodsTab.jsx:519-524` — the entire search is
  `for (const f of foods) if ((f.lname || "").includes(q)) out.push(f)`. No scoring. Order is
  inherited from the server's `orderBy: [{ category: "asc" }, { name: "asc" }]`
  (`backend/src/routes/foods.js:73`), and search renders one flat window (`FoodsTab.jsx:630-637`,
  `maxRows={14}`, `ROW_H = 38`). **Confirmed on screen** for `chicken`: header reads "824 matches",
  and rows 1-13 are `Burrito, chicken, cheese` · `Burrito, chicken, with beans and rice, cheese` ·
  `Burrito, chicken, with beans, cheese` · `Burrito, chicken, with rice, cheese` · `CARRABBA'S
  ITALIAN GRILL, chicken parmesan…` · `Chicken and vegetable entree with noodles and cream sauce,
  frozen meal` · `Chicken deli sandwich or sub…` · `Chicken egg foo yung` · then five `Chicken
  fillet sandwich…` rows. Not one plain chicken breast above the fold. Replaying the app's own
  filter and sort over the full payload:

  | query | matches | first result | where the obvious answer lands |
  |---|---|---|---|
  | `chicken` | 824 | Burrito, chicken, cheese | **"Chicken Breast" at #230** |
  | `beef` | 1,355 | Beef and macaroni with cheese sauce | no plain lean-beef row exists |
  | `egg` | 364 | BURGER KING, CROISSAN'WICH with Egg | no plain "Eggs" row |
  | `yogurt` | 157 | Baby Toddler fruit and vegetables, with yogurt | "Greek Yogurt" at #37 |
  | `cottage` | 29 | Cheese, cottage cheese, with gelatin dessert | "Cottage Cheese" at #23 |
  | `cheddar` | 31 | Babyfood, mashed cheddar potatoes | "Cheddar Cheese" at #3 |

- **Costs:** Four of six staples fail the 15-second test on the first word a person types.
  "Chicken Breast" at #230 in a 14-row window is **~216 rows of scrolling past burritos**. It is
  recoverable — typing the second word fixes it (`chicken breast` → 40 matches, real one at #5) —
  but that means the screen only works if you already know to type more, and the first impression
  is a wall of fast food and babyfood.
- **Do:** Score inside the existing memo at `FoodsTab.jsx:519-524` before returning. A four-line
  comparator gets ~90% of this with no new dependency and no backend change: exact name match →
  name starts with query → query starts a word in the name → substring; tie-break **shorter name
  first**. Shorter-name-first alone lifts "Chicken Breast" above "Chicken breast, baked or broiled,
  skin not eaten, from fast food".
- **Size:** small
- **Confidence:** high

### F3. Enable "Log today" — the food diary it waits for has shipped

- **Saw:** `FoodsTab.jsx:355-363` renders a **disabled** button, `title="Needs the food diary — not
  built yet"`, with the caption *""Log today" unlocks when the food diary ships — no silent fake
  logging."* The diary exists: `backend/src/routes/diary.js`, and
  `frontend/src/lib/api.js:396-399` already exposes `getDiary` / `logPlannedDiary` /
  **`addDiaryEntry`** / `deleteDiaryEntry`. **Confirmed on screen** — the Today tab has a "Food
  diary — what you actually ate" card with "Ate as planned", "+ Add item", and "4 ITEMS LOGGED".
- **Costs:** The one action that makes finding a food *worth doing* is greyed out, and the app
  states as fact something that is no longer true. Right now the payoff for locating a food is
  "Add to a recipe" — which is not what a cutting user searching for chicken breast at dinner
  wants. This is also, I suspect, the real reason Foods feels like a dead end.
- **Do:** Wire the button to `api.addDiaryEntry` (`FoodsTab.jsx:352-363`) — it needs a grams input,
  so the honest minimum is a small grams field next to it. Delete the two stale caption lines and
  the `title`. If the wiring is deferred, at minimum fix the copy: it is currently a false
  statement on screen.
- **Size:** small (copy fix trivial; wiring small)
- **Confidence:** high

### F4. Default recipe grouping to "main protein", not "cuisine"

- **Saw:** `RecipesTab.jsx:483` — `useState("cuisine")`. **Confirmed on screen**, the Recipes
  library groups render in this order: **Western / Comfort 473**, **Uncategorized 158**, Asian 80,
  Mediterranean 52, Indian 30, Middle Eastern 28, American 26, Italian 21, **Mexican 15**,
  British & Irish 12, then Thai 9 / Nordic 3 / French 2 / Japanese 1 below the fold.
- **Costs:** The default browse axis puts **69% of the library into two undifferentiated buckets**,
  and the group matching his taste (Mexican/Latin) holds 1.6% of it and sits ninth — below the
  fold at 1524×784. Meanwhile `proteinGroupOf()` (:149-155) already produces exactly the buckets he
  shops by: Chicken, Beef, Turkey, Pork, Fish & Seafood, Eggs & Dairy, Plant protein.
- **Do:** Change `RecipesTab.jsx:483` to `useState("protein")`. One word. Optionally also default
  `sortBy` (:484) to `"density"` so the highest-protein-per-calorie recipe tops each group — the
  cutting-relevant order, and the sort already exists.
- **Size:** trivial
- **Confidence:** high

### F5. Correct the "470 rows" claim — the data was fixed, the comments weren't

- **Saw:** `foodCategories.js:87-88` ("470 rows in this library carry another food's USDA record
  VERBATIM"), :112-116, `FoodsTab.jsx:528` and :546-548 all state 470; root `CLAUDE.md` repeats it.
  Actual live counts over 14,151 rows: `source=quarantined` **77**; `dataQuality` beginning
  `exception:provenance-cleared` **2**; rows mentioning a carried record **80**; rows the triangle
  fires on **80**. The repair is documented in the data itself — `provenance-restored` (149 rows,
  re-derived from a correct FDC record) and `provenance-reviewed` (188 rows, donor record confirmed
  correct), both dated 2026-07-31. **The UI is honest** — the live-computed banner on screen says
  **"80 of these rows…"**, not 470.
- **Costs:** No user-facing harm. The damage is to the next person reading the source: every
  comment claims the library is 6× more broken than it is, arguing for work already done. The row
  count is also **14,151**, not the 14,122 quoted throughout.
- **Do:** Update the comment blocks at `frontend/src/data/foodCategories.js:87-127` and
  `frontend/src/components/FoodsTab.jsx:528, 546-548`, plus the corrections table in root
  `CLAUDE.md`. Comment-only — do not touch the logic, which is correct.
- **Size:** trivial
- **Confidence:** high

### F6. Add "Quickest first" to the recipe sort

- **Saw:** Sort options are `name` / `kcal` / `density` only (`RecipesTab.jsx:746-748`,
  :1068-1070). `prepTimeMin` is stored, is rendered on every row (:1160), and is a filter on the AI
  generator (:878) — but you cannot order by it.
- **Costs:** The two questions a cutting user asks a recipe list are "most protein per calorie" and
  "what can I make in 20 minutes". One is a first-class control; the other you eyeball row by row.
- **Do:** Add `<option value="prep">Quickest first</option>` at `RecipesTab.jsx:1071` and one
  comparator line at :748 (nulls last — many imports have no prep time).
- **Size:** trivial
- **Confidence:** high

### F7. Give the recipe library the left column, not the creation tools

- **Saw:** On the Recipes screen, the left column (`xl:col-span-5`) holds three stacked cards above
  the fold — "Import from a recipe site", "New recipe from AI", "Cart (0)" — while the actual 910-
  recipe library is pushed into the right seven columns. The AI card alone is ~300px tall with two
  selects, a prep input, a free-text box, two radios and an allergen checkbox.
- **Costs:** The rare job (author a new recipe) gets the prime, first-read position; the constant
  job (find something to eat tonight) gets the secondary column. This is the "too much jargon /
  busy at the front door" complaint in its Recipes form — the first thing on the screen is a
  control panel, not food.
- **Do:** Swap the columns so the library reads first, or collapse "Import" and "New recipe from
  AI" into one "Add a recipe" card with a two-way toggle — they are the same job (get a new recipe
  into the library) presented as two full-size cards. Two cards become one; nothing is lost.
- **Size:** medium
- **Confidence:** medium

### F8. Sort recipe search results by relevance too, not just the active sort

- **Saw:** `RecipesTab.jsx:749` — `if (q) return [["Search results", [...filtered].sort(sorter)]]`,
  where `sorter` defaults to A–Z. Recipe search is substring-only (:745), same as Foods.
- **Costs:** Much milder than F2 (910 rows, not 14,151, and the row is informative), but searching
  "chicken" still returns an alphabetical list where "15-minute chicken & halloumi burgers" ranks
  by its leading digit rather than by being a 39 g-protein, 15-minute meal.
- **Do:** When `q` is non-empty and `sortBy === "name"`, sort by protein-per-calorie instead — a
  search is an intent signal, and alphabet is the least useful answer to it.
- **Size:** trivial
- **Confidence:** medium

### F9. "Group by meal type" is a dead control on this data

- **Saw:** `mealTypeGroupOf()` (`RecipesTab.jsx:160-163`) falls back to `slotType` when
  `mealCategory` is unset. Across all 910 recipes `mealType` is **null on every single row**
  (910/910), so the control collapses to Meals / Snacks / Meals or Snacks.
- **Costs:** One of three grouping choices does almost nothing — a control the user must read and
  reject.
- **Do:** Drop the option from `RecipesTab.jsx:1061` (one `<option>` line), or relabel it "Group by
  meal or snack", which is what it actually does. I'd drop it.
- **Size:** trivial
- **Confidence:** high

### F10. Foods is reachable — leave the nav alone

- **Saw:** Committing, as the brief asks. `Sidebar.jsx:34-35` maps `tab === "foods"` onto the
  Recipes nav entry, and `App.jsx:340` passes `openFoods` into RecipesTab, which renders a labelled
  ghost button — `<Database /> Food database` — top-right in the page header
  (`RecipesTab.jsx:807-809`). EngineTab has the same button (`EngineTab.jsx:133`). **Confirmed on
  screen:** from a cold start it is **Recipes → Food database = 2 clicks**, the button is the only
  action in that header so nothing competes with it, and the sidebar correctly keeps Recipes lit
  while you're on Foods.
- **Costs:** Essentially none. The label is plain English, and the back control names its
  destination ("Recipes") rather than saying "Back" — with a comment at `FoodsTab.jsx:554-561`
  explaining exactly that reasoning. Root `CLAUDE.md` standing rule 7 makes "Foods is a child of
  Recipes" deliberate policy, not an oversight.
- **Do:** **Nothing.** This is right and the nav should not grow an eighth item. Foods feels bad
  because of F1/F2/F3, not because of the door.
- **Size:** —
- **Confidence:** high

### F11. Barcode lookup is reachable but is the wrong bet for this user

- **Saw:** `BarcodeLookup.jsx` is mounted at `FoodsTab.jsx:564-576`, toggled by an "Add by barcode"
  button in the Foods header (`FoodsTab.jsx:551-553`) — **visible on screen**, left of the "Recipes"
  back button. So: not dead code, 3 clicks from cold. The backend is real and careful
  (`foods.js:98-163`): preview-then-save, re-validates server-side rather than trusting client
  macros, hard-pins `source: "community"`, refuses to overwrite an existing row.
- **Costs:** It is manual UPC *typing*, not scanning — this is a desktop app with no camera. The
  live library has **zero rows with `source = "community"`**, so the path has never been used once.
  It also needs network access to Open Food Facts, which nothing else in the app requires. The best
  provenance handling in the codebase, serving no one.
- **Do:** Not a cut — the code is sound and cheap to keep. But it should stop occupying one of the
  two header buttons on Foods; demote it into the empty-state panel. **Flagged as a guess:** I
  suspect it was built for a phone that doesn't exist yet.
- **Size:** small
- **Confidence:** medium (reachability high; the "wrong bet" judgment is opinion)

---

## Cut list

- **`<option value="mealtype">` in `RecipesTab.jsx:1061`** — `mealType` is null on 910/910 recipes;
  the control degrades to a ~95%-"Meals" bucket. (F9)
- **The two stale caption lines at `FoodsTab.jsx:355` and :361-363** — "Needs the food diary — not
  built yet" / ""Log today" unlocks when the food diary ships". The diary shipped; this is now a
  false statement rendered on screen. (F3)
- **One of the two recipe-creation cards** — "Import from a recipe site" and "New recipe from AI"
  are the same job in two full-size cards holding the top of the left column. Merge to one. (F7)
- **Nothing else.** Specifically *not* the Foods nav arrangement (F10), *not* BarcodeLookup's
  backend (F11), and *not* the trust banners — those are the load-bearing honesty here.

## Open questions for Shad

1. **The 29 placeholder rows: fill or delete?** No recipe uses any of them (verified across all
   910), and five are foods you actually eat ("Non-fat Greek yogurt", "low-fat cottage cheese",
   "cooked chicken breast", "Ground chicken breast, cooked", "Pork tenderloin, cooked") — real rows
   for which already exist. F1 makes them *visibly* untrustworthy; deleting would make them gone.
   I deleted nothing.
2. **Do you want a pinned/favourites concept** so your ~20 staples sort to the top regardless of
   query? That's a feature addition, so by the brief's rule it should replace something — most
   likely the whole category-browse accordion, which I doubt gets used at 14,151 rows.
3. **`fdcCategory` is in the list payload but never rendered.** It carries the disambiguation that
   would kill most of F2's confusion on its own ("Restaurant Foods", "Baby Foods", "American
   Indian/Alaska Native Foods") as a dim right-aligned tag — but it's another thing on the row.
   Worth the density?

---

## Method

Numbers come from the live dev API at `localhost:3001` (all 14,151 foods and 910 recipes pulled and
analysed offline) plus the cited source lines. Ordering claims were computed by replaying the app's
own sort (`category asc, name asc`) and its own filter (`lname.includes(q)`) against the real
payload, then **verified on screen** in the running app: Recipes group counts, the `chicken`
search ("824 matches", burritos first), the `greek yogurt` search (the 0-kcal row with no icon),
the "80 of these rows" banner, and the Today food-diary card. Nothing was created, edited or
deleted; all writes avoided.
