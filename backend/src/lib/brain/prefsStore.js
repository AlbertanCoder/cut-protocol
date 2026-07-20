// prefsStore.js — Brain v3 Stage I. Persists the user's SOFT brain preferences
// ONLY. LAW 2 invariant, enforced HERE: EXCLUSIONS ARE NEVER STORED — allergy/
// diet exclusions always recompute from the authoritative Profile, so a stale
// stored copy can never leak a food. assertSoftOnly() fails CLOSED on any
// exclusion-like key (any casing/spacing); sanitizeSoft() then keeps only the
// known soft signals. A memory store backs tests keyless; prismaPrefsStore(db)
// is the live impl (requires the BrainPreference model — Stage I migration).

// Keys that look like exclusions/allergies, normalised (lowercased, separators
// stripped). Trying to store one is a HARD error, never a silent drop.
const EXCLUSION_KEYS = new Set([
  "excludedfoods", "excluded", "exclusions", "exclude",
  "dietarystyle", "diet", "diets",
  "allergy", "allergies", "allergen", "allergens",
  "avoid", "avoids", "cannoteat", "intolerance", "intolerances", "restrictions",
]);

// The ONLY keys ever persisted — soft nudges the brain may later WEIGH, never
// gate on. Anything outside this list is dropped by sanitizeSoft.
const SOFT_KEYS = ["likedRecipeIds", "dislikedRecipeIds", "cuisineNudge", "notes"];

const normKey = (k) => String(k).toLowerCase().replace(/[\s_-]/g, "");

function assertSoftOnly(prefs) {
  if (prefs == null) return;
  if (typeof prefs !== "object" || Array.isArray(prefs)) throw new Error("prefsStore: preferences must be a plain object");
  for (const k of Object.keys(prefs)) {
    if (EXCLUSION_KEYS.has(normKey(k))) {
      throw new Error(`prefsStore: refusing to persist exclusion-like key "${k}" — exclusions recompute from the Profile, never stored (LAW 2)`);
    }
  }
}

// Fail-closed sanitize: throw on an exclusion key, then keep only known soft keys.
function sanitizeSoft(prefs) {
  assertSoftOnly(prefs);
  const out = {};
  for (const k of SOFT_KEYS) if (prefs && k in prefs && prefs[k] != null) out[k] = prefs[k];
  return out;
}

// In-memory store (keyless) for tests and for a degrade path with no DB.
function memoryPrefsStore() {
  const map = new Map();
  return {
    async get(userId) { return map.has(userId) ? { ...map.get(userId) } : null; },
    async set(userId, prefs) { const soft = sanitizeSoft(prefs); map.set(userId, soft); return { ...soft }; },
    _map: map,
  };
}

// Live store. Kept out of index.js so the barrel stays Prisma-free — require it
// directly when wiring the route. Every write goes through sanitizeSoft first,
// so the DB physically cannot hold an exclusion.
function prismaPrefsStore(db) {
  return {
    async get(userId) {
      const row = await db.brainPreference.findUnique({ where: { userId } });
      return row ? row.data : null;
    },
    async set(userId, prefs) {
      const soft = sanitizeSoft(prefs);
      await db.brainPreference.upsert({ where: { userId }, create: { userId, data: soft }, update: { data: soft } });
      return soft;
    },
  };
}

module.exports = { assertSoftOnly, sanitizeSoft, memoryPrefsStore, prismaPrefsStore, EXCLUSION_KEYS, SOFT_KEYS };
