// A1/rig/treatments/noop.mjs — the identity treatment.
//
// It exists for one purpose: to prove the rig's A/B path adds nothing. It goes
// through EVERY patch branch runRig.mjs supports (target, pool, mealConfig,
// filters, adjusters) with value-identical copies, so a non-zero delta against
// an untreated baseline means the RIG is broken, not the solver.
//
// It is also the template. A Phase-4 agent copies this file, renames it, and
// changes exactly one of the returned objects.

export const NAME = "noop";

export function applyTreatment({ target, pool, mealConfig, filters, adjusters }) {
  return {
    target: { ...target },
    pool: pool.slice(),
    mealConfig: { ...mealConfig },
    filters: { ...filters },
    adjusters: adjusters.slice(),
  };
}
