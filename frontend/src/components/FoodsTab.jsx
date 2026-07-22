import { useState, useEffect, useMemo } from "react";
import { Search, ArrowLeft, ChevronRight, ChevronDown, Save, BookOpen, NotebookPen, Barcode, AlertTriangle } from "lucide-react";
import { C } from "../lib/theme.js";
import { FOOD_CATEGORIES, CATEGORY_LABEL, CATEGORY_DOT, SOURCE_LABEL, dataQualityFlag } from "../data/foodCategories.js";
import { Card, Btn, Chip, PageHead, Stat, ErrorNote } from "./ui/Parts.jsx";
import { SkeletonRows } from "./ui/Skeleton.jsx";
import { api } from "../lib/api.js";
import BarcodeLookup from "./BarcodeLookup.jsx";

const g1 = (n) => Math.round(n * 10) / 10;
const SEARCH_RENDER_CAP = 200;

// Provenance must surface where a food is PICKED, not just after the fact
// in the detail panel — the whole crux of the barcode-off track. A small
// neutral-ink Barcode glyph marks community (Open Food Facts) rows right in
// the list; an amber triangle rides alongside it only when that row's own
// declared macros didn't reconcile (dataQuality "warn:…") — never a hue
// borrowed from the reserved green/macro-triad palette (design law a/c).
function FoodRow({ food, selected, onSelect, dotColor }) {
  const community = food.source === "community";
  const flag = community ? dataQualityFlag(food) : null;
  return (
    <button
      onClick={() => onSelect(food)}
      className="w-full flex items-center gap-2.5 py-2 px-2 rounded-lg text-left"
      style={{ background: selected ? C.card2 : "transparent", borderBottom: `1px solid ${C.rule}` }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }}></span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: C.ink }}>
          {community && <Barcode size={12} className="shrink-0" style={{ color: C.faintLight }} title="Community (Open Food Facts)" />}
          <span className="truncate">{food.name}</span>
          {flag && <AlertTriangle size={12} className="shrink-0" style={{ color: C.warn }} title={`Unverified macros — ${flag.reason}`} />}
        </div>
      </div>
      <div className="text-right shrink-0">
        <span className="mono text-sm font-extrabold" style={{ color: C.ink }}>{Math.round(food.kcal)}</span>
        <span className="text-[10.5px] font-semibold ml-1.5" style={{ color: C.faintLight }}>{g1(food.protein)}P {g1(food.fat)}F {g1(food.carb)}C</span>
      </div>
    </button>
  );
}

// Detail card: provenance, macros, and the actions that make a food USABLE —
// edit (admin), add to a recipe. "Log today" ships with the food diary.
function FoodDetail({ food, isAdmin, onSaved, refreshFoods }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [recipePicker, setRecipePicker] = useState(false);
  const [recipes, setRecipes] = useState(null);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [addBusyId, setAddBusyId] = useState(null);

  useEffect(() => {
    setDraft(null);
    setError(null);
    setNotice(null);
    setRecipePicker(false);
  }, [food.id]);

  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const inp = "text-sm px-3 py-2 rounded-xl w-full mt-1";
  const label = (t) => <span className="text-xs font-bold" style={{ color: C.faint }}>{t}</span>;

  const startEdit = () => setDraft({
    kcal: food.kcal, protein: food.protein, fat: food.fat, carb: food.carb,
    fiber: food.fiber, category: food.category,
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.putFood(food.id, {
        kcal: +draft.kcal, protein: +draft.protein, fat: +draft.fat,
        carb: +draft.carb, fiber: +draft.fiber, category: draft.category,
      });
      setDraft(null);
      setNotice(`Saved — ${res.recipesRecomputed} recipe(s) recomputed.`);
      await refreshFoods();
      onSaved(res.food);
    } catch (e) {
      setError(e.message + (e.status === 400 ? " (values must satisfy kcal ≈ 4P + 4C + 9F)" : ""));
    } finally {
      setBusy(false);
    }
  };

  const openRecipePicker = async () => {
    setRecipePicker(true);
    if (!recipes) setRecipes((await api.getRecipes()).recipes);
  };

  const addToRecipe = async (recipe) => {
    setAddBusyId(recipe.id);
    setError(null);
    try {
      const ingredients = [
        ...recipe.ingredients.map((i) => ({ foodId: i.foodId, grams: i.baseGrams, role: i.role, scalable: i.scalable })),
        { foodId: food.id, grams: 100, role: null, scalable: true },
      ];
      await api.updateRecipe(recipe.id, { ingredients });
      setNotice(`Added 100 g to "${recipe.name}" — adjust grams on the Recipes tab.`);
      setRecipePicker(false);
      setRecipes(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAddBusyId(null);
    }
  };

  const filteredRecipes = (recipes || []).filter((r) => r.name.toLowerCase().includes(recipeQuery.toLowerCase())).slice(0, 30);
  const placeholder = food.source === "manual-placeholder";
  const community = food.source === "community";
  const flag = community ? dataQualityFlag(food) : null;

  return (
    <Card section="DETAIL" title={food.name}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <Chip color={C.faint}>
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: CATEGORY_DOT(food.category) }}></span>
          {CATEGORY_LABEL[food.category] || food.category}
        </Chip>
        <Chip color={placeholder ? C.red : C.faint} bg={placeholder ? C.redBg : undefined}>
          {SOURCE_LABEL[food.source] || food.source}{food.fdcId ? ` · FDC ${food.fdcId}` : ""}{food.brand ? ` · ${food.brand}` : ""}{food.upc ? ` · UPC ${food.upc}` : ""}
        </Chip>
        {flag && (
          <Chip color={C.warn} bg={C.warnBg}>{flag.label} — {flag.reason}</Chip>
        )}
      </div>

      {placeholder && (
        <div className="text-xs font-bold mb-3" style={{ color: C.red }}>
          Zero-macro placeholder — recipes using this food undercount until real values are entered.
        </div>
      )}

      {community && (
        <div className="text-[10.5px] font-semibold mb-3" style={{ color: C.faintLight }}>
          Crowd-sourced from Open Food Facts, not USDA-audited — treat as a reasonable estimate, not a lab-verified figure.
        </div>
      )}

      {!draft ? (
        <>
          <div className="grid grid-cols-2 gap-x-4">
            <Stat label="Calories / 100 g" value={Math.round(food.kcal)} unit="kcal" big />
            <Stat label="Fiber" value={g1(food.fiber)} unit="g" />
            <Stat label="Protein" value={g1(food.protein)} unit="g" />
            <Stat label="Fat" value={g1(food.fat)} unit="g" />
            <Stat label="Carbs" value={g1(food.carb)} unit="g" />
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {isAdmin ? (
              <Btn small onClick={startEdit}>Edit</Btn>
            ) : (
              <span className="text-xs font-semibold self-center" style={{ color: C.faintLight }}>Editing is admin-only.</span>
            )}
            <Btn small kind="ghost" onClick={openRecipePicker}>
              <BookOpen size={12} className="inline mr-1" />Add to a recipe
            </Btn>
            <span title="Needs the food diary — not built yet">
              <Btn small kind="ghost" disabled>
                <NotebookPen size={12} className="inline mr-1" />Log today
              </Btn>
            </span>
          </div>
          <div className="text-[10.5px] font-semibold mt-2" style={{ color: C.faintLight }}>
            "Log today" unlocks when the food diary ships — no silent fake logging.
          </div>
        </>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">{label("kcal / 100 g")}
              <input type="number" value={draft.kcal} onChange={(e) => setDraft((d) => ({ ...d, kcal: e.target.value }))} className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Category")}
              <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} className={inp} style={inpStyle}>
                {FOOD_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
              </select>
            </label>
            <label className="block">{label("Protein g")}
              <input type="number" value={draft.protein} onChange={(e) => setDraft((d) => ({ ...d, protein: e.target.value }))} className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Fat g")}
              <input type="number" value={draft.fat} onChange={(e) => setDraft((d) => ({ ...d, fat: e.target.value }))} className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Carbs g")}
              <input type="number" value={draft.carb} onChange={(e) => setDraft((d) => ({ ...d, carb: e.target.value }))} className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Fiber g")}
              <input type="number" value={draft.fiber} onChange={(e) => setDraft((d) => ({ ...d, fiber: e.target.value }))} className={inp} style={inpStyle} />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <Btn small onClick={save} disabled={busy}><Save size={12} className="inline mr-1" />{busy ? "Saving…" : "Save"}</Btn>
            <Btn small kind="ghost" onClick={() => setDraft(null)} disabled={busy}>Cancel</Btn>
          </div>
          <div className="text-[10.5px] font-semibold mt-2" style={{ color: C.faintLight }}>
            The validator rejects values where kcal drifts from 4P + 4C + 9F, so bad data can't come back.
          </div>
        </div>
      )}

      {recipePicker && (
        <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.rule}` }}>
          <div className="text-xs font-bold mb-2" style={{ color: C.faint }}>Add 100 g of {food.name} to:</div>
          <input placeholder="Search recipes…" value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)}
            className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} />
          <div className="max-h-56 overflow-y-auto">
            {recipes === null ? (
              <SkeletonRows rows={3} />
            ) : (
              filteredRecipes.map((r) => (
                <button key={r.id} onClick={() => addToRecipe(r)} disabled={addBusyId === r.id}
                  className="w-full text-left text-sm font-semibold py-1.5 px-2 rounded-lg hover:opacity-80 flex justify-between"
                  style={{ color: C.ink, borderBottom: `1px solid ${C.rule}` }}>
                  <span className="truncate">{r.name}</span>
                  <span className="mono text-xs shrink-0" style={{ color: C.faintLight }}>{Math.round(r.kcal)} kcal</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <ErrorNote msg={error} hint="Edits must pass the nutrition sanity check (kcal ≈ 4P + 9F + 4C) — fix the macros so they agree with the calories." />
        </div>
      )}
      {notice && <div className="text-xs font-semibold mt-3" style={{ color: C.good }}>{notice}</div>}
    </Card>
  );
}

// Phase 2 UX: never render 900 rows in one endless scroll. Default view is
// collapsed category groups with counts; search flattens to matches only.
export default function FoodsTab({ onBack, isAdmin }) {
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState({});
  const [selected, setSelected] = useState(null);
  const [showBarcode, setShowBarcode] = useState(false);

  const refreshFoods = async () => setFoods(await api.getFoods());
  useEffect(() => {
    refreshFoods().finally(() => setLoading(false));
  }, []);

  const q = query.trim().toLowerCase();

  const byCategory = useMemo(() => {
    const m = Object.fromEntries(FOOD_CATEGORIES.map((c) => [c.slug, []]));
    for (const f of foods) (m[f.category] || (m[f.category] = [])).push(f);
    return m;
  }, [foods]);

  const searchResults = useMemo(
    () => (q ? foods.filter((f) => f.name.toLowerCase().includes(q)) : []),
    [foods, q]
  );

  return (
    <div>
      <PageHead title="Food database" sub={`${foods.length} foods · per 100 g · validated against kcal ≈ 4P + 4C + 9F`}>
        <Btn small kind="ghost" onClick={() => setShowBarcode((v) => !v)}>
          <Barcode size={12} className="inline mr-1" />{showBarcode ? "Hide barcode lookup" : "Add by barcode"}
        </Btn>
        <Btn small kind="ghost" onClick={onBack}>
          <ArrowLeft size={12} className="inline mr-1" />Back to Recipes
        </Btn>
      </PageHead>

      {showBarcode && (
        <div className="mb-4">
          <BarcodeLookup
            onClose={() => setShowBarcode(false)}
            onImported={async (food) => {
              await refreshFoods();
              setSelected(food);
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 min-w-0">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
            <input
              type="text" placeholder="Search all foods…" value={query} onChange={(e) => setQuery(e.target.value)}
              className="w-full text-sm pl-9 pr-3 py-2.5 rounded-xl"
              style={{ background: C.card, border: `1px solid ${C.rule}`, color: C.ink }}
            />
          </div>

          {loading ? (
            <SkeletonRows rows={7} />
          ) : q ? (
            <Card>
              <div className="text-xs font-semibold mb-1" style={{ color: C.faintLight }}>
                {searchResults.length} match{searchResults.length === 1 ? "" : "es"}
                {searchResults.length > SEARCH_RENDER_CAP && ` — showing first ${SEARCH_RENDER_CAP}, refine the search`}
              </div>
              {searchResults.slice(0, SEARCH_RENDER_CAP).map((f) => (
                <FoodRow key={f.id} food={f} selected={selected?.id === f.id} onSelect={setSelected} dotColor={CATEGORY_DOT(f.category)} />
              ))}
              {searchResults.length === 0 && <div className="text-sm font-semibold py-2" style={{ color: C.faint }}>No foods match.</div>}
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {FOOD_CATEGORIES.map((cat) => {
                const items = byCategory[cat.slug] || [];
                const open = !!openCats[cat.slug];
                return (
                  <div key={cat.slug} className="rounded-2xl glass-card">
                    <button
                      onClick={() => setOpenCats((s) => ({ ...s, [cat.slug]: !open }))}
                      className="w-full flex items-center gap-3 px-4 py-3.5"
                    >
                      {open ? <ChevronDown size={16} style={{ color: C.faint }} /> : <ChevronRight size={16} style={{ color: C.faint }} />}
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY_DOT(cat.slug) }}></span>
                      <span className="text-sm font-extrabold flex-1 text-left" style={{ color: C.ink }}>{cat.label}</span>
                      <span className="mono text-xs font-bold px-2 py-0.5 rounded-lg" style={{ color: C.faint, background: C.card2 }}>{items.length}</span>
                    </button>
                    {open && (
                      <div className="px-3 pb-3">
                        {items.map((f) => (
                          <FoodRow key={f.id} food={f} selected={selected?.id === f.id} onSelect={setSelected} dotColor={CATEGORY_DOT(cat.slug)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="xl:col-span-5 xl:sticky xl:top-8">
          {selected ? (
            <FoodDetail
              food={selected}
              isAdmin={isAdmin}
              refreshFoods={refreshFoods}
              onSaved={setSelected}
            />
          ) : (
            <Card>
              <div className="text-sm font-semibold" style={{ color: C.faint }}>
                Select a food to see its full breakdown, provenance, and actions — edit it or drop it into a recipe.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
