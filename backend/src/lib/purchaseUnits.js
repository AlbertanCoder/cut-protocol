// Grams → practical shopping units ("3 large cucumbers", "2 packs (≈12
// sausages)", "2 cans"). Typical retail sizes, keyword-matched — first match
// wins, more specific entries first. Estimates by nature: the gram figure
// stays alongside as the ground truth (Phase 4 spec: practical units
// primary, grams secondary). Returns null when no rule matches — bulk dry
// goods (rice, flour) read better as grams + cups, so they have no rule.
const RULES = [
  // proteins
  { match: "chicken breast", each: 175, name: "breast" },
  { match: "chicken thigh", each: 120, name: "thigh" },
  { match: "sausage", each: 65, name: "sausage", pack: { size: 6, label: "pack" } },
  { match: "bacon", each: 450, name: "pack" },
  { match: "salmon", each: 150, name: "fillet" },
  { match: "cod", each: 150, name: "fillet" },
  { match: "trout", each: 150, name: "fillet" },
  { match: "tilapia", each: 130, name: "fillet" },
  { match: "tuna, light, canned", each: 120, name: "can" },
  { match: "canned tuna", each: 120, name: "can" },
  { match: "egg", each: 50, name: "egg", pack: { size: 12, label: "dozen" } },
  { match: "tofu", each: 350, name: "block" },
  { match: "tempeh", each: 240, name: "pack" },

  // canned & jarred
  { match: "black beans", each: 240, name: "can (drained)", pluralName: "cans (drained)" },
  { match: "kidney beans", each: 240, name: "can (drained)", pluralName: "cans (drained)" },
  { match: "chickpea", each: 240, name: "can (drained)", pluralName: "cans (drained)" },
  { match: "cannellini", each: 240, name: "can (drained)", pluralName: "cans (drained)" },
  { match: "butter beans", each: 240, name: "can (drained)", pluralName: "cans (drained)" },
  { match: "baked beans", each: 398, name: "can" },
  { match: "canned tomatoes", each: 400, name: "can" },
  { match: "chopped tomatoes", each: 400, name: "can" },
  { match: "tomato paste", each: 156, name: "small can" },
  { match: "passata", each: 680, name: "jar" },
  { match: "coconut milk", each: 400, name: "can" },
  { match: "coconut cream", each: 400, name: "can" },

  // dairy & fridge
  { match: "greek yogurt", each: 650, name: "tub" },
  { match: "yogurt", each: 650, name: "tub" },
  { match: "milk", each: 1000, name: "1 L carton" },
  { match: "cream", each: 473, name: "carton" },
  { match: "butter", each: 454, name: "block" },
  { match: "cheese", each: 250, name: "block" },
  { match: "broth", each: 900, name: "carton" },
  { match: "stock", each: 900, name: "carton" },

  // produce
  { match: "cucumber", each: 300, name: "large cucumber", pluralName: "large cucumbers" },
  { match: "bell pepper", each: 120, name: "pepper" },
  { match: "peppers, bell", each: 120, name: "pepper" },
  { match: "red pepper", each: 120, name: "pepper" },
  { match: "green pepper", each: 120, name: "pepper" },
  { match: "yellow pepper", each: 120, name: "pepper" },
  { match: "sweet potato", each: 200, name: "sweet potato", pluralName: "sweet potatoes" },
  { match: "potato", each: 170, name: "potato", pluralName: "potatoes" },
  { match: "onion", each: 150, name: "onion" },
  { match: "shallot", each: 40, name: "shallot" },
  { match: "tomato", each: 120, name: "tomato", pluralName: "tomatoes" },
  { match: "carrot", each: 60, name: "carrot" },
  { match: "zucchini", each: 200, name: "zucchini", pluralName: "zucchini" },
  { match: "courgette", each: 200, name: "courgette" },
  { match: "aubergine", each: 250, name: "aubergine" },
  { match: "eggplant", each: 250, name: "eggplant" },
  { match: "broccoli", each: 300, name: "head" },
  { match: "cauliflower", each: 500, name: "head" },
  { match: "cabbage", each: 900, name: "head" },
  { match: "lettuce", each: 300, name: "head" },
  { match: "spinach", each: 200, name: "bag" },
  { match: "kale", each: 200, name: "bunch" },
  { match: "mushroom", each: 227, name: "227 g pack", pluralName: "227 g packs" },
  { match: "garlic clove", each: 5, name: "clove" },
  { match: "garlic", each: 5, name: "clove", pack: { size: 10, label: "bulb" } },
  { match: "ginger", each: 30, name: "thumb-size piece" },
  { match: "avocado", each: 150, name: "avocado" },
  { match: "lemon", each: 85, name: "lemon" },
  { match: "lime", each: 65, name: "lime" },
  { match: "apple", each: 180, name: "apple" },
  { match: "banana", each: 120, name: "banana" },
  { match: "orange", each: 180, name: "orange" },
  { match: "celery", each: 450, name: "bunch" },
  { match: "leek", each: 200, name: "leek" },
  { match: "corn tortilla", each: 30, name: "tortilla", pack: { size: 10, label: "pack" } },
  { match: "tortilla", each: 60, name: "tortilla", pack: { size: 10, label: "pack" } },
  { match: "bread", each: 675, name: "loaf", pluralName: "loaves" },
  { match: "baguette", each: 250, name: "baguette" },
  { match: "pita", each: 60, name: "pita", pack: { size: 6, label: "pack" } },
  { match: "naan", each: 90, name: "naan", pack: { size: 4, label: "pack" } },
];

function matchRule(name) {
  const n = (name || "").toLowerCase();
  for (const rule of RULES) {
    if (n.includes(rule.match)) return rule;
  }
  return null;
}

const plural = (rule, count) => (count === 1 ? rule.name : rule.pluralName || rule.name + "s");

/**
 * grams → { display, approx } | null.
 * Shopping-rounded: ceil with 15% slack (needing 2.1 cucumbers means buy 2;
 * needing 2.4 means buy 3 — you can't purchase 0.4 of one).
 */
function toPurchaseUnits(name, grams) {
  const rule = matchRule(name);
  if (!rule || !Number.isFinite(grams) || grams <= 0) return null;
  const rawCount = grams / rule.each;
  const count = Math.max(1, Math.ceil(rawCount - 0.15));

  if (rule.pack && count >= rule.pack.size * 0.75) {
    const packs = Math.max(1, Math.ceil(rawCount / rule.pack.size - 0.1));
    return {
      display: `${packs} ${rule.pack.label}${packs === 1 ? "" : "s"} (≈${packs * rule.pack.size} ${plural(rule, 2)})`,
      approx: `${rule.each} g per ${rule.name}`,
    };
  }
  return {
    display: `${count} ${plural(rule, count)}`,
    approx: `≈${rule.each} g each`,
  };
}

module.exports = { toPurchaseUnits, RULES };
