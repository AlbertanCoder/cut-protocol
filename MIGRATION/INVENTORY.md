# INVENTORY — every user-reachable capability

Built 2026-08-07 (Phase 0) by reading every screen file in `frontend/src` in full.
**287 rows.** IDs are assigned once and never renumbered or reused.

Every `Source` is a real `file:line` that was read. `Persists?` means the
capability writes something that survives a restart (server DB or `localStorage`).

Line numbers refer to the tree at commit `0269eeb` (`phase-0-base`).

| ID | Screen | Capability | Trigger | Source (file:line) | Persists? | Phase |
|---|---|---|---|---|---|---|
| F-001 | Shell | Boot auth resolve → checking / out / unreachable / in | app launch | `App.jsx:201-228` | No | 9 |
| F-002 | Shell | "Can't reach the app's server" state + Retry (NOT a sign-out) | server 5xx / no answer | `App.jsx:315-325` | No | 9 |
| F-003 | Shell | "Couldn't load your data" + Retry, session still valid | loadData throws | `App.jsx:358-368` | No | 9 |
| F-004 | Shell | Boot loading skeleton (two SkeletonCards) | authStatus checking | `App.jsx:281-288` | No | 9 |
| F-005 | Shell | Session-expired → sign-in carrying an honest reason | HTTP 401 seam | `App.jsx:174-186` | No | 9 |
| F-006 | Shell | Sign out; local state cleared even when the server never confirms | Sidebar "Log out" | `App.jsx:244-267` | No | 9 |
| F-007 | Shell | First-run gate → SetupWizard when GET /profile is null | first launch | `App.jsx:190-195,352-354` | Yes | 7 |
| F-008 | Shell | Global refresh-failure banner | refresh() fails | `App.jsx:393-397` | No | 8 |
| F-009 | Shell | Upgrade-return flow `?upgraded=1` → checking / done / slow + Dismiss | return from checkout | `App.jsx:65-94,398-414` | No | 9 |
| F-010 | Shell | Penny-test checkout via `?penny=1` | URL param | `App.jsx:108-114` | No | 9 |
| F-011 | Shell | Skip-to-main-content link | Tab at page top | `App.jsx:388`, `index.css:267-284` | No | 8 |
| F-012 | Shell | Focus moves to the new view's `<h1>` on tab switch | tab change | `App.jsx:148-157` | No | 9 |
| F-013 | Shell | Uncaught async error → bug-report dialog | window error / rejection | `App.jsx:161-163`, `main.jsx:23` | No | 8 |
| F-014 | Shell | Render-crash boundary: Try again / Reload the app / Report this | render throw | `ErrorBoundary.jsx:25-62,79-100` | No | 8 |
| F-015 | Sidebar | Primary nav — Profile · Today · Plan · Recipes · Training · Trend · Wellbeing · Engine | click | `Sidebar.jsx:10-25,56-100` | No | 8 |
| F-016 | Sidebar | Collapse / expand the rail, remembered | click chevron | `Sidebar.jsx:28-32,141-147` | Yes | 8 |
| F-017 | Sidebar | Training "SOON" state — greyed, unclickable, named for AT | `TRAINING="soon"` | `Sidebar.jsx:17,68-72,95-97` | No | 8 |
| F-018 | Sidebar | Wellbeing quiet amber marker, signal-driven, never counts or repeats | user's own numbers | `App.jsx:382-384`, `Sidebar.jsx:86-94` | No | 8 |
| F-019 | Sidebar | "How it compares" launcher | click | `Sidebar.jsx:109-119` | No | 8 |
| F-020 | Sidebar | "Report a bug" launcher, always available | click | `Sidebar.jsx:127-137` | No | 8 |
| F-021 | Sidebar | Foods highlights Recipes as the active nav item | `tab==="foods"` | `Sidebar.jsx:34` | No | 8 |
| F-022 | Header | Day N + Target kcal readout | render | `ui/HeaderBar.jsx:12-25` | No | 8 |
| F-023 | Header | Theme toggle — Light / Dark / System | click | `mode-toggle.jsx:11-30` | Yes | 4 |
| F-024 | Login | Install probe `/auth/status` → register vs sign-in | mount (desktop) | `LoginScreen.jsx:118-139` | No | 9 |
| F-025 | Login | Google sign-in (web build) | click | `LoginScreen.jsx:176-219` | Yes | 9 |
| F-026 | Login | Terms / Privacy links + not-medical-advice line | render | `LoginScreen.jsx:211-217` | No | 9 |
| F-027 | Login | Email + password sign-in | submit | `LoginScreen.jsx:263-317` | Yes | 9 |
| F-028 | Login | Show / hide password eye toggle | click | `LoginScreen.jsx:233-261` | No | 9 |
| F-029 | Login | Wrong-password copy — a 401 here is not "session expired" | bad credentials | `LoginScreen.jsx:106-109` | No | 9 |
| F-030 | Login | Backend-unreachable notice on the sign-in form | status probe failed | `LoginScreen.jsx:295-299` | No | 9 |
| F-031 | Login | Create the first account, with client-side validation | submit | `LoginScreen.jsx:446-529` | Yes | 9 |
| F-032 | Login | Password reset step 1 — write a one-time code to a local file | click "Forgot your password?" | `LoginScreen.jsx:337-352,386-401` | No | 9 |
| F-033 | Login | Password reset step 2 — code + new password, lands signed in | submit | `LoginScreen.jsx:354-375,404-441` | Yes | 9 |
| F-034 | Wizard | Four named steps, back-nav to completed steps only | click / Next / Back | `SetupWizard.jsx:15-20,604-643,1053-1079` | No | 5 |
| F-035 | Wizard | Units toggle **converts** what is already typed | click | `SetupWizard.jsx:275-298,780-788` | Yes | 5 |
| F-036 | Wizard | Step 0 — sex, age, height (cm or ft+in), weight, goal, body fat % | typing | `SetupWizard.jsx:790-847` | Yes | 5 |
| F-037 | Wizard | Per-field notes that name the problem, only once earned | blur / Next | `SetupWizard.jsx:383-411,560-573` | No | 5 |
| F-038 | Wizard | Under-18 refusal panel, explained, shown before the server is asked | age entered | `SetupWizard.jsx:64-73,416-419,676-691` | No | 5 |
| F-039 | Wizard | Goal-weight hard-floor refusal panel with its reasoning | goal BMI below floor | `SetupWizard.jsx:90-100,430-444,698-713` | No | 5 |
| F-040 | Wizard | Goal-weight grey-zone acknowledgement tick | BMI in the grey band | `SetupWizard.jsx:423-425,854-880` | Yes | 5 |
| F-041 | Wizard | Step 1 — occupation search + select, plain-English activity phrase | typing / click | `SetupWizard.jsx:892-927` | Yes | 5 |
| F-042 | Wizard | Training style / sessions / minutes, greyed when "none" | select / typing | `SetupWizard.jsx:931-956` | Yes | 5 |
| F-043 | Wizard | Step 2 — allergy search, quick chips, free text | typing / click | `SetupWizard.jsx:971-983` | Yes | 5 |
| F-044 | Wizard | Dietary style, meals/day, snacks/day | select / typing | `SetupWizard.jsx:985-998` | Yes | 5 |
| F-045 | Wizard | Step 3 — rate picker + aggressive-rate acknowledgement | click / tick | `SetupWizard.jsx:1009-1047` | Yes | 5 |
| F-046 | Wizard | Estimate path — assumptions listed, explicit tick, marker left behind | click "Show me what that assumes" | `SetupWizard.jsx:649-665,720-767` | Yes | 5 |
| F-047 | Wizard | A server refusal lands the user on the step that owns the field | PUT /profile error | `SetupWizard.jsx:24-29,516-540` | No | 5 |
| F-048 | Wizard | Focus moves to the step panel on step change | Next / Back | `SetupWizard.jsx:351-356` | No | 5 |
| F-049 | Today | Page head — day N, target, plan rate, "ESTIMATE FROM DEFAULTS" prefix | render | `TodayTab.jsx:837-842` | No | 8 |
| F-050 | Today | Provisional-profile banner + "Show what was assumed" | profile from defaults | `TodayTab.jsx:641-675,844` | No | 8 |
| F-051 | Today | Planned-vs-target ring + target / planned / meal count | plan loaded | `TodayTab.jsx:908-916` | No | 8 |
| F-052 | Today | Compact premium lock over the planned card | free tier | `TodayTab.jsx:855-856`, `ui/PremiumGate.jsx:43-55` | No | 9 |
| F-053 | Today | Plan loading skeleton / load-error note / empty state | fetch state | `TodayTab.jsx:858-872` | No | 8 |
| F-054 | Today | "Generate this week's plan" from the empty state, with a live status line | click | `TodayTab.jsx:764-778,888-901` | Yes | 8 |
| F-055 | Today | Over-target amber coach line — never red, promises only what the engine can do | planned > target | `TodayTab.jsx:917-923` | No | 8 |
| F-056 | Today | Unsolved-slot warnings, full solver reason unabridged | slot carries a warning | `TodayTab.jsx:690-730,926` | No | 8 |
| F-057 | Today | Macro rails — protein/carb as ranges, fat as a floor, plus the explainer | render | `TodayTab.jsx:90-146` | No | 8 |
| F-058 | Today | Verdict stamp + 7-day avg / rate / target tiles + band sentence | render | `TodayTab.jsx:934-957` | No | 8 |
| F-059 | Today | Weigh-in — date + weight + Log, Enter submits | type / Enter / click | `TodayTab.jsx:961-987,783-802` | Yes | 8 |
| F-060 | Today | Weigh-in out-of-range message that says why | invalid input | `TodayTab.jsx:786-789` | No | 8 |
| F-061 | Today | Food diary — "Ate as planned" copies today's plan | click | `TodayTab.jsx:430-436,499-501` | Yes | 8 |
| F-062 | Today | Food search — debounced combobox, arrow keys, Enter to pick, Escape clears | typing / keys | `TodayTab.jsx:173-303` | No | 8 |
| F-063 | Today | Per-row caution / avoid notes + provenance, shown before choosing | results render | `TodayTab.jsx:158-171,291-294` | No | 8 |
| F-064 | Today | Portion step — grams in, live kcal/P/C/F out before saving | typing | `TodayTab.jsx:308-366` | Yes | 8 |
| F-065 | Today | Manual "not in the library" entry; 0 kcal is a real entry | click / typing | `TodayTab.jsx:466-478,530-550` | Yes | 8 |
| F-066 | Today | Delete a diary entry — optimistic, rolls back on refusal | click trash | `TodayTab.jsx:482-492,623-625` | Yes | 8 |
| F-067 | Today | Eaten-vs-target block, over-by line, rails against actuals | entries exist | `TodayTab.jsx:579-600` | No | 8 |
| F-068 | Today | Diary route-not-live 404 degradation, stated calmly | GET /diary 404 | `TodayTab.jsx:400-404,420-422,573-575` | No | 8 |
| F-069 | Today | "Your target didn't re-derive just now" notice | server flag | `TodayTab.jsx:561-565` | No | 8 |
| F-070 | Today | Micronutrients "moved to Wellbeing" seat + link | render | `TodayTab.jsx:998-1011` | No | 8 |
| F-071 | Today | Trend snapshot chart + computed a11y summary + "Full trend" link | render | `TodayTab.jsx:1014-1044` | No | 8 |
| F-072 | Today | Snapshot empty / first-point-logged states | < 2 weigh-ins | `TodayTab.jsx:1015-1020` | No | 8 |
| F-073 | Today | Recent entries (last 8) with per-row delete | render / click | `TodayTab.jsx:1047-1060,803-810` | Yes | 8 |
| F-074 | Today | 4-week photo + tape audit reminder | date math | `TodayTab.jsx:812-814,1064-1067` | No | 8 |
| F-075 | Profile | "Changes save as you go" / Saving… / Saved receipt | commit | `ProfileTab.jsx:118-125,486-494` | No | 8 |
| F-076 | Profile | Jump-to-allergies button carrying the live count | click | `ProfileTab.jsx:254-257,495-499` | No | 8 |
| F-077 | Profile | Units toggle, commits immediately | click | `ProfileTab.jsx:558-571` | Yes | 8 |
| F-078 | Profile | Sex, age, height, body fat %, goal weight — commit on blur | blur | `ProfileTab.jsx:572-646` | Yes | 8 |
| F-079 | Profile | Blur guard — no write unless the value in the user's own unit changed | blur | `ProfileTab.jsx:415-435` | Yes | 8 |
| F-080 | Profile | Current weight read-only + "Log a weigh-in on Today" link | render / click | `ProfileTab.jsx:628-638` | No | 8 |
| F-081 | Profile | "Estimate visually" opens the body-fat picker | click | `ProfileTab.jsx:622-626,472-474` | Yes | 8 |
| F-082 | Profile | Occupation search combobox with per-row multiplier | typing / click | `ProfileTab.jsx:659-690` | Yes | 8 |
| F-083 | Profile | Occupation-list-unavailable fallback that names the saved job | meta load failed | `ProfileTab.jsx:691-700` | No | 8 |
| F-084 | Profile | Multiplier override, training style, sessions, minutes (off when "none") | blur / select | `ProfileTab.jsx:701-744` | Yes | 8 |
| F-085 | Profile | Allergy search + quick chips + free text + remove | typing / click | `ProfileTab.jsx:772-789`, `ui/AllergySearch.jsx:147-399` | Yes | 8 |
| F-086 | Profile | Allergy rollback-to-server-truth + non-dismissable NOT SAVED alert | PUT fails | `ProfileTab.jsx:284-318,810-837` | Yes | 8 |
| F-087 | Profile | "Check what the server has" re-verification | click | `ProfileTab.jsx:266-278,359-371,830-832` | No | 8 |
| F-088 | Profile | "Did you mean <category>?" term replacement | click | `ProfileTab.jsx:350-356`, `ui/AllergySearch.jsx:362-372` | Yes | 8 |
| F-089 | Profile | How each exclusion is actually matched — literal vs category | descriptions load | `ui/AllergySearch.jsx:342-382` | No | 8 |
| F-090 | Profile | Dietary style select + failed-load fallback that keeps the saved value | select | `ProfileTab.jsx:840-851` | Yes | 8 |
| F-091 | Profile | AI recipe preferences (collapsed) — cuisines + notes | click / blur | `ProfileTab.jsx:855-875` | Yes | 8 |
| F-092 | Profile | Rate-of-loss picker, kg or lb primary by unit preference | click | `ProfileTab.jsx:894-908` | Yes | 8 |
| F-093 | Profile | Daily target + "TDEE − deficit" + held-at-floor note | render | `ProfileTab.jsx:910-919` | No | 8 |
| F-094 | Profile | "Goal date, if the plan holds", re-derived when the target is floored | render | `ProfileTab.jsx:452-468,920-939` | No | 8 |
| F-095 | Profile | Personal calorie floor (stricter-only) | blur | `ProfileTab.jsx:940-947` | Yes | 8 |
| F-096 | Profile | "Inside this app's default limits" / "Aggressive — acknowledged" | render | `ProfileTab.jsx:948-970` | No | 8 |
| F-097 | Profile | Rate / goal acknowledgement prompt; Cancel reverts the boxes | 422 requiresAck | `ProfileTab.jsx:154-158,169-184,530-553` | Yes | 8 |
| F-098 | Profile | Adult-only / goal-floor gate panel + "Got it" | 403 / 400 gate | `ProfileTab.jsx:143-153,512-528` | No | 8 |
| F-099 | Profile | Per-field server messages under the input that caused them | PUT 400 | `ProfileTab.jsx:31-35,160-164` | No | 8 |
| F-100 | Profile | Any failed commit reverts drafts to server truth | commit failure | `ProfileTab.jsx:103-109` | No | 8 |
| F-101 | Profile | "Outside help, if you ever want it" resources card | render | `ProfileTab.jsx:983-990`, `ui/ResourceList.jsx:11-44` | No | 8 |
| F-102 | Profile | Coach connect card — relay address + device token, save / check / disconnect | typing / click | `CoachSettings.jsx:52-221` | Yes | 8 |
| F-103 | BF picker | Six abstract silhouette buckets (never photographs) | click | `BodyFatPicker.jsx:83-100` | Yes | 5 |
| F-104 | BF picker | "I had it measured" numeric entry, 3–70 | click / typing | `BodyFatPicker.jsx:111-127,63-67` | Yes | 5 |
| F-105 | BF picker | "Not sure — skip" clears back to unknown | click | `BodyFatPicker.jsx:62,106-108` | Yes | 5 |
| F-106 | BF picker | Focus trap + Escape + backdrop close | keyboard / click | `BodyFatPicker.jsx:46,70-72` | No | 5 |
| F-107 | Engine | Step 1 BMR panel with per-formula include / exclude | tick | `EngineTab.jsx:158-215,86-108` | Yes | 8 |
| F-108 | Engine | Per-formula citation — journal, year, independence note | render | `EngineTab.jsx:186-192` | No | 8 |
| F-109 | Engine | Formula toggle failure rolls back and names refused vs no-answer | PUT fails | `EngineTab.jsx:95-107,137` | No | 8 |
| F-110 | Engine | "Everything was excluded" fallback notice | all excluded | `EngineTab.jsx:196-200` | No | 8 |
| F-111 | Engine | BMR average + spread + dispersion-not-confidence caveat | render | `EngineTab.jsx:201-209` | No | 8 |
| F-112 | Engine | Body-fat-unknown hint that names the two unlocked formulas | bf assumed | `EngineTab.jsx:210-214` | No | 8 |
| F-113 | Engine | Step 2 TDEE component build + MET explained in words | render | `EngineTab.jsx:217-248` | No | 8 |
| F-114 | Engine | Step 3 target math incl. floor clamp and the ±cap intermediates | render | `EngineTab.jsx:250-300` | No | 8 |
| F-115 | Engine | "Change rate on Profile" link | click | `EngineTab.jsx:297-299` | No | 8 |
| F-116 | Engine | Step 2 detail — adaptive burn reconciliation, ledger, uncertainty terms | render | `AdaptiveTdeeCard.jsx:40-100` | No | 8 |
| F-117 | Engine | Step 4 macro engine — bar, P/C/F legend, ranges, midpoint-gap notes | render | `EngineTab.jsx:304-354` | No | 8 |
| F-118 | Engine | Protein-range basis citation | meta loaded | `EngineTab.jsx:349-353` | No | 8 |
| F-119 | Engine | "There is nothing to do on this screen" first-run explainer | no weigh-ins | `EngineTab.jsx:142-155` | No | 8 |
| F-120 | Engine | "Food database" shortcut | click | `EngineTab.jsx:132-134` | No | 8 |
| F-121 | Engine | Raw JSON copy-out — today the only data-export path | click | `EngineTab.jsx:362-370` | No | 8 |
| F-122 | Plan | Horizon picker — 1 meal / 1 day / 3 days / 1 week / 2 weeks / 1 month / custom | click / typing | `PlanTab.jsx:91-140` | No | 8 |
| F-123 | Plan | Horizon summary sentence + variety-cap arithmetic | render | `PlanTab.jsx:96-137` | No | 8 |
| F-124 | Plan | Generate / Regenerate / Fit one meal | click | `PlanTab.jsx:1015-1063,1239-1246` | Yes | 8 |
| F-125 | Plan | Cancel an in-flight generate (leaves the plan untouched) | click | `PlanTab.jsx:1065`, `ui/GenerationProgress.jsx:85-94` | No | 8 |
| F-126 | Plan | Honest staged progress — real phases, no fabricated percentage | generating | `ui/GenerationProgress.jsx:33-98` | No | 8 |
| F-127 | Plan | One-meal result card — an answer, nothing written | horizon = meal | `PlanTab.jsx:147-196,1276-1280` | No | 8 |
| F-128 | Plan | Multi-week summary — weeks written, per-week days-on-target | ≥ 2 week plans | `PlanTab.jsx:203-227,1292-1296` | No | 8 |
| F-129 | Plan | Filters — cuisine chips, protein, budget, max prep, batch repeats | click / select | `PlanTab.jsx:231-281` | No | 8 |
| F-130 | Plan | Optional caps with a real OFF state — cost, complexity, min taste | click / drag | `PlanTab.jsx:284-313`, `ui/FilterControls.jsx:23-96` | No | 8 |
| F-131 | Plan | Protein-priority mode, remembered | tick | `PlanTab.jsx:235-238,315-333` | Yes | 8 |
| F-132 | Plan | Solver narration — match %, days in tolerance, recipe funnel, per-day strip | verdict present | `PlanTab.jsx:495-623` | No | 8 |
| F-133 | Plan | Binding-constraint line + diagnosis sentences | infeasible | `PlanTab.jsx:606-617` | No | 8 |
| F-134 | Plan | "Protein floor defended N/M days" | protein-priority run | `PlanTab.jsx:556-563` | No | 8 |
| F-135 | Plan | Verdict survives reload — DB, then session, then local mirror | render | `PlanTab.jsx:412-468` | Yes | 8 |
| F-136 | Plan | Stale-verdict panel when the meals changed after scoring | signature mismatch | `PlanTab.jsx:473-493,1286-1290` | No | 8 |
| F-137 | Plan | Seven-column week board — kcal, fill counts, exceptions, hover names | click | `PlanTab.jsx:1332-1381` | No | 8 |
| F-138 | Plan | Compact day picker on narrow windows | click | `PlanTab.jsx:1384-1395` | No | 8 |
| F-139 | Plan | ← / → keyboard day navigation, ignored while typing | arrow keys | `PlanTab.jsx:952-963` | No | 8 |
| F-140 | Plan | Day total vs target line | render | `PlanTab.jsx:1397-1400` | No | 8 |
| F-141 | Plan | "3 options for <day>" solve, with the superseded-response race guard | click | `PlanTab.jsx:1067-1088,1401-1403` | No | 8 |
| F-142 | Plan | Day candidate cards — green only when the server said in-tolerance | render | `PlanTab.jsx:627-696` | No | 8 |
| F-143 | Plan | Accept a day; refuses outright if the selection moved | click | `PlanTab.jsx:1090-1115` | Yes | 8 |
| F-144 | Plan | Day-options "closest fit — here's what's binding" panel | diagnosis | `PlanTab.jsx:1411-1422` | No | 8 |
| F-145 | Plan | Slot card expand / collapse — ingredients + numbered steps | click title | `PlanTab.jsx:754-765,842-852` | No | 8 |
| F-146 | Plan | Slot lock / unlock, optimistic with rollback | click | `PlanTab.jsx:1119-1133,782-788` | Yes | 8 |
| F-147 | Plan | Slot swap — load three alternates, apply one | click | `PlanTab.jsx:719-746,789-796,815-840` | Yes | 8 |
| F-148 | Plan | Slot cart toggle, optimistic with rollback | click | `PlanTab.jsx:1136-1152,774-780` | Yes | 8 |
| F-149 | Plan | Per-slot warning + "fix it with the swap button" action line | slot warning | `PlanTab.jsx:799-806` | No | 8 |
| F-150 | Plan | Meal structure — meals/day + snacks/day, commit on blur, revert on failure | blur | `PlanTab.jsx:974-988,1458-1478` | Yes | 8 |
| F-151 | Plan | Grocery list generate / regenerate from the week | click | `PlanTab.jsx:1154-1165,1483-1486` | Yes | 8 |
| F-152 | Plan | Grocery Copy / Text (sms:) / Email (mailto:) | click | `PlanTab.jsx:1226-1230,1488-1501` | No | 8 |
| F-153 | Plan | Grocery items by store section, household units, ≈ per-item cost | render | `PlanTab.jsx:1503-1535` | No | 8 |
| F-154 | Plan | Grocery check-off, persisted, rolls back and reloads on failure | tick | `PlanTab.jsx:1170-1184,1516-1517` | Yes | 8 |
| F-155 | Plan | Weekly total deliberately withheld, with the reason stated | render | `PlanTab.jsx:1546-1551` | No | 8 |
| F-156 | Plan | Whole-tab premium gate with the pricing overlay | free tier | `App.jsx:421-425`, `ui/PremiumGate.jsx:56-64` | No | 9 |
| F-157 | Plan | Week-board and list loading skeletons | plan undefined | `PlanTab.jsx:1304-1310` | No | 8 |
| F-158 | Plan | "No plan yet" empty state naming the exact next action | plan null | `PlanTab.jsx:1434-1442` | No | 8 |
| F-159 | Recipes | Import from a recipe URL (schema.org markup), Enter submits | typing / click | `RecipesTab.jsx:675-689,822-847` | Yes | 8 |
| F-160 | Recipes | AI generation form — slot, protein, cuisine, max prep, free text | select / typing | `RecipesTab.jsx:864-882` | No | 8 |
| F-161 | Recipes | Single-serving vs batch-cook radio | click | `RecipesTab.jsx:883-894` | No | 8 |
| F-162 | Recipes | Per-generation allergen override — loud, and re-arms automatically | tick | `RecipesTab.jsx:896-907,665-666` | No | 8 |
| F-163 | Recipes | Generate three drafts | click | `RecipesTab.jsx:646-673,908-910` | No | 8 |
| F-164 | Recipes | AI-off build message naming what still works | brain disabled | `RecipesTab.jsx:850-861` | No | 8 |
| F-165 | Recipes | Allergen-override banner listing the violating drafts | override active | `RecipesTab.jsx:919-948` | No | 8 |
| F-166 | Recipes | Dropped-for-allergies / dropped-for-shape notes | after generate | `RecipesTab.jsx:950-960` | No | 8 |
| F-167 | Recipes | Draft card — edit each ingredient's grams before saving | typing | `RecipesTab.jsx:449-459,691-693` | No | 8 |
| F-168 | Recipes | Draft allergen-violation banner + ALLERGEN chip (the one sanctioned red) | violation | `RecipesTab.jsx:414-437` | No | 8 |
| F-169 | Recipes | Import notes and placeholder-macro warnings on a draft | render | `RecipesTab.jsx:444-448,452-455` | No | 8 |
| F-170 | Recipes | Save a draft into the library | click | `RecipesTab.jsx:695-718,464-466` | Yes | 8 |
| F-171 | Recipes | Cart — macro totals, per-item remove | render / click | `RecipesTab.jsx:974-999,604-607` | Yes | 8 |
| F-172 | Recipes | "Fill today's plan" from the cart | click | `RecipesTab.jsx:609-622,1001-1003` | Yes | 8 |
| F-173 | Recipes | Cart grocery list + Copy / Text / Email | click | `RecipesTab.jsx:624-638,1004-1023` | No | 8 |
| F-174 | Recipes | An unreadable cart is not an empty cart | GET /cart fails | `RecipesTab.jsx:535-543,974-978` | No | 8 |
| F-175 | Recipes | Library search | typing | `RecipesTab.jsx:1053-1057` | No | 8 |
| F-176 | Recipes | Group by cuisine / meal type / main protein | select | `RecipesTab.jsx:1058-1063,743-760` | No | 8 |
| F-177 | Recipes | Sort A–Z / fewest calories / most protein per calorie | select | `RecipesTab.jsx:1066-1071` | No | 8 |
| F-178 | Recipes | Collapsible groups with counts | click | `RecipesTab.jsx:1115-1122` | No | 8 |
| F-179 | Recipes | Progressive reveal — "Show 60 more" / "Show all N" / "Showing X of N" | click | `RecipesTab.jsx:796-802,1183-1200` | No | 8 |
| F-180 | Recipes | "N recipes hidden by your diet & allergy rules" | hiddenCount > 0 | `RecipesTab.jsx:1073-1077` | No | 8 |
| F-181 | Recipes | Library-wide untrusted-ingredient summary, stated once with real numbers | render | `RecipesTab.jsx:768-778,1079-1089` | No | 8 |
| F-182 | Recipes | Per-row amber marker when ≥ 60 % of the calories are untrusted | render | `RecipesTab.jsx:112-136,1166-1169` | No | 8 |
| F-183 | Recipes | Expand a recipe row | click | `RecipesTab.jsx:1148-1173` | No | 8 |
| F-184 | Recipes | Serving scale ×0.5–×2 with live macros and per-ingredient grams | click | `RecipesTab.jsx:314-326,194-197,345` | No | 8 |
| F-185 | Recipes | "Incomplete data" panel naming every flagged ingredient and the share | trust report | `RecipesTab.jsx:327-343` | No | 8 |
| F-186 | Recipes | Add to a plan slot — day + meal/snack index, at the current scale | click / select | `RecipesTab.jsx:235-250,352-372` | Yes | 8 |
| F-187 | Recipes | Add / remove from cart in the detail view | click | `RecipesTab.jsx:373-376,578-602` | Yes | 8 |
| F-188 | Recipes | Taste rating thumbs; clicking the active thumb clears it | click | `RecipesTab.jsx:377-388,561-574` | Yes | 8 |
| F-189 | Recipes | Inline edit — name, description, cuisine, slot, prep, ingredients, steps | typing | `RecipesTab.jsx:262-309,203-233` | Yes | 8 |
| F-190 | Recipes | Remove an ingredient in the editor | click | `RecipesTab.jsx:233,298` | Yes | 8 |
| F-191 | Recipes | Delete a recipe — confirm step, row removed only once the server confirms | click ×2 | `RecipesTab.jsx:390-394,730-740` | Yes | 8 |
| F-192 | Recipes | Library-load failure is never drawn as "no recipes yet" | GET fails | `RecipesTab.jsx:1093-1102` | No | 8 |
| F-193 | Recipes | Empty states — no recipes yet / no search match | render | `RecipesTab.jsx:1103-1108` | No | 8 |
| F-194 | Recipes | "Food database" shortcut | click | `RecipesTab.jsx:807-809` | No | 8 |
| F-195 | Foods | Cached 14k-row library store with TTL + field projection | mount | `FoodsTab.jsx:29-85` | No | 8 |
| F-196 | Foods | Search all foods, debounced, results never blank mid-word | typing | `FoodsTab.jsx:440-449,518-523,579-586` | No | 8 |
| F-197 | Foods | Collapsible category groups with counts | click | `FoodsTab.jsx:641-674` | No | 8 |
| F-198 | Foods | Windowed row list, keyboard-scrollable | scroll / arrows | `FoodsTab.jsx:148-202` | No | 8 |
| F-199 | Foods | Row provenance glyph (community) + amber caution triangle | render | `FoodsTab.jsx:101-127` | No | 8 |
| F-200 | Foods | Select a food → detail panel | click | `FoodsTab.jsx:678-694` | No | 8 |
| F-201 | Foods | Detail — category chip, source / FDC id / brand / UPC, warning chip | render | `FoodsTab.jsx:300-320` | No | 8 |
| F-202 | Foods | Zero-macro placeholder warning | placeholder source | `FoodsTab.jsx:322-326` | No | 8 |
| F-203 | Foods | Open Food Facts crowd-sourced caveat | community source | `FoodsTab.jsx:328-334` | No | 8 |
| F-204 | Foods | Macro stats per 100 g | render | `FoodsTab.jsx:338-344` | No | 8 |
| F-205 | Foods | Admin edit of macros + category, Atwater-validated on save | click / typing | `FoodsTab.jsx:230-255,364-396` | Yes | 8 |
| F-206 | Foods | "Editing is admin-only" for everyone else | non-admin | `FoodsTab.jsx:346-350` | No | 8 |
| F-207 | Foods | Add 100 g of this food to a recipe, via a searchable picker | click | `FoodsTab.jsx:260-291,398-423` | Yes | 8 |
| F-208 | Foods | "Log today" disabled, with the honest reason | render | `FoodsTab.jsx:354-362` | No | 8 |
| F-209 | Foods | Count of rows known to carry another food's numbers | render | `FoodsTab.jsx:528,588-592` | No | 8 |
| F-210 | Foods | Partial-payload warning — "server sent N of M" | paged response | `FoodsTab.jsx:532,594-598` | No | 8 |
| F-211 | Foods | Load-failure state + Retry, never drawn as an empty database | GET fails | `FoodsTab.jsx:602-612` | No | 8 |
| F-212 | Foods | Genuinely-empty-database state | 0 foods | `FoodsTab.jsx:613-620` | No | 8 |
| F-213 | Foods | Return control that names its destination rather than saying "Back" | click | `FoodsTab.jsx:558-560` | No | 8 |
| F-214 | Foods | Barcode lookup panel toggle | click | `FoodsTab.jsx:550-552,563-575` | No | 8 |
| F-215 | Barcode | Manual UPC entry + look up (preview only, nothing saved) | typing / Enter / click | `BarcodeLookup.jsx:193-213,253-265` | No | 8 |
| F-216 | Barcode | Webcam scan, feature-detected, absent when unsupported | click | `BarcodeLookup.jsx:92-172,266-271` | No | 8 |
| F-217 | Barcode | Camera failure paths — permission denied, playback blocked | camera fails | `BarcodeLookup.jsx:120-124,138,150-153` | No | 8 |
| F-218 | Barcode | Verdict banner pass / warn / reject with plain-English issue names | lookup result | `BarcodeLookup.jsx:24-84` | No | 8 |
| F-219 | Barcode | Add to library — re-validated server-side, tagged COMMUNITY | click | `BarcodeLookup.jsx:221-243,322-331` | Yes | 8 |
| F-220 | Barcode | "Already in your library" state | duplicate UPC | `BarcodeLookup.jsx:285-291` | No | 8 |
| F-221 | Barcode | Not-found and timeout are different results, worded differently | 404 vs timeout | `BarcodeLookup.jsx:206-210,279-283` | No | 8 |
| F-222 | Barcode | Resting state explaining what a good input looks like | before first lookup | `BarcodeLookup.jsx:339-348` | No | 8 |
| F-223 | Trend | Weight chart — raw points, robust fit, ±1 SE band, goal line, lean mass | render | `TrendTab.jsx:455-463` | No | 8 |
| F-224 | Trend | Legend drawn as sample marks, not colours to match from memory | render | `TrendTab.jsx:107-128,417-424,465` | No | 8 |
| F-225 | Trend | Chart tooltip — an enhancement, never the only path to a value | hover | `TrendTab.jsx:136-157` | No | 8 |
| F-226 | Trend | "Show all N weigh-ins as a table" — the keyboard / AT path to every number | click | `TrendTab.jsx:523-560` | No | 8 |
| F-227 | Trend | Outlier disclosure — excluded from domain and average, never deleted | MAD test | `TrendTab.jsx:194-202,493-501` | No | 8 |
| F-228 | Trend | Goal-off-chart explanation instead of a silently clipped line | goal far away | `TrendTab.jsx:486-491` | No | 8 |
| F-229 | Trend | Fit-vs-average explainer naming the window and why it stops | render | `TrendTab.jsx:467-484` | No | 8 |
| F-230 | Trend | Lean-mass provenance, or the "add a body fat %" prompt | bf known / unknown | `TrendTab.jsx:503-516` | No | 8 |
| F-231 | Trend | Numbers card — 7-day average, lost from start, rate, lean mass | render | `TrendTab.jsx:566-609` | No | 8 |
| F-232 | Trend | Thin-window / skipped-outlier / stale-weigh-in notices | conditions | `TrendTab.jsx:587-604` | No | 8 |
| F-233 | Trend | Projection cone — most likely, fast edge, slow edge | fit exists | `TrendTab.jsx:628-650` | No | 8 |
| F-234 | Trend | Planned-pace projection fallback, labelled a plan not a measurement | no fit | `TrendTab.jsx:651-663` | No | 8 |
| F-235 | Trend | "The trend is moving away from your goal" state | trend inverted | `TrendTab.jsx:618-627` | No | 8 |
| F-236 | Trend | At-goal state | within 0.5 | `TrendTab.jsx:614-617` | No | 8 |
| F-237 | Trend | Empty / first-point chart states | < 2 weigh-ins | `TrendTab.jsx:442-447` | No | 8 |
| F-238 | Trend | Training nudge card; a load failure never reads as "no plan" | render | `TrendTab.jsx:47-99,667` | No | 8 |
| F-239 | Training | Inputs — days/week, session length, style, experience | select | `TrainingTab.jsx:86-115` | No | 8 |
| F-240 | Training | Equipment multi-select chips | click | `TrainingTab.jsx:39-40,116-128` | No | 8 |
| F-241 | Training | Generate / regenerate a plan (regenerate replaces the current one) | click | `TrainingTab.jsx:42-55,129-131` | Yes | 8 |
| F-242 | Training | Week chips 1–4 switch the displayed week | click | `TrainingTab.jsx:161-170` | No | 8 |
| F-243 | Training | Session tables — exercise, sets, reps, RPE, rest | render | `TrainingTab.jsx:177-212` | No | 8 |
| F-244 | Training | Plan notes carrying the generator's honest caveats | after generate | `TrainingTab.jsx:157-159` | No | 8 |
| F-245 | Training | Delete plan behind a confirm step | click ×2 | `TrainingTab.jsx:57-62,214-222` | Yes | 8 |
| F-246 | Training | V1 TEMPLATES badge + scaffold-honesty copy | render | `TrainingTab.jsx:68-70,132-134` | No | 8 |
| F-247 | Training | Empty and loading states | no plan | `TrainingTab.jsx:142-148` | No | 8 |
| F-248 | Wellbeing | Signals panel derived live from the user's own numbers, self-clearing | signals present | `WellbeingTab.jsx:46-83,190-217` | No | 8 |
| F-249 | Wellbeing | Self-check status card — never taken / flagged / nothing flagged | render | `WellbeingTab.jsx:88-111,142-177` | No | 8 |
| F-250 | Wellbeing | Open the self-check | click | `WellbeingTab.jsx:153-156` | No | 8 |
| F-251 | Wellbeing | "Delete my result" in one click, with focus handed on safely | click | `WellbeingTab.jsx:123-131,157-163` | Yes | 8 |
| F-252 | Wellbeing | Risk gate — a positive screen leads with support, not 47 numbers | screen positive | `WellbeingTab.jsx:118,222-237` | No | 8 |
| F-253 | Wellbeing | "Show the full breakdown anyway" escape hatch, always one click | click | `WellbeingTab.jsx:236`, `App.jsx:138` | Yes | 8 |
| F-254 | Wellbeing | Micronutrients card — grouped nutrients, collapse remembered | render / click | `MicronutrientsCard.jsx:37-44`, `lib/storage.js` | Yes | 8 |
| F-255 | Wellbeing | Target meter vs limit meter — different shapes, no colour grading | render | `MicronutrientsCard.jsx:92-120` | No | 8 |
| F-256 | Wellbeing | Support resources — phone, email, website, opened externally | click | `ui/ResourceList.jsx:11-44` | No | 8 |
| F-257 | Wellbeing | Standing "Not medical advice" card | render | `WellbeingTab.jsx:242-254` | No | 8 |
| F-258 | Check | Five SCOFF yes/no questions + answered count | click | `WellbeingCheck.jsx:89-127` | No | 8 |
| F-259 | Check | "See my result", enabled only when all five are answered | click | `WellbeingCheck.jsx:114-122` | Yes | 8 |
| F-260 | Check | Reset the answers | click | `WellbeingCheck.jsx:51,123-125` | No | 8 |
| F-261 | Check | Result panel — calm amber when positive, never red | submitted | `WellbeingCheck.jsx:135-165` | No | 8 |
| F-262 | Check | Collapsible full health / legal disclaimer | click | `WellbeingCheck.jsx:188-205` | No | 8 |
| F-263 | Check | Focus trap + Escape + close | keyboard | `WellbeingCheck.jsx:43,77-79` | No | 8 |
| F-264 | Compare | Twelve-row comparison table against five named apps | open | `CompareDialog.jsx:28-45,105-128` | No | 8 |
| F-265 | Compare | Mark legend (yes / partial / paid / none) + per-cell footnotes | render | `CompareDialog.jsx:66-79,129-134` | No | 8 |
| F-266 | Compare | "Wins" and "Where it's behind (honestly)" panels | render | `CompareDialog.jsx:136-152` | No | 8 |
| F-267 | Compare | Allergen caveat + comparison provenance and non-affiliation note | render | `CompareDialog.jsx:154-170` | No | 8 |
| F-268 | Bug | Optional "what were you doing" note | typing | `BugReportDialog.jsx:115-120` | No | 8 |
| F-269 | Bug | Exact-payload preview before anything is sent | render | `BugReportDialog.jsx:122-128` | No | 8 |
| F-270 | Bug | Send — opens a prefilled GitHub issue in the real browser | click | `BugReportDialog.jsx:53-70,132-134` | No | 8 |
| F-271 | Bug | Offline → save the report for later | click while offline | `BugReportDialog.jsx:54-58` | Yes | 8 |
| F-272 | Bug | Pending-reports banner + "Open them now" | pending > 0 | `BugReportDialog.jsx:74-81,106-113` | Yes | 8 |
| F-273 | Bug | Copy the report to the clipboard | click | `BugReportDialog.jsx:72,135-137` | No | 8 |
| F-274 | Bug | Online / offline detection drives the primary button | navigator events | `BugReportDialog.jsx:41-46,133` | No | 8 |
| F-275 | Coach | Launcher pill, rendered only when a relay is configured | click | `BrainChat.jsx:162-180` | No | 8 |
| F-276 | Coach | Chat panel with history-aware turns and a 500-char cap | typing / Enter | `BrainChat.jsx:120-160,249-270` | No | 8 |
| F-277 | Coach | Starter prompt chips | click | `BrainChat.jsx:9-14,205-211` | No | 8 |
| F-278 | Coach | Depth picker — Quick / Balanced / Thorough, each explained | click | `BrainChat.jsx:16-23,234-248` | No | 8 |
| F-279 | Coach | Deterministic plan card rendered from engine numbers only | reply carries a plan | `BrainChat.jsx:29-66,226` | No | 8 |
| F-280 | Coach | Escape closes and returns focus to the launcher | keyboard | `BrainChat.jsx:112-118,185` | No | 8 |
| F-281 | Coach | Failure message that protects the engine's authority | request fails | `BrainChat.jsx:141-156` | No | 8 |
| F-282 | Coach | Live status re-check when the settings card changes something | custom event | `BrainChat.jsx:92-101`, `CoachSettings.jsx:87,108` | No | 8 |
| F-283 | Pricing | Monthly / annual toggle | click | `pricing-section.jsx:58-63` | No | 9 |
| F-284 | Pricing | Price, savings badge, feature list | render | `pricing-section.jsx:66-81` | No | 9 |
| F-285 | Pricing | "Unlock with Premium" → checkout | click | `pricing-section.jsx:38-51,85-87` | No | 9 |
| F-286 | Pricing | Checkout-not-wired / checkout-failed note | onSelect absent or throws | `pricing-section.jsx:39-50,88` | No | 9 |
| F-287 | Premium | Blurred, inert preview of the real premium component behind the lock | free tier | `ui/PremiumGate.jsx:38-41` | No | 9 |

---

## Screen files read in full for this inventory

`App.jsx` · `main.jsx` · `components/Sidebar.jsx` · `components/LoginScreen.jsx` ·
`components/SetupWizard.jsx` · `components/TodayTab.jsx` · `components/ProfileTab.jsx` ·
`components/EngineTab.jsx` · `components/PlanTab.jsx` · `components/RecipesTab.jsx` ·
`components/FoodsTab.jsx` · `components/TrendTab.jsx` · `components/TrainingTab.jsx` ·
`components/WellbeingTab.jsx` · `components/WellbeingCheck.jsx` · `components/CompareDialog.jsx` ·
`components/BugReportDialog.jsx` · `components/BodyFatPicker.jsx` · `components/BarcodeLookup.jsx` ·
`components/BrainChat.jsx` · `components/CoachSettings.jsx` · `components/ErrorBoundary.jsx` ·
`components/pricing-section.jsx` · `components/mode-toggle.jsx` · `components/ui/HeaderBar.jsx` ·
`components/ui/PremiumGate.jsx` · `components/ui/AllergySearch.jsx` ·
`components/ui/GenerationProgress.jsx` · `components/ui/FilterControls.jsx` ·
`components/ui/ResourceList.jsx` · `lib/flags.js` · `lib/theme.js` · `index.css`

Partially read (opening sections, enough to cite the rows above):
`components/MicronutrientsCard.jsx` (1-120) · `components/AdaptiveTdeeCard.jsx` (1-100).
**Both must be read in full before their F-IDs (F-116, F-254, F-255) are worked in Phase 8.**

## Known gaps in this inventory

- The backend's own surfaces (Express routes, Prisma models) are **out of scope** —
  this is a UI inventory. They are frozen by constraints 2 and 3 regardless.
- `components/charts/*.jsx`, `components/ui/Parts.jsx`, `components/ui/Skeleton.jsx`,
  `components/ui/FoodTile.jsx` and the shadcn primitives under `components/ui/`
  are *rendering vocabulary*, not capabilities; they appear inside the rows above
  rather than as rows of their own.
- Two capabilities are gated off in this build and were inventoried from their
  flag sites, not from a running instance: Training (`lib/flags.js:8`) and
  Wellbeing (`lib/flags.js:19`). Both currently read `"on"`.
