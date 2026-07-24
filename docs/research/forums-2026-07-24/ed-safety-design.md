# Eating-Disorder Safety & Design Research

_Cut Protocol — informing the in-app ED self-screen + medical disclaimer. Compiled 2026-07-24. Read-only research; forum content summarized as themes only, no personal data._

## 1. How calorie apps HARM (feature specifics)

Peer-reviewed and qualitative work converges on concrete, design-level harms:

- **Red / shame framing.** Turning a number red when users exceed a goal triggers "guilt, embarrassment and shame," and the color ignores context (over by 1 cal reads the same as 1000). Green "remaining calories" acts as a reward signal reinforcing restriction. (BJPsych Open qualitative study.)
- **Number fixation / obsessive logging.** Calorie counting and barcode scanning drive rumination and rigid all-or-none thinking. In a University of Louisville survey, ~73–75% of diagnosed-ED users of MyFitnessPal felt the app *contributed* to their disorder; recovering users reported app "addiction."
- **Low goal defaults.** Apps hand out pre-calculated targets (often ~1200) with no mental-health screening; MyFitnessPal is widely criticized for low ranges. Below ~1000 cal, different "approval" messaging is misread as endorsement.
- **Streaks / gamification / notifications.** Streaks, "Complete Diary" weight projections, and reminders create dependency and self-competition to "eat less and less." (Princeton "Too Good to Be True"; McCaig 2020 forum thematic analysis.)
- **Motive matters.** Weight/shape-motivated tracking correlates with food preoccupation, all-or-none thinking, purging; health-motivated use less so.

## 2. Safety features users / clinicians WANT

From a JMIR therapist-interview study, a BJPsych qualitative study, and patient-preference work:

- **Hard calorie floors** and reduced logging frequency; normalize taking breaks.
- **Non-judgmental, stigma-free language;** no shame framing on over-target.
- **Ability to hide numbers** / shift focus to nutrient density, variety, mood/sleep/stress.
- **In-app ED screening + crisis resources** (some ask for a "panic button" to coping skills/helpline).
- **Trigger management** (warnings, skip option) and **lived-experience + clinical involvement** in design.

## 3. Cut Protocol mapping (honest)

| Feature wanted | Cut Protocol status |
|---|---|
| No red / calm framing | **COVERED** — no red on food/body; over-target = calm amber + supportive re-plan |
| Hard calorie floor | **COVERED** — max(RMR*0.95, 1500 M / 1200 F) |
| No streak-shame / no notification spam | **COVERED** — "instrument not slot machine" |
| Non-judgmental tone | **COVERED** |
| ED screen + resources | **BEING ADDED** (this work) |
| Not-medical-advice disclaimer | **BEING ADDED** |
| Hide numbers option | **MISSING** — consider a numbers-off/qualitative mode |
| Mood/sleep/stress alongside weight | **MISSING** — optional wellbeing check-in |
| Motive-awareness prompt | **MISSING** — a "why are you cutting?" framing could route weight/shape-driven users to support |

## 4. Best-practice for the in-app ED SCREEN

**Is SCOFF appropriate?** Yes — it is the standard brief self-screen (5 yes/no items), free, validated. Meta-analysis pooled **sensitivity ~0.86, specificity ~0.83**; note **lower sensitivity in general/community samples** (some studies ~0.54), so frame it as *"a reason to check in, not a diagnosis."*

**The five SCOFF items** (score 1 per "yes"; **≥2 = screen positive**):
1. Do you ever make yourself **S**ick because you feel uncomfortably full?
2. Do you worry you have lost **C**ontrol over how much you eat?
3. Have you recently lost more than **O**ne stone (~6.3 kg / 14 lb) in 3 months?
4. Do you believe yourself to be **F**at when others say you are too thin?
5. Would you say that **F**ood dominates your life?

**Implementation guidance**
- Present gently, opt-in, no red/scary styling; result copy is supportive and non-diagnostic.
- On **≥2**, surface resources + a soft suggestion to talk to a professional; consider recommending pausing aggressive deficit.
- Pair with a clear **not-medical-advice disclaimer** (screen is educational, not a diagnosis).

**Canada / Alberta resources to link**
- **NEDIC** (National Eating Disorder Information Centre) — helpline **1-866-633-4220** (1-866-NEDIC-20), Mon–Fri 9a–9p / Sat–Sun 1p–7p ET; live chat + email nedic@uhn.ca — https://nedic.ca
- **Eating Disorder Support Network of Alberta (EDSNA)** — https://edsna.ca
- **Silver Linings Foundation** (Alberta peer/group support).
- **Alberta Health Link 811** → Addiction & Mental Health team (referrals). Calgary: **Access Mental Health 403-943-2500**. AHS Eating Disorder Programs (Calgary/Edmonton) are physician-referral.
- Crisis: **988** (Canada suicide crisis line).

## Sources

- BJPsych Open — Effects of diet and fitness apps on ED behaviours (qualitative): https://www.cambridge.org/core/journals/bjpsych-open/article/effects-of-diet-and-fitness-apps-on-eating-disorder-behaviours-qualitative-study/2D1EE739D97AB3EFC6573835E4C527BD
- McCaig et al. 2020, Int J Eating Disorders — Engagement with MyFitnessPal in EDs: https://onlinelibrary.wiley.com/doi/abs/10.1002/eat.23205
- My Fitness Pal calorie tracker usage in EDs (Levinson/Fewell), ScienceDirect: https://www.sciencedirect.com/science/article/abs/pii/S1471015317301484
- Using an app to count calories: motives & disordered eating, ScienceDirect: https://www.sciencedirect.com/science/article/abs/pii/S1471015321000957
- Calorie counting & fitness tracking tech: associations with ED symptomatology, PubMed: https://pubmed.ncbi.nlm.nih.gov/28214452/
- Princeton "Too Good to Be True: MyFitnessPal's Gamification of Weight Loss": https://tortoise.princeton.edu/2021/05/02/4043
- Stronger by Science — Diet Tracking and Disordered Eating: Which Comes First: https://www.strongerbyscience.com/diet-tracking/
- JMIR Formative Research — Therapists' approaches to inform ED app design: https://formative.jmir.org/2025/1/e68846
- SCOFF systematic review/meta-analysis, J Gen Intern Med: https://link.springer.com/article/10.1007/s11606-019-05478-6
- SCOFF validation multiethnic sample (Solmi 2015): https://onlinelibrary.wiley.com/doi/full/10.1002/eat.22373
- SCOFF questionnaire overview (Wikipedia): https://en.wikipedia.org/wiki/SCOFF_questionnaire
- NEDIC (helpline/contact): https://nedic.ca/contact/
- Eating Disorder Support Network of Alberta: https://edsna.ca/find-support/
- AHS Calgary Eating Disorder Program: https://www.albertahealthservices.ca/findhealth/Service.aspx?serviceAtFacilityId=1125534
