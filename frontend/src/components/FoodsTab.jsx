import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Search, ArrowLeft, ChevronRight, ChevronDown, Save, BookOpen, NotebookPen, Barcode, AlertTriangle, UtensilsCrossed } from "lucide-react";
import { FOOD_CATEGORIES, CATEGORY_DOT, categoryLabel, sourceLabel, foodWarning, quarantineNote } from "../data/foodCategories.js";
import { Card, Btn, Chip, PageHead, Stat, ErrorNote, EmptyNote } from "./ui/Parts.jsx";
import { SkeletonRows } from "./ui/Skeleton.jsx";
import { api, isAbortError, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";
import BarcodeLookup from "./BarcodeLookup.jsx";

const g1 = (n) => Math.round(n * 10) / 10;
const num = (n) => Number(n || 0).toLocaleString();

// ── The food library store ───────────────────────────────────────────────
// GET /api/foods is 14,122 rows / ~13.1 MB / ~1.1 s, and this tab UNMOUNTS on
// every tab switch — so the old per-mount fetch re-paid all of that every
// single time the screen was opened. The library is shared, slow-changing
// reference data; it belongs in a module store, not in component state that
// dies when you glance at Recipes.
//
// Two separate wins:
//  1. the request is inflight-deduped and cached, so the 2nd…nth open is
//     instant and costs zero bytes;
//  2. what we KEEP is a projection — the 13 fields this screen renders.
//     `Food.micros` alone is 6.9 MB of JSON per payload, for a screen that
//     never shows a micronutrient. The parse still materialises it (only the
//     server can stop sending it — see readFoodsPayload), but it becomes
//     garbage the instant the projection is built instead of being pinned in
//     React state for the life of the app.
const FOODS_TTL_MS = 5 * 60_000;
const PROJECTED_FIELDS = [
  "id", "name", "category", "source", "kcal", "protein", "fat", "carb",
  "fiber", "fdcId", "brand", "upc", "dataQuality",
];

let foodsCache = null;    // { at, list, total }
let foodsInflight = null; // Promise<{ list, total }>

function project(f) {
  const out = {};
  for (const k of PROJECTED_FIELDS) out[k] = f[k];
  // Search index, built once at load instead of lower-casing 14,122 names on
  // every keystroke (see the search memo below).
  out.lname = String(f.name || "").toLowerCase();
  return out;
}

// Defensive shape reader. A parallel change is adding pagination + a `select`
// projection to GET /api/foods; today it answers with a bare array, tomorrow
// it may answer { foods, total } / { items, page }. Accept every shape rather
// than rendering "0 foods" the hour that lands — and carry `total` through so
// a paged response is REPORTED as partial instead of silently truncating the
// library behind the user's back.
function readFoodsPayload(res) {
  const rows =
    Array.isArray(res) ? res
      : Array.isArray(res?.foods) ? res.foods
        : Array.isArray(res?.items) ? res.items
          : Array.isArray(res?.data) ? res.data
            : Array.isArray(res?.results) ? res.results
              : [];
  const declared = res && !Array.isArray(res) ? (res.total ?? res.count ?? null) : null;
  return { rows, total: Number.isFinite(declared) ? declared : rows.length };
}

function cachedFoods() {
  return foodsCache && Date.now() - foodsCache.at < FOODS_TTL_MS ? foodsCache : null;
}

function loadFoods({ force = false } = {}) {
  if (force) { foodsCache = null; foodsInflight = null; }
  const hit = cachedFoods();
  if (hit) return Promise.resolve(hit);
  if (foodsInflight) return foodsInflight;
  // Deliberately NOT wired to a component unmount signal: the point of the
  // store is that switching tabs mid-flight still WARMS it rather than
  // throwing away a second of work. Callers guard their own setState.
  foodsInflight = api.getFoods()
    .then((res) => {
      const { rows, total } = readFoodsPayload(res);
      foodsCache = { at: Date.now(), list: rows.map(project), total };
      return foodsCache;
    })
    .finally(() => { foodsInflight = null; });
  return foodsInflight;
}

// Provenance must surface where a food is PICKED, not just after the fact
// in the detail panel — the whole crux of the barcode-off track. A small
// neutral-ink Barcode glyph marks community (Open Food Facts) rows right in
// the list; an amber triangle rides alongside it whenever that row carries a
// caution — unreconciled declared macros, or the far worse case of another
// food's record copied verbatim (see quarantineNote). Amber, never a hue
// borrowed from the reserved green/macro-triad palette (design law a/c) and
// never red on food data (law b).
//
// Height is PINNED to ROW_H: the list below is windowed, and windowing needs
// row geometry it can trust. A single-line row (the name truncates) loses
// nothing by being a fixed 38px — it is what the padded row measured anyway.
const ROW_H = 38;

function FoodRow({ food, selected, onSelect, dotColor }) {
  const community = food.source === "community";
  const warn = foodWarning(food);
  return (
    <button
      onClick={() => onSelect(food)}
      className="w-full flex items-center gap-2.5 px-2 rounded-lg text-left"
      style={{ height: ROW_H, background: selected ? "var(--secondary)" : "transparent", borderBottom: "1px solid var(--border)" }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }}></span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: "var(--foreground)" }}>
          {/* a11y: the provenance glyph is information, not ambience — it is
              the only thing marking a row as crowd-sourced, so it reads at
              --faint (60%), not --faint-light (38%, 3.26:1). */}
          {community && <Barcode size={12} className="shrink-0" style={{ color: "var(--muted-foreground)" }} title="Community (Open Food Facts)" />}
          <span className="truncate">{food.name}</span>
          {warn && <AlertTriangle size={12} className="shrink-0" style={{ color: "var(--warn)" }} title={warn.detail} />}
        </div>
      </div>
      <div className="text-right shrink-0">
        <span className="tabular-nums text-sm font-extrabold" style={{ color: "var(--foreground)" }}>{Math.round(food.kcal)}</span>
        <span className="text-[10.5px] font-semibold ml-1.5" style={{ color: "var(--muted-foreground)" }}>{g1(food.protein)}P {g1(food.fat)}F {g1(food.carb)}C</span>
      </div>
    </button>
  );
}

// ── Windowed list ────────────────────────────────────────────────────────
// This replaces the app's worst render offender: expanding "Protein" used to
// mount 3,867 FoodRow subtrees in one synchronous commit (the "never render
// 900 rows" comment above it was written when the whole library was 854 foods
// and never revisited after the USDA import took it to 14,122).
//
// Why windowing and not a render cap: a cap is the honest 10-minute fix for
// SEARCH, where "refine your search" is a real instruction the user can act
// on. It is not honest for BROWSE — category browse exists precisely for the
// case where you don't know the name, so "showing 200 of 3,867, refine your
// search" amputates the feature and points at the affordance that browse is
// the alternative to. react-window would be the drop-in, but it isn't a
// dependency and installing is off the table, so the window is hand-rolled:
// ~90 lines, fixed row height, absolute-positioned slice inside a spacer.
// Mounted rows go from N to (visible + 2×overscan) ≈ 24, flat, whether the
// list is 40 rows or 14,122.
const OVERSCAN = 6;
const MAX_VISIBLE_ROWS = 12;

function VirtualFoodList({ items, label, maxRows = MAX_VISIBLE_ROWS, selectedId, onSelect, dotFor }) {
  const [scrollTop, setScrollTop] = useState(0);
  const boxRef = useRef(null);
  const ticking = useRef(false);

  const total = items.length;
  const height = Math.min(total, maxRows) * ROW_H;

  // A new list (new search, different category) starts at the top — never
  // half-scrolled into results the user hasn't seen.
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [items]);

  // rAF-coalesced: scroll fires far faster than we can usefully re-render,
  // and reading scrollTop inside the frame means we never render a stale
  // offset (which a leading-edge throttle would).
  const onScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      setScrollTop(boxRef.current?.scrollTop ?? 0);
    });
  }, []);

  if (total === 0) return null;

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(total, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN);

  return (
    // tabIndex makes the window keyboard-scrollable: only the visible rows
    // are in the tab order, so arrow-key scrolling is how a keyboard user
    // reaches row 3,000 without 3,000 tab stops.
    <div
      ref={boxRef}
      onScroll={onScroll}
      role="group"
      aria-label={label}
      tabIndex={0}
      className="overflow-y-auto overscroll-contain rounded-lg"
      style={{ height }}
    >
      <div style={{ height: total * ROW_H, position: "relative" }}>
        <div style={{ position: "absolute", top: first * ROW_H, left: 0, right: 0 }}>
          {items.slice(first, last).map((f) => (
            <FoodRow key={f.id} food={f} selected={selectedId === f.id} onSelect={onSelect} dotColor={dotFor(f)} />
          ))}
        </div>
      </div>
    </div>
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
  const [recipeError, setRecipeError] = useState(null); // NOT the same as "no recipes"
  const [recipeQuery, setRecipeQuery] = useState("");
  const [addBusyId, setAddBusyId] = useState(null);
  const abort = useAbortSignal();

  useEffect(() => {
    setDraft(null);
    setError(null);
    setNotice(null);
    setRecipePicker(false);
    setRecipeError(null);
  }, [food.id]);

  const inpStyle = { background: "var(--secondary)", border: "1.5px solid var(--border)", color: "var(--foreground)" };
  const inp = "text-sm px-3 py-2 rounded-xl w-full mt-1";
  const label = (t) => <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>{t}</span>;

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
      }, { signal: abort.signal });
      setDraft(null);
      setNotice(`Saved — ${res.recipesRecomputed} recipe(s) recomputed.`);
      // The save already succeeded; a failed list refresh is reported by the
      // list itself and must not be re-told here as a failed save.
      await refreshFoods().catch(() => {});
      onSaved(res.food);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e) + (e.status === 400 ? " (values must satisfy kcal ≈ 4P + 4C + 9F)" : ""));
    } finally {
      setBusy(false);
    }
  };

  // Guarded (frontend-arch-4): this was an unguarded async handler — a failed
  // GET /recipes threw into the global rejection handler (crash dialog) and
  // left the picker showing skeleton rows forever.
  const openRecipePicker = async () => {
    setRecipePicker(true);
    if (recipes) return;
    setRecipeError(null);
    try {
      const res = await api.getRecipes({ signal: abort.signal });
      setRecipes(res.recipes);
    } catch (e) {
      if (isAbortError(e)) return;
      setRecipeError(describeError(e, "Couldn't load your recipes."));
    }
  };

  const addToRecipe = async (recipe) => {
    setAddBusyId(recipe.id);
    setError(null);
    try {
      const ingredients = [
        ...recipe.ingredients.map((i) => ({ foodId: i.foodId, grams: i.baseGrams, role: i.role, scalable: i.scalable })),
        { foodId: food.id, grams: 100, role: null, scalable: true },
      ];
      await api.updateRecipe(recipe.id, { ingredients }, { signal: abort.signal });
      setNotice(`Added 100 g to "${recipe.name}" — adjust grams on the Recipes tab.`);
      setRecipePicker(false);
      setRecipes(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setAddBusyId(null);
    }
  };

  const filteredRecipes = (recipes || []).filter((r) => r.name.toLowerCase().includes(recipeQuery.toLowerCase())).slice(0, 30);
  const placeholder = food.source === "manual-placeholder";
  const community = food.source === "community";
  const warn = foodWarning(food);

  return (
    <Card section="DETAIL" title={food.name}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        <Chip color={"var(--muted-foreground)"}>
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: CATEGORY_DOT(food.category) }}></span>
          {categoryLabel(food.category)}
        </Chip>
        {/* Law b: a zero-macro placeholder is BAD DATA, not a bad food. It
            gets the same calm amber as the UNVERIFIED MACROS badge beside it
            — the two are the same class of problem and used to be shouted in
            two different colors. Red on food data is reserved for nothing. */}
        <Chip color={placeholder ? "var(--warn)" : "var(--muted-foreground)"} bg={placeholder ? "color-mix(in srgb, var(--warn) 12%, transparent)" : undefined}>
          {sourceLabel(food.source)}{food.fdcId ? ` · USDA record #${food.fdcId}` : ""}{food.brand ? ` · ${food.brand}` : ""}{food.upc ? ` · UPC ${food.upc}` : ""}
        </Chip>
        {warn && <Chip color={"var(--warn)"} bg={"color-mix(in srgb, var(--warn) 12%, transparent)"}>{warn.label}</Chip>}
      </div>

      {warn && (
        <div className="text-xs font-semibold mb-3" style={{ color: "var(--warn)" }}>
          {warn.detail}
          {quarantineNote(food) && " Don't build a plan on this row until it's corrected."}
        </div>
      )}

      {placeholder && (
        <div className="text-xs font-bold mb-3" style={{ color: "var(--warn)" }}>
          Zero-macro placeholder — recipes using this food undercount until real values are entered.
        </div>
      )}

      {community && (
        // a11y: body copy reads at --faint (60%, 6.5:1+). --faint-light is
        // 3.26:1 and fails WCAG AA at text sizes.
        <div className="text-[10.5px] font-semibold mb-3" style={{ color: "var(--muted-foreground)" }}>
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
              <span className="text-xs font-semibold self-center" style={{ color: "var(--muted-foreground)" }}>Editing is admin-only.</span>
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
          <div className="text-[10.5px] font-semibold mt-2" style={{ color: "var(--muted-foreground)" }}>
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
          <div className="text-[10.5px] font-semibold mt-2" style={{ color: "var(--muted-foreground)" }}>
            The validator rejects values where kcal drifts from 4P + 4C + 9F, so numbers that can't exist can't come back.
          </div>
        </div>
      )}

      {recipePicker && (
        <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="text-xs font-bold mb-2" style={{ color: "var(--muted-foreground)" }}>Add 100 g of {food.name} to:</div>
          <input placeholder="Search recipes…" value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)}
            className="text-sm px-3 py-2 rounded-xl w-full mb-2" style={inpStyle} />
          <div className="max-h-56 overflow-y-auto">
            {recipeError ? (
              // An error must never be drawn as "you have no recipes".
              <ErrorNote msg={`Couldn't load your recipes — ${recipeError}`} hint="Close and reopen this picker to retry." />
            ) : recipes === null ? (
              <SkeletonRows rows={3} />
            ) : recipes.length === 0 ? (
              <div className="text-sm font-semibold py-2" style={{ color: "var(--muted-foreground)" }}>You have no recipes yet — create one on the Recipes tab.</div>
            ) : (
              filteredRecipes.map((r) => (
                <button key={r.id} onClick={() => addToRecipe(r)} disabled={addBusyId === r.id}
                  className="w-full text-left text-sm font-semibold py-1.5 px-2 rounded-lg hover:opacity-80 flex justify-between"
                  style={{ color: "var(--foreground)", borderBottom: "1px solid var(--border)" }}>
                  <span className="truncate">{r.name}</span>
                  <span className="tabular-nums text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>{Math.round(r.kcal)} kcal</span>
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
      {notice && <div className="text-xs font-semibold mt-3" style={{ color: "var(--primary)" }}>{notice}</div>}
    </Card>
  );
}

// Search over 14,122 names ran on EVERY keystroke, lower-casing every name
// each time. Two fixes: the lower-cased name is precomputed once at load
// (`lname`), and the query is debounced so a burst of typing costs one filter
// pass instead of one per character. Results stay on screen while the debounce
// settles — the list never blanks mid-word.
const SEARCH_DEBOUNCE_MS = 160;

function useDebounced(value, ms) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const NO_MATCHES = [];

// Default view is collapsed category groups with counts; search flattens to
// matches only. Both lists are windowed (see VirtualFoodList) — at 14,122
// foods, "just render them" is not on the table in either mode.
export default function FoodsTab({ onBack, isAdmin, backLabel = "Recipes" }) {
  // Seeded straight from the module store: reopening this tab must not flash
  // a skeleton for data we already hold.
  const [foods, setFoods] = useState(() => cachedFoods()?.list || []);
  const [serverTotal, setServerTotal] = useState(() => cachedFoods()?.total ?? null);
  const [loading, setLoading] = useState(() => !cachedFoods());
  const [loadError, setLoadError] = useState(null); // NEVER rendered as "0 foods"
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState({});
  const [selected, setSelected] = useState(null);
  const [showBarcode, setShowBarcode] = useState(false);

  // useAbortSignal hands out a FRESH controller once the old one is aborted,
  // so `abort.signal.aborted` can't be used as a liveness test after unmount.
  // The store's fetch is intentionally unsignalled anyway (it keeps warming
  // the cache); this ref is what guards setState.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // frontend-arch-4: this used to be `refreshFoods().finally(...)` — a failed
  // GET /foods was an unhandled rejection AND left `foods` at [], so the whole
  // screen rendered "0 foods" with every category empty. A user reads that as
  // "my food database is gone." A load failure now says so, explicitly, and
  // offers a retry; it is never drawn as an empty database.
  const hydrate = useCallback(async (force) => {
    if (alive.current) setLoadError(null);
    try {
      const store = await loadFoods({ force });
      if (alive.current) {
        setFoods(store.list);
        setServerTotal(store.total);
      }
      return store.list;
    } catch (e) {
      if (isAbortError(e)) return [];
      if (alive.current) setLoadError(describeError(e, "Couldn't load the food database."));
      throw e; // callers that await this (e.g. an admin save) still see it
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  // Anything that WROTE to the library invalidates it; a plain mount does not.
  const refreshFoods = useCallback(() => hydrate(true), [hydrate]);

  useEffect(() => {
    hydrate(false).catch(() => {}); // surfaced via loadError, never a crash dialog
  }, [hydrate]);

  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const q = debounced.trim().toLowerCase();
  const settling = query.trim().toLowerCase() !== q;

  const byCategory = useMemo(() => {
    const m = Object.fromEntries(FOOD_CATEGORIES.map((c) => [c.slug, []]));
    for (const f of foods) (m[f.category] || (m[f.category] = [])).push(f);
    return m;
  }, [foods]);

  const searchResults = useMemo(() => {
    if (!q) return NO_MATCHES;
    const out = [];
    for (const f of foods) if ((f.lname || "").includes(q)) out.push(f);
    return out;
  }, [foods, q]);

  // The 470 rows that carry another food's record verbatim. Counting them is
  // one pass at load; saying the number out loud is the difference between a
  // library that is honest about its own state and one that isn't.
  const suspectCount = useMemo(() => foods.reduce((n, f) => n + (quarantineNote(f) ? 1 : 0), 0), [foods]);

  // A paged endpoint that hands back fewer rows than it says it has must be
  // reported, not silently browsed as if it were the whole library.
  const partial = serverTotal != null && serverTotal > foods.length;

  const dotOf = (f) => CATEGORY_DOT(f.category);

  return (
    <div>
      <PageHead
        title="Food database"
        sub={loadError
          ? "Couldn't load the food database — the count below is not a real count."
          : loading
            ? "Loading your foods…"
            // The Atwater check is NOT a warrant of correctness and must not
            // be sold as one: 470 rows in this library carry another food's
            // macros verbatim and pass it perfectly (a real USDA tuple, just
            // the wrong record). Say what the check actually does.
            : `${num(foods.length)} foods · per 100 g · calories are cross-checked against each row's own protein, carbs and fat — that catches impossible numbers, not another food's numbers filed under the right name`}
      >
        <Btn small kind="ghost" onClick={() => setShowBarcode((v) => !v)}>
          <Barcode size={12} className="inline mr-1" />{showBarcode ? "Hide barcode lookup" : "Add by barcode"}
        </Btn>
        {/* This said "Back to Recipes" and went to Recipes no matter where you
            arrived from (Recipes OR Engine) — the destination was true, the
            word "Back" was not. Naming the destination only is honest for
            every caller. `backLabel` lets a caller name a different one once
            Foods gets a real nav entry of its own. */}
        <Btn small kind="ghost" onClick={onBack}>
          <ArrowLeft size={12} className="inline mr-1" />{backLabel}
        </Btn>
      </PageHead>

      {showBarcode && (
        <div className="mb-4">
          <BarcodeLookup
            onClose={() => setShowBarcode(false)}
            // Guarded: a failed refresh after an import must not throw out of
            // the callback into the crash dialog — the import itself succeeded.
            onImported={async (food) => {
              setSelected(food);
              await refreshFoods().catch(() => {});
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 min-w-0">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <input
              type="text" placeholder="Search all foods…" aria-label="Search all foods" value={query} onChange={(e) => setQuery(e.target.value)}
              className="w-full text-sm pl-9 pr-3 py-2.5 rounded-xl"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
            />
          </div>

          {!loading && !loadError && suspectCount > 0 && (
            <div className="text-xs font-semibold mb-3 px-1" style={{ color: "var(--warn)" }}>
              {num(suspectCount)} of these rows are known to carry another food's numbers. They're marked with an amber triangle and explain themselves when you open them.
            </div>
          )}

          {partial && (
            <div className="text-xs font-semibold mb-3 px-1" style={{ color: "var(--warn)" }}>
              The server sent {num(foods.length)} of {num(serverTotal)} foods — this page isn't showing the whole library yet.
            </div>
          )}

          {loading ? (
            <SkeletonRows rows={7} />
          ) : loadError ? (
            // The failed-load state. Distinct from an empty database in both
            // words and shape — an empty state would say "no foods", this says
            // the load broke and offers the retry.
            <Card>
              <ErrorNote msg={`Couldn't load the food database — ${loadError}`}
                hint="Your foods are still on disk; this is a load failure, not a deletion. Retry below, or restart the app if it keeps failing." />
              <div className="mt-3">
                <Btn small onClick={() => { setLoading(true); refreshFoods().catch(() => {}); }}>Retry</Btn>
              </div>
            </Card>
          ) : foods.length === 0 ? (
            <Card>
              <EmptyNote
                icon={UtensilsCrossed}
                title="The food database is empty"
                hint="Add a food by barcode above, or reseed the library."
              />
            </Card>
          ) : q ? (
            <Card>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--muted-foreground)" }}>
                {num(searchResults.length)} match{searchResults.length === 1 ? "" : "es"}{settling ? " · searching…" : ""}
              </div>
              {searchResults.length === 0 ? (
                <div className="text-sm font-semibold py-2" style={{ color: "var(--muted-foreground)" }}>No foods match.</div>
              ) : (
                <VirtualFoodList
                  items={searchResults}
                  label={`${searchResults.length} foods matching "${q}"`}
                  maxRows={14}
                  selectedId={selected?.id}
                  onSelect={setSelected}
                  dotFor={dotOf}
                />
              )}
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {FOOD_CATEGORIES.map((cat) => {
                const items = byCategory[cat.slug] || [];
                const open = !!openCats[cat.slug];
                return (
                  <div key={cat.slug} className="rounded-2xl bg-card border border-border">
                    <button
                      onClick={() => setOpenCats((s) => ({ ...s, [cat.slug]: !open }))}
                      aria-expanded={open}
                      className="w-full flex items-center gap-3 px-4 py-3.5"
                    >
                      {open ? <ChevronDown size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" /> : <ChevronRight size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />}
                      <span className="w-2.5 h-2.5 rounded-full" aria-hidden="true" style={{ background: CATEGORY_DOT(cat.slug) }}></span>
                      <span className="text-sm font-extrabold flex-1 text-left" style={{ color: "var(--foreground)" }}>{cat.label}</span>
                      <span className="tabular-nums text-xs font-bold px-2 py-0.5 rounded-lg" style={{ color: "var(--muted-foreground)", background: "var(--secondary)" }}>{num(items.length)}</span>
                    </button>
                    {open && (
                      <div className="px-3 pb-3">
                        {items.length === 0 ? (
                          <div className="text-sm font-semibold py-2 px-2" style={{ color: "var(--muted-foreground)" }}>No foods in this category yet.</div>
                        ) : (
                          <VirtualFoodList
                            items={items}
                            label={`${items.length} foods in ${cat.label}`}
                            selectedId={selected?.id}
                            onSelect={setSelected}
                            dotFor={() => CATEGORY_DOT(cat.slug)}
                          />
                        )}
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
              <EmptyNote
                icon={UtensilsCrossed}
                title="No food selected"
                hint="Pick any food on the left to see its full breakdown, where its numbers came from, and what you can do with it."
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
