// v1 training templates — Phase 8 scaffold.
//
// These are deliberately TEMPLATES, not a programming engine: four sensible
// starting points matched to the user's inputs, with equipment-aware
// exercise variants. Every exercise slot lists a variant per equipment
// tier; the generator resolves one using what the user actually has.
// Nothing in this module touches the meal engine.

// Equipment keys the UI offers. "full-gym" implies every tier below it.
const EQUIPMENT = [
  { key: "full-gym", label: "Full gym" },
  { key: "barbell", label: "Barbell + plates" },
  { key: "dumbbells", label: "Dumbbells" },
  { key: "bands", label: "Resistance bands" },
  { key: "bodyweight", label: "Bodyweight only" },
];

const STYLES = [
  { key: "strength", label: "Strength" },
  { key: "hypertrophy", label: "Hypertrophy" },
  { key: "general", label: "General fitness" },
  { key: "conditioning", label: "Conditioning" },
];

const EXPERIENCE = [
  { key: "beginner", label: "Beginner (<1 yr consistent)" },
  { key: "intermediate", label: "Intermediate (1–3 yrs)" },
  { key: "advanced", label: "Advanced (3+ yrs)" },
];

// An exercise slot: role decides trim priority (mains survive short
// sessions, accessories go first), variants map equipment → movement name.
const ex = (role, variants, notes) => ({ role, variants, notes });

// Variant order matters nowhere — resolution picks by the user's best tier.
const V = (barbell, dumbbells, bands, bodyweight) => ({ barbell, dumbbells, bands, bodyweight });

const FULL_BODY_A = [
  ex("main", V("Back Squat", "Goblet Squat", "Banded Squat", "Tempo Squat (3s down)")),
  ex("main", V("Bench Press", "DB Bench Press", "Banded Push-up", "Push-up")),
  ex("main", V("Barbell Row", "One-arm DB Row", "Banded Row", "Inverted Row")),
  ex("accessory", V("Romanian Deadlift", "DB Romanian Deadlift", "Banded Good Morning", "Single-leg Hip Hinge")),
  ex("accessory", V("Overhead Press", "DB Shoulder Press", "Banded Overhead Press", "Pike Push-up")),
  ex("accessory", V("Barbell Curl", "DB Curl", "Banded Curl", "Chin-up (or negatives)")),
  ex("accessory", V("Plank", "Plank", "Plank", "Plank"), "Weighted if easy past 45s"),
];

const FULL_BODY_B = [
  ex("main", V("Deadlift", "DB Deadlift", "Banded Deadlift", "Glute Bridge March")),
  ex("main", V("Incline Bench Press", "Incline DB Press", "Banded Incline Push-up", "Feet-elevated Push-up")),
  ex("main", V("Lat Pulldown or Pull-up", "DB Pullover", "Banded Pulldown", "Pull-up (or negatives)")),
  ex("accessory", V("Walking Lunge (barbell)", "DB Walking Lunge", "Banded Lunge", "Walking Lunge")),
  ex("accessory", V("Lateral Raise (plates)", "DB Lateral Raise", "Banded Lateral Raise", "Wall Handstand Hold")),
  ex("accessory", V("Skullcrusher", "DB Skullcrusher", "Banded Pressdown", "Close-grip Push-up")),
  ex("accessory", V("Hanging Knee Raise", "Hanging Knee Raise", "Dead Bug", "Hanging Knee Raise")),
];

const FULL_BODY_C = [
  ex("main", V("Front Squat", "DB Front Squat", "Banded Squat (pause)", "Split Squat")),
  ex("main", V("Overhead Press", "DB Shoulder Press", "Banded Overhead Press", "Pike Push-up")),
  ex("main", V("Barbell Row (pause)", "Chest-supported DB Row", "Banded Row (pause)", "Inverted Row (pause)")),
  ex("accessory", V("Hip Thrust", "DB Hip Thrust", "Banded Hip Thrust", "Single-leg Glute Bridge")),
  ex("accessory", V("Dips (or bench dips)", "DB Floor Press", "Banded Chest Fly", "Dips (bench)")),
  ex("accessory", V("Face Pull (band ok)", "DB Rear-delt Fly", "Banded Face Pull", "Prone Y-T-W")),
  ex("accessory", V("Farmer Carry", "DB Farmer Carry", "Suitcase Carry (band-loaded)", "Hollow Hold")),
];

const UPPER_1 = [
  ex("main", V("Bench Press", "DB Bench Press", "Banded Push-up", "Push-up")),
  ex("main", V("Barbell Row", "One-arm DB Row", "Banded Row", "Inverted Row")),
  ex("accessory", V("Overhead Press", "DB Shoulder Press", "Banded Overhead Press", "Pike Push-up")),
  ex("accessory", V("Lat Pulldown or Pull-up", "DB Pullover", "Banded Pulldown", "Pull-up (or negatives)")),
  ex("accessory", V("Barbell Curl", "DB Curl", "Banded Curl", "Chin-up hold")),
  ex("accessory", V("Skullcrusher", "DB Skullcrusher", "Banded Pressdown", "Close-grip Push-up")),
];

const LOWER_1 = [
  ex("main", V("Back Squat", "Goblet Squat", "Banded Squat", "Tempo Squat (3s down)")),
  ex("main", V("Romanian Deadlift", "DB Romanian Deadlift", "Banded Good Morning", "Single-leg Hip Hinge")),
  ex("accessory", V("Walking Lunge (barbell)", "DB Walking Lunge", "Banded Lunge", "Walking Lunge")),
  ex("accessory", V("Leg Curl (or nordic)", "DB Leg Curl (floor)", "Banded Leg Curl", "Nordic Curl (assisted)")),
  ex("accessory", V("Standing Calf Raise", "DB Calf Raise", "Banded Calf Raise", "Single-leg Calf Raise")),
  ex("accessory", V("Plank", "Plank", "Plank", "Plank")),
];

const UPPER_2 = [
  ex("main", V("Overhead Press", "DB Shoulder Press", "Banded Overhead Press", "Pike Push-up")),
  ex("main", V("Weighted Pull-up (or pulldown)", "DB Pullover", "Banded Pulldown", "Pull-up (or negatives)")),
  ex("accessory", V("Incline Bench Press", "Incline DB Press", "Banded Incline Push-up", "Feet-elevated Push-up")),
  ex("accessory", V("Cable/Barbell Row (pause)", "Chest-supported DB Row", "Banded Row (pause)", "Inverted Row (pause)")),
  ex("accessory", V("Lateral Raise", "DB Lateral Raise", "Banded Lateral Raise", "Wall Handstand Hold")),
  ex("accessory", V("Face Pull", "DB Rear-delt Fly", "Banded Face Pull", "Prone Y-T-W")),
];

const LOWER_2 = [
  ex("main", V("Deadlift", "DB Deadlift", "Banded Deadlift", "Glute Bridge March")),
  ex("main", V("Front Squat", "DB Front Squat", "Banded Squat (pause)", "Split Squat")),
  ex("accessory", V("Hip Thrust", "DB Hip Thrust", "Banded Hip Thrust", "Single-leg Glute Bridge")),
  ex("accessory", V("Bulgarian Split Squat", "DB Bulgarian Split Squat", "Banded Split Squat", "Bulgarian Split Squat")),
  ex("accessory", V("Seated Calf Raise", "DB Seated Calf Raise", "Banded Calf Raise", "Single-leg Calf Raise")),
  ex("accessory", V("Hanging Knee Raise", "Hanging Knee Raise", "Dead Bug", "Hanging Knee Raise")),
];

// Conditioning sessions are circuits: time-based work, RPE isn't the dial.
const CONDITIONING_A = [
  ex("main", V("Kettlebell/Plate Swing", "DB Swing", "Banded Swing-through", "Jump Squat")),
  ex("main", V("Push-up", "Push-up", "Banded Push-up", "Push-up")),
  ex("main", V("Goblet Squat (light)", "Goblet Squat (light)", "Banded Squat", "Air Squat")),
  ex("accessory", V("Mountain Climber", "Mountain Climber", "Mountain Climber", "Mountain Climber")),
  ex("accessory", V("Row (machine) / Row", "Renegade Row", "Banded Row (fast)", "Burpee")),
  ex("accessory", V("Plank Shoulder Tap", "Plank Shoulder Tap", "Plank Shoulder Tap", "Plank Shoulder Tap")),
];

const CONDITIONING_B = [
  ex("main", V("Sled Push / Hill Walk", "DB Carry (fast pace)", "Banded Sprint-in-place", "Hill / Stair Walk")),
  ex("main", V("Thruster (light bar)", "DB Thruster", "Banded Thruster", "Squat-to-Press (no load)")),
  ex("main", V("Burpee", "Burpee", "Burpee", "Burpee")),
  ex("accessory", V("Jumping Jack", "Jumping Jack", "Jumping Jack", "Jumping Jack")),
  ex("accessory", V("Bike / Row intervals", "Shadowbox intervals", "Banded Punch-out", "High Knees")),
  ex("accessory", V("Hollow Hold", "Hollow Hold", "Hollow Hold", "Hollow Hold")),
];

// The four v1 templates. `match` documents intent; actual selection logic
// lives in generator.js so it can be unit-tested directly.
const TEMPLATES = {
  "fullbody-2day": {
    name: "2-Day Full Body",
    description: "Two full-body sessions — the minimum effective dose, every big pattern twice a week.",
    sessions: [
      { name: "Full Body A", focus: "squat + press + row", slots: FULL_BODY_A },
      { name: "Full Body B", focus: "hinge + incline + pull", slots: FULL_BODY_B },
    ],
  },
  "fullbody-3day": {
    name: "3-Day Full Body",
    description: "Three rotating full-body sessions — the classic beginner-to-intermediate engine.",
    sessions: [
      { name: "Full Body A", focus: "squat + press + row", slots: FULL_BODY_A },
      { name: "Full Body B", focus: "hinge + incline + pull", slots: FULL_BODY_B },
      { name: "Full Body C", focus: "front squat + overhead + carries", slots: FULL_BODY_C },
    ],
  },
  "upper-lower-4day": {
    name: "4-Day Upper / Lower",
    description: "Two upper and two lower sessions — more volume per muscle, still every pattern twice.",
    sessions: [
      { name: "Upper 1", focus: "horizontal push + pull", slots: UPPER_1 },
      { name: "Lower 1", focus: "squat-dominant", slots: LOWER_1 },
      { name: "Upper 2", focus: "vertical push + pull", slots: UPPER_2 },
      { name: "Lower 2", focus: "hinge-dominant", slots: LOWER_2 },
    ],
  },
  "conditioning-3day": {
    name: "3-Day Conditioning",
    description: "Timed circuits for work capacity — strength maintained, engine built.",
    conditioning: true,
    sessions: [
      { name: "Circuit A", focus: "full-body intervals", slots: CONDITIONING_A },
      { name: "Circuit B", focus: "carry + burpee engine", slots: CONDITIONING_B },
      { name: "Circuit A (repeat)", focus: "full-body intervals", slots: CONDITIONING_A },
    ],
  },
};

module.exports = { TEMPLATES, EQUIPMENT, STYLES, EXPERIENCE };
