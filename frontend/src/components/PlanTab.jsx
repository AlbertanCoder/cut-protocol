import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import {
  Lock, LockOpen, RefreshCw, ChefHat, ShoppingCart, Copy,
  MessageCircle, Mail, Sparkles, Check, AlertTriangle, X, ArrowRight, Beef,
} from "lucide-react";
import { toHouseholdUnit } from "../lib/householdUnits.js";
import FoodTile from "./ui/FoodTile.jsx";
import { C } from "../lib/theme.js";
import { addDays, fmtD } from "../lib/dates.js";
import { proteinPriorityPref } from "../lib/storage.js";
import { Card, Btn, Chip, PageHead, ErrorNote } from "./ui/Parts.jsx";
import { Skeleton, SkeletonRows } from "./ui/Skeleton.jsx";
import { RangeCap, ComplexityCap } from "./ui/FilterControls.jsx";
import GenerationProgress from "./ui/GenerationProgress.jsx";
import { api, isAbortError, describeError } from "../lib/api.js";

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

// Stage 2 — how much to generate. Mirrors the server's own catalogue
// (GET /api/plans/horizons, and resolveHorizon() validates against the same
// list), so the control can never offer something the meal planner would refuse.
const HORIZON_OPTIONS = [
  { key: "meal", label: "1 meal", days: 0 },
  { key: "day", label: "1 day", days: 1 },
  { key: "3days", label: "3 days", days: 3 },
  { key: "week", label: "1 week", days: 7 },
  { key: "2weeks", label: "2 weeks", days: 14 },
  { key: "month", label: "1 month", days: 28 },
];
const CUSTOM_MAX_DAYS = 90;
const clampDays = (n) => Math.max(1, Math.min(CUSTOM_MAX_DAYS, Math.round(Number(n) || 1)));

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

// ── grocery-line helpers ─────────────────────────────────────────────────
// Module scope: pure, and referenced from memoised derivations below, so they
// must not be re-created on every render.
const itemGrams = (i) => Math.round(i.purchase?.grams ?? i.preparedGrams ?? i.grams ?? 0);
const itemSection = (i) => i.section ?? i.category ?? "other";
const itemLine = (i) => {
  const grams = itemGrams(i);
  const practical = i.purchaseUnits?.display;
  return practical ? `${practical} — ${i.name} (${grams} g)` : `${grams} g ${i.name}`;
};

// The backend's costCoverageNote ships a SOURCE PATH to the screen — the exact
// string is "all items priced (rough CAD estimates, not sourced data - see
// src/lib/groceryPrices.js)" (backend/src/lib/groceryList.js:236). A file path
// is not shopping-list copy. The real fix belongs in that file; until it lands,
// the path is stripped here so it can never reach a user.
const stripSourcePaths = (s) => (s || "")
  .replace(/\s*[-–—]?\s*see\s+\S+\.(?:js|jsx|ts|tsx|json)\b/gi, "")
  .replace(/\(\s*\)/g, "")
  .replace(/\s{2,}/g, " ")
  .trim();

// ── how far ahead ────────────────────────────────────────────────────────
// The generate surface's "how much". Selection is a LIGHTNESS step (--card-2 +
// a brighter hairline), never the accent — design law (a), green scarcity.
// The line underneath restates the choice in plain words so the control's state
// is legible without decoding which chip looks lit.

function HorizonBar({ horizonKey, setHorizonKey, customDays, setCustomDays, busy, allowBatchRepeats }) {
  const inpStyle = { background: "var(--secondary)", border: "1.5px solid var(--border)", color: "var(--foreground)" };
  const isCustom = horizonKey === "custom";
  const days = isCustom ? clampDays(customDays) : (HORIZON_OPTIONS.find((h) => h.key === horizonKey)?.days ?? 7);
  const weeks = Math.ceil(days / 7);
  const summary = horizonKey === "meal"
    ? "One dish, fitted to what is left of today. Nothing is written to your plan until you place it."
    : days < 7
      ? `${days} day${days === 1 ? "" : "s"}, starting today. The rest of the week is left exactly as it is.`
      : `${days} days (${weeks} week${weeks === 1 ? "" : "s"}) from this week's Monday${weeks > 1 ? ` — written to ${weeks} weekly plans` : ""}.`;
  return (
    <Card section="HOW FAR AHEAD" title="How much to generate">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="How far ahead to plan">
        {HORIZON_OPTIONS.map((h) => {
          const on = horizonKey === h.key;
          return (
            <button key={h.key} onClick={() => setHorizonKey(h.key)} disabled={busy} aria-pressed={on}
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={{ background: on ? "var(--secondary)" : "transparent", color: on ? "var(--foreground)" : "var(--muted-foreground)", border: `1px solid ${on ? "var(--muted-foreground)" : "var(--border)"}` }}>
              {h.label}
            </button>
          );
        })}
        <button onClick={() => setHorizonKey("custom")} disabled={busy} aria-pressed={isCustom}
          className="text-xs font-bold px-3 py-1.5 rounded-full"
          style={{ background: isCustom ? "var(--secondary)" : "transparent", color: isCustom ? "var(--foreground)" : "var(--muted-foreground)", border: `1px solid ${isCustom ? "var(--muted-foreground)" : "var(--border)"}` }}>
          Custom
        </button>
        {isCustom && (
          <label className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--foreground)" }}>
            <input type="number" min={1} max={CUSTOM_MAX_DAYS} value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              onBlur={(e) => setCustomDays(clampDays(e.target.value))}
              aria-label={`Custom length in days, 1 to ${CUSTOM_MAX_DAYS}`}
              className="text-xs px-2 py-1.5 rounded-xl w-20" style={inpStyle} />
            days
          </label>
        )}
      </div>
      <div className="text-[10.5px] font-semibold mt-2" style={{ color: "var(--muted-foreground)" }}>
        {summary}
        {horizonKey !== "meal" && (() => {
          // Must match the server's varietyPlanFor(): perWeekCap + (weeks - 1).
          const perWeek = allowBatchRepeats ? 4 : 2;
          return ` Locked meals survive no matter how far ahead you plan; the variety cap widens with it — ${perWeek + weeks - 1} servings of any one dish over ${days} days, still ${perWeek} per week.`;
        })()}
      </div>
    </Card>
  );
}

// ── one-meal result ──────────────────────────────────────────────────────
// The instant answer. Nothing is written — this is an answer, not a plan — so
// the card says what it was fitted to and what it landed on, and nothing here
// goes green unless the dish actually hit the remaining target.

function OneMealCard({ oneMeal }) {
  if (!oneMeal) return null;
  const best = oneMeal.best;
  const onTarget = oneMeal.fits === true;
  return (
    <Card section="1 MEAL" title={best ? best.recipeName : "No dish fits what is left"}>
      <div className="text-[10.5px] font-semibold mb-2" style={{ color: "var(--muted-foreground)" }}>{oneMeal.note}</div>
      {best ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mb-2">
            <span className="mono stat-hero text-3xl" style={{ color: onTarget ? C.accent : "var(--foreground)" }}>{best.matchPct}%</span>
            <span className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>
              fit against {kc(oneMeal.target.kcal)} kcal / {oneMeal.target.protein} g protein remaining
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Chip>{kc(best.kcal)} kcal</Chip>
            <Chip color={C.proteinText} bg={`${C.protein}1F`}>{g1(best.protein)}P</Chip>
            <Chip color={C.fatText} bg={`${C.fat}1F`}>{g1(best.fat)}F</Chip>
            <Chip color={C.carbText} bg={`${C.carb}1F`}>{g1(best.carb)}C</Chip>
          </div>
          {best.ingredients?.length > 0 && (
            <div className="text-xs font-semibold mb-2" style={{ color: "var(--foreground)" }}>
              {best.ingredients.map((i) => `${i.grams}g ${i.name}`).join(" · ")}
            </div>
          )}
          {oneMeal.options.length > 1 && (
            <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="text-[10px] font-bold tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>OTHER DISHES THAT FIT</div>
              {oneMeal.options.slice(1).map((a) => (
                <div key={a.recipeId} className="flex items-center justify-between gap-2 py-1 text-xs font-semibold">
                  <span className="truncate" style={{ color: "var(--foreground)" }}>{a.recipeName}</span>
                  <span className="mono shrink-0" style={{ color: "var(--muted-foreground)" }}>{kc(a.kcal)} kcal · {g1(a.protein)}P · {a.matchPct}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
      {oneMeal.miss && (
        <div className="text-xs font-semibold mt-1" style={{ color: "var(--warn)" }}>{oneMeal.miss}</div>
      )}
      {oneMeal.binding && (
        <div className="text-xs font-semibold mt-1" style={{ color: "var(--warn)" }}>
          → Binding constraint: {oneMeal.binding.label} — {oneMeal.binding.detail}
        </div>
      )}
    </Card>
  );
}

// ── multi-week summary ───────────────────────────────────────────────────
// A month writes four weekly plans; the meal plan below can only show one of
// them. Saying so — with each week's own numbers — is the difference between
// "we generated a month" and a month you can actually check.

function HorizonSummary({ horizon }) {
  if (!horizon || !Array.isArray(horizon.weekPlans) || horizon.weekPlans.length < 2) return null;
  return (
    <Card section="WEEKS WRITTEN" title={`${horizon.label} — ${fmtD(horizon.startDate)} to ${fmtD(horizon.endDate)}`}>
      <div className="text-[10.5px] font-semibold mb-2" style={{ color: "var(--muted-foreground)" }}>
        {horizon.weeksWritten} weekly plans written in {horizon.solveMs} ms. The meal plan below shows this week; the later weeks are stored on their own plan rows.
      </div>
      <div className="flex flex-col gap-1">
        {horizon.weekPlans.map((w) => {
          const clean = w.daysInTolerance === w.days && w.unfilledSlots === 0;
          return (
            <div key={w.startDate} className="flex items-center justify-between gap-2 py-1 text-xs font-semibold"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: "var(--foreground)" }}>Week of {fmtD(w.startDate)}</span>
              <span className="mono" style={{ color: clean ? "var(--foreground)" : "var(--warn)" }}>
                {w.daysInTolerance}/{w.days} days on target · {w.avgMatch}% avg
                {w.unfilledSlots > 0 ? ` · ${w.unfilledSlots} meal(s) not filled` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── filters bar ──────────────────────────────────────────────────────────

function FiltersBar({ filters, setFilters, proteinFloorSource }) {
  const inpStyle = { background: "var(--secondary)", border: "1.5px solid var(--border)", color: "var(--foreground)" };
  const toggleCuisine = (key) =>
    setFilters((f) => ({ ...f, cuisines: f.cuisines.includes(key) ? f.cuisines.filter((c) => c !== key) : [...f.cuisines, key] }));
  const setProteinPriority = (on) => {
    proteinPriorityPref.set(on);
    setFilters((f) => ({ ...f, proteinPriority: on }));
  };
  return (
    <Card section="FILTERS" title="Steer the meal planner">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CUISINE_OPTIONS.map((c) => {
          const on = filters.cuisines.includes(c.key);
          return (
            <button key={c.key} onClick={() => toggleCuisine(c.key)} aria-pressed={on}
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={{ background: on ? "var(--secondary)" : "transparent", color: on ? "var(--foreground)" : "var(--muted-foreground)", border: `1px solid ${on ? "var(--muted-foreground)" : "var(--border)"}` }}>
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
        {/* Law (a): a checkbox is control chrome, not an on-target claim — the
            browser's accent-color takes neutral --ink, never --accent. */}
        <label className="flex items-center gap-1.5 text-xs font-semibold px-1" style={{ color: "var(--foreground)" }}>
          <input type="checkbox" checked={filters.allowBatchRepeats}
            onChange={(e) => setFilters((f) => ({ ...f, allowBatchRepeats: e.target.checked }))}
            style={{ accentColor: "var(--foreground)" }} />
          Batch-cooking repeats OK
        </label>
      </div>
      <div className="text-[10.5px] font-semibold mt-2" style={{ color: "var(--muted-foreground)" }}>
        Cuisine, protein and budget are preferences — the planner bends toward them. Your diet and allergies from Profile are absolute: nothing that breaks them can appear. Max prep time is absolute too.
      </div>

      {/* Stage 3 — the optional caps. Each off by default with an explicit OFF
          state (off ≠ 0). Cost is not a macro, so it uses --ink/--faint only. */}
      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2.5" style={{ color: "var(--muted-foreground)", letterSpacing: ".06em" }}>
          Optional caps — each off unless you set it
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-5 gap-y-4">
          <div className="min-w-0">
            <RangeCap
              label="Max cost / serving" value={filters.maxCostCad}
              onChange={(v) => setFilters((f) => ({ ...f, maxCostCad: v }))}
              min={1} max={15} step={0.5} enableAt={4}
              format={(v) => `$${v.toFixed(2)}`}
              help="Median across your recipes ≈ $4 / serving." />
            {/* Required cost disclosure — one line per surface. */}
            <div className="text-[10px] font-semibold mt-1" style={{ color: "var(--muted-foreground)" }}>
              Estimated from a local price table, not live grocery pricing.
            </div>
          </div>
          <ComplexityCap value={filters.maxComplexity}
            onChange={(v) => setFilters((f) => ({ ...f, maxComplexity: v }))} />
          <RangeCap
            label="Min taste" value={filters.minTaste}
            onChange={(v) => setFilters((f) => ({ ...f, minTaste: v }))}
            min={0} max={1} step={0.05} enableAt={0.58}
            format={(v) => `≥ ${v.toFixed(2)}`}
            help="0–1; median across your recipes ≈ 0.58. Sharpens once you rate dishes." />
        </div>
        <div className="text-[10px] font-semibold mt-2.5" style={{ color: "var(--muted-foreground)" }}>
          Caps are hard filters — a dish that breaks one is removed, and if that leaves the meal planner nothing to choose from it names which cap is binding rather than failing silently.
        </div>
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <label className="flex items-start gap-2.5 text-sm font-bold cursor-pointer" style={{ color: "var(--foreground)" }}>
          {/* Law (c): --protein is the macro blue and may never be borrowed for
              control chrome. Neutral --ink, like every other control here. */}
          <input type="checkbox" checked={filters.proteinPriority}
            onChange={(e) => setProteinPriority(e.target.checked)}
            className="mt-0.5" style={{ accentColor: "var(--foreground)" }} />
          <span className="flex items-center gap-1.5">
            <Beef size={14} style={{ color: C.proteinText }} />
            Protein-priority mode
          </span>
        </label>
        <div className="text-[10.5px] font-semibold mt-1 ml-6" style={{ color: "var(--muted-foreground)" }}>
          Makes the meal planner defend your protein floor instead of trading it off against calories — an option that misses it is ranked lower and the miss is always reported, never absorbed into an otherwise-good match score.
          {proteinFloorSource && (
            <> Floor basis: {proteinFloorSource.label} — {proteinFloorSource.detail}</>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── what the meal planner did ─────────────────────────────────────────────
// An honest, plain-language readout of what the last generation actually did,
// from the generate response `meta`. Neutral by law: green is reserved for
// on-target/success/hero, so the score reads in ink (not accent) and the recipe
// funnel in faint. Degrades to nothing if meta — or any field — is absent.

// ── THE MATCH-% CONTRACT ──────────────────────────────────────────────────
// Every match number the server publishes is an INTEGER PERCENT on 0–100.
// Single-sourced in the solver, and there is no other producer:
//   mealSolver.js scoreDay()  → matchPct = Math.round(max(0, 1 - err) * 100)
//   mealSolver.js scoreWeek() → avgMatch = Math.round(mean of those matchPcts)
//   routes/plans.js           → meta.matchPct = result.score.avgMatch
// It is NEVER a 0–1 fraction. So the UI must not sniff the unit: the old
// `raw <= 1 ? raw * 100 : raw` heuristic rendered a genuine 1% match as 100%
// and 0.8% as 80% — a fabricated number on the app's headline honesty stat.
// Anything that is not a finite number is ABSENT, not zero.
const asPercent = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);

// ── THE VERDICT HAS TO OUTLIVE THE RENDER ─────────────────────────────────
// Everything SolverNarration draws — the per-day match strip, the miss lines,
// the "unsolvable + why" diagnosis — used to live in ONE useState fed by the
// generate response and written from nowhere else. Switch to Today and back,
// reload, or restart the app and the meals were still there while the verdict
// on them was gone. The constitution forbids a silent target miss; a miss
// narrated once and then discarded is the same thing on a delay.
//
// Two independent problems, one mechanism:
//
//   PERSISTENCE — the verdict is stored, so it comes back.
//   VALIDITY    — a verdict is only true of the exact meals it judged. Swap a
//                 slot and the stored narration describes a week that no
//                 longer exists. A stale verdict is worse than none, because
//                 it reads as current.
//
// Validity is DETECTED, not signalled: the signature of the slots the verdict
// judged is stored beside it and compared against the slots on screen. That
// is deliberate — a "clear it on mutation" flag only works for mutations this
// component performs, in this session, and dies at the next reload. The
// comparison works for a slot changed from another screen, in another session,
// or by a route this file has never heard of.
//
// THE RECIPE is duplicated in backend/prisma/schema.prisma (model Plan,
// verdictSlotSig) and the two MUST agree. Keyed on the (dayOfWeek, slotType,
// slotIndex) natural key rather than PlanSlot.id, because a regenerate deletes
// and recreates rows so ids churn even when the meals are identical. `locked`
// is excluded on purpose: a lock toggle moves no macro and must not invalidate
// a verdict that is still true.
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

function planSlotSig(plan) {
  const slots = plan?.slots;
  if (!Array.isArray(slots)) return null;
  return slots
    .map((s) => [
      s.dayOfWeek, s.slotType, s.slotIndex, s.recipeId ?? "",
      round3(s.proteinScale), round3(s.sidesScale),
    ].join(":"))
    .sort()
    .join("|");
}

// ── WHERE THE VERDICT IS KEPT ─────────────────────────────────────────────
// Plan.verdict / .diagnosis / .verdictAt / .verdictSlotSig now exist (migration
// 20260802034419_plan_verdict_persistence) and GET /plans/current returns them
// with the plan, because PLAN_INCLUDE uses `include`, not `select`. That is the
// authoritative home and the branch below reads it.
//
// It is not yet WRITTEN: the insert belongs in POST /plans/generate, which this
// change does not own. Until it lands, the same record is mirrored to
// localStorage from here so the verdict survives a reload today rather than
// after the next backend change. The mirror is strictly subordinate — a plan
// carrying a DB verdict never consults it — so when the route starts writing,
// deleting readMirror/writeMirror and their two call sites removes this layer
// with no behaviour change.
const VERDICT_MIRROR_KEY = "cutprotocol.plan.verdict";

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

/** The mirrored verdict for this exact plan row, or null. */
function readMirror(planId) {
  const s = safeStorage();
  if (!s || !planId) return null;
  try {
    const rec = JSON.parse(s.getItem(VERDICT_MIRROR_KEY) || "null");
    return rec && rec.planId === planId && rec.meta ? rec : null;
  } catch {
    return null; // unparseable mirror is a missing mirror, never a crash
  }
}

/** Mirror one verdict. Only the newest is kept — this screen shows one week. */
function writeMirror(rec) {
  const s = safeStorage();
  if (!s) return; // storage unavailable (private mode) — the session still works
  try {
    s.setItem(VERDICT_MIRROR_KEY, JSON.stringify(rec));
  } catch { /* quota or disabled — persistence is a bonus, never a blocker */ }
}

// Is this verdict still about the meals on screen? `reason` is null when it is.
// A record with no signature CANNOT be shown as current: we have no way to
// prove it still applies, and asserting it anyway is the fabrication the
// constitution rules out. It fails loudly ("unverifiable") rather than lying.
function judgeVerdict(rec, planSig) {
  if (!rec?.meta) return null;
  const stale = rec.sig == null || planSig == null
    ? "unverifiable"
    : rec.sig !== planSig ? "mutated" : null;
  return { ...rec, stale };
}

/**
 * The verdict this screen is entitled to show, from the most authoritative
 * source that has one: the database, then this session's generate, then the
 * local mirror.
 */
function resolveVerdict(plan, planSig, sessionVerdict) {
  if (!plan?.id) return null;
  if (plan.verdict) {
    return judgeVerdict({
      // diagnosis is a promoted column (see schema.prisma); verdict.diagnosis
      // stays authoritative if the two ever drift apart.
      meta: { ...plan.verdict, diagnosis: plan.verdict.diagnosis ?? plan.diagnosis ?? null },
      sig: plan.verdictSlotSig, at: plan.verdictAt, source: "db",
    }, planSig);
  }
  if (sessionVerdict?.planId === plan.id) return judgeVerdict(sessionVerdict, planSig);
  return judgeVerdict(readMirror(plan.id), planSig);
}

// The verdict is stored but no longer describes what is on screen. Say so —
// clearing the numbers without a word would be the same silent miss in a new
// costume. Amber, never red: this is food data (colour law b).
function StaleVerdict({ reason }) {
  return (
    <Card section="MEAL PLANNER" title="This verdict is out of date">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--warn)" }} />
        <div className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>
          {reason === "mutated" ? (
            <>The meals changed after the meal planner last scored this week, so its match
              percentages and miss lines described a different plan — they are hidden rather
              than shown as current. Regenerate to score what is here now. Each meal&apos;s own
              warning is still accurate.</>
          ) : (
            <>This verdict was stored without a record of which meals it judged, so it
              cannot be confirmed to describe the week on screen. Regenerate for a
              verdict that can be.</>
          )}
        </div>
      </div>
    </Card>
  );
}

function SolverNarration({ meta }) {
  if (!meta) return null;
  const pc = meta.poolCounts || {};
  // The scalar may arrive as `matchPct`, as a bare numeric `score`, or nested
  // in the week score object — three SHAPES, one unit (see contract above).
  const pct = asPercent(meta.matchPct) ?? asPercent(meta.score) ?? asPercent(meta.score?.avgMatch);
  // The per-day strip lives at meta.score.days for a week solve; older shapes
  // put it at meta.days. Read either, else the "every day, its own match"
  // strip silently never renders even though the data is right there.
  const days = Array.isArray(meta.days) ? meta.days
    : Array.isArray(meta.score?.days) ? meta.score.days : [];
  const missedDays = days.filter((d) => d && d.inTolerance === false);
  // Week-level verdict, held to the SAME green-scarcity law as the day cards:
  // the headline % is a distance measure, not a pass mark, so it never earns
  // the accent — and the aggregate that IS a verdict states the count in
  // words. Amber the moment a single day sits outside range, so a healthy
  // average can't stand in for "the week is fine".
  const daysInTol = asPercent(meta.score?.daysInTolerance);
  const dayTotal = days.length || null;
  const weekOnTarget = daysInTol != null && dayTotal != null && daysInTol === dayTotal;
  const varietyNotes = Array.isArray(meta.variety?.notes) ? meta.variety.notes : [];
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

  // Both tracks added a guard term here: the per-day match strip (days) and the
  // protein-floor readout (floorMet) are each independently sufficient reason to
  // render this card, so the card is only suppressed when EVERY readout is empty.
  if (
    pct == null && bestOf == null && funnel.length === 0 && !diagText &&
    days.length === 0 && floorMet == null
  ) return null;

  return (
    <Card section="MEAL PLANNER" title="What the meal planner did">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {bestOf != null && <Chip>Best of {bestOf}</Chip>}
        {pct != null && (
          <div className="flex items-baseline gap-1.5">
            <span className="mono stat-hero text-2xl" style={{ color: "var(--foreground)" }}>{pct}%</span>
            <span className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>average match to your targets</span>
          </div>
        )}
        {daysInTol != null && dayTotal != null && (
          <span className="text-xs font-bold" style={{ color: weekOnTarget ? "var(--foreground)" : "var(--warn)" }}>
            {daysInTol} of {dayTotal} days close enough to your targets
          </span>
        )}
        {floorMet != null && (
          <div className="flex items-center gap-1.5">
            <Beef size={13} style={{ color: C.proteinText }} />
            <span className="text-xs font-bold" style={{ color: floorMet === floorTotal ? "var(--foreground)" : "var(--warn)" }}>
              Protein floor defended {floorMet}/{floorTotal} days
            </span>
          </div>
        )}
        {funnel.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-semibold flex-wrap" style={{ color: "var(--muted-foreground)" }}>
            {funnel.map((f, i) => (
              <span key={f.l} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight size={12} style={{ color: "var(--muted-foreground)" }} />}
                <b className="mono" style={{ color: "var(--foreground)" }}>{kc(f.n)}</b> {f.l}
              </span>
            ))}
          </div>
        )}
      </div>
      {days.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-bold tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>
            EVERY DAY, ITS OWN MATCH
          </div>
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => (
              <div
                // A multi-week run repeats dayOfWeek, so the key has to be the
                // day's own identity across the run, not its weekday.
                key={d.key ?? d.dayOfWeek}
                title={`${d.windowIndex != null ? `Week ${d.windowIndex + 1} · ` : ""}${d.miss || `${d.dayName}: on target`}`}
                className="px-2 py-1 rounded-lg flex items-baseline gap-1.5"
                style={{ background: "var(--secondary)", border: `1px solid ${d.inTolerance ? "var(--border)" : "var(--warn)"}` }}
              >
                <span className="text-[10px] font-bold" style={{ color: "var(--muted-foreground)" }}>{(d.dayName || "").slice(0, 3)}</span>
                <span className="mono text-xs font-bold" style={{ color: d.inTolerance ? "var(--foreground)" : "var(--warn)" }}>{d.matchPct}%</span>
              </div>
            ))}
          </div>
          {missedDays.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {missedDays.map((d) => (
                <div key={d.key ?? d.dayOfWeek} className="text-xs font-semibold" style={{ color: "var(--warn)" }}>
                  {d.windowIndex != null && days.length > 7 ? `Week ${d.windowIndex + 1} ` : ""}{d.dayName}: {d.miss}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* The ONE thing that is binding, named — ahead of the sentences, because
          "what do I change?" is the question the reasons only imply. */}
      {diag?.binding?.key && (
        <div className="text-xs font-extrabold mt-2" style={{ color: "var(--warn)" }}>
          Binding constraint: {diag.binding.label} — {diag.binding.detail}
        </div>
      )}
      {diagText && (
        <div className="text-xs font-semibold mt-2" style={{ color: infeasible ? "var(--warn)" : "var(--muted-foreground)" }}>
          {infeasible ? "→ " : ""}{diagText}
        </div>
      )}
      {varietyNotes.map((n, i) => (
        <div key={i} className="text-xs font-semibold mt-1" style={{ color: "var(--muted-foreground)" }}>{n}</div>
      ))}
    </Card>
  );
}

// ── day candidate cards ──────────────────────────────────────────────────

function DayCandidates({ data, targetKcal, onAccept, accepting }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {data.candidates.map((c, idx) => {
        // GREEN SCARCITY (design law a) + colour-encodes-truth, not ranking.
        // This card used to paint the top-ranked candidate brand green no
        // matter how badly it missed, so "green" silently degraded from
        // "on target" to "the least-bad thing we found". Brand green now
        // means exactly one thing: the day landed INSIDE range on all four
        // macros (the server's own dayTolerance verdict, single-sourced in
        // mealSolver — never recomputed here).
        //
        // Fail closed: a response that does not publish `inTolerance` is not
        // proof of being on target, so it gets the neutral treatment. Green
        // is a claim; we only make it when the server actually made it.
        const onTarget = c.inTolerance === true;
        const isBest = idx === 0;
        // Ranking is still legible — as a LIGHTNESS step (--card-2 + a
        // brighter hairline), which is this design system's own way of
        // saying "selected/primary" without borrowing the accent.
        const border = onTarget ? C.accent : isBest ? "var(--muted-foreground)" : "var(--border)";
        const bg = !onTarget && isBest ? "var(--secondary)" : "var(--card)";
        const label = onTarget
          ? (isBest ? "Best match" : `Option ${idx + 1}`)
          : (isBest ? "Closest we found" : `Option ${idx + 1}`);
        return (
        <div key={idx} className="p-4 rounded-2xl flex flex-col" style={{ background: bg, border: `1px solid ${border}` }}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="mono stat-hero text-3xl" style={{ color: onTarget ? C.accent : "var(--foreground)" }}>{c.score.matchPct}%</span>
            <span className="text-[10px] font-bold uppercase flex items-center gap-1 text-right" style={{ color: onTarget ? "var(--muted-foreground)" : "var(--warn)" }}>
              {!onTarget && isBest && <AlertTriangle size={10} aria-hidden="true" />}
              {label}
            </span>
          </div>
          <div className="mono text-xs font-bold mb-2" style={{ color: "var(--muted-foreground)" }}>
            {kc(c.score.totals.kcal)} / {kc(targetKcal)} kcal · {c.score.totals.protein}P {c.score.totals.fat}F {c.score.totals.carb}C
          </div>
          {/* What it actually missed by — amber + plain numbers (law b: no red
              on food data, no scolding). Silent when the day is on target. */}
          {!onTarget && c.miss && (
            <div className="text-[10.5px] font-semibold mb-2" style={{ color: "var(--warn)" }}>{c.miss}</div>
          )}
          {c.score.proteinFloor && (
            <div className="flex items-center gap-1.5 mb-2 text-[10.5px] font-bold" style={{ color: c.score.proteinFloor.met ? "var(--muted-foreground)" : "var(--warn)" }}>
              <Beef size={11} style={{ color: c.score.proteinFloor.met ? C.proteinText : "var(--warn)" }} />
              {c.score.proteinFloor.met
                ? `Protein floor met (${c.score.proteinFloor.achievedG}g / ${c.score.proteinFloor.floorG}g)`
                : `Protein floor short by ${c.score.proteinFloor.shortG}g`}
            </div>
          )}
          <div className="flex flex-col gap-1.5 flex-1 mb-3">
            {c.slots.map((s, i) => (
              <div key={i} className="flex justify-between gap-2 text-xs font-semibold py-1" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="truncate" style={{ color: "var(--foreground)" }}>
                  {s.slotType === "snack" ? "🥨 " : ""}{s.recipeName || "—"}
                  {s.warning && <AlertTriangle size={10} className="inline ml-1" style={{ color: "var(--warn)" }} />}
                </span>
                <span className="mono shrink-0" style={{ color: "var(--muted-foreground)" }}>{kc(s.kcal)}</span>
              </div>
            ))}
          </div>
          <Btn small onClick={() => onAccept(c)} disabled={accepting}>
            <Check size={12} className="inline mr-1" />{accepting ? "Writing…" : "Accept this day"}
          </Btn>
        </div>
        );
      })}
    </div>
  );
}

// ── one meal in the plan, with its other options ─────────────────────────
//
// a11y: this card used to be role="button" tabIndex={0} WRAPPING three real
// <button>s (cart, lock, swap). Interactive controls nested inside a button
// role is invalid ARIA — a screen reader's browse mode flattens the subtree,
// so the inner buttons are folded into the outer label or lost entirely. The
// disclosure is now a real <button> around the title + macro chips ONLY, and
// the action buttons are its SIBLINGS. Keyboard behaviour is unchanged
// (Enter/Space on the title toggles); all the stopPropagation() plumbing the
// old click-anywhere card needed is gone with it.
//
// memo(): a day renders one of these per meal and the common re-render is one
// card expanding. Props are scalars + stable callbacks + a memoised filters
// object, so the other cards genuinely skip.
const SlotCard = memo(function SlotCard({ planId, slot, expanded, onToggleExpand, onLockToggle, busy, filters, reloadPlan, onCart, inCart }) {
  const recipe = slot.recipe;
  const [alts, setAlts] = useState(null);
  const [altBusy, setAltBusy] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [error, setError] = useState(null);

  const loadAlternates = async () => {
    setAltBusy(true);
    setError(null);
    try {
      const res = await api.getSlotAlternates(planId, slot.id, filters);
      setAlts(res.alternates);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(describeError(err));
    } finally {
      setAltBusy(false);
    }
  };

  const applyAlternate = async (alt) => {
    setApplyingId(alt.recipeId);
    setError(null);
    try {
      await api.applySlotAlternate(planId, slot.id, toApplyPayload({ ...alt, slotType: slot.slotType, slotIndex: slot.slotIndex }));
      setAlts(null);
      await reloadPlan();
    } catch (err) {
      if (isAbortError(err)) return;
      setError(describeError(err));
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="p-3.5 rounded-2xl row-host" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex gap-3">
        <FoodTile recipe={{ ingredients: slot.ingredients, slotType: slot.slotType, mealCategory: recipe?.mealCategory }} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex justify-between items-start gap-2">
            <button type="button" onClick={() => onToggleExpand(slot.id)} aria-expanded={expanded}
              className="text-left min-w-0 flex-1"
              aria-label={`${slot.slotType}: ${recipe ? recipe.name : "no meal yet"}, ${kc(slot.kcal)} kcal — ${expanded ? "hide" : "show"} details`}>
              <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>{slot.slotType}</div>
              <div className="text-sm font-extrabold" style={{ color: "var(--foreground)" }}>{recipe ? recipe.name : "—"}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Chip>{kc(slot.kcal)} kcal</Chip>
                <Chip color={C.proteinText} bg={`${C.protein}1F`}>{g1(slot.protein)}P</Chip>
                <Chip color={C.fatText} bg={`${C.fat}1F`}>{g1(slot.fat)}F</Chip>
                <Chip color={C.carbText} bg={`${C.carb}1F`}>{g1(slot.carb)}C</Chip>
              </div>
            </button>
            {/* Hover-revealed actions (cart, swap); the lock stays visible
                because it displays STATE, not just an action. */}
            <div className="flex gap-1.5 shrink-0">
              {recipe && (
                // Law (a): "in your cart" is a toggled state — not on-target,
                // not success — so it cannot be green. Selected reads as a
                // LIGHTNESS step (brighter ink + a --faint-light hairline),
                // the same language the day picker and chips already speak.
                <button onClick={() => onCart(recipe.id)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${inCart ? "" : "row-reveal"}`}
                  style={{ color: inCart ? "var(--foreground)" : "var(--muted-foreground)", background: "var(--secondary)", border: `1px solid ${inCart ? "var(--muted-foreground)" : "var(--border)"}` }}
                  aria-label={inCart ? "Remove from cart" : "Add to cart"} aria-pressed={inCart}
                  title={inCart ? "Remove from cart" : "Add to cart"}>
                  {inCart ? <Check size={14} aria-hidden="true" /> : <ShoppingCart size={14} aria-hidden="true" />}
                </button>
              )}
              <button onClick={() => onLockToggle(slot)} disabled={busy}
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${slot.locked ? "" : "row-reveal"}`}
                style={{ color: slot.locked ? "var(--foreground)" : "var(--muted-foreground)", background: "var(--secondary)", border: `1px solid ${slot.locked ? "var(--muted-foreground)" : "var(--border)"}` }}
                aria-label={slot.locked ? "Unlock this meal" : "Lock this meal"} aria-pressed={slot.locked}
                title={slot.locked ? "Locked — survives a regenerate" : "Unlocked — a regenerate can replace it"}>
                {slot.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
              </button>
              {!slot.locked && (
                <button onClick={loadAlternates} disabled={altBusy}
                  className="w-7 h-7 rounded-lg flex items-center justify-center row-reveal"
                  style={{ color: "var(--muted-foreground)", background: "var(--secondary)", border: "1px solid var(--border)" }}
                  aria-label="Swap — show other options" title="Swap — show 3 other options">
                  <RefreshCw size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          {slot.warning && (
            <div className="mt-1.5">
              <div className="text-xs font-semibold" style={{ color: "var(--warn)" }}>{slot.warning}</div>
              <div className="text-[10.5px] font-semibold mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                → Fix it with the swap button (3 other options), or regenerate with looser filters.
              </div>
            </div>
          )}
          {error && (
            <div className="mt-1.5">
              <ErrorNote msg={error} hint="Swap and lock still work — retry, or regenerate the week if this meal is stuck." />
            </div>
          )}

          {altBusy && !alts && <SkeletonRows rows={3} className="mt-2.5" />}

          {alts && (
            <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Other options for this meal</span>
                <button onClick={() => setAlts(null)} style={{ color: "var(--muted-foreground)" }} aria-label="Close other options">
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
              {alts.length === 0 && <div className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>Nothing else fits this meal under your current rules.</div>}
              <div className="flex flex-col gap-1.5">
                {alts.map((a) => (
                  <div key={a.recipeId} className="flex items-center justify-between gap-2 p-2 rounded-lg" style={{ background: "var(--secondary)" }}>
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate" style={{ color: "var(--foreground)" }}>{a.recipeName}</div>
                      <div className="mono text-[10.5px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
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
            <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--foreground)" }}>
                {slot.ingredients.map((ing) => `${ing.grams}g ${ing.name}`).join(" · ")}
              </div>
              {recipe.description && <div className="text-xs italic mb-1.5" style={{ color: "var(--muted-foreground)" }}>{recipe.description}</div>}
              <ol className="text-xs space-y-1 list-decimal list-inside" style={{ color: "var(--foreground)" }}>
                {recipe.steps.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ── main tab ─────────────────────────────────────────────────────────────

export default function PlanTab({ profile, summary, refresh }) {
  const inpStyle = { background: "var(--secondary)", border: "1.5px solid var(--border)", color: "var(--foreground)" };
  const [plan, setPlan] = useState(undefined);
  const [expandedId, setExpandedId] = useState(null);
  const [busySlotId, setBusySlotId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [groceryBusy, setGroceryBusy] = useState(false);
  const [error, setError] = useState(null);
  const [mealsDraft, setMealsDraft] = useState({ meals: profile.mealsPerDay, snacks: profile.snacksPerDay });
  const [mealsSaving, setMealsSaving] = useState(false);
  const [activeDay, setActiveDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1);
  const [filters, setFilters] = useState({
    cuisines: [], protein: "", budget: null, maxPrepMin: null, allowBatchRepeats: false,
    // Stage 3 optional caps — null = off (off ≠ 0).
    maxCostCad: null, maxComplexity: null, minTaste: null,
    proteinPriority: proteinPriorityPref.get(),
  });
  // In-flight generate request, so a Cancel can abort it (api.js AbortController).
  const genAbortRef = useRef(null);
  // Stage 2: how far ahead is the user's choice, defaulting to the week this
  // screen has always generated.
  const [horizonKey, setHorizonKey] = useState("week");
  const [customDays, setCustomDays] = useState(21);
  const [oneMeal, setOneMeal] = useState(null);
  const [dayOptions, setDayOptions] = useState(null);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [cartIds, setCartIds] = useState(new Set());
  // This session's generate, as a { planId, meta, sig, at } record — the same
  // shape the DB column and the mirror hold, so all three resolve identically.
  // It is NOT the only copy any more: see resolveVerdict above.
  const [sessionVerdict, setSessionVerdict] = useState(null);
  const [meta, setMeta] = useState(null); // /profile/meta — used here only for proteinFloorSource

  // ── THE DAY-OPTIONS RACE ────────────────────────────────────────────────
  // Solving a day runs against a 45 s budget (TIMEOUT.SOLVER) while the day
  // selection is one arrow-key away from changing. Before this guard:
  //
  //   1. Monday selected → "3 options for Mon" → request M starts.
  //   2. → arrow → activeDay becomes Tue. setDayOptions(null) cleared the
  //      SCREEN and did nothing whatsoever to request M.
  //   3. M lands → setDayOptions(mondayOptions) → Monday's three candidates
  //      render under the Tuesday heading, indistinguishable from Tuesday's.
  //   4. "Accept this day" → acceptCandidate read the LIVE activeDay (Tue)
  //      → api.acceptDay(1, mondaySlots) → Monday's meals written into
  //      Tuesday. Silent, persistent, and invisible in the response.
  //
  // Two independent guards, because either one alone still loses:
  //   • a monotonic request token + one AbortController per request, so a
  //     superseded response can never reach setState. NOTE useAbortSignal
  //     (lib/useAbortable.js) does NOT solve this — it is per-MOUNT: it
  //     cancels on unmount and has no notion of superseding when an input
  //     changes, which is exactly the case here.
  //   • the day a solve was made for is STAMPED onto the state, the panel
  //     only renders while that stamp matches the selection, and the write
  //     refuses outright if it doesn't.
  const dayOptionsToken = useRef(0);
  const dayOptionsAbort = useRef(null);

  // Supersede + abort whatever day solve is in flight, and clear the panel.
  // Stable identity ([] deps) so the keyboard effect below never re-binds.
  const cancelDayOptions = useCallback(() => {
    dayOptionsToken.current += 1;
    dayOptionsAbort.current?.abort();
    dayOptionsAbort.current = null;
    setOptionsBusy(false);
    setDayOptions(null);
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      setPlan(await api.getCurrentPlan());
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    }
  }, []);

  useEffect(() => {
    loadPlan();
    api.getCart().then((items) => setCartIds(new Set(items.map((i) => i.recipeId)))).catch(() => {});
    api.getProfileMeta().then(setMeta).catch(() => {}); // citation text only — a failed fetch just hides it
  }, [loadPlan]);

  // Nothing in flight outlives this screen.
  useEffect(() => () => {
    dayOptionsAbort.current?.abort();
    genAbortRef.current?.abort();
  }, []);

  // Desktop chassis: ← / → move between days (ignored while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      setActiveDay((d) => (e.key === "ArrowLeft" ? (d + 6) % 7 : (d + 1) % 7));
      cancelDayOptions(); // NOT just setDayOptions(null) — kill the request too
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelDayOptions]);

  const selectDay = useCallback((i) => {
    setActiveDay(i);
    cancelDayOptions();
  }, [cancelDayOptions]);

  // A failed profile write used to escape as an unhandled rejection, which the
  // shell surfaces as the app CRASH dialog — for a mistyped meals-per-day. It
  // is a save that didn't happen: say so, and put the input back to what the
  // server actually holds, so the number on screen is never a lie.
  const commitMealConfig = useCallback(async () => {
    if (mealsDraft.meals === profile.mealsPerDay && mealsDraft.snacks === profile.snacksPerDay) return;
    setMealsSaving(true);
    setError(null);
    try {
      await api.putProfile({ mealsPerDay: mealsDraft.meals, snacksPerDay: mealsDraft.snacks });
      await refresh();
    } catch (e) {
      if (isAbortError(e)) return;
      setMealsDraft({ meals: profile.mealsPerDay, snacks: profile.snacksPerDay });
      setError(`Meal structure not saved — ${describeError(e)}`);
    } finally {
      setMealsSaving(false);
    }
  }, [mealsDraft, profile.mealsPerDay, profile.snacksPerDay, refresh]);

  // Memoised so it is ONE stable object per filter change: it is a dependency
  // of every solve below and a prop on every meal card, so rebuilding it each
  // render would defeat SlotCard's memo entirely.
  const apiFilters = useMemo(() => ({
    cuisines: filters.cuisines, protein: filters.protein || undefined,
    budget: filters.budget || undefined, maxPrepMin: filters.maxPrepMin || undefined,
    // Stage 3 caps: send only when set. `??` (not `||`) so a legit minTaste of 0
    // survives; off (null) omits the key and the server treats it as not enforced.
    maxCostCad: filters.maxCostCad ?? undefined,
    maxComplexity: filters.maxComplexity ?? undefined,
    minTaste: filters.minTaste ?? undefined,
    allowBatchRepeats: filters.allowBatchRepeats,
    proteinPriority: filters.proteinPriority,
  }), [filters]);

  // What the how-far-ahead control currently means, in the server's own
  // vocabulary: a preset key, or a plain day count for the custom input.
  const horizonValue = horizonKey === "custom" ? clampDays(customDays) : horizonKey;
  const horizonDays = horizonKey === "custom"
    ? clampDays(customDays)
    : (HORIZON_OPTIONS.find((h) => h.key === horizonKey)?.days ?? 7);
  const horizonLabel = horizonKey === "custom"
    ? `${clampDays(customDays)} days`
    : HORIZON_OPTIONS.find((h) => h.key === horizonKey)?.label ?? "1 week";

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    cancelDayOptions(); // a stale day solve must not land on top of a fresh plan
    // Drop only THIS session's copy. The stored verdict stays until a new one
    // replaces it, so a generate that fails or is cancelled leaves the week's
    // last real verdict on screen instead of blanking it for nothing.
    setSessionVerdict(null);
    setOneMeal(null);
    // A fresh AbortController per generate; the Cancel affordance aborts it and
    // request() throws an ABORTED ApiError, which we treat as a no-op (below).
    const controller = new AbortController();
    genAbortRef.current = controller;
    try {
      // How far ahead rides in the request body. api.generatePlan spreads its
      // options object AFTER the default body, so passing `body` here replaces
      // it — the one seam available without editing the shared api module.
      const body = JSON.stringify({ filters: apiFilters, horizon: horizonValue });
      const res = await api.generatePlan(apiFilters, { body, signal: controller.signal });
      const resMeta = res?.meta ?? null;
      if (resMeta?.horizon?.kind === "meal") {
        // A single dish is an ANSWER, not a plan — nothing was written, so the
        // meal plan must keep showing whatever it already was, and so must the
        // verdict on it. Recording this as the week's verdict would overwrite a
        // true statement about the week with one about a meal that was never
        // stored.
        setOneMeal(resMeta.oneMeal ?? null);
        if (res?.id) setPlan(res);
      } else {
        setPlan(res);
        // Stamp the verdict against the slots it actually judged — taken from
        // the response, which IS the week the solver scored, not from `plan`
        // state that has not re-rendered yet.
        if (res?.id && resMeta) {
          const rec = { planId: res.id, meta: resMeta, sig: planSlotSig(res), at: new Date().toISOString() };
          setSessionVerdict(rec);
          writeMirror(rec); // remove once POST /plans/generate writes Plan.verdict
        }
      }
    } catch (e) {
      // Cancel is not a failure: leave the plan exactly as it was, show no error
      // banner, and let the button go straight back to a retryable state.
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      if (genAbortRef.current === controller) genAbortRef.current = null;
      setGenerating(false);
    }
  }, [apiFilters, horizonValue, cancelDayOptions]);

  const cancelGenerate = useCallback(() => genAbortRef.current?.abort(), []);

  const loadDayOptions = useCallback(async () => {
    const solvedFor = activeDay;              // the day THIS request is about
    dayOptionsAbort.current?.abort();         // supersede anything already running
    const token = ++dayOptionsToken.current;
    const controller = new AbortController();
    dayOptionsAbort.current = controller;
    setOptionsBusy(true);
    setError(null);
    try {
      const res = await api.getDayOptions(solvedFor, apiFilters, { signal: controller.signal });
      if (token !== dayOptionsToken.current) return;   // superseded — drop it on the floor
      // Stamp the day. Everything downstream reads the stamp, never the live
      // selection, so what is on screen and what gets written are one day.
      setDayOptions({ ...res, solvedFor });
    } catch (e) {
      if (isAbortError(e) || token !== dayOptionsToken.current) return;
      setError(describeError(e));
    } finally {
      if (dayOptionsAbort.current === controller) dayOptionsAbort.current = null;
      if (token === dayOptionsToken.current) setOptionsBusy(false);
    }
  }, [activeDay, apiFilters]);

  const acceptCandidate = useCallback(async (candidate) => {
    // Second guard. These options were solved for exactly one day; if the
    // selection has moved since (or the stamp is missing — a response shape we
    // don't recognise), refuse, rather than write a day's meals into whichever
    // day happens to be selected right now.
    const solvedFor = dayOptions?.solvedFor;
    if (solvedFor == null || solvedFor !== activeDay) {
      setDayOptions(null);
      setError(`Those options were solved for a different day — pick ${DAY_NAMES[activeDay]} and solve again.`);
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      // Unsolved meals (no recipe found) simply aren't written — the day
      // keeps an honest gap rather than a fabricated meal.
      const updated = await api.acceptDay(solvedFor, candidate.slots.filter((s) => s.recipeId).map(toApplyPayload));
      setPlan(updated);
      setDayOptions(null);
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setAccepting(false);
    }
  }, [dayOptions, activeDay]);

  // Optimistic lock toggle: flip the meal now, reconcile with the server's
  // returned slot, roll the whole slots array back if the write fails.
  const onLockToggle = useCallback(async (slot) => {
    setBusySlotId(slot.id);
    const prevSlots = plan.slots;
    setPlan((p) => ({ ...p, slots: p.slots.map((s) => (s.id === slot.id ? { ...s, locked: !s.locked } : s)) }));
    try {
      const updated = await api.setSlotLock(plan.id, slot.id, !slot.locked);
      setPlan((p) => ({ ...p, slots: p.slots.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      setPlan((p) => ({ ...p, slots: prevSlots })); // rollback
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setBusySlotId(null);
    }
  }, [plan]);

  // Optimistic cart toggle: reflect membership immediately, undo it on error.
  const onCart = useCallback(async (recipeId) => {
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
      if (isAbortError(e)) return;
      setError(describeError(e));
    }
  }, [cartIds]);

  const onGenerateGroceryList = useCallback(async () => {
    setGroceryBusy(true);
    try {
      const list = await api.generateGroceryList(plan.id);
      setPlan((p) => ({ ...p, groceryList: list }));
    } catch (e) {
      if (isAbortError(e)) return;
      setError(describeError(e));
    } finally {
      setGroceryBusy(false);
    }
  }, [plan?.id]);

  // A tick that silently un-ticks itself is a bug report the user can't file.
  // Roll the checkbox back, SAY the save didn't land, then reload so the list
  // matches what the server actually stored.
  const onCheckItem = useCallback(async (name, checked) => {
    const setChecked = (v) => setPlan((p) => ({
      ...p,
      groceryList: { ...p.groceryList, items: p.groceryList.items.map((i) => (i.name === name ? { ...i, checked: v } : i)) },
    }));
    setChecked(checked);
    try {
      await api.checkGroceryItem(plan.id, name, checked);
    } catch (e) {
      if (isAbortError(e)) return;
      setChecked(!checked);
      setError(`"${name}" not saved — ${describeError(e)}`);
      loadPlan(); // reload truth
    }
  }, [plan?.id, loadPlan]);

  // ── derived data ────────────────────────────────────────────────────────
  // One pass over plan.slots for the whole 7-day board, instead of seven
  // filters plus a reduce on every hover- or keystroke-driven re-render.
  const slotsByDay = useMemo(() => {
    const byDay = Array.from({ length: 7 }, () => []);
    for (const s of plan?.slots || []) {
      if (s.dayOfWeek >= 0 && s.dayOfWeek < 7) byDay[s.dayOfWeek].push(s);
    }
    return byDay.map((slots) => ({ slots, totals: sumSlots(slots) }));
  }, [plan?.slots]);

  const daySlots = slotsByDay[activeDay].slots;
  const dayTotals = slotsByDay[activeDay].totals;
  const targetKcal = summary?.macros?.kcal ?? profile.targetKcal;

  // Recomputed from whatever slots are on screen right now, so a swap, an
  // accepted day or a recipe placed from another tab invalidates a stale
  // verdict without anything having to remember to clear it. A lock toggle
  // rebuilds the slots array too, but `locked` is not in the signature, so the
  // string comes out identical and the verdict correctly survives.
  const planSig = useMemo(() => planSlotSig(plan), [plan]);
  const verdict = useMemo(
    () => resolveVerdict(plan, planSig, sessionVerdict),
    [plan, planSig, sessionVerdict],
  );

  const groceryBySection = useMemo(() => {
    const gl = plan?.groceryList;
    if (!gl) return null;
    return gl.bySection || (gl.items || []).reduce((groups, item) => {
      const key = itemSection(item);
      (groups[key] = groups[key] || []).push(item);
      return groups;
    }, {});
  }, [plan?.groceryList]);

  const groceryText = useMemo(
    () => (plan?.groceryList?.items || []).map(itemLine).join("\n"),
    [plan?.groceryList],
  );
  const copyGroceryList = useCallback(() => navigator.clipboard?.writeText(groceryText), [groceryText]);
  const grocerySmsHref = `sms:?&body=${encodeURIComponent("Grocery list:\n" + groceryText)}`;
  const groceryMailtoHref = plan
    ? `mailto:?subject=${encodeURIComponent("Grocery list — week of " + fmtD(plan.startDate))}&body=${encodeURIComponent(groceryText)}`
    : "mailto:";

  const onToggleExpand = useCallback((id) => setExpandedId((cur) => (cur === id ? null : id)), []);

  return (
    <div>
      <PageHead title="Plan" sub={plan
        ? `Week of ${fmtD(plan.startDate)} · locked meals survive a regenerate · as close as your recipes allow`
        : "Whole days built around your targets. It gets as close as your recipes allow, and tells you where it missed."}>
        {plan !== undefined && (
          <Btn onClick={generate} disabled={generating}>
            {generating
              ? (horizonKey === "meal" ? "Fitting…" : "Generating…")
              : horizonKey === "meal" ? "Fit one meal"
                : `${plan ? "Regenerate" : "Generate"} ${horizonLabel}`}
          </Btn>
        )}
      </PageHead>

      {error && (
        <div className="mb-3">
          <ErrorNote msg={error} hint="Hit the button again — if it keeps failing, loosen the filters above (they can over-constrain the meal planner)." />
        </div>
      )}

      <div className="mb-4">
        <HorizonBar horizonKey={horizonKey} setHorizonKey={setHorizonKey}
          customDays={customDays} setCustomDays={setCustomDays} busy={generating}
          allowBatchRepeats={filters.allowBatchRepeats} />
      </div>

      <div className="mb-4">
        <FiltersBar filters={filters} setFilters={setFilters} proteinFloorSource={meta?.proteinFloorSource} />
      </div>

      {/* Honest staged progress while a generate is in flight — no fake %, real
          phases, cancellable. The meal plan below stays mounted and usable. */}
      {generating && (
        <div className="mb-4">
          <GenerationProgress
            kind={horizonKey === "meal" ? "meal" : "plan"}
            days={horizonDays}
            onCancel={cancelGenerate} />
        </div>
      )}

      {oneMeal && (
        <div className="mb-4">
          <OneMealCard oneMeal={oneMeal} />
        </div>
      )}

      {/* The verdict, from wherever it survived — DB, this session, or the
          mirror. When it no longer matches the meals on screen the numbers are
          withheld and the reason is stated; showing either one silently would
          be a target miss the user never sees. */}
      {verdict?.stale && (
        <div className="mb-4">
          <StaleVerdict reason={verdict.stale} />
        </div>
      )}

      {verdict && !verdict.stale && verdict.meta.horizon?.weekPlans?.length > 1 && (
        <div className="mb-4">
          <HorizonSummary horizon={verdict.meta.horizon} />
        </div>
      )}

      {verdict && !verdict.stale && verdict.meta.horizon?.kind !== "meal" && (
        <div className="mb-4">
          <SolverNarration meta={verdict.meta} />
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
            {/* 7-column week board (≥ xl): the shape of each day at a glance.
                Click or ← / → selects a day; the full detail renders below.
                Selection is a lightness step, not the brand green.

                A column here is ~100px wide, which is not enough for a recipe
                name — the board used to stack four of them per card and every
                one truncated, so "High-Protein Te…" and "High-Protein To…"
                read as the same meal and the card became six competing lines
                of grey with no entry point. ("Tajine de Poulet aux Carottes
                et Patates Douces" arrived in that slot too.) Names are not
                information at this width. So the card carries what IS legible
                in 100px: the day, its calories as the one number worth
                reading across seven columns, and a plain count of what fills
                it. Exceptions — unfilled slots, flagged meals — get their own
                amber line and are silent when there are none. The names live
                where they can actually be read: the hover title, and the full
                slot list below for the selected day. */}
            <div className="hidden xl:grid grid-cols-7 gap-1.5 mb-3">
              {DAY_NAMES.map((d, i) => {
                const { slots, totals: tot } = slotsByDay[i];
                const active = activeDay === i;
                const snacks = slots.filter((s) => s.slotType === "snack").length;
                const meals = slots.length - snacks;
                const open = slots.filter((s) => !s.recipe).length;
                const flagged = slots.filter((s) => s.warning).length;
                const fill = [
                  meals > 0 && `${meals} meal${meals === 1 ? "" : "s"}`,
                  snacks > 0 && `${snacks} snack${snacks === 1 ? "" : "s"}`,
                ].filter(Boolean).join(" · ");
                const exceptions = [
                  open > 0 && `${open} still to fill`,
                  flagged > 0 && `${flagged} flagged`,
                ].filter(Boolean).join(" · ");
                return (
                  <button key={d} onClick={() => selectDay(i)} aria-current={active ? "true" : undefined}
                    title={slots.length > 0
                      ? slots.map((s) => s.recipe ? s.recipe.name : "open meal").join(" · ")
                      : undefined}
                    className="rounded-xl px-2.5 py-2 text-left flex flex-col gap-1.5 min-h-[92px]"
                    style={{ background: active ? "var(--secondary)" : "var(--card)", border: `1px solid ${active ? "var(--muted-foreground)" : "var(--border)"}` }}>
                    <div className="flex items-baseline justify-between w-full">
                      <span className="text-[10px] font-extrabold uppercase" style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}>{d}</span>
                      <span className="mono text-[10px] font-bold" style={{ color: "var(--muted-foreground)" }}>
                        {plan ? fmtD(addDays(plan.startDate, i)).split(" ")[1] : ""}
                      </span>
                    </div>
                    {slots.length > 0 ? (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="mono stat-hero text-lg leading-none" style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}>{kc(tot.kcal)}</span>
                          <span className="text-[10px] font-bold" style={{ color: "var(--muted-foreground)" }}>kcal</span>
                        </div>
                        {fill && <div className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{fill}</div>}
                        {exceptions && (
                          <div className="text-[10px] font-semibold flex items-center gap-1 mt-auto" style={{ color: "var(--warn)" }}>
                            <AlertTriangle size={9} className="shrink-0" aria-hidden="true" />
                            <span className="min-w-0">{exceptions}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{plan ? "no meals" : "—"}</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* compact day picker (small windows) */}
            <div className="grid grid-cols-7 gap-1.5 mb-3 xl:hidden">
              {DAY_NAMES.map((d, i) => (
                <button key={d} onClick={() => selectDay(i)} aria-current={activeDay === i ? "true" : undefined}
                  className="py-2 rounded-xl text-center"
                  style={{ background: activeDay === i ? "var(--secondary)" : "var(--card)", border: `1px solid ${activeDay === i ? "var(--muted-foreground)" : "var(--border)"}` }}>
                  <div className="text-[10px] font-bold" style={{ color: "var(--muted-foreground)" }}>{d}</div>
                  <div className="text-sm font-extrabold" style={{ color: activeDay === i ? "var(--foreground)" : "var(--muted-foreground)" }}>
                    {plan ? fmtD(addDays(plan.startDate, i)).split(" ")[1] : ""}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>
                Day total: <b className="mono" style={{ color: "var(--foreground)" }}>{kc(dayTotals.kcal)}</b> kcal · {g1(dayTotals.protein)}P / {g1(dayTotals.fat)}F / {g1(dayTotals.carb)}C vs {kc(targetKcal)} target
              </div>
              <Btn small kind="ghost" onClick={loadDayOptions} disabled={optionsBusy}>
                <Sparkles size={12} className="inline mr-1" />{optionsBusy ? "Solving…" : `3 options for ${DAY_NAMES[activeDay]}`}
              </Btn>
            </div>

            {/* The stamp check is belt AND braces: the token guard already stops
                a superseded response from landing, and this stops anything that
                somehow did from rendering under the wrong day's heading. */}
            {dayOptions && dayOptions.solvedFor === activeDay && (
              <div className="mb-4">
                {dayOptions.diagnosis && !dayOptions.diagnosis.feasible && (
                  <div className="p-3.5 rounded-xl mb-3" style={{ background: "color-mix(in srgb, var(--warn) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warn) 40%, transparent)" }}>
                    {/* This panel now also fires when the best day we found is
                        merely outside the target range (not only when the
                        targets are unreachable), so the heading states that
                        severity rather than overstating it. Copy encodes
                        truth, same as colour. */}
                    <div className="text-xs font-extrabold uppercase tracking-wide mb-1" style={{ color: "var(--warn)" }}>Closest fit we could find — here's what's binding</div>
                    {dayOptions.diagnosis.reasons.map((r, i) => <div key={i} className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>· {r}</div>)}
                    {dayOptions.diagnosis.suggestions.map((s, i) => <div key={i} className="text-xs font-semibold mt-0.5" style={{ color: "var(--warn)" }}>→ {s}</div>)}
                  </div>
                )}
                {dayOptions.candidates.length > 0 && (
                  <>
                    <DayCandidates data={dayOptions} targetKcal={targetKcal} onAccept={acceptCandidate} accepting={accepting} />
                    <div className="text-[10.5px] font-semibold mt-2" style={{ color: "var(--muted-foreground)" }}>
                      The % is how close a day lands to your targets — 100% is rare and not the point. Green means it hit calories, protein, fat and carbs all within range; anything else is the closest we found, with the miss written on the card. "Accept" saves that day to your meal plan.
                    </div>
                  </>
                )}
              </div>
            )}

            {!plan ? (
              <Card>
                <div className="flex items-start gap-2">
                  <ChefHat size={18} style={{ color: "var(--muted-foreground)" }} className="mt-0.5 shrink-0" />
                  <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                    No plan yet — pick how far ahead above (1 meal through 1 month) and hit "{horizonKey === "meal" ? "Fit one meal" : `Generate ${horizonLabel}`}", or solve a single day with "3 options".
                  </div>
                </div>
              </Card>
            ) : (
              <div className="flex flex-col gap-2.5">
                {daySlots.map((slot) => (
                  <SlotCard key={slot.id} planId={plan.id} slot={slot} expanded={expandedId === slot.id}
                    onToggleExpand={onToggleExpand}
                    onLockToggle={onLockToggle} busy={busySlotId === slot.id}
                    filters={apiFilters} reloadPlan={loadPlan}
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
                  <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Meals / day</span>
                  <input type="number" min={1} max={6} value={mealsDraft.meals} disabled={mealsSaving}
                    onChange={(e) => setMealsDraft((d) => ({ ...d, meals: Math.max(1, +e.target.value || 1) }))}
                    onBlur={commitMealConfig}
                    className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle} />
                </label>
                <label className="block">
                  <span className="text-xs font-bold" style={{ color: "var(--muted-foreground)" }}>Snacks / day</span>
                  <input type="number" min={0} max={4} value={mealsDraft.snacks} disabled={mealsSaving}
                    onChange={(e) => setMealsDraft((d) => ({ ...d, snacks: Math.max(0, +e.target.value || 0) }))}
                    onBlur={commitMealConfig}
                    className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle} />
                </label>
              </div>
              <div className="text-xs font-semibold mt-2" style={{ color: "var(--muted-foreground)" }}>
                {mealsSaving ? "Saving…" : "Applies on the next generate/regenerate."}
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
                      <a href={grocerySmsHref} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                        <MessageCircle size={12} />Text
                      </a>
                      <a href={groceryMailtoHref} className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1" style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                        <Mail size={12} />Email
                      </a>
                    </div>
                    {Object.entries(groceryBySection || {})
                      .filter(([, items]) => items.length > 0)
                      .map(([section, items]) => (
                        <div key={section} className="mb-2.5">
                          <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-1" style={{ color: "var(--muted-foreground)" }}>{SECTION_LABELS[section] || section}</div>
                          {items.map((i) => {
                            const grams = itemGrams(i);
                            const hh = toHouseholdUnit(i.name, grams);
                            const practical = i.purchaseUnits?.display;
                            return (
                              <label key={i.name} className="flex items-start gap-2.5 py-1.5" style={{ borderBottom: "1px solid var(--border)", opacity: i.checked ? 0.45 : 1 }}>
                                {/* Law (a): a ticked box is a state, not a
                                    success — neutral --ink, never --good. */}
                                <input type="checkbox" checked={!!i.checked} onChange={(e) => onCheckItem(i.name, e.target.checked)}
                                  className="mt-0.5 w-4 h-4 shrink-0" style={{ accentColor: "var(--foreground)" }} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-bold" style={{ color: "var(--foreground)", textDecoration: i.checked ? "line-through" : "none" }}>
                                    {practical ? `${practical} — ${i.name}` : i.name}
                                  </div>
                                  <div className="mono text-[10.5px] font-semibold" style={{ color: "var(--muted-foreground)" }}>
                                    {grams} g{hh ? ` · ≈${hh}` : ""}{i.purchaseUnits?.approx ? ` · ${i.purchaseUnits.approx}` : ""}
                                    {/* The ≈ is not decoration: this is a
                                        keyword match against a hand-entered
                                        price table, so it must never read as
                                        a quoted price. */}
                                    {i.cost != null && <> · ≈${i.cost.amountCad.toFixed(2)}</>}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    {/* WEEKLY TOTAL DELIBERATELY WITHHELD. The server sums item
                        costs priced on the grams the plan CONSUMES
                        (groceryList.js: estimateCostCad(name, purchase.grams))
                        while every line above shows the whole retail package
                        you actually buy — and items with no keyword match are
                        dropped from the sum entirely rather than flagged. The
                        two disagree by a large multiple, so a total here would
                        be a confidently wrong number, which is worse than
                        none. Restore it once the backend prices whole packages
                        and accounts for the unpriced items. */}
                    <div className="text-xs font-semibold mt-1 pt-2" style={{ color: "var(--muted-foreground)", borderTop: "1px solid var(--border)" }}>
                      Per-item estimates only — no weekly total yet. Each price is charged on the grams your plan uses, while the line above it lists a whole package, so adding them up would understate the real shop.
                      {plan.groceryList.costCoverageNote
                        ? ` ${stripSourcePaths(plan.groceryList.costCoverageNote)}`
                        : " Practical units are typical retail sizes — grams are the ground truth."}
                    </div>
                  </>
                ) : (
                  <div className="text-sm font-semibold" style={{ color: "var(--muted-foreground)" }}>Generate a list from this week's plan.</div>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
