const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  lookupUpc, extractPer100g, extractMicros, pickBrand, servingGrams, normalizeUpc, num,
} = require("../src/lib/openFoodFactsClient.js");

const realFetch = global.fetch;
let calls;

beforeEach(() => { calls = []; });
afterEach(() => { global.fetch = realFetch; });

function mockFetch(responder) {
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return responder(url, opts);
  };
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// ── normalizeUpc / num (pure helpers) ────────────────────────────────────

test("normalizeUpc strips whitespace and dashes", () => {
  assert.equal(normalizeUpc(" 073-762-806450 2 "), "0737628064502");
  assert.equal(normalizeUpc("737628064502"), "737628064502");
});

test("num() only accepts genuine finite non-negative numbers — junk becomes null", () => {
  assert.equal(num(12.5), 12.5);
  assert.equal(num("12.5"), 12.5);
  assert.equal(num("  7 "), 7);
  assert.equal(num(""), null, "empty string");
  assert.equal(num("<1"), null, "trace marker");
  assert.equal(num("traces"), null, "non-numeric junk");
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(NaN), null);
  assert.equal(num(Infinity), null);
  assert.equal(num(-5), null, "negative crowd data is treated as untrustworthy, not a real deficit");
  assert.equal(num({}), null, "object junk");
  assert.equal(num([1, 2]), null, "array junk");
});

// ── servingGrams ──────────────────────────────────────────────────────────

test("servingGrams prefers serving_quantity, falls back to parsing serving_size text", () => {
  assert.equal(servingGrams({ serving_quantity: 40 }), 40);
  assert.equal(servingGrams({ serving_size: "1 square (10 g)" }), 10);
  assert.equal(servingGrams({ serving_size: "80g" }), 80);
  assert.equal(servingGrams({ serving_size: "1 bar" }), null, "no parseable weight → null, never guessed");
  assert.equal(servingGrams({}), null);
});

// ── pickBrand ─────────────────────────────────────────────────────────────

test("pickBrand takes the first of a crowd-edited comma list", () => {
  assert.equal(pickBrand("Simply Asia, Thai Kitchen"), "Simply Asia");
  assert.equal(pickBrand("Nutella"), "Nutella");
  assert.equal(pickBrand(""), null);
  assert.equal(pickBrand(null), null);
  assert.equal(pickBrand(42), null, "non-string junk");
});

// ── extractPer100g: the ambiguity/junk-handling core ────────────────────

test("clean per-100g panel extracts directly", () => {
  const product = {
    nutriments: {
      "energy-kcal_100g": 385, "proteins_100g": 9.62, "fat_100g": 7.69,
      "carbohydrates_100g": 71.15, "fiber_100g": 1.9,
    },
  };
  const m = extractPer100g(product);
  assert.equal(m.kcal, 385);
  assert.equal(m.protein, 9.62);
  assert.equal(m.fat, 7.69);
  assert.equal(m.carb, 71.15);
  assert.equal(m.fiber, 1.9);
  assert.equal(Object.values(m.estimated).every((v) => v === false), true);
  assert.equal(m.notes.length, 0);
});

test("kcal falls back to kJ→kcal conversion when energy-kcal_100g is absent", () => {
  const product = {
    nutriments: {
      "energy_100g": 1672.8, "proteins_100g": 9.62, "fat_100g": 7.69, "carbohydrates_100g": 71.15,
    },
  };
  const m = extractPer100g(product);
  assert.ok(Math.abs(m.kcal - 400) < 1, `expected ~400 kcal from kJ conversion, got ${m.kcal}`);
});

test("per-serving-only panel is scaled to per-100g and flagged estimated", () => {
  const product = {
    serving_quantity: 40,
    nutriments: {
      "energy-kcal_serving": 186, "proteins_serving": 4, "fat_serving": 8, "carbohydrates_serving": 24,
    },
  };
  const m = extractPer100g(product);
  // 186/40*100 = 465
  assert.equal(m.kcal, 465);
  assert.equal(m.estimated.kcal, true, "kcal was derived from per-serving energy, not a direct per-100g figure");
  assert.ok(m.notes.some((n) => n.includes("kcal derived from per-serving")));
  assert.equal(m.protein, 10);
  assert.equal(m.estimated.protein, true);
  assert.ok(m.notes.some((n) => n.includes("protein derived from per-serving")));
});

test("per-serving data with no serving weight cannot be converted — stays null, honestly noted", () => {
  const product = {
    serving_size: "1 packet",
    nutriments: { "proteins_serving": 4 },
  };
  const m = extractPer100g(product);
  assert.equal(m.protein, null);
  assert.ok(m.notes.some((n) => n.includes("protein missing")));
});

test("missing nutrition panel: every field null, kcal noted, fiber not treated as a hard gap", () => {
  const m = extractPer100g({ nutriments: {} });
  assert.equal(m.kcal, null);
  assert.equal(m.protein, null);
  assert.equal(m.fat, null);
  assert.equal(m.carb, null);
  assert.equal(m.fiber, null);
  assert.ok(m.notes.some((n) => n.startsWith("kcal missing")));
  assert.ok(!m.notes.some((n) => n.startsWith("fiber missing")), "fiber gaps are not called out — it's optional data, defaulted like the Food schema does");
});

test("non-numeric junk in nutriment fields is dropped, not propagated as NaN/garbage", () => {
  const product = {
    nutriments: {
      "energy-kcal_100g": "~385", "proteins_100g": "<1", "fat_100g": "traces",
      "carbohydrates_100g": 71.15, "fiber_100g": "",
    },
  };
  const m = extractPer100g(product);
  assert.equal(m.kcal, null, "\"~385\" is not a clean number and Number('~385') is NaN");
  assert.equal(m.protein, null);
  assert.equal(m.fat, null);
  assert.equal(m.carb, 71.15);
  assert.equal(m.fiber, null);
});

// ── extractMicros: the Food.micros contract ───────────────────────────────
// Field values below are lifted from a real live lookup during this track's
// build (Mars bar, barcode 5000159407236) — OFF genuinely reports every
// mass nutrient in grams (unit:"g") regardless of the nutrient's natural
// scale, confirmed against that response.

test("extractMicros converts OFF's always-grams fields to each nutrient's canonical unit", () => {
  const product = {
    nutriments: {
      "calcium_100g": 0.158193, "calcium_unit": "g",       // -> mg
      "iron_100g": 0.001967, "iron_unit": "g",              // -> mg
      "selenium_100g": 0.000003767, "selenium_unit": "g",   // -> mcg
      "vitamin-a_100g": 0.000049383, "vitamin-a_unit": "g", // -> mcg
      "sodium_100g": 0.168, "sodium_unit": "g",             // -> mg
    },
  };
  const m = extractMicros(product);
  assert.equal(m.calcium, 158.193);
  assert.equal(m.iron, 1.967);
  assert.equal(m.selenium, 3.767);
  assert.equal(m.vitaminA, 49.383);
  assert.equal(m.sodium, 168);
});

test("extractMicros returns null (not {}) when the product has no usable micronutrient data", () => {
  assert.equal(extractMicros({ nutriments: {} }), null);
  assert.equal(extractMicros({ nutriments: { "proteins_100g": 5 } }), null, "macro fields aren't micros");
});

test("extractMicros omits a nutrient entirely rather than reporting 0 for an unreported one", () => {
  const m = extractMicros({ nutriments: { "calcium_100g": 0.1, "calcium_unit": "g" } });
  assert.equal(m.calcium, 100);
  assert.ok(!("iron" in m), "iron was never reported — a missing key, never a written 0");
});

test("extractMicros skips a field whose unit isn't the documented 'g' rather than risk a silent unit error", () => {
  const m = extractMicros({ nutriments: { "iron_100g": 5, "iron_unit": "mg" } });
  assert.equal(m, null, "iron_unit:'mg' contradicts the documented always-grams convention — omitted, not guessed");
});

test("extractMicros falls back to per-serving × known serving weight, same discipline as macros", () => {
  const m = extractMicros({ serving_quantity: 50, nutriments: { "iron_serving": 0.001, "iron_unit": "g" } });
  // 0.001g / 50g * 100 = 0.002g = 2mg
  assert.equal(m.iron, 2);
});

test("extractMicros drops non-numeric junk in a micronutrient field, same as macros", () => {
  const m = extractMicros({ nutriments: { "iron_100g": "traces", "iron_unit": "g", "zinc_100g": 0.002, "zinc_unit": "g" } });
  assert.ok(!("iron" in m));
  assert.equal(m.zinc, 2);
});

test("extractMicros never populates fiber (it lives on Food.fiber, not Food.micros)", () => {
  // fiber is intentionally absent from OFF_MICRO_KEY — this asserts the
  // outcome that guards, not the implementation detail.
  const m = extractMicros({ nutriments: { "fiber_100g": 5, "fiber_unit": "g", "iron_100g": 0.001, "iron_unit": "g" } });
  assert.ok(!("fiber" in m));
});

// ── lookupUpc: end-to-end against a mocked transport ─────────────────────

test("lookupUpc rejects non-barcode input before ever calling fetch", async () => {
  mockFetch(() => { throw new Error("should not be called"); });
  const r = await lookupUpc("not-a-barcode!");
  assert.equal(r.found, false);
  assert.match(r.reason, /doesn't look like a barcode/);
  assert.equal(calls.length, 0);
});

test("lookupUpc: product not found (status 0, HTTP 200)", async () => {
  mockFetch(() => jsonResponse({ status: 0, status_verbose: "no code or invalid code" }));
  const r = await lookupUpc("00000000000000");
  assert.equal(r.found, false);
  assert.equal(r.reason, "no code or invalid code");
});

test("lookupUpc: product not found is HONEST even over HTTP 404 — confirmed live OFF behavior, not a hard error", async () => {
  // Real OFF returns 404 (not 200) for a genuinely unknown barcode, but
  // still ships a normal {status:0} JSON body — must NOT be treated as a
  // transport failure, or the single most common real-world case (a
  // product OFF simply doesn't have) would surface as a scary error
  // instead of an honest "not found".
  mockFetch(() => jsonResponse({ code: "9999999999999", status: 0, status_verbose: "product not found" }, false, 404));
  const r = await lookupUpc("9999999999999");
  assert.equal(r.found, false);
  assert.equal(r.reason, "product not found");
});

test("lookupUpc: a non-JSON error response (rate-limit HTML, proxy error) throws — distinct from 'not found'", async () => {
  mockFetch(() => ({ ok: false, status: 429, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
  await assert.rejects(() => lookupUpc("737628064502"), /HTTP 429/);
});

test("lookupUpc: a JSON response with no recognizable status field throws rather than silently 'not found'", async () => {
  mockFetch(() => jsonResponse({ error: "internal" }, false, 500));
  await assert.rejects(() => lookupUpc("737628064502"), /HTTP 500/);
});

test("lookupUpc: happy path normalizes a full product", async () => {
  mockFetch((url) => {
    assert.match(String(url), /\/product\/737628064502\.json/);
    return jsonResponse({
      status: 1,
      product: {
        product_name: "Peanut Noodle Kit",
        brands: "Simply Asia, Thai Kitchen",
        nutrition_data_per: "100g",
        nutriments: {
          "energy-kcal_100g": 385, "proteins_100g": 9.62, "fat_100g": 7.69,
          "carbohydrates_100g": 71.15, "fiber_100g": 1.9,
          "iron_100g": 0.002, "iron_unit": "g",
        },
      },
    });
  });
  const r = await lookupUpc("737628064502");
  assert.equal(r.found, true);
  assert.equal(r.name, "Peanut Noodle Kit");
  assert.equal(r.brand, "Simply Asia");
  assert.equal(r.per100g.kcal, 385);
  assert.equal(r.incomplete, false);
  assert.equal(r.micros.iron, 2, "micros flow end-to-end through lookupUpc, per-100g, canonical unit");
});

test("lookupUpc: micros is null (not {}) end-to-end when the product has no micronutrient data", async () => {
  mockFetch(() => jsonResponse({
    status: 1,
    product: { product_name: "Plain thing", nutriments: { "energy-kcal_100g": 100, "proteins_100g": 5, "fat_100g": 2, "carbohydrates_100g": 15 } },
  }));
  const r = await lookupUpc("737628064502");
  assert.equal(r.micros, null);
});

test("lookupUpc: missing product_name falls back to generic_name, then an honest placeholder", async () => {
  mockFetch(() => jsonResponse({
    status: 1,
    product: { generic_name: "Chocolate spread", nutriments: {} },
  }));
  const r = await lookupUpc("3017620422003");
  assert.equal(r.name, "Chocolate spread");

  mockFetch(() => jsonResponse({ status: 1, product: { nutriments: {} } }));
  const r2 = await lookupUpc("3017620422003");
  assert.match(r2.name, /Unnamed product/);
});

test("lookupUpc: incomplete panel flagged, never silently zeroed", async () => {
  mockFetch(() => jsonResponse({
    status: 1,
    product: { product_name: "Mystery Bar", nutriments: { "energy-kcal_100g": 400 } },
  }));
  const r = await lookupUpc("012345678905");
  assert.equal(r.incomplete, true);
  assert.equal(r.per100g.protein, null);
  assert.equal(r.per100g.fat, null);
  assert.equal(r.per100g.carb, null);
});
