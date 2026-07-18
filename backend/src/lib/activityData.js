// Occupation → activity-multiplier table + training-style energy data.
// The multiplier covers occupational + baseline daily movement (NOT training —
// training is a separate additive kcal component, see bmrEngine.computeEnergy).
// Multipliers sit inside the standard 1.2–1.75 TDEE-factor range; grouping is
// coarse by design and every value is visible in the Engine tab's math.

const OCCUPATION_GROUPS = [
  { key: "sedentary", label: "Sedentary (~1.2)", },
  { key: "light", label: "Light / on feet part-time (~1.3)" },
  { key: "moderate", label: "Moderate / on feet all day (~1.42)" },
  { key: "heavy", label: "Heavy physical (~1.55)" },
  { key: "very-heavy", label: "Very heavy (~1.7)" },
];

const OCCUPATIONS = [
  // sedentary
  { key: "desk-office", label: "Desk / office work", multiplier: 1.2, group: "sedentary" },
  { key: "software-tech", label: "Software / IT / tech", multiplier: 1.2, group: "sedentary" },
  { key: "accounting-finance", label: "Accounting / finance / legal", multiplier: 1.2, group: "sedentary" },
  { key: "customer-support", label: "Call centre / customer support", multiplier: 1.2, group: "sedentary" },
  { key: "student", label: "Student", multiplier: 1.25, group: "sedentary" },
  { key: "driver-truck", label: "Driver — truck / long haul", multiplier: 1.25, group: "sedentary" },
  { key: "driver-rideshare", label: "Driver — taxi / rideshare", multiplier: 1.25, group: "sedentary" },
  { key: "unemployed-home", label: "At home / between jobs", multiplier: 1.2, group: "sedentary" },

  // light
  { key: "teacher", label: "Teacher / classroom", multiplier: 1.3, group: "light" },
  { key: "retail-sales", label: "Retail / sales floor", multiplier: 1.3, group: "light" },
  { key: "cashier", label: "Cashier", multiplier: 1.3, group: "light" },
  { key: "hairdresser", label: "Hairdresser / barber / esthetics", multiplier: 1.3, group: "light" },
  { key: "lab-technician", label: "Lab technician", multiplier: 1.3, group: "light" },
  { key: "pharmacist", label: "Pharmacist", multiplier: 1.3, group: "light" },
  { key: "reception-admin", label: "Reception / front desk", multiplier: 1.28, group: "light" },
  { key: "security-guard", label: "Security guard", multiplier: 1.3, group: "light" },
  { key: "driver-delivery", label: "Driver — delivery (loading/unloading)", multiplier: 1.35, group: "light" },

  // moderate
  { key: "nurse-healthcare", label: "Nursing / healthcare on-feet", multiplier: 1.45, group: "moderate" },
  { key: "server-bartender", label: "Server / bartender", multiplier: 1.42, group: "moderate" },
  { key: "warehouse", label: "Warehouse / order picking", multiplier: 1.45, group: "moderate" },
  { key: "mechanic", label: "Mechanic / auto tech", multiplier: 1.42, group: "moderate" },
  { key: "electrician", label: "Electrician", multiplier: 1.42, group: "moderate" },
  { key: "plumber-hvac", label: "Plumber / HVAC", multiplier: 1.45, group: "moderate" },
  { key: "carpenter-finish", label: "Carpenter — finish / cabinets", multiplier: 1.45, group: "moderate" },
  { key: "painter-decorator", label: "Painter / decorator", multiplier: 1.4, group: "moderate" },
  { key: "chef-kitchen", label: "Chef / kitchen staff", multiplier: 1.42, group: "moderate" },
  { key: "cleaner-janitorial", label: "Cleaning / janitorial", multiplier: 1.42, group: "moderate" },
  { key: "postal-courier", label: "Postal / courier on foot", multiplier: 1.45, group: "moderate" },
  { key: "personal-trainer", label: "Personal trainer / coach", multiplier: 1.45, group: "moderate" },
  { key: "trades-general", label: "Mixed trades / general labour", multiplier: 1.42, group: "moderate" },
  { key: "stocker-grocery", label: "Grocery / stock clerk", multiplier: 1.4, group: "moderate" },

  // heavy
  { key: "construction-labourer", label: "Construction labourer", multiplier: 1.55, group: "heavy" },
  { key: "formwork-concrete", label: "Formwork / concrete / framing", multiplier: 1.55, group: "heavy" },
  { key: "roofer-scaffolder", label: "Roofer / scaffolder", multiplier: 1.55, group: "heavy" },
  { key: "landscaper", label: "Landscaping / groundskeeping", multiplier: 1.5, group: "heavy" },
  { key: "farm-work", label: "Farm work — general", multiplier: 1.55, group: "heavy" },
  { key: "mover", label: "Moving / removals", multiplier: 1.55, group: "heavy" },
  { key: "welder-fabricator", label: "Welder / fabricator", multiplier: 1.5, group: "heavy" },
  { key: "firefighter", label: "Firefighter", multiplier: 1.5, group: "heavy" },

  // very heavy
  { key: "logging-forestry", label: "Logging / forestry", multiplier: 1.7, group: "very-heavy" },
  { key: "commercial-fishing", label: "Commercial fishing", multiplier: 1.7, group: "very-heavy" },
  { key: "mining", label: "Mining / underground", multiplier: 1.7, group: "very-heavy" },
  { key: "manual-harvest", label: "Manual harvest / heavy agriculture", multiplier: 1.7, group: "very-heavy" },
];

const OCCUPATION_BY_KEY = Object.fromEntries(OCCUPATIONS.map((o) => [o.key, o]));

// Training styles → METs for the additive training-energy component.
// kcal/min = MET × 3.5 × kg / 200 (standard ACSM formula), shown in Engine.
const TRAINING_STYLES = [
  { key: "weights", label: "Weights / resistance", met: 3.5 },
  { key: "mixed", label: "Mixed (weights + cardio)", met: 5 },
  { key: "sport", label: "Sport / team training", met: 6 },
  { key: "cardio", label: "Cardio / conditioning", met: 7 },
];
const TRAINING_BY_KEY = Object.fromEntries(TRAINING_STYLES.map((t) => [t.key, t]));

module.exports = { OCCUPATIONS, OCCUPATION_BY_KEY, OCCUPATION_GROUPS, TRAINING_STYLES, TRAINING_BY_KEY };
