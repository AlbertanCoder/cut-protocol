import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles, Pencil, Trash2, Save, X, Search, ShoppingCart, Check, Mail,
  MessageSquare, Copy, Database, EyeOff, ChevronRight, ChevronDown,
  Link2, AlertTriangle, CalendarPlus, Utensils,
} from "lucide-react";
import { C } from "../lib/theme.js";
import { toHouseholdUnit } from "../lib/householdUnits.js";
import { Card, Btn, Chip, PageHead, ErrorNote } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const g1 = (n) => Math.round(n * 10) / 10;
const getInpStyle = () => ({ background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink });
const CUISINES = ["", "mexican", "italian", "mediterranean", "asian", "indian", "middle-eastern", "british-irish", "western-comfort"];
const PROTEINS = ["", "chicken", "beef", "turkey", "salmon", "fish", "eggs", "tofu", "lentil"];
const SECTION_LABELS = {
  produce: "Produce", protein: "Protein", dairy: "Dairy", pantry: "Pantry / dry goods", spices: "Spices", other: "Other",
  carb: "Carbs", veg: "Veg", fat: "Fats", fruit: "Fruit",
  "dairy-eggs": "Dairy & Eggs", "fruit-veg": "Fruit & Veg", "grains": "Grains & Carbs",
  "fats-nuts-oils": "Fats, Nuts & Oils", "drinks": "Drinks",
};
const CUISINE_LABEL = {
  mexican: "Mexican", italian: "Italian", mediterranean: "Mediterranean", asian: "Asian",
  indian: "Indian", "middle-eastern": "Middle Eastern", "british-irish": "British & Irish",
  "western-comfort": "Western / Comfort",
};
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const sourceBadge = (r) =>
  r.source === "ai-generated" ? { label: "AI", color: C.accent, bg: C.accentBg }
  : r.source === "imported" ? { label: "IMPORTED", color: C.carbText, bg: `${C.carb}22` }
  : null;

const density = (r) => (r.kcal > 0 ? (r.protein / r.kcal) * 100 : 0);

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
  if (recipe.mealCategory) return MEAL_CATEGORY_LABEL[recipe.mealCategory] || recipe.mealCategory;
  return recipe.slotType === "snack" ? "Snacks" : recipe.slotType === "either" ? "Meals or Snacks" : "Meals";
}
function cuisineGroupOf(recipe) {
  if (!recipe.cuisine) return "Uncategorized";
  return CUISINE_LABEL[recipe.cuisine] || recipe.cuisine[0].toUpperCase() + recipe.cuisine.slice(1);
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

function RecipeDetail({ recipe, profile, onSave, onDelete, inCart, onToggleCart, cartBusy }) {
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

  const scaled = useMemo(() => ({
    kcal: recipe.kcal * scale, protein: recipe.protein * scale,
    fat: recipe.fat * scale, carb: recipe.carb * scale,
  }), [recipe, scale]);

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
      setError(e.body?.invalidIngredients ? `${e.message}: ${e.body.invalidIngredients.map((p) => `${p.name} — ${p.reason}`).join("; ")}` : e.message);
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
      await api.placeRecipe({ ...placePick, recipeId: recipe.id, scale });
      setNotice(`Placed at ×${scale} into ${DAY_NAMES[placePick.dayOfWeek]} ${placePick.slotType} ${placePick.slotIndex + 1} — see the Plan tab.`);
      setPlacePick(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setPlacing(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${C.rule}` }} onClick={(e) => e.stopPropagation()}>
        <input className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
        <textarea className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} rows={2} value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Description" />
        <div className="grid grid-cols-3 gap-2 mb-2">
          <select className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.slotType}
            onChange={(e) => setDraft((d) => ({ ...d, slotType: e.target.value }))}>
            <option value="meal">meal</option><option value="snack">snack</option><option value="either">either</option>
          </select>
          <select className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.cuisine}
            onChange={(e) => setDraft((d) => ({ ...d, cuisine: e.target.value }))}>
            {CUISINES.map((c) => <option key={c} value={c}>{c ? (CUISINE_LABEL[c] || c) : "auto cuisine"}</option>)}
          </select>
          <input type="number" className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.prepTimeMin}
            onChange={(e) => setDraft((d) => ({ ...d, prepTimeMin: e.target.value }))} placeholder="prep min" />
        </div>
        <div className="text-xs font-bold mb-1.5" style={{ color: C.faint }}>Ingredients (grams / role / scalable)</div>
        {draft.ingredients.map((ing, idx) => (
          <div key={idx} className="flex gap-1.5 items-center mb-1.5">
            <span className="text-xs font-semibold flex-1 truncate" style={{ color: C.ink }}>{ing.name}</span>
            <input type="number" className="text-xs px-2 py-1.5 rounded-lg w-16" style={inpStyle} value={ing.grams}
              onChange={(e) => setIng(idx, { grams: e.target.value })} />
            <select className="text-xs px-1.5 py-1.5 rounded-lg" style={inpStyle} value={ing.role}
              onChange={(e) => setIng(idx, { role: e.target.value })}>
              {["protein", "carb", "veg", "fat", "dairy", "other"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input type="checkbox" checked={ing.scalable} onChange={(e) => setIng(idx, { scalable: e.target.checked })} style={{ accentColor: C.accent }} />
            <button onClick={() => removeIng(idx)} style={{ color: C.red }}><X size={13} /></button>
          </div>
        ))}
        <textarea className="text-xs px-3 py-2 rounded-xl w-full mt-2 mb-2" style={inpStyle} rows={3} value={draft.steps}
          onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))} placeholder="One step per line" />
        {error && <div className="text-xs font-semibold mb-2" style={{ color: C.red }}>{error}</div>}
        <div className="flex gap-2">
          <Btn small onClick={save} disabled={busy}><Save size={12} className="inline mr-1" />Save</Btn>
          <Btn small kind="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${C.rule}` }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className="text-[10.5px] font-extrabold uppercase tracking-wide mr-1" style={{ color: C.faintLight }}>Serving</span>
        {SCALES.map((s) => (
          <button key={s} onClick={() => setScale(s)}
            className="text-xs font-bold px-2.5 py-1 rounded-lg"
            style={{ background: scale === s ? C.accent : C.card, color: scale === s ? C.accentInk : C.faint, border: `1px solid ${scale === s ? C.accent : C.rule}` }}>
            ×{s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <MacroChips x={scaled} />
      </div>
      <div className="text-xs font-semibold mb-1.5" style={{ color: C.ink }}>
        {recipe.ingredients.map((i) => `${Math.round(i.baseGrams * (i.scalable ? scale : 1))}g ${i.food.name}`).join(" · ")}
      </div>
      {recipe.description && <div className="text-xs italic mb-1.5" style={{ color: C.faint }}>{recipe.description}</div>}
      <ol className="text-xs space-y-1 list-decimal list-inside mb-3" style={{ color: C.ink }}>
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
            <button onClick={() => setPlacePick(null)} style={{ color: C.faintLight }}><X size={13} /></button>
          </span>
        )}
        <Btn small kind="ghost" onClick={() => onToggleCart(recipe.id)} disabled={cartBusy}>
          {inCart ? <Check size={12} className="inline mr-1" /> : <ShoppingCart size={12} className="inline mr-1" />}
          {inCart ? "In cart" : "Add to cart"}
        </Btn>
        <Btn small kind="ghost" onClick={startEdit}><Pencil size={12} className="inline mr-1" />Edit</Btn>
        {confirmingDelete ? (
          <Btn small kind="red" onClick={() => onDelete(recipe.id)}>Confirm delete</Btn>
        ) : (
          <Btn small kind="ghost" onClick={() => setConfirmingDelete(true)}><Trash2 size={12} className="inline mr-1" />Delete</Btn>
        )}
      </div>
      {notice && <div className="text-xs font-semibold mt-2" style={{ color: C.good }}>{notice}</div>}
      {error && <div className="text-xs font-semibold mt-2" style={{ color: C.red }}>{error}</div>}
    </div>
  );
}

// ── draft card (AI + imported share it) ──────────────────────────────────

function DraftCard({ draft, onSave, onEditGrams, saving, saveError }) {
  const inpStyle = getInpStyle();
  return (
    <div className="p-3 rounded-2xl" style={{ background: C.card, border: `1.5px solid ${draft.source === "imported" ? C.carb : C.good}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-extrabold" style={{ color: C.ink }}>{draft.name}</div>
        {draft.source === "imported" && <Chip color={C.carbText} bg={`${C.carb}22`}>IMPORT PREVIEW</Chip>}
      </div>
      <div className="text-xs italic mb-1.5 font-semibold" style={{ color: C.faint }}>{draft.description}</div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {draft.kcal != null && <MacroChips x={draft} />}
        {draft.servings != null && <Chip>serves {draft.servings} (shown per serving)</Chip>}
      </div>
      {draft.importNotes?.length > 0 && (
        <div className="text-[10.5px] font-semibold mb-2 p-2 rounded-lg" style={{ color: C.warn, background: C.warnBg }}>
          {draft.importNotes.map((n, i) => <div key={i}>· {n}</div>)}
        </div>
      )}
      {draft.ingredients.map((ing, idx) => (
        <div key={idx} className="flex justify-between items-center text-xs py-1 font-semibold">
          <span style={{ color: C.ink }}>
            {ing.name} {ing.placeholderMacros && <span style={{ color: C.red }}>(no macro data — fix it in the Food database before saving)</span>}
          </span>
          <input type="number" className="text-xs px-2 py-1 rounded-lg w-16" style={inpStyle} value={ing.grams}
            onChange={(e) => onEditGrams(idx, e.target.value)} />
        </div>
      ))}
      <ol className="text-xs mt-2 space-y-1 list-decimal list-inside font-semibold" style={{ color: C.ink }}>
        {draft.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {saveError && <div className="text-xs font-semibold mt-2" style={{ color: C.red }}>{saveError}</div>}
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
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState("cuisine");
  const [sortBy, setSortBy] = useState("name");
  const [openGroups, setOpenGroups] = useState({});
  const [expandedId, setExpandedId] = useState(null);

  const [cartItems, setCartItems] = useState([]);
  const [cartBusyId, setCartBusyId] = useState(null);
  const [cartGroceryList, setCartGroceryList] = useState(null);
  const [cartGroceryBusy, setCartGroceryBusy] = useState(false);
  const [fillBusy, setFillBusy] = useState(false);
  const [cartNote, setCartNote] = useState(null);
  const cartRecipeIds = new Set(cartItems.map((i) => i.recipeId));

  const [form, setForm] = useState({ slotType: "meal", protein: "", cuisine: "", prepTimeMin: "", freeText: "", batchStyle: "single", allowAllergens: false });
  const [drafts, setDrafts] = useState(null);
  const [droppedForAllergies, setDroppedForAllergies] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [savingIdx, setSavingIdx] = useState(null);
  const [draftErrors, setDraftErrors] = useState({});

  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getRecipes();
      setRecipes(res.recipes);
      setHiddenCount(res.hiddenCount);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.getCart().then(setCartItems).catch(() => {});
  }, []);

  const toggleCart = async (recipeId) => {
    setCartBusyId(recipeId);
    try {
      if (cartRecipeIds.has(recipeId)) {
        await api.removeFromCart(recipeId);
        setCartItems((c) => c.filter((i) => i.recipeId !== recipeId));
      } else {
        const item = await api.addToCart(recipeId);
        setCartItems((c) => [item, ...c]);
      }
    } catch (e) {
      setError(e.message);
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
      const res = await api.fillTodayFromCart();
      setCartNote(`Placed ${res.placed} recipe(s) into today's plan${res.note ? ` — ${res.note}` : "."} See the Plan tab.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setFillBusy(false);
    }
  };

  const onGenerateCartGroceryList = async () => {
    setCartGroceryBusy(true);
    try {
      setCartGroceryList(await api.generateCartGroceryList());
    } catch (e) {
      setError(e.message);
    } finally {
      setCartGroceryBusy(false);
    }
  };
  const cartItemGrams = (i) => Math.round(i.purchase?.grams ?? i.preparedGrams ?? 0);
  const cartGroceryText = () =>
    cartGroceryList.items.map((i) => `${cartItemGrams(i)}g ${i.name}`).join("\n");

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setDrafts(null);
    setDraftErrors({});
    try {
      const res = await api.generateRecipeDrafts({ ...form, prepTimeMin: form.prepTimeMin ? +form.prepTimeMin : undefined });
      setDrafts(res.drafts.map((d) => ({ ...d, source: "ai-generated" })));
      setDroppedForAllergies(res.droppedForAllergies);
      // The allergen override is per-generation and never sticky.
      setForm((f) => ({ ...f, allowAllergens: false }));
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const { draft } = await api.importRecipe(importUrl.trim());
      setDrafts((ds) => [{ ...draft, source: "imported" }, ...(ds || [])]);
      setImportUrl("");
    } catch (e) {
      setError(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  const editDraftGrams = (draftIdx, ingIdx, grams) => {
    setDrafts((ds) => ds.map((d, i) => (i !== draftIdx ? d : { ...d, ingredients: d.ingredients.map((ing, x) => (x === ingIdx ? { ...ing, grams: +grams } : ing)) })));
  };

  const handleSaveDraft = async (idx) => {
    setSavingIdx(idx);
    setDraftErrors((e) => ({ ...e, [idx]: null }));
    try {
      const draft = drafts[idx];
      const saved = await api.saveRecipeDraft({
        name: draft.name, description: draft.description, cuisine: draft.cuisine,
        slotType: draft.slotType, prepTimeMin: draft.prepTimeMin, steps: draft.steps,
        source: draft.source === "imported" ? "imported" : undefined,
        ingredients: draft.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams, role: i.role, scalable: i.scalable })),
      });
      setRecipes((r) => [...r, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDrafts((ds) => ds.filter((_, i) => i !== idx));
    } catch (e) {
      const detail = e.body?.invalidIngredients
        ? `${e.message}: ${e.body.invalidIngredients.map((p) => `${p.name} — ${p.reason}`).join("; ")}`
        : e.message;
      setDraftErrors((errs) => ({ ...errs, [idx]: detail }));
    } finally {
      setSavingIdx(null);
    }
  };

  const handleUpdate = async (id, patch) => {
    const updated = await api.updateRecipe(id, patch);
    setRecipes((r) => r.map((x) => (x.id === id ? updated : x)).sort((a, b) => a.name.localeCompare(b.name)));
  };
  const handleDelete = async (id) => {
    await api.deleteRecipe(id);
    setRecipes((r) => r.filter((x) => x.id !== id));
    setExpandedId(null);
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
                <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
                <input placeholder="Paste a recipe URL…" value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleImport()}
                  className="text-sm pl-9 pr-3 py-2 rounded-xl w-full" style={inpStyle} />
              </div>
              <Btn small onClick={handleImport} disabled={importing}>{importing ? "Reading…" : "Import"}</Btn>
            </div>
            <div className="text-[10.5px] font-semibold mt-2" style={{ color: C.faintLight }}>
              Reads the site's standard recipe markup (schema.org) — no paid API. Amounts convert to grams with flagged estimates; you review before anything saves. USDA stays the nutrition source of truth.
            </div>
          </Card>

          <Card section="GENERATE" title="New recipe from AI">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={form.slotType}
                onChange={(e) => setForm((f) => ({ ...f, slotType: e.target.value }))}>
                <option value="meal">Meal</option><option value="snack">Snack</option>
              </select>
              <select className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={form.protein}
                onChange={(e) => setForm((f) => ({ ...f, protein: e.target.value }))}>
                {PROTEINS.map((p) => <option key={p} value={p}>{p || "Any protein"}</option>)}
              </select>
              <select className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={form.cuisine}
                onChange={(e) => setForm((f) => ({ ...f, cuisine: e.target.value }))}>
                {CUISINES.map((c) => <option key={c} value={c}>{c ? (CUISINE_LABEL[c] || c) : "Any cuisine"}</option>)}
              </select>
              <input type="number" placeholder="Max prep (min)" className="text-xs px-2 py-2 rounded-xl" style={inpStyle}
                value={form.prepTimeMin} onChange={(e) => setForm((f) => ({ ...f, prepTimeMin: e.target.value }))} />
            </div>
            <textarea placeholder="Anything else? e.g. 'something spicy, uses the crockpot'" rows={2}
              className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle}
              value={form.freeText} onChange={(e) => setForm((f) => ({ ...f, freeText: e.target.value }))} />
            <div className="flex flex-wrap gap-4 items-center mb-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.ink }}>
                <input type="radio" checked={form.batchStyle === "single"} onChange={() => setForm((f) => ({ ...f, batchStyle: "single" }))} style={{ accentColor: C.accent }} />
                Single serving
              </label>
              <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.ink }}>
                <input type="radio" checked={form.batchStyle === "batch"} onChange={() => setForm((f) => ({ ...f, batchStyle: "batch" }))} style={{ accentColor: C.accent }} />
                Batch-cook
              </label>
            </div>
            {/* Per-generation allergen override — deliberately loud, resets after every generation. */}
            <div className="p-2.5 rounded-xl mb-3" style={{ background: form.allowAllergens ? C.redBg : C.card2, border: `1.5px solid ${form.allowAllergens ? C.red : C.rule}` }}>
              <label className="flex items-center gap-2 text-xs font-extrabold cursor-pointer" style={{ color: form.allowAllergens ? C.red : C.faint }}>
                <input type="checkbox" checked={form.allowAllergens} onChange={(e) => setForm((f) => ({ ...f, allowAllergens: e.target.checked }))} style={{ accentColor: C.red }} />
                <AlertTriangle size={13} />
                ALLOW MY ALLERGENS — THIS GENERATION ONLY
              </label>
              {form.allowAllergens && (
                <div className="text-[10.5px] font-semibold mt-1 ml-6" style={{ color: C.red }}>
                  Diet & allergy rules from your Profile are suspended for the next generation only, then re-arm automatically.
                </div>
              )}
            </div>
            <Btn onClick={handleGenerate} disabled={generating}>
              <Sparkles size={13} className="inline mr-1" />{generating ? "Generating…" : drafts?.length ? "Regenerate 3 options" : "Generate 3 options"}
            </Btn>
          </Card>

          {droppedForAllergies.length > 0 && (
            <div className="text-xs font-semibold px-1" style={{ color: C.warn }}>
              Dropped {droppedForAllergies.length} option(s) for allergy rules: {droppedForAllergies.map((d) => `${d.name} (${d.reason})`).join(", ")}
            </div>
          )}

          {drafts && drafts.length > 0 && (
            <Card section="PREVIEW" title={`${drafts.length} draft(s) — review grams, then save`}>
              <div className="flex flex-col gap-3">
                {drafts.map((d, idx) => (
                  <DraftCard key={idx} draft={d} saving={savingIdx === idx} saveError={draftErrors[idx]}
                    onEditGrams={(ingIdx, grams) => editDraftGrams(idx, ingIdx, grams)}
                    onSave={() => handleSaveDraft(idx)} />
                ))}
              </div>
            </Card>
          )}

          <Card section="CART" title={`Cart (${cartItems.length})`}>
            {cartItems.length === 0 ? (
              <div className="text-sm font-semibold" style={{ color: C.faint }}>Add recipes from the library — the cart feeds today's plan and the grocery list.</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="text-[10.5px] font-extrabold uppercase tracking-wide self-center mr-1" style={{ color: C.faintLight }}>Totals</span>
                  <MacroChips x={cartTotals} />
                </div>
                <div className="flex flex-col gap-1.5 mb-3">
                  {cartItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 py-1" style={{ borderBottom: `1px solid ${C.rule}` }}>
                      <span className="text-sm font-semibold truncate" style={{ color: C.ink }}>{item.recipe?.name}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="mono text-xs font-bold" style={{ color: C.faintLight }}>{kc(item.recipe?.kcal || 0)} kcal</span>
                        <button onClick={() => toggleCart(item.recipeId)} disabled={cartBusyId === item.recipeId} style={{ color: C.red }} aria-label="Remove">
                          <Trash2 size={14} />
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
                {cartNote && <div className="text-xs font-semibold mt-2" style={{ color: C.good }}>{cartNote}</div>}
                {cartGroceryList && (
                  <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.rule}` }}>
                    <div className="flex gap-2 mb-2">
                      <a href={`sms:?&body=${encodeURIComponent("Grocery list:\n" + cartGroceryText())}`} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}>
                        <MessageSquare size={12} />Text
                      </a>
                      <a href={`mailto:?subject=${encodeURIComponent("Grocery list — from cart")}&body=${encodeURIComponent(cartGroceryText())}`} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}>
                        <Mail size={12} />Email
                      </a>
                    </div>
                    {Object.entries(cartGroceryList.bySection || {})
                      .filter(([, items]) => items.length > 0)
                      .map(([section, items]) => (
                        <div key={section} className="mb-2">
                          <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-0.5" style={{ color: C.faintLight }}>{SECTION_LABELS[section] || section}</div>
                          {items.map((i) => {
                            const grams = cartItemGrams(i);
                            const hh = toHouseholdUnit(i.name, grams);
                            return (
                              <div key={i.name} className="flex justify-between text-xs py-0.5 font-semibold" style={{ color: C.ink }}>
                                <span>{i.name}</span>
                                <span className="mono" style={{ color: C.faintLight }}>{grams}g{hh ? ` (≈${hh})` : ""}</span>
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
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
              <input placeholder={`Search ${recipes.length} recipes…`} className="text-sm pl-9 pr-3 py-2 rounded-xl w-full" style={inpStyle}
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select value={groupBy} onChange={(e) => { setGroupBy(e.target.value); setOpenGroups({}); }}
              className="text-xs px-2 py-2 rounded-xl" style={inpStyle}>
              <option value="cuisine">Group: Cuisine</option>
              <option value="mealtype">Group: Meal type</option>
              <option value="protein">Group: Protein</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              className="text-xs px-2 py-2 rounded-xl" style={inpStyle}>
              <option value="name">Sort: Name</option>
              <option value="kcal">Sort: kcal</option>
              <option value="density">Sort: Protein density</option>
            </select>
          </div>
          {hiddenCount > 0 && (
            <div className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: C.faintLight }}>
              <EyeOff size={12} /> {hiddenCount} recipe{hiddenCount === 1 ? "" : "s"} hidden by your diet & allergy rules.
            </div>
          )}

          {loading ? (
            <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {groups.map(([groupName, list]) => {
                const open = searching || !!openGroups[groupName];
                return (
                  <div key={groupName} className="rounded-2xl" style={{ background: C.card, border: `1px solid ${C.rule}`, boxShadow: "var(--shadow)" }}>
                    {!searching && (
                      <button onClick={() => setOpenGroups((s) => ({ ...s, [groupName]: !open }))}
                        className="w-full flex items-center gap-3 px-4 py-3.5">
                        {open ? <ChevronDown size={16} style={{ color: C.faint }} /> : <ChevronRight size={16} style={{ color: C.faint }} />}
                        <span className="text-sm font-extrabold flex-1 text-left" style={{ color: C.ink }}>{groupName}</span>
                        <span className="mono text-xs font-bold px-2 py-0.5 rounded-lg" style={{ color: C.faint, background: C.card2 }}>{list.length}</span>
                      </button>
                    )}
                    {open && (
                      <div className="px-3 pb-3 flex flex-col gap-2">
                        {list.map((r) => {
                          const badge = sourceBadge(r);
                          const expanded = expandedId === r.id;
                          return (
                            <div key={r.id} className="p-3 rounded-xl cursor-pointer" onClick={() => setExpandedId(expanded ? null : r.id)}
                              style={{ background: C.card2, border: `1px solid ${expanded ? C.accent : C.rule}` }}>
                              <div className="flex justify-between items-start gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-extrabold" style={{ color: C.ink }}>{r.name}</div>
                                  <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: C.faintLight }}>
                                    {r.slotType}{r.cuisine ? ` · ${CUISINE_LABEL[r.cuisine] || r.cuisine}` : ""}{r.prepTimeMin ? ` · ${r.prepTimeMin} min` : ""} · {g1(density(r))}g P/100kcal
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {badge && <Chip color={badge.color} bg={badge.bg}>{badge.label}</Chip>}
                                  <span className="mono text-sm font-extrabold" style={{ color: C.ink }}>{kc(r.kcal)}</span>
                                </div>
                              </div>
                              {expanded && (
                                <RecipeDetail recipe={r} profile={profile}
                                  onSave={handleUpdate} onDelete={handleDelete}
                                  inCart={cartRecipeIds.has(r.id)} onToggleCart={toggleCart} cartBusy={cartBusyId === r.id} />
                              )}
                            </div>
                          );
                        })}
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
