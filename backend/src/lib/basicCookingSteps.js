// generateBasicSteps(solvedResult)
// Zero-latency, template-generated cooking-steps fallback (no AI round-trip).
// Pure function: no DOM, no network, no randomness. Same input -> same output.
// Ported verbatim from recomp-v1/_parts/cooking-guide.js (recomp-v1 is being
// deleted after this; this was the one standalone, self-contained piece of
// it worth keeping - a real "how do I cook this" answer available even when
// the AI recipe-drafting endpoint (routes/recipes.js's generate-drafts) is
// unavailable/rate-limited/down, or for any future manually-added food that
// ends up with no steps at all.
//
// Input shape: { items: [{ name, grams, category }] } — category one of
// "protein"|"carb"|"veg"|any-other (fat/dairy/fruit/other all batch into a
// single portioning line). Not currently wired into any route — available
// for a future caller to reach for, not auto-invoked anywhere yet.

function generateBasicSteps(solvedResult) {
  var items = (solvedResult && solvedResult.items) || [];
  if (!items.length) return ["No items to prep."];

  // ---------- helpers ----------

  function shortName(name) {
    // "Chicken breast, cooked, skinless" -> "chicken breast"
    return String(name || "item").split(",")[0].trim().toLowerCase();
  }

  function gramsStr(grams) {
    return Math.round(grams) + "g";
  }

  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Cooking-method / ready-to-eat words baked into a food name imply it's
  // already prepared and just needs portioning, not a cooking step.
  var READY_WORDS = [
    "cooked", "baked", "boiled", "steamed", "roasted", "grilled", "fried",
    "sauteed", "sautéed", "broiled", "poached", "canned", "deli",
    "jerky", "rotisserie", "smoked", "cured", "hard-boiled",
    "pre-cooked", "precooked", "toasted"
  ];
  var RAW_WORDS = ["raw", "uncooked", "dry", "dried", "fresh"];

  // Word-boundary match so e.g. "uncooked" does NOT match the word "cooked"
  // (plain indexOf would find "cooked" as a substring of "uncooked").
  function hasWord(n, word) {
    return new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(n);
  }

  function needsCooking(name) {
    var n = name.toLowerCase();
    for (var i = 0; i < RAW_WORDS.length; i++) {
      if (hasWord(n, RAW_WORDS[i])) return true;
    }
    for (var j = 0; j < READY_WORDS.length; j++) {
      if (hasWord(n, READY_WORDS[j])) return false;
    }
    // No explicit signal — default to "needs prep" for protein/carb/veg,
    // since raw cuts/ingredients are the common case in food databases.
    return true;
  }

  function has(n, words) {
    for (var i = 0; i < words.length; i++) {
      if (hasWord(n, words[i])) return true;
    }
    return false;
  }

  // ---------- category handlers ----------

  function proteinStep(item) {
    var name = item.name, n = name.toLowerCase(), sn = shortName(name), g = gramsStr(item.grams);

    if (!needsCooking(name)) {
      return cap(sn) + " is ready to eat — portion out " + g + " and set aside.";
    }

    if (has(n, ["ground"])) {
      var groundLabel = sn.indexOf("ground") === -1 ? "ground " + sn : sn;
      return "Brown the " + groundLabel + " in a hot pan, breaking it up as it cooks, until no pink remains (~" + g + " raw).";
    }
    if (has(n, ["egg"])) {
      return "Scramble or fry the eggs over medium heat until set (" + g + ").";
    }
    if (has(n, ["salmon", "tuna", "fish", "cod", "tilapia", "halibut", "trout"])) {
      return "Pan-sear or bake the " + sn + " (" + g + ") until it just flakes, about 4-5 min per side.";
    }
    if (has(n, ["shrimp", "scallop", "prawn"])) {
      return "Sauté the " + sn + " (" + g + ") over high heat 2-3 min per side until opaque.";
    }
    if (has(n, ["chicken", "turkey", "duck"])) {
      return "Season and bake or pan-fry the " + sn + " (" + g + ") until internal temp hits 165°F.";
    }
    if (has(n, ["pork", "ham"])) {
      return "Pan-sear or bake the " + sn + " (" + g + ") to an internal temp of 145°F, then rest.";
    }
    if (has(n, ["steak", "flank", "sirloin", "ribeye", "strip", "loin", "chop", "tenderloin", "elk", "venison", "bison"])) {
      return "Sear the " + sn + " (" + g + ") over high heat to preferred doneness, then rest 5 minutes.";
    }
    if (has(n, ["tofu", "tempeh"])) {
      return "Press and pan-fry the " + sn + " (" + g + ") until golden on both sides.";
    }
    return "Cook the " + sn + " (" + g + ") through over medium-high heat until done.";
  }

  function carbStep(item) {
    var name = item.name, n = name.toLowerCase(), sn = shortName(name), g = gramsStr(item.grams);

    if (!needsCooking(name)) {
      return "Portion out " + g + " of already-cooked " + sn + ".";
    }

    if (has(n, ["rice", "quinoa", "couscous", "barley", "farro", "oat"])) {
      return "Simmer the " + sn + " in water per package ratio until tender, then portion " + g + " cooked.";
    }
    if (has(n, ["pasta", "noodle", "spaghetti", "macaroni"])) {
      return "Boil the " + sn + " in salted water until al dente, then drain (" + g + " cooked weight).";
    }
    if (has(n, ["potato"])) {
      return "Bake the " + sn + " at 400°F ~45 min, or boil chunks ~15 min until fork-tender (" + g + ").";
    }
    if (has(n, ["bread", "tortilla", "wrap", "bagel"])) {
      return "Toast the " + sn + " if desired, then portion out " + g + ".";
    }
    return "Cook the " + sn + " (" + g + ") according to package directions until tender.";
  }

  function vegStep(item) {
    var name = item.name, n = name.toLowerCase(), sn = shortName(name), g = gramsStr(item.grams);

    if (!needsCooking(name)) {
      return "Portion out " + g + " of prepped " + sn + ".";
    }

    if (has(n, ["cucumber", "tomato", "lettuce", "carrot"]) && has(n, ["raw", "fresh"])) {
      return "Slice the " + sn + " and serve raw (" + g + ").";
    }
    if (has(n, ["broccoli", "cauliflower", "asparagus", "green bean", "snap pea"])) {
      return "Steam the " + sn + " for 4-5 min until tender-crisp (" + g + ").";
    }
    if (has(n, ["pepper", "onion", "zucchini", "mushroom", "squash"])) {
      return "Sauté the " + sn + " in a hot pan for a few minutes until softened (" + g + ").";
    }
    if (has(n, ["carrot", "sweet potato", "beet"])) {
      return "Roast the " + sn + " at 425°F for 20-25 min until tender (" + g + ").";
    }
    if (has(n, ["spinach", "kale", "greens"])) {
      return "Quickly wilt the " + sn + " in a warm pan for 1-2 min, or serve raw (" + g + ").";
    }
    return "Steam or sauté the " + sn + " (" + g + ") for a few minutes until tender-crisp.";
  }

  function portionOnlyStep(item) {
    var name = item.name, n = name.toLowerCase(), sn = shortName(name), g = gramsStr(item.grams);

    if (has(n, ["oil", "butter", "ghee"])) {
      return "Drizzle or measure " + g + " of " + sn + " into the pan or over the dish.";
    }
    if (has(n, ["nut", "seed", "almond", "peanut", "cashew", "walnut"])) {
      return "Measure out " + g + " of " + sn + " and sprinkle on top.";
    }
    if (has(n, ["yogurt", "cottage cheese", "milk"])) {
      return "Scoop " + g + " of " + sn + " into a bowl.";
    }
    if (has(n, ["cheese"])) {
      return "Portion " + g + " of " + sn + " and add on top.";
    }
    if (has(n, ["berry", "berries", "apple", "banana", "fruit", "orange", "grape"])) {
      return "Wash and portion " + g + " of " + sn + " on the side.";
    }
    return "Portion out " + g + " of " + sn + ".";
  }

  // ---------- build steps ----------

  var mainSteps = []; // protein / carb / veg — get differentiated instructions
  var sideItems = []; // fat / dairy / fruit / other — batched into fewer lines
  var allShortNames = [];

  items.forEach(function (item) {
    allShortNames.push(shortName(item.name));
    switch (item.category) {
      case "protein":
        mainSteps.push(proteinStep(item));
        break;
      case "carb":
        mainSteps.push(carbStep(item));
        break;
      case "veg":
        mainSteps.push(vegStep(item));
        break;
      default:
        sideItems.push(item);
    }
  });

  var sideSteps = [];
  if (sideItems.length === 1) {
    sideSteps.push(portionOnlyStep(sideItems[0]));
  } else if (sideItems.length > 1) {
    // Combine simple portioning items into one line to keep total step count sane.
    var parts = sideItems.map(function (item) {
      return gramsStr(item.grams) + " " + shortName(item.name);
    });
    sideSteps.push("Portion out " + parts.join(", ") + " and set aside.");
  }

  var steps = mainSteps.concat(sideSteps);

  // Final plating/combine step.
  if (allShortNames.length > 1) {
    var last = allShortNames[allShortNames.length - 1];
    var rest = allShortNames.slice(0, -1);
    steps.push("Plate the " + rest.join(", ") + " and " + last + " together and serve.");
  } else {
    steps.push("Plate the " + allShortNames[0] + " and serve.");
  }

  // Safety cap: keep to 3-6 short steps as specified.
  if (steps.length > 6) {
    var plating = steps.pop();
    steps = steps.slice(0, 5);
    steps.push(plating);
  }

  return steps;
}

module.exports = { generateBasicSteps };
