// BMR formula provenance (Stage 3, v2). Kept out of bmrEngine.js so citation
// text never bloats the engine. Keyed by FORMULAS[].key. Static data — attached
// to each row's prov.citation for transparency (Law 3). The independence notes
// are honest: several estimators share a dataset or functional family, so the
// spread is dispersion, NOT a confidence interval.
const CITATIONS = {
  mifflin: { name: "Mifflin–St Jeor", year: 1990, journal: "Am J Clin Nutr" },
  oxford: { name: "Oxford (Henry)", year: 2005, journal: "Public Health Nutr", note: "Four adult age bands (18–30/30–60/60–70/>70)." },
  harris: { name: "Harris–Benedict (revised)", year: 1984, journal: "Am J Clin Nutr" },
  schofield: { name: "Schofield (WHO)", year: 1985, journal: "Hum Nutr Clin Nutr", note: "Published 18–60 bands only." },
  katch: { name: "Katch–McArdle", note: "LBM-based; needs body-fat%. Shares the LBM-linear family with Cunningham/Nelson." },
  cunningham: { name: "Cunningham", year: 1980, journal: "Am J Clin Nutr", note: "LBM-based; needs body-fat%. LBM-linear family." },
  whofao: { name: "FAO/WHO/UNU", year: 1985, journal: "WHO TRS 724", note: "Shares Schofield's underlying dataset — not independent." },
  owen: { name: "Owen", year: 1987, journal: "Am J Clin Nutr", note: "Weight-only; small sample." },
  livingston: { name: "Livingston–Kohlstadt", year: 2005, journal: "Obes Res", note: "Power-law over a wide BMI range." },
  nelson: { name: "Nelson", year: 1992, journal: "Am J Clin Nutr", note: "FFM/FM split; needs body-fat%. LBM-linear family." },
};

module.exports = { CITATIONS };
