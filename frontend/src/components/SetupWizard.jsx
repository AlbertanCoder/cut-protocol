import { useState, useEffect, useMemo, useRef } from "react";
import { ArrowRight, ArrowLeft, Check, Search, AlertTriangle, Info } from "lucide-react";
import CutMark from "./ui/CutMark.jsx";
import { C } from "../lib/theme.js";
import { parseWeight, parseHeight, weightUnit, displayWeight, displayHeight, cm2ftin, ftin2cm } from "../lib/units.js";
import { Btn } from "./ui/Parts.jsx";
import AllergySearch from "./ui/AllergySearch.jsx";
import { fetchAllergenTaxonomy, fetchExclusionDescriptions, normTerm } from "./ui/allergyTaxonomy.js";
import { api } from "../lib/api.js";

// Each step carries the one line that says what it is FOR. The old array was
// four bare labels ("Units & Stats", "Activity", "Diet", "Rate") sitting over
// four identical progress bars, which told a first-time user nothing about
// what they were about to be asked or why.
const STEPS = [
  { key: "stats", label: "Units & stats", hint: "Sex, age, height, weight" },
  { key: "activity", label: "Activity", hint: "Your job, and your training" },
  { key: "diet", label: "Diet", hint: "Allergies, and how you eat" },
  { key: "rate", label: "Rate of loss", hint: "How fast — and what that costs" },
];

// Which step owns which field, so a server-side field error lands the user on
// the screen that has the input, instead of on whatever step they were on.
const FIELD_STEP = {
  sex: 0, age: 0, heightCm: 0, bodyFatPct: 0, startWeightKg: 0, goalWeightKg: 0, unitPref: 0,
  occupationKey: 1, activityOverride: 1, trainingStyle: 1, sessionsPerWeek: 1, minutesPerSession: 1,
  dietaryStyle: 2, excludedFoods: 2, mealsPerDay: 2, snacksPerDay: 2,
  rateLbPerWeek: 3, floorKcal: 3,
};

// Fallbacks only — /api/profile/meta serves `limits` and is the authority.
// These exist so a meta that hasn't landed yet doesn't make the wizard claim
// a 3-year-old is fine.
const FALLBACK_LIMITS = {
  adultMinAge: 18,
  age: { min: 18, max: 100 },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 30, max: 400 },
  goalBmi: { needsAckBelow: 18.5, refusedBelow: 16 },
};

// The occupation rows used to print a raw "×1.55". That is the TDEE multiplier
// the engine uses; it is Engine-tab material and means nothing to someone
// choosing between "Carpenter" and "Electrician". Each row now says what the
// job does to your day instead. Derived from the `group` key /meta already
// serves with every occupation, so a new occupation inherits a phrase without
// anyone updating a second list.
const ACTIVITY_PHRASE = {
  sedentary: "Mostly sitting",
  light: "On your feet part of the day",
  moderate: "On your feet most of the day",
  heavy: "Physically demanding",
  "very-heavy": "Hard physical work all day",
};
const activityPhrase = (o) => ACTIVITY_PHRASE[o?.group] || "Everyday activity";

const r1 = (n) => Math.round(n * 10) / 10;

// The under-18 refusal, worded here so the wizard can show it the moment the
// age is entered instead of after four steps of typing. The SERVER owns the
// rule (PUT /api/profile refuses with the same gate and its own copy) — this
// is the early, kinder version of the same answer, and it is deliberately not
// a scolding: a 15-year-old typing their real age has done nothing wrong.
const LOCAL_ADULT_REFUSAL = (minAge) => ({
  gate: "adult-only",
  error: `Cut Protocol can't build an eating plan for someone under ${minAge}.`,
  detail: [
    "Every calorie formula in this app was worked out from adults. A body that is still growing spends energy on growing, and none of these equations know that — so they come out low for a teenager, sometimes by 600-900 kcal a day.",
    "That is not a rounding error. It is the difference between a plan and a deficit stacked on a deficit, in the years bone density and height are being laid down.",
    "If you want help with food or training, someone who can actually see you — a doctor, or a dietitian who works with teenagers — is the right first step. They can do the thing this app can't, which is take growth into account.",
  ],
  whatNow: `If you're ${minAge} or over and mistyped your age, correct it and carry on.`,
});

// The goal-weight floor refusal, worded here for the same reason as the
// under-18 one above: so the wizard can show its REASONING the moment the goal
// is typed.
//
// THE BUG THIS CLOSES: the field note under Goal weight ends "Why, and what to
// do instead, is below." — but the only thing that rendered a "why" was
// `goalRefusal`, which is set from the SERVER's 400 (gate
// "goal-weight-floor"). Client-side validation blocks Next before that request
// is ever sent, so on the wizard the server was never reached, nothing
// rendered below, and the app promised an explanation it then didn't give —
// on the one screen where a refusal most needs to explain itself.
//
// The server's copy stays canonical (it is the enforcement, and it is what a
// Profile-tab edit shows); this is the early, kinder version of the same
// answer. Keep the two in step if either changes.
const LOCAL_GOAL_REFUSAL = ({ goalLabel, heightLabel, bmi, floorLabel, ackLabel, refusedBelow }) => ({
  gate: "goal-weight-floor",
  error: `A goal of ${goalLabel} at ${heightLabel} works out to a BMI of ${bmi}. This app won't prescribe a deficit down to it.`,
  detail: [
    `BMI is a crude population statistic and it gets individuals wrong all the time — but ${refusedBelow} is far enough below the range that the risks (heart rhythm, bone density, immune function, fertility) stop being arguable.`,
    `At ${heightLabel}, the lowest goal this app will accept is ${floorLabel}. ${ackLabel} is where the usual population range starts.`,
    "This limits what the app will PRESCRIBE. It is not a judgment about you, and it changes nothing about tracking: your real weight is your real weight, and a weigh-in is never refused or hidden.",
    "If a goal this low is something you have been set by a coach or a clinician, they should be the one steering it, with eyes on you.",
  ],
  whatNow: `Enter a goal of ${floorLabel} or above to carry on. If you simply mistyped it, correct it and nothing else changes.`,
});

// ── Provisional-profile ledger (onboarding-flow-3) ─────────────────────────
//
// THE BUG THIS CLOSES: the old "Skip — use defaults" button called
// putProfile({}), which made the SERVER fill in a whole person — 30 years old,
// 178 cm, 90 kg, goal 85 kg, desk job, 3 sessions a week — and then derive a
// BMR, a TDEE, a calorie target and a week of meals from it. The app then
// showed all of that as "your target", indistinguishable from numbers a real
// user had entered. That is the single most dangerous thing a body-composition
// app can do: it is a made-up prescription wearing the costume of a personal
// one, and the constitution in CLAUDE.md is explicit — "wrong math = product
// death", "nothing user-specific hardcoded".
//
// It is now impossible to reach that state silently. The estimate path exists
// (people genuinely do want to look around before measuring themselves), but
// it: names every assumption on screen before it is applied, requires an
// explicit acknowledgement, and leaves a marker that makes the entire app
// label those numbers as ESTIMATES until real ones replace them.
//
// The marker lives in localStorage rather than the DB because the profile
// schema is shared and a column can't be added from here. It self-heals: the
// snapshot of what was assumed is stored alongside, so as soon as ANY of those
// values differs from the live profile, the user has entered real data and the
// marker clears itself. No stale "finish your profile" nag, no way to be stuck.
const PROVISIONAL_KEY = "cutprotocol.profile.provisional";

// Mirrors backend/src/routes/profile.js → defaultProfile(). If that ever
// changes, this display text goes stale — which is precisely why the snapshot
// is recorded from the profile the SERVER returns, not from this constant.
export const DEFAULT_ASSUMPTIONS = {
  sex: "M", age: 30, heightCm: 178, startWeightKg: 90, goalWeightKg: 85,
  occupationKey: "desk-office", sessionsPerWeek: 3, trainingStyle: "mixed",
  minutesPerSession: 45, rateLbPerWeek: 1.0,
};

// The fields that make a profile PERSONAL. If any one of these no longer
// matches what was assumed, the user has told us something real.
const IDENTITY_FIELDS = ["sex", "age", "heightCm", "startWeightKg", "goalWeightKg"];

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

/** Record that this profile was created from defaults, plus what they were. */
export function markProfileProvisional(profile) {
  const s = safeStorage();
  if (!s || !profile) return;
  const snapshot = {};
  for (const f of IDENTITY_FIELDS) snapshot[f] = profile[f];
  try {
    s.setItem(PROVISIONAL_KEY, JSON.stringify({ at: new Date().toISOString(), snapshot }));
  } catch { /* private mode / quota — the labelling degrades, nothing breaks */ }
}

export function clearProfileProvisional() {
  const s = safeStorage();
  try { s?.removeItem(PROVISIONAL_KEY); } catch { /* ignore */ }
}

/**
 * Is the profile currently on screen still made of assumed numbers?
 * Returns the record ({at, snapshot}) if so, else null — and clears the marker
 * the moment real values appear, so this can be called on every render.
 */
export function readProfileProvisional(profile) {
  const s = safeStorage();
  if (!s || !profile) return null;
  let rec = null;
  try { rec = JSON.parse(s.getItem(PROVISIONAL_KEY) || "null"); } catch { return null; }
  if (!rec || !rec.snapshot) return null;
  const stillAssumed = IDENTITY_FIELDS.every((f) => {
    const a = rec.snapshot[f];
    const b = profile[f];
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
    return a === b;
  });
  if (!stillAssumed) { clearProfileProvisional(); return null; }
  return rec;
}

/**
 * A height the way its owner would say it.
 *
 * The review row used to run displayHeight() for BOTH units, so an imperial
 * user — who types 5 ft 10 in on the step before, and reads 5'10" everywhere
 * else in the app — was shown "70 in". Nobody gives their height in total
 * inches, and a number in a unit you don't think in is a number you can't
 * check.
 */
function formatHeight(cm, pref = "imperial") {
  if (cm == null) return "—";
  if (pref === "metric") return `${displayHeight(cm, "metric")} cm`;
  const { feet, inches } = cm2ftin(cm);
  return `${feet} ft ${inches} in`;
}

/** Human-readable list of what the defaults assume, in the user's units. */
export function describeAssumptions(pref = "imperial") {
  const a = DEFAULT_ASSUMPTIONS;
  return [
    ["Sex", a.sex === "M" ? "male" : "female"],
    ["Age", `${a.age}`],
    ["Height", formatHeight(a.heightCm, pref)],
    ["Current weight", `${displayWeight(a.startWeightKg, pref)} ${weightUnit(pref)}`],
    ["Goal weight", `${displayWeight(a.goalWeightKg, pref)} ${weightUnit(pref)}`],
    ["Job", "desk / office"],
    ["Training", `${a.sessionsPerWeek}×/week, ${a.minutesPerSession} min, mixed`],
    ["Rate of loss", `${a.rateLbPerWeek} lb/wk`],
  ];
}

// First-ever-launch setup. Collects the same fields the Profile tab edits,
// writes them in one putProfile at the end. Unsafe rates surface the same
// "I understand" contract the Profile tab enforces (422 → ack → resend).
export default function SetupWizard({ onDone }) {
  const [meta, setMeta] = useState(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [ackReasons, setAckReasons] = useState(null);
  const [acked, setAcked] = useState(false);
  // Per-input messages from the server (the PUT now answers with a
  // field → sentence map instead of a semicolon-joined dump of column names).
  const [fieldErrors, setFieldErrors] = useState({});
  // The goal-weight floor's grey-zone acknowledgement, and its outright
  // refusal. Separate from the rate ack: they are different questions, and the
  // server labels which one it is asking (`ack: "goalWeight"` vs `"rate"`).
  const [goalAck, setGoalAck] = useState(false);
  const [goalRefusal, setGoalRefusal] = useState(null);
  // The under-18 refusal, whether we worked it out here or the server did.
  const [adultGate, setAdultGate] = useState(null);
  const [ageTouched, setAgeTouched] = useState(false);
  // Pressed Next on an incomplete step 0. Until then, an untouched empty box
  // is not "wrong" and is not marked up as such.
  const [triedNext, setTriedNext] = useState(false);
  const [occQuery, setOccQuery] = useState("");
  // onboarding-flow-3: the estimate path is now a two-stage, explicit choice.
  const [showEstimatePanel, setShowEstimatePanel] = useState(false);
  const [estimateAcked, setEstimateAcked] = useState(false);

  const [d, setD] = useState({
    unitPref: "imperial",
    // height is cm when metric; ft+in when imperial (most people know 6'1", not 73")
    sex: "M", age: "", height: "", heightFt: "", heightIn: "", weight: "", bf: "", goal: "",
    occupationKey: "desk-office", sessions: 3, trainingStyle: "mixed", minutes: 45,
    // One flat list of exclusion terms — the same shape the profile stores.
    // The old split (fixed checkbox keys + a comma-separated "custom" string)
    // made a typed allergen a second-class citizen; it isn't one.
    dietaryStyle: "none", exclusions: [],
    mealsPerDay: 3, snacksPerDay: 1,
    rate: 1.0,
  });
  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));

  // Switching units CONVERTS what is already typed; it does not re-label it.
  //
  // THE BUG THIS CLOSES: the toggle used to be `set({ unitPref: u })` and
  // nothing else. Every number on this step is interpreted in the CURRENT
  // pref (`parseWeight(+d.weight, pref)`), so flipping lb → kg silently turned
  // a typed 200 lb into 200 kg — a 441 lb person — and every downstream number
  // (BMR, TDEE, target, the BMI the goal floor is judged on) was then computed
  // from it. Height was worse in a quieter way: cm and ft+in are SEPARATE
  // fields, so switching to metric showed an empty height box while the app
  // still held the old one, and the entered height appeared to vanish.
  const changeUnits = (u) => setD((cur) => {
    if (u === cur.unitPref) return cur;
    const next = { ...cur, unitPref: u };

    const convWeight = (val) => {
      if (val === "" || val == null) return val;
      const n = Number(val);
      if (!Number.isFinite(n)) return val;
      return String(displayWeight(parseWeight(n, cur.unitPref), u));
    };
    next.weight = convWeight(cur.weight);
    next.goal = convWeight(cur.goal);

    if (u === "metric") {
      const cm = (cur.heightFt === "" && cur.heightIn === "") ? null : ftin2cm(cur.heightFt, cur.heightIn);
      next.height = cm == null ? "" : String(displayHeight(cm, "metric"));
    } else {
      const cm = cur.height === "" ? null : parseHeight(Number(cur.height), "metric");
      const { feet, inches } = cm == null ? { feet: "", inches: "" } : cm2ftin(cm);
      next.heightFt = feet === "" ? "" : String(feet);
      next.heightIn = inches === "" ? "" : String(inches);
    }
    return next;
  });

  useEffect(() => {
    api.getProfileMeta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  // ── Allergies 2.0 (same picker as the Profile tab) ───────────────────────
  // A new user gets the searchable taxonomy on day one, not the short fixed
  // checkbox list. Degrades to the common-allergen quick chips if the
  // taxonomy module isn't on this build — never blocks setup.
  const [taxonomy, setTaxonomy] = useState({ available: false, taxonomy: [], reason: null });
  const [descriptions, setDescriptions] = useState(null);
  const [describeAvailable, setDescribeAvailable] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAllergenTaxonomy()
      .then((t) => { if (alive) setTaxonomy(t); })
      .catch(() => { if (alive) setTaxonomy({ available: false, taxonomy: [], reason: "couldn't reach the server" }); });
    return () => { alive = false; };
  }, []);

  // Nothing is saved yet in the wizard, so this describes the pending list —
  // the user finds out how a term will be matched BEFORE they commit to it.
  useEffect(() => {
    let alive = true;
    fetchExclusionDescriptions(d.exclusions)
      .then((r) => { if (!alive) return; setDescriptions(r.byTerm); setDescribeAvailable(r.available); })
      .catch(() => { if (!alive) return; setDescriptions({}); setDescribeAvailable(false); });
    return () => { alive = false; };
  }, [d.exclusions]);

  const addExclusion = (term) => {
    const t = String(term ?? "").trim();
    if (!t) return;
    setD((cur) => (cur.exclusions.some((x) => normTerm(x) === normTerm(t))
      ? cur
      : { ...cur, exclusions: [...cur.exclusions, t] }));
  };
  const removeExclusion = (term) =>
    setD((cur) => ({ ...cur, exclusions: cur.exclusions.filter((x) => x !== term) }));
  const replaceExclusion = (oldTerm, newTerm) =>
    setD((cur) => ({
      ...cur,
      exclusions: [
        ...cur.exclusions.filter((x) => normTerm(x) !== normTerm(oldTerm) && normTerm(x) !== normTerm(newTerm)),
        newTerm,
      ],
    }));

  // a11y: Next/Back swaps the whole step's content in place with no route
  // change, so nothing tells a keyboard/screen-reader user to look there.
  // Move focus to the new step's panel (skipping the very first render).
  const panelRef = useRef(null);
  const skipFirstFocus = useRef(true);
  useEffect(() => {
    if (skipFirstFocus.current) { skipFirstFocus.current = false; return; }
    panelRef.current?.focus({ preventScroll: false });
  }, [step]);

  const pref = d.unitPref;
  const limits = meta?.limits || FALLBACK_LIMITS;

  // Entered values in the app's storage units (cm / kg), or null when blank.
  const enteredCm = useMemo(() => {
    if (pref === "metric") return d.height === "" ? null : parseHeight(+d.height, "metric");
    if (d.heightFt === "" && d.heightIn === "") return null;
    return ftin2cm(d.heightFt, d.heightIn);
  }, [pref, d.height, d.heightFt, d.heightIn]);
  const enteredWeightKg = d.weight === "" ? null : parseWeight(+d.weight, pref);
  const enteredGoalKg = d.goal === "" ? null : parseWeight(+d.goal, pref);
  const goalBmi = enteredCm > 0 && enteredGoalKg > 0 ? enteredGoalKg / ((enteredCm / 100) ** 2) : null;

  const wUnit = weightUnit(pref);
  const wLo = r1(displayWeight(limits.weightKg.min, pref));
  const wHi = r1(displayWeight(limits.weightKg.max, pref));
  const heightRange = `${formatHeight(limits.heightCm.min, pref)} to ${formatHeight(limits.heightCm.max, pref)}`;

  // ── WHY THIS IS A MAP AND NOT A BOOLEAN ──────────────────────────────────
  // The gate line under the buttons used to read "Age 14-100, and height /
  // current weight / goal weight all filled to continue" for EVERY failure —
  // including the ones where the fields were filled and simply out of range.
  // A message that says "fill this in" to someone who just filled it in reads
  // as a broken app. Each problem now names itself, under the input that has
  // it. Bounds come from /meta so they cannot drift from the server's.
  const statsProblems = useMemo(() => {
    const p = {};
    const age = d.age === "" ? null : +d.age;
    if (age == null) p.age = "Needed — every calorie formula here is age-based.";
    else if (!Number.isFinite(age)) p.age = "Enter your age as a number of years.";
    else if (age > limits.age.max) p.age = `Enter an age of ${limits.age.max} or under.`;
    // age < adultMinAge is deliberately NOT a field error — see adultRefusal.

    if (enteredCm == null) p.height = "Needed — height drives the whole estimate.";
    else if (!(enteredCm >= limits.heightCm.min && enteredCm <= limits.heightCm.max)) {
      p.height = `That's outside the range this app can work with (${heightRange}).`;
    }

    if (enteredWeightKg == null) p.weight = "Needed — this is what everything is measured against.";
    else if (!(enteredWeightKg >= limits.weightKg.min && enteredWeightKg <= limits.weightKg.max)) {
      p.weight = `Enter a weight between ${wLo} and ${wHi} ${wUnit}.`;
    }

    if (enteredGoalKg == null) p.goal = "Needed — the plan is a route from one weight to another.";
    else if (!(enteredGoalKg >= limits.weightKg.min && enteredGoalKg <= limits.weightKg.max)) {
      p.goal = `Enter a goal weight between ${wLo} and ${wHi} ${wUnit}.`;
    } else if (goalBmi != null && goalBmi < limits.goalBmi.refusedBelow) {
      const floorKg = limits.goalBmi.refusedBelow * ((enteredCm / 100) ** 2);
      p.goal = `Too low to plan for at your height — ${r1(displayWeight(floorKg, pref))} ${wUnit} is the lowest goal this app will take. Why, and what to do instead, is below.`;
    }

    if (d.bf !== "" && !(+d.bf >= 0 && +d.bf <= 70)) p.bf = "Enter 0-70, or leave it blank.";
    return p;
  }, [d.age, d.bf, enteredCm, enteredWeightKg, enteredGoalKg, goalBmi, limits, pref, wUnit, wLo, wHi, heightRange]);

  // Under 18 → refused, here rather than after four steps of typing. The
  // number comes from the server; the wizard used to carry its own `>= 14`,
  // which is how it ended up disagreeing with the API it writes to.
  const enteredAge = d.age === "" ? null : +d.age;
  const isMinor = enteredAge != null && Number.isFinite(enteredAge) && enteredAge < limits.adultMinAge;
  // Only after they've finished typing: "1" on the way to "19" is not a child.
  const adultRefusal = adultGate || (isMinor && ageTouched ? LOCAL_ADULT_REFUSAL(limits.adultMinAge) : null);

  // Goal weight in the grey zone (below the population range but above the
  // hard floor): explain it, and require a tick. Never a block.
  const goalNeedsAck = goalBmi != null
    && goalBmi < limits.goalBmi.needsAckBelow
    && goalBmi >= limits.goalBmi.refusedBelow;

  // Below the hard floor: refused. The server refuses this too, but client-side
  // validation stops Next before the request goes out, so the explanation the
  // field note promises has to be available without a round trip.
  const goalRefusalShown = useMemo(() => {
    if (goalRefusal) return goalRefusal;
    if (goalBmi == null || !(enteredCm > 0)) return null;
    if (goalBmi >= limits.goalBmi.refusedBelow) return null;
    const hM2 = (enteredCm / 100) ** 2;
    const label = (kg) => `${r1(displayWeight(kg, pref))} ${wUnit}`;
    return LOCAL_GOAL_REFUSAL({
      goalLabel: label(enteredGoalKg),
      heightLabel: formatHeight(enteredCm, pref),
      bmi: r1(goalBmi),
      floorLabel: label(limits.goalBmi.refusedBelow * hM2),
      ackLabel: label(limits.goalBmi.needsAckBelow * hM2),
      refusedBelow: limits.goalBmi.refusedBelow,
    });
  }, [goalRefusal, goalBmi, enteredCm, enteredGoalKg, limits, pref, wUnit]);

  const statsValid = Object.keys(statsProblems).length === 0 && !isMinor && (!goalNeedsAck || goalAck);

  // Client-side taste of the safety rail: rate vs ~1% of entered body weight.
  // The server re-checks properly (including the floor clamp, which needs a
  // TDEE this screen doesn't have) on submit.
  //
  // ">=", not ">", ON PURPOSE. The server's rule is "above ~1%", so a 200 lb
  // user picking the menu's top 2.0 lb/wk lands on exactly 1.00% and slips
  // through — which is precisely what the walkthrough found: 2 lb/wk chosen in
  // the wizard, no acknowledgement anywhere. One notch stricter here means the
  // wizard can over-ask but never under-ask, and over-asking is the safe way
  // to be wrong about this.
  const ratePctOfBw = useMemo(() => {
    if (!enteredWeightKg) return null;
    return (d.rate / (enteredWeightKg * 2.20462)) * 100;
  }, [enteredWeightKg, d.rate]);
  const rateLooksAggressive = ratePctOfBw != null && ratePctOfBw >= 1.0;
  const rateNeedsAck = rateLooksAggressive || !!ackReasons;

  const buildPatch = () => ({
    unitPref: d.unitPref,
    sex: d.sex,
    age: +d.age,
    heightCm: pref === "metric" ? parseHeight(+d.height, pref) : ftin2cm(d.heightFt, d.heightIn),
    ...(d.bf !== "" ? { bodyFatPct: +d.bf } : { bodyFatPct: 0 }),
    startWeightKg: parseWeight(+d.weight, pref),
    goalWeightKg: parseWeight(+d.goal, pref),
    occupationKey: d.occupationKey,
    sessionsPerWeek: +d.sessions || 0,
    trainingStyle: d.trainingStyle,
    minutesPerSession: +d.minutes || 0,
    dietaryStyle: d.dietaryStyle === "none" ? null : d.dietaryStyle,
    excludedFoods: d.exclusions,
    mealsPerDay: +d.mealsPerDay || 3,
    snacksPerDay: +d.snacksPerDay || 0,
    rateLbPerWeek: d.rate,
  });

  const finish = async (skipAll) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      if (skipAll) {
        // Estimate path. The profile the server returns IS the assumed one —
        // snapshot it so every screen can label those numbers honestly, and
        // so the label disappears by itself once real values are entered.
        const created = await api.putProfile({ unitPref: d.unitPref });
        markProfileProvisional(created);
      } else {
        await api.putProfile({
          ...buildPatch(),
          ...(acked ? { rateAcknowledged: true } : {}),
          ...(goalAck ? { goalWeightAcknowledged: true } : {}),
        });
        // A fully-entered profile is real by definition — drop any marker left
        // from an earlier estimate run.
        clearProfileProvisional();
      }
      await onDone();
      return;
    } catch (e) {
      handleSaveError(e);
      setBusy(false);
    }
  };

  // Every way the server can say no, each answered in its own shape. Anything
  // it refuses lands the user on the step that owns the input — an error about
  // goal weight shown on the rate step is an error nobody can act on.
  const handleSaveError = (e) => {
    const b = e.body || {};
    if (e.status === 403 && b.gate === "adult-only") { setAdultGate(b); setStep(0); return; }
    if (e.status === 400 && b.gate === "goal-weight-floor") {
      setGoalRefusal(b);
      setFieldErrors(b.fields || {});
      setStep(0);
      return;
    }
    if (e.status === 422 && b.requiresAck) {
      // `ack` names which confirmation is being asked for. Answering the
      // goal-weight question with a rate acknowledgement would just loop.
      if (b.ack === "goalWeight") { setGoalRefusal(null); setError(null); setStep(0); setGoalAck(false); setFieldErrors({ goal: b.error }); return; }
      setAckReasons(b.reasons);
      setStep(3);
      return;
    }
    if (b.fields && Object.keys(b.fields).length) {
      setFieldErrors(b.fields);
      const first = Object.keys(b.fields).find((k) => FIELD_STEP[k] !== undefined);
      if (first !== undefined) setStep(FIELD_STEP[first]);
      return;
    }
    setError(e.message);
  };

  const filteredOcc = useMemo(() => {
    if (!meta) return [];
    const q = occQuery.trim().toLowerCase();
    return q ? meta.occupations.filter((o) => o.label.toLowerCase().includes(q)) : meta.occupations;
  }, [meta, occQuery]);


  const inp = "text-sm px-3 py-2.5 rounded-xl w-full mt-1";
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const badStyle = { ...inpStyle, border: `1.5px solid ${C.warn}` };
  const label = (t) => <span className="text-xs font-bold" style={{ color: C.faint }}>{t}</span>;

  // A field's message, if it has one AND the user is ready to hear it. Nagging
  // an empty box the user hasn't reached yet is noise; staying silent after
  // they've pressed Next is the bug this replaces.
  const noteFor = (local, serverKey, hasValue) => {
    const msg = statsProblems[local] || fieldErrors[serverKey] || fieldErrors[local];
    if (!msg) return null;
    return triedNext || hasValue ? msg : null;
  };
  const FieldNote = ({ children }) => (children
    ? <div className="text-[11px] font-semibold mt-1" style={{ color: C.warn }}>{children}</div>
    : null);

  const ageNote = noteFor("age", "age", d.age !== "");
  const heightNote = noteFor("height", "heightCm", enteredCm != null);
  const weightNote = noteFor("weight", "startWeightKg", d.weight !== "");
  const goalNote = noteFor("goal", "goalWeightKg", d.goal !== "");
  const bfNote = noteFor("bf", "bodyFatPct", d.bf !== "");

  const currentOcc = (meta?.occupations || []).find((o) => o.key === d.occupationKey);

  const finishBlocked = busy || !!adultRefusal || (rateNeedsAck && !acked) || (goalNeedsAck && !goalAck);

  return (
    // DESKTOP FIRST (standing rule 1). This screen used to be a 672px
    // (`max-w-2xl`) centred column — a phone layout, on the first thing every
    // new user sees, floating in a black ocean at 1920px. It is now the same
    // shape as the app behind it: a fixed left rail carrying identity, progress
    // and the escape hatch, and a wide content column that actually uses the
    // window. Nothing nests a `max-w-xs` block inside it any more.
    <div className="min-h-svh w-full px-6 py-8 lg:px-10 lg:py-12 2xl:px-16">
      <div className="mx-auto w-full max-w-[1240px]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 xl:gap-10 items-start">

          {/* ── LEFT RAIL ─────────────────────────────────────────────── */}
          <aside className="lg:col-span-4 xl:col-span-3 lg:sticky lg:top-12">
            <div className="flex items-center gap-3 mb-7">
              <CutMark size={44} />
              <div className="leading-none">
                <div className="disp text-lg uppercase" style={{ color: C.ink }}>Cut Protocol</div>
                <div className="text-[11px] font-bold uppercase mt-1" style={{ color: C.faint, letterSpacing: ".08em" }}>First-run setup</div>
              </div>
            </div>

            {/* Progress is a vertical list of named steps, not four bars.
                COLOUR LAW (a): the completed markers are a LIGHTNESS step, not
                green — green means on-target / primary action / success, and
                "you filled in a form" is none of those. */}
            <ol className="space-y-1 mb-6" aria-label="Setup steps">
              {STEPS.map((s, i) => {
                const done = i < step;
                const current = i === step;
                return (
                  <li key={s.key} aria-current={current ? "step" : undefined}>
                    <button
                      type="button"
                      onClick={() => { if (done) setStep(i); }}
                      disabled={!done}
                      className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl"
                      style={{
                        background: current ? C.card2 : "transparent",
                        border: `1px solid ${current ? C.faintLight : "transparent"}`,
                        cursor: done ? "pointer" : "default",
                      }}
                    >
                      <span
                        className="shrink-0 mt-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-extrabold"
                        aria-hidden="true"
                        style={{
                          width: 20, height: 20,
                          background: done ? C.faintLight : current ? C.ink : "transparent",
                          color: done || current ? C.paper : C.faintLight,
                          border: `1px solid ${done || current ? "transparent" : C.rule}`,
                        }}
                      >
                        {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-bold" style={{ color: current ? C.ink : done ? C.faint : C.faintLight }}>
                          {s.label}
                        </span>
                        <span className="block text-[11px] font-semibold mt-0.5" style={{ color: C.faintLight }}>{s.hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* The escape hatch, on every step — it was called the single best
                onboarding decision in the app and it is not going anywhere. It
                is MORE reachable here than as a dotted link beside "Next": one
                fixed place, visible from every step, never scrolled past. */}
            <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.rule}` }}>
              <div className="text-xs font-bold mb-1" style={{ color: C.ink }}>Don&apos;t know your numbers yet?</div>
              <div className="text-[11px] font-semibold leading-relaxed mb-2.5" style={{ color: C.faint }}>
                You can look around the app on assumed numbers first. Everything derived from them stays
                labelled as an estimate until you enter your own.
              </div>
              <button
                type="button"
                onClick={() => { setShowEstimatePanel((v) => !v); setEstimateAcked(false); }}
                disabled={busy}
                aria-expanded={showEstimatePanel}
                className="text-xs font-bold underline decoration-dotted underline-offset-4 hover:opacity-80"
                style={{ color: C.ink }}
              >
                {showEstimatePanel ? "Hide what that assumes" : "Show me what that assumes"}
              </button>
            </div>
          </aside>

          {/* ── MAIN COLUMN ───────────────────────────────────────────── */}
          <main className="lg:col-span-8 xl:col-span-9 min-w-0">

            {/* UNDER-18 REFUSAL. Sits above the form rather than replacing it,
                so someone who mistyped their age can simply fix it. The server
                refuses this independently (PUT /api/profile, gate
                "adult-only") — this is the early, kinder copy of the same
                answer, not the enforcement. */}
            {adultRefusal && (
              <div role="alert" className="mb-4 p-5 rounded-2xl" style={{ background: C.card, border: `1px solid ${C.faintLight}` }}>
                <div className="flex items-start gap-3">
                  <Info size={20} style={{ color: C.faint }} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-base font-extrabold" style={{ color: C.ink }}>{adultRefusal.error}</div>
                    {(adultRefusal.detail || []).map((p, i) => (
                      <p key={i} className="text-xs font-semibold leading-relaxed mt-2" style={{ color: C.faint }}>{p}</p>
                    ))}
                    {adultRefusal.whatNow && (
                      <p className="text-xs font-bold mt-3" style={{ color: C.ink }}>{adultRefusal.whatNow}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* GOAL-WEIGHT FLOOR — the outright refusal (no override).
                Explains its reasoning rather than just blocking. Rendered from
                the server's 400 when there is one, and from the local copy
                when client-side validation refused before the request was
                sent — the field note promises this panel either way. */}
            {goalRefusalShown && (
              <div role="alert" className="mb-4 p-5 rounded-2xl" style={{ background: C.card, border: `1px solid ${C.faintLight}` }}>
                <div className="flex items-start gap-3">
                  <Info size={20} style={{ color: C.faint }} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-base font-extrabold" style={{ color: C.ink }}>{goalRefusalShown.error}</div>
                    {(goalRefusalShown.detail || []).map((p, i) => (
                      <p key={i} className="text-xs font-semibold leading-relaxed mt-2" style={{ color: C.faint }}>{p}</p>
                    ))}
                    {goalRefusalShown.whatNow && (
                      <p className="text-xs font-bold mt-3" style={{ color: C.ink }}>{goalRefusalShown.whatNow}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── ESTIMATE PATH (onboarding-flow-3) ─────────────────────
                Shown only on request. Every assumed value is listed in the
                user's own units, the consequences are stated plainly, and it
                cannot be applied without an explicit tick. Nothing here is
                presented as the user's own data at any point. */}
            {showEstimatePanel && (
              <div className="mb-4 p-5 rounded-2xl" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} style={{ color: C.warn }} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-extrabold" style={{ color: C.ink }}>
                      This starts you on ESTIMATES FROM DEFAULTS — not your numbers
                    </div>
                    <div className="text-xs font-semibold mt-1.5 leading-relaxed" style={{ color: C.faint }}>
                      Nothing about you is known yet, so the app has to assume a person. Your calorie
                      target, macros and meal plan would all be derived from the assumptions below —
                      they are a demo of the engine, not a prescription for you.
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-1 mt-3.5 mb-3">
                      {describeAssumptions(pref).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3 text-xs font-semibold py-0.5"
                          style={{ borderBottom: `1px solid ${C.rule}` }}>
                          <span style={{ color: C.faint }}>{k}</span>
                          <span className="mono" style={{ color: C.ink }}>{v}</span>
                        </div>
                      ))}
                    </div>

                    <div className="text-xs font-semibold leading-relaxed" style={{ color: C.faint }}>
                      Every screen will keep these numbers flagged as estimates, and keep asking you to
                      finish your profile, until you enter your real height and weight. Take two
                      minutes and fill the four steps instead — it is the whole point of the app.
                    </div>

                    <label className="flex items-start gap-2 text-xs font-bold mt-3" style={{ color: C.warn }}>
                      <input type="checkbox" checked={estimateAcked} onChange={(e) => setEstimateAcked(e.target.checked)}
                        className="mt-0.5" style={{ accentColor: C.warn }} />
                      I understand these are assumed numbers, not mine, and any target shown is an estimate.
                    </label>

                    <div className="flex flex-wrap gap-2 mt-3.5">
                      <Btn kind="ghost" onClick={() => finish(true)} disabled={busy || !estimateAcked}>
                        {busy ? "Saving…" : "Continue with estimates"}
                      </Btn>
                      <Btn onClick={() => setShowEstimatePanel(false)} disabled={busy}>
                        Enter my real numbers
                      </Btn>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="p-6 xl:p-8 rounded-2xl glass-card" ref={panelRef} tabIndex={-1}>
              {step === 0 && (
                <>
                  <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Units &amp; stats</div>
                  <div className="text-xs font-semibold mb-5" style={{ color: C.faint }}>
                    Your calorie target and meal plans are built from these four numbers. You can change any of
                    them later on the Profile tab.
                  </div>

                  {/* Sized to its content, not stretched and not capped at a
                      phone width — a two-option segmented control. */}
                  <div className="inline-flex gap-1.5 mb-5" role="group" aria-label="Units">
                    {["imperial", "metric"].map((u) => (
                      <button key={u} type="button" onClick={() => changeUnits(u)} aria-pressed={pref === u}
                        className="text-xs font-bold px-5 py-2 rounded-xl"
                        style={{ background: pref === u ? C.card2 : "transparent", color: pref === u ? C.ink : C.faint, border: `1px solid ${pref === u ? C.faintLight : C.rule}` }}>
                        {u === "imperial" ? "lb / in" : "kg / cm"}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
                    <label className="block">{label("Sex")}
                      <select value={d.sex} onChange={(e) => set({ sex: e.target.value })} className={inp} style={inpStyle}>
                        <option value="M">Male</option><option value="F">Female</option>
                      </select>
                    </label>
                    <label className="block">{label("Age")}
                      <input type="number" value={d.age} aria-invalid={!!ageNote}
                        onChange={(e) => { set({ age: e.target.value }); setAdultGate(null); }}
                        onBlur={() => setAgeTouched(true)}
                        className={inp} style={ageNote ? badStyle : inpStyle} placeholder="30" />
                      <FieldNote>{ageNote}</FieldNote>
                    </label>
                    {pref === "metric" ? (
                      <label className="block">{label("Height (cm)")}
                        <input type="number" value={d.height} aria-invalid={!!heightNote}
                          onChange={(e) => set({ height: e.target.value })}
                          className={inp} style={heightNote ? badStyle : inpStyle} placeholder="178" />
                        <FieldNote>{heightNote}</FieldNote>
                      </label>
                    ) : (
                      // a11y: this was a <div className="block"> wrapping the
                      // label text, so NEITHER the feet box nor the inches box
                      // was associated with the visible "Height (ft / in)"
                      // caption. One caption over two inputs is exactly what
                      // fieldset/legend is for; the per-input aria-labels stay.
                      <fieldset className="block border-0 p-0 m-0 min-w-0">
                        <legend className="p-0">{label("Height (ft / in)")}</legend>
                        <div className="flex gap-2 mt-1">
                          <input type="number" aria-label="Height feet" aria-invalid={!!heightNote} value={d.heightFt}
                            onChange={(e) => set({ heightFt: e.target.value })}
                            className="text-sm px-3 py-2.5 rounded-xl w-full" style={heightNote ? badStyle : inpStyle} placeholder="ft" min="0" max="8" />
                          <input type="number" aria-label="Height inches" aria-invalid={!!heightNote} value={d.heightIn}
                            onChange={(e) => set({ heightIn: e.target.value })}
                            className="text-sm px-3 py-2.5 rounded-xl w-full" style={heightNote ? badStyle : inpStyle} placeholder="in" min="0" max="11" />
                        </div>
                        <FieldNote>{heightNote}</FieldNote>
                      </fieldset>
                    )}
                    <label className="block">{label(`Current weight (${weightUnit(pref)})`)}
                      <input type="number" value={d.weight} aria-invalid={!!weightNote}
                        onChange={(e) => set({ weight: e.target.value })}
                        className={inp} style={weightNote ? badStyle : inpStyle} placeholder={pref === "metric" ? "90" : "200"} />
                      <FieldNote>{weightNote}</FieldNote>
                    </label>
                    <label className="block">{label(`Goal weight (${weightUnit(pref)})`)}
                      <input type="number" value={d.goal} aria-invalid={!!goalNote}
                        onChange={(e) => { set({ goal: e.target.value }); setGoalRefusal(null); setGoalAck(false); }}
                        className={inp} style={goalNote ? badStyle : inpStyle} placeholder={pref === "metric" ? "82" : "180"} />
                      <FieldNote>{goalNote}</FieldNote>
                    </label>
                    <label className="block">{label("Body fat % (optional)")}
                      <input type="number" value={d.bf} aria-invalid={!!bfNote}
                        onChange={(e) => set({ bf: e.target.value })}
                        className={inp} style={bfNote ? badStyle : inpStyle} placeholder="unknown" />
                      <FieldNote>{bfNote}</FieldNote>
                    </label>
                  </div>

                  {/* GOAL WEIGHT, GREY ZONE. Below the population range but
                      above the floor: explained, acknowledged, never blocked.
                      BMI is a population statistic and this copy says so — a
                      lean, muscular or small-framed person can legitimately
                      live here and the app has no standing to overrule them. */}
                  {goalNeedsAck && (
                    <div className="mt-5 p-4 rounded-xl" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle size={16} style={{ color: C.warn }} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold" style={{ color: C.ink }}>
                            That goal is a BMI of {r1(goalBmi)} — under the {limits.goalBmi.needsAckBelow} the population range usually starts at.
                          </div>
                          <p className="text-xs font-semibold leading-relaxed mt-1.5" style={{ color: C.faint }}>
                            BMI knows nothing about your frame or how much muscle you carry, and it penalises short
                            people by design. Plenty of lean, strong people sit under it and are fine. It is a prompt
                            to think, not a verdict.
                          </p>
                          <p className="text-xs font-semibold leading-relaxed mt-1.5" style={{ color: C.faint }}>
                            What is worth watching is the stuff a scale can&apos;t show: strength going backwards, sleep
                            breaking up, feeling cold, mood flattening, periods changing. If any of that starts, the
                            goal is too low whatever the number says.
                          </p>
                          <label className="flex items-start gap-2 text-xs font-bold mt-2.5" style={{ color: C.warn }}>
                            <input type="checkbox" checked={goalAck} onChange={(e) => setGoalAck(e.target.checked)}
                              className="mt-0.5" style={{ accentColor: C.warn }} />
                            I&apos;ve read this and that goal weight is what I want.
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === 1 && (
                <>
                  <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Activity</div>
                  <div className="text-xs font-semibold mb-5" style={{ color: C.faint }}>
                    Your job sets your everyday activity level; workouts add on top of it.
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                    <div className="xl:col-span-7 min-w-0">
                      <label className="block mb-1.5" htmlFor="wizard-occupation">{label("Occupation")}</label>
                      <div className="relative mb-2">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} aria-hidden="true" />
                        <input id="wizard-occupation" placeholder="Search occupations…" value={occQuery} onChange={(e) => setOccQuery(e.target.value)}
                          className="text-sm pl-9 pr-3 py-2.5 rounded-xl w-full" style={inpStyle} />
                      </div>
                      {/* The list container is one rung DOWN the surface ladder
                          from the selected row. It used to be `card2` with the
                          selected row also `card2` — identical, which is why
                          picking a job appeared to do nothing at all. */}
                      <div className="max-h-72 overflow-y-auto rounded-xl" style={{ background: C.card, border: `1px solid ${C.rule}` }} role="listbox" aria-label="Occupations">
                        {filteredOcc.map((o) => {
                          const sel = d.occupationKey === o.key;
                          return (
                            <button key={o.key} type="button" role="option" aria-selected={sel} onClick={() => set({ occupationKey: o.key })}
                              className="w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-3"
                              style={{ background: sel ? C.card2 : "transparent", borderBottom: `1px solid ${C.rule}` }}>
                              <span className="flex items-center gap-2 min-w-0">
                                <Check size={14} strokeWidth={3} aria-hidden="true" style={{ color: C.ink, opacity: sel ? 1 : 0, flexShrink: 0 }} />
                                <span className="truncate" style={{ color: sel ? C.ink : C.faint, fontWeight: sel ? 800 : 600 }}>{o.label}</span>
                              </span>
                              <span className="text-[11px] font-semibold shrink-0" style={{ color: C.faintLight }}>{activityPhrase(o)}</span>
                            </button>
                          );
                        })}
                        {meta && filteredOcc.length === 0 && (
                          <div className="px-3 py-2.5 text-sm font-semibold" style={{ color: C.faint }}>
                            Nothing matches that. Pick the closest one — you can fine-tune the multiplier on the Profile tab later.
                          </div>
                        )}
                      </div>
                      <div aria-live="polite" className="text-xs font-bold mt-2" style={{ color: C.ink }}>
                        {currentOcc
                          ? <>Selected: {currentOcc.label} <span style={{ color: C.faint, fontWeight: 600 }}>· {activityPhrase(currentOcc)}</span></>
                          : <span style={{ color: C.faint, fontWeight: 600 }}>Nothing selected yet.</span>}
                      </div>
                    </div>

                    <div className="xl:col-span-5 min-w-0 grid grid-cols-2 xl:grid-cols-1 gap-x-6 gap-y-4 content-start">
                      <label className="block">{label("Training style")}
                        <select value={d.trainingStyle} onChange={(e) => set({ trainingStyle: e.target.value })} className={inp} style={inpStyle}>
                          {(meta?.trainingStyles || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      </label>
                      <label className="block">{label("Sessions / week")}
                        <input type="number" min={0} max={14} value={d.sessions} onChange={(e) => set({ sessions: e.target.value })} className={inp} style={inpStyle} />
                      </label>
                      <label className="block">{label("Minutes / session")}
                        <input type="number" min={0} max={300} value={d.minutes} onChange={(e) => set({ minutes: e.target.value })} className={inp} style={inpStyle} />
                      </label>
                      <div className="text-[11px] font-semibold leading-relaxed self-end" style={{ color: C.faintLight }}>
                        Leave these at zero if you don&apos;t train yet — the plan works either way, and the Engine tab
                        shows exactly what each part contributes.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Diet &amp; allergies</div>
                  <div className="text-xs font-semibold mb-5" style={{ color: C.faint }}>
                    These hard-filter every meal plan, the recipe library, and AI generation.
                  </div>
                  {/* Allergies first, and searchable — the same control the
                      Profile tab uses, so nothing has to be re-learned later.
                      None is a valid answer; this step is skippable by leaving it
                      empty. */}
                  <div className="mb-5">
                    <AllergySearch
                      taxonomy={taxonomy.taxonomy}
                      taxonomyReason={taxonomy.reason}
                      quickOptions={meta?.allergyOptions || []}
                      selected={d.exclusions}
                      descriptions={descriptions}
                      describeAvailable={describeAvailable}
                      onAdd={addExclusion}
                      onRemove={removeExclusion}
                      onReplace={replaceExclusion}
                    />
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-4">
                    <label className="block xl:col-span-2">{label("Dietary style")}
                      <select value={d.dietaryStyle} onChange={(e) => set({ dietaryStyle: e.target.value })} className={inp} style={inpStyle}>
                        {(meta?.dietaryStyles || ["none"]).map((s) => (
                          <option key={s} value={s}>{s === "none" ? "None (no restriction)" : s[0].toUpperCase() + s.slice(1)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">{label("Meals / day")}
                      <input type="number" min={1} max={8} value={d.mealsPerDay} onChange={(e) => set({ mealsPerDay: e.target.value })} className={inp} style={inpStyle} />
                    </label>
                    <label className="block">{label("Snacks / day")}
                      <input type="number" min={0} max={8} value={d.snacksPerDay} onChange={(e) => set({ snacksPerDay: e.target.value })} className={inp} style={inpStyle} />
                    </label>
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  <div className="text-lg font-extrabold mb-1" style={{ color: C.ink }}>Rate of loss</div>
                  <div className="text-xs font-semibold mb-5" style={{ color: C.faint }}>
                    This sets your daily calories: what your body burns in a day, minus the shortfall this rate
                    needs — and never below the safety floor.
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {(meta?.rateOptions || []).map((r) => (
                      <button key={r} type="button" aria-pressed={d.rate === r}
                        onClick={() => { set({ rate: r }); setAcked(false); setAckReasons(null); }}
                        className="px-5 py-3 rounded-xl text-center"
                        style={{ background: d.rate === r ? C.card2 : "transparent", border: `1px solid ${d.rate === r ? C.faintLight : C.rule}` }}>
                        <div className="mono text-sm font-extrabold" style={{ color: d.rate === r ? C.ink : C.faint }}>{r} lb/wk</div>
                        <div className="text-[10px] font-bold" style={{ color: C.faintLight }}>{Math.round(r * 45.3592) / 100} kg/wk</div>
                      </button>
                    ))}
                  </div>

                  {/* THE ACKNOWLEDGEMENT THE README PROMISED AND THE WIZARD
                      DIDN'T HAVE. Same contract, same wording, same "I
                      understand" as the Profile tab: an aggressive rate cannot
                      be saved from here without an explicit tick, whether this
                      screen worked it out or the server did (422). */}
                  {rateNeedsAck && (
                    <div role="alert" className="p-4 rounded-xl mb-2" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle size={16} style={{ color: C.warn }} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold mb-1" style={{ color: C.warn }}>This rate needs an explicit OK</div>
                          {ackReasons
                            ? ackReasons.map((r, i) => <div key={i} className="text-xs font-semibold mb-0.5" style={{ color: C.ink }}>· {r}</div>)
                            : (
                              <div className="text-xs font-semibold" style={{ color: C.ink }}>
                                · {d.rate} lb/wk is {ratePctOfBw.toFixed(2)}% of your body weight a week — at or above the ~1% guideline.
                                Faster than that mostly costs muscle, and it is the rate people quit at.
                              </div>
                            )}
                          <label className="flex items-center gap-2 text-xs font-bold mt-2.5" style={{ color: C.warn }}>
                            <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} style={{ accentColor: C.warn }} />
                            I understand — apply anyway
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {error && <div role="alert" className="text-xs font-semibold mt-4" style={{ color: C.red }}>{error}</div>}

              <div className="flex items-center justify-between gap-4 mt-7 pt-5" style={{ borderTop: `1px solid ${C.rule}` }}>
                <div>
                  {step > 0 && (
                    <Btn kind="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                      <ArrowLeft size={13} className="inline mr-1" aria-hidden="true" />Back
                    </Btn>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {step === 0 && !statsValid && triedNext && !adultRefusal && (
                    <span role="alert" className="text-[11px] font-semibold" style={{ color: C.warn }}>
                      {goalNeedsAck && !goalAck
                        ? "Tick the goal-weight box above to continue."
                        : "Check the notes under the fields above."}
                    </span>
                  )}
                  {step < STEPS.length - 1 ? (
                    <Btn onClick={() => { if (step === 0 && !statsValid) { setTriedNext(true); return; } setTriedNext(false); setStep(step + 1); }} disabled={busy || !!adultRefusal}>
                      Next<ArrowRight size={13} className="inline ml-1" aria-hidden="true" />
                    </Btn>
                  ) : (
                    <Btn onClick={() => finish(false)} disabled={finishBlocked}>
                      <Check size={13} className="inline mr-1" aria-hidden="true" />{busy ? "Saving…" : "Finish setup"}
                    </Btn>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
