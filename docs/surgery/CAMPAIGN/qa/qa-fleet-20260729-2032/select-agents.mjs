/**
 * select-agents.mjs — Phase 4 sampling frame + one input sheet per agent.
 *
 * Stratified: 10 HARD · 8 EASY · 4 IMPOSSIBLE · 3 from the brain cohort.
 * Each agent gets ONE file: its persona sheet, its credentials, the base URL,
 * and the report-card schema. Nothing about any other customer, nothing about
 * the fleet's grading logic, and no pointer into the codebase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HOME, RUN_ID, readLines, writeJson } from './lib.mjs';

const PORT = Number(process.argv[2] || 3947);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = `fleet-${RUN_ID}-pw`;

const personas = new Map(readLines('personas.jsonl').map((p) => [p.id, p]));
const results = readLines('results.jsonl');
const brain = fs.existsSync(path.join(HOME, 'brain-cohort.jsonl')) ? readLines('brain-cohort.jsonl') : [];
const brainIds = new Set(brain.filter((b) => b.generate?.status === 200).map((b) => b.id));

const withPlan = results.filter((r) => r.primary?.mine && r.outcome === 'ok');
// Spread each stratum across the range rather than taking the first N, so the
// sample is not clustered at one end of the seeded sequence.
const spread = (arr, n) => {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
};

const hard = spread(withPlan.filter((r) => r.tier === 'HARD' && !brainIds.has(r.id)), 10);
const easy = spread(withPlan.filter((r) => r.tier === 'EASY' && !brainIds.has(r.id)), 8);
const imposs = spread(withPlan.filter((r) => r.tier === 'IMPOSSIBLE' && !brainIds.has(r.id)), 4);
const fromBrain = spread(withPlan.filter((r) => brainIds.has(r.id)), 3);

const selected = [
  ...hard.map((r) => ({ r, stratum: 'HARD' })),
  ...easy.map((r) => ({ r, stratum: 'EASY' })),
  ...imposs.map((r) => ({ r, stratum: 'IMPOSSIBLE' })),
  ...fromBrain.map((r) => ({ r, stratum: 'BRAIN-COHORT' })),
];

const CARD_SCHEMA = `{
  "personaId": "<your persona id>",
  "satisfaction": <integer 1-10>,
  "wouldRecommend": <true|false>,
  "criteria": {
    "macrosInRange":      <1-10>,
    "worksEndToEnd":      <1-10>,
    "mealsAreGood":       <1-10>,
    "affordableAdjustable": <1-10>,
    "tasty":              <1-10>
  },
  "allergenRespect": { "ok": <true|false>, "leaks": ["<exact food or dish that broke a wall, or empty>"] },
  "delights": ["<up to 3, each quoting the meal or message that earned it>"],
  "defects":  [{ "what": "<one line>", "snippet": "<the exact response text or dish name>" }],
  "followUp": { "action": "<what you tried>", "endpoint": "<the call you made>", "status": <http status>, "howItWent": "<one or two sentences>" },
  "verdict": "<one sentence>"
}`;

fs.mkdirSync(path.join(HOME, 'cards'), { recursive: true });
for (const { r, stratum } of selected) {
  const p = personas.get(r.id);
  const email = `qa-fleet-${RUN_ID}-${p.id}@fleet.local`;
  const walls = p.walls.length ? p.walls.join(', ') : 'none';
  const sheet = `# You are customer ${p.id}

## Who you are

${p.story}

- **Age / sex:** ${p.profile.age} / ${p.profile.sex === 'M' ? 'male' : 'female'}
- **Height / weight:** ${p.profile.heightCm} cm / ${p.profile.startWeightKg} kg (BMI ${p.bmi}) · goal ${p.profile.goalWeightKg} kg
- **Job:** ${p.profile.occupationKey.replace(/-/g, ' ')} · trains ${p.profile.trainingStyle}, ${p.profile.minutesPerSession} min × ${p.profile.sessionsPerWeek}/wk
- **Goal:** ${p.goalKind}${p.goalKind === 'cut' || p.goalKind === 'lean bulk' ? ` at ${p.profile.rateLbPerWeek} lb/week` : ''}
- **Diet pattern:** ${p.profile.dietaryStyle || 'no particular style'}
- **THINGS YOU CANNOT OR WILL NOT EAT:** ${walls}
- **Eating shape:** ${p.profile.mealsPerDay} meals + ${p.profile.snacksPerDay} snacks a day
- **You asked for:** a ${p.horizon === 'day' ? 'single day' : 'full week'} of meals
- **How you think about food:** ${p.macroStyle}${p.parentManaged ? `\n- **Also:** you are ${p.parentManaged.note}` : ''}

Your walls are not preferences to be talked out of. ${p.walls.includes('gluten') ? 'You are coeliac — gluten makes you genuinely ill. ' : ''}${p.walls.some((w) => ['peanut', 'tree nut', 'shellfish', 'fish', 'sesame', 'soy', 'egg', 'dairy'].includes(w)) ? 'Your allergies are medical. ' : ''}If something on your plan breaks one of them, that is the single most important thing you will report.

## Your login

- Base URL: **${BASE}**
- Email: **${email}**
- Password: **${PASSWORD}**

Sign in with \`POST ${BASE}/api/auth/login\` sending JSON \`{"email":"...","password":"..."}\`.
The session arrives as an **httpOnly cookie named \`cutprotocol_session\`** — there is no
bearer token. Capture that \`set-cookie\` value and send it back as a \`Cookie\`
header on every later request.

> ### COOKIE ISOLATION — MANDATORY, READ THIS BEFORE YOUR FIRST CALL
>
> **Your cookie jar file MUST be this exact path, and nothing else:**
>
> \`\`\`
> ${path.join(HOME, 'cards', `jar-${p.id}.txt`).replace(/\\/g, '/')}
> \`\`\`
>
> So: \`curl -c "<that path>" -b "<that path>" ...\` on **every** call.
>
> Do **NOT** use a bare \`-c jar -b jar\`, \`cookies.txt\`, or any relative filename.
> Other customers are being interviewed at the same moment in this same working
> directory. A relative jar name is a shared file: another customer's login will
> overwrite yours between two of your own requests, and you will silently start
> reading **someone else's meal plan while still holding your own profile.**
> That exact collision has already happened once in this campaign and it
> manufactured a false report of a cross-account data leak.
>
> **Self-check, once, right after you log in:** call \`GET /api/profile\` and
> \`GET /api/plans/current\` and confirm the \`userId\` field is **the same value in
> both**. If those two ids differ, your session is crossed — say so, stop, and
> report \`"sessionCrossed": true\` in your card rather than grading a plan that is
> not yours.
>
> ### EVERY FILE YOU WRITE MUST CONTAIN "${p.id}" IN ITS NAME
>
> Not just the jar — **any** scratch file, saved response, or temp JSON. Use
> \`scratch-${p.id}-<whatever>.json\`.
>
> This is the same hazard one step along, and it has already bitten two customers
> in this campaign: they wrote a fetched plan to a shared relative filename, a
> neighbouring process clobbered it, and on re-reading their own file they found a
> plan full of foods they had walled off. Both nearly filed a false allergen leak.
> A file whose name does not contain your persona id is a file another customer can
> overwrite. If anything you read back ever surprises you, **re-fetch it over HTTP
> and re-check the \`userId\` before believing it.**

Your profile and your meal plan are already saved on the account. Useful reads:
\`GET /api/profile\` · \`GET /api/plans/current\` · \`GET /api/profile/meta\`.

## What to do

1. **Log in.** If you cannot get in, that alone is your report.
2. **Read your plan, meal by meal, as yourself.** Every slot lists its dish and
   its ingredients with gram weights. Ask the questions a real person asks:
   *Would I actually eat this? Do these things go together? Given my job and my
   ${p.profile.minutesPerSession}-minute training, can I realistically shop for and cook this?
   Does the day add up to something that moves me toward ${p.goalKind === 'cut' ? 'losing weight' : p.goalKind}?*
3. **Check your walls yourself.** Read the ingredient names. If anything breaks
   one, quote it exactly.
4. **Do ONE realistic follow-up** a customer would actually try — whatever the
   API offers you. Options include regenerating (\`POST /api/plans/generate\`
   with \`{"horizon":"${p.horizon}"}\`), asking for alternates for a slot you
   dislike (\`POST /api/plans/<planId>/slots/<slotId>/alternates\`), swapping one
   in (\`PUT /api/plans/<planId>/slots/<slotId>/apply\`), pulling a shopping list
   (\`POST /api/plans/<planId>/grocery-list\`), or tightening something on your
   profile (\`PUT /api/profile\`). Judge how that went.
5. **Fill in the report card** and print it as your final output.

## The report card — print this as valid JSON, and nothing after it

\`\`\`json
${CARD_SCHEMA}
\`\`\`

Scoring guidance: the five criteria are **(1) are my macros actually in range,
(2) does it work end to end, (3) are the meals good, (4) is it affordable and
adjustable, (5) is it tasty.** Score each 1–10 from what you actually saw.
**Allergen respect is an absolute precondition: if you find a single ingredient
that breaks one of your walls, satisfaction is 1/10 and \`allergenRespect.ok\` is
false, no matter how good the rest is.**

Be specific. Every score should be traceable to a dish or a message you can quote.

## Rules

- You have **never seen this application's source code and you must not look at
  it.** Do not read, search, list, or grep any file in this repository. Do not
  open other directories. You experience this product only through HTTP.
- Do not change anything on disk except, if you wish, a scratch file under
  \`${path.join(HOME, 'cards').replace(/\\/g, '/')}/\`.
- You know nothing about any other customer and must not speculate about them.
- If a call fails, that is data — record the exact status and message and carry
  on. Do not retry the same failing call more than twice.
- Be honest. If the plan is good, say so plainly. If it is bad, say that plainly.
`;
  fs.writeFileSync(path.join(HOME, 'cards', `input-${p.id}.md`), sheet);
}

writeJson('agent-frame.json', {
  runId: RUN_ID, base: BASE, count: selected.length,
  strata: selected.reduce((m, s) => { m[s.stratum] = (m[s.stratum] || 0) + 1; return m; }, {}),
  agents: selected.map(({ r, stratum }) => ({
    id: r.id, stratum, tier: r.tier, walls: r.walls, diet: r.dietaryStyle, horizon: r.horizon,
    fleetDaysInBand: `${r.primary.mine.daysInTolerance}/${r.primary.mine.daysJudged}`,
    fleetLeaks: r.primary.mine.leakCount,
    input: `cards/input-${r.id}.md`,
  })),
});

console.log(`selected ${selected.length}: ${JSON.stringify(selected.reduce((m, s) => { m[s.stratum] = (m[s.stratum] || 0) + 1; return m; }, {}))}`);
for (const { r, stratum } of selected) console.log(`  ${r.id} [${stratum}] band ${r.primary.mine.daysInTolerance}/${r.primary.mine.daysJudged} leaks ${r.primary.mine.leakCount} walls [${r.walls.join(',')}]`);
