# Cut Protocol — Simple Surface: what to cut, what to say, what to leave alone

*Read-only audit. Nothing was changed. Every line reference below was opened and read in `frontend/src/simple/` and its backend counterparts.*

---

## 1. THE HEADLINE

**The exit is the most repeated thing in the app — every screen ends in a stack of two to four small grey underlined links that all go to exactly the same place.** There is one function, `const goFull = () => uiMode.set("full")` (`SimpleApp.jsx:52`), and it is rendered from eleven places. The shell hangs two of them under *every* logged-in screen — `<Details onClick={goFull} />` ("Show me the details", `SimpleApp.jsx:252`) and `<Details onClick={goFull} label="Support and wellbeing resources" />` (`:257`) — and then four of the five rooms add their own on top: `SimplePlan.jsx:238`, `SimpleRecipes.jsx:203` **and** `:204`, `SimpleShopping.jsx:219`, `SimpleDetails.jsx:312` **and** `:372`, `SimpleProgress.jsx:154`/`:184`. All of them are the same component with the same styling — `text-sm text-muted-foreground underline` (`parts.jsx:131-138`) — and all of them land on whatever tab the full app was last on. So the bottom of Recipes and the bottom of You each read as **four different offers that are one offer**, and the one link that is legally required to stand out — the wellbeing entry — is the third or fourth identical grey underline in that pile, and it doesn't even open Wellbeing (it opens the full app's default tab). The same link is also the only secondary control on all seven setup screens (`SimpleOnboarding.jsx:175`). Runner-up, and it belongs in the same paragraph: the front door stacks two complete screens on one scroll (`SimpleApp.jsx:187-193`) so it ships **two full-width black primary buttons** — "I ate this" (`SimpleToday.jsx:230`) and "Save today's weight" (`SimpleWeight.jsx:90`) — against the house rule written in the code itself: *"Primary action. One per screen, always the same place."* (`parts.jsx:33`). I ranked the links first because they appear on nine screens; the two buttons appear on one.

---

## 2. THE CUT LIST

Ranked by how much quiet you buy per unit of work. **Nothing is deleted. Every row is a move.**

| # | What goes | Which screen | Where it moves to | What the person loses |
|---|---|---|---|---|
| 1 | The generic "Show me the details" link, `SimpleApp.jsx:252` | Plan, Recipes, Shopping, Progress, You | Nowhere — render it only when the room supplies none. Each room's own labelled link (`SimplePlan.jsx:238`, `SimpleRecipes.jsx:203-204`, `SimpleShopping.jsx:219`, `SimpleProgress.jsx:154`/`:184`, `SimpleDetails.jsx:372`) already goes to the same place, with better words | **Nothing.** Today has no room link of its own, so Today keeps it |
| 2 | The second copy of every chosen allergen, `SimpleOnboarding.jsx:293-307` | Setup, question 6 | Keep the row, but filter it to typed-in terms only. The eight built-ins already show their state on the chip you tapped (`:263-278`, `aria-pressed` at `:270`) | Nothing, provided a visible `×` is added to the pressed chip at `:276` so removal isn't invisible |
| 3 | The weight chart, `SimpleWeight.jsx:94-95` | Today | Progress › Weight already draws the *identical* chart from the same readings (`SimpleProgress.jsx:62`). On Today it becomes one line: "See your weight over time" | The line at a glance on the front door. One tap away — and the copy they land on has "Where you are", the rate and the days count beside it |
| 4 | The second black button, `SimpleWeight.jsx:90` | Today | Becomes the small button at the right of the weight row — `RowAction` (`parts.jsx:236`), the same shape as Swap and Look | The button's size, not the function. "I ate this" becomes the only primary action, which is what `parts.jsx:33` requires |
| 5 | The gram figure and the repeated item name on every shopping line, `SimpleShopping.jsx:29` | Shopping | Grams to a smaller second line under the item; the duplicate name suppressed only where the purchase unit already contains it. `itemLine` stays untouched for `asText()` (`:136-139`) | Nothing. Today an apple reads "3 apples — Apples (540 g)" and garlic reads "2 bulbs (≈20 cloves) — Garlic (100 g)" |
| 6 | "Make one with AI, or import a link" and "Search all 14,000 single foods…", `SimpleRecipes.jsx:203-204` | Recipes | Into the moment each answers a question: AI/import into the empty-search state (`:168-173`); food lookup into the recipe sheet (`:71-106`) | Someone who never runs an empty search won't discover AI generation from this room. That is the trade for the bottom of the room no longer being four grey links |
| 7 | "Text it" and "Email it", `SimpleShopping.jsx:197-210` | Shopping | Behind one quiet "Send it somewhere" using the sheet the app already has (`parts.jsx:293`) | One tap. Worth knowing: neither works in the packaged desktop build — `electron/main.cjs` only routes `http(s)`, so `sms:` and `mailto:` are dead doors today |
| 8 | The eight allergen chips + the free-text box, `SimpleOnboarding.jsx:261-321` | Setup, question 6 | Revealed after a yes/no — which is what the shared vocabulary already expects here: *"A pick-one row of large targets (sex, and the yes/no on the food screen)"* (`parts.jsx:57`) | The chips at a glance. Most of twenty people answer "nothing"; today their whole answer is the last control on an eleven-control screen |
| 9 | The three-step burn breakdown and the "they disagree by about N calories" paragraph, `SimpleProgress.jsx:135-152` | Progress › Your numbers | Behind the link already sitting at `:154` | The working at a glance. The constitution's "displayed numbers can reveal their formula" is satisfied one labelled click away. **Owner's call** — this is the honest part of the screen, just not the part they came for |
| 10 | The Engine tab, `SimpleProgress.jsx:22-26` + `176-186` | Progress | Its explanation becomes a line of description under the link at `:154` | A third tab that currently contains only an apology that the screen isn't finished, plus a link to the same place tab two already links to. Lowest priority — this one changes navigation |

---

## 3. THE WORD LIST

Every jargon or clumsy string, in the order a person meets it. All of these are display strings only — no payload, key or calculation is touched by any row here.

### Setup

| Says now | file:line | Should say | Why |
|---|---|---|---|
| "Your body uses energy differently either way. **This changes the numbers.**" | `SimpleOnboarding.jsx:192` | "Your body uses energy differently either way — it changes how much you get to eat." | First sentence of the app. "The numbers" is our word for something they've never been shown. Your own screen already says it better: `SimpleDetails.jsx:298` |
| "Use centimetres and kilograms instead" | `SimpleOnboarding.jsx:224` | "Use centimetres and kilograms instead — this clears what you've typed" **and move the control above the height boxes** | It sits *below* the boxes (`:223` vs `:213-218`) and its `set({...})` wipes `heightFt`/`heightIn`/`weight`/`goal`. The comment above it claims "nothing is typed yet" — untrue for the two boxes directly above |
| "This filters every meal the app ever builds for you. There is no skip on this one — **an empty list has served someone shellfish before.**" | `SimpleOnboarding.jsx:259` | "We use this to keep those foods out of every meal we suggest. There's no skip here — answer even if it's a no, because we'd rather not guess." | We volunteer a past allergen incident to a stranger on question 6 of 7, before they've seen a single meal. The reason stays where it belongs, in the comment at `:27-29` |
| "Use the full setup instead" | `SimpleOnboarding.jsx:175` | "Ask me everything instead" — **and confirm first**: "You'll answer these questions again." | It unmounts the component; all six answers live in local state at `:46` and are gone. "Instead" promises a swap and delivers a restart |
| "Show me what to eat" | `SimpleOnboarding.jsx:351` | Keep the words — but build the plan before `onDone()` (see Order of Work) | `submit()` only calls `putProfile`; nothing builds a plan, so the promised screen has no food on it |
| *(missing)* footer has no support link | `SimpleOnboarding.jsx:172-177` | Add `<Details onClick={onShowFull} label="Support and wellbeing resources" />`, identical to `SimpleApp.jsx:257` | Setup is the only part of the surface with no route to support — and it's where goal weight gets asked and refused |

### Today

| Says now | file:line | Should say | Why |
|---|---|---|---|
| "Here's what to eat today" (renders even with no food) | `SimpleToday.jsx:192` | Conditional on `slots.length` — "Let's build today's food" when empty | Today it sits two lines above "No food planned for today yet" (`:211`) |
| "Build my day" / "Building your day…" | `SimpleToday.jsx:207` | "Build my week" / "Building your week…" | `api.generatePlan({})` (`:112`) sends no horizon, and `plans.js:281-282` documents *"Absent = week"*. Forty lines away the identical call is honestly labelled "Build my week" (`SimplePlan.jsx:180`). Fix the label, **not** the request body |
| "No food planned for today yet. Building a day takes a few seconds." | `SimpleToday.jsx:211` | "No food planned yet. Building the week takes a few seconds — today's meals come out of it." | Same reason |
| "Meal / Meal / Meal / Snack" | `SimpleToday.jsx:32-33`, `SimplePlan.jsx:32-33` | "Meal 1 / Meal 2 / Meal 3 / Snack" — let `meal` fall through to the ordinal already written at `:33` | The solver only ever emits `meal` and `snack` (`weeklyPlanner.js:150,153`), so the breakfast/lunch/dinner keys never fire and every row is labelled identically. **Keep all five keys in `WORD`** |
| "No meal chosen yet" → announced as "Swap **No meal chosen yet** for something else" | `SimpleToday.jsx:39` + `:46`; same at `SimplePlan.jsx:215`,`226` | Lead: "Nothing picked for this one yet". Button: "Pick one", label "Pick a meal for this one" | An unfilled slot is the solver's failure, not the person's, and "swap" is the wrong verb for nothing |

### Food › Plan

| Says now | file:line | Should say | Why |
|---|---|---|---|
| `{d.flagged} gap{s}` at `text-[10px]` | `SimplePlan.jsx:57` | "1 didn't fit" at `text-xs`, plus the full phrase in an `aria-label` on the day button | "Gap" is a word we invented, it reads as *missing food* when it means *couldn't hit the target*, and it's the smallest type on a surface whose rule is "big type, big targets" (`parts.jsx:9`) |
| "4 of 7 days on target" | `SimplePlan.jsx:169` | "4 days ready · 3 days not planned yet" (second clause only when > 0) | The filter requires `d.slots.length`, so a blank day is silently counted as a miss. Both numbers are already computed at `:96-104` |
| "Swap that meal below and it usually clears." | `SimplePlan.jsx:206` | Name the meal (`slotWord` + `s.recipe?.name`) and say "Swapping it usually helps." Mark the row itself with an amber "Didn't fit your target" | Four rows render identically; the one instruction on the screen points at something the person cannot identify. **Print `s.warning` verbatim as it is now** |
| "Build it again" | `SimplePlan.jsx:171` | Keep the label, **add a confirm**: "Start the whole week over? This replaces every meal, including the ones you swapped" | Only `locked` slots survive a regenerate (`plans.js` carry-forward), and this surface has no lock control. The swap sheet just promised "the rest of the day stays where it is" (`SwapSheet.jsx:19`) |
| "Cuisines, budget, how far ahead — the full planner" | `SimplePlan.jsx:238` | "Change the kinds of food, or plan further ahead — in the full app" | "The planner" names two different destinations across the app (see Duplicates) |

### Food › Recipes

| Says now | file:line | Should say | Why |
|---|---|---|---|
| `label: "Meat-free"` | `SimpleRecipes.jsx:32` | `label: "Beans & veg"` **and** make the matcher exclusive of the meat/fish patterns | I ran the four shipped regexes over the seed library (602 names): 38 land under "Meat-free" and **6 of them name an animal in the title** — "Salt Beef and Beans", "Spanish beans with chicken & chorizo", "15-minute chicken & halloumi burgers", "Brun Lapskaus (Norwegian Beef Vegetable Stew)", the Cambodian pork stir-fry, and a fried-fish dish. Real dietary filtering stays server-side and untouched |
| "×0.5 · One serving · ×1.5 · ×2" | `SimpleRecipes.jsx:81` | "Half a serving · One serving · One and a half · Two servings" | One label in their language, three in notation, directly above the calorie number they came for. `STEPS` and the 0.5–2 clamp are untouched |
| "Some ingredients in this one have **crowd-sourced** numbers rather than **lab-verified** ones." | `SimpleRecipes.jsx:98` | "The calorie count here is a good estimate rather than an exact one." | Two terms from a sourcing taxonomy and no verdict. (This panel is also dead — see Order of Work item 8) |
| "Put this in my week" | `SimpleRecipes.jsx:103` | "Add to tomorrow's dinner" | The destination is hardcoded one line up (`:61`, `slotIndex: 2`) and only disclosed *after* the tap |
| "Added to tomorrow's dinner. Change it in **the planner** if that's wrong." | `SimpleRecipes.jsx:62` | "This is now tomorrow's dinner. Whatever was there has been swapped out — change it under Plan." | The server *upserts*: an existing tomorrow-dinner is overwritten with no undo on this sheet. And "the planner" here means the simple Plan tab while `SimplePlan.jsx:238` uses it for the full app |
| `recipe.prepMinutes` | `SimpleRecipes.jsx:90` | `recipe.prepTimeMin` | The column is `prepTimeMin` (`schema.prisma:411`); `prepMinutes` appears nowhere else in the repo, so "Takes about 25 min" has never once rendered. Cook time is the fact a person choosing dinner actually wants |
| "Search all **14,000** single foods, or scan a barcode" | `SimpleRecipes.jsx:204` | "Look up a single food, or scan a barcode" | Hardcoded and already wrong — the library is 14,122 and moves. **Keep the live `{all.length}` subtitle at `:155`** — that one is derived and honest |
| "Nothing matches "chicken". Try a shorter word." | `SimpleRecipes.jsx:168-173` | When a group pill is on: "Nothing in Fish matches "chicken"", with an action "Search everything". When no group: keep the sentence, add an action that clears the box. Drop "yet" | Today it blames the word when the pill is what emptied the list, and passes no `action` — the component's own contract says that's a dead end (`parts.jsx:307-309`) |
| "{n} recipes are hidden because of the foods you avoid." | `SimpleRecipes.jsx:198` | "{n} recipes don't fit what you told us you eat." — and state `hiddenBecauseUnreadable` separately as our problem | `hiddenCount` aggregates four causes; the route deliberately ships the unreadable count as a separate field because conflating them *"would let a broken import masquerade as an allergy"* (`recipes.js:38-40`) |

### Food › Shopping

| Says now | file:line | Should say | Why |
|---|---|---|---|
| Aisle heading renders as bare **"Protein"** and **"Spices"** | `SimpleShopping.jsx:32-41` | Add `protein: "Meat, fish, eggs & tofu"` and `spices: "Herbs & spices"`; change `dairy` to "Dairy" | `SECTION_LABEL` has no `protein` or `spices` key, so `:41` capitalises the raw key — macro vocabulary as an aisle sign. Meanwhile `meat`, `bakery`, `frozen` can never match: the classifier returns only protein/dairy/spices/produce/pantry/other (`groceryList.js:139-145`). Eggs *and tofu* are in `PROTEIN_WORDS` (`:73-80`), so "Dairy & eggs" is wrong. **Leave the three unused keys in place** |
| "Rebuild" / "Rebuilding…" | `SimpleShopping.jsx:180` | "Start the list over" / "Starting over…", **and confirm when anything is ticked** | The route sets `checked: false` on every item and says so: *"a regenerated list naturally resets its checkboxes"* (`plans.js:911`) — while this file's own header promises *"closing the app in aisle three does not lose your place"* (`:12-14`) |
| "Your shopping list comes from your week's food. Build a week first…" | `SimpleShopping.jsx:157-160` | Same words, plus an action button that opens Plan | It's the first thing a new person sees here and there is nothing to press |

### Progress

| Says now | file:line | Should say | Why |
|---|---|---|---|
| "No weigh-ins yet. Weigh yourself a few mornings and your line starts here." | `SimpleProgress.jsx:52-58` | "Nothing to show yet — log your first weight and the line starts here", with an action button that opens Today | Day one, every tester, no `action` prop. The weigh-in box is on another door |
| "Which way it's going — **Not enough yet**" | `SimpleProgress.jsx:72` | "Too early to say" | A fragment answering a question the label didn't ask |
| "**Days in** — 6" | `SimpleProgress.jsx:77` | "Days since you started — 6" | App shorthand; six of what, since when |
| "lose about {r1(t.rate)} **lb** a week" | `SimpleProgress.jsx:118` | `{displayRate(t.rate, pref)} {weightUnit(pref)}` | Hardcoded lb on the sentence that sells the product, while the tab next door converts to kg (`:74`). The helpers already exist in `lib/units.js` |
| "**The maths wanted** 1,650, which is under your floor of 1,700" | `SimpleProgress.jsx:124` | Drop "The maths wanted"; add the word *calories* to both figures | The app narrating itself, and the only two bare numbers on a screen where everything else says "calories" (also `:131`) |
| "…**Profile** is where you slow it down." | `SimpleProgress.jsx:97` (from `bmrEngine.js:664`) | **Leave the sentence exactly as written** and add one line under it: "You can change your pace under You → How fast do you want to lose?" | There is no Profile on this surface — the doors are Today · Food · Progress · You (`SimpleApp.jsx:25-30`). The backend string is clinically right and must not be edited or hidden |
| Tab label "**Engine**" / "Open the Engine" | `SimpleProgress.jsx:24`, `:184` | "The full maths" (display label only — the `id: "engine"` stays) | Developer vocabulary sitting next to "Weight" |

### You › Your details

| Says now | file:line | Should say | Why |
|---|---|---|---|
| "{r} **lb a week**" on the rate pills | `SimpleDetails.jsx:219` | `{displayRate(r, pref)} {rateUnit(pref)}` | Every other number on this screen respects the unit toggle two sections down (`:287-291`). A metric user cannot read the second most important control on the page. The click payload at `:218` is untouched |
| "This comes from your weigh-ins" | `SimpleDetails.jsx:233` | Conditional: when `summary?.avg7Kg == null`, "What you started at — log a weigh-in to update it" | The value falls back to `profile.startWeightKg` (`:232`), which is the signup figure. On day one the caption is false for everyone |
| "You're being held at your floor. Losing faster would mean…" (bare amber paragraph) | `SimpleDetails.jsx:207-210` | Wrap in `<Panel tone="warn">` and match the Progress wording: "You're held at the floor — losing faster would mean eating less than is safe. Add movement instead." | Same fact, two voices, two containers (`SimpleProgress.jsx:122-127` is a bordered card) — the bordered one looks more serious than the naked one |
| "The full job list, training sessions, and **the multiplier**" | `SimpleDetails.jsx:312` | "The full job list and how training is counted" | `jobMultiplier` is an engine term. The plain-English line directly above at `:298` already explains the concept |
| "Yours is saved as **trades-general**" | `SimpleDetails.jsx:309` | Look the key up in `COMMON_JOBS` (`:34-39`) and show the label; fall back to "Your answer is saved." | Raw database slug shown at the exact moment something has already gone wrong |
| "**Matched** as a group — covers N foods" / "**Matched on the name only**" | `SimpleDetails.jsx:352-354` | "Covers a whole group of foods" / "We're matching the words you typed — worth checking labels too." | This is the allergy list — the one label on the surface where a misread has a physical consequence, and it currently describes the matcher instead of the person's safety. Note `matchCount` is not in the payload, so the count always renders as "several"; drop the promise of a number |
| "Changes save as you go." | `SimpleDetails.jsx:172` | Keep the words — **make them true** (see Order of Work item 3) | There is no `onBlur` anywhere in `frontend/src/simple/`. Every field on this screen commits only on Enter |

### Shell

| Says now | file:line | Should say | Why |
|---|---|---|---|
| "One moment…" in hand-rolled markup | `SimpleApp.jsx:128` | `<Busy>Signing you in…</Busy>` | `Busy` is that exact element (`parts.jsx:318-320`) and exists precisely because *"'Loading…' tells nobody anything"*. Every other wait on the surface obeys it; the first screen a new person sees is the one that doesn't |
| Raw `describeError` output under "Can't reach the app right now" | `SimpleApp.jsx:136` (and `:166`) | One fixed line — "Nothing was lost. If this keeps happening, close Cut Protocol completely and open it again." — with the raw string behind a small "What went wrong" disclosure | On the offline path the string is "…**the change was not sent**" (`api.js:115`). On first load there was no change |

---

## 4. THE DUPLICATES

| Shown twice | Where | Which copy survives |
|---|---|---|
| **The weight chart** — identical component, identical readings, two network reads of the same data | `SimpleWeight.jsx:95` and `SimpleProgress.jsx:62` | **Progress › Weight.** On Today it becomes a "See your weight over time" link. `TrendLine` keeps both callers in code |
| **The escape hatch** — 2 to 4 identical links per screen, one function | `SimpleApp.jsx:252` + `:257` under every screen, plus `SimplePlan.jsx:238`, `SimpleRecipes.jsx:203-204`, `SimpleShopping.jsx:219`, `SimpleDetails.jsx:312`+`:372`, `SimpleProgress.jsx:154`/`:184` | **The room's own labelled link.** The generic one at `:252` renders only where a room supplies none (Today). The wellbeing link at `:257` survives on every screen, unconditional, and gets visual separation |
| **Every chosen allergen** — pressed chip *and* a "Dairy ×" chip a few centimetres below | `SimpleOnboarding.jsx:263-278` and `:293-307` | **The pressed chip.** The list below keeps only typed-in terms, which have no other home |
| **"Held at your floor"** — same condition, two phrasings, two containers | `SimpleDetails.jsx:207-210` and `SimpleProgress.jsx:122-127` | **Progress's wording and its bordered amber panel.** Your details adopts both, minus the two numbers it doesn't hold |
| **Two controls per recipe row, both `setOpen(r)`** — and one is a `<button>` inside a `<button>`, which is invalid HTML | `SimpleRecipes.jsx:182` (row `onClick`) and `:183` (`RowAction`) | **The whole-row click** — the bigger target. "Look" becomes a plain `<span>`. `RowAction` is untouched and still used by Today and Plan |
| **Two answers to "what do I weigh"**, stacked | chart caption `parts.jsx:377` (latest raw reading) and `SimpleProgress.jsx:66` ("Where you are" = 7-day average) | **"Where you are."** The captions get "first ·" / "latest ·" prefixes so they read as readings, not as the answer |
| **The item name, twice, on every shopping line** | `SimpleShopping.jsx:29` — `purchaseUnits.display` already contains the noun (`purchaseUnits.js:119`) | **The purchase unit** on the big line; the name suppressed only on a confident match; grams to a quiet second line |
| **The "not enough weigh-ins" sentence** | `SimpleWeight.jsx:99-101` and `SimpleProgress.jsx:55` | **One shared string.** Progress also needs the missing one-reading branch — at exactly one weigh-in `TrendLine` returns null (`parts.jsx:334`) and Progress shows a hole with no explanation |
| **One API call, two promises** | "Build my day" `SimpleToday.jsx:207` vs "Build my week" `SimplePlan.jsx:180` | **"Build my week."** Both are `api.generatePlan({})` |
| **"The planner" naming two destinations** | `SimpleRecipes.jsx:62` (means the simple Plan tab) vs `SimplePlan.jsx:238` (means the full app) | **"Plan" for the door, "the full app" for the other.** Never "the planner" for either |
| **`Busy`'s markup, hand-copied** | `SimpleApp.jsx:128` vs `parts.jsx:318-320` | **The component.** The copy will silently drift the next time `Busy` is restyled |
| **`Pill`'s markup, hand-copied class for class** | `SimpleOnboarding.jsx:266-278` vs `parts.jsx:264-278` | **`Pill`.** Same drift risk |
| **Row-action shape** — a bordered chip on three screens, unbordered grey words on the fourth | `RowAction` at `SimpleToday.jsx:46`, `SimplePlan.jsx:223`, `SimpleRecipes.jsx:183` vs `Quiet` at `SimpleDetails.jsx:234` and `:357` | **`RowAction`.** "Remove" on an allergy row currently reads as a caption, not a button, and is a 44px target where the others are 48px |
| **Three counts of the library on one browsing screen** | `SimpleRecipes.jsx:155`, `:198`, `:204` | **`:155` (live, derived) and `:198` (an honesty disclosure).** `:204`'s hardcoded "14,000" goes |

---

## 5. DO NOT TOUCH

These look like clutter. They are not. Each one has its reason written in the code, and the next person to "tidy" the surface will find them first.

- **The hidden-recipe count** (`SimpleRecipes.jsx:196-200`). Comment at `:138-139`: *"hiddenCount is the server's own count of recipes its allergy filter removed. It is stated, never silently swallowed."* The route agrees: *"silent shrinkage is banned"* (`recipes.js:25`).
- **"No total — shop prices vary too much to quote one honestly."** (`SimpleShopping.jsx:215-217`). Comment at `:16-18`: *"a confident-looking total built from rough numbers is the kind of fake precision the constitution forbids."*
- **The solver's warning strings, printed word for word** (`SimplePlan.jsx:202-209`). Comment at `:199-201`: *"The solver's own words, unabridged. It is the only thing that knows why a slot did not fit, and paraphrasing it would be inventing a reason."* You may add the meal's name in front of it. You may not rewrite it.
- **The averaging provenance line** (`SimpleProgress.jsx:83-89`). Comment at `:80-82`: *"the constitution says a displayed number can reveal its inputs. A thin or stale average must say so rather than look as confident as a full one."*
- **The verdict sentence, including "lean mass"** (`SimpleProgress.jsx:93-100`). Comment at `:91-92`: *"The engine's own verdict sentence, rendered as written. Never red — this is body data, and the law holds on every surface."* One reviewer wanted it demoted behind a toggle. Rejected: the backend records the lean-mass caution as clinically correct. Add a door name beneath it; do not hide it.
- **The floor panel** (`SimpleProgress.jsx:122-127`, `SimpleDetails.jsx:204`). Constitution: *"Floor blocks are shown, not hidden."*
- **The no-skip rule on the allergy question** (`ready[5]`, `SimpleOnboarding.jsx:165`, and the "I have nothing I need to avoid." button at `:309-320`). Comment at `:27-29`: *"an empty exclusions list once meant a real shellfish allergy met real shellfish."* The hint text changes. The gate does not.
- **Dots instead of a progress percentage** (`parts.jsx:104-106`): *"a fabricated percentage is exactly what the constitution forbids, and '4 of 7' is more useful anyway."*
- **Amber, never red** (`parts.jsx:121-122` and `199-201`): *"tone='warn' is the ONE alert treatment on this surface — calm amber, never red."* I grepped the whole folder: there is no red and no colour literal anywhere in `frontend/src/simple/`. It passes today. Keep it that way, and if macro colour ever arrives here it arrives with P/C/F letters attached.
- **The blur guard's compare-in-typed-units** (`SimpleDetails.jsx:137-144`). Header comment at `:13-18`: *"THE BLUR GUARD IS LOAD-BEARING, not an optimisation."* Adding `onBlur` is right; removing the dedupe at `:141` is not.
- **The unit switch clearing what you typed** (`SimpleOnboarding.jsx:223`). Reinterpreting a number typed as pounds as kilograms would be silent body-data corruption. Move the control and name the consequence; keep the clearing. (Its comment at `:220-222` is wrong about its own screen — correct the comment, not the behaviour.)
- **`TrendLine` is deliberately not the Trend chart** (`parts.jsx:322-332`): no regression fit, no error band, no goal projection, because *"re-deriving any of that here would be a second implementation of a calculation."* Do not "improve" it with a zero baseline or a goal line. It does need one plain sentence — "The line is scaled to fit, so small day-to-day changes look big" — because it auto-fits its vertical scale (`:344`, `:349`, `:360`) and a 1 lb water swing draws a cliff.
- **The wellbeing entry and `ResourceList`** (`SimpleApp.jsx:253-256`, `SimpleDetails.jsx:365-370`): never hidden, never greyed, on every screen.
- **Today is one screen** (`SimpleApp.jsx:181-184`): *"the day of food and the weight box on one page, no sub-navigation, because two things do not need a navigation system. That decision governs the Today door."* Fix the two-primary-buttons problem by demoting the Save button — **not** by adding tabs.
- **Tomorrow's dinner as the default placement slot** (`SimpleRecipes.jsx:53-55`): *"today is usually already eaten or already planned."* Say the destination on the button; don't change the slot.
- **The unreachable `breakfast`/`lunch`/`dinner` keys in `WORD`** and the unused `meat`/`bakery`/`frozen` labels in `SECTION_LABEL`. Dead, harmless, and rule 1 says they stay.
- **`slotType`, `slotIndex`, `hiddenCount`, `excludedFoods`, `rateLbPerWeek`, `shadcut:uiMode`** and every other persisted key or payload field named in this brief: display strings only, always.

---

## 6. ORDER OF WORK

### Do first — these break the fourteen days, not just the look

1. **The first-run hang.** `GET /plans/current` returns literal `null` for a brand-new user (`plans.js:201-208` — `res.json(plan)`, no 404). `SimpleToday.jsx:187` reads `if (plan === null) return <Busy>Getting today's food…</Busy>`, so Today spins forever and the "Build my day" empty state is unreachable. Every one of the twenty testers hits this on day one, immediately after the button that promised them food. Same collision at `SimplePlan.jsx:164` and `SimpleShopping.jsx:151`. Distinguish "not loaded yet" from "no plan exists" on the client — the route is untouchable.
2. **Then keep the promise:** in `SimpleOnboarding.submit()` (`:84-100`), await the same `api.generatePlan({})` that `SimpleToday.jsx:112` already calls, before `onDone()`. Fall through on failure.
3. **"Changes save as you go." is false.** `NumberBox` (`parts.jsx:86`) wires only `onChange` and `onKeyDown`; there is no `onBlur` in the folder. Age, Goal weight and Height commit **only on Enter**, while the screen tells them at `SimpleDetails.jsx:172` that it saved. Add a *new, separate* `onBlur` prop and pass it **only in `SimpleDetails`** — aliasing it to `onEnter` would make Next skip two screens in onboarding and would POST a weigh-in on click-away.
4. **The one-way door.** `goFull` writes localStorage (`uiMode.js:36-38`) and **nothing anywhere calls `uiMode.set("simple")`** — I grepped the whole frontend; the only way back is a `?simple=1` URL nobody can type in a packaged Electron window. One curious tap on a small grey link is permanent, across restarts. Ship a "Back to the simple view" control in the full app's sidebar footer before the testers get this. Until it exists, relabel the link "Open the full app" so it at least names where it goes.
5. **Reduced motion.** `index.css:343-352` is an allowlist that stops exactly `.skeleton::after` and `.ring-breathe`. Tailwind's `animate-spin` matches neither, and it's used at `SimpleToday.jsx:47` and `SimplePlan.jsx:228`. That's a standing safety law broken by new code. One line: `.animate-spin { animation: none; }` inside the existing media block, or `motion-safe:animate-spin` at both call sites.
6. **The wellbeing link doesn't open Wellbeing.** `SimpleApp.jsx:257` calls the same `goFull` as everything else, landing on the full app's default tab — while its own comment (`:253-256`) claims the resources are *"one labelled click away, on the full app's Wellbeing tab."* Point that one handler at `setDoor("you")`, where the real `ResourceList` already renders (`SimpleDetails.jsx:369`). Keep it on every screen, and give it more weight than the grey link above it — 14px muted is the greyed tier the law forbids for this entry.
7. **The three destructive buttons that don't warn.** "Rebuild" wipes every tick (`SimpleShopping.jsx:180` → `plans.js:884`); "Build it again" wipes every swap (`SimplePlan.jsx:171`); "Put this in my week" overwrites tomorrow's dinner (`SimpleRecipes.jsx:103` → upsert). Relabel + confirm, per the Word List. No endpoint changes.
8. **Two food-trust defects.** `recipe.trust` is not a field the API returns — the honesty panel at `SimpleRecipes.jsx:96-100` can never fire, while the full tab measured that 779 of 889 recipes carry at least one ingredient with another food's macros. Move `trustReport` (`RecipesTab.jsx:112-136`) into a shared module and widen the condition. And relabel "Meat-free", which lists six meat dishes.
9. **The under-14 gate.** `ready[1]` is `+d.age > 0` (`SimpleOnboarding.jsx:161`), so a minor answers all six questions including goal weight before being refused — while the backend explicitly serves `limits.adultMinAge` with the comment *"the wizard needs to stop a 15-year-old on step 1 rather than at the end"* (`profile.js:376-382`), which the full wizard honours and this door dropped. Read the number from the server; never hardcode 18.

### Second — the quiet

The whole Cut List, then the whole Word List. These are almost all one-line changes and they are what the owner actually asked for. Start with Cut List rows 1–5; they are hours, not days.

### Third — the accessibility pass, in one sitting

Give `NumberBox` an optional label (twelve unnamed inputs today, including two adjacent boxes that both announce as "spin button, blank"); un-nest the recipe row's button-in-a-button; wire the existing `lib/useFocusTrap.js` into `Sheet` — its own comment says to (`parts.jsx:290-292`) and five dialogs on the full surface already do; add `role="status"` to `Busy` and a live region to "You ate this today."; and either finish or drop the fake tab semantics on `Tabs` (`parts.jsx:176`) and the day strip (`SimplePlan.jsx:39`), which announce "tab, 2 of 3" and then ignore arrow keys. Use `aria-disabled` + an early `if (busy) return;` rather than the native `disabled` on things people press repeatedly — disabling a focused control drops keyboard focus to the top of the page on every shopping tick.

### Can wait

The Engine tab restructure. The shopping export sheet. Reordering the shopping sections into shop order (real, but a smaller cut than the aisle names). The onboarding food-screen restructure. The Recipes link relocation, if the AI/import discoverability trade worries you.

---

## Where the reviewers disagreed, and what I picked

- **The two Recipes links:** one reviewer wanted them folded into the shell's single "Show me the details"; another wanted them kept because they name two different capabilities. **Kept, relocated into context.** Folding them deletes the only signpost that a barcode scanner and a food database exist — the noise is three same-destination links *stacked*, not the words themselves.
- **"Build my day":** relabel, or send `horizon: "day"` to make the label true. **Relabel.** The second reshapes an API payload, which rule 3 forbids and which is a separate product decision.
- **The Recipes subtitle "889 you can cook" (`:155`):** one reviewer wanted it cut as a third size-boast. **Kept.** It's computed live from real data, it's always honest, and it's the only thing telling a person how long the list is. The hardcoded "14,000" at `:204` is the dishonest one.
- **Disabling buttons during a write:** one reviewer wanted a `disabled` prop added to `Quiet`. **Rejected in favour of `aria-disabled` + an early return.** Native `disabled` on the control the person just pressed is what causes the keyboard-focus loss confirmed elsewhere in this same audit.
- **The Sheet backdrop:** `onClick={onClose}` versus a guarded `e.target === e.currentTarget`. **Guarded.** The panel is a child of the backdrop, so the unguarded version dismisses the sheet on every click inside it.
- **The wellbeing link on the You door:** one reviewer wanted it suppressed there, since the real resource list is already on the page. **Rejected.** It renders on every screen, unconditionally — but it now points at the You door, so it lands on the resources instead of the full app's dashboard.
- **The chart relocation** was filed twice by two reviewers. It is one change, counted once (Cut List row 3).