// W2-3 — query USDA FoodData Central for candidate plant foods.
// Loads USDA_API_KEY from backend/.env WITHOUT printing it. Read-only; no DB writes.
// Usage: node fdc.mjs "lupins" "nutritional yeast::Branded"
import fs from "node:fs";
import https from "node:https";

const ENV = fs.readFileSync(
  "C:/Users/<account>/Desktop/cut-protocol/backend/.env",
  "utf8",
);
const KEY = (ENV.match(/^USDA_API_KEY\s*=\s*(.+)$/m)?.[1] || "DEMO_KEY")
  .trim()
  .replace(/^["']|["']$/g, "");

function get(url) {
  return new Promise((res, rej) => {
    https
      .get(url, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            res(JSON.parse(d));
          } catch {
            rej(new Error(`${r.statusCode} ${d.slice(0, 200)}`));
          }
        });
      })
      .on("error", rej);
  });
}

const N = {
  1008: "kcal",
  1003: "protein",
  1004: "fat",
  1005: "carb",
  1079: "fiber",
  2000: "sugar",
  1093: "sodium",
};

function pick(food) {
  const out = {
    fdcId: food.fdcId,
    description: food.description,
    dataType: food.dataType,
    brand: food.brandOwner || food.brandName || null,
    category: food.foodCategory || food.foodCategoryLabel || null,
    servingSize: food.servingSize
      ? `${food.servingSize}${food.servingSizeUnit || ""}`
      : null,
    ingredients: food.ingredients ? food.ingredients.slice(0, 300) : null,
  };
  for (const n of food.foodNutrients || []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const name = (n.nutrientName ?? n.nutrient?.name ?? "").toLowerCase();
    const unit = (n.unitName ?? n.nutrient?.unitName ?? "").toLowerCase();
    const val = n.value ?? n.amount;
    if (val == null) continue;
    if (N[id]) {
      if (id === 1008 && unit !== "kcal") continue;
      out[N[id]] = val;
    } else if (id === undefined && name.includes("energy") && unit === "kcal") {
      out.kcal = val;
    }
  }
  return out;
}

const results = {};
for (const q of process.argv.slice(2)) {
  const [term, dt] = q.split("::");
  const dtParam = dt ? `&dataType=${encodeURIComponent(dt)}` : "";
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${KEY}&query=${encodeURIComponent(term)}${dtParam}&pageSize=12`;
  try {
    const j = await get(url);
    results[term] = (j.foods || []).map(pick);
  } catch (e) {
    results[term] = { error: String(e.message) };
  }
}
console.log(JSON.stringify(results, null, 1));
