import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles, Pencil, Trash2, Save, X, Search, ShoppingCart, Check, Mail, ThumbsUp, ThumbsDown,
  MessageSquare, Copy, Database, EyeOff, ChevronRight, ChevronDown,
  Link2, AlertTriangle, CalendarPlus, Utensils,
} from "lucide-react";
import { C } from "../lib/theme.js";
import { trustReport } from "../lib/recipeTrust.js";
import { toHouseholdUnit } from "../lib/householdUnits.js";
import { Card, Btn, Chip, PageHead, ErrorNote, EmptyNote } from "./ui/Parts.jsx";
import { SkeletonRows } from "./ui/Skeleton.jsx";
import FoodTile from "./ui/FoodTile.jsx";
import { api, isAbortError, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const g1 = (n) => Math.round(n * 10) / 10;
// Inputs, selects and textareas wear --rule-strong: their border is the only
// thing that says where the control is, which is what WCAG 1.4.11 asks 3:1 of.
// --rule (1.17:1 over card) is for decorative separators, not control edges.
const getInpStyle = () => ({ background: "var(--secondary)", border: "1.5px solid var(--input)", color: "var(--foreground)" });
const CUISINES = ["", "mexican", "italian", "mediterranean", "asian", "indian", "middle-eastern", "british-irish", "western-comfort"];
const PROTEINS = ["", "chicken", "beef", "turkey", "salmon", "fish", "eggs", "tofu", "lentil"];

// Last-resort humaniser for any enum value that reaches the screen without a
// hand-written label. Every `LABEL[x] || x` fallback in this file used to leak
// the raw database value straight into the UI — "bread_or_pastry_side",
// "dairy-eggs". A user should never have to read a column name.
const humanize = (s) =>
  String(s || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^./, (ch) => ch.toUpperCase());

const SECTION_LABELS = {
  produce: "Produce", protein: "Protein", dairy: "Dairy", pantry: "Pantry / dry goods", spices: "Spices", other: "Other",
  carb: "Carbs", veg: "Veg", fat: "Fats", fruit: "Fruit",
  "dairy-eggs": "Dairy & Eggs", "fruit-veg": "Fruit & Veg", "grains": "Grains & Carbs",
  "fats-nuts-oils": "Fats, Nuts & Oils", "drinks": "Drinks",
};
// Plain-English option text for the two enums this screen lets you SET.
const SLOT_TYPE_LABEL = { meal: "Meal", snack: "Snack", either: "Meal or snack" };
const ROLE_LABEL = {
  protein: "Protein", carb: "Carbs", veg: "Veg", fat: "Fat", dairy: "Dairy", other: "Other",
};
const ROLES = ["protein", "carb", "veg", "fat", "dairy", "other"];
const CUISINE_LABEL = {
  mexican: "Mexican", italian: "Italian", mediterranean: "Mediterranean", asian: "Asian",
  indian: "Indian", "middle-eastern": "Middle Eastern", "british-irish": "British & Irish",
  "western-comfort": "Western / Comfort",
};
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Provenance badges are neutral ink — green is reserved (law a) and the
// macro triad colors mean macros only (law c), so labels do the work here.
const sourceBadge = (r) =>
  r.source === "ai-generated" ? { label: "AI", color: "var(--foreground)", bg: "var(--secondary)" }
  : r.source === "imported" ? { label: "IMPORTED", color: "var(--muted-foreground)", bg: "var(--secondary)" }
  : null;

const density = (r) => (r.kcal > 0 ? (r.protein / r.kcal) * 100 : 0);

// ── ingredient trust ─────────────────────────────────────────────────────
// trustReport moved VERBATIM to lib/recipeTrust.js (simple-declutter audit
// 2026-08-11, Do-first item 8) so the simple surface's recipe sheet reads the
// SAME signal instead of a `recipe.trust` field the API never returns. The
// full design rationale — the measured MATERIAL_SHARE threshold, the
// proportionality argument, the 779-of-889 numbers — travelled with it,
// unabridged. Every call site in this file is unchanged; the import at the
// top replaces the local definition.

// Primary-protein grouping by ingredient names — display taxonomy only.
const PROTEIN_GROUPS = [
  ["Chicken", ["chicken"]],
  ["Beef", ["beef", "steak", "sirloin", "mince"]],
  ["Turkey", ["turkey"]],
  ["Pork", ["pork", "bacon", "ham", "sausage", "chorizo"]],
  ["Fish & Seafood", ["salmon", "tuna", "cod", "fish", "shrimp", "prawn", "haddock", "sardine", "mackerel", "trout", "squid", "seafood", "anchov"]],
  ["Lamb & Game", ["lamb", "goat", "venison", "duck"]],
  ["Eggs & Dairy", ["egg", "cheese", "yogurt", "yoghurt", "paneer", "halloumi", "feta"]],
  ["Plant protein", ["tofu", "tempeh", "seitan", "lentil", "chickpea", "bean", "pea"]],
];
function proteinGroupOf(recipe) {
  const names = recipe.ingredients.map((i) => (i.food?.name || "").toLowerCase()).join(" | ");
  for (const [label, words] of PROTEIN_GROUPS) {
    if (words.some((w) => names.includes(w))) return label;
  }
  return "Other";
}
const MEAL_CATEGORY_LABEL = {
  dessert: "Desserts", beverage: "Beverages", bread_or_pastry_side: "Breads & Pastry Sides",
  condiment_or_sauce: "Condiments & Sauces", breakfast_only: "Breakfast",
};
function mealTypeGroupOf(recipe) {
  if (recipe.mealCategory) return MEAL_CATEGORY_LABEL[recipe.mealCategory] || humanize(recipe.mealCategory);
  return recipe.slotType === "snack" ? "Snacks" : recipe.slotType === "either" ? "Meals or Snacks" : "Meals";
}
function cuisineGroupOf(recipe) {
  if (!recipe.cuisine) return "Uncategorized";
  return CUISINE_LABEL[recipe.cuisine] || humanize(recipe.cuisine);
}

const MacroChips = ({ x }) => (
  <>
    <Chip>{kc(x.kcal)} kcal</Chip>
    <Chip color={C.proteinText} bg={`${C.protein}1F`}>{g1(x.protein)}P</Chip>
    <Chip color={C.fatText} bg={`${C.fat}1F`}>{g1(x.fat)}F</Chip>
    <Chip color={C.carbText} bg={`${C.carb}1F`}>{g1(x.carb)}C</Chip>
  </>
);

// ── recipe detail (expanded row) ─────────────────────────────────────────

function RecipeDetail({ recipe, profile, onSave, onDelete, inCart, onToggleCart, cartBusy, rating, onRate }) {
  const inpStyle = getInpStyle();
  const [scale, setScale] = useState(1);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [placePick, setPlacePick] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const abort = useAbortSignal();

  const scaled = useMemo(() => ({
    kcal: recipe.kcal * scale, protein: recipe.protein * scale,
    fat: recipe.fat * scale, carb: recipe.carb * scale,
  }), [recipe, scale]);

  // Scaling a recipe scales the doubt with it — the share is invariant, so
  // this is computed off the recipe, not off `scaled`.
  const trust = useMemo(() => trustReport(recipe), [recipe]);

  const startEdit = () => {
    setDraft({
      name: recipe.name, description: recipe.description || "", cuisine: recipe.cuisine || "",
      slotType: recipe.slotType, prepTimeMin: recipe.prepTimeMin || "",
      steps: recipe.steps.join("\n"),
      ingredients: recipe.ingredients.map((i) => ({ foodId: i.foodId, name: i.food.name, grams: i.baseGrams, role: i.role || "other", scalable: i.scalable })),
    });
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(recipe.id, {
        name: draft.name, description: draft.description, cuisine: draft.cuisine,
        slotType: draft.slotType, prepTimeMin: draft.prepTimeMin ? +draft.prepTimeMin : null,
        steps: draft.steps.split("\n").map((s) => s.trim()).filter(Boolean),
        ingredients: draft.ingredients.map((i) => ({ foodId: i.foodId, grams: +i.grams, role: i.role, scalable: i.scalable })),
      });
      setEditing(false);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e.body?.invalidIngredients ? `${e.message}: ${e.body.invalidIngredients.map((p) => `${p.name} — ${p.reason}`).join("; ")}` : describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const setIng = (idx, patch) =>
    setDraft((d) => ({ ...d, ingredients: d.ingredients.map((i, x) => (x === idx ? { ...i, ...patch } : i)) }));
  const removeIng = (idx) => setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((_, x) => x !== idx) }));

  const place = async () => {
    if (!placePick) return;
    setPlacing(true);
    setError(null);
    setNotice(null);
    try {
      await api.placeRecipe({ ...placePick, recipeId: recipe.id, scale }, { signal: abort.signal });
      setNotice(`Placed at ×${scale} into ${DAY_NAMES[placePick.dayOfWeek]} ${placePick.slotType} ${placePick.slotIndex + 1} — see the Plan tab.`);
      setPlacePick(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setPlacing(false);
    }
  };

  // Guarded: onDelete is async and used to be fired bare from onClick.
  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(recipe.id);
    } finally {
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
        <input aria-label="Recipe name" className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
        <textarea aria-label="Description" className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} rows={2} value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Description" />
        <div className="grid grid-cols-3 gap-2 mb-2">
          <select aria-label="When this is eaten" className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.slotType}
            onChange={(e) => setDraft((d) => ({ ...d, slotType: e.target.value }))}>
            {/* was: the raw enum values "meal" / "snack" / "either" rendered as
                the visible option text. A stored value is not a label. */}
            {Object.entries(SLOT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label="Cuisine" className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.cuisine}
            onChange={(e) => setDraft((d) => ({ ...d, cuisine: e.target.value }))}>
            {CUISINES.map((c) => <option key={c} value={c}>{c ? (CUISINE_LABEL[c] || c) : "auto cuisine"}</option>)}
          </select>
          <input type="number" aria-label="Prep time in minutes" className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.prepTimeMin}
            onChange={(e) => setDraft((d) => ({ ...d, prepTimeMin: e.target.value }))} placeholder="prep min" />
        </div>
        <div className="text-xs font-bold mb-1.5" style={{ color: "var(--muted-foreground)" }}>Ingredients (grams / role / scalable)</div>
        {draft.ingredients.map((ing, idx) => (
          <div key={idx} className="flex gap-1.5 items-center mb-1.5">
            <span className="text-xs font-semibold flex-1 truncate" style={{ color: "var(--foreground)" }}>{ing.name}</span>
            <input type="number" aria-label={`${ing.name} — grams`} className="text-xs px-2 py-1.5 rounded-lg w-16" style={inpStyle} value={ing.grams}
              onChange={(e) => setIng(idx, { grams: e.target.value })} />
            <select aria-label={`${ing.name} — what this ingredient counts as`} className="text-xs px-1.5 py-1.5 rounded-lg" style={inpStyle} value={ing.role}
              onChange={(e) => setIng(idx, { role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            {/* accentColor was the brand green. Green is scarce (law a): on-target,
                primary action, success, the hero ring, the trend line — a
                ticked checkbox is none of those, it is a selected state, and
                selected reads as a lightness step. */}
            <input type="checkbox" aria-label={`${ing.name} — scales with serving size`} checked={ing.scalable} onChange={(e) => setIng(idx, { scalable: e.target.checked })} style={{ accentColor: "var(--foreground)" }} />
            <button onClick={() => removeIng(idx)} aria-label={`Remove ${ing.name}`} style={{ color: "var(--destructive)" }}><X size={13} aria-hidden="true" /></button>
          </div>
        ))}
        <textarea aria-label="Steps, one per line" className="text-xs px-3 py-2 rounded-xl w-full mt-2 mb-2" style={inpStyle} rows={3} value={draft.steps}
          onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))} placeholder="One step per line" />
        {error && <div role="alert" className="text-xs font-semibold mb-2" style={{ color: "var(--destructive)" }}>{error}</div>}
        <div className="flex gap-2">
          <Btn small onClick={save} disabled={busy}><Save size={12} className="inline mr-1" aria-hidden="true" />Save</Btn>
          <Btn small kind="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10.5px] font-extrabold uppercase tracking-wide mr-1" style={{ color: "var(--muted-foreground)" }}>Serving</span>
        {SCALES.map((s) => (
          <button key={s} onClick={() => setScale(s)}
            className="text-xs font-bold px-2.5 py-1 rounded-lg"
            style={{ background: scale === s ? "var(--secondary)" : "var(--card)", color: scale === s ? "var(--foreground)" : "var(--muted-foreground)", border: `1px solid ${scale === s ? "var(--muted-foreground)" : "var(--border)"}` }}>
            ×{s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <MacroChips x={scaled} />
      </div>
      {trust && (
        <div className="text-[10.5px] font-semibold mb-2.5 p-2 rounded-lg" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>
          <div className="font-extrabold flex items-center gap-1.5">
            <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
            Incomplete data — {trust.flagged.length} ingredient{trust.flagged.length === 1 ? "" : "s"} {trust.flagged.length === 1 ? "carries" : "carry"} another food&apos;s numbers
          </div>
          <div className="mt-1" style={{ color: "var(--foreground)" }}>
            Roughly {Math.round(trust.share * 100)}% of the calories above come from {trust.flagged.length === 1 ? "it" : "them"}, so treat this total as an estimate, not a measurement.
          </div>
          <ul className="mt-1 list-none p-0 space-y-0.5">
            {trust.flagged.map((f, i) => (
              <li key={i}>· <b style={{ color: "var(--foreground)" }}>{f.name}</b> — {f.detail}</li>
            ))}
          </ul>
          <div className="mt-1">Correct these rows in the Food database and this recipe&apos;s totals recompute.</div>
        </div>
      )}
      <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--foreground)" }}>
        {recipe.ingredients.map((i) => `${Math.round(i.baseGrams * (i.scalable ? scale : 1))}g ${i.food.name}`).join(" · ")}
      </div>
      {recipe.description && <div className="text-xs italic mb-1.5" style={{ color: "var(--muted-foreground)" }}>{recipe.description}</div>}
      <ol className="text-xs space-y-1 list-decimal list-inside mb-3" style={{ color: "var(--foreground)" }}>
        {recipe.steps.map((step, i) => <li key={i}>{step}</li>)}
      </ol>

      <div className="flex flex-wrap gap-2 items-center">
        {!placePick ? (
          <Btn small onClick={() => setPlacePick({ dayOfWeek: new Date().getDay() === 0 ? 6 : new Date().getDay() - 1, slotType: "meal", slotIndex: 0 })}>
            <CalendarPlus size={12} className="inline mr-1" />Add to plan slot
          </Btn>
        ) : (
          <span className="flex items-center gap-1.5 flex-wrap">
            <select value={placePick.dayOfWeek} onChange={(e) => setPlacePick((p) => ({ ...p, dayOfWeek: +e.target.value }))}
              className="text-xs px-2 py-1.5 rounded-lg" style={inpStyle}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <select value={`${placePick.slotType}:${placePick.slotIndex}`}
              onChange={(e) => { const [t, i] = e.target.value.split(":"); setPlacePick((p) => ({ ...p, slotType: t, slotIndex: +i })); }}
              className="text-xs px-2 py-1.5 rounded-lg" style={inpStyle}>
              {Array.from({ length: profile.mealsPerDay }, (_, i) => <option key={`m${i}`} value={`meal:${i}`}>Meal {i + 1}</option>)}
              {Array.from({ length: profile.snacksPerDay }, (_, i) => <option key={`s${i}`} value={`snack:${i}`}>Snack {i + 1}</option>)}
            </select>
            <Btn small onClick={place} disabled={placing}>{placing ? "Placing…" : `Place ×${scale}`}</Btn>
            <button onClick={() => setPlacePick(null)} aria-label="Cancel adding to a plan slot" style={{ color: "var(--muted-foreground)" }}><X size={13} aria-hidden="true" /></button>
          </span>
        )}
        <Btn small kind="ghost" onClick={() => onToggleCart(recipe.id)} disabled={cartBusy}>
          {inCart ? <Check size={12} className="inline mr-1" /> : <ShoppingCart size={12} className="inline mr-1" />}
          {inCart ? "In cart" : "Add to cart"}
        </Btn>
        {onRate && (
          <span className="inline-flex items-center gap-1 ml-0.5" title="Taste preference — softly re-ranks future plans, never overrides your diet">
            <button onClick={() => onRate(recipe.id, 1)} aria-pressed={rating === 1} aria-label="Prefer this recipe"
              className="p-1.5 rounded-lg" style={{ background: rating === 1 ? "var(--secondary)" : "transparent", border: `1px solid ${rating === 1 ? "var(--muted-foreground)" : "var(--border)"}`, color: rating === 1 ? "var(--foreground)" : "var(--muted-foreground)" }}>
              <ThumbsUp size={13} />
            </button>
            <button onClick={() => onRate(recipe.id, -1)} aria-pressed={rating === -1} aria-label="See this recipe less"
              className="p-1.5 rounded-lg" style={{ background: rating === -1 ? "var(--secondary)" : "transparent", border: `1px solid ${rating === -1 ? "var(--muted-foreground)" : "var(--border)"}`, color: rating === -1 ? "var(--foreground)" : "var(--muted-foreground)" }}>
              <ThumbsDown size={13} />
            </button>
          </span>
        )}
        <Btn small kind="ghost" onClick={startEdit}><Pencil size={12} className="inline mr-1" />Edit</Btn>
        {confirmingDelete ? (
          <Btn small kind="red" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Confirm delete"}</Btn>
        ) : (
          <Btn small kind="ghost" onClick={() => setConfirmingDelete(true)}><Trash2 size={12} className="inline mr-1" />Delete</Btn>
        )}
      </div>
      {notice && <div className="text-xs font-semibold mt-2" style={{ color: "var(--primary)" }}>{notice}</div>}
      {error && <div className="text-xs font-semibold mt-2" style={{ color: "var(--destructive)" }}>{error}</div>}
    </div>
  );
}

// ── draft card (AI + imported share it) ──────────────────────────────────

function DraftCard({ draft, onSave, onEditGrams, saving, saveError }) {
  const inpStyle = getInpStyle();
  // routes/recipes.js stamps every draft with `allergenViolation` /
  // `allergenOverridden` when the user ticked "ALLOW MY ALLERGENS" and the
  // draft then broke one of their own rules — the backend went to the trouble
  // of screening the model's names AND the resolved ingredient names, auditing
  // every override, and shipping a per-draft verdict so a client "cannot render
  // a violating draft identically to a safe one without actively discarding the
  // field". The frontend was discarding the field. A card that will feed
  // someone an allergen looked exactly like one that won't.
  const violation = draft.allergenViolation || null;
  return (
    <div className="p-3 rounded-2xl" style={{ background: "var(--card)", border: `1.5px solid ${violation ? "var(--destructive)" : "var(--border)"}` }}>
      {violation && (
        // Red is legal here and only here on this screen: the constitution
        // names "the allergen override warning" as an explicit carve-out from
        // law b. This is not a judgment about food, it is a safety warning.
        <div role="alert" className="mb-2.5 p-2.5 rounded-xl flex items-start gap-2" style={{ background: "color-mix(in srgb, var(--destructive) 12%, transparent)", border: `1px solid ${"var(--destructive)"}` }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--destructive)" }} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-xs font-extrabold" style={{ color: "var(--destructive)" }}>Breaks your allergy rules — you allowed it for this generation</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--foreground)" }}>{violation}</div>
            <div className="text-[10.5px] font-semibold mt-1" style={{ color: "var(--muted-foreground)" }}>
              Read the ingredients below before saving. Untick “Allow my allergens” and generate again to get options that follow your Profile.
            </div>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-extrabold" style={{ color: "var(--foreground)" }}>{draft.name}</div>
        <span className="flex items-center gap-1.5 shrink-0">
          {violation && <Chip color={"var(--destructive)"} bg={"color-mix(in srgb, var(--destructive) 12%, transparent)"}>ALLERGEN</Chip>}
          {draft.source === "imported" && <Chip color={"var(--muted-foreground)"} bg={"var(--secondary)"}>IMPORT PREVIEW</Chip>}
        </span>
      </div>
      <div className="text-xs italic mb-1.5 font-semibold" style={{ color: "var(--muted-foreground)" }}>{draft.description}</div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {draft.kcal != null && <MacroChips x={draft} />}
        {draft.servings != null && <Chip>serves {draft.servings} (shown per serving)</Chip>}
      </div>
      {draft.importNotes?.length > 0 && (
        <div className="text-[10.5px] font-semibold mb-2 p-2 rounded-lg" style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, transparent)" }}>
          {draft.importNotes.map((n, i) => <div key={i}>· {n}</div>)}
        </div>
      )}
      {draft.ingredients.map((ing, idx) => (
        <div key={idx} className="flex justify-between items-center text-xs py-1 font-semibold">
          <span style={{ color: "var(--foreground)" }}>
            {/* was "var(--destructive)". Law b: no red on food data, ever — a missing macro
                row is a data gap to fix, not a verdict on the food. */}
            {ing.name} {ing.placeholderMacros && <span style={{ color: "var(--warn)" }}>(no macro data — fix it in the Food database before saving)</span>}
          </span>
          <input type="number" aria-label={`${ing.name} — grams`} className="text-xs px-2 py-1 rounded-lg w-16" style={inpStyle} value={ing.grams}
            onChange={(e) => onEditGrams(idx, e.target.value)} />
        </div>
      ))}
      <ol className="text-xs mt-2 space-y-1 list-decimal list-inside font-semibold" style={{ color: "var(--foreground)" }}>
        {draft.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {saveError && <div className="text-xs font-semibold mt-2" style={{ color: "var(--destructive)" }}>{saveError}</div>}
      <div className="mt-2.5">
        <Btn small onClick={onSave} disabled={saving}><Save size={12} className="inline mr-1" />Save to library</Btn>
      </div>
    </div>
  );
}

// ── main tab ─────────────────────────────────────────────────────────────

export default function RecipesTab({ openFoods, profile }) {
  const inpStyle = getInpStyle();
  const [recipes, setRecipes] = useState([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null); // library load failed — NOT "no recipes"
  const [cartError, setCartError] = useState(null); // cart load failed — NOT "empty cart"
  const abort = useAbortSignal();
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState("cuisine");
  const [sortBy, setSortBy] = useState("name");
  const [openGroups, setOpenGroups] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  // How many rows of each group are currently mounted. See RENDER_PAGE.
  const [shown, setShown] = useState({});

  const [cartItems, setCartItems] = useState([]);
  const [ratings, setRatings] = useState({}); // T (v2): recipeId -> 1 (like) | -1 (dislike)
  const [cartBusyId, setCartBusyId] = useState(null);
  const [cartGroceryList, setCartGroceryList] = useState(null);
  const [cartGroceryBusy, setCartGroceryBusy] = useState(false);
  const [fillBusy, setFillBusy] = useState(false);
  const [cartNote, setCartNote] = useState(null);
  const cartRecipeIds = new Set(cartItems.map((i) => i.recipeId));

  const [form, setForm] = useState({ slotType: "meal", protein: "", cuisine: "", prepTimeMin: "", freeText: "", batchStyle: "single", allowAllergens: false });
  const [drafts, setDrafts] = useState(null);
  const [droppedForAllergies, setDroppedForAllergies] = useState([]);
  // The override half of the same payload. `droppedForAllergies` (options the
  // server REFUSED) was already rendered; `allergenOverrides` (options the
  // server let through because the user asked it to) was not read at all.
  const [overrideInfo, setOverrideInfo] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [savingIdx, setSavingIdx] = useState(null);
  const [draftErrors, setDraftErrors] = useState({});
  // null = still asking, true/false = whether AI generation works in THIS build.
  // A shareable build ships without an API key, so a Generate button here would
  // only 503 on click — gate the card on this instead.
  const [aiEnabled, setAiEnabled] = useState(null);

  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  // frontend-arch-4: a failed load left `recipes` at [] and the library then
  // rendered the "No recipes yet" empty state. loadError is tracked
  // separately and takes priority in the render — an error and an empty
  // library never look the same.
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.getRecipes({ signal: abort.signal });
      setRecipes(res.recipes);
      setHiddenCount(res.hiddenCount);
      setLoading(false);
    } catch (e) {
      if (isAbortError(e)) return;
      setLoadError(describeError(e, "Couldn't load your recipes."));
      setLoading(false);
    }
  }, [abort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.getCart({ signal: abort.signal })
      .then((items) => { setCartItems(items); setCartError(null); })
      .catch((e) => {
        if (isAbortError(e)) return;
        // An unreadable cart is NOT an empty cart — say which one it is.
        setCartError(describeError(e, "Couldn't load your cart."));
      });
  }, [abort]);
  useEffect(() => {
    // Ask once whether AI generation is even possible in this build. On any
    // failure, assume it's NOT — better to hide the button than show one that
    // errors on click (URL import + the library still work without a key).
    api.getBrainStatus({ signal: abort.signal })
      .then((s) => setAiEnabled(!!s?.enabled))
      .catch((e) => { if (!isAbortError(e)) setAiEnabled(false); });
  }, [abort]);
  useEffect(() => {
    // Ratings are a soft re-rank only; their absence changes no displayed
    // fact, so this one degrades silently by design.
    api.getRatings({ signal: abort.signal })
      .then((rows) => setRatings(Object.fromEntries(rows.map((x) => [x.recipeId, x.rating]))))
      .catch(() => {});
  }, [abort]);

  // T (v2): optimistic taste rating. Clicking the active thumb again clears it.
  const rate = async (recipeId, value) => {
    const prev = ratings;
    const next = { ...ratings };
    if (next[recipeId] === value) delete next[recipeId];
    else next[recipeId] = value;
    setRatings(next);
    try {
      if (next[recipeId] === undefined) await api.unrateRecipe(recipeId, { signal: abort.signal });
      else await api.rateRecipe(recipeId, value, { signal: abort.signal });
    } catch (e) {
      if (isAbortError(e)) return;
      setRatings(prev); // rollback to the pre-click truth
    }
  };

  // Optimistic cart toggle: update the list now (a temp row on add, using the
  // recipe we already have), reconcile with the server row, roll back on error.
  const toggleCart = async (recipeId) => {
    setCartBusyId(recipeId);
    const had = cartRecipeIds.has(recipeId);
    const prev = cartItems;
    if (had) {
      setCartItems((c) => c.filter((i) => i.recipeId !== recipeId));
    } else {
      const recipe = recipes.find((r) => r.id === recipeId);
      setCartItems((c) => [{ id: `tmp-${recipeId}`, recipeId, recipe }, ...c]);
    }
    try {
      if (had) {
        await api.removeFromCart(recipeId, { signal: abort.signal });
      } else {
        const item = await api.addToCart(recipeId, { signal: abort.signal });
        setCartItems((c) => c.map((i) => (i.id === `tmp-${recipeId}` ? item : i)));
      }
    } catch (e) {
      if (isAbortError(e)) return;
      setCartItems(prev); // rollback to the pre-toggle truth
      setError(`${describeError(e)} The cart was put back to what the server last confirmed.`);
    } finally {
      setCartBusyId(null);
    }
  };

  const cartTotals = cartItems.reduce(
    (t, i) => ({ kcal: t.kcal + (i.recipe?.kcal || 0), protein: t.protein + (i.recipe?.protein || 0), fat: t.fat + (i.recipe?.fat || 0), carb: t.carb + (i.recipe?.carb || 0) }),
    { kcal: 0, protein: 0, fat: 0, carb: 0 }
  );

  const fillToday = async () => {
    setFillBusy(true);
    setCartNote(null);
    setError(null);
    try {
      const res = await api.fillTodayFromCart({ signal: abort.signal });
      setCartNote(`Placed ${res.placed} recipe(s) into today's plan${res.note ? ` — ${res.note}` : "."} See the Plan tab.`);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setFillBusy(false);
    }
  };

  const onGenerateCartGroceryList = async () => {
    setCartGroceryBusy(true);
    setError(null);
    try {
      setCartGroceryList(await api.generateCartGroceryList({ signal: abort.signal }));
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setCartGroceryBusy(false);
    }
  };
  const cartItemGrams = (i) => Math.round(i.purchase?.grams ?? i.preparedGrams ?? 0);
  const cartGroceryText = () =>
    cartGroceryList.items.map((i) => `${cartItemGrams(i)}g ${i.name}`).join("\n");

  // Stage-C fix: every draft carries a stable client key so its validator
  // error attaches to the RIGHT card. Before, errors were keyed by array
  // index, so saving one draft (which removes it and shifts the rest) or
  // importing (which prepends) rendered an error on the wrong recipe.
  const withKey = (d, source) => ({ ...d, source, _key: (crypto.randomUUID?.() || `k${Date.now()}${Math.random()}`) });

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setDrafts(null);
    setDraftErrors({});
    setDroppedForAllergies([]); // Stage-C: don't leave a stale drop note under a new run
    setOverrideInfo(null);
    try {
      const res = await api.generateRecipeDrafts(
        { ...form, prepTimeMin: form.prepTimeMin ? +form.prepTimeMin : undefined },
        { signal: abort.signal }
      );
      setDrafts(res.drafts.map((d) => withKey(d, "ai-generated")));
      setDroppedForAllergies(res.droppedForAllergies);
      setOverrideInfo({
        active: !!res.allergenOverrideActive,
        overrides: res.allergenOverrides || [],
        droppedForShape: res.droppedForShape || [],
      });
      // The allergen override is per-generation and never sticky.
      setForm((f) => ({ ...f, allowAllergens: false }));
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleImport = async () => {
    if (importing || !importUrl.trim()) return; // Stage-C: Enter can't double-fire past the busy guard
    setImporting(true);
    setError(null);
    try {
      const { draft } = await api.importRecipe(importUrl.trim(), { signal: abort.signal });
      setDrafts((ds) => [withKey(draft, "imported"), ...(ds || [])]);
      setImportUrl("");
    } catch (e) {
      if (isAbortError(e)) return;
      setError(`Import failed: ${describeError(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const editDraftGrams = (key, ingIdx, grams) => {
    setDrafts((ds) => ds.map((d) => (d._key !== key ? d : { ...d, ingredients: d.ingredients.map((ing, x) => (x === ingIdx ? { ...ing, grams: +grams } : ing)) })));
  };

  const handleSaveDraft = async (key) => {
    setSavingIdx(key);
    setDraftErrors((e) => ({ ...e, [key]: null }));
    try {
      const draft = drafts.find((d) => d._key === key);
      const saved = await api.saveRecipeDraft({
        name: draft.name, description: draft.description, cuisine: draft.cuisine,
        slotType: draft.slotType, prepTimeMin: draft.prepTimeMin, steps: draft.steps,
        source: draft.source === "imported" ? "imported" : undefined,
        ingredients: draft.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams, role: i.role, scalable: i.scalable })),
      }, { signal: abort.signal });
      setRecipes((r) => [...r, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDrafts((ds) => ds.filter((d) => d._key !== key));
      setDraftErrors((errs) => { const { [key]: _drop, ...rest } = errs; return rest; });
    } catch (e) {
      if (isAbortError(e)) return;
      const detail = e.body?.invalidIngredients
        ? `${e.message}: ${e.body.invalidIngredients.map((p) => `${p.name} — ${p.reason}`).join("; ")}`
        : describeError(e);
      setDraftErrors((errs) => ({ ...errs, [key]: detail }));
    } finally {
      setSavingIdx(null);
    }
  };

  // Awaited by RecipeDetail's own try/catch — it throws on purpose so the
  // inline editor can show the validator's message.
  const handleUpdate = async (id, patch) => {
    const updated = await api.updateRecipe(id, patch, { signal: abort.signal });
    setRecipes((r) => r.map((x) => (x.id === id ? updated : x)).sort((a, b) => a.name.localeCompare(b.name)));
  };
  // Guarded (frontend-arch-4): "Confirm delete" called this straight from
  // onClick, so a failed DELETE was an unhandled rejection into the crash
  // dialog — AND the row stayed on screen with no explanation. Now the row is
  // only removed once the server confirms it.
  const handleDelete = async (id) => {
    setError(null);
    try {
      await api.deleteRecipe(id, { signal: abort.signal });
      setRecipes((r) => r.filter((x) => x.id !== id));
      setExpandedId(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(`Couldn't delete that recipe — ${describeError(e)} It is still in your library.`);
    }
  };

  // ── grouping + sorting ──
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? recipes.filter((r) => r.name.toLowerCase().includes(q)) : recipes;
    const sorter = sortBy === "kcal" ? (a, b) => a.kcal - b.kcal
      : sortBy === "density" ? (a, b) => density(b) - density(a)
      : (a, b) => a.name.localeCompare(b.name);
    if (q) return [["Search results", [...filtered].sort(sorter)]];
    const keyFn = groupBy === "mealtype" ? mealTypeGroupOf : groupBy === "protein" ? proteinGroupOf : cuisineGroupOf;
    const m = new Map();
    for (const r of filtered) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()]
      .map(([k, list]) => [k, list.sort(sorter)])
      .sort((a, b) => b[1].length - a[1].length);
  }, [recipes, query, groupBy, sortBy]);

  const searching = query.trim().length > 0;

  // The honest headline. Per-row marks cannot carry this: at 88% affected, a
  // mark on almost every row degrades to wallpaper. Said once, with real
  // numbers, it is a fact about the LIBRARY rather than an accusation against
  // whichever recipe you happen to be looking at.
  const trustSummary = useMemo(() => {
    let affected = 0;
    let severe = 0;
    for (const r of recipes) {
      const t = trustReport(r);
      if (!t) continue;
      affected++;
      if (t.material) severe++;
    }
    return { affected, severe, total: recipes.length };
  }, [recipes]);

  // ── render cap ──
  // Nothing here was capped: an open group mounted every row it held, and a
  // broad search collapsed the whole library into ONE "Search results" group
  // and mounted all 889 rows — each a FoodTile, four macro chips and a
  // disclosure button.
  //
  // Why this is a progressive reveal and not FoodsTab's windowed list: that
  // primitive is built on a PINNED row height ("windowing needs row geometry it
  // can trust"), and it works there because a food row is one fixed-height line
  // and the detail opens in a separate card. A recipe row expands IN PLACE into
  // a variable-height editor, so there is no row height to pin — reusing the
  // window would mean either measuring the expanded row every frame or moving
  // recipe detail out into its own panel, which is a UX change, not a
  // performance fix. A reveal keeps the DOM bounded, states out loud how much
  // is hidden (a silent cap would amputate browse, which is the whole point of
  // the groups), and needs no geometry at all.
  const RENDER_PAGE = 60;
  const shownFor = (groupName) => shown[groupName] ?? RENDER_PAGE;
  const revealMore = (groupName) => setShown((s) => ({ ...s, [groupName]: (s[groupName] ?? RENDER_PAGE) + RENDER_PAGE }));
  const revealAll = (groupName, total) => setShown((s) => ({ ...s, [groupName]: total }));
  // A new query / grouping / sort is a new list — start it at the top again
  // rather than leaving it mid-reveal from the previous one.
  useEffect(() => { setShown({}); }, [query, groupBy, sortBy]);

  return (
    <div>
      <PageHead title="Recipes" sub="Library, AI generation, URL import, and the cart that feeds your plan and grocery list.">
        <Btn small kind="ghost" onClick={openFoods}>
          <Database size={12} className="inline mr-1" />Food database
        </Btn>
      </PageHead>

      {error && (
        <div className="mb-3">
          <ErrorNote msg={error}
            hint={error.startsWith("Import failed") ? "Check the URL is a public recipe page — most recipe sites work; plain blog posts without recipe markup don't." : undefined} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* ── left: import + generate + drafts + cart ── */}
        <div className="xl:col-span-5 flex flex-col gap-4 min-w-0">
          <Card section="IMPORT" title="Import from a recipe site">
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
                <input placeholder="Paste a recipe URL…" aria-label="Recipe URL to import" value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleImport()}
                  className="text-sm pl-9 pr-3 py-2 rounded-xl w-full" style={inpStyle} />
              </div>
              <Btn small onClick={handleImport} disabled={importing}>{importing ? "Reading…" : "Import"}</Btn>
            </div>
            {/* This used to end "USDA stays the nutrition source of truth",
                which overclaims on exactly this path. An imported line is
                matched to a food row BY NAME, and name-matching is where
                identity errors enter: 470 rows in this library already carry
                another food's macros verbatim. The numbers are real USDA
                numbers — the open question is whether they are the right
                food's. Say that, rather than presenting the provenance as a
                verification. */}
            <div className="text-[10.5px] font-semibold mt-2" style={{ color: "var(--muted-foreground)" }}>
              Reads the site&apos;s standard recipe markup (schema.org) — no paid API. Amounts convert to grams with flagged
              estimates; you review before anything saves. Each ingredient line is matched to a food in your library
              <b style={{ color: "var(--foreground)" }}> by name</b>, which is the step most likely to go wrong — check that the matched
              foods are the ones you meant before you save.
            </div>
          </Card>

          <Card section="GENERATE" title="New recipe from AI">
            {aiEnabled === false ? (
              <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                <p>
                  AI recipe generation is <strong style={{ color: "var(--foreground)" }}>off in this build</strong> — it needs
                  an Anthropic API key, which this install doesn&apos;t include. Everything else works normally,
                  fully offline.
                </p>
                <p className="mt-2">
                  To add recipes without it: <strong style={{ color: "var(--foreground)" }}>import from a URL</strong> above
                  (works offline), or browse the ones already in your library below.
                </p>
              </div>
            ) : (
            <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select aria-label="Slot type" className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={form.slotType}
                onChange={(e) => setForm((f) => ({ ...f, slotType: e.target.value }))}>
                <option value="meal">Meal</option><option value="snack">Snack</option>
              </select>
              <select aria-label="Preferred protein" className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={form.protein}
                onChange={(e) => setForm((f) => ({ ...f, protein: e.target.value }))}>
                {PROTEINS.map((p) => <option key={p} value={p}>{p || "Any protein"}</option>)}
              </select>
              <select aria-label="Cuisine" className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={form.cuisine}
                onChange={(e) => setForm((f) => ({ ...f, cuisine: e.target.value }))}>
                {CUISINES.map((c) => <option key={c} value={c}>{c ? (CUISINE_LABEL[c] || c) : "Any cuisine"}</option>)}
              </select>
              <input type="number" placeholder="Max prep (min)" aria-label="Max prep time in minutes" className="text-xs px-2 py-2 rounded-xl" style={inpStyle}
                value={form.prepTimeMin} onChange={(e) => setForm((f) => ({ ...f, prepTimeMin: e.target.value }))} />
            </div>
            <textarea placeholder="Anything else? e.g. 'something spicy, uses the crockpot'" aria-label="Anything else for the AI to know" rows={2}
              className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle}
              value={form.freeText} onChange={(e) => setForm((f) => ({ ...f, freeText: e.target.value }))} />
            <div className="flex flex-wrap gap-4 items-center mb-2">
              {/* accentColor was the brand green on both — see the checkbox above; a
                  chosen radio is a selected state, not a success. */}
              <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                <input type="radio" name="batchStyle" checked={form.batchStyle === "single"} onChange={() => setForm((f) => ({ ...f, batchStyle: "single" }))} style={{ accentColor: "var(--foreground)" }} />
                Single serving
              </label>
              <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                <input type="radio" name="batchStyle" checked={form.batchStyle === "batch"} onChange={() => setForm((f) => ({ ...f, batchStyle: "batch" }))} style={{ accentColor: "var(--foreground)" }} />
                Batch-cook
              </label>
            </div>
            {/* Per-generation allergen override — deliberately loud, resets after every generation. */}
            <div className="p-2.5 rounded-xl mb-3" style={{ background: form.allowAllergens ? "color-mix(in srgb, var(--destructive) 12%, transparent)" : "var(--secondary)", border: `1.5px solid ${form.allowAllergens ? "var(--destructive)" : "var(--border)"}` }}>
              <label className="flex items-center gap-2 text-xs font-extrabold cursor-pointer" style={{ color: form.allowAllergens ? "var(--destructive)" : "var(--muted-foreground)" }}>
                <input type="checkbox" checked={form.allowAllergens} onChange={(e) => setForm((f) => ({ ...f, allowAllergens: e.target.checked }))} style={{ accentColor: "var(--destructive)" }} />
                <AlertTriangle size={13} />
                ALLOW MY ALLERGENS — THIS GENERATION ONLY
              </label>
              {form.allowAllergens && (
                <div className="text-[10.5px] font-semibold mt-1 ml-6" style={{ color: "var(--destructive)" }}>
                  Diet & allergy rules from your Profile are suspended for the next generation only, then re-arm automatically.
                </div>
              )}
            </div>
            <Btn onClick={handleGenerate} disabled={generating}>
              <Sparkles size={13} className="inline mr-1" />{generating ? "Generating…" : drafts?.length ? "Regenerate 3 options" : "Generate 3 options"}
            </Btn>
            </>
            )}
          </Card>

          {/* The override banner. `allergenOverrideActive` is true whenever the
              user ASKED for the override, even if nothing ended up violating —
              that is the state this banner reflects, per the route's own note.
              It sits ABOVE the draft list so it cannot be scrolled past. */}
          {overrideInfo?.active && (
            <div role="alert" className="p-3 rounded-xl" style={{ background: "color-mix(in srgb, var(--destructive) 12%, transparent)", border: `1.5px solid ${"var(--destructive)"}` }}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--destructive)" }} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-xs font-extrabold" style={{ color: "var(--destructive)" }}>
                    {overrideInfo.overrides.length > 0
                      ? `${overrideInfo.overrides.length} of these options break your allergy rules`
                      : "Your allergy rules were switched off for this generation"}
                  </div>
                  {overrideInfo.overrides.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 list-none p-0">
                      {overrideInfo.overrides.map((o, i) => (
                        <li key={i} className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                          <b>{o.name}</b> — {o.reason}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--foreground)" }}>
                      Nothing that came back happened to break one, but nothing was checked against your Profile either.
                    </div>
                  )}
                  <div className="text-[10.5px] font-semibold mt-1.5" style={{ color: "var(--muted-foreground)" }}>
                    The override is per-generation and has already re-armed. Read every ingredient list before saving.
                  </div>
                </div>
              </div>
            </div>
          )}

          {droppedForAllergies.length > 0 && (
            <div className="text-xs font-semibold px-1" style={{ color: "var(--warn)" }}>
              Dropped {droppedForAllergies.length} option{droppedForAllergies.length === 1 ? "" : "s"} for allergy rules: {droppedForAllergies.map((d) => `${d.name} (${d.reason})`).join(", ")}
            </div>
          )}
          {overrideInfo?.droppedForShape?.length > 0 && (
            <div className="text-xs font-semibold px-1" style={{ color: "var(--warn)" }}>
              Dropped {overrideInfo.droppedForShape.length} option{overrideInfo.droppedForShape.length === 1 ? "" : "s"} that
              didn&apos;t come back in a usable shape: {overrideInfo.droppedForShape.map((d) => (typeof d === "string" ? d : `${d.name || "unnamed"} (${d.reason || "malformed"})`)).join(", ")}
            </div>
          )}

          {drafts && drafts.length > 0 && (
            <Card section="PREVIEW" title={`${drafts.length} draft(s) — review grams, then save`}>
              <div className="flex flex-col gap-3">
                {drafts.map((d) => (
                  <DraftCard key={d._key} draft={d} saving={savingIdx === d._key} saveError={draftErrors[d._key]}
                    onEditGrams={(ingIdx, grams) => editDraftGrams(d._key, ingIdx, grams)}
                    onSave={() => handleSaveDraft(d._key)} />
                ))}
              </div>
            </Card>
          )}

          <Card section="CART" title={cartError ? "Cart (unknown)" : `Cart (${cartItems.length})`}>
            {cartError ? (
              // A cart that couldn't be read is not an empty cart.
              <ErrorNote msg={`Couldn't load your cart — ${cartError}`}
                hint="Anything already in it is still there; this view just couldn't read it. Switch tabs and back to retry." />
            ) : cartItems.length === 0 ? (
              <div className="text-sm font-semibold" style={{ color: "var(--muted-foreground)" }}>Add recipes from the library — the cart feeds today's plan and the grocery list.</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-[10.5px] font-extrabold uppercase tracking-wide self-center mr-1" style={{ color: "var(--muted-foreground)" }}>Totals</span>
                  <MacroChips x={cartTotals} />
                </div>
                <div className="flex flex-col gap-1.5 mb-3">
                  {cartItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 py-1" style={{ borderBottom: "1px solid var(--border)" }}>
                      <span className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>{item.recipe?.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="tabular-nums text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>{kc(item.recipe?.kcal || 0)} kcal</span>
                        <button onClick={() => toggleCart(item.recipeId)} disabled={cartBusyId === item.recipeId} style={{ color: "var(--destructive)" }} aria-label={`Remove ${item.recipe?.name || "item"} from cart`}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn small onClick={fillToday} disabled={fillBusy}>
                    <Utensils size={12} className="inline mr-1" />{fillBusy ? "Filling…" : "Fill today's plan"}
                  </Btn>
                  <Btn small kind="ghost" onClick={onGenerateCartGroceryList} disabled={cartGroceryBusy}>
                    <ShoppingCart size={12} className="inline mr-1" />Grocery list
                  </Btn>
                  {cartGroceryList && (
                    <Btn small kind="ghost" onClick={() => navigator.clipboard?.writeText(cartGroceryText())}>
                      <Copy size={12} className="inline mr-1" />Copy
                    </Btn>
                  )}
                </div>
                {cartNote && <div className="text-xs font-semibold mt-2" style={{ color: "var(--primary)" }}>{cartNote}</div>}
                {cartGroceryList && (
                  <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                    <div className="flex gap-2 mb-2">
                      <a href={`sms:?&body=${encodeURIComponent("Grocery list:\n" + cartGroceryText())}`} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                        <MessageSquare size={12} />Text
                      </a>
                      <a href={`mailto:?subject=${encodeURIComponent("Grocery list — from cart")}&body=${encodeURIComponent(cartGroceryText())}`} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                        <Mail size={12} />Email
                      </a>
                    </div>
                    {Object.entries(cartGroceryList.bySection || {})
                      .filter(([, items]) => items.length > 0)
                      .map(([section, items]) => (
                        <div key={section} className="mb-2">
                          {/* `|| section` leaked raw store-section keys like
                              "dairy-eggs" into the visible list. */}
                          <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted-foreground)" }}>{SECTION_LABELS[section] || humanize(section)}</div>
                          {items.map((i) => {
                            const grams = cartItemGrams(i);
                            const hh = toHouseholdUnit(i.name, grams);
                            return (
                              <div key={i.name} className="flex justify-between text-xs py-0.5 font-semibold" style={{ color: "var(--foreground)" }}>
                                <span>{i.name}</span>
                                <span className="tabular-nums" style={{ color: "var(--muted-foreground)" }}>{grams}g{hh ? ` (≈${hh})` : ""}</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* ── right: grouped library ── */}
        <div className="xl:col-span-7 min-w-0">
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
              <input placeholder={`Search ${recipes.length} recipes…`} aria-label="Search recipes" className="text-sm pl-9 pr-3 py-2 rounded-xl w-full" style={inpStyle}
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select value={groupBy} aria-label="Group recipes by" onChange={(e) => { setGroupBy(e.target.value); setOpenGroups({}); }}
              className="text-xs px-2 py-2 rounded-xl" style={inpStyle}>
              <option value="cuisine">Group by cuisine</option>
              <option value="mealtype">Group by meal type</option>
              <option value="protein">Group by main protein</option>
            </select>
            {/* "Protein density" was a unit nobody outside the Engine speaks.
                Every option now names what the sort DOES. */}
            <select value={sortBy} aria-label="Sort recipes by" onChange={(e) => setSortBy(e.target.value)}
              className="text-xs px-2 py-2 rounded-xl" style={inpStyle}>
              <option value="name">Sort A–Z</option>
              <option value="kcal">Fewest calories first</option>
              <option value="density">Most protein per calorie</option>
            </select>
          </div>
          {hiddenCount > 0 && (
            <div className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground">
              <EyeOff size={12} aria-hidden="true" /> {hiddenCount} recipe{hiddenCount === 1 ? "" : "s"} hidden by your diet & allergy rules.
            </div>
          )}

          {!loading && !loadError && trustSummary.affected > 0 && (
            <div className="text-xs font-semibold mb-2 px-1" style={{ color: "var(--warn)" }}>
              {trustSummary.affected} of {trustSummary.total} recipes here use at least one food whose stored numbers belong to a
              different food, so their calorie totals are estimates.{" "}
              {trustSummary.severe > 0 && (
                <>In {trustSummary.severe} of them that is most of the total — those are marked. </>
              )}
              This is a problem with the food library, not with these recipes; open any recipe to see exactly which ingredients
              are affected.
            </div>
          )}

          {loading ? (
            <SkeletonRows rows={7} />
          ) : loadError ? (
            // Load failure — deliberately NOT the empty state below. "No
            // recipes yet" here would tell a user their library was wiped.
            <Card>
              <ErrorNote msg={`Couldn't load your recipe library — ${loadError}`}
                hint="Your recipes are still stored; this is a load failure, not a deletion. Retry below." />
              <div className="mt-3">
                <Btn small onClick={() => { setLoading(true); load(); }}>Retry</Btn>
              </div>
            </Card>
          ) : groups.every(([, list]) => list.length === 0) ? (
            <Card>
              <EmptyNote icon={searching ? Search : Utensils}
                title={searching ? "No recipes match your search" : "No recipes yet"}
                hint={searching ? "Try a different name, or clear the search." : "Generate one with AI or import from a recipe URL on the left — it lands here."} />
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groups.map(([groupName, list]) => {
                const open = searching || !!openGroups[groupName];
                return (
                  <div key={groupName} className="rounded-2xl bg-card border border-border">
                    {!searching && (
                      <button onClick={() => setOpenGroups((s) => ({ ...s, [groupName]: !open }))}
                        aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3.5">
                        {open ? <ChevronDown size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" /> : <ChevronRight size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />}
                        <span className="text-sm font-extrabold flex-1 text-left" style={{ color: "var(--foreground)" }}>{groupName}</span>
                        <span className="tabular-nums text-xs font-bold px-2 py-0.5 rounded-lg" style={{ color: "var(--muted-foreground)", background: "var(--secondary)" }}>{list.length}</span>
                      </button>
                    )}
                    {open && (
                      <div className="px-3 pb-3 flex flex-col gap-2">
                        {list.slice(0, shownFor(groupName)).map((r) => {
                          const badge = sourceBadge(r);
                          const expanded = expandedId === r.id;
                          // Only the recipes whose NUMBER is materially in
                          // question get a mark out here. The rest still say so
                          // in full when opened — see trustReport.
                          const rowTrust = trustReport(r);
                          const marked = !!rowTrust?.material;
                          return (
                            // a11y: the row is a plain container. It used to be
                            // role="button" tabIndex={0} WRAPPING the whole
                            // RecipeDetail — which contains a dozen real
                            // buttons, selects and inputs. Interactive controls
                            // nested inside a button role is invalid ARIA: a
                            // screen reader's browse mode flattens the subtree,
                            // so the inner controls fold into the outer label or
                            // are lost. Same fix as PlanTab's SlotCard — the
                            // disclosure is a real <button> around the title and
                            // macros ONLY, and everything else is its sibling.
                            // The click-anywhere handler and its stopPropagation
                            // plumbing are gone with it.
                            <div key={r.id} className="p-3 rounded-xl"
                              style={{ background: "var(--secondary)", border: `1px solid ${expanded ? "var(--muted-foreground)" : "var(--border)"}` }}>
                              <button type="button" onClick={() => setExpandedId(expanded ? null : r.id)}
                                aria-expanded={expanded} className="w-full text-left"
                                aria-label={`${r.name}, ${kc(r.kcal)} kcal${marked ? " — incomplete data, some ingredients carry another food's numbers" : ""} — ${expanded ? "hide" : "show"} details`}>
                                <div className="flex justify-between items-start gap-2">
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <FoodTile recipe={r} size={38} />
                                    <div className="min-w-0">
                                      <div className="text-sm font-extrabold" style={{ color: "var(--foreground)" }}>{r.name}</div>
                                      <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                                        {/* was the raw enum: "meal" / "snack" / "either" */}
                                        {SLOT_TYPE_LABEL[r.slotType] || humanize(r.slotType)}
                                        {r.cuisine ? ` · ${CUISINE_LABEL[r.cuisine] || humanize(r.cuisine)}` : ""}
                                        {r.prepTimeMin ? ` · ${r.prepTimeMin} min` : ""} · {g1(density(r))}g protein per 100 kcal
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {badge && <Chip color={badge.color} bg={badge.bg}>{badge.label}</Chip>}
                                    {marked && (
                                      <AlertTriangle size={13} className="shrink-0" style={{ color: "var(--warn)" }} aria-hidden="true"
                                        title={`Incomplete data — about ${Math.round(rowTrust.share * 100)}% of these calories come from ingredients carrying another food's numbers. Open for detail.`} />
                                    )}
                                    <span className="tabular-nums text-sm font-extrabold" style={{ color: "var(--foreground)" }}>{kc(r.kcal)}</span>
                                  </div>
                                </div>
                              </button>
                              {expanded && (
                                <RecipeDetail recipe={r} profile={profile}
                                  onSave={handleUpdate} onDelete={handleDelete}
                                  inCart={cartRecipeIds.has(r.id)} onToggleCart={toggleCart} cartBusy={cartBusyId === r.id}
                                  rating={ratings[r.id]} onRate={rate} />
                              )}
                            </div>
                          );
                        })}
                        {list.length > shownFor(groupName) && (
                          // The render cap, made visible instead of silent. A
                          // broad search used to mount all 889 rows at once (and
                          // an open group every row it held) — each one a
                          // FoodTile, four chips and a disclosure button.
                          <div className="flex items-center gap-3 pt-1">
                            <Btn small kind="ghost" onClick={() => revealMore(groupName)}>
                              Show {Math.min(RENDER_PAGE, list.length - shownFor(groupName))} more
                            </Btn>
                            <button type="button" onClick={() => revealAll(groupName, list.length)}
                              className="text-xs font-bold hover:opacity-80" style={{ color: "var(--muted-foreground)" }}>
                              Show all {list.length}
                            </button>
                            <span className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>
                              Showing {shownFor(groupName)} of {list.length}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
