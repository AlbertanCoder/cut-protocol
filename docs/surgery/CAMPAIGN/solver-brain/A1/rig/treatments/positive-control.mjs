// A1/rig/treatments/positive-control.mjs — INSTRUMENT SENSITIVITY CHECK ONLY.
//
// This is NOT a proposed mechanism and its result is NOT a finding about the
// solver. It exists to answer the question the no-op A/B cannot: a rig that
// reports zero for everything is exactly as broken as one that reports noise as
// signal. So this treatment deliberately degrades the input in a way that must
// move the number DOWN, and the rig has to see it.
//
// What it does: deterministically keeps 2 of every 3 recipes in the pool (a
// ~33% thinner pool). It does not touch tolerance bands, the exclusion gate, or
// any honesty path — those are the named cheats in BRIEF.md's integrity rules.
// Thinning the pool is a legitimate perturbation: it makes the solver's job
// harder using only inputs the product already varies by customer.

export const NAME = "positive-control-pool-thin-2of3";

export function applyTreatment({ pool }) {
  return { pool: pool.filter((_, i) => i % 3 !== 2) };
}
