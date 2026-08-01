/**
 * lib.mjs — the fleet's instruments. REPORT ONLY: nothing here writes to product
 * code, config, schema or any path outside this run's home.
 *
 * Everything the fleet judges is re-derived HERE, from raw DB rows, with this
 * file's own arithmetic and its own allergen vocabulary. The app's own warnings,
 * `meta.diagnosis`, `inTolerance` flags and match percentages are RECORDED as
 * claims to be checked — never consulted as evidence. Law 10.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const REPO = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..');
export const BACKEND = path.join(REPO, 'backend');
export const HOME = import.meta.dirname;
export const RUN_ID = path.basename(HOME);

const require = createRequire(path.join(BACKEND, 'package.json'));

// dotenv from the backend's own .env, exactly as scripts/surgery/witness.js does,
// so DATABASE_URL resolves to the dev DB and nothing else.
try {
  require('dotenv').config({ path: path.join(BACKEND, '.env'), quiet: true });
} catch { /* optional */ }

export const { prisma } = require(path.join(BACKEND, 'src', 'lib', 'prisma.js'));
export const { hashPassword } = require(path.join(BACKEND, 'src', 'lib', 'auth.js'));

// ── raw-row helpers ─────────────────────────────────────────────────────────
const unbig = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
export const sql = async (q, ...params) => unbig(await prisma.$queryRawUnsafe(q, ...params));

/** Cumulative ledger state. The ONLY money authority in this campaign. */
export async function ledger() {
  const [r] = await sql('select count(*) rows, coalesce(sum(costUsd),0) cost from LlmUsage');
  const [n] = await sql('select id, createdAt from LlmUsage order by createdAt desc limit 1');
  return { rows: r.rows, cost: Number(r.cost), newestId: n?.id ?? null, newestAt: n?.createdAt ?? null };
}

// ── seeded RNG (mulberry32 over a sha256 of the seed string) ────────────────
export function seedFrom(str) {
  const h = crypto.createHash('sha256').update(str).digest();
  return h.readUInt32LE(0);
}
export function rng(seedInt) {
  let a = seedInt >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export function weighted(r, pairs) { // [[value, weight], ...]
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
}
export const intBetween = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
export const round1 = (n) => Math.round(n * 10) / 10;

// ── cookie jar (the app has NO bearer path; requireAuth reads the httpOnly
//    cookie `cutprotocol_session` only — see backend/src/lib/auth.js) ─────────
export class Jar {
  constructor() { this.m = new Map(); }
  absorb(res) {
    const lines = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [].concat(res.headers.get('set-cookie') || []);
    for (const line of lines) {
      if (!line) continue;
      const pair = String(line).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.m.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() { return Array.from(this.m, ([k, v]) => `${k}=${v}`).join('; '); }
  has(k) { return this.m.has(k); }
}

export function client(base, jar) {
  return async function api(method, url, body, timeoutMs = 90000) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}${url}`, {
        method,
        headers: { 'content-type': 'application/json', ...(jar.has('cutprotocol_session') ? { cookie: jar.header() } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal,
      });
      jar.absorb(res);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* non-JSON body is itself a finding */ }
      return { status: res.status, json, text, ms: Date.now() - t0 };
    } catch (e) {
      return { status: 0, json: null, text: '', ms: Date.now() - t0, aborted: ac.signal.aborted, err: String(e && e.message) };
    } finally { clearTimeout(timer); }
  };
}

/**
 * Mint an account the witness.js way: Prisma-direct user row, then a REAL
 * POST /api/auth/login so the cookie is issued by exactly the code path a
 * person's cookie comes from. POST /api/auth/register is gated (403 on a
 * populated install — 13 users already exist), which is why the row is created
 * directly. Idempotent: an existing fleet row is logged into, not re-created.
 */
export async function mintAndLogin(api, email, password, passwordHash) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  let minted = false;
  if (!existing) {
    await prisma.user.create({ data: { email, passwordHash, role: 'user' } });
    minted = true;
  }
  const login = await api('POST', '/api/auth/login', { email, password });
  return { minted, ok: login.status === 200, status: login.status, body: login.text.slice(0, 300) };
}

// ══════════════════════════════════════════════════════════════════════════
// MY OWN ALLERGEN VOCABULARY
//
// Hand-authored here on purpose. backend/src/lib/allergenTaxonomy.js is the
// SUBJECT of this audit, so importing it would make the fleet grade the app
// with the app's own ruler. These lists are independent; where they disagree
// with the app, that disagreement is the finding.
//
// Two structural facts established in preflight and relied on below:
//   · Food.allergenTags and Food.mayContain are NULL on all 14,148 rows, so
//     there is no label-declaration data to check against. NAME matching over
//     raw Food.name is the only evidence available to anyone — app or auditor.
//   · A recipe's shipped composition lives in PlanSlot.ingredients (Json), and
//     that is read from the DB, never from the HTTP response.
//
// `deny` fires on word-boundary match. `guard` is checked FIRST and vetoes the
// row — these are the substring traps that turn an audit into noise (coconut is
// not a tree nut; "Ground Nutmeg" is not a groundnut; butter beans are not
// dairy). A guard hit means "this name does not carry this allergen", full stop.
// ══════════════════════════════════════════════════════════════════════════
export const WALLS = {
  gluten: {
    label: 'Gluten / celiac',
    deny: ['wheat', 'gluten', 'barley', 'rye', 'farro', 'spelt', 'kamut', 'einkorn', 'emmer', 'freekeh', 'semolina',
      'durum', 'couscous', 'bulgur', 'seitan', 'bread', 'breadcrumb', 'breadcrumbs', 'breaded', 'breading', 'panko',
      'pasta', 'spaghetti', 'macaroni', 'penne', 'fusilli', 'rigatoni', 'linguine', 'linguini', 'fettuccine',
      'tagliatelle', 'lasagna', 'lasagne', 'orzo', 'farfalle', 'rotini', 'ziti', 'noodle', 'noodles', 'ramen',
      'udon', 'tortilla', 'pita', 'naan', 'bagel', 'baguette', 'ciabatta', 'focaccia', 'croissant', 'muffin',
      'pastry', 'cracker', 'crackers', 'biscuit', 'cake', 'cookie', 'pretzel', 'flour', 'cereal', 'granola',
      'muesli', 'wrap', 'bun', 'roll', 'toast', 'crouton', 'croutons', 'pierogi', 'perogi', 'dumpling',
      'wonton', 'tempura', 'soy sauce', 'teriyaki', 'hoisin', 'malt', 'beer', 'stuffing', 'pancake', 'waffle',
      'pizza', 'phyllo', 'filo', 'puff pastry', 'gnocchi', 'couscous'],
    // rice/corn/buckwheat/quinoa flours and GF-labelled rows are not gluten
    guard: ['gluten free', 'gluten-free', 'rice flour', 'corn flour', 'cornflour', 'almond flour', 'coconut flour',
      'chickpea flour', 'buckwheat flour', 'tapioca flour', 'cassava flour', 'oat flour', 'rice noodle',
      'rice noodles', 'glass noodle', 'buckwheat noodle', 'soba', 'rice pasta', 'corn tortilla', 'rice cracker',
      'rice cake', 'buckwheat', 'quinoa flour', 'coconut wrap', 'lettuce wrap', 'egg roll wrapper',
      'tamari', 'coconut aminos', 'rice paper', 'rice krispie', 'corn bread', 'cornbread'],
  },
  soy: {
    label: 'Soy',
    deny: ['soy', 'soya', 'soybean', 'soybeans', 'tofu', 'tempeh', 'edamame', 'miso', 'natto', 'tamari',
      'shoyu', 'teriyaki', 'hoisin', 'ponzu', 'gochujang', 'doubanjiang', 'okara', 'yuba', 'bean curd',
      'textured vegetable protein', 'tvp', 'soy lecithin'],
    // Highly refined soybean oil is protein-free and is standardly permitted;
    // the app documents the same call. Kept out so the two agree on the reason.
    guard: ['soybean oil', 'soy oil', 'soybean vegetable oil'],
  },
  shellfish: {
    label: 'Shellfish',
    deny: ['shrimp', 'prawn', 'prawns', 'crab', 'lobster', 'crayfish', 'crawfish', 'langoustine', 'scampi',
      'clam', 'clams', 'mussel', 'mussels', 'oyster', 'oysters', 'scallop', 'scallops', 'squid', 'calamari',
      'octopus', 'cuttlefish', 'snail', 'escargot', 'abalone', 'whelk', 'periwinkle', 'krill', 'shellfish',
      'crustacean', 'mollusc', 'mollusk', 'surimi', 'crab stick', 'bisque', 'bouillabaisse'],
    // 'paella' REMOVED after verification. It fired on the ingredient row "Paella
    // Rice" — a short-grain rice variety — inside "Roast fennel and aubergine
    // paella", whose 15 ingredients are onion, salt, parsley, red pepper,
    // paprika, black pepper, lemon, white wine, courgettes, saffron, vegetable
    // stock, fennel, paella rice, frozen peas, baby aubergine. No shellfish. A
    // dish-style word is not an allergen on an INGREDIENT surface, and 3 of the
    // fleet's 35 raw hits were this one false positive.
    guard: ['paella rice'],
  },
  peanut: {
    label: 'Peanut',
    deny: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'arachis', 'monkey nut', 'peanut butter',
      'peanut oil', 'peanut flour', 'peanut sauce', 'satay'],
    guard: ['ground nutmeg', 'ground nut meg'],
  },
  'tree nut': {
    label: 'Tree nuts (walnut named)',
    deny: ['almond', 'almonds', 'walnut', 'walnuts', 'pecan', 'pecans', 'cashew', 'cashews', 'pistachio',
      'pistachios', 'hazelnut', 'hazelnuts', 'hazlenut', 'filbert', 'macadamia', 'brazil nut', 'pine nut',
      'pine nuts', 'pinenut', 'chestnut', 'praline', 'nutella', 'marzipan', 'frangipane', 'nougat',
      'baklava', 'pesto', 'tree nut', 'tree nuts', 'mixed nuts', 'nut butter', 'almond milk', 'almond flour',
      'almond butter', 'cashew butter', 'walnut oil', 'amaretto'],
    // Coconut is a drupe, not a tree nut, in both allergist practice and this
    // corpus; nutmeg is a seed; peanut is a legume with its own wall.
    guard: ['coconut', 'nutmeg', 'peanut', 'water chestnut', 'butternut', 'nutritional yeast', 'donut',
      'doughnut', 'nutrition'],
  },
  dairy: {
    label: 'Dairy',
    deny: ['milk', 'cream', 'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'parmigiano', 'feta',
      'ricotta', 'gouda', 'brie', 'camembert', 'gruyere', 'havarti', 'provolone', 'swiss cheese', 'halloumi',
      'paneer', 'mascarpone', 'quark', 'yogurt', 'yoghurt', 'kefir', 'ghee', 'whey', 'casein', 'custard',
      'buttermilk', 'creme fraiche', 'sour cream', 'ice cream', 'condensed milk', 'evaporated milk',
      'skyr', 'tzatziki', 'alfredo', 'bechamel', 'queso', 'cotija', 'burrata', 'curd', 'lactose'],
    // Every plant analogue, and the two compound names that are not dairy.
    guard: ['almond milk', 'soy milk', 'soya milk', 'oat milk', 'coconut milk', 'rice milk', 'cashew milk',
      'hemp milk', 'pea milk', 'plant milk', 'plant-based milk', 'non-dairy', 'nondairy', 'dairy free',
      'dairy-free', 'peanut butter', 'almond butter', 'cashew butter', 'nut butter', 'butter bean',
      'butter beans', 'butternut', 'apple butter', 'cocoa butter', 'shea butter', 'coconut cream',
      'coconut yogurt', 'soy yogurt', 'vegan cheese', 'nutritional yeast', 'coconut butter', 'sunflower butter',
      'milk thistle', 'coconut curd', 'bean curd', 'milkweed'],
  },
  egg: {
    label: 'Egg',
    deny: ['egg', 'eggs', 'egg white', 'egg whites', 'egg yolk', 'albumen', 'ovalbumin', 'mayonnaise',
      'mayo', 'aioli', 'meringue', 'frittata', 'omelet', 'omelette', 'quiche', 'custard', 'hollandaise',
      'tamagoyaki', 'pavlova', 'macaron', 'egg noodle', 'egg noodles', 'tartar sauce', 'remoulade'],
    guard: ['eggplant', 'egg plant', 'eggfruit', 'vegan mayo', 'eggless', 'egg-free', 'egg free',
      'egg substitute', 'egg replacer'],
  },
  fish: {
    label: 'Finned fish',
    deny: ['salmon', 'tuna', 'cod', 'haddock', 'halibut', 'tilapia', 'trout', 'bass', 'snapper', 'mackerel',
      'sardine', 'sardines', 'anchovy', 'anchovies', 'herring', 'pilchard', 'pilchards', 'pollock', 'pollack',
      'catfish', 'sole', 'flounder', 'plaice', 'mahi', 'swordfish', 'barramundi', 'grouper', 'perch', 'pike',
      'carp', 'eel', 'monkfish', 'hake', 'whiting', 'sablefish', 'lingcod', 'roughy', 'sturgeon', 'shad',
      'kingfish', 'bonito', 'skipjack', 'fish', 'fish sauce', 'worcestershire', 'lox', 'gravlax', 'caviar',
      'roe', 'bottarga', 'surimi', 'kipper', 'whitefish', 'seabass', 'sea bass'],
    guard: ['shellfish', 'fish free', 'fish-free', 'cuttlefish', 'crayfish', 'crawfish', 'jellyfish',
      'starfish', 'fishtail'],
  },
  sesame: {
    label: 'Sesame',
    deny: ['sesame', 'tahini', 'benne', 'gingelly', 'halva', 'halvah', 'zaatar', "za'atar", 'gomashio',
      'sesame oil', 'sesame seed', 'sesame seeds', 'hummus', 'houmous', 'simsim', 'furikake', 'goma'],
    guard: ['sesame free', 'sesame-free'],
  },
  nightshade: {
    label: 'Nightshades (skin condition)',
    deny: ['tomato', 'tomatoes', 'tomatillo', 'potato', 'potatoes', 'eggplant', 'aubergine', 'bell pepper',
      'capsicum', 'chili', 'chilli', 'chile', 'jalapeno', 'jalapeño', 'serrano', 'poblano', 'habanero',
      'chipotle', 'ancho', 'cayenne', 'paprika', 'pimento', 'pimiento', 'ketchup', 'marinara', 'salsa',
      'goji', 'wolfberry', 'nightshade', 'nightshades', 'passata', 'tomato paste', 'sun-dried tomato'],
    // Sweet potato is Convolvulaceae; black/white pepper is Piper nigrum.
    guard: ['sweet potato', 'sweet potatoes', 'yam', 'black pepper', 'white pepper', 'peppercorn',
      'peppercorns', 'pepper jack', 'lemon pepper', 'szechuan pepper', 'sichuan pepper', 'pepper mill',
      'chili free', 'peppermint'],
  },
  cilantro: {
    label: 'Cilantro aversion',
    deny: ['cilantro', 'coriander leaf', 'coriander leaves', 'fresh coriander', 'chinese parsley'],
    // Coriander SEED is the spice and does not carry the aldehyde people taste
    // as soap; an aversion is to the leaf.
    guard: ['coriander seed', 'coriander seeds', 'ground coriander', 'coriander powder'],
  },
  pork: {
    label: 'No pork',
    deny: ['pork', 'bacon', 'ham', 'gammon', 'prosciutto', 'pancetta', 'chorizo', 'salami', 'pepperoni',
      'lard', 'pig', 'piglet', 'sow', 'hog', 'guanciale', 'speck', 'mortadella', 'capicola', 'coppa',
      'bratwurst', 'kielbasa', 'andouille', 'liverwurst', 'headcheese', 'pork belly', 'pork loin',
      'pork chop', 'pulled pork', 'spare rib', 'spareribs', 'bak kwa', 'char siu', 'lardo'],
    guard: ['turkey bacon', 'beef bacon', 'chicken sausage', 'turkey sausage', 'beef salami',
      'turkey pepperoni', 'vegan bacon', 'porkless', 'pork free', 'porcini', 'porridge'],
  },
  beef: {
    label: 'No beef',
    deny: ['beef', 'steak', 'sirloin', 'ribeye', 'rib eye', 'brisket', 'chuck roast', 'oxtail', 'veal',
      'hamburger', 'ground beef', 'bison', 'buffalo meat', 'tallow', 'tri-tip', 'flank steak',
      'skirt steak', 't-bone', 'porterhouse', 'short rib', 'short ribs', 'pastrami', 'corned beef',
      'bresaola', 'wagyu', 'minced beef', 'beef mince'],
    guard: ['beefsteak tomato', 'beef free', 'buffalo sauce', 'buffalo wing', 'buffalo mozzarella',
      'beefy mushroom', 'plant-based beef', 'beefless'],
  },
};

/** Diet-style prohibitions, again my own list, for the same reason. */
export const DIET_RULES = {
  vegan: { deny: ['dairy', 'egg', 'fish', 'shellfish'], extraDeny: ['honey', 'gelatin', 'gelatine', 'lard', 'tallow', 'whey', 'casein'], meat: true },
  vegetarian: { deny: ['fish', 'shellfish'], extraDeny: ['gelatin', 'gelatine', 'lard', 'tallow', 'anchovy'], meat: true },
  // pescatarian is not in DIETARY_STYLES — recorded as a product gap, never faked
  halal: { deny: ['pork'], extraDeny: ['wine', 'beer', 'rum', 'vodka', 'brandy', 'bourbon', 'sherry', 'mirin', 'sake', 'gelatin', 'lard'], meat: false },
  kosher: { deny: ['pork', 'shellfish'], extraDeny: ['gelatin', 'lard'], meat: false },
};

const MEAT_TERMS = ['chicken', 'beef', 'pork', 'lamb', 'mutton', 'veal', 'turkey', 'duck', 'goose', 'bacon',
  'ham', 'sausage', 'steak', 'venison', 'bison', 'elk', 'moose', 'rabbit', 'goat meat', 'quail', 'pheasant',
  'liver', 'kidney', 'tripe', 'oxtail', 'brisket', 'sirloin', 'chorizo', 'salami', 'pepperoni', 'prosciutto',
  'jerky', 'meatball', 'mince', 'gelatin', 'gelatine', 'lard', 'tallow', 'suet', 'broth'];
const MEAT_GUARD = ['chicken of the woods', 'vegan chicken', 'plant-based', 'meatless', 'mock', 'vegetable broth',
  'veggie broth', 'mushroom broth', 'beefsteak tomato', 'chickpea', 'chick pea', 'buffalo sauce'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patCache = new Map();
function boundaryHit(haystack, term) {
  let re = patCache.get(term);
  if (!re) {
    // \b is wrong at a non-word edge (e.g. "za'atar"); anchor on non-letters.
    re = new RegExp(`(^|[^a-z])${esc(term)}([^a-z]|$)`, 'i');
    patCache.set(term, re);
  }
  return re.test(haystack);
}

/**
 * Does `name` carry `wallKey`? Guards are evaluated first and are absolute.
 * Returns the matched term, or null.
 */
export function nameCarries(name, wallKey) {
  const w = WALLS[wallKey];
  if (!w) return null;
  const n = ` ${String(name || '').toLowerCase()} `;
  for (const g of w.guard) if (n.includes(g)) return null;
  for (const d of w.deny) if (boundaryHit(n, d)) return d;
  return null;
}

export function nameCarriesMeat(name) {
  const n = ` ${String(name || '').toLowerCase()} `;
  for (const g of MEAT_GUARD) if (n.includes(g)) return null;
  for (const t of MEAT_TERMS) if (boundaryHit(n, t)) return t;
  return null;
}

export function nameCarriesTerm(name, term) {
  const n = ` ${String(name || '').toLowerCase()} `;
  const t = String(term || '').toLowerCase().trim();
  if (!t) return null;
  return boundaryHit(n, t) ? t : null;
}

/**
 * Independent transitive safety audit of ONE persona's shipped plan.
 *
 * Reads PlanSlot rows straight out of SQLite (never the HTTP body), resolves
 * every ingredient foodId to its raw Food.name, and tests each name — plus the
 * Recipe name, because a dish name can carry an allergen its ingredient list
 * does not spell out — against this persona's walls and diet style.
 */
export async function auditPlanSafety(userId, persona, sinceIso) {
  const slots = await sql(
    `select ps.id slotId, ps.dayOfWeek, ps.slotType, ps.slotIndex, ps.recipeId,
            ps.ingredients, ps.kcal, ps.protein, ps.fat, ps.carb, ps.warning,
            r.name recipeName, p.startDate
       from PlanSlot ps
       join Plan p on p.id = ps.planId
       left join Recipe r on r.id = ps.recipeId
      where p.userId = ? and ps.recipeId is not null
      order by p.startDate, ps.dayOfWeek, ps.slotType, ps.slotIndex`, userId);

  const foodIds = new Set();
  for (const s of slots) {
    // $queryRaw hands a SQLite Json column back ALREADY DESERIALISED (verified in
    // preflight: typeof object, Array.isArray true), so a blind JSON.parse throws
    // and silently yields an empty ingredient list — which reads as "0 kcal, no
    // leaks" and would have made the whole fleet report a clean bill of health on
    // no evidence at all. Accept both shapes.
    let ings = s.ingredients;
    if (typeof ings === 'string') { try { ings = JSON.parse(ings || '[]'); } catch { ings = null; } }
    s._ings = Array.isArray(ings) ? ings : [];
    if (!Array.isArray(ings)) s._ingParseFailed = true;
    for (const i of s._ings) if (i && i.foodId) foodIds.add(i.foodId);
  }
  const foods = new Map();
  const ids = [...foodIds];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await sql(
      `select id, name, kcal, protein, fat, carb, fiber from Food where id in (${chunk.map(() => '?').join(',')})`,
      ...chunk);
    for (const f of rows) foods.set(f.id, f);
  }

  const walls = persona.walls || [];
  const diet = persona.dietaryStyle && DIET_RULES[persona.dietaryStyle] ? DIET_RULES[persona.dietaryStyle] : null;
  const freeTerms = persona.freeTextExclusions || [];

  // TWO SURFACES, TWO VERDICTS — and they are not interchangeable.
  //
  // `leaks` is the safety verdict and is drawn ONLY from resolved raw Food rows:
  // the actual physical ingredients of the actual shipped slot. That is the only
  // surface on which "this customer was served the thing that hurts them" can be
  // asserted.
  //
  // `nameFlags` holds DISH-NAME hits, kept strictly separate because the first
  // smoke run showed exactly why: a gluten wall "matched" `Turkey & Swiss
  // Roll-Ups` on "roll" and `Matambre a la Pizza` on "pizza" — an Argentine
  // stuffed flank steak. Neither is evidence of gluten. Counting those as leaks
  // would have manufactured a P0 out of an English pun. They are reported as an
  // advisory: a name a walled customer would flinch at, which is a real UX cost
  // and not a safety breach.
  const leaks = [];
  const nameFlags = [];
  const unresolved = [];

  const test = (surf, sink) => {
    for (const wall of walls) {
      const hit = nameCarries(surf.name, wall);
      if (hit) sink.push({ kind: 'wall', wall, term: hit, surface: surf.kind, name: surf.name, foodId: surf.foodId ?? null, grams: surf.grams ?? null, slotId: surf.slotId, day: surf.day, slot: surf.slot, recipe: surf.recipe, startDate: surf.startDate });
    }
    if (diet) {
      for (const wall of diet.deny) {
        const hit = nameCarries(surf.name, wall);
        if (hit) sink.push({ kind: 'diet', diet: persona.dietaryStyle, wall, term: hit, surface: surf.kind, name: surf.name, foodId: surf.foodId ?? null, slotId: surf.slotId, day: surf.day, slot: surf.slot, recipe: surf.recipe });
      }
      for (const t of diet.extraDeny) {
        const hit = nameCarriesTerm(surf.name, t);
        if (hit) sink.push({ kind: 'diet-extra', diet: persona.dietaryStyle, term: hit, surface: surf.kind, name: surf.name, foodId: surf.foodId ?? null, slotId: surf.slotId, day: surf.day, slot: surf.slot, recipe: surf.recipe });
      }
      if (diet.meat) {
        const hit = nameCarriesMeat(surf.name);
        if (hit) sink.push({ kind: 'diet-meat', diet: persona.dietaryStyle, term: hit, surface: surf.kind, name: surf.name, foodId: surf.foodId ?? null, slotId: surf.slotId, day: surf.day, slot: surf.slot, recipe: surf.recipe });
      }
    }
    for (const t of freeTerms) {
      const hit = nameCarriesTerm(surf.name, t);
      if (hit) sink.push({ kind: 'free-text', term: hit, surface: surf.kind, name: surf.name, foodId: surf.foodId ?? null, slotId: surf.slotId, day: surf.day, slot: surf.slot, recipe: surf.recipe });
    }
  };

  for (const s of slots) {
    const at = { slotId: s.slotId, day: s.dayOfWeek, slot: `${s.slotType}#${s.slotIndex}`, recipe: s.recipeName, startDate: s.startDate };
    test({ kind: 'recipe-name', name: s.recipeName || '', ...at }, nameFlags);
    for (const ing of s._ings) {
      const f = ing.foodId ? foods.get(ing.foodId) : null;
      if (ing.foodId && !f) unresolved.push({ slotId: s.slotId, foodId: ing.foodId, name: ing.name });
      // The raw Food.name is authoritative; the name cached in the slot Json is a
      // copy and is only a fallback when the row itself has gone missing.
      test({ kind: 'ingredient', name: (f && f.name) || ing.name || '', foodId: ing.foodId, grams: ing.grams, ...at }, leaks);
    }
  }
  return { slots, foods, leaks, nameFlags, unresolved, slotCount: slots.length };
}

/**
 * Recompute each day's macro totals from the raw Food rows and the stored grams
 * — NOT from PlanSlot.kcal, which is the app's own claim about itself.
 */
export function recomputeDays(slots, foods) {
  const byDay = new Map();
  for (const s of slots) {
    const key = `${s.startDate}#${s.dayOfWeek}`;
    if (!byDay.has(key)) byDay.set(key, { key, startDate: s.startDate, dayOfWeek: s.dayOfWeek, kcal: 0, protein: 0, fat: 0, carb: 0, claimedKcal: 0, claimedProtein: 0, claimedFat: 0, claimedCarb: 0, slots: 0, warned: 0, missingFood: 0 });
    const d = byDay.get(key);
    d.slots++;
    if (s.warning) d.warned++;
    d.claimedKcal += s.kcal || 0; d.claimedProtein += s.protein || 0;
    d.claimedFat += s.fat || 0; d.claimedCarb += s.carb || 0;
    for (const ing of s._ings) {
      const f = ing.foodId ? foods.get(ing.foodId) : null;
      if (!f) { d.missingFood++; continue; }
      const factor = (Number(ing.grams) || 0) / 100;
      d.kcal += (f.kcal || 0) * factor;
      d.protein += (f.protein || 0) * factor;
      d.fat += (f.fat || 0) * factor;
      d.carb += (f.carb || 0) * factor;
    }
  }
  return [...byDay.values()];
}

/**
 * The app's own day-tolerance rule, RE-IMPLEMENTED here so the fleet can apply
 * it to its own recomputed totals. Transcribed from the rule's stated terms in
 * backend/src/lib/mealSolver.js (kcal +/-15%; protein <=15% short of the band
 * midpoint; fat/carb no further than 25% of the band midpoint outside the band,
 * with NO upward carb allowance on a keto target). Judging the app by a rule it
 * did not set would be unfair; judging it by its own rule, applied to numbers it
 * did not supply, is the point.
 */
export const TOL = { kcal: 0.15, protein: 0.15, fat: 0.25, carb: 0.25 };
function bandMiss(v, lo, hi) {
  const mid = (lo + hi) / 2;
  if (!(mid > 0)) return { shortPct: 0, overPct: 0, mid };
  const val = Number.isFinite(v) ? v : 0;
  if (val < lo) return { shortPct: (lo - val) / mid, overPct: 0, mid };
  if (val > hi) return { shortPct: 0, overPct: (val - hi) / mid, mid };
  return { shortPct: 0, overPct: 0, mid };
}
const hasBand = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;

export function judgeDay(target, totals) {
  const pMid = (target.proteinLo + target.proteinHi) / 2;
  const kcalDeltaPct = target.kcal > 0 ? (totals.kcal - target.kcal) / target.kcal : 1;
  const proteinShortPct = pMid > 0 ? Math.max(0, (pMid - totals.protein) / pMid) : 0;
  const fatJudged = hasBand(target.fatLo, target.fatHi);
  const carbJudged = hasBand(target.carbLo, target.carbHi);
  const fat = fatJudged ? bandMiss(totals.fat, target.fatLo, target.fatHi) : { shortPct: 0, overPct: 0 };
  const carb = carbJudged ? bandMiss(totals.carb, target.carbLo, target.carbHi) : { shortPct: 0, overPct: 0 };
  const carbOverAllowance = target.keto ? 0 : TOL.carb;
  const kcalOk = Math.abs(kcalDeltaPct) <= TOL.kcal;
  const proteinOk = proteinShortPct <= TOL.protein;
  const fatOk = !fatJudged || (fat.shortPct <= TOL.fat && fat.overPct <= TOL.fat);
  const carbOk = !carbJudged || (carb.shortPct <= TOL.carb && carb.overPct <= carbOverAllowance);
  return {
    inTolerance: kcalOk && proteinOk && fatOk && carbOk,
    kcalOk, proteinOk, fatOk, carbOk,
    kcalDeltaPct, proteinShortPct,
    fatShortPct: fat.shortPct, fatOverPct: fat.overPct,
    carbShortPct: carb.shortPct, carbOverPct: carb.overPct,
    kcalDelta: totals.kcal - target.kcal,
    proteinDelta: totals.protein - pMid,
    proteinMid: pMid,
  };
}

// ── plumbing ────────────────────────────────────────────────────────────────
export const appendLine = (file, obj) =>
  fs.appendFileSync(path.join(HOME, file), `${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`);
export const writeJson = (file, obj) =>
  fs.writeFileSync(path.join(HOME, file), `${JSON.stringify(obj, null, 2)}\n`);
export const readJson = (file, fallback = null) => {
  const p = path.join(HOME, file);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};
export const readLines = (file) => {
  const p = path.join(HOME, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bounded-concurrency map that never lets one persona's throw kill the fleet. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { error: String((e && e.stack) || e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}
