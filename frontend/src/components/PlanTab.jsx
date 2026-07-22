import { useState, useEffect, useCallback } from "react";
import {
  Lock, LockOpen, RefreshCw, ChefHat, ShoppingCart, Copy, Utensils, Apple,
  MessageCircle, Mail, Sparkles, Check, AlertTriangle, X, ArrowRight, Beef,
} from "lucide-react";
import { toHouseholdUnit } from "../lib/householdUnits.js";
import { C } from "../lib/theme.js";
import { addDays, fmtD } from "../lib/dates.js";
import { proteinPriorityPref } from "../lib/storage.js";
import { Card, Btn, Chip, PageHead, ErrorNote } from "./ui/Parts.jsx";
import { Skeleton, SkeletonRows } from "./ui/Skeleton.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const g1 = (n) => Math.round(n * 10) / 10;
const SECTION_LABELS = {
  produce: "Produce", protein: "Protein", dairy: "Dairy", pantry: "Pantry / dry goods", spices: "Spices", other: "Other",
  carb: "Carbs", veg: "Veg", fat: "Fats", fruit: "Fruit",
  "dairy-eggs": "Dairy & Eggs", "fruit-veg": "Fruit & Veg", "grains": "Grains & Carbs",
  "fats-nuts-oils": "Fats, Nuts & Oils", "drinks": "Drinks",
};
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CUISINE_OPTIONS = [
  { key: "mexican", label: "Mexican" }, { key: "italian", label: "Italian" },
  { key: "mediterranean", label: "Mediterranean" }, { key: "asian", label: "Asian" },
  { key: "indian", label: "Indian" }, { key: "middle-eastern", label: "Middle Eastern" },
  { key: "british-irish", label: "British & Irish" }, { key: "western-comfort", label: "Western / Comfort" },
];
const PROTEIN_OPTIONS = ["", "chicken", "beef", "turkey", "salmon", "fish", "eggs", "tofu", "lentil"];
const PREP_OPTIONS = [{ v: null, l: "Any prep time" }, { v: 15, l: "≤ 15 min" }, { v: 30, l: "≤ 30 min" }, { v: 45, l: "≤ 45 min" }, { v: 60, l: "≤ 60 min" }];

function sumSlots(slots) {
  return slots.reduce((t, s) => ({ kcal: t.kcal + s.kcal, protein: t.protein + s.protein, fat: t.fat + s.fat, carb: t.carb + s.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
}

// Candidate/alternate → the payload accept-day/apply expects (server
// rebuilds names + macros itself; we only nominate ids and grams).
const toApplyPayload = (s) => ({
  slotType: s.slotType, slotIndex: s.slotIndex, recipeId: s.recipeId,
  proteinScale: s.proteinScale, sidesScale: s.sidesScale,
  ingredients: (s.ingredients || []).map((i) => ({ foodId: i.foodId, grams: i.grams })),
  warning: s.warning || undefined,
});

// ── filters bar ──────────────────────────────────────────────────────────

function FiltersBar({ filters, setFilters, proteinFloorSource }) {
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const toggleCuisine = (key) =>
    setFilters((f) => ({ ...f, cuisines: f.cuisines.includes(key) ? f.cuisines.filter((c) => c !== key) : [...f.cuisines, key] }));
  const setProteinPriority = (on) => {
    proteinPriorityPref.set(on);
    setFilters((f) => ({ ...f, proteinPriority: on }));
  };
  return (
    <Card section="FILTERS" title="Steer the solver">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CUISINE_OPTIONS.map((c) => {
          const on = filters.cuisines.includes(c.key);
          return (
            <button key={c.key} onClick={() => toggleCuisine(c.key)}
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={{ background: on ? C.card2 : "transparent", color: on ? C.ink : C.faint, border: `1px solid ${on ? C.faintLight : C.rule}` }}>
              {c.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <select value={filters.protein} onChange={(e) => setFilters((f) => ({ ...f, protein: e.target.value }))}
          className="text-xs px-2 py-2 rounded-xl" style={inpStyle}>
          {PROTEIN_OPTIONS.map((p) => <option key={p} value={p}>{p ? `Prefer ${p}` : "Any protein"}</option>)}
        </select>
        <select value={filters.budget || ""} onChange={(e) => setFilters((f) => ({ ...f, budget: e.target.value || null }))}
          className="text-xs px-2 py-2 rounded-xl" style={inpStyle}>
          <option value="">Any budget</option>
          <option value="cheap">Cheap</option>
          <option value="moderate">Moderate</option>
          <option value="premium">Premium</option>
        </select>
        <select value={filters.maxPrepMin ?? ""} onChange={(e) => setFilters((f) => ({ ...f, maxPrepMin: e.target.value ? +e.target.value : null }))}
          className="text-xs px-2 py-2 rounded-xl" style={inpStyle}>
          {PREP_OPTIONS.map((p) => <option key={p.l} value={p.v ?? ""}>{p.l}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs font-semibold px-1" style={{ color: C.ink }}>
          <input type="checkbox" checked={filters.allowBatchRepeats}
            onChange={(e) => setFilters((f) => ({ ...f, allowBatchRepeats: e.target.checked }))}
            style={{ accentColor: C.accent }} />
          Batch-cooking repeats OK
        </label>
      </div>
      <div className="text-[10.5px] font-semibold mt-2" style={{ color: C.faintLight }}>
        Cuisine / protein / budget bias the solver; diet & allergies from your Profile hard-filter it; max prep is a hard cap.
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.rule}` }}>
        <label className="flex items-start gap-2.5 text-sm font-bold cursor-pointer" style={{ color: C.ink }}>
          <input type="checkbox" checked={filters.proteinPriority}
            onChange={(e) => setProteinPriority(e.target.checked)}
            className="mt-0.5" style={{ accentColor: C.protein }} />
          <span className="flex items-center gap-1.5">
            <Beef size={14} style={{ color: C.proteinText }} />
            Protein-priority mode
          </span>
        </label>
        <div className="text-[10.5px] font-semibold mt-1 ml-6" style={{ color: C.faintLight }}>
          Makes the solver defend your protein floor instead of trading it off against calories — a candidate that misses it is ranked lower and the miss is always reported, never absorbed into an otherwise-good match score.
          {proteinFloorSource && (
            <> Floor basis: {proteinFloorSource.label} — {proteinFloorSource.detail}</>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── solver narration ──────────────────────────────────────────────────────
// An honest, plain-language readout of what the last generation actually did,
// from the generate response `meta`. Neutral by law: green is reserved for
// on-target/success/hero, so the score reads in ink (not accent) and the pool
// funnel in faint. Degrades to nothing if meta — or any field — is absent.
function SolverNarration({ meta }) {
  if (!meta) return null;
  const pc = meta.poolCounts || {};
  // score may arrive as a 0–1 fraction or a 0–100 percent — normalize either.
  const pct = typeof meta.score === "number" ? Math.round(meta.score <= 1 ? meta.score * 100 : meta.score) : null;
  // "Best of N" only if the response actually carries an attempt count.
  const bestOf = typeof meta.attempts === "number" ? meta.attempts
    : typeof meta.bestOf === "number" ? meta.bestOf : null;
  const funnel = [
    pc.raw != null && { n: pc.raw, l: "recipes" },
    pc.afterDiet != null && { n: pc.afterDiet, l: "after your diet" },
    pc.afterPrep != null && { n: pc.afterPrep, l: "within prep time" },
  ].filter(Boolean);
  const diag = meta.diagnosis;
  const diagText = typeof diag === "string" ? diag
    : diag && Array.isArray(diag.reasons) ? diag.reasons.join(" · ") : null;
  const infeasible = diag && typeof diag === "object" && diag.feasible === false;
  // Protein-priority mode's week-level honesty readout — only present when
  // the mode was on for this generation (see scoreWeek's opts.proteinPriority).
  const floorMet = typeof meta.score?.floorDaysMet === "number" ? meta.score.floorDaysMet : null;
  const floorTotal = typeof meta.score?.floorDaysTotal === "number" ? meta.score.floorDaysTotal : null;

  if (pct == null && bestOf == null && funnel.length === 0 && !diagText && floorMet == null) return null;

  return (
    <Card section="SOLVER" title="What the solver did">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {bestOf != null && <Chip>Best of {bestOf}</Chip>}
        {pct != null && (
          <div className="flex items-baseline gap-1.5">
            <span className="mono stat-hero text-2xl" style={{ color: C.ink }}>{pct}%</span>
            <span className="text-xs font-semibold" style={{ color: C.faint }}>match to your targets</span>
          </div>
        )}
        {floorMet != null && (
          <div className="flex items-center gap-1.5">
            <Beef size={13} style={{ color: C.proteinText }} />
            <span className="text-xs font-bold" style={{ color: floorMet === floorTotal ? C.ink : C.warn }}>
              Protein floor defended {floorMet}/{floorTotal} days
            </span>
          </div>
        )}
        {funnel.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-semibold flex-wrap" style={{ color: C.faint }}>
            {funnel.map((f, i) => (
              <span key={f.l} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={12} style={{ color: C.faintLight }} />}
                <b className="mono" style={{ color: C.ink }}>{kc(f.n)}</b> {f.l}
              </span>
            ))}
          </div>
        )}
      </div>
      {diagText && (
        <div className="text-xs font-semibold mt-2" style={{ color: infeasible ? C.warn : C.faint }}>
          {infeasible ? "→ " : ""}{diagText}
        </div>
      )}
    </Card>
  );
}

// ── day candidate cards ──────────────────────────────────────────────────

function DayCandidates({ data, targetKcal, onAccept, accepting }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {data.candidates.map((c, idx) => (
        <div key={idx} className="p-4 rounded-2xl flex flex-col" style={{ background: C.card, border: `1px solid ${idx === 0 ? C.accent : C.rule}` }}>
          <div className="flex items-baseline justify-between mb-1">
            <span className="mono stat-hero text-3xl" style={{ color: idx === 0 ? C.accent : C.ink }}>{c.score.matchPct}%</span>
            <span className="text-[10px] font-bold uppercase" style={{ color: C.faintLight }}>{idx === 0 ? "Best match" : `Option ${idx + 1}`}</span>
          </div>
          <div className="mono text-xs font-bold mb-2" style={{ color: C.faint }}>
            {kc(c.score.totals.kcal)} / {kc(targetKcal)} kcal · {c.score.totals.protein}P {c.score.totals.fat}F {c.score.totals.carb}C
          </div>
          {c.score.proteinFloor && (
            <div className="flex items-center gap-1.5 mb-2 text-[10.5px] font-bold" style={{ color: c.score.proteinFloor.met ? C.faint : C.warn }}>
              <Beef size={11} style={{ color: c.score.proteinFloor.met ? C.proteinText : C.warn }} />
              {c.score.proteinFloor.met
                ? `Protein floor met (${c.score.proteinFloor.achievedG}g / ${c.score.proteinFloor.floorG}g)`
                : `Protein floor short by ${c.score.proteinFloor.shortG}g`}
            </div>
          )}
          <div className="flex flex-col gap-1.5 flex-1 mb-3">
            {c.slots.map((s, i) => (
              <div key={i} className="flex justify-between gap-2 text-xs font-semibold py-1" style={{ borderBottom: `1px solid ${C.rule}` }}>
                <span className="truncate" style={{ color: C.ink }}>
                  {s.slotType === "snack" ? "🥨 " : ""}{s.recipeName || "—"}
                  {s.warning && <AlertTriangle size={10} className="inline ml-1" style={{ color: C.warn }} />}
                </span>
                <span className="mono shrink-0" style={{ color: C.faintLight }}>{kc(s.kcal)}</span>
              </div>
            ))}
          </div>
          <Btn small onClick={() => onAccept(c)} disabled={accepting}>
            <Check size={12} className="inline mr-1" />{accepting ? "Writing…" : "Accept this day"}
          </Btn>
        </div>
      ))}
    </div>
  );
}

// ── slot card with alternates ────────────────────────────────────────────

function SlotCard({ plan, slot, expanded, onToggleExpand, onLockToggle, busy, filters, reloadPlan, onCart, inCart }) {
  const recipe = slot.recipe;
  const Icon = slot.slotType === "snack" ? Apple : Utensils;
  const roleColor = slot.ingredients?.[0]?.role === "carb" ? C.carb : slot.ingredients?.[0]?.role === "fat" ? C.fat : C.protein;
  const [alts, setAlts] = useState(null);
  const [altBusy, setAltBusy] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [error, setError] = useState(null);

  const loadAlternates = async (e) => {
    e.stopPropagation();
    setAltBusy(true);
    setError(null);
    try {
      const res = await api.getSlotAlternates(plan.id, slot.id, filters);
      setAlts(res.alternates);
    } catch (err) {
      setError(err.message);
    } finally {
      setAltBusy(false);
    }
  };

  const applyAlternate = async (alt) => {
    setApplyingId(alt.recipeId);
    setError(null);
    try {
      await api.applySlotAlternate(plan.id, slot.id, toApplyPayload({ ...alt, slotType: slot.slotType, slotIndex: slot.slotIndex }));
      setAlts(null);
      await reloadPlan();
    } catch (err) {
      setError(err.message);
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="p-3.5 rounded-2xl row-host" onClick={() => onToggleExpand(slot.id)}
      style={{ background: C.card, border: `1px solid ${C.rule}` }}>
      <div className="flex gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${roleColor}22` }}>
          <Icon size={19} style={{ color: roleColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between items-start gap-2">
            <div className="text-left min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: C.faintLight }}>{slot.slotType}</div>
              <div className="text-sm font-extrabold" style={{ color: C.ink }}>{recipe ? recipe.name : "—"}</div>
            </div>
            {/* Hover-revealed actions (cart, swap); the lock stays visible
                because it displays STATE, not just an action. */}
            <div className="flex gap-1.5 shrink-0">
              {recipe && (
                <button onClick={(e) => { e.stopPropagation(); onCart(recipe.id); }}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${inCart ? "" : "row-reveal"}`}
                  style={{ color: inCart ? C.good : C.faint, background: C.card2, border: `1px solid ${C.rule}` }}
                  aria-label={inCart ? "Remove from cart" : "Add to cart"} title={inCart ? "Remove from cart" : "Add to cart"}>
                  {inCart ? <Check size={14} /> : <ShoppingCart size={14} />}
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); onLockToggle(slot); }} disabled={busy}
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${slot.locked ? "" : "row-reveal"}`}
                style={{ color: slot.locked ? C.ink : C.faint, background: C.card2, border: `1px solid ${C.rule}` }} aria-label="Toggle lock">
                {slot.locked ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
              {!slot.locked && (
                <button onClick={loadAlternates} disabled={altBusy}
                  className="w-7 h-7 rounded-lg flex items-center justify-center row-reveal"
                  style={{ color: C.faint, background: C.card2, border: `1px solid ${C.rule}` }} aria-label="Swap — show alternates" title="Swap — show 3 alternates">
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Chip>{kc(slot.kcal)} kcal</Chip>
            <Chip color={C.proteinText} bg={`${C.protein}1F`}>{g1(slot.protein)}P</Chip>
            <Chip color={C.fatText} bg={`${C.fat}1F`}>{g1(slot.fat)}F</Chip>
            <Chip color={C.carbText} bg={`${C.carb}1F`}>{g1(slot.carb)}C</Chip>
          </div>
          {slot.warning && (
            <div className="mt-1.5">
              <div className="text-xs font-semibold" style={{ color: C.warn }}>{slot.warning}</div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: C.faintLight }}>
                → Fix it with the swap button (3 alternates), or regenerate with looser filters.
              </div>
            </div>
          )}
          {error && (
            <div className="mt-1.5">
              <ErrorNote msg={error} hint="Swap and lock still work — retry, or regenerate the week if this slot is stuck." />
            </div>
          )}

          {altBusy && !alts && <SkeletonRows rows={3} className="mt-2.5" />}

          {alts && (
            <div className="mt-2.5 pt-2.5" onClick={(e) => e.stopPropagation()} style={{ borderTop: `1px solid ${C.rule}` }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wide" style={{ color: C.faintLight }}>Alternates for this slot</span>
                <button onClick={() => setAlts(null)} style={{ color: C.faintLight }}><X size={13} /></button>
              </div>
              {alts.length === 0 && <div className="text-xs font-semibold" style={{ color: C.faint }}>Nothing else fits this slot under current rules.</div>}
              <div className="flex flex-col gap-1.5">
                {alts.map((a) => (
                  <div key={a.recipeId} className="flex items-center justify-between gap-2 p-2 rounded-lg" style={{ background: C.card2 }}>
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate" style={{ color: C.ink }}>{a.recipeName}</div>
                      <div className="mono text-[10.5px] font-semibold" style={{ color: C.faintLight }}>
                        {kc(a.kcal)} kcal · {g1(a.protein)}P · {a.matchPct}% fit
                      </div>
                    </div>
                    <Btn small kind="ghost" onClick={() => applyAlternate(a)} disabled={applyingId === a.recipeId}>
                      {applyingId === a.recipeId ? "…" : "Use"}
                    </Btn>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expanded && recipe && (
            <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${C.rule}` }}>
              <div className="text-xs font-semibold mb-1.5" style={{ color: C.ink }}>
                {slot.ingredients.map((ing) => `${ing.grams}g ${ing.name}`).join(" · ")}
              </div>
              {recipe.description && <div className="text-xs italic mb-1.5" style={{ color: C.faint }}>{recipe.description}</div>}
              <ol className="text-xs space-y-1 list-decimal list-inside" style={{ color: C.ink }}>
                {recipe.steps.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── main tab ─────────────────────────────────────────────────────────────

export default function PlanTab({ profile, summary, refresh }) {
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const [plan, setPlan] = useState(undefined);
  const [expandedId, setExpandedId] = useState(null);
  const [busySlotId, setBusySlotId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [groceryBusy, setGroceryBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mealsDraft, setMealsDraft] = useState({ meals: profile.mealsPerDay, snacks: profile.snacksPerDay });
  const [activeDay, setActiveDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
  const [filters, setFilters] = useState({
    cuisines: [], protein: "", budget: null, maxPrepMin: null, allowBatchRepeats: false,
    proteinPriority: proteinPriorityPref.get(),
  });
  const [dayOptions, setDayOptions] = useState(null);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [cartIds, setCartIds] = useState(new Set());
  const [genMeta, setGenMeta] = useState(null); // solver narration from the last generate
  const [meta, setMeta] = useState(null); // /profile/meta — used here only for proteinFloorSource

  const loadPlan = useCallback(async () => {
    try {
      setPlan(await api.getCurrentPlan());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadPlan();
    api.getCart().then((items) => setCartIds(new Set(items.map((i) => i.recipeId)))).catch(() => {});
    api.getProfileMeta().then(setMeta).catch(() => {}); // citation text only — a failed fetch just hides it
  }, [loadPlan]);

  // Desktop chassis: ← / → move between days (ignored while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      setActiveDay((d) => (e.key === "ArrowLeft" ? (d + 6) % 7 : (d + 1) % 7));
      setDayOptions(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commitMealConfig = async () => {
    await api.putProfile({ mealsPerDay: mealsDraft.meals, snacksPerDay: mealsDraft.snacks });
    await refresh();
  };

  const apiFilters = () => ({
    cuisines: filters.cuisines, protein: filters.protein || undefined,
    budget: filters.budget || undefined, maxPrepMin: filters.maxPrepMin || undefined,
    allowBatchRepeats: filters.allowBatchRepeats,
    proteinPriority: filters.proteinPriority,
  });

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setDayOptions(null);
    setGenMeta(null);
    try {
      const res = await api.generatePlan(apiFilters());
      setPlan(res);
      // Solver narration rides on the generate response's meta; absent = no card.
      setGenMeta(res?.meta ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const loadDayOptions = async () => {
    setOptionsBusy(true);
    setError(null);
    try {
      setDayOptions(await api.getDayOptions(activeDay, apiFilters()));
    } catch (e) {
      setError(e.message);
    } finally {
      setOptionsBusy(false);
    }
  };

  const acceptCandidate = async (candidate) => {
    setAccepting(true);
    setError(null);
    try {
      // Unsolved slots (no recipe found) simply aren't written — the day
      // keeps an honest gap rather than a fabricated meal.
      const updated = await api.acceptDay(activeDay, candidate.slots.filter((s) => s.recipeId).map(toApplyPayload));
      setPlan(updated);
      setDayOptions(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAccepting(false);
    }
  };

  // Optimistic lock toggle: flip the slot now, reconcile with the server's
  // returned slot, roll the whole slots array back if the write fails.
  const onLockToggle = async (slot) => {
    setBusySlotId(slot.id);
    const prevSlots = plan.slots;
    setPlan((p) => ({ ...p, slots: p.slots.map((s) => (s.id === slot.id ? { ...s, locked: !s.locked } : s)) }));
    try {
      const updated = await api.setSlotLock(plan.id, slot.id, !slot.locked);
      setPlan((p) => ({ ...p, slots: p.slots.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      setPlan((p) => ({ ...p, slots: prevSlots })); // rollback
      setError(e.message);
    } finally {
      setBusySlotId(null);
    }
  };

  // Optimistic cart toggle: reflect membership immediately, undo it on error.
  const onCart = async (recipeId) => {
    const had = cartIds.has(recipeId);
    const flip = (add) => setCartIds((s) => {
      const n = new Set(s);
      if (add) n.add(recipeId); else n.delete(recipeId);
      return n;
    });
    flip(!had);
    try {
      if (had) await api.removeFromCart(recipeId);
      else await api.addToCart(recipeId);
    } catch (e) {
      flip(had); // rollback to the pre-toggle membership
      setError(e.message);
    }
  };

  const onGenerateGroceryList = async () => {
    setGroceryBusy(true);
    try {
      const list = await api.generateGroceryList(plan.id);
      setPlan((p) => ({ ...p, groceryList: list }));
    } catch (e) {
      setError(e.message);
    } finally {
      setGroceryBusy(false);
    }
  };

  const onCheckItem = async (name, checked) => {
    setPlan((p) => ({ ...p, groceryList: { ...p.groceryList, items: p.groceryList.items.map((i) => (i.name === name ? { ...i, checked } : i)) } }));
    try {
      await api.checkGroceryItem(plan.id, name, checked);
    } catch {
      // reload truth on failure
      loadPlan();
    }
  };

  const itemGrams = (i) => Math.round(i.purchase?.grams ?? i.preparedGrams ?? i.grams ?? 0);
  const itemSection = (i) => i.section ?? i.category ?? "other";
  const groceryBySection = () =>
    plan.groceryList.bySection ||
    plan.groceryList.items.reduce((groups, item) => {
      const key = itemSection(item);
      (groups[key] = groups[key] || []).push(item);
      return groups;
    }, {});

  const itemLine = (i) => {
    const grams = itemGrams(i);
    const practical = i.purchaseUnits?.display;
    return practical ? `${practical} — ${i.name} (${grams} g)` : `${grams} g ${i.name}`;
  };
  const groceryListText = () => plan.groceryList.items.map(itemLine).join("\n");
  const copyGroceryList = () => navigator.clipboard?.writeText(groceryListText());
  const grocerySmsHref = () => `sms:?&body=${encodeURIComponent("Grocery list:\n" + groceryListText())}`;
  const groceryMailtoHref = () =>
    `mailto:?subject=${encodeURIComponent("Grocery list — week of " + fmtD(plan.startDate))}&body=${encodeURIComponent(groceryListText())}`;

  const daySlots = plan ? plan.slots.filter((s) => s.dayOfWeek === activeDay) : [];
  const dayTotals = sumSlots(daySlots);
  const targetKcal = summary?.macros?.kcal ?? profile.targetKcal;

  return (
    <div>
      <PageHead title="Plan" sub={plan ? `Week of ${fmtD(plan.startDate)} · locked slots survive regeneration · closest-fit by design` : "Complete days solved against your targets — closest-fit by design, not perfection."}>
        {plan !== undefined && (
          <Btn onClick={generate} disabled={generating}>
            {generating ? "Generating…" : plan ? "Regenerate meal plan" : "Generate meal plan"}
          </Btn>
        )}
      </PageHead>

      {error && (
        <div className="mb-3">
          <ErrorNote msg={error} hint="Hit the button again — if it keeps failing, loosen the filters above (they can over-constrain the solver)." />
        </div>
      )}

      <div className="mb-4">
        <FiltersBar filters={filters} setFilters={setFilters} proteinFloorSource={meta?.proteinFloorSource} />
      </div>

      {genMeta && (
        <div className="mb-4">
          <SolverNarration meta={genMeta} />
        </div>
      )}

      {plan === undefined ? (
        <div>
          <div className="hidden xl:grid grid-cols-7 gap-1.5 mb-3">
            {DAY_NAMES.map((d) => <Skeleton key={d} className="h-32" />)}
          </div>
          <div className="xl:hidden"><SkeletonRows rows={5} /></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* ── left: the week ── */}
          <div className="xl:col-span-7 min-w-0">
            {/* 7-column week board (≥ xl): every day's slots at a glance.
                Click or ← / → selects a day; the full slot detail renders
                below. Selection is a lightness step, not the brand green. */}
            <div className="hidden xl:grid grid-cols-7 gap-1.5 mb-3">
              {DAY_NAMES.map((d, i) => {
                const slots = plan ? plan.slots.filter((s) => s.dayOfWeek === i) : [];
                const tot = sumSlots(slots);
                const active = activeDay === i;
                return (
                  <button key={d} onClick={() => { setActiveDay(i); setDayOptions(null); }}
                    className="rounded-xl p-2 text-left flex flex-col gap-1 min-h-[112px]"
                    style={{ background: active ? C.card2 : C.card, border: `1px solid ${active ? C.faintLight : C.rule}` }}>
                    <div className="flex items-baseline justify-between w-full">
                      <span className="text-[10px] font-extrabold uppercase" style={{ color: active ? C.ink : C.faintLight }}>{d}</span>
                      <span className="mono text-[10px] font-bold" style={{ color: C.faintLight }}>
                        {plan ? fmtD(addDays(plan.startDate, i)).split(" ")[1] : ""}
                      </span>
                    </div>
                    {slots.length > 0 ? (
                      <>
                        <div className="flex flex-col gap-0.5 w-full">
                          {slots.map((s) => (
                            <div key={s.id} className="text-[10.5px] font-semibold flex items-center gap-1 min-w-0" style={{ color: s.recipe ? C.faint : C.faintLight }}>
                              {s.warning && <AlertTriangle size={9} className="shrink-0" style={{ color: C.warn }} />}
                              <span className="truncate">{s.recipe ? s.recipe.name : "— open slot"}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mono text-[10.5px] font-bold mt-auto" style={{ color: active ? C.ink : C.faintLight }}>{kc(tot.kcal)} kcal</div>
                      </>
                    ) : (
                      <div className="text-[10.5px] font-semibold" style={{ color: C.faintLight }}>{plan ? "no slots" : "—"}</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* compact day picker (small windows) */}
            <div className="grid grid-cols-7 gap-1.5 mb-3 xl:hidden">
              {DAY_NAMES.map((d, i) => (
                <button key={d} onClick={() => { setActiveDay(i); setDayOptions(null); }}
                  className="py-2 rounded-xl text-center"
                  style={{ background: activeDay === i ? C.card2 : C.card, border: `1px solid ${activeDay === i ? C.faintLight : C.rule}` }}>
                  <div className="text-[10px] font-bold" style={{ color: C.faintLight }}>{d}</div>
                  <div className="text-sm font-extrabold" style={{ color: activeDay === i ? C.ink : C.faint }}>
                    {plan ? fmtD(addDays(plan.startDate, i)).split(" ")[1] : ""}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="text-xs font-semibold" style={{ color: C.faint }}>
                Day total: <b className="mono" style={{ color: C.ink }}>{kc(dayTotals.kcal)}</b> kcal · {g1(dayTotals.protein)}P / {g1(dayTotals.fat)}F / {g1(dayTotals.carb)}C vs {kc(targetKcal)} target
              </div>
              <Btn small kind="ghost" onClick={loadDayOptions} disabled={optionsBusy}>
                <Sparkles size={12} className="inline mr-1" />{optionsBusy ? "Solving…" : `3 options for ${DAY_NAMES[activeDay]}`}
              </Btn>
            </div>

            {dayOptions && (
              <div className="mb-4">
                {dayOptions.diagnosis && !dayOptions.diagnosis.feasible && (
                  <div className="p-3.5 rounded-xl mb-3" style={{ background: C.warnBg, border: `1px solid ${C.warn}66` }}>
                    <div className="text-xs font-extrabold uppercase tracking-wide mb-1" style={{ color: C.warn }}>Targets are out of reach with current constraints</div>
                    {dayOptions.diagnosis.reasons.map((r, i) => <div key={i} className="text-xs font-semibold" style={{ color: C.ink }}>· {r}</div>)}
                    {dayOptions.diagnosis.suggestions.map((s, i) => <div key={i} className="text-xs font-semibold mt-0.5" style={{ color: C.warn }}>→ {s}</div>)}
                  </div>
                )}
                {dayOptions.candidates.length > 0 && (
                  <>
                    <DayCandidates data={dayOptions} targetKcal={targetKcal} onAccept={acceptCandidate} accepting={accepting} />
                    <div className="text-[10.5px] font-semibold mt-2" style={{ color: C.faintLight }}>
                      Scores are closeness to your daily targets — closest-fit is the goal, 100% is rare and not required. Accepting writes this day into the meal plan.
                    </div>
                  </>
                )}
              </div>
            )}

            {!plan ? (
              <Card>
                <div className="flex items-start gap-2">
                  <ChefHat size={18} style={{ color: C.faintLight }} className="mt-0.5 shrink-0" />
                  <div className="text-sm font-semibold" style={{ color: C.ink }}>
                    No plan yet — hit "Generate meal plan", or solve a single day with "3 options".
                  </div>
                </div>
              </Card>
            ) : (
              <div className="flex flex-col gap-2.5">
                {daySlots.map((slot) => (
                  <SlotCard key={slot.id} plan={plan} slot={slot} expanded={expandedId === slot.id}
                    onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                    onLockToggle={onLockToggle} busy={busySlotId === slot.id}
                    filters={apiFilters()} reloadPlan={loadPlan}
                    onCart={onCart} inCart={slot.recipeId ? cartIds.has(slot.recipeId) : false} />
                ))}
              </div>
            )}
          </div>

          {/* ── right: config + grocery ── */}
          <div className="xl:col-span-5 flex flex-col gap-4">
            <Card section="PLAN" title="Meal structure">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-bold" style={{ color: C.faint }}>Meals / day</span>
                  <input type="number" min={1} max={6} value={mealsDraft.meals}
                    onChange={(e) => setMealsDraft((d) => ({ ...d, meals: Math.max(1, +e.target.value || 1) }))}
                    onBlur={commitMealConfig}
                    className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle} />
                </label>
                <label className="block">
                  <span className="text-xs font-bold" style={{ color: C.faint }}>Snacks / day</span>
                  <input type="number" min={0} max={4} value={mealsDraft.snacks}
                    onChange={(e) => setMealsDraft((d) => ({ ...d, snacks: Math.max(0, +e.target.value || 0) }))}
                    onBlur={commitMealConfig}
                    className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle} />
                </label>
              </div>
              <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
                Applies on the next generate/regenerate.
              </div>
            </Card>

            {plan && (
              <Card section="GROCERY" title="Shopping list — whole week">
                <div className="flex gap-2 mb-2 flex-wrap">
                  <Btn small onClick={onGenerateGroceryList} disabled={groceryBusy}>
                    <ShoppingCart size={12} className="inline mr-1" />
                    {plan.groceryList ? "Regenerate from this week" : "Generate from this week"}
                  </Btn>
                  {plan.groceryList && (
                    <Btn small kind="ghost" onClick={copyGroceryList}>
                      <Copy size={12} className="inline mr-1" />Copy
                    </Btn>
                  )}
                </div>
                {plan.groceryList ? (
                  <>
                    <div className="flex gap-2 mb-3">
                      <a href={grocerySmsHref()} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}>
                        <MessageCircle size={12} />Text
                      </a>
                      <a href={groceryMailtoHref()} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: C.card2, border: `1px solid ${C.rule}`, color: C.ink }}>
                        <Mail size={12} />Email
                      </a>
                    </div>
                    {Object.entries(groceryBySection())
                      .filter(([, items]) => items.length > 0)
                      .map(([section, items]) => (
                        <div key={section} className="mb-2.5">
                          <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-1" style={{ color: C.faintLight }}>{SECTION_LABELS[section] || section}</div>
                          {items.map((i) => {
                            const grams = itemGrams(i);
                            const hh = toHouseholdUnit(i.name, grams);
                            const practical = i.purchaseUnits?.display;
                            return (
                              <label key={i.name} className="flex items-start gap-2.5 py-1.5" style={{ borderBottom: `1px solid ${C.rule}`, opacity: i.checked ? 0.45 : 1 }}>
                                <input type="checkbox" checked={!!i.checked} onChange={(e) => onCheckItem(i.name, e.target.checked)}
                                  className="mt-0.5 w-4 h-4 shrink-0" style={{ accentColor: C.good }} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-bold" style={{ color: C.ink, textDecoration: i.checked ? "line-through" : "none" }}>
                                    {practical ? `${practical} — ${i.name}` : i.name}
                                  </div>
                                  <div className="mono text-[10.5px] font-semibold" style={{ color: C.faintLight }}>
                                    {grams} g{hh ? ` · ≈${hh}` : ""}{i.purchaseUnits?.approx ? ` · ${i.purchaseUnits.approx}` : ""}
                                    {i.cost != null && <> · ${i.cost.amountCad.toFixed(2)}</>}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    <div className="text-xs font-semibold mt-1 pt-2" style={{ color: C.faint, borderTop: `1px solid ${C.rule}` }}>
                      {plan.groceryList.totalEstimatedCostCad != null && <>Est. total: <b style={{ color: C.ink }}>${plan.groceryList.totalEstimatedCostCad.toFixed(2)} CAD</b> · </>}
                      {plan.groceryList.costCoverageNote || "practical units are typical retail sizes — grams are the ground truth"}
                    </div>
                  </>
                ) : (
                  <div className="text-sm font-semibold" style={{ color: C.faint }}>Generate a list from this week's plan.</div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
