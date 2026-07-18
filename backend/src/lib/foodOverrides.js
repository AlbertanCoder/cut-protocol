// Loader for backend/data/foodOverrides.json — curated value corrections and
// Atwater exemptions (alcohol, acetic acid, carbonates, botanicals). Keyed by
// lowercased name. Cached after first read; call reload() in tests if needed.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "data", "foodOverrides.json");
let cache = null;

function loadFoodOverrides() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  cache = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (name.startsWith("__")) continue;
    cache[name.trim().toLowerCase()] = entry;
  }
  return cache;
}

function reload() {
  cache = null;
  return loadFoodOverrides();
}

module.exports = { loadFoodOverrides, reload, OVERRIDES_FILE: FILE };
