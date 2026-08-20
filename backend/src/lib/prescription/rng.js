// prescription/rng.js — deterministic PRNG (mulberry32).
//
// Same algorithm as tests/helpers/seededRng.js, promoted to a lib because
// the preview route seeds by calendar day (same day → same preview) and
// routes must not import from tests/. Integer ops only — identical sequence
// on every machine.

"use strict";

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
