// Deterministic PRNG (mulberry32) for reproducible golden snapshots and any
// test that wants varied-but-fixed randomness instead of a constant stub like
// `() => 0.5`. Same seed -> the exact same sequence, on every machine, forever
// (integer ops only, no platform float drift). Returns a function
// `() => float in [0, 1)` with the same call signature the solver's `rng`
// parameter expects.
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { makeRng };
