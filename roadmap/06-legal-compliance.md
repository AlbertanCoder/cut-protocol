# Legal & Compliance Roadmap — Cut Protocol

**I am not a lawyer. Nothing in this document is legal advice.** This is
research and draft material intended to give a real lawyer a running start —
not a substitute for review by one licensed in Alberta (and, if EU/US users
end up in scope, wherever else applies). Every draft block below is marked
**DRAFT — REQUIRES LEGAL REVIEW** and should be treated as a first draft to
hand to counsel, not as language to ship as-is.

Context this doc assumes (see `AUDIT.md`, `PABLO_REVIEW.md`,
`roadmap/00-synthesis.md`): single-owner app, Edmonton, Alberta, currently
one seeded user, moving toward multi-user + Desktop/iOS/Android. Collects
email/password, body-composition data (weight, height, body fat %), dietary/
allergy exclusions, and sends profile data to Anthropic's Claude API for
AI-generated recipes. Prescribes specific calorie floors, macro ranges, and
rate-of-weight-loss coaching — not a passive food-logging app.

---

## 0. Top compliance risk, stated up front

**The single biggest risk isn't a missing clause — it's that no disclaimer
or ToS fixes an engineering defect that has already occurred in production.**
`PABLO_REVIEW.md` §2.5 documents the live account actually being served
shrimp and garlic-prawn dishes while its shellfish-allergy exclusion field
sat empty, and separately (§2.5, "Frozen Seafood mix") found that even with
the exclusion *set*, the category-keyword filter can be defeated by generic/
compound ingredient names that don't literally contain a trigger word.
`roadmap/00-synthesis.md` #1 says the empty-exclusion instance is fixed for
the one real account; #6 (the compound-ingredient structural gap) is still
**OPEN**.

A liability disclaimer ("consult a doctor," "we don't guarantee allergen
accuracy") reduces exposure for *informational* claims — it does not
immunize a product that has a known, reproducible, currently-open defect
capable of serving a declared allergen to a user who told the app not to.
That is closer to a negligence/products-liability fact pattern than a
"failure to warn" one, and disclaimer language is the wrong tool for it.
**Before any real second user is onboarded with an allergy exclusion set,
#6 from the synthesis doc needs an engineering fix and a verification pass
(re-run the exclusion against the full recipe pool, confirm generic/compound
ingredient names are either caught or the recipe is flagged "unverified —
check manually"), not just a stronger disclaimer.** The disclaimer in §7
below is still necessary — but treat it as a second layer, not the fix.

The prescriptive calorie/macro side has the same shape of risk one level
down: `AUDIT.md` §3 documents the solver shipping 150–234% of daily kcal
target on live plans. That's a product-trust and possibly consumer-protection
problem (see §2 Alberta Consumer Protection note) more than a bodily-harm one
by itself, but it compounds the allergy risk — a user relying on an app that
already mis-delivers calories has correspondingly less reason to trust its
allergen filtering either.

---

## 1. Privacy Policy — what this category of app must disclose

### 1.1 Research summary

For an app collecting account credentials + health/body data + dietary
data, and sending user data to a third-party AI processor, a privacy policy
in this category typically needs to cover, at minimum:

1. **Identity of the data controller/business** — legal name, business form,
   contact address, contact email for privacy inquiries. (Cut Protocol
   currently has no registered legal entity — see checklist §9. Apple/Google
   both increasingly expect a named accountable entity, not just an
   individual developer handle; Google's 2026 Play health-app update
   specifically requires a verified Organization Account for health apps so
   a legal entity, not just an individual, is on the hook.)
2. **What data is collected**, in plain categories:
   - Account: email, hashed password, session/JWT cookie
   - Body-composition/profile: sex, date of birth, height, weight history
     (weigh-ins), body fat %, job/activity class, training frequency
   - Dietary/allergy: excluded foods list, diet style, cuisine preferences,
     free-text notes
   - Derived/prescriptive: computed BMR/TDEE/calorie target/macro ranges,
     verdicts, adjustment history
   - Usage/technical: IP address, device/browser info, request logs
   - (Future) payment/subscription data if billing is added
3. **How it's collected** — directly from the user via forms; no data
   compiled from third-party/public sources about the user (this matters
   specifically for Apple 5.1.1(viii), which bans exactly that pattern).
4. **Why it's collected / purpose** — to compute and personalize
   calorie/macro prescriptions, generate meal plans and AI recipes, track
   progress, and enforce dietary exclusions.
5. **Third parties the data is shared with, and why** — this is the section
   that needs the most specific, honest detail for this app:
   - **Anthropic (Claude API)** — profile/target/exclusion data is sent in
     prompts to generate AI recipes (`aiRecipeClient.js`). Anthropic's
     commercial API terms include a Data Processing Addendum (DPA) with
     Standard Contractual Clauses once you accept Anthropic's Commercial
     Terms of Service — confirm this repo's Anthropic account is on
     commercial terms (API), not a consumer plan, since the DPA does not
     apply to Claude Free/Pro consumer products. Disclose: what's sent
     (macro targets, exclusions, diet style — not raw email/password),
     that Anthropic acts as a processor, and a link to Anthropic's own
     privacy policy.
   - **USDA FoodData Central** — used as a food/nutrient data *source*, not
     a processor of user data (the app queries food names/nutrient data, it
     doesn't send personal data to USDA). FDC data itself is CC0/public
     domain, so no user-facing disclosure obligation there beyond a source
     attribution ("Nutrition data source: USDA FoodData Central,
     fdc.nal.usda.gov") — this is a courtesy citation the USDA requests but
     not a data-sharing disclosure. Confirm whether any user-identifying
     info ever transits the USDA API call (it shouldn't, but verify the
     actual `ingredientResolver.js` request payload).
   - **Hosting/infrastructure (Railway, per `DEPLOY.md`)** — a data
     processor by virtue of hosting the Postgres DB and app; check Railway's
     own DPA/subprocessor list and data-residency options before public
     launch.
   - Any future analytics/crash-reporting/email-delivery vendor.
6. **Data retention** — how long account/weigh-in/plan data is kept after
   account deletion or inactivity; currently undefined in the app (no
   retention policy exists yet — this is a policy the owner needs to decide,
   not just document).
7. **User rights** — access, correction, deletion, and export. `CLAUDE.md`
   §2 C5 already commits to "one-tap JSON+CSV export... in every phase
   forever" as a product principle — good, because PIPEDA and any
   GDPR-in-scope users will require an access/export/deletion mechanism as a
   legal matter, not just a nice-to-have. **Gap: per the audits, no
   self-serve account deletion or data export currently exists in the
   shipped app** — the privacy policy cannot promise a right the product
   doesn't yet let a user exercise without emailing the owner manually.
   Either build the self-serve mechanism before claims of "delete/export
   anytime" go in the policy, or scope the policy honestly to "email us and
   we'll process it within N days" until it's built.
8. **Security measures** — TLS in transit, bcrypt password hashing (already
   in place per `backend/package.json`), and whatever access controls exist
   on the production DB.
9. **Cross-border data transfer disclosure** — Anthropic and Railway likely
   process data on US servers. PIPEDA doesn't prohibit this but does require
   disclosing it (see §2).
10. **Children's privacy** — a statement the service isn't directed at or
    knowingly collecting data from children (age threshold — recommend 18+
    given this app prescribes calorie floors, not just logs food; see §7).
11. **Changes to the policy** — how/when users are notified of material
    changes.
12. **Contact information** for privacy questions/complaints, and (once
    PIPA/PIPEDA are in scope) the name of the accountable privacy
    officer/contact — for a solo operation this is just the owner, named.

### 1.2 DRAFT — Privacy Policy skeleton

**DRAFT — REQUIRES LEGAL REVIEW. Placeholders in `[BRACKETS]` need owner
input; this is a structural skeleton with representative language, not
finished copy.**

```
PRIVACY POLICY
Last updated: [DATE]

[BUSINESS/OWNER NAME] ("Cut Protocol," "we," "us") operates the Cut Protocol
application (the "Service"). This policy explains what personal information
we collect, why, who we share it with, and the choices you have.

1. INFORMATION WE COLLECT
  a. Account information: email address and password (stored as a salted
     hash, never in plain text).
  b. Profile and body-composition information: sex, date of birth, height,
     weight and weight-history entries you log, body fat percentage,
     activity/training information.
  c. Dietary and allergy information: foods and ingredients you tell us to
     exclude, dietary style, cuisine preferences, and any notes you provide.
  d. Usage information: the meal plans, recipes, and targets generated for
     you, and technical information such as IP address and device/browser
     type.

2. HOW WE USE YOUR INFORMATION
  We use this information to calculate your calorie and macronutrient
  targets, generate meal plans and AI-assisted recipes, apply your stated
  dietary exclusions, and track your progress over time.

3. HOW WE SHARE YOUR INFORMATION
  We do not sell your personal information. We share it only as follows:
  a. Anthropic, PBC ("Anthropic") — to generate AI-assisted recipes, we send
     Anthropic your calorie/macro targets, dietary style, and food
     exclusions (we do not send your email address or password). Anthropic
     processes this data under [Anthropic's Commercial Terms of Service /
     Data Processing Addendum — CONFIRM WHICH TERMS THIS ACCOUNT IS ON] and
     does not use it to train models without permission under those terms.
     See Anthropic's privacy policy at https://www.anthropic.com/legal/privacy.
  b. [HOSTING PROVIDER, e.g. Railway] — hosts our database and application
     infrastructure and processes data solely to provide that
     infrastructure.
  c. We may disclose information if required by law.
  We use nutrient data from the USDA FoodData Central database
  (fdc.nal.usda.gov), a public-domain source; querying this data does not
  involve sending your personal information to the USDA.

4. WHERE YOUR INFORMATION IS PROCESSED
  Our service providers, including Anthropic and our hosting provider, may
  process information on servers located in the United States. By using the
  Service, you understand your information may be transferred outside of
  Canada.

5. DATA RETENTION
  We retain your account and health information for as long as your account
  is active, and for [X days/months] after deletion, [unless a longer period
  is required by law]. [OWNER TO DECIDE X.]

6. YOUR RIGHTS
  You may request access to, correction of, export of, or deletion of your
  personal information by contacting [EMAIL]. [Note to owner: once
  self-serve export/delete ships in-app, update this section to describe
  the in-app mechanism instead of an email request.] We will respond within
  [30 days, per PIPEDA's reasonable-timeframe norm — CONFIRM WITH COUNSEL].

7. SECURITY
  We use industry-standard measures including encryption in transit (TLS)
  and salted password hashing. No method of transmission or storage is 100%
  secure, and we cannot guarantee absolute security.

8. CHILDREN'S PRIVACY
  The Service is intended for users [18] years of age and older. We do not
  knowingly collect information from anyone under [18].

9. CHANGES TO THIS POLICY
  We will notify you of material changes by [email / in-app notice] before
  they take effect.

10. CONTACT
  Questions or requests: [EMAIL]. Privacy contact/officer: [OWNER NAME].
```

---

## 2. PIPEDA and Alberta PIPA

**Which law actually applies, and why it matters for a small business here:**

- **Alberta PIPA (Personal Information Protection Act)** is Alberta's own
  private-sector privacy statute, enforced by the Office of the Information
  and Privacy Commissioner of Alberta. It applies to "provincially regulated
  organizations" — and for a business incorporated/operating wholly within
  Alberta (not a bank, airline, telecom, or other federally-regulated
  industry), **PIPA, not PIPEDA, is the primary statute that governs
  day-to-day handling of Albertans' personal information.**
- **PIPEDA (federal)** still applies on top of PIPA for: (a) any
  inter-provincial or international commercial transfer of personal
  information, and (b) if the business ever operates in a province that
  hasn't enacted its own "substantially similar" law (most haven't — only
  Alberta, BC, and Quebec have their own private-sector statutes; PIPEDA is
  the federal default everywhere else in Canada). **Practical read for this
  app:** since it's cloud-hosted (Railway, likely US-based infrastructure)
  and processes data through a US AI vendor (Anthropic), those are
  cross-border commercial transfers, which brings PIPEDA's cross-border
  disclosure obligations into play even for an Alberta-only business — this
  is exactly the transfer disclosure drafted in §1.2 item 4.
- **Practically for a solo/small operation, PIPA and PIPEDA overlap heavily**
  in their substantive requirements (10 fair-information principles derived
  from the same source: consent, limiting collection/use/disclosure,
  accuracy, safeguards, openness, individual access, and accountability
  including a named accountable person). Building to satisfy both — which
  the draft policy above does — is more practical for a small operation than
  trying to cleanly separate which statute governs which record.
- **No employee-count or revenue threshold exempts a business from either
  law.** There is no small-business carve-out; a one-person operation
  collecting health data is squarely in scope the moment it's collecting
  personal information "in the course of commercial activity."
- **Breach notification:** both regimes require notifying affected
  individuals (and, under PIPEDA, the Privacy Commissioner) of a breach that
  creates a "real risk of significant harm" — health/body-composition and
  allergy data would very plausibly qualify as sensitive enough to trigger
  this. There's currently no documented breach-response process for this
  app; that's a real pre-launch gap, not just paperwork (see checklist §9).
- **Accountable person:** name a specific privacy contact (even if it's just
  the owner) in the policy — both regimes expect this, and it's a common
  first thing regulators/complainants look for.

---

## 3. GDPR — a scoping question, not an assumption

GDPR does **not** automatically apply just because a Canadian app is
reachable from the EU. It applies when a business **offers goods/services to
people in the EU or monitors their behavior**, gauged by *intentional
targeting* — e.g., marketing in EU languages, pricing in EUR, naming EU
countries, EU-specific ad campaigns — not merely the technical possibility
that an EU resident could sign up.

**This is a decision for the owner, not something to assume either way:**
- If Cut Protocol stays a Canada/North America-marketed product with no EU
  marketing, currency, or language targeting, GDPR obligations are unlikely
  to attach even if a stray EU user signs up organically.
- If there's any future intent to market in the EU/UK, or the App
  Store/Play listing targets those storefronts deliberately, GDPR (and UK
  GDPR separately, post-Brexit) applies in full, and needs its own
  compliance pass (lawful basis documentation, EU representative if no EU
  establishment, DPIA for health-data processing, right to erasure/portability
  built to GDPR's stricter timelines, and confirming Anthropic's DPA + SCCs
  actually cover the EU-transfer mechanism — Anthropic's DPA does include EU
  SCCs and a UK IDTA per their commercial terms, which helps, but the
  business itself still needs its own GDPR-facing policy language).
- **Recommendation: explicitly decide and document the scoping decision**
  ("Cut Protocol does not target EU users; App Store/Play listings will be
  geo-restricted or GDPR-lite language will be added if that changes") so a
  lawyer reviewing this later has a clear starting assumption instead of
  having to infer it.

---

## 4. Apple App Store — health/nutrition-specific requirements

### 4.1 Guideline 5.1.1 — Data Collection and Storage (applies to every app)

Verified against Apple's current published guidelines:

- **5.1.1(i):** privacy policy link required in both App Store Connect
  metadata *and* inside the app itself, easily accessible. Must explicitly
  state what data is collected, how, all uses, that any third party (here:
  Anthropic) provides equal protection, and retention/deletion policy +
  how to revoke consent/request deletion.
- **5.1.1(ii):** must secure user consent for data collection (even data
  considered anonymous), provide an easy way to withdraw consent, and paid
  functionality must not be gated behind granting data access.
- **5.1.1(viii):** apps that compile personal information from any source
  *not directly from the user*, even public databases, are banned outright.
  Not a risk here — all of Cut Protocol's data model is user-entered or
  computed from user-entered data.

### 4.2 Guideline 1.4.1 — Medical Apps (the one to take seriously)

> "Medical apps that could provide inaccurate data or information, or that
> could be used for diagnosing or treating patients may be reviewed with
> greater scrutiny... Apps should remind users to check with a doctor in
> addition to using the app and before making medical decisions."

**Is there real risk this reads as "medical advice" requiring extra
disclaimer/review?** Yes, and it's worth taking seriously given this app's
actual functionality, more than a typical calorie-logging app would face:

- Cut Protocol doesn't just log what a user reports eating (MyFitnessPal/
  Cronometer's core model) — it **computes and prescribes** a specific
  calorie floor, macro ranges, and a rate-of-weight-loss coaching loop with
  automatic adjustments (`bmrEngine.js`, `verdict()` per `CLAUDE.md` §6
  V1-COACH). That's a meaningfully more prescriptive posture than passive
  logging.
- Apple's guideline language ("could be used for... treating patients")
  is aimed at clinical/diagnostic apps more than consumer fitness apps, and
  MyFitnessPal/Cronometer/MacroFactor all ship on the App Store today with
  similarly prescriptive macro-target and rate-of-loss-coaching features
  (MacroFactor's is architecturally very close to this app's design — daily
  target adjustment based on trend rate) without being classified as
  "medical apps" requiring regulatory clearance. **The operative pattern
  those apps use, and the one this app should follow, is: prominent
  in-app + ToS/disclaimer language reminding users to consult a healthcare
  professional, explicit contraindications (pregnancy, eating disorder
  history, diagnosed conditions, medication), and never claiming the app
  diagnoses/treats/cures anything** — not seeking regulatory clearance.
- **Real, app-specific risk to flag to the owner:** if App Review reads the
  "hard calorie floor" and "rate-of-loss verdict/adjustment" features and
  decides they read as individualized medical guidance, the fix is stronger
  in-app disclaimer surfacing (not just a buried ToS page) — e.g. a
  first-launch consent/disclaimer screen, consistent with what MacroFactor
  does with its "Health Disclaimer toggle" that users must actively accept.
  Build that screen before submission; it's cheap insurance against a
  review rejection or delay.
- If the app never touches HealthKit, Guideline 5.1.3 (Health and Health
  Research — governs use of HealthKit/Clinical Health Records/Motion &
  Fitness API data) doesn't currently apply. It **will** apply the moment
  any future Apple Health read/write integration is added (per `CLAUDE.md`
  v4-recovery phase) — flag that as a compliance step to revisit at that
  phase, not now.

### 4.3 App Store Privacy Nutrition Label

Required for every new app submission/update since Dec 2020. Based on this
app's actual data model, the categories that plausibly need declaring in
App Store Connect (final classification is Apple's own multi-choice form —
this is a preparatory best guess, not the form itself):

| Apple category | What in this app maps to it |
|---|---|
| **Health & Fitness** | weight, height, body fat %, activity/training level |
| **Contact Info** | email address |
| **Identifiers** | user ID / account ID |
| **User Content** | dietary exclusions, notes, saved recipes/plans |
| **Diagnostics** (if any crash/analytics tooling is added) | crash logs, performance data |
| **Other Data** (possible) | dietary/allergy exclusion list, if not folded into Health & Fitness |

Also required: declaring whether each data type is **linked to identity**
(yes, here — it's all tied to an authenticated account) and disclosing
**third-party partners** whose code/API receives it — Anthropic needs to be
named as a data recipient for whatever categories get sent in AI recipe
prompts (macro targets, exclusions, diet style).

---

## 5. Google Play — health content policy

Verified against Google's current Health Content and Services policy and
2026 update announcements:

- **Health apps declaration form** (Play Console) is required for any app
  Google's policy considers a "health app" — defined broadly as one that
  "offers health-related features or information as part of its
  functionality." Cut Protocol's calorie prescription, macro targets, and
  weight-tracking functionality puts it in scope.
- **Verified Organization Account requirement (Jan 2026 policy update):**
  existing health apps must be published under a verified organization
  account, not an individual developer account — specifically so a legal
  entity, not just a person, is accountable if sensitive data leaks. This is
  directly relevant: **register a business entity (or confirm an existing
  one) before Play Store submission**, not just for this requirement but
  because it's referenced independently in §9's checklist below.
- **Required disclaimer, verbatim pattern Google expects for non-clinically-
  cleared apps**, and Google states failure to include it in the first
  paragraph of the app description causes update rejections:
  > "This app is not a medical device and does not diagnose, treat, cure, or
  > prevent any medical condition."
  Combine with a reminder to consult a healthcare professional. Recommend
  putting a version of this in both the Play Store listing description and
  the in-app disclaimer (§7 below).
- **Privacy policy required**, publicly accessible, detailing handling of
  personal and sensitive data — same policy as §1 satisfies this if it
  covers the data categories above.
- **Sensitive-use restrictions (2026 clarification):** health data may not
  be used to determine employment/insurance eligibility or for unauthorized
  social sharing — not currently a risk for this app's feature set, but
  worth keeping in mind if any future "share your progress" social feature
  (`CLAUDE.md` v5-social phase) gets built.
- Play's policy doesn't call out diet/calorie apps as their own named
  category the way Apple's 1.4.1 does, but the general "no false or
  misleading health claims" prohibition applies squarely to any rate-of-
  loss or macro-target claims made in marketing copy — keep Play Store
  listing language descriptive ("calculates targets based on formulas you
  can inspect"), not results-promising ("lose X lb guaranteed").

---

## 6. Medical/Nutrition Disclaimer — DRAFT

### 6.1 What comparable shipped apps actually say (research findings)

- **MyFitnessPal:** "MyFitnessPal is not a medical professional or a
  medical organization and does not provide medical services or render
  medical advice... not intended for use in the diagnosis of diseases...
  seek the advice of a physician... before beginning any dietary programs,
  exercise regimen, or other fitness/wellness activities... if being
  treated for a health condition, taking prescription medication, or
  following a therapeutic diet, consult your physician before using the
  Services." Also disclaims responsibility for **food safety and
  allergens** specifically in its food-database disclaimer — directly
  relevant precedent for Cut Protocol's own allergen-filtering caveat.
- **Cronometer:** "The Content and Services... are for informational
  purposes only and do not constitute medical, healthcare or wellness
  advice or a substitute for consultation with a qualified medical
  practitioner or healthcare provider." Extends the same standard to
  professional ("Pro") accounts working with clients.
- **MacroFactor** (architecturally the closest comparable — also does
  automatic target-adjustment coaching): "designed for educational and
  general information purposes only... not a medical organization...
  cannot provide medical advice... consult with a qualified healthcare
  professional before making any health-related decisions" especially diet
  changes; explicit carve-outs for pregnancy/breastfeeding, medication,
  metabolism-related conditions; explicit **user eligibility bounds**
  (height/weight/BMI/age range, minors prohibited); explicit assumption-
  of-risk language for diet/exercise changes; and a **disclaimer the user
  must actively accept** ("Health Disclaimer toggle") before AI features are
  usable — the strongest-practice pattern of the three, worth mirroring
  given this app's own AI + prescriptive-target combination.

### 6.2 DRAFT — Cut Protocol Medical/Nutrition Disclaimer

**DRAFT — REQUIRES LEGAL REVIEW.** This draft is deliberately more explicit
than MyFitnessPal's on two points specific to this app's actual
functionality: (a) it prescribes specific numeric targets and automatic
adjustments rather than just logging, and (b) it uses AI-assisted allergen
filtering with a documented, structural gap around generic/compound
ingredient names — that gap needs to be disclosed, not just the general
allergy caveat every nutrition app carries.

```
MEDICAL AND NUTRITION DISCLAIMER

Cut Protocol is not a medical device, and [OWNER/BUSINESS NAME] is not a
medical provider, registered dietitian, or healthcare organization. Nothing
in the Service — including calorie targets, macronutrient ranges, rate-of-
weight-loss guidance, automatic target adjustments, or AI-generated recipes
and meal plans — constitutes medical advice, a medical device function, or
individualized dietetic counseling from a licensed professional. The
Service does not diagnose, treat, cure, or prevent any disease or medical
condition.

HOW TARGETS ARE GENERATED
Calorie and macronutrient targets are calculated using published,
formula-based estimation methods (e.g., Mifflin-St Jeor, Harris-Benedict)
applied to information you provide. These are population-level estimation
formulas, not an individualized medical assessment. A hard minimum calorie
floor is enforced as a general safety guardrail, but it is not a
substitute for evaluation by a physician or registered dietitian, and may
not be appropriate for your specific medical history.

CONSULT A HEALTHCARE PROFESSIONAL BEFORE USING THIS SERVICE IF YOU:
- are pregnant, breastfeeding, or trying to conceive;
- have or have had an eating disorder or disordered eating;
- have a diagnosed metabolic, endocrine, cardiac, renal, or hepatic
  condition;
- take medication that affects appetite, metabolism, or blood sugar;
- are under 18 years of age (this Service is intended for adults);
- have any other condition for which changes to caloric or macronutrient
  intake could be medically significant.
If you experience symptoms such as dizziness, fainting, irregular heartbeat,
hair loss, loss of menstrual cycle, or persistent fatigue, stop using the
Service's targets and consult a physician.

ALLERGY AND DIETARY EXCLUSION LIMITATIONS — READ CAREFULLY
You may enter foods or ingredients to exclude from meal plans and recipes,
including allergens. The Service applies this exclusion by matching
ingredient names and known category terms (for example, matching "shrimp"
or "crab" against a "shellfish" exclusion). This matching is
best-effort and is NOT guaranteed to be complete or accurate. In
particular, generic or compound ingredient names (for example, a "seafood
mix" or "mixed nuts" product that does not name its individual components)
may not be recognized as containing an excluded allergen, and AI-generated
recipes are checked against a fixed list of common allergens that may not
match every ingredient you personally need to avoid.

IF YOU HAVE A SEVERE, LIFE-THREATENING, OR ANAPHYLACTIC ALLERGY, DO NOT
RELY ON THE SERVICE'S EXCLUSION FILTERING AS YOUR SOLE SAFEGUARD. You are
responsible for independently reading every ingredient in any recipe or
meal plan before preparing or eating it, and for verifying with the source
of any packaged or compound ingredient what it actually contains.

NUTRITIONAL DATA ACCURACY
Nutrient values are drawn from the USDA FoodData Central database and other
sources, and AI-generated content (recipes, ingredient substitutions) may
contain errors or estimates. We make reasonable efforts to keep this data
accurate but do not guarantee its completeness or precision, and it should
not be relied on for managing a diagnosed medical condition (e.g., precise
carbohydrate counting for insulin dosing) without independent verification.

NO GUARANTEE OF RESULTS
Individual results vary. The Service does not guarantee any specific rate
of weight loss, body composition change, or health outcome.

By using the Service, you acknowledge you have read and understood this
disclaimer and agree to the assumption of risk and limitation of liability
described in our Terms of Service.
```

---

## 7. Terms of Service — essentials for a subscription/account product

Even with billing not yet built, a ToS should exist before public signup —
it's the contract that makes the disclaimer, liability limits, and account
rules enforceable, and both app stores expect a EULA/ToS link regardless of
whether payment is live yet.

### 7.1 Checklist of essential sections

1. **Acceptance of terms** — using the Service = agreeing to these terms.
2. **Eligibility** — minimum age (recommend 18+, tied to the disclaimer's
   contraindication list, not just a generic 13+ COPPA floor — a
   calorie-prescribing app for minors raises its own set of concerns beyond
   this doc's scope).
3. **Description of the Service** — what it does and does not do (ties into
   §6's disclaimer — cross-reference, don't duplicate).
4. **Accounts** — user responsible for credential security, must provide
   accurate information, one account per person, right to suspend/terminate
   for violation.
5. **Health/medical disclaimer** — incorporate §6 by reference, require
   affirmative acknowledgment at signup (checkbox or "I understand" screen —
   MacroFactor's pattern, worth copying).
6. **AI-generated content** — recipes/meal plans are AI-assisted and may
   contain inaccuracies; user must verify ingredients/instructions before
   relying on them, especially for allergies (cross-reference §6).
7. **Subscription/billing terms** (placeholder now, required once billing
   ships) — price, billing cycle, auto-renewal, cancellation method, refund
   policy. **Alberta-specific note:** Alberta's Consumer Protection Act has
   its own rules for internet/consumer agreements (vendor identity
   disclosure, cancellation rights, specific disclosure timing) that a
   generic US-style SaaS ToS template will not automatically satisfy —
   flag explicitly for lawyer review once billing is real, don't assume a
   template covers it.
8. **User content and data ownership** — user retains ownership of the data
   they enter; grants the Service a license to process it to provide the
   Service (needed to legally send data to Anthropic, etc.).
9. **Acceptable use** — no misuse of the Service, no attempting to extract/
   scrape the recipe database, no impersonation, etc.
10. **Intellectual property** — the Service's software, curated recipe
    content, and branding belong to the owner; user-submitted content
    (custom recipes, notes) stays theirs subject to the license in #8.
11. **Disclaimer of warranties** — Service provided "AS IS" and "AS
    AVAILABLE," no warranty of accuracy, availability, or fitness for a
    particular purpose (standard SaaS boilerplate, but must not contradict
    or weaken §6's health disclaimer — keep them consistent).
12. **Limitation of liability** — cap liability (commonly fees paid in the
    prior 3–12 months, or a nominal amount pre-revenue), exclude indirect/
    consequential/punitive damages, **carve out explicit language that this
    limitation does not apply to death, personal injury, or fraud where
    applicable law prohibits limiting such liability** — this carve-out
    matters specifically for a health/allergy-adjacent app; a lawyer needs
    to confirm Alberta law's treatment of liability waivers for personal
    injury before this is finalized.
13. **Indemnification** — user indemnifies the business for their misuse of
    the Service (standard, lower priority for a consumer app pre-scale).
14. **Termination** — either party can terminate; effect on data (ties to
    §1's retention/deletion policy).
15. **Dispute resolution / governing law** — governing law = Province of
    Alberta, Canada. **Flag for counsel:** whether a mandatory arbitration
    clause is advisable/enforceable for a consumer contract under Alberta's
    Consumer Protection Act and Arbitration Act — this varies by contract
    type and Alberta has specific consumer-arbitration restrictions in some
    contexts; don't default to a generic US arbitration clause template
    without confirming it holds up under Alberta consumer law.
16. **Changes to terms** — notice mechanism, effective date.
17. **Severability, entire agreement, contact info** — standard boilerplate.

### 7.2 Draft posture

Given the length and Alberta-consumer-law-specific questions in #7, #12, and
#15, a full verbatim ToS draft is lower-value here than getting the
structural checklist and disclaimer/privacy-policy drafts right first — a
lawyer will likely start from their own template for the boilerplate
sections (#8–#11, #13, #16–#17) and needs your specific input mainly on #3,
#5, #6, and the Alberta-specific questions flagged in #7/#12/#15. Bring this
checklist and the §6/§1 drafts to that conversation rather than a full ToS
draft, so the billable time goes to the Alberta-specific questions this
research can't resolve.

---

## 8. Prioritized checklist

### 8.1 Before public signup opens (multi-user, no app store yet)

| # | Item | Why it can't wait |
|---|---|---|
| 1 | **Fix the allergen-filtering structural gap** (`roadmap/00-synthesis.md` #6 — compound/generic ingredient names defeating category matching) or ship an explicit "unverified ingredient — check manually" flag for recipes the filter can't confidently clear | No disclaimer substitutes for this; see §0 |
| 2 | Publish Privacy Policy (§1.2 draft, lawyer-reviewed) | Required by PIPA/PIPEDA before collecting a second real user's data; also a prerequisite for app store submission later |
| 3 | Publish Terms of Service incl. Medical/Nutrition Disclaimer (§6.2, §7), with affirmative acceptance at signup | Contract enforceability + liability protection has to exist before strangers use the product |
| 4 | Name an accountable privacy contact/officer (can be the owner) | Both PIPA and PIPEDA expect this to be named, not implied |
| 5 | Decide and document the data retention period | Currently undefined; policy in §1.2 has a placeholder that needs a real answer |
| 6 | Decide and document the GDPR scoping position (§3) | Cheap to decide now, expensive to discover mid-dispute that it was never decided |
| 7 | Confirm Anthropic account is on Commercial Terms (API) with the DPA active, not a consumer plan | The privacy policy's third-party disclosure (§1.2 item 3a) depends on this being true |
| 8 | Build a self-serve account-deletion path (even a basic "delete my account" button/endpoint) | Privacy policy can't honestly promise deletion rights without a way to exercise them beyond emailing the owner |
| 9 | Basic breach-response plan (who gets notified, how, within what window) | Required in substance by both PIPA/PIPEDA if a breach ever happens; costs little to write down now |
| 10 | Register a business entity (sole proprietorship registration at minimum, or incorporate) | Referenced by Google's 2026 health-app organization-account requirement (§5) and generally cleaner for the ToS/privacy policy to name a real legal entity instead of an individual |
| 11 | Add login rate-limiting / lockout and a CSRF token (`PABLO_REVIEW.md` §3.4) | Not itself a "legal" item, but a live security gap on an app about to hold real health data for real strangers — the kind of thing a breach-notification obligation gets triggered by |

### 8.2 Before app store submission specifically (in addition to §8.1)

| # | Item | Apple / Google |
|---|---|---|
| 12 | Privacy policy linked in both store metadata *and* inside the app | Both |
| 13 | First-launch disclaimer/consent screen requiring affirmative acknowledgment (not just a buried ToS link) | Apple 1.4.1 risk mitigation; mirrors MacroFactor's pattern |
| 14 | App Store Privacy Nutrition Label completed, incl. Anthropic named as a third-party data recipient (§4.3) | Apple |
| 15 | Google Play Data Safety form + Health apps declaration form completed | Google |
| 16 | Verified Organization Account set up in Play Console (depends on #10 above) | Google, required as of Jan 2026 for health apps |
| 17 | "Not a medical device..." disclaimer sentence placed in the first paragraph of the Play Store app description | Google — explicitly causes update rejection if missing |
| 18 | Consent/permission flow reviewed against Apple 5.1.1(ii) — no paid feature gated behind granting data access | Apple |
| 19 | If any future HealthKit/Health Connect integration ships, revisit Apple 5.1.3 and Google's Health Connect permission-justification rules separately — not needed for the current data model | Both, deferred |

---

## 9. Sources consulted

- [App Review Guidelines - Apple Developer](https://developer.apple.com/app-store/review/guidelines/) (5.1.1, 1.4.1, 5.1.3 text)
- [App Privacy Details - App Store - Apple Developer](https://developer.apple.com/app-store/app-privacy-details/)
- [Health Content and Services - Play Console Help](https://support.google.com/googleplay/android-developer/answer/16679511?hl=en)
- [Google Play Health Apps Update: New January 2026 Requirements](https://myappmonitor.com/blog/google-play-health-apps-update-2026-requirements)
- [MyFitnessPal Terms of Service](https://www.myfitnesspal.com/terms-of-service)
- [Cronometer Terms of Service](https://cronometer.com/terms/)
- [MacroFactor Health Disclaimer](https://macrofactor.com/health-disclaimer/)
- [MacroFactor Terms of Service](https://macrofactor.com/terms/)
- [Office of the Privacy Commissioner of Canada — PIPEDA requirements in brief](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/)
- [OPC — Provincial laws that may apply instead of PIPEDA](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/prov-pipeda/)
- [Personal Information Protection Act | Alberta.ca](https://www.alberta.ca/personal-information-protection-act)
- [Anthropic Privacy Center — DPA](https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa)
- [Anthropic Privacy Center — Commercial Customers](https://privacy.claude.com/en/collections/10663361-commercial-customers)
- [USDA FoodData Central API Guide](https://fdc.nal.usda.gov/api-guide/)
- [GDPR.eu — Does the GDPR apply to companies outside of Europe?](https://gdpr.eu/companies-outside-of-europe/)
- [activeMind.legal — When does the GDPR apply to non-EU businesses?](https://www.activemind.legal/guides/gdpr-non-eu-businesses/)
- [TermsFeed — SaaS Limitation of Liability](https://www.termsfeed.com/blog/saas-limitation-liability/)
- Internal: `AUDIT.md`, `PABLO_REVIEW.md`, `roadmap/00-synthesis.md`, `CLAUDE.md`, `DEPLOY.md`, `backend/package.json` (all read directly from this repo)
