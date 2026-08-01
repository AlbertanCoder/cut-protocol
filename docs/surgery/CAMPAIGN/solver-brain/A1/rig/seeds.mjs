// A1/rig/seeds.mjs — THE SEED REGISTRY for the SOLVER BRAIN study.
//
// Why this file exists: two agents comparing "70.1% vs 73.4%" are comparing
// nothing at all unless they drew the same population and the same solver RNG
// stream. Every A/B in this study uses a seed from this table, and every claim
// in CLAIMS.tsv cites it.
//
// A seed does TWO different jobs depending on the population:
//
//   pop=personas    the population is FIXED (the 250 rows of
//                   qa-fleet-20260729-2032/personas.jsonl, already materialised
//                   on disk). The seed drives ONLY the solver's RNG stream per
//                   persona: rng_i = mulberry32(childSeed(seed, persona.idx)).
//
//   pop=genprofile  the seed drives BOTH the population (genProfile(seed, i))
//                   and the solve RNG, exactly as backend/scripts/qc/mc.mjs
//                   does. Changing the seed changes WHO the customers are.
//
// The two populations are different denominators and must never appear in one
// table (BRIEF.md). personas is weighted + tiered and is the canonical one.

export const SEEDS = {
  // Headline seed. Every primary A/B in this study runs here first.
  primary: 424242,
  // Replicates — for run-to-run variance and for confirming a delta is not a
  // single-seed artefact. Run all three before believing any delta under ~3 pts.
  replicate: [20260730, 8675309],
  // Fast smoke (use with --n=25) while wiring up a treatment.
  smoke: 1337,
};

/** All three study seeds, primary first. */
export const ALL_SEEDS = [SEEDS.primary, ...SEEDS.replicate];

/** Human-readable name for a seed value, for report tables. */
export function seedName(seed) {
  if (seed === SEEDS.primary) return "primary";
  if (seed === SEEDS.smoke) return "smoke";
  const i = SEEDS.replicate.indexOf(seed);
  if (i >= 0) return `replicate-${i + 1}`;
  return "unregistered";
}

// The registry as a table, for pasting into a findings doc.
export const REGISTRY_TABLE = `
| name        | seed     | use                                                        |
|-------------|----------|------------------------------------------------------------|
| primary     | 424242   | every headline A/B; the number that goes in CLAIMS.tsv      |
| replicate-1 | 20260730 | variance / is-the-delta-real check                          |
| replicate-2 | 8675309  | variance / is-the-delta-real check                          |
| smoke       | 1337     | --n=25 wiring check only; NEVER a reported number           |
`.trim();
