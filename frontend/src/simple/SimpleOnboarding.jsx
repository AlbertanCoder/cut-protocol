import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { describeError } from "../lib/api.js";
import { parseWeight, parseHeight, ftin2cm, weightUnit } from "../lib/units.js";
import { Screen, Ask, Big, Quiet, Choice, NumberBox, Dots, Note, Details, Pill, Sheet } from "./parts.jsx";

// Six plain questions, one per screen, then a review.
//
// WHAT THIS IS NOT: a replacement for SetupWizard.jsx. That file is untouched
// and still runs the full 4-step flow on the full surface. This is a second
// door into the SAME endpoint.
//
// THE PAYLOAD IS IDENTICAL. buildPatch() below is a copy of
// SetupWizard.jsx:465-482, field for field, including the defaults for
// everything this surface does not ask about. Reshaping the profile payload is
// forbidden (CLAUDE.md rule 3), and a second writer that sends a different
// shape is how that rule gets broken by accident.
//
// WHY THESE SIX: measured, not guessed. docs/audit/ux-review-2026-08-02/
// 09-profile-setup-states.md:156-193 tested the 4-step wizard against a copy of
// the database and found goal weight and all of step 2 move the daily calorie
// number by zero. Goal weight is still asked here — it is what the weight chart
// aims at, and people expect to be asked. The rest take the wizard's own
// defaults, are labelled as assumptions on the review screen, and stay editable
// in the full app.
//
// THE FOOD SCREEN HAS NO SKIP, on purpose. roadmap/09-ux-onboarding.md:81-99
// records why: an empty exclusions list once meant a real shellfish allergy met
// real shellfish. "No restrictions" here is a stated answer, not a blank field.

const COMMON = [
  "Shellfish", "Peanuts", "Tree nuts", "Dairy",
  "Gluten", "Soy", "Eggs", "Fish",
];

export default function SimpleOnboarding({ onDone, onShowFull }) {
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The three ways the server can refuse, each answered in its own shape.
  // Same contract SetupWizard.jsx:516-540 handles.
  const [rateAck, setRateAck] = useState(false);
  const [goalAck, setGoalAck] = useState(false);
  const [refusal, setRefusal] = useState(null);
  // Confirm before leaving for the full setup. All six answers live in this
  // component's state and unmounting throws them away — "instead" would
  // promise a swap and deliver a restart, so the restart is named first.
  // Visual state only; it reaches neither the network nor storage.
  const [confirmFull, setConfirmFull] = useState(false);

  // The age the server refuses under, read from GET /profile/meta — the same
  // source the full SetupWizard uses (limits.adultMinAge). Deliberately never
  // hardcoded here: the server owns the number, and a local copy is exactly
  // how the full wizard once drifted to a different age than the API it
  // writes to. If this fetch fails the gate simply arrives later — the
  // server's own 403 (handleError below) still refuses a minor at submit and
  // lands them back on the age screen — so the catch is silent on purpose.
  const [adultMinAge, setAdultMinAge] = useState(null);
  useEffect(() => {
    let alive = true;
    api.getProfileMeta()
      .then((m) => { if (alive) setAdultMinAge(m?.limits?.adultMinAge ?? null); })
      .catch(() => { /* server-side gate remains the enforcement */ });
    return () => { alive = false; };
  }, []);

  const [d, setD] = useState({
    unitPref: "imperial",
    sex: "M",
    age: "",
    heightFt: "", heightIn: "", heightCm: "",
    weight: "",
    goal: "",
    exclusions: [],
    custom: "",
    foodAnswer: null, // "some" | "none" — must be set to advance
  });
  const set = (patch) => setD((c) => ({ ...c, ...patch }));

  const metric = d.unitPref === "metric";
  const wUnit = weightUnit(d.unitPref);

  // Identical to SetupWizard.jsx:465-482. Values this surface does not ask for
  // are that file's own defaults (SetupWizard.jsx:246-262) — the same profile a
  // person gets by clicking through the full wizard without touching them.
  const buildPatch = () => ({
    unitPref: d.unitPref,
    sex: d.sex,
    age: +d.age,
    heightCm: metric ? parseHeight(+d.heightCm, "metric") : ftin2cm(d.heightFt, d.heightIn),
    bodyFatPct: 0,
    startWeightKg: parseWeight(+d.weight, d.unitPref),
    goalWeightKg: parseWeight(+d.goal, d.unitPref),
    occupationKey: "desk-office",
    sessionsPerWeek: 0,
    trainingStyle: "none",
    minutesPerSession: 0,
    dietaryStyle: null,
    excludedFoods: d.exclusions,
    mealsPerDay: 3,
    snacksPerDay: 1,
    rateLbPerWeek: 1.0,
  });

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRefusal(null);
    try {
      await api.putProfile({
        ...buildPatch(),
        ...(rateAck ? { rateAcknowledged: true } : {}),
        ...(goalAck ? { goalWeightAcknowledged: true } : {}),
      });

      // KEEP THE PROMISE. The button says "Show me what to eat", and without
      // this the person lands on an empty Today and has to press a second
      // button to get the thing they were just promised. Same call Today's
      // empty state makes.
      //
      // Deliberately non-fatal: the profile is already saved, so a solver
      // failure must not strand someone at the end of setup. They fall through
      // to Today's empty state, which offers the same button.
      try {
        await api.generatePlan({});
      } catch {
        /* fall through — Today's "Build my day" is the retry */
      }

      await onDone();
      return;
    } catch (e) {
      handleError(e);
      setBusy(false);
    }
  };

  // Every refusal lands the person on the screen that owns the input. An error
  // about age shown on the food screen is an error nobody can act on.
  const handleError = (e) => {
    const b = e.body || {};
    if (e.status === 403 && b.gate === "adult-only") {
      setRefusal({ kind: "age", text: b.error || "This app is for adults only." });
      setI(1);
      return;
    }
    if (e.status === 400 && b.gate === "goal-weight-floor") {
      setRefusal({ kind: "goal", text: b.error || "That goal weight is below what's safe for your height." });
      setI(4);
      return;
    }
    if (e.status === 422 && b.requiresAck) {
      if (b.ack === "goalWeight") {
        setRefusal({ kind: "goal-ack", text: b.error });
        setI(4);
        return;
      }
      setRefusal({
        kind: "rate-ack",
        text: "Losing a pound a week is fast for your size.",
        reasons: b.reasons,
      });
      setI(6);
      return;
    }
    if (b.fields && Object.keys(b.fields).length) {
      const [first] = Object.values(b.fields);
      setError(first);
      return;
    }
    setError(describeError(e));
  };

  const toggle = (term) =>
    setD((c) => ({
      ...c,
      exclusions: c.exclusions.some((x) => x.toLowerCase() === term.toLowerCase())
        ? c.exclusions.filter((x) => x.toLowerCase() !== term.toLowerCase())
        : [...c.exclusions, term],
      foodAnswer: "some",
    }));

  const addCustom = () => {
    const t = d.custom.trim();
    if (!t) return;
    setD((c) => ({
      ...c,
      exclusions: c.exclusions.some((x) => x.toLowerCase() === t.toLowerCase()) ? c.exclusions : [...c.exclusions, t],
      custom: "",
      foodAnswer: "some",
    }));
  };

  // Only the typed-in terms get a row of their own below the box. A chosen
  // built-in already shows its state (and its ×) on the chip you tapped —
  // repeating it a few centimetres down was the same answer twice. The
  // exclusions ARRAY is untouched: this filters what renders, not what is
  // sent.
  const typedTerms = d.exclusions.filter(
    (t) => !COMMON.some((c) => c.toLowerCase() === t.toLowerCase())
  );

  const heightOk = metric ? +d.heightCm > 0 : (+d.heightFt > 0 || +d.heightIn > 0);
  // A minor is stopped AT the age question, not after answering everything
  // including a goal weight. Gate only once the server's number has arrived —
  // guessing a minimum locally would be hardcoding the very thing
  // /profile/meta exists to serve.
  const isMinor = adultMinAge != null && +d.age > 0 && +d.age < adultMinAge;
  const ready = [
    !!d.sex,
    +d.age > 0,
    heightOk,
    +d.weight > 0,
    +d.goal > 0,
    d.foodAnswer === "none" || (d.foodAnswer === "some" && d.exclusions.length > 0),
    true,
  ];

  const next = () => { setRefusal(null); setError(null); setI((n) => n + 1); };
  const back = () => { setRefusal(null); setError(null); setI((n) => Math.max(0, n - 1)); };
  // The age screen's own Next. Refusing on the press rather than mid-typing
  // means "1" on the way to "19" is never treated as a child, without this
  // file growing its own touched/blur machinery. Same early-refusal idea as
  // SetupWizard's isMinor gate; the server stays the authority.
  const nextFromAge = () => {
    if (isMinor) {
      setRefusal({
        kind: "age",
        text: `Cut Protocol can't build an eating plan for someone under ${adultMinAge}. If you mistyped your age, correct it and carry on.`,
      });
      return;
    }
    next();
  };

  const footer = (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex items-center justify-between">
        {i > 0 ? <Quiet onClick={back}>Back</Quiet> : <span />}
        <Details onClick={() => setConfirmFull(true)} label="Ask me everything instead" />
      </div>
      {/* The support entry renders on every screen of the surface, never
          muted and never hidden — setup was the only stretch without it, and
          setup is where goal weight gets asked and refused. Same visual
          treatment as the shell's (SimpleApp.jsx). No doors exist before a
          profile does, so the only route from here is the full app. */}
      <button
        type="button"
        onClick={onShowFull}
        className="min-h-11 text-base text-foreground underline underline-offset-4 self-start"
      >
        Support and wellbeing resources
      </button>
    </div>
  );

  const wrap = (node) => (
    <Screen>
      <div className="flex flex-col gap-8">
        <Dots total={7} index={i} />
        {refusal && <Note>{refusal.text}</Note>}
        {error && <Note>{error}</Note>}
        {node}
        {footer}
      </div>
      {confirmFull && (
        <Sheet
          title="Ask me everything instead?"
          sub="You'll answer these questions again."
          onClose={() => setConfirmFull(false)}
        >
          <Big onClick={onShowFull}>Ask me everything</Big>
        </Sheet>
      )}
    </Screen>
  );

  if (i === 0) return wrap(
    <Ask title="Are you male or female?" hint="Your body uses energy differently either way — it changes how much you get to eat.">
      <Choice
        value={d.sex}
        onChange={(v) => set({ sex: v })}
        options={[{ value: "M", label: "Male" }, { value: "F", label: "Female" }]}
      />
      <Big onClick={next} disabled={!ready[0]}>Next</Big>
    </Ask>
  );

  if (i === 1) return wrap(
    <Ask title="How old are you?">
      <NumberBox value={d.age} onChange={(v) => set({ age: v })} unit="years" autoFocus onEnter={() => ready[1] && nextFromAge()} />
      <Big onClick={nextFromAge} disabled={!ready[1]}>Next</Big>
    </Ask>
  );

  if (i === 2) return wrap(
    <Ask title="How tall are you?">
      <div className="flex flex-col gap-4">
        {/* Unit choice lives here rather than on a screen of its own — it is a
            setting, not a question, and it changes the two screens after this
            one. It sits ABOVE the boxes it clears. Switching wipes the height
            boxes below and the weights typed after them, deliberately:
            reinterpreting a number typed as pounds as kilograms would be
            silent body-data corruption. The clearing is load-bearing — only
            its position and the label naming the consequence are display. */}
        <Quiet onClick={() => set({ unitPref: metric ? "imperial" : "metric", heightCm: "", heightFt: "", heightIn: "", weight: "", goal: "" })}>
          {metric ? "Use feet and pounds instead — this clears what you've typed" : "Use centimetres and kilograms instead — this clears what you've typed"}
        </Quiet>
        {metric ? (
          <NumberBox value={d.heightCm} onChange={(v) => set({ heightCm: v })} unit="cm" autoFocus onEnter={() => ready[2] && next()} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <NumberBox value={d.heightFt} onChange={(v) => set({ heightFt: v })} unit="ft" autoFocus />
            <NumberBox value={d.heightIn} onChange={(v) => set({ heightIn: v })} unit="in" onEnter={() => ready[2] && next()} />
          </div>
        )}
      </div>
      <Big onClick={next} disabled={!ready[2]}>Next</Big>
    </Ask>
  );

  if (i === 3) return wrap(
    <Ask title="What do you weigh right now?" hint="Roughly is fine. You can log it properly every morning later.">
      <NumberBox value={d.weight} onChange={(v) => set({ weight: v })} unit={wUnit} autoFocus onEnter={() => ready[3] && next()} />
      <Big onClick={next} disabled={!ready[3]}>Next</Big>
    </Ask>
  );

  if (i === 4) return wrap(
    <Ask title="What would you like to weigh?" hint="A number to aim at. It is not a deadline, and you can change it whenever.">
      <NumberBox value={d.goal} onChange={(v) => set({ goal: v })} unit={wUnit} autoFocus onEnter={() => ready[4] && next()} />
      {refusal?.kind === "goal-ack" && (
        <label className="flex items-start gap-3 text-base leading-relaxed">
          <input
            type="checkbox"
            checked={goalAck}
            onChange={(e) => setGoalAck(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>I understand, and I want to aim at this weight anyway.</span>
        </label>
      )}
      <Big onClick={next} disabled={!ready[4]}>Next</Big>
    </Ask>
  );

  if (i === 5) return wrap(
    <Ask
      title="Anything you can't eat?"
      hint="We use this to keep those foods out of every meal we suggest. There's no skip here — answer even if it's a no, because we'd rather not guess."
    >
      <div className="flex flex-col gap-5">
        {/* The real Pill from parts.jsx — this markup was a hand copy of it,
            class for class, and copies drift the next time Pill is restyled.
            A pressed chip shows a visible × so removal isn't invisible now
            that the duplicate list below only carries typed-in terms. `label`
            pins the accessible name to the term itself, so the name doesn't
            change when the × appears — aria-pressed already announces the
            state. */}
        <div className="flex flex-wrap gap-2">
          {COMMON.map((t) => {
            const on = d.exclusions.some((x) => x.toLowerCase() === t.toLowerCase());
            return (
              <Pill key={t} on={on} onClick={() => toggle(t)} label={t}>
                {on ? `${t} ×` : t}
              </Pill>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input
            value={d.custom}
            onChange={(e) => set({ custom: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
            placeholder="Something else — type it and press enter"
            className="flex-1 min-w-0 min-h-14 px-4 rounded-2xl border border-border bg-card text-base outline-none
                       focus:border-foreground transition-colors"
          />
          <Quiet onClick={addCustom}>Add</Quiet>
        </div>

        {typedTerms.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {typedTerms.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setD((c) => ({ ...c, exclusions: c.exclusions.filter((x) => x !== t) }))}
                className="min-h-11 px-4 rounded-2xl text-base bg-secondary border border-foreground text-foreground"
                aria-label={`Remove ${t}`}
              >
                {t} ×
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => set({ foodAnswer: "none", exclusions: [] })}
          aria-pressed={d.foodAnswer === "none"}
          className={`min-h-14 px-5 rounded-2xl text-base text-left border transition-colors ${
            d.foodAnswer === "none"
              ? "bg-secondary border-foreground text-foreground"
              : "bg-card border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          I have nothing I need to avoid.
        </button>
      </div>
      <Big onClick={next} disabled={!ready[5]}>Next</Big>
    </Ask>
  );

  // Review. Says out loud what was assumed rather than letting a person find
  // out later that the app decided something for them.
  return wrap(
    <Ask title="That's everything." hint="Here's what happens next: the app works out what you should eat each day, and shows you a day of food.">
      <div className="flex flex-col gap-5">
        <div className="rounded-2xl border border-border bg-card px-5 py-4 text-base leading-relaxed">
          <p className="text-muted-foreground">
            We assumed a desk job, no training sessions, three meals and a snack a day, and losing
            about a pound a week. All of that is editable — nothing here is locked in.
          </p>
        </div>

        {refusal?.kind === "rate-ack" && (
          <label className="flex items-start gap-3 text-base leading-relaxed">
            <input
              type="checkbox"
              checked={rateAck}
              onChange={(e) => setRateAck(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>I understand it's fast for my size, and I want to go ahead.</span>
          </label>
        )}

        <Big onClick={submit} disabled={busy || (refusal?.kind === "rate-ack" && !rateAck)}>
          {busy ? "Setting things up…" : "Show me what to eat"}
        </Big>
      </div>
    </Ask>
  );
}
