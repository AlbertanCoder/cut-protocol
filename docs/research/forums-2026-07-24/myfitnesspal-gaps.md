# MyFitnessPal — What Users Hate & Where Cut Protocol Wins

Research date: 2026-07-24. Sources are real; where a claim rests on secondary reporting it is noted. No reviews were invented.

## 1. Top reasons people HATE / leave MFP (ranked)

1. **Paywalled barcode scanner** — the flashpoint. A free, decade-old feature was moved to Premium ($19.99/mo or $79.99/yr) effective Oct 1, 2022. Widely described as the moment goodwill broke. Users called it "a constant string of 'fuck you' to consumers."
   - https://www.pocket-lint.com/apps/news/162386-wow-myfitnesspal-put-its-popular-barcode-scanner-feature-behind-a-paywall/
   - https://news.slashdot.org/story/22/08/25/1955238/myfitnesspal-paywalls-barcode-scanner-that-made-counting-calories-easy
   - https://www.resetera.com/threads/popular-calorie-tracker-app-myfitnesspal-puts-barcode-scanner-functionality-behind-paywall.625390/
2. **Subscription creep / gutted free tier** — custom calorie goals, macro-by-meal, food timestamps, nutrient graphs, meal planning, net-carbs all progressively paywalled after the 2020 Francisco Partners acquisition. "A shell of its former self."
   - https://repreturn.com/myfitnesspal-review/
   - https://www.droid-life.com/2022/08/24/myfitnesspal-puts-barcode-scanner-behind-premium-paywall/
3. **Bad / crowd-sourced data** — ~14M+ user-submitted entries, many wrong; same food shows wildly different calories; restaurant entries off 20-40%. It's on the user to guess the right one.
   - https://community.myfitnesspal.com/en/discussion/10862172/there-is-so-much-items-in-the-database-with-incorrect-nutritional-values
   - https://community.myfitnesspal.com/en/discussion/10804613/why-are-mfp-food-entries-so-wildly-inaccurate
4. **Intrusive ads on free tier** — free experience "intentionally degraded"; ad-free requires Premium.
   - https://nutrola.app/en/blog/why-does-myfitnesspal-have-so-many-ads
   - https://support.myfitnesspal.com/hc/en-us/articles/360032273152-What-is-the-Ad-Free-feature-of-MyFitnessPal-Premium
5. **Privacy / breach history** — 2018 breach exposed ~150M accounts (data later sold on dark web); ongoing distrust of a cloud account model.
   - https://www.cnbc.com/2018/03/29/under-armour-stock-falls-after-company-admits-data-breach.html
   - https://www.huntress.com/threat-library/data-breach/under-armour-myfitness-pal-data-breach

## 2. What Cut Protocol AVOIDS by construction

- **Paywall/subscription creep (#1, #2):** one-time purchase, no tier that can be hollowed out. No feature can be yanked behind a recurring wall.
- **Bad data (#3):** curated 889-recipe library with **validated** macros + zero-tolerance allergy/diet filtering — no crowd-sourced guessing, no "which of 12 bananas."
- **Ads (#4):** offline, no ad SDK, nothing to monetize via attention.
- **Privacy/breach (#5):** data never leaves the machine — no cloud, no account, no server to breach or sell.

## 3. What people RELY ON that Cut Protocol LACKS (ranked)

1. **Barcode scanning** — fastest packaged-food logging; the #1 daily habit MFP still owns for the arbitrary grocery item.
2. **Huge/restaurant DB (~20M items)** — logging arbitrary brands & restaurant meals on the go (users log restaurant items "every 3.2 seconds").
3. **Mobile app** — log at the table/store, not at a desktop.
4. **Fast ad-hoc quick logging** — dump a food you ate without it being in a curated recipe set.

## 4. Privacy / no-cloud angle: real demand or niche?

**Real and growing, but still a minority signal.** An entire cohort of newer apps now markets exactly this: KiloTrack, Dietify, Eat Aware, ProTrack AI, Tracker2Go, and academic "Privacy Friendly Food Tracker" all lead with *no account / no cloud / data stays on device*. That's market validation that the angle sells — but it's a differentiator for a privacy-conscious segment, not yet a mass-market demand (MFP still holds 4.7 App Store / 4.4 Play despite the complaints). Position privacy as a **trust multiplier alongside** the deterministic solver, not as the sole hook.
- https://useprotrack.com/blog/best-offline-private-calorie-tracker-apps
- https://kilotrack.app/
- https://secuso.aifb.kit.edu/english/894.php

**Strategic read:** MFP's pain is *monetization of a tracker*. Cut Protocol's moat is being a *solver, not a tracker* — it plans meals to hit macros, which MFP has never done. Win by owning the "no subscription, no ads, private, tells you what to eat" lane; concede barcode/mobile ubiquity for now.
