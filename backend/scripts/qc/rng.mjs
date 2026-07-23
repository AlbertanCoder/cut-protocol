// Seeded RNG for the QC gauntlet. mulberry32 — integer ops only, so the exact
// same seed reproduces the exact same sequence on every machine, forever. This
// is the reproducibility guarantee the gauntlet's ground rule #5 requires:
// every simulated user is a pure function of (base seed, run index), so any
// failure replays from its logged seed with one command.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A tiny sampler bound to one rng stream. Every draw advances the same stream,
// so a profile is fully determined by the seed it was created with.
export function sampler(rng) {
  const float = (lo, hi) => lo + (hi - lo) * rng();
  const int = (lo, hi) => Math.floor(float(lo, hi + 1)); // inclusive both ends
  const bool = (p = 0.5) => rng() < p;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const sample = (arr, k) => {
    // k distinct elements, order-stable-ish; used for allergy stacks
    const pool = [...arr];
    const out = [];
    for (let i = 0; i < k && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  };
  return { rng, float, int, bool, pick, sample };
}

// Derive an independent, deterministic child seed for run `i` from a base seed.
// Splitmix-style mix so adjacent run indices don't produce correlated streams.
export function childSeed(base, i) {
  let z = (base + i * 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}
