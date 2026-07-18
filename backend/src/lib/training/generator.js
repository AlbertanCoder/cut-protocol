// v1 training-plan generator — Phase 8 scaffold.
//
// Pure functions: inputs → a plain plan object (no DB, no meal engine).
// The route layer persists the result. "v1-templates" means exactly what
// it says — this picks and adapts one of four sensible templates; it does
// not periodize, autoregulate, or personalize beyond the declared inputs.

const { TEMPLATES, EQUIPMENT, STYLES, EXPERIENCE } = require("./templates.js");

const GENERATOR_VERSION = "v1-templates";
const WEEKS = 4;

const STYLE_KEYS = STYLES.map((s) => s.key);
const EXPERIENCE_KEYS = EXPERIENCE.map((e) => e.key);
const EQUIPMENT_KEYS = EQUIPMENT.map((e) => e.key);

// ── input validation ─────────────────────────────────────────────────────

function validateInputs(raw) {
  const errors = [];
  const daysPerWeek = Number(raw?.daysPerWeek);
  const sessionLengthMin = Number(raw?.sessionLengthMin);
  if (!Number.isInteger(daysPerWeek) || daysPerWeek < 2 || daysPerWeek > 6) {
    errors.push("daysPerWeek must be a whole number from 2 to 6");
  }
  if (![30, 45, 60, 75, 90].includes(sessionLengthMin)) {
    errors.push("sessionLengthMin must be one of 30/45/60/75/90");
  }
  if (!STYLE_KEYS.includes(raw?.style)) errors.push(`style must be one of: ${STYLE_KEYS.join(", ")}`);
  if (!EXPERIENCE_KEYS.includes(raw?.experience)) errors.push(`experience must be one of: ${EXPERIENCE_KEYS.join(", ")}`);
  const equipment = Array.isArray(raw?.equipment) ? raw.equipment.filter((k) => EQUIPMENT_KEYS.includes(k)) : [];
  if (equipment.length === 0) errors.push("pick at least one equipment option");
  return { ok: errors.length === 0, errors, inputs: { daysPerWeek, sessionLengthMin, style: raw?.style, experience: raw?.experience, equipment } };
}

// ── template matching ────────────────────────────────────────────────────

// Conditioning style overrides the day-count split; otherwise days decide.
// >4 days: v1 tops out at 4 programmed sessions — the plan says so rather
// than inventing junk volume.
function pickTemplate({ style, daysPerWeek }) {
  if (style === "conditioning") return "conditioning-3day";
  if (daysPerWeek <= 2) return "fullbody-2day";
  if (daysPerWeek === 3) return "fullbody-3day";
  return "upper-lower-4day";
}

// ── equipment resolution ─────────────────────────────────────────────────

// Best available tier wins; "full-gym" implies barbell implies everything.
function resolveVariant(variants, equipment) {
  const has = (k) => equipment.includes(k) || equipment.includes("full-gym");
  if (has("barbell")) return variants.barbell;
  if (has("dumbbells")) return variants.dumbbells;
  if (has("bands")) return variants.bands;
  return variants.bodyweight;
}

// ── prescription tables ──────────────────────────────────────────────────

// Sets/reps/RPE by style, nudged by experience. Ranges are prescriptions
// (double progression: add load when the top of the range is clean).
function prescription(style, experience, role) {
  const beg = experience === "beginner";
  const adv = experience === "advanced";
  if (style === "strength") {
    return role === "main"
      ? { sets: beg ? 3 : adv ? 5 : 4, reps: "4-6", rpe: beg ? 7 : 8, restSec: 180 }
      : { sets: 3, reps: "6-8", rpe: beg ? 7 : 7.5, restSec: 120 };
  }
  if (style === "hypertrophy") {
    return role === "main"
      ? { sets: beg ? 3 : 4, reps: "8-12", rpe: beg ? 7 : 8, restSec: 120 }
      : { sets: 3, reps: "10-15", rpe: 8, restSec: 90 };
  }
  if (style === "conditioning") {
    // Circuits: rounds as sets, timed work, RPE deliberately null.
    return { sets: beg ? 3 : adv ? 5 : 4, reps: "40s work / 20s rest", rpe: null, restSec: 0 };
  }
  // general fitness
  return role === "main"
    ? { sets: 3, reps: "8-10", rpe: beg ? 6.5 : 7, restSec: 120 }
    : { sets: beg ? 2 : 3, reps: "10-12", rpe: 7, restSec: 90 };
}

// ── session-length trimming ──────────────────────────────────────────────

// Short sessions drop accessories (never mains), from the end of the list.
function exerciseCap(sessionLengthMin) {
  return { 30: 4, 45: 5, 60: 6, 75: 7, 90: 8 }[sessionLengthMin] ?? 6;
}

function trimSlots(slots, cap) {
  if (slots.length <= cap) return slots;
  const mains = slots.filter((s) => s.role === "main");
  const accessories = slots.filter((s) => s.role !== "main");
  const keepAccessories = Math.max(0, cap - mains.length);
  return [...mains, ...accessories.slice(0, keepAccessories)];
}

// ── week notes (honest v1 double-progression guidance, not periodization) ─

const WEEK_NOTES = [
  "Week 1 — find working weights. Every set should leave 2-3 clean reps in the tank.",
  "Week 2 — same movements. Add load anywhere last week's top-of-range was clean.",
  "Week 3 — keep pushing the same double progression. Log what you lift.",
  "Week 4 — if you feel beaten up, cut every exercise to 2 sets (deload); otherwise repeat week 3 and add where clean.",
];

// ── the generator ────────────────────────────────────────────────────────

function generatePlan(rawInputs) {
  const v = validateInputs(rawInputs);
  if (!v.ok) return { ok: false, errors: v.errors };
  const inputs = v.inputs;

  const templateKey = pickTemplate(inputs);
  const template = TEMPLATES[templateKey];
  const cap = exerciseCap(inputs.sessionLengthMin);

  const notes = [];
  if (inputs.daysPerWeek > template.sessions.length) {
    notes.push(
      `v1 programs ${template.sessions.length} sessions/week — on your other ${inputs.daysPerWeek - template.sessions.length} day(s), walk or do easy conditioning rather than adding junk volume.`
    );
  }
  // A 2-day week against the 3-session conditioning template simply takes
  // the first two sessions — handled by the min() below.
  const sessionsPerWeek = Math.min(inputs.daysPerWeek, template.sessions.length);

  const weeks = Array.from({ length: WEEKS }, (_, w) => ({
    weekNumber: w + 1,
    note: WEEK_NOTES[w],
    sessions: template.sessions.slice(0, sessionsPerWeek).map((session, dayIndex) => ({
      dayIndex,
      name: session.name,
      focus: session.focus,
      exercises: trimSlots(session.slots, cap).map((slot, order) => {
        const p = prescription(inputs.style, inputs.experience, template.conditioning ? "main" : slot.role);
        return {
          order,
          name: resolveVariant(slot.variants, inputs.equipment),
          sets: p.sets,
          reps: p.reps,
          rpe: p.rpe,
          restSec: p.restSec,
          notes: slot.notes || null,
        };
      }),
    })),
  }));

  return {
    ok: true,
    plan: {
      name: template.name,
      description: template.description,
      generator: GENERATOR_VERSION,
      templateKey,
      ...inputs,
      planNotes: notes,
      weeks,
    },
  };
}

module.exports = { generatePlan, validateInputs, pickTemplate, resolveVariant, prescription, trimSlots, exerciseCap, GENERATOR_VERSION, WEEKS };
