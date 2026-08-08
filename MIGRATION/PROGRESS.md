# PROGRESS

Generated from `MIGRATION/INVENTORY.md` at Phase 0. One row per capability.

Status is one of: `TODO` · `IN_PROGRESS` · `DONE` · `BLOCKED`.

**A row may only be set to DONE once an `// @feature F-XXX` comment exists in
tracked source under `frontend/src`.** `scripts/parity-check.js` enforces that —
writing DONE here without the comment fails the phase gate.

| ID | Status | Phase | Screen | Capability |
|---|---|---|---|---|
| F-001 | TODO | 9 | Shell | Boot auth resolve → checking / out / unreachable / in |
| F-002 | TODO | 9 | Shell | "Can't reach the app's server" state + Retry (NOT a sign-out) |
| F-003 | TODO | 9 | Shell | "Couldn't load your data" + Retry, session still valid |
| F-004 | TODO | 9 | Shell | Boot loading skeleton (two SkeletonCards) |
| F-005 | TODO | 9 | Shell | Session-expired → sign-in carrying an honest reason |
| F-006 | TODO | 9 | Shell | Sign out; local state cleared even when the server never confirms |
| F-007 | TODO | 7 | Shell | First-run gate → SetupWizard when GET /profile is null |
| F-008 | TODO | 8 | Shell | Global refresh-failure banner |
| F-009 | TODO | 9 | Shell | Upgrade-return flow `?upgraded=1` → checking / done / slow + Dismiss |
| F-010 | TODO | 9 | Shell | Penny-test checkout via `?penny=1` |
| F-011 | TODO | 8 | Shell | Skip-to-main-content link |
| F-012 | TODO | 9 | Shell | Focus moves to the new view's `<h1>` on tab switch |
| F-013 | TODO | 8 | Shell | Uncaught async error → bug-report dialog |
| F-014 | TODO | 8 | Shell | Render-crash boundary: Try again / Reload the app / Report this |
| F-015 | TODO | 8 | Sidebar | Primary nav — Profile · Today · Plan · Recipes · Training · Trend · Wellbeing · Engine |
| F-016 | TODO | 8 | Sidebar | Collapse / expand the rail, remembered |
| F-017 | TODO | 8 | Sidebar | Training "SOON" state — greyed, unclickable, named for AT |
| F-018 | TODO | 8 | Sidebar | Wellbeing quiet amber marker, signal-driven, never counts or repeats |
| F-019 | TODO | 8 | Sidebar | "How it compares" launcher |
| F-020 | TODO | 8 | Sidebar | "Report a bug" launcher, always available |
| F-021 | TODO | 8 | Sidebar | Foods highlights Recipes as the active nav item |
| F-022 | TODO | 8 | Header | Day N + Target kcal readout |
| F-023 | TODO | 4 | Header | Theme toggle — Light / Dark / System |
| F-024 | TODO | 9 | Login | Install probe `/auth/status` → register vs sign-in |
| F-025 | TODO | 9 | Login | Google sign-in (web build) |
| F-026 | TODO | 9 | Login | Terms / Privacy links + not-medical-advice line |
| F-027 | TODO | 9 | Login | Email + password sign-in |
| F-028 | TODO | 9 | Login | Show / hide password eye toggle |
| F-029 | TODO | 9 | Login | Wrong-password copy — a 401 here is not "session expired" |
| F-030 | TODO | 9 | Login | Backend-unreachable notice on the sign-in form |
| F-031 | TODO | 9 | Login | Create the first account, with client-side validation |
| F-032 | TODO | 9 | Login | Password reset step 1 — write a one-time code to a local file |
| F-033 | TODO | 9 | Login | Password reset step 2 — code + new password, lands signed in |
| F-034 | TODO | 5 | Wizard | Four named steps, back-nav to completed steps only |
| F-035 | TODO | 5 | Wizard | Units toggle **converts** what is already typed |
| F-036 | TODO | 5 | Wizard | Step 0 — sex, age, height (cm or ft+in), weight, goal, body fat % |
| F-037 | TODO | 5 | Wizard | Per-field notes that name the problem, only once earned |
| F-038 | TODO | 5 | Wizard | Under-18 refusal panel, explained, shown before the server is asked |
| F-039 | TODO | 5 | Wizard | Goal-weight hard-floor refusal panel with its reasoning |
| F-040 | TODO | 5 | Wizard | Goal-weight grey-zone acknowledgement tick |
| F-041 | TODO | 5 | Wizard | Step 1 — occupation search + select, plain-English activity phrase |
| F-042 | TODO | 5 | Wizard | Training style / sessions / minutes, greyed when "none" |
| F-043 | TODO | 5 | Wizard | Step 2 — allergy search, quick chips, free text |
| F-044 | TODO | 5 | Wizard | Dietary style, meals/day, snacks/day |
| F-045 | TODO | 5 | Wizard | Step 3 — rate picker + aggressive-rate acknowledgement |
| F-046 | TODO | 5 | Wizard | Estimate path — assumptions listed, explicit tick, marker left behind |
| F-047 | TODO | 5 | Wizard | A server refusal lands the user on the step that owns the field |
| F-048 | TODO | 5 | Wizard | Focus moves to the step panel on step change |
| F-049 | TODO | 8 | Today | Page head — day N, target, plan rate, "ESTIMATE FROM DEFAULTS" prefix |
| F-050 | TODO | 8 | Today | Provisional-profile banner + "Show what was assumed" |
| F-051 | TODO | 8 | Today | Planned-vs-target ring + target / planned / meal count |
| F-052 | TODO | 9 | Today | Compact premium lock over the planned card |
| F-053 | TODO | 8 | Today | Plan loading skeleton / load-error note / empty state |
| F-054 | TODO | 8 | Today | "Generate this week's plan" from the empty state, with a live status line |
| F-055 | TODO | 8 | Today | Over-target amber coach line — never red, promises only what the engine can do |
| F-056 | TODO | 8 | Today | Unsolved-slot warnings, full solver reason unabridged |
| F-057 | TODO | 8 | Today | Macro rails — protein/carb as ranges, fat as a floor, plus the explainer |
| F-058 | TODO | 8 | Today | Verdict stamp + 7-day avg / rate / target tiles + band sentence |
| F-059 | TODO | 8 | Today | Weigh-in — date + weight + Log, Enter submits |
| F-060 | TODO | 8 | Today | Weigh-in out-of-range message that says why |
| F-061 | TODO | 8 | Today | Food diary — "Ate as planned" copies today's plan |
| F-062 | TODO | 8 | Today | Food search — debounced combobox, arrow keys, Enter to pick, Escape clears |
| F-063 | TODO | 8 | Today | Per-row caution / avoid notes + provenance, shown before choosing |
| F-064 | TODO | 8 | Today | Portion step — grams in, live kcal/P/C/F out before saving |
| F-065 | TODO | 8 | Today | Manual "not in the library" entry; 0 kcal is a real entry |
| F-066 | TODO | 8 | Today | Delete a diary entry — optimistic, rolls back on refusal |
| F-067 | TODO | 8 | Today | Eaten-vs-target block, over-by line, rails against actuals |
| F-068 | TODO | 8 | Today | Diary route-not-live 404 degradation, stated calmly |
| F-069 | TODO | 8 | Today | "Your target didn't re-derive just now" notice |
| F-070 | TODO | 8 | Today | Micronutrients "moved to Wellbeing" seat + link |
| F-071 | TODO | 8 | Today | Trend snapshot chart + computed a11y summary + "Full trend" link |
| F-072 | TODO | 8 | Today | Snapshot empty / first-point-logged states |
| F-073 | TODO | 8 | Today | Recent entries (last 8) with per-row delete |
| F-074 | TODO | 8 | Today | 4-week photo + tape audit reminder |
| F-075 | TODO | 8 | Profile | "Changes save as you go" / Saving… / Saved receipt |
| F-076 | TODO | 8 | Profile | Jump-to-allergies button carrying the live count |
| F-077 | TODO | 8 | Profile | Units toggle, commits immediately |
| F-078 | TODO | 8 | Profile | Sex, age, height, body fat %, goal weight — commit on blur |
| F-079 | TODO | 8 | Profile | Blur guard — no write unless the value in the user's own unit changed |
| F-080 | TODO | 8 | Profile | Current weight read-only + "Log a weigh-in on Today" link |
| F-081 | TODO | 8 | Profile | "Estimate visually" opens the body-fat picker |
| F-082 | TODO | 8 | Profile | Occupation search combobox with per-row multiplier |
| F-083 | TODO | 8 | Profile | Occupation-list-unavailable fallback that names the saved job |
| F-084 | TODO | 8 | Profile | Multiplier override, training style, sessions, minutes (off when "none") |
| F-085 | TODO | 8 | Profile | Allergy search + quick chips + free text + remove |
| F-086 | TODO | 8 | Profile | Allergy rollback-to-server-truth + non-dismissable NOT SAVED alert |
| F-087 | TODO | 8 | Profile | "Check what the server has" re-verification |
| F-088 | TODO | 8 | Profile | "Did you mean <category>?" term replacement |
| F-089 | TODO | 8 | Profile | How each exclusion is actually matched — literal vs category |
| F-090 | TODO | 8 | Profile | Dietary style select + failed-load fallback that keeps the saved value |
| F-091 | TODO | 8 | Profile | AI recipe preferences (collapsed) — cuisines + notes |
| F-092 | TODO | 8 | Profile | Rate-of-loss picker, kg or lb primary by unit preference |
| F-093 | TODO | 8 | Profile | Daily target + "TDEE − deficit" + held-at-floor note |
| F-094 | TODO | 8 | Profile | "Goal date, if the plan holds", re-derived when the target is floored |
| F-095 | TODO | 8 | Profile | Personal calorie floor (stricter-only) |
| F-096 | TODO | 8 | Profile | "Inside this app's default limits" / "Aggressive — acknowledged" |
| F-097 | TODO | 8 | Profile | Rate / goal acknowledgement prompt; Cancel reverts the boxes |
| F-098 | TODO | 8 | Profile | Adult-only / goal-floor gate panel + "Got it" |
| F-099 | TODO | 8 | Profile | Per-field server messages under the input that caused them |
| F-100 | TODO | 8 | Profile | Any failed commit reverts drafts to server truth |
| F-101 | TODO | 8 | Profile | "Outside help, if you ever want it" resources card |
| F-102 | TODO | 8 | Profile | Coach connect card — relay address + device token, save / check / disconnect |
| F-103 | TODO | 5 | BF picker | Six abstract silhouette buckets (never photographs) |
| F-104 | TODO | 5 | BF picker | "I had it measured" numeric entry, 3–70 |
| F-105 | TODO | 5 | BF picker | "Not sure — skip" clears back to unknown |
| F-106 | TODO | 5 | BF picker | Focus trap + Escape + backdrop close |
| F-107 | TODO | 8 | Engine | Step 1 BMR panel with per-formula include / exclude |
| F-108 | TODO | 8 | Engine | Per-formula citation — journal, year, independence note |
| F-109 | TODO | 8 | Engine | Formula toggle failure rolls back and names refused vs no-answer |
| F-110 | TODO | 8 | Engine | "Everything was excluded" fallback notice |
| F-111 | TODO | 8 | Engine | BMR average + spread + dispersion-not-confidence caveat |
| F-112 | TODO | 8 | Engine | Body-fat-unknown hint that names the two unlocked formulas |
| F-113 | TODO | 8 | Engine | Step 2 TDEE component build + MET explained in words |
| F-114 | TODO | 8 | Engine | Step 3 target math incl. floor clamp and the ±cap intermediates |
| F-115 | TODO | 8 | Engine | "Change rate on Profile" link |
| F-116 | TODO | 8 | Engine | Step 2 detail — adaptive burn reconciliation, ledger, uncertainty terms |
| F-117 | TODO | 8 | Engine | Step 4 macro engine — bar, P/C/F legend, ranges, midpoint-gap notes |
| F-118 | TODO | 8 | Engine | Protein-range basis citation |
| F-119 | TODO | 8 | Engine | "There is nothing to do on this screen" first-run explainer |
| F-120 | TODO | 8 | Engine | "Food database" shortcut |
| F-121 | TODO | 8 | Engine | Raw JSON copy-out — today the only data-export path |
| F-122 | TODO | 8 | Plan | Horizon picker — 1 meal / 1 day / 3 days / 1 week / 2 weeks / 1 month / custom |
| F-123 | TODO | 8 | Plan | Horizon summary sentence + variety-cap arithmetic |
| F-124 | TODO | 8 | Plan | Generate / Regenerate / Fit one meal |
| F-125 | TODO | 8 | Plan | Cancel an in-flight generate (leaves the plan untouched) |
| F-126 | TODO | 8 | Plan | Honest staged progress — real phases, no fabricated percentage |
| F-127 | TODO | 8 | Plan | One-meal result card — an answer, nothing written |
| F-128 | TODO | 8 | Plan | Multi-week summary — weeks written, per-week days-on-target |
| F-129 | TODO | 8 | Plan | Filters — cuisine chips, protein, budget, max prep, batch repeats |
| F-130 | TODO | 8 | Plan | Optional caps with a real OFF state — cost, complexity, min taste |
| F-131 | TODO | 8 | Plan | Protein-priority mode, remembered |
| F-132 | TODO | 8 | Plan | Solver narration — match %, days in tolerance, recipe funnel, per-day strip |
| F-133 | TODO | 8 | Plan | Binding-constraint line + diagnosis sentences |
| F-134 | TODO | 8 | Plan | "Protein floor defended N/M days" |
| F-135 | TODO | 8 | Plan | Verdict survives reload — DB, then session, then local mirror |
| F-136 | TODO | 8 | Plan | Stale-verdict panel when the meals changed after scoring |
| F-137 | TODO | 8 | Plan | Seven-column week board — kcal, fill counts, exceptions, hover names |
| F-138 | TODO | 8 | Plan | Compact day picker on narrow windows |
| F-139 | TODO | 8 | Plan | ← / → keyboard day navigation, ignored while typing |
| F-140 | TODO | 8 | Plan | Day total vs target line |
| F-141 | TODO | 8 | Plan | "3 options for <day>" solve, with the superseded-response race guard |
| F-142 | TODO | 8 | Plan | Day candidate cards — green only when the server said in-tolerance |
| F-143 | TODO | 8 | Plan | Accept a day; refuses outright if the selection moved |
| F-144 | TODO | 8 | Plan | Day-options "closest fit — here's what's binding" panel |
| F-145 | TODO | 8 | Plan | Slot card expand / collapse — ingredients + numbered steps |
| F-146 | TODO | 8 | Plan | Slot lock / unlock, optimistic with rollback |
| F-147 | TODO | 8 | Plan | Slot swap — load three alternates, apply one |
| F-148 | TODO | 8 | Plan | Slot cart toggle, optimistic with rollback |
| F-149 | TODO | 8 | Plan | Per-slot warning + "fix it with the swap button" action line |
| F-150 | TODO | 8 | Plan | Meal structure — meals/day + snacks/day, commit on blur, revert on failure |
| F-151 | TODO | 8 | Plan | Grocery list generate / regenerate from the week |
| F-152 | TODO | 8 | Plan | Grocery Copy / Text (sms:) / Email (mailto:) |
| F-153 | TODO | 8 | Plan | Grocery items by store section, household units, ≈ per-item cost |
| F-154 | TODO | 8 | Plan | Grocery check-off, persisted, rolls back and reloads on failure |
| F-155 | TODO | 8 | Plan | Weekly total deliberately withheld, with the reason stated |
| F-156 | TODO | 9 | Plan | Whole-tab premium gate with the pricing overlay |
| F-157 | TODO | 8 | Plan | Week-board and list loading skeletons |
| F-158 | TODO | 8 | Plan | "No plan yet" empty state naming the exact next action |
| F-159 | TODO | 8 | Recipes | Import from a recipe URL (schema.org markup), Enter submits |
| F-160 | TODO | 8 | Recipes | AI generation form — slot, protein, cuisine, max prep, free text |
| F-161 | TODO | 8 | Recipes | Single-serving vs batch-cook radio |
| F-162 | TODO | 8 | Recipes | Per-generation allergen override — loud, and re-arms automatically |
| F-163 | TODO | 8 | Recipes | Generate three drafts |
| F-164 | TODO | 8 | Recipes | AI-off build message naming what still works |
| F-165 | TODO | 8 | Recipes | Allergen-override banner listing the violating drafts |
| F-166 | TODO | 8 | Recipes | Dropped-for-allergies / dropped-for-shape notes |
| F-167 | TODO | 8 | Recipes | Draft card — edit each ingredient's grams before saving |
| F-168 | TODO | 8 | Recipes | Draft allergen-violation banner + ALLERGEN chip (the one sanctioned red) |
| F-169 | TODO | 8 | Recipes | Import notes and placeholder-macro warnings on a draft |
| F-170 | TODO | 8 | Recipes | Save a draft into the library |
| F-171 | TODO | 8 | Recipes | Cart — macro totals, per-item remove |
| F-172 | TODO | 8 | Recipes | "Fill today's plan" from the cart |
| F-173 | TODO | 8 | Recipes | Cart grocery list + Copy / Text / Email |
| F-174 | TODO | 8 | Recipes | An unreadable cart is not an empty cart |
| F-175 | TODO | 8 | Recipes | Library search |
| F-176 | TODO | 8 | Recipes | Group by cuisine / meal type / main protein |
| F-177 | TODO | 8 | Recipes | Sort A–Z / fewest calories / most protein per calorie |
| F-178 | TODO | 8 | Recipes | Collapsible groups with counts |
| F-179 | TODO | 8 | Recipes | Progressive reveal — "Show 60 more" / "Show all N" / "Showing X of N" |
| F-180 | TODO | 8 | Recipes | "N recipes hidden by your diet & allergy rules" |
| F-181 | TODO | 8 | Recipes | Library-wide untrusted-ingredient summary, stated once with real numbers |
| F-182 | TODO | 8 | Recipes | Per-row amber marker when ≥ 60 % of the calories are untrusted |
| F-183 | TODO | 8 | Recipes | Expand a recipe row |
| F-184 | TODO | 8 | Recipes | Serving scale ×0.5–×2 with live macros and per-ingredient grams |
| F-185 | TODO | 8 | Recipes | "Incomplete data" panel naming every flagged ingredient and the share |
| F-186 | TODO | 8 | Recipes | Add to a plan slot — day + meal/snack index, at the current scale |
| F-187 | TODO | 8 | Recipes | Add / remove from cart in the detail view |
| F-188 | TODO | 8 | Recipes | Taste rating thumbs; clicking the active thumb clears it |
| F-189 | TODO | 8 | Recipes | Inline edit — name, description, cuisine, slot, prep, ingredients, steps |
| F-190 | TODO | 8 | Recipes | Remove an ingredient in the editor |
| F-191 | TODO | 8 | Recipes | Delete a recipe — confirm step, row removed only once the server confirms |
| F-192 | TODO | 8 | Recipes | Library-load failure is never drawn as "no recipes yet" |
| F-193 | TODO | 8 | Recipes | Empty states — no recipes yet / no search match |
| F-194 | TODO | 8 | Recipes | "Food database" shortcut |
| F-195 | TODO | 8 | Foods | Cached 14k-row library store with TTL + field projection |
| F-196 | TODO | 8 | Foods | Search all foods, debounced, results never blank mid-word |
| F-197 | TODO | 8 | Foods | Collapsible category groups with counts |
| F-198 | TODO | 8 | Foods | Windowed row list, keyboard-scrollable |
| F-199 | TODO | 8 | Foods | Row provenance glyph (community) + amber caution triangle |
| F-200 | TODO | 8 | Foods | Select a food → detail panel |
| F-201 | TODO | 8 | Foods | Detail — category chip, source / FDC id / brand / UPC, warning chip |
| F-202 | TODO | 8 | Foods | Zero-macro placeholder warning |
| F-203 | TODO | 8 | Foods | Open Food Facts crowd-sourced caveat |
| F-204 | TODO | 8 | Foods | Macro stats per 100 g |
| F-205 | TODO | 8 | Foods | Admin edit of macros + category, Atwater-validated on save |
| F-206 | TODO | 8 | Foods | "Editing is admin-only" for everyone else |
| F-207 | TODO | 8 | Foods | Add 100 g of this food to a recipe, via a searchable picker |
| F-208 | TODO | 8 | Foods | "Log today" disabled, with the honest reason |
| F-209 | TODO | 8 | Foods | Count of rows known to carry another food's numbers |
| F-210 | TODO | 8 | Foods | Partial-payload warning — "server sent N of M" |
| F-211 | TODO | 8 | Foods | Load-failure state + Retry, never drawn as an empty database |
| F-212 | TODO | 8 | Foods | Genuinely-empty-database state |
| F-213 | TODO | 8 | Foods | Return control that names its destination rather than saying "Back" |
| F-214 | TODO | 8 | Foods | Barcode lookup panel toggle |
| F-215 | TODO | 8 | Barcode | Manual UPC entry + look up (preview only, nothing saved) |
| F-216 | TODO | 8 | Barcode | Webcam scan, feature-detected, absent when unsupported |
| F-217 | TODO | 8 | Barcode | Camera failure paths — permission denied, playback blocked |
| F-218 | TODO | 8 | Barcode | Verdict banner pass / warn / reject with plain-English issue names |
| F-219 | TODO | 8 | Barcode | Add to library — re-validated server-side, tagged COMMUNITY |
| F-220 | TODO | 8 | Barcode | "Already in your library" state |
| F-221 | TODO | 8 | Barcode | Not-found and timeout are different results, worded differently |
| F-222 | TODO | 8 | Barcode | Resting state explaining what a good input looks like |
| F-223 | TODO | 8 | Trend | Weight chart — raw points, robust fit, ±1 SE band, goal line, lean mass |
| F-224 | TODO | 8 | Trend | Legend drawn as sample marks, not colours to match from memory |
| F-225 | TODO | 8 | Trend | Chart tooltip — an enhancement, never the only path to a value |
| F-226 | TODO | 8 | Trend | "Show all N weigh-ins as a table" — the keyboard / AT path to every number |
| F-227 | TODO | 8 | Trend | Outlier disclosure — excluded from domain and average, never deleted |
| F-228 | TODO | 8 | Trend | Goal-off-chart explanation instead of a silently clipped line |
| F-229 | TODO | 8 | Trend | Fit-vs-average explainer naming the window and why it stops |
| F-230 | TODO | 8 | Trend | Lean-mass provenance, or the "add a body fat %" prompt |
| F-231 | TODO | 8 | Trend | Numbers card — 7-day average, lost from start, rate, lean mass |
| F-232 | TODO | 8 | Trend | Thin-window / skipped-outlier / stale-weigh-in notices |
| F-233 | TODO | 8 | Trend | Projection cone — most likely, fast edge, slow edge |
| F-234 | TODO | 8 | Trend | Planned-pace projection fallback, labelled a plan not a measurement |
| F-235 | TODO | 8 | Trend | "The trend is moving away from your goal" state |
| F-236 | TODO | 8 | Trend | At-goal state |
| F-237 | TODO | 8 | Trend | Empty / first-point chart states |
| F-238 | TODO | 8 | Trend | Training nudge card; a load failure never reads as "no plan" |
| F-239 | TODO | 8 | Training | Inputs — days/week, session length, style, experience |
| F-240 | TODO | 8 | Training | Equipment multi-select chips |
| F-241 | TODO | 8 | Training | Generate / regenerate a plan (regenerate replaces the current one) |
| F-242 | TODO | 8 | Training | Week chips 1–4 switch the displayed week |
| F-243 | TODO | 8 | Training | Session tables — exercise, sets, reps, RPE, rest |
| F-244 | TODO | 8 | Training | Plan notes carrying the generator's honest caveats |
| F-245 | TODO | 8 | Training | Delete plan behind a confirm step |
| F-246 | TODO | 8 | Training | V1 TEMPLATES badge + scaffold-honesty copy |
| F-247 | TODO | 8 | Training | Empty and loading states |
| F-248 | TODO | 8 | Wellbeing | Signals panel derived live from the user's own numbers, self-clearing |
| F-249 | TODO | 8 | Wellbeing | Self-check status card — never taken / flagged / nothing flagged |
| F-250 | TODO | 8 | Wellbeing | Open the self-check |
| F-251 | TODO | 8 | Wellbeing | "Delete my result" in one click, with focus handed on safely |
| F-252 | TODO | 8 | Wellbeing | Risk gate — a positive screen leads with support, not 47 numbers |
| F-253 | TODO | 8 | Wellbeing | "Show the full breakdown anyway" escape hatch, always one click |
| F-254 | TODO | 8 | Wellbeing | Micronutrients card — grouped nutrients, collapse remembered |
| F-255 | TODO | 8 | Wellbeing | Target meter vs limit meter — different shapes, no colour grading |
| F-256 | TODO | 8 | Wellbeing | Support resources — phone, email, website, opened externally |
| F-257 | TODO | 8 | Wellbeing | Standing "Not medical advice" card |
| F-258 | TODO | 8 | Check | Five SCOFF yes/no questions + answered count |
| F-259 | TODO | 8 | Check | "See my result", enabled only when all five are answered |
| F-260 | TODO | 8 | Check | Reset the answers |
| F-261 | TODO | 8 | Check | Result panel — calm amber when positive, never red |
| F-262 | TODO | 8 | Check | Collapsible full health / legal disclaimer |
| F-263 | TODO | 8 | Check | Focus trap + Escape + close |
| F-264 | TODO | 8 | Compare | Twelve-row comparison table against five named apps |
| F-265 | TODO | 8 | Compare | Mark legend (yes / partial / paid / none) + per-cell footnotes |
| F-266 | TODO | 8 | Compare | "Wins" and "Where it's behind (honestly)" panels |
| F-267 | TODO | 8 | Compare | Allergen caveat + comparison provenance and non-affiliation note |
| F-268 | TODO | 8 | Bug | Optional "what were you doing" note |
| F-269 | TODO | 8 | Bug | Exact-payload preview before anything is sent |
| F-270 | TODO | 8 | Bug | Send — opens a prefilled GitHub issue in the real browser |
| F-271 | TODO | 8 | Bug | Offline → save the report for later |
| F-272 | TODO | 8 | Bug | Pending-reports banner + "Open them now" |
| F-273 | TODO | 8 | Bug | Copy the report to the clipboard |
| F-274 | TODO | 8 | Bug | Online / offline detection drives the primary button |
| F-275 | TODO | 8 | Coach | Launcher pill, rendered only when a relay is configured |
| F-276 | TODO | 8 | Coach | Chat panel with history-aware turns and a 500-char cap |
| F-277 | TODO | 8 | Coach | Starter prompt chips |
| F-278 | TODO | 8 | Coach | Depth picker — Quick / Balanced / Thorough, each explained |
| F-279 | TODO | 8 | Coach | Deterministic plan card rendered from engine numbers only |
| F-280 | TODO | 8 | Coach | Escape closes and returns focus to the launcher |
| F-281 | TODO | 8 | Coach | Failure message that protects the engine's authority |
| F-282 | TODO | 8 | Coach | Live status re-check when the settings card changes something |
| F-283 | TODO | 9 | Pricing | Monthly / annual toggle |
| F-284 | TODO | 9 | Pricing | Price, savings badge, feature list |
| F-285 | TODO | 9 | Pricing | "Unlock with Premium" → checkout |
| F-286 | TODO | 9 | Pricing | Checkout-not-wired / checkout-failed note |
| F-287 | TODO | 9 | Premium | Blurred, inert preview of the real premium component behind the lock |

---

Total: 287 capabilities · 287 TODO · 0 IN_PROGRESS · 0 DONE · 0 BLOCKED
