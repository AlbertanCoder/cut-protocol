import { useState, useEffect, useCallback } from "react";
import { Sparkles, Pencil, Trash2, Save, X, Search, ShoppingCart, Check, Mail, MessageSquare, Copy } from "lucide-react";
import { C } from "../lib/theme.js";
import { toHouseholdUnit } from "../lib/householdUnits.js";
import { Card, Btn, Chip } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";
import { FRIDGE, EXCLUDED, ROTATION, BATCH, SUPPS, SUPP_RULES, CHILI } from "../data/constants.js";
import { uiState } from "../lib/storage.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const g1 = (n) => Math.round(n * 10) / 10;
// Function, not a frozen module-level object, so each caller reads the
// live palette at render time and re-themes on toggle.
const getInpStyle = () => ({ background: C.paper, border: `1.5px solid ${C.rule}`, color: C.ink });
const CUISINES = ["", "weeknight", "steakhouse", "tex-mex", "breakfast", "weekend", "other"];
const PROTEINS = ["", "chicken", "beef", "elk/game", "salmon", "turkey", "eggs", "pork"];
// Matches groceryList.js's bySection keys exactly (same list PlanTab.jsx uses).
const SECTION_LABELS = { produce: "Produce", protein: "Protein", dairy: "Dairy", pantry: "Pantry / dry goods", spices: "Spices", other: "Other" };

function RecipeCard({ recipe, onSave, onDelete, expanded, onToggleExpand, inCart, onToggleCart, cartBusy }) {
  const inpStyle = getInpStyle();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

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
    try {
      await onSave(recipe.id, {
        name: draft.name, description: draft.description, cuisine: draft.cuisine,
        slotType: draft.slotType, prepTimeMin: draft.prepTimeMin ? +draft.prepTimeMin : null,
        steps: draft.steps.split("\n").map((s) => s.trim()).filter(Boolean),
        ingredients: draft.ingredients.map((i) => ({ foodId: i.foodId, grams: +i.grams, role: i.role, scalable: i.scalable })),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const setIng = (idx, patch) =>
    setDraft((d) => ({ ...d, ingredients: d.ingredients.map((i, x) => (x === idx ? { ...i, ...patch } : i)) }));
  const removeIng = (idx) => setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((_, x) => x !== idx) }));

  if (editing) {
    return (
      <div className="mb-3 p-3 rounded-2xl" style={{ background: C.card, border: `1.5px solid ${C.accent}` }}>
        <input className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
        <textarea className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} rows={2} value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="Description" />
        <div className="grid grid-cols-3 gap-2 mb-2">
          <select className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.slotType}
            onChange={(e) => setDraft((d) => ({ ...d, slotType: e.target.value }))}>
            <option value="meal">meal</option><option value="snack">snack</option><option value="either">either</option>
          </select>
          <input className="text-xs px-2 py-2 rounded-xl" style={inpStyle} value={draft.cuisine}
            onChange={(e) => setDraft((d) => ({ ...d, cuisine: e.target.value }))} placeholder="cuisine" />
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
            <input type="checkbox" checked={ing.scalable} onChange={(e) => setIng(idx, { scalable: e.target.checked })} />
            <button onClick={() => removeIng(idx)} style={{ color: C.red }}><X size={13} /></button>
          </div>
        ))}
        <textarea className="text-xs px-3 py-2 rounded-xl w-full mt-2 mb-2" style={inpStyle} rows={3} value={draft.steps}
          onChange={(e) => setDraft((d) => ({ ...d, steps: e.target.value }))} placeholder="One step per line" />
        <div className="flex gap-2">
          <Btn small onClick={save} disabled={busy}><Save size={12} className="inline mr-1" />Save</Btn>
          <Btn small kind="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2.5 p-3 rounded-2xl cursor-pointer" onClick={() => onToggleExpand(recipe.id)}
      style={{ background: C.card, border: `1px solid ${C.rule}` }}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="text-sm font-extrabold" style={{ color: C.ink }}>{recipe.name}</div>
          <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>{recipe.slotType} · {recipe.cuisine || "—"}</div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Chip>{kc(recipe.kcal)} kcal</Chip>
            <Chip color={C.protein} bg={`${C.protein}1F`}>{g1(recipe.protein)}P</Chip>
            <Chip color={C.fat} bg={`${C.fat}1F`}>{g1(recipe.fat)}F</Chip>
            <Chip color={C.carb} bg={`${C.carb}1F`}>{g1(recipe.carb)}C</Chip>
            {recipe.source === "ai-generated" && <Chip color={C.accent} bg={C.accentBg}>AI</Chip>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onToggleCart(recipe.id); }} disabled={cartBusy}
            style={{ color: inCart ? C.good : C.faintLight }} aria-label={inCart ? "Remove from cart" : "Add to cart"}>
            {inCart ? <Check size={16} /> : <ShoppingCart size={15} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); startEdit(); }} style={{ color: C.faintLight }} aria-label="Edit"><Pencil size={15} /></button>
          {confirmingDelete ? (
            <button onClick={(e) => { e.stopPropagation(); onDelete(recipe.id); }} className="text-xs font-bold" style={{ color: C.red }}>confirm?</button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }} style={{ color: C.faintLight }} aria-label="Delete"><Trash2 size={15} /></button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${C.rule}` }}>
          {recipe.description && <div className="text-xs italic mb-1.5" style={{ color: C.faint }}>{recipe.description}</div>}
          <div className="text-xs font-semibold mb-1.5" style={{ color: C.ink }}>
            {recipe.ingredients.map((i) => `${i.baseGrams}g ${i.food.name}`).join(" · ")}
          </div>
          <ol className="text-xs space-y-1 list-decimal list-inside" style={{ color: C.ink }}>
            {recipe.steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

function CartRecipeCard({ item, expanded, onToggleExpand, onRemove, busy }) {
  const recipe = item.recipe;
  return (
    <div className="mb-2.5 p-3 rounded-2xl cursor-pointer" onClick={() => onToggleExpand(item.recipeId)}
      style={{ background: C.card, border: `1px solid ${C.rule}` }}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="text-sm font-extrabold" style={{ color: C.ink }}>{recipe.name}</div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <Chip>{kc(recipe.kcal)} kcal</Chip>
            <Chip color={C.protein} bg={`${C.protein}1F`}>{g1(recipe.protein)}P</Chip>
            <Chip color={C.fat} bg={`${C.fat}1F`}>{g1(recipe.fat)}F</Chip>
            <Chip color={C.carb} bg={`${C.carb}1F`}>{g1(recipe.carb)}C</Chip>
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(item.recipeId); }} disabled={busy}
          style={{ color: C.red }} aria-label="Remove from cart"><Trash2 size={15} /></button>
      </div>
      {expanded && (
        <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${C.rule}` }}>
          {recipe.description && <div className="text-xs italic mb-1.5" style={{ color: C.faint }}>{recipe.description}</div>}
          <div className="text-xs font-semibold mb-1.5" style={{ color: C.ink }}>
            {recipe.ingredients.map((i) => `${i.baseGrams}g ${i.food.name}`).join(" · ")}
          </div>
          <ol className="text-xs space-y-1 list-decimal list-inside" style={{ color: C.ink }}>
            {recipe.steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft, onSave, onEditGrams, saving }) {
  const inpStyle = getInpStyle();
  return (
    <div className="mb-3 p-3 rounded-2xl" style={{ background: C.card, border: `1.5px solid ${C.good}` }}>
      <div className="text-sm font-extrabold" style={{ color: C.ink }}>{draft.name}</div>
      <div className="text-xs italic mb-1.5 font-semibold" style={{ color: C.faint }}>{draft.description}</div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <Chip>{kc(draft.kcal)} kcal</Chip>
        <Chip color={C.protein} bg={`${C.protein}1F`}>{g1(draft.protein)}P</Chip>
        <Chip color={C.fat} bg={`${C.fat}1F`}>{g1(draft.fat)}F</Chip>
        <Chip color={C.carb} bg={`${C.carb}1F`}>{g1(draft.carb)}C</Chip>
        <Chip>serves {draft.servings}</Chip>
      </div>
      {draft.ingredients.map((ing, idx) => (
        <div key={idx} className="flex justify-between items-center text-xs py-1 font-semibold">
          <span style={{ color: C.ink }}>
            {ing.name} {ing.placeholderMacros && <span style={{ color: C.red }}>(no macro data — edit before trusting this)</span>}
          </span>
          <input type="number" className="text-xs px-2 py-1 rounded-lg w-16" style={inpStyle} value={ing.grams}
            onChange={(e) => onEditGrams(idx, e.target.value)} />
        </div>
      ))}
      <ol className="text-xs mt-2 space-y-1 list-decimal list-inside font-semibold" style={{ color: C.ink }}>
        {draft.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="mt-2.5">
        <Btn small onClick={onSave} disabled={saving}><Save size={12} className="inline mr-1" />Save to library</Btn>
      </div>
    </div>
  );
}

// Renders this account's fridge contents, supplement dosing schedule, and a
// chili recipe (FRIDGE/EXCLUDED/ROTATION/BATCH/SUPPS/SUPP_RULES/CHILI, all
// from data/constants.js) - fixed content from the pre-multi-tenancy
// single-user version of this app, not something any other account should
// see. Only rendered for isAdmin (see the caller below) until this becomes
// real per-user data.
function ReferenceSection() {
  const [done, setDone] = useState(uiState.get().fridgeDone);
  const toggle = (id) => setDone(uiState.setFridgeDone(id, !done[id]).fridgeDone);
  const phase1Done = FRIDGE.every((f) => done[f.id]);

  return (
    <details className="mb-3">
      <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer px-1" style={{ color: C.faintLight }}>
        Reference — fridge burn-down, rotation, supplements
      </summary>
      <div className="mt-2">
        <div className="mb-3">
          <Chip color={phase1Done ? C.good : C.warn} bg={phase1Done ? C.goodBg : C.warnBg}>
            {phase1Done ? "Phase 2 — steady state" : "Phase 1 — fridge burn-down"}
          </Chip>
        </div>

        <Card section="§5" title="Fridge burn-down — fixed slots">
          <div className="text-xs font-semibold mb-2" style={{ color: C.faint }}>
            Items rent slots. Nothing rides on top of the plan. Check off when gone.
          </div>
          {FRIDGE.map((f) => (
            <label key={f.id} className="flex items-start gap-3 py-2 cursor-pointer"
              style={{ borderBottom: `1px solid ${C.rule}`, opacity: done[f.id] ? 0.45 : 1 }}>
              <input type="checkbox" checked={!!done[f.id]} onChange={() => toggle(f.id)}
                className="mt-1 w-4 h-4 shrink-0" style={{ accentColor: C.good }} />
              <div className="min-w-0">
                <div className="text-sm font-bold flex flex-wrap gap-x-2 items-baseline" style={{ color: C.ink, textDecoration: done[f.id] ? "line-through" : "none" }}>
                  {f.name}
                  <span className="text-xs font-semibold" style={{ color: C.accent }}>{f.portion}</span>
                </div>
                <div className="text-xs font-semibold" style={{ color: C.faint }}>{f.rule}</div>
              </div>
            </label>
          ))}
          <div className="mt-3 p-2.5 rounded-xl" style={{ background: C.redBg, border: `1px solid ${C.red}55` }}>
            <div className="text-xs font-extrabold uppercase tracking-wide mb-1" style={{ color: C.red }}>Excluded</div>
            {EXCLUDED.map((x) => (
              <div key={x} className="text-xs font-semibold" style={{ color: C.ink }}>{x}</div>
            ))}
          </div>
        </Card>

        <Card section="§6" title="Dinner rotation — equal swaps">
          {ROTATION.map((r) => (
            <div key={r.main} className="flex justify-between items-baseline py-1.5 gap-2"
              style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span className="text-sm font-semibold" style={{ color: C.ink }}>
                {r.main} <span className="text-xs font-semibold" style={{ color: C.faint }}>{r.amt}</span>
              </span>
              <span className="text-xs text-right font-bold" style={{ color: r.butter === "NO butter" ? C.red : C.faint }}>
                {r.butter}{r.note && <span style={{ color: C.faint }}> · {r.note}</span>}
              </span>
            </div>
          ))}
        </Card>

        <Card section="§6" title="Sunday batch — ~1 hr">
          {BATCH.map((b, i) => (
            <div key={i} className="flex gap-2 py-1.5 text-sm font-semibold" style={{ borderBottom: `1px solid ${C.rule}`, color: C.ink }}>
              <span className="text-xs pt-0.5 font-extrabold" style={{ color: C.accent }}>{String(i + 1).padStart(2, "0")}</span>
              {b}
            </div>
          ))}
          <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
            Groceries ~$110–125/wk · Superstore West Edmonton
          </div>
        </Card>

        <details className="mb-3 px-1">
          <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer" style={{ color: C.faintLight }}>
            Street chili — saved recipe
          </summary>
          <div className="text-xs mt-2 space-y-2 font-semibold" style={{ color: C.ink }}>
            <div>{CHILI.ing}</div>
            <div style={{ color: C.faint }}>{CHILI.steps}</div>
          </div>
        </details>

        <details className="mb-3 px-1">
          <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer" style={{ color: C.faintLight }}>
            §7 supplement stack
          </summary>
          <div className="mt-2">
            {SUPPS.map((s) => (
              <div key={s.t} className="flex gap-3 py-1.5 text-xs font-semibold" style={{ borderBottom: `1px solid ${C.rule}` }}>
                <span className="font-extrabold w-10 shrink-0" style={{ color: C.accent }}>{s.t}</span>
                <span style={{ color: C.ink }}>{s.s}</span>
              </div>
            ))}
            <div className="mt-2 space-y-1">
              {SUPP_RULES.map((r) => (
                <div key={r} className="text-xs font-semibold" style={{ color: C.faint }}>· {r}</div>
              ))}
            </div>
          </div>
        </details>

        <div className="text-xs font-bold px-1" style={{ color: C.red }}>
          Allergy-level: shellfish · kiwi · soy protein (soybean oil OK). No pork as weekly staple.
        </div>
      </div>
    </details>
  );
}

export default function RecipesTab({ isAdmin }) {
  const inpStyle = getInpStyle();
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const toggleExpand = (id) => setExpandedId((cur) => (cur === id ? null : id));

  const [cartItems, setCartItems] = useState([]);
  const [cartLoading, setCartLoading] = useState(true);
  const [cartBusyId, setCartBusyId] = useState(null);
  const [expandedCartId, setExpandedCartId] = useState(null);
  const [cartGroceryList, setCartGroceryList] = useState(null);
  const [cartGroceryBusy, setCartGroceryBusy] = useState(false);
  const [cartGroceryError, setCartGroceryError] = useState(null);
  const cartRecipeIds = new Set(cartItems.map((i) => i.recipeId));

  const loadCart = useCallback(async () => {
    try {
      setCartItems(await api.getCart());
    } catch (e) {
      setError(e.message);
    } finally {
      setCartLoading(false);
    }
  }, []);
  useEffect(() => { loadCart(); }, [loadCart]);

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

  const onGenerateCartGroceryList = async () => {
    setCartGroceryBusy(true);
    setCartGroceryError(null);
    try {
      setCartGroceryList(await api.generateCartGroceryList());
    } catch (e) {
      setCartGroceryError(e.message);
    } finally {
      setCartGroceryBusy(false);
    }
  };

  // Fresh POST response only (no stale/reloaded shape to guard against here,
  // unlike PlanTab's grocery list - the cart grocery list is never persisted,
  // it's regenerated live each time), so no defensive fallbacks needed.
  const cartItemGrams = (i) => Math.round(i.purchase?.grams ?? i.preparedGrams ?? 0);
  const cartItemForm = (i) => i.purchase?.form ?? "";
  const cartGroceryText = () =>
    cartGroceryList.items.map((i) => `${cartItemGrams(i)}g${cartItemForm(i) ? ` (${cartItemForm(i)})` : ""} ${i.name}`).join("\n");
  const copyCartGroceryList = () => navigator.clipboard?.writeText(cartGroceryText());
  const cartGrocerySmsHref = () => `sms:?&body=${encodeURIComponent("Grocery list:\n" + cartGroceryText())}`;
  const cartGroceryMailtoHref = () => `mailto:?subject=${encodeURIComponent("Grocery list — from cart")}&body=${encodeURIComponent(cartGroceryText())}`;

  const [form, setForm] = useState({ slotType: "meal", protein: "", cuisine: "", prepTimeMin: "", freeText: "", batchStyle: "single", allowAllergens: false });
  const [drafts, setDrafts] = useState(null);
  const [droppedForAllergies, setDroppedForAllergies] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [savingIdx, setSavingIdx] = useState(null);

  const load = useCallback(async () => {
    try {
      setRecipes(await api.getRecipes());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setDrafts(null);
    try {
      const res = await api.generateRecipeDrafts({
        ...form, prepTimeMin: form.prepTimeMin ? +form.prepTimeMin : undefined,
      });
      setDrafts(res.drafts);
      setDroppedForAllergies(res.droppedForAllergies);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const editDraftGrams = (draftIdx, ingIdx, grams) => {
    setDrafts((ds) => ds.map((d, i) => (i !== draftIdx ? d : { ...d, ingredients: d.ingredients.map((ing, x) => (x === ingIdx ? { ...ing, grams: +grams } : ing)) })));
  };

  const handleSaveDraft = async (idx) => {
    setSavingIdx(idx);
    try {
      const draft = drafts[idx];
      const saved = await api.saveRecipeDraft({
        name: draft.name, description: draft.description, cuisine: draft.cuisine,
        slotType: draft.slotType, prepTimeMin: draft.prepTimeMin, steps: draft.steps,
        ingredients: draft.ingredients.map((i) => ({ foodId: i.foodId, grams: i.grams, role: i.role, scalable: i.scalable })),
      });
      setRecipes((r) => [...r, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDrafts((ds) => ds.filter((_, i) => i !== idx));
    } catch (e) {
      setError(e.message);
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
  };

  const filtered = recipes.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
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
            {CUISINES.map((c) => <option key={c} value={c}>{c || "Any cuisine"}</option>)}
          </select>
          <input type="number" placeholder="Max prep (min)" className="text-xs px-2 py-2 rounded-xl" style={inpStyle}
            value={form.prepTimeMin} onChange={(e) => setForm((f) => ({ ...f, prepTimeMin: e.target.value }))} />
        </div>
        <textarea placeholder="Anything else? e.g. 'something spicy, uses the crockpot'" rows={2}
          className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle}
          value={form.freeText} onChange={(e) => setForm((f) => ({ ...f, freeText: e.target.value }))} />
        <div className="flex flex-wrap gap-4 items-center mb-3">
          <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.ink }}>
            <input type="radio" checked={form.batchStyle === "single"} onChange={() => setForm((f) => ({ ...f, batchStyle: "single" }))} />
            Single serving
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.ink }}>
            <input type="radio" checked={form.batchStyle === "batch"} onChange={() => setForm((f) => ({ ...f, batchStyle: "batch" }))} />
            Batch-cook
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.red }}>
            <input type="checkbox" checked={form.allowAllergens} onChange={(e) => setForm((f) => ({ ...f, allowAllergens: e.target.checked }))} />
            Allow allergens this time
          </label>
        </div>
        <Btn onClick={handleGenerate} disabled={generating}>
          <Sparkles size={13} className="inline mr-1" />{generating ? "Generating…" : drafts ? "Regenerate all 3" : "Generate 3 options"}
        </Btn>
      </Card>

      {error && <div className="text-xs font-semibold px-1 mb-3" style={{ color: C.red }}>{error}</div>}

      {droppedForAllergies.length > 0 && (
        <div className="text-xs font-semibold px-1 mb-3" style={{ color: C.warn }}>
          Dropped {droppedForAllergies.length} option(s) for allergy rules: {droppedForAllergies.map((d) => `${d.name} (${d.reason})`).join(", ")}
        </div>
      )}

      {drafts && (
        <Card section="PREVIEW" title={`${drafts.length} option(s) — edit grams, then save`}>
          {drafts.length === 0 ? (
            <div className="text-sm font-semibold" style={{ color: C.faint }}>No options survived — try regenerating or allowing allergens.</div>
          ) : (
            drafts.map((d, idx) => (
              <DraftCard key={idx} draft={d} saving={savingIdx === idx}
                onEditGrams={(ingIdx, grams) => editDraftGrams(idx, ingIdx, grams)}
                onSave={() => handleSaveDraft(idx)} />
            ))
          )}
        </Card>
      )}

      <Card section="CART" title={`Cart (${cartItems.length})`}>
        {cartLoading ? (
          <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
        ) : cartItems.length === 0 ? (
          <div className="text-sm font-semibold" style={{ color: C.faint }}>Tap the cart icon on any recipe below to collect it here.</div>
        ) : (
          <>
            {cartItems.map((item) => (
              <CartRecipeCard key={item.id} item={item} expanded={expandedCartId === item.recipeId}
                onToggleExpand={(id) => setExpandedCartId((cur) => (cur === id ? null : id))}
                onRemove={toggleCart} busy={cartBusyId === item.recipeId} />
            ))}
            <div className="flex gap-2 mt-1">
              <Btn small onClick={onGenerateCartGroceryList} disabled={cartGroceryBusy}>
                <ShoppingCart size={12} className="inline mr-1" />
                {cartGroceryList ? "Regenerate from cart" : "Generate grocery list from cart"}
              </Btn>
              {cartGroceryList && (
                <Btn small kind="ghost" onClick={copyCartGroceryList}>
                  <Copy size={12} className="inline mr-1" />Copy
                </Btn>
              )}
            </div>
            {cartGroceryError && <div className="text-xs font-semibold mt-2" style={{ color: C.red }}>{cartGroceryError}</div>}
            {cartGroceryList && (
              <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.rule}` }}>
                <div className="flex gap-2 mb-3">
                  <a href={cartGrocerySmsHref()} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: C.paper, border: `1px solid ${C.rule}`, color: C.ink }}>
                    <MessageSquare size={12} />Text
                  </a>
                  <a href={cartGroceryMailtoHref()} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: C.paper, border: `1px solid ${C.rule}`, color: C.ink }}>
                    <Mail size={12} />Email
                  </a>
                </div>
                {Object.entries(cartGroceryList.bySection || {})
                  .filter(([, items]) => items.length > 0)
                  .map(([section, items]) => (
                    <div key={section} className="mb-2.5">
                      <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-1" style={{ color: C.faintLight }}>{SECTION_LABELS[section] || section}</div>
                      {items.map((i) => {
                        const grams = cartItemGrams(i);
                        const hh = toHouseholdUnit(i.name, grams);
                        return (
                          <div key={i.name} className="flex justify-between text-sm py-1" style={{ borderBottom: `1px solid ${C.rule}` }}>
                            <span className="font-semibold" style={{ color: C.ink }}>{i.name}</span>
                            <span className="mono text-xs font-bold text-right" style={{ color: C.faint }}>
                              {grams}g{hh ? ` (≈${hh})` : ""} {cartItemForm(i)}
                              {i.cost != null && <span style={{ color: C.faintLight }}> · ${i.cost.amountCad.toFixed(2)}</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                <div className="text-xs font-semibold mt-1 pt-2" style={{ color: C.faint, borderTop: `1px solid ${C.rule}` }}>
                  {cartGroceryList.totalEstimatedCostCad != null && <>Est. total: <b style={{ color: C.ink }}>${cartGroceryList.totalEstimatedCostCad.toFixed(2)} CAD</b> · </>}
                  {cartGroceryList.costCoverageNote}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <Card section="LIBRARY" title={`Recipes (${recipes.length})`}>
        <div className="relative mb-2.5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
          <input placeholder="Search…" className="text-sm pl-9 pr-3 py-2 rounded-xl w-full" style={inpStyle}
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {loading ? (
          <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
        ) : (
          filtered.map((r) => (
            <RecipeCard key={r.id} recipe={r} onSave={handleUpdate} onDelete={handleDelete}
              expanded={expandedId === r.id} onToggleExpand={toggleExpand}
              inCart={cartRecipeIds.has(r.id)} onToggleCart={toggleCart} cartBusy={cartBusyId === r.id} />
          ))
        )}
      </Card>

      {isAdmin && <ReferenceSection />}
    </div>
  );
}
