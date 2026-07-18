import { useState, useEffect, useCallback } from "react";
import { Lock, LockOpen, RefreshCw, ChefHat, ShoppingCart, Copy, Utensils, Apple, MessageCircle, Mail } from "lucide-react";
import { toHouseholdUnit } from "../lib/householdUnits.js";
import { C } from "../lib/theme.js";
import { addDays, fmtD } from "../lib/dates.js";
import { Card, Btn, Chip, PageHead } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const g1 = (n) => Math.round(n * 10) / 10;
// Matches groceryList.js's bySection keys (produce/protein/dairy/pantry/
// spices/other), plus legacy + Phase-2 category slugs that appear in OLD
// persisted grocery-list snapshots' fallback `category` field.
const SECTION_LABELS = {
  produce: "Produce", protein: "Protein", dairy: "Dairy", pantry: "Pantry / dry goods", spices: "Spices", other: "Other",
  carb: "Carbs", veg: "Veg", fat: "Fats", fruit: "Fruit",
  "dairy-eggs": "Dairy & Eggs", "fruit-veg": "Fruit & Veg", "grains": "Grains & Carbs",
  "fats-nuts-oils": "Fats, Nuts & Oils", "drinks": "Drinks",
};
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function sumSlots(slots) {
  return slots.reduce((t, s) => ({ kcal: t.kcal + s.kcal, protein: t.protein + s.protein, fat: t.fat + s.fat, carb: t.carb + s.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
}

function SlotCard({ slot, expanded, onToggleExpand, onLockToggle, onSwap, busy }) {
  const recipe = slot.recipe;
  const Icon = slot.slotType === "snack" ? Apple : Utensils;
  const roleColor = slot.ingredients?.[0]?.role === "carb" ? C.carb : slot.ingredients?.[0]?.role === "fat" ? C.fat : C.protein;
  return (
    <div className="p-3.5 rounded-2xl flex gap-3 cursor-pointer" onClick={() => onToggleExpand(slot.id)}
      style={{ background: C.card, border: `1px solid ${C.rule}` }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${roleColor}22` }}>
        <Icon size={19} style={{ color: roleColor }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between items-start gap-2">
          <div className="text-left min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: C.faintLight }}>{slot.slotType}</div>
            <div className="text-sm font-extrabold" style={{ color: C.ink }}>{recipe ? recipe.name : "—"}</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button onClick={(e) => { e.stopPropagation(); onLockToggle(slot); }} disabled={busy}
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ color: slot.locked ? C.good : C.faint, background: C.card2, border: `1px solid ${C.rule}` }} aria-label="Toggle lock">
              {slot.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            {!slot.locked && (
              <button onClick={(e) => { e.stopPropagation(); onSwap(slot); }} disabled={busy}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ color: C.faint, background: C.card2, border: `1px solid ${C.rule}` }} aria-label="Swap recipe">
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
          <div className="text-xs font-semibold mt-1.5" style={{ color: C.red }}>{slot.warning}</div>
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
  );
}

export default function PlanTab({ profile, summary, refresh }) {
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = none yet
  const [expandedId, setExpandedId] = useState(null);
  const [busySlotId, setBusySlotId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [groceryBusy, setGroceryBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mealsDraft, setMealsDraft] = useState({ meals: profile.mealsPerDay, snacks: profile.snacksPerDay });
  const [activeDay, setActiveDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);

  const loadPlan = useCallback(async () => {
    try {
      setPlan(await api.getCurrentPlan());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { loadPlan(); }, [loadPlan]);

  const commitMealConfig = async () => {
    await api.putProfile({ mealsPerDay: mealsDraft.meals, snacksPerDay: mealsDraft.snacks });
    await refresh();
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      setPlan(await api.generatePlan());
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const updateSlot = (updated) => {
    setPlan((p) => ({ ...p, slots: p.slots.map((s) => (s.id === updated.id ? updated : s)) }));
  };

  const onLockToggle = async (slot) => {
    setBusySlotId(slot.id);
    try {
      updateSlot(await api.setSlotLock(plan.id, slot.id, !slot.locked));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusySlotId(null);
    }
  };

  const onSwap = async (slot) => {
    setBusySlotId(slot.id);
    try {
      updateSlot(await api.swapSlot(plan.id, slot.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusySlotId(null);
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

  // groceryList.js's response shape is {items:[{name,section,preparedGrams,
  // purchase:{grams,form},cost}], bySection, totalEstimatedCostCad,
  // costCoverageNote} - but `bySection`/`totalEstimatedCostCad`/`costCoverageNote`
  // are only ever added to the live POST /grocery-list RESPONSE (see
  // routes/plans.js), never persisted - the DB's GroceryList row only stores
  // `items`. So a plan loaded via GET /plans/current (not a fresh generate)
  // has `items` but no top-level `bySection` at all. Separately, ANY grocery
  // list generated before this session's groceryList.js upgrade is an even
  // older shape (`{foodId,name,category,grams}`, no `purchase`/`section`).
  // Guard every field read rather than assume either shape - a stale/older
  // record must degrade gracefully, never crash the whole tab.
  const itemGrams = (i) => Math.round(i.purchase?.grams ?? i.preparedGrams ?? i.grams ?? 0);
  const itemForm = (i) => i.purchase?.form ?? "";
  const itemSection = (i) => i.section ?? i.category ?? "other";
  const groceryBySection = () =>
    plan.groceryList.bySection ||
    plan.groceryList.items.reduce((groups, item) => {
      const key = itemSection(item);
      (groups[key] = groups[key] || []).push(item);
      return groups;
    }, {});

  const groceryListText = () =>
    plan.groceryList.items.map((i) => `${itemGrams(i)}g${itemForm(i) ? ` (${itemForm(i)})` : ""} ${i.name}`).join("\n");

  const copyGroceryList = () => {
    navigator.clipboard?.writeText(groceryListText());
  };

  const grocerySmsHref = () => `sms:?&body=${encodeURIComponent("Grocery list:\n" + groceryListText())}`;
  const groceryMailtoHref = () =>
    `mailto:?subject=${encodeURIComponent("Grocery list — week of " + fmtD(plan.startDate))}&body=${encodeURIComponent(groceryListText())}`;

  const daySlots = plan ? plan.slots.filter((s) => s.dayOfWeek === activeDay) : [];
  const dayTotals = sumSlots(daySlots);

  return (
    <div>
      <PageHead title="Plan" sub={plan ? `Week of ${fmtD(plan.startDate)} · locked slots are kept on regenerate` : "Weekly meal plan, solved against your targets."}>
        {plan !== undefined && (
          <Btn onClick={generate} disabled={generating}>
            {generating ? "Generating…" : plan ? "Regenerate week" : "Generate week plan"}
          </Btn>
        )}
      </PageHead>

      {error && (
        <div className="text-xs font-semibold px-1 mb-3" style={{ color: C.red }}>{error}</div>
      )}

      {plan === undefined ? (
        <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
      ) : !plan ? (
        <div className="max-w-xl">
          <Card>
            <div className="flex items-start gap-2">
              <ChefHat size={18} style={{ color: C.faintLight }} className="mt-0.5 shrink-0" />
              <div className="text-sm font-semibold" style={{ color: C.ink }}>
                No plan for this week yet — hit "Generate week plan" above.
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* ── left: the week ── */}
          <div className="xl:col-span-7 min-w-0">
            <div className="grid grid-cols-7 gap-1.5 mb-3">
              {DAY_NAMES.map((d, i) => (
                <button key={d} onClick={() => setActiveDay(i)}
                  className="py-2 rounded-xl text-center"
                  style={{ background: activeDay === i ? C.accent : C.card, border: `1px solid ${activeDay === i ? C.accent : C.rule}` }}>
                  <div className="text-[10px] font-bold" style={{ color: activeDay === i ? C.accentInk : C.faintLight }}>{d}</div>
                  <div className="text-sm font-extrabold" style={{ color: activeDay === i ? C.accentInk : C.ink }}>{fmtD(addDays(plan.startDate, i)).split(" ")[1]}</div>
                </button>
              ))}
            </div>

            <div className="text-xs font-semibold px-1 mb-2" style={{ color: C.faint }}>
              Day total: <b className="mono" style={{ color: C.ink }}>{kc(dayTotals.kcal)}</b> kcal · {g1(dayTotals.protein)}P / {g1(dayTotals.fat)}F / {g1(dayTotals.carb)}C
              {summary?.macros && <> vs {kc(summary.macros.kcal)} target</>}
            </div>

            <div className="flex flex-col gap-2.5">
              {daySlots.map((slot) => (
                <SlotCard key={slot.id} slot={slot} expanded={expandedId === slot.id}
                  onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                  onLockToggle={onLockToggle} onSwap={onSwap} busy={busySlotId === slot.id} />
              ))}
            </div>
          </div>

          {/* ── right: config + grocery ── */}
          <div className="xl:col-span-5 flex flex-col gap-4 xl:sticky xl:top-8">
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
                          return (
                            <div key={i.name} className="flex justify-between text-sm py-1" style={{ borderBottom: `1px solid ${C.rule}` }}>
                              <span className="font-semibold" style={{ color: C.ink }}>{i.name}</span>
                              <span className="mono text-xs font-bold text-right" style={{ color: C.faint }}>
                                {grams}g{hh ? ` (≈${hh})` : ""} {itemForm(i)}
                                {i.cost != null && <span style={{ color: C.faintLight }}> · ${i.cost.amountCad.toFixed(2)}</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  <div className="text-xs font-semibold mt-1 pt-2" style={{ color: C.faint, borderTop: `1px solid ${C.rule}` }}>
                    {plan.groceryList.totalEstimatedCostCad != null && <>Est. total: <b style={{ color: C.ink }}>${plan.groceryList.totalEstimatedCostCad.toFixed(2)} CAD</b> · </>}
                    {plan.groceryList.costCoverageNote}
                  </div>
                </>
              ) : (
                <div className="text-sm font-semibold" style={{ color: C.faint }}>Generate a list from this week's plan.</div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
