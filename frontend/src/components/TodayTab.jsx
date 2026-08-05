import { useState, useEffect, useMemo, useCallback, useRef, useId } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Camera, Trash2, CalendarDays, ArrowRight, LineChart, NotebookPen, ClipboardCheck, Plus, Sparkles, AlertTriangle, UserCog, Search, Pencil, CornerDownLeft, Heart } from "lucide-react";
import { C, getStampStyle } from "../lib/theme.js";
import { todayStr, dayNum, addDays, fmtD } from "../lib/dates.js";
import { displayWeight, parseWeight, weightUnit, rateUnit, displayRate, weightInputBounds } from "../lib/units.js";
import { Btn, Chip, Stamp, Ring, EmptyNote, ErrorNote } from "./ui/Parts.jsx";
import { SectionCard } from "./ui/section-card.jsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonRows } from "./ui/Skeleton.jsx";
import { api, ApiError, ERR, isAbortError, describeError } from "../lib/api.js";
import { useAbortSignal } from "../lib/useAbortable.js";
import { readProfileProvisional, describeAssumptions } from "./SetupWizard.jsx";

// NaN-safe. Every caller feeds this a number that can be absent (a summary
// field before the first weigh-in, a macro on a profile with no body-fat %),
// and `Math.round(undefined).toLocaleString()` throws — while
// `Math.round(NaN)` sails through and renders the literal word "NaN" inside a
// sentence about the user's food. An em dash is the honest answer for a number
// the app does not have.
const kc = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-CA") : "—");
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);
const gm = (n) => (Number.isFinite(n) ? Math.round(n) : 0);

// Diary source → a short, neutral label. Provenance is text, not color
// (green is reserved; the macro triad means macros only).
const DIARY_SOURCE_LABEL = { planned: "from plan", "log-planned": "from plan", recipe: "recipe", manual: "logged" };
// slotType is a storage label ("meal" | "snack"); the screen says the word.
const SLOT_LABEL = { meal: "Meal", snack: "Snack", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const slotWord = (s) => (typeof s === "string" && s ? SLOT_LABEL[s] || s[0].toUpperCase() + s.slice(1) : null);

// dayOfWeek in the plan model is 0=Monday..6=Sunday; JS getDay() is 0=Sunday.
function isoWeekday() {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

// ── food search seam ──────────────────────────────────────────────────────
// TEMPORARY. This call belongs in lib/api.js as `api.searchDiaryFoods(q)`,
// alongside every other route the app talks to — that file is owned by another
// workstream this pass, so the request is made here instead of silently
// forking the client. It deliberately reuses the shared pieces it can: the same
// relative /api base (correct in dev through Vite's proxy, in production
// through Express, and in the Electron shell whose renderer is served from the
// backend's own origin), the same credentials mode, the same ApiError taxonomy,
// and the same describeError() voice.
//
// The one thing it does NOT inherit is the global 401 seam: a session that
// expires mid-search fails this call quietly instead of signing the user out
// (the next api.* call does that). Moving this into api.js closes that gap.
const FOOD_SEARCH_TIMEOUT_MS = 8000;
async function searchDiaryFoods(query, { signal, limit = 20 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FOOD_SEARCH_TIMEOUT_MS);
  const relay = () => controller.abort();
  signal?.addEventListener("abort", relay, { once: true });
  const path = `/diary/food-search?q=${encodeURIComponent(query)}&limit=${limit}`;
  try {
    const res = await fetch(`/api${path}`, { credentials: "include", signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(body?.error || `search failed: ${res.status}`, {
        kind: ERR.HTTP, status: res.status, body, method: "GET", path,
      });
    }
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

// ── macro rails ───────────────────────────────────────────────────────────
// The Engine states the model in one line: "protein and calories are
// load-bearing walls · fat is a floor · carbs flex." Today used to contradict
// it — every bar was drawn against the HIGH end of a range as if it were a
// single target, so a plan the solver scored as near-perfect rendered as
// "Fat 117 / 65 g", a bar at 180 % and, to any reader, a failure. The same
// arithmetic made a user sitting exactly at the bottom of the protein range
// see an 85 %-filled bar and read a miss.
//
// So: a floor is drawn as a floor and a range as a range, and the numbers say
// which is which in words. The rail's scale grows to fit whatever was actually
// eaten, so nothing ever overflows its own track, and the target zone stays
// visible as a zone. Over the top of a RANGE turns the number calm amber
// (design law b — never red on food data); over a FLOOR is not a fault at all
// and is never tinted.
function MacroRail({ label, letter, actual, lo, hi, kind, color }) {
  const eaten = Number.isFinite(actual) ? actual : 0;
  const floor = Number.isFinite(lo) ? lo : 0;
  const ceil = kind === "range" && Number.isFinite(hi) ? hi : null;
  const over = ceil != null && eaten > ceil;

  const span = Math.max(ceil ?? floor, eaten, 1);
  const pct = (v) => `${Math.max(0, Math.min(100, (v / span) * 100))}%`;
  const targetText = kind === "floor" ? `min ${gm(floor)}g` : `${gm(floor)}–${gm(ceil ?? floor)}g`;
  const a11y = kind === "floor"
    ? `${label}: ${gm(eaten)} grams, minimum ${gm(floor)}${eaten >= floor ? ", met" : ""}`
    : `${label}: ${gm(eaten)} grams, range ${gm(floor)} to ${gm(ceil ?? floor)}${over ? ", above the range" : ""}`;

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={a11y}>
      <div className="flex justify-between items-baseline text-xs">
        <span className="font-bold flex items-center gap-1.5 text-foreground">
          <span aria-hidden="true" className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold shrink-0" style={{ background: color, color: C.paper }}>{letter}</span>
          {label}
        </span>
        <span className="font-semibold text-muted-foreground">
          <b className={`tabular-nums ${over ? "text-warn" : "text-foreground"}`}>{gm(eaten)}</b> / {targetText}
        </span>
      </div>
      <div aria-hidden="true" className="h-2.5 rounded-full relative overflow-hidden bg-secondary">
        {/* the acceptable zone, drawn behind the fill: from the floor to the
            top of the range, or from the floor to the end of the rail when
            the floor is all there is. */}
        <div
          className="absolute inset-y-0 bg-border"
          style={{ left: pct(floor), right: ceil != null ? `calc(100% - ${pct(ceil)})` : 0 }}
        />
        <div className="h-full rounded-full transition-all duration-150 relative" style={{ width: pct(eaten), background: color }}></div>
        {/* the floor tick — the number that actually has to be reached */}
        <div className="absolute inset-y-0 w-px bg-muted-foreground" style={{ left: pct(floor) }} />
      </div>
    </div>
  );
}

// The three rails plus the one sentence that explains why they aren't three
// identical targets. Used by both the plan card and the diary.
function MacroRails({ protein, carb, fat, macros }) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <MacroRail label="Protein" letter="P" actual={protein} lo={macros?.proteinLo} hi={macros?.proteinHi} kind="range" color={C.protein} />
        <MacroRail label="Carbs" letter="C" actual={carb} lo={macros?.carbLo} hi={macros?.carbHi} kind="range" color={C.carb} />
        <MacroRail label="Fat" letter="F" actual={fat} lo={macros?.fatLo} hi={macros?.fatHi} kind="floor" color={C.fat} />
      </div>
      <div className="text-[10.5px] font-semibold mt-2.5 leading-relaxed text-muted-foreground">
        Calories and protein are the walls. Fat has a minimum to clear; carbs take whatever calories are left,
        so they move the most.
      </div>
    </>
  );
}

// ── the food picker ───────────────────────────────────────────────────────
// Keyboard-first, because this runs three-plus times a day: type, arrow, enter,
// type the grams, enter. The mouse is optional at every step.
//
// Two things it refuses to do. It never shows a macro number without saying
// where the number came from (the per-100 g figures ride in the row, so the
// choice is informed BEFORE it is made), and it never presents a row the
// library itself flags as unreliable as if it were clean — the server demotes
// those below every good match and hands over a plain-English reason, which is
// printed here in full, both in the list and again at the moment of choosing.
function CautionNote({ caution, avoid, compact }) {
  if (!caution && !avoid) return null;
  const high = caution?.level === "high";
  const tone = high || avoid ? C.warn : C.faintLight;
  return (
    <div className={`flex items-start gap-1.5 ${compact ? "text-[10px]" : "text-[11px]"} font-semibold`} style={{ color: tone }}>
      {(high || avoid) && <AlertTriangle size={compact ? 10 : 12} className="shrink-0 mt-px" aria-hidden="true" />}
      <span>
        {caution && <>{caution.label} — {caution.reason}.</>}
        {caution && avoid && " "}
        {avoid && avoid.reason}
      </span>
    </div>
  );
}

function FoodPicker({ onChoose, onManual, autoFocus }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState("idle"); // idle | searching | done | error
  const [payload, setPayload] = useState(null);
  const [err, setErr] = useState(null);
  const [active, setActive] = useState(0);
  const abort = useAbortSignal();
  const seq = useRef(0);
  const inputRef = useRef(null);
  const listId = useId();

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setPayload(null); setState("idle"); setErr(null); return undefined; }
    setState("searching");
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      searchDiaryFoods(query, { signal: abort.signal })
        .then((body) => {
          if (mine !== seq.current) return; // a newer keystroke already won
          setPayload(body); setState("done"); setActive(0); setErr(null);
        })
        .catch((e) => {
          if (isAbortError(e) || mine !== seq.current) return;
          setErr(describeError(e, "Couldn't search your food library."));
          setState("error");
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [q, abort]);

  const results = payload?.results || [];
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); onChoose(results[active]); }
    else if (e.key === "Escape" && q) { e.preventDefault(); setQ(""); }
  };

  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search your food library"
            placeholder="Search 14,000+ foods — chicken breast, oats, milk…"
            className="w-full text-sm pl-9 pr-3 py-2.5 rounded-xl"
            style={inpStyle}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <Btn small kind="ghost" onClick={onManual}>
          <Pencil size={12} className="inline mr-1" aria-hidden="true" />Not in the library
        </Btn>
      </div>

      {/* One live sentence for screen readers — result counts, the empty state
          and the failure all arrive here without stealing focus from the box. */}
      <div className="sr-only" role="status" aria-live="polite">
        {state === "error" ? err
          : state === "searching" ? "Searching…"
            : state === "done" ? `${payload.total} match${payload.total === 1 ? "" : "es"}${payload.total ? ". Use the arrow keys to choose, Enter to pick." : ""}`
              : ""}
      </div>

      {state === "error" && (
        <div className="mt-3"><ErrorNote msg={err} hint="Your library is still there — this is a search failure, not a missing database. Try again, or add the item by hand." /></div>
      )}

      {state === "searching" && q.trim().length >= 2 && !payload && (
        <div className="mt-3"><SkeletonRows rows={3} /></div>
      )}

      {state === "done" && (
        <div className="mt-3">
          <div className="text-[10.5px] font-semibold mb-1" style={{ color: C.faint }}>
            {payload.total === 0
              ? "Nothing in your library matches that."
              : `${payload.truncated ? `${payload.total}+` : payload.total} match${payload.total === 1 ? "" : "es"}${payload.total > results.length ? ` — showing the closest ${results.length}, keep typing to narrow it down` : ""}`}
          </div>
          {payload.total === 0 ? (
            <div className="text-xs font-semibold" style={{ color: C.faint }}>
              Add it by hand with the button above — it still counts toward today.
            </div>
          ) : (
            <ul id={listId} role="listbox" aria-label="Search results" className="max-h-64 overflow-y-auto rounded-xl" style={{ border: `1px solid ${C.rule}` }}>
              {results.map((f, i) => (
                <li
                  key={f.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onChoose(f)}
                  className="pl-2.5 pr-3 py-2 cursor-default"
                  // Selection is a LIGHTNESS step plus a quiet rail, never
                  // green (design law a). The panel behind this list is already
                  // `card-2`, so highlighting with `card-2` would be invisible —
                  // `rule` is a translucent white that lifts whatever it sits
                  // on, which is exactly what the surface ladder asks for.
                  style={{
                    background: i === active ? C.rule : "transparent",
                    borderBottom: `1px solid ${C.rule}`,
                    borderLeft: `3px solid ${i === active ? C.faintLight : "transparent"}`,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-bold truncate" style={{ color: C.ink }}>{f.name}</span>
                    <span className="text-[10.5px] font-semibold shrink-0 mono" style={{ color: C.faint }}>
                      {f.per100g.kcal} kcal · {f.per100g.proteinG}P {f.per100g.carbG}C {f.per100g.fatG}F <span style={{ color: C.faintLight }}>/ 100 g</span>
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 mt-0.5">
                    <CautionNote caution={f.caution} avoid={f.avoid} compact />
                    <span className="text-[10px] font-semibold shrink-0 ml-auto" style={{ color: C.faintLight }}>{f.provenance}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Step two: how much of it. Grams in, the four numbers out — recomputed live
// and shown BEFORE saving, because the whole point of the picker is that the
// user sees the number that is about to land in their day.
function PortionRow({ food, grams, setGrams, onSave, onBack, busy }) {
  const g = parseFloat(grams);
  const valid = Number.isFinite(g) && g > 0 && g <= 5000;
  const f = valid ? g / 100 : 0;
  const macro = {
    kcal: Math.round(food.per100g.kcal * f),
    proteinG: r1(food.per100g.proteinG * f),
    carbG: r1(food.per100g.carbG * f),
    fatG: r1(food.per100g.fatG * f),
  };
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-extrabold uppercase tracking-wide" style={{ color: C.faint }}>Logging</div>
          <div className="text-sm font-bold truncate" style={{ color: C.ink }}>{food.name}</div>
          <div className="text-[10.5px] font-semibold" style={{ color: C.faintLight }}>
            {food.provenance} · {food.per100g.kcal} kcal per 100 g
          </div>
        </div>
        <label className="block">
          <span className="text-[10.5px] font-extrabold uppercase tracking-wide" style={{ color: C.faint }}>Grams</span>
          <input
            autoFocus
            type="number" inputMode="decimal" min="1" step="1"
            aria-label="Grams eaten"
            className="text-sm px-3 py-2 rounded-lg w-24 block mt-0.5" style={inpStyle}
            value={grams}
            // The 100 g default is a SUGGESTION, so it arrives selected: in the
            // keyboard path the very next thing typed is the real weight, and
            // an unselected default turns "200" into "100200".
            onFocus={(e) => e.target.select()}
            onChange={(e) => setGrams(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && valid && !busy) { e.preventDefault(); onSave(macro); } }}
          />
        </label>
        <Btn small onClick={() => onSave(macro)} disabled={busy || !valid}>
          {busy ? "…" : <>Save <CornerDownLeft size={11} className="inline ml-1" aria-hidden="true" /></>}
        </Btn>
        <Btn small kind="ghost" onClick={onBack} disabled={busy}>Change food</Btn>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3" aria-live="polite">
        <span className="mono text-lg font-extrabold" style={{ color: C.ink }}>{valid ? kc(macro.kcal) : "—"}</span>
        <span className="text-[10.5px] font-semibold" style={{ color: C.faint }}>kcal</span>
        <Chip color={C.proteinText} bg={`${C.protein}1F`}>{valid ? macro.proteinG : "—"}P</Chip>
        <Chip color={C.carbText} bg={`${C.carb}1F`}>{valid ? macro.carbG : "—"}C</Chip>
        <Chip color={C.fatText} bg={`${C.fat}1F`}>{valid ? macro.fatG : "—"}F</Chip>
        {!valid && <span className="text-[11px] font-semibold" style={{ color: C.warn }}>Enter a weight in grams (1–5,000).</span>}
      </div>

      {(food.caution || food.avoid) && (
        <div className="mt-2 p-2.5 rounded-lg" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
          <CautionNote caution={food.caution} avoid={food.avoid} />
        </div>
      )}
    </div>
  );
}

// ── Food diary ("ate as planned" + per-item logging) ──────────────────────
// Planned vs. actually-eaten. Every path degrades gracefully: a 404 (route not
// shipped) or a missing field yields a calm empty state and inline notes — it
// never throws. Entries carry proteinG/carbG/fatG; the totals block carries
// protein/carb/fat.
function DiaryCard({ date, macros, hasPlan }) {
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const [diary, setDiary] = useState(undefined); // undefined=loading | {entries,totals} | "error"
  const [soon, setSoon] = useState(false);       // GET 404 → route not live yet
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState("search");    // search | portion | manual
  const [picked, setPicked] = useState(null);
  const [grams, setGrams] = useState("100");
  const [form, setForm] = useState({ name: "", kcal: "", proteinG: "", carbG: "", fatG: "" });
  const [note, setNote] = useState(null);        // calm inline note (never red — law b)
  const [targetStale, setTargetStale] = useState(false);
  const abort = useAbortSignal();
  const loadSeq = useRef(0);

  // Keyed on `date`, and race-safe. Previously a slow response for one day
  // could land after a fast one for another and overwrite it — latent only
  // because `date` was hardcoded to today, and a live bug the moment a date
  // picker exists. The sequence guard makes the LAST request issued the only
  // one allowed to set state, whatever order the answers arrive in.
  const load = useCallback(async () => {
    const mine = ++loadSeq.current;
    try {
      const res = await api.getDiary(date, { signal: abort.signal });
      if (mine !== loadSeq.current) return;
      setDiary({ entries: res?.entries ?? [], totals: res?.totals ?? null });
      setSoon(false);
    } catch (e) {
      if (isAbortError(e) || mine !== loadSeq.current) return;
      if (e.status === 404) { setDiary({ entries: [], totals: null }); setSoon(true); }
      else setDiary("error");
    }
  }, [date, abort]);
  useEffect(() => { load(); }, [load]);

  const entries = (diary && diary !== "error") ? (diary.entries || []) : [];
  const totals = useMemo(() => {
    const d = (diary && diary !== "error") ? diary : null;
    const t = d ? d.totals : null;
    if (t) return { kcal: t.kcal ?? 0, protein: t.protein ?? 0, carb: t.carb ?? 0, fat: t.fat ?? 0 };
    // No server totals (or after an optimistic delete): sum the entries.
    return (d ? d.entries || [] : []).reduce((a, e) => ({
      kcal: a.kcal + (e.kcal || 0), protein: a.protein + (e.proteinG || 0),
      carb: a.carb + (e.carbG || 0), fat: a.fat + (e.fatG || 0),
    }), { kcal: 0, protein: 0, carb: 0, fat: 0 });
  }, [diary]);

  // A 404 on any action means the route isn't live yet — say so calmly.
  const friendly = (e, fallback) =>
    e.status === 404 ? "Food logging isn't live yet — it activates when the diary update ships." : describeError(e, fallback);

  const applyResult = (res) => {
    setDiary({ entries: res?.entries ?? [], totals: res?.totals ?? null });
    setTargetStale(Boolean(res?.targetStale));
    setSoon(false);
  };

  const logPlanned = async () => {
    setBusy(true); setNote(null);
    try {
      applyResult(await api.logPlannedDiary(date));
    } catch (e) { setNote(friendly(e, "Couldn't copy your plan — try again.")); if (e.status === 404) setSoon(true); }
    finally { setBusy(false); }
  };

  const openAdd = () => {
    setAdding(true); setMode("search"); setPicked(null); setGrams("100"); setNote(null);
  };
  const closeAdd = () => {
    setAdding(false); setPicked(null); setMode("search"); setNote(null);
  };

  // ONE save path for both the picker and the hand-typed fallback, so the two
  // can never drift into validating differently.
  const saveEntry = async ({ name, kcal, proteinG, carbG, fatG }) => {
    setBusy(true); setNote(null);
    try {
      applyResult(await api.addDiaryEntry({ date, name, kcal, proteinG, carbG, fatG }));
      setForm({ name: "", kcal: "", proteinG: "", carbG: "", fatG: "" });
      setPicked(null);
      setGrams("100");
      setMode("search"); // straight back to the box, ready for the next item
    } catch (e) {
      setNote(friendly(e, "Couldn't save that entry — try again."));
      if (e.status === 404) setSoon(true);
    } finally { setBusy(false); }
  };

  const savePicked = (macro) => {
    const g = parseFloat(grams);
    saveEntry({ name: `${picked.name} (${gm(g)} g)`, ...macro });
  };

  const submitManual = () => {
    const kcal = Number(form.kcal);
    // 0 kcal is a REAL entry — black coffee, water, plain spices. The old guard
    // rejected it as "no calories", which made the honest rows unloggable.
    if (!form.name.trim() || form.kcal === "" || !Number.isFinite(kcal) || kcal < 0) {
      setNote("Give the item a name and its calories (0 is fine for coffee or water).");
      return;
    }
    saveEntry({
      name: form.name.trim(), kcal,
      proteinG: Number(form.proteinG) || 0, carbG: Number(form.carbG) || 0, fatG: Number(form.fatG) || 0,
    });
  };

  // Optimistic delete: drop the row now, restore it if the server rejects.
  // The only undo in the app — keep it.
  const removeEntry = async (id) => {
    const prev = diary;
    setNote(null);
    setDiary((d) => ({ entries: (d.entries || []).filter((e) => e.id !== id), totals: null }));
    try {
      await api.deleteDiaryEntry(id);
    } catch (e) {
      setDiary(prev); // rollback to the pre-delete truth
      setNote(friendly(e, "Couldn't remove that entry — try again."));
    }
  };

  const over = macros?.kcal ? totals.kcal > macros.kcal : false;

  return (
    <SectionCard section="DIARY" title="Food diary — what you actually ate" className="xl:col-span-12">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button size="sm" onClick={logPlanned} disabled={busy || !hasPlan}>
          <ClipboardCheck size={12} className="inline mr-1" />{busy ? "Working…" : "Ate as planned"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => (adding ? closeAdd() : openAdd())}>
          <Plus size={12} className="inline mr-1" />{adding ? "Close" : "Add item"}
        </Button>
        {!hasPlan && (
          <span className="text-[10.5px] font-semibold text-muted-foreground">
            Generate a plan to enable "Ate as planned".
          </span>
        )}
      </div>

      {adding && (
        <div className="mb-4 p-3 rounded-xl border border-border bg-secondary/50">
          {mode === "search" && (
            <FoodPicker
              autoFocus
              onChoose={(f) => { setPicked(f); setGrams("100"); setMode("portion"); }}
              onManual={() => { setMode("manual"); setNote(null); }}
            />
          )}

          {mode === "portion" && picked && (
            <PortionRow
              food={picked} grams={grams} setGrams={setGrams} busy={busy}
              onSave={savePicked}
              onBack={() => { setPicked(null); setMode("search"); }}
            />
          )}

          {mode === "manual" && (
            <div>
              <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2" style={{ color: C.faint }}>
                By hand — for anything the library doesn't have
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <input className="text-sm px-3 py-2 rounded-lg flex-1 min-w-[160px]" style={inpStyle} placeholder="Item name" aria-label="Item name"
                  value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && !busy && submitManual()} />
                {[["kcal", "kcal", "kcal"], ["proteinG", "P (g)", "Protein grams"], ["carbG", "C (g)", "Carb grams"], ["fatG", "F (g)", "Fat grams"]].map(([k, ph, name]) => (
                  <input key={k} type="number" inputMode="decimal" className="text-sm px-2 py-2 rounded-lg w-20" style={inpStyle} placeholder={ph} aria-label={name}
                    value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && !busy && submitManual()} />
                ))}
                <Btn small onClick={submitManual} disabled={busy}>{busy ? "…" : "Save"}</Btn>
                <Btn small kind="ghost" onClick={() => setMode("search")} disabled={busy}>
                  <Search size={12} className="inline mr-1" aria-hidden="true" />Search instead
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* role="alert": food-logging feedback (save failures, validation) —
          ED-safety relevant that this reaches screen-reader users reliably. */}
      {note && <div role="alert" className="text-xs font-semibold mb-3 text-warn">{note}</div>}

      {/* The target recompute is best-effort on the server: the food is saved
          either way, but a failure used to be swallowed whole and the user was
          left reading a stale target with nothing to indicate it. */}
      {targetStale && (
        <div role="status" className="text-[11px] font-semibold mb-3 text-muted-foreground">
          Saved. Your target didn't re-derive just now — it catches up on your next weigh-in or profile save.
        </div>
      )}

      {diary === undefined ? (
        <SkeletonRows rows={3} />
      ) : diary === "error" ? (
        <ErrorNote msg="Couldn't load today's diary." hint="Switch tabs and back to retry; if it keeps failing, restart the app." />
      ) : entries.length === 0 ? (
        <EmptyNote icon={NotebookPen} title="Nothing logged today yet"
          hint={soon
            ? "Logging activates when the diary update ships — your plan and targets work as normal until then."
            : "Use “Ate as planned” to copy today’s plan, or search your food library with “Add item”."} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* eaten vs target */}
          <div className="lg:col-span-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Eaten today</div>
            <div className={`font-heading text-3xl font-bold tabular-nums ${over ? "text-warn" : "text-foreground"}`}>
              {kc(totals.kcal)}
              <span className="text-xs ml-1 font-semibold tracking-normal text-muted-foreground">/ {kc(macros?.kcal)} kcal</span>
            </div>
            {over && (
              // What the engine can actually promise. It moves on a WEEKLY
              // update, capped, and only once it has enough weigh-ins, logged
              // days and coverage to be in effect at all — so "tomorrow's
              // target already adjusts" was a promise it cannot keep for a new
              // user, and a person who eats over on day 2 and sees no change
              // has been told the app is broken.
              <div className="text-xs font-semibold mt-1 mb-2 text-warn">
                Over by {kc(totals.kcal - macros.kcal)}. Nothing to undo — as your weigh-ins build up, the engine
                re-reads your real burn and moves the target itself.
              </div>
            )}
            <div className="mt-3">
              <MacroRails protein={totals.protein} carb={totals.carb} fat={totals.fat} macros={macros} />
            </div>
          </div>
          {/* entries */}
          <div className="lg:col-span-7">
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-1 text-muted-foreground">
              {entries.length} item{entries.length === 1 ? "" : "s"} logged
            </div>
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2 row-host border-b border-border">
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate text-foreground">{e.name}</div>
                  <div className="text-[10.5px] font-semibold text-muted-foreground">
                    {[slotWord(e.slotType), DIARY_SOURCE_LABEL[e.source] || e.source].filter(Boolean).join(" · ") || "logged"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="tabular-nums text-sm font-extrabold text-foreground">{kc(e.kcal || 0)}</span>
                  {/* P/C/F — the same order as the rails above and every other
                      macro triad in the app (design law c). */}
                  <span className="hidden md:flex gap-1">
                    <Chip color={C.proteinText} bg={`${C.protein}1F`}>{r1(e.proteinG || 0)}P</Chip>
                    <Chip color={C.carbText} bg={`${C.carb}1F`}>{r1(e.carbG || 0)}C</Chip>
                    <Chip color={C.fatText} bg={`${C.fat}1F`}>{r1(e.fatG || 0)}F</Chip>
                  </span>
                  <button onClick={() => removeEntry(e.id)} className="row-reveal text-muted-foreground" aria-label={`Remove ${e.name}`}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Provisional-profile banner (onboarding-flow-3) ──────────────────────────
// Persistent, unmissable, and self-clearing. It exists so that a profile built
// from defaults can never be mistaken for the user's own — every derived
// number on this screen is an estimate until they finish, and the app says so
// out loud rather than quietly presenting a fabricated prescription.
function ProvisionalBanner({ pref }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 p-4 rounded-2xl border border-warn/40 bg-warn/10">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-foreground">
            Estimates from defaults — these aren&apos;t your numbers yet
          </div>
          <div className="text-xs font-semibold mt-1 leading-relaxed text-muted-foreground">
            Your target, macros and plan are all derived from an assumed person, because your real
            height and weight were never entered. Open the <strong className="text-foreground">Profile</strong> tab
            and fill them in — this notice disappears on its own the moment you do.
          </div>
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="text-[11px] font-bold mt-2 underline decoration-dotted underline-offset-4 text-warn">
            {open ? "Hide what was assumed" : "Show what was assumed"}
          </button>
          {open && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-1 mt-2.5">
              {describeAssumptions(pref).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-[11px] font-semibold py-0.5 border-b border-border">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="tabular-nums text-foreground">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <UserCog size={16} className="shrink-0 hidden lg:block text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
  );
}

// ── unsolved-slot warnings (fleet finding E3) ───────────────────────────────
// The constitution requires the solver to declare "unsolvable + why" — silent
// target misses are forbidden — and it does: weeklyPlanner writes a
// plain-English reason onto PlanSlot.warning, the one honesty signal that
// survives a restart. That reason then rendered on the Plan tab and NOWHERE
// ELSE, so the screen the user actually opens every day could show a plan that
// blew its target with no sign at all that anything had gone wrong. A 4,623
// kcal day against a 2,000 kcal target carried zero visible warnings here.
//
// Amber, never red (design law b): an unsolved slot is a re-planning task, not
// a verdict on the person. The full solver sentence is printed unabridged —
// truncating the "why" would recreate the silent miss in a smaller font — and
// the copy names the fix and says out loud that nothing needs undoing.
function SlotWarnings({ slots }) {
  const flagged = slots.filter((s) => typeof s.warning === "string" && s.warning.trim());
  if (flagged.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={`${flagged.length} planned slot${flagged.length === 1 ? "" : "s"} today did not fit your targets`}
      className="mb-4 p-3.5 rounded-2xl border border-warn/40 bg-warn/10"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold text-foreground">
            {flagged.length === 1
              ? "1 slot today couldn't be solved to your targets"
              : `${flagged.length} slots today couldn't be solved to your targets`}
          </div>
          <ul className="flex flex-col gap-1.5 mt-2">
            {flagged.map((s, i) => (
              <li
                key={s.id ?? `${s.slotType}:${s.slotIndex}:${i}`}
                className="text-xs font-semibold leading-relaxed text-muted-foreground"
              >
                <span className="text-foreground">
                  {s.recipe?.name || slotWord(s.slotType) || "Open meal"}
                </span>
                {" — "}
                {s.warning}
              </li>
            ))}
          </ul>
          <div className="text-xs font-semibold mt-2 leading-relaxed text-muted-foreground">
            Nothing here needs undoing. Swap those slots on the <strong className="text-foreground">Plan</strong> tab
            (each one offers three other options), or regenerate with looser filters — diet, allergy and prep-time
            caps are what usually leave the solver nothing that fits.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TodayTab({ profile, summary, refresh, openTrend, openWellbeing }) {
  const pref = profile.unitPref;
  const wUnit = weightUnit(pref);
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  // ONE reading of the local calendar per render, shared by every card below.
  // The helper itself is the fixed one in lib/dates.js — the backend used to
  // compute tomorrow's date after 18:00 local and roll tomorrow's meals up
  // under "today's plan". Import it; never reimplement it here.
  const today = todayStr();
  const [wIn, setWIn] = useState("");
  const [dIn, setDIn] = useState(today);
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = none, "error" = fetch failed
  const [logBusy, setLogBusy] = useState(false);
  const [logMsg, setLogMsg] = useState(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState(null);
  const [genDone, setGenDone] = useState(null);

  // onboarding-flow-3: recomputed on every render against the live profile, so
  // it clears itself the instant real values land — no stale nag possible.
  const provisional = readProfileProvisional(profile);

  useEffect(() => {
    // Stage-C fix: distinguish a fetch error from "no plan yet" so a 500
    // doesn't render the misleading "no plan generated" empty state.
    api.getCurrentPlan().then(setPlan).catch(() => setPlan("error"));
  }, []);

  // onboarding-flow-5: day 1 used to open on an empty dashboard whose only
  // hint was a sentence telling the user to go find another tab. The single
  // most valuable thing this app does — solve a week of meals against your
  // target in milliseconds — was three clicks away and unnamed. Generating is
  // now a first-class action on the surface the user actually lands on.
  const generateWeek = async () => {
    setGenBusy(true);
    setGenErr(null);
    setGenDone(null);
    try {
      const built = await api.generatePlan({});
      setPlan(built);
      const days = new Set((built?.slots || []).map((s) => s.dayOfWeek)).size;
      setGenDone(`Your week is built — ${days} day${days === 1 ? "" : "s"} of meals, ready on the Plan tab.`);
    } catch (e) {
      setGenErr(describeError(e, "Couldn't build a plan just now."));
    } finally {
      setGenBusy(false);
    }
  };

  const { weighins, avg7Kg, rate, daysIn, verdict: v, macros, target } = summary;
  const sorted = [...weighins].sort((a, b) => a.date.localeCompare(b.date));

  const add = async () => {
    const w = parseFloat(wIn);
    const bounds = weightInputBounds(pref);
    // Stage-C fix: invalid input now says WHY instead of doing nothing silently.
    if (!w || w < bounds.min || w > bounds.max) {
      setLogMsg(`Enter a weight between ${bounds.min} and ${bounds.max} ${wUnit}.`);
      return;
    }
    setLogBusy(true); // Stage-C fix (M15): busy guard prevents a double-submit
    setLogMsg(null);
    try {
      await api.postWeighin(dIn, parseWeight(w, pref));
      setWIn("");
      await refresh();
    } catch (e) {
      setLogMsg(describeError(e, "Couldn't save that weigh-in — try again."));
    } finally {
      setLogBusy(false);
    }
  };
  const del = async (date) => {
    try {
      await api.deleteWeighin(date);
      await refresh();
    } catch (e) {
      setLogMsg(describeError(e, "Couldn't delete that entry — try again."));
    }
  };

  const daysSince = dayNum(today) - dayNum(profile.startDate);
  const photoDue = daysSince >= 28 && daysSince % 28 <= 2;
  const nextPhoto = addDays(profile.startDate, 28 * Math.ceil((daysSince + 0.1) / 28));

  const todaySlots = (plan && typeof plan === "object") ? plan.slots.filter((s) => s.dayOfWeek === isoWeekday()) : [];
  const planned = todaySlots.reduce((t, s) => ({ kcal: t.kcal + s.kcal, protein: t.protein + s.protein, fat: t.fat + s.fat, carb: t.carb + s.carb }), { kcal: 0, protein: 0, fat: 0, carb: 0 });
  const kcalPct = macros?.kcal ? planned.kcal / macros.kcal : 0;

  // Compact trend snapshot — same series the Trend tab draws in full.
  const goalDisplay = displayWeight(profile.goalWeightKg, pref);
  const snapshot = useMemo(() => {
    const s = sorted.map((e) => ({ d: e.date, w: displayWeight(e.weightKg, pref) }));
    return s.map((e, i) => {
      const win = s.slice(Math.max(0, i - 6), i + 1);
      return { d: fmtD(e.d), w: e.w, a: r1(win.reduce((t, x) => t + x.w, 0) / win.length) };
    });
  }, [sorted, pref]);
  const yMin = sorted.length ? Math.floor(Math.min(goalDisplay, ...snapshot.map((e) => e.w))) - 3 : goalDisplay - 3;
  const yMax = sorted.length ? Math.ceil(Math.max(...snapshot.map((e) => e.w))) + 2 : goalDisplay + 2;

  return (
    <div>
      {/* SIGNAL BLACK page head (was Parts.jsx PageHead — swapped at the call
          site so un-restyled tabs keep the legacy component). The h1 stays:
          App's tab-switch focus management targets each view's h1. */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-[26px] font-bold uppercase leading-none tracking-tight text-foreground">Today</h1>
          <p className="mt-1.5 text-xs font-semibold text-muted-foreground tabular-nums">{`${provisional ? "ESTIMATE FROM DEFAULTS · " : ""}Day ${daysIn} of protocol · target ${kc(target?.target ?? profile.targetKcal)} kcal · plan: ${target?.floored ? `~${target.achievableRate} lb/wk (held at your floor)` : `${profile.rateLbPerWeek} lb/wk`}`}</p>
        </div>
      </header>

      {provisional && <ProvisionalBanner pref={pref} />}

      {/* items-stretch, not items-start: this is a desktop app and at 1920px
          items-start left the whole top-right corner empty below the short
          weigh-in card while the ring card set the row height. Cards now fill
          their row. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* ── planned vs target ── */}
        <SectionCard section="TODAY" title="Planned vs. target" className="xl:col-span-5">
          {plan === undefined ? (
            <div className="flex items-center gap-6">
              <Skeleton className="rounded-full shrink-0" style={{ width: 156, height: 156 }} />
              <div className="flex-1 flex flex-col gap-2.5">
                <Skeleton className="h-3" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
          ) : plan === "error" ? (
            // The app's standard error shape. This used to be a bespoke block
            // with a RED calendar glyph sitting inside a card about food —
            // both a design-law-b violation and a bypass of ErrorNote.
            <ErrorNote msg="Couldn't load this week's plan."
              hint="Switch tabs and back to retry; if it keeps failing, restart the app. Nothing you've logged is affected." />
          ) : todaySlots.length === 0 ? (
            // onboarding-flow-5: the day-1 payoff, offered here instead of
            // described and deferred. One button, ms-level solve, real food.
            <div className="flex flex-col items-start gap-3 py-2">
              <div className="flex items-center gap-2">
                <CalendarDays size={17} className="text-muted-foreground" aria-hidden="true" />
                <div className="text-sm font-extrabold text-foreground">
                  No meals planned for this week yet
                </div>
              </div>
              <div className="text-sm font-semibold text-muted-foreground">
                Build a full week of meals around your {kc(macros?.kcal ?? target?.target ?? profile.targetKcal)} kcal
                target and {gm(macros?.proteinLo)} g protein — real recipes, your diet and allergy rules
                already applied. Takes about a second.
              </div>
              <Button onClick={generateWeek} disabled={genBusy}>
                <Sparkles size={13} className="inline mr-1.5" aria-hidden="true" />
                {genBusy ? "Building your week…" : "Generate this week's plan"}
              </Button>
              {/* The solve finishes in milliseconds and the button label snaps
                  back — a screen-reader user got no announcement at all that
                  anything had happened. */}
              <div role="status" aria-live="polite" className="text-xs font-semibold text-muted-foreground">
                {genBusy ? "Building your week…" : genDone || ""}
              </div>
              {genErr && (
                <ErrorNote msg={genErr}
                  hint="Try again, or open the Plan tab where you can loosen the filters (diet, allergies and prep-time caps can over-constrain the solver)." />
              )}
              <div className="text-[11px] font-semibold text-muted-foreground">
                Swaps, locks and the grocery list live on the Plan tab. This card shows what&apos;s
                <em> planned</em> — the diary below is what you actually ate.
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-6 mb-5">
                <Ring pct={kcalPct} size={156} stroke={13} color={C.accent} num={kc(planned.kcal)} unit="planned kcal" />
                <div className="flex-1 flex flex-col gap-1.5 text-xs font-semibold">
                  <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span className="tabular-nums text-sm text-foreground">{kc(macros?.kcal)} kcal</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Planned today</span><span className="tabular-nums text-sm text-foreground">{kc(planned.kcal)} kcal</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Meals + snacks</span><span className="tabular-nums text-sm text-foreground">{todaySlots.length}</span></div>
                </div>
              </div>
              {kcalPct > 1 && (
                <div className="text-xs font-semibold mb-3 text-warn">
                  Over by {kc(planned.kcal - macros.kcal)} — swap a slot on the Plan tab if you want it closer.
                  Nothing to undo: as your weigh-ins build up, the engine re-reads your real burn and moves the
                  target itself.
                </div>
              )}
              {/* Day-level overage above, per-slot cause here: the ring can
                  read on-target while an individual slot was never solved. */}
              <SlotWarnings slots={todaySlots} />
              <MacroRails protein={planned.protein} carb={planned.carb} fat={planned.fat} macros={macros} />
            </>
          )}
        </SectionCard>

        {/* ── verdict ── */}
        <SectionCard section="VERDICT" title="Verdict" className="xl:col-span-4">
          <Stamp v={v} stampStyle={getStampStyle()} />
          {/* SIGNAL BLACK stat tiles: small uppercase muted labels over large
              font-heading tabular numerals (direction usage rules). Value
              expressions are byte-identical to the old Stat call sites. */}
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">7-day avg</div>
              <div className="font-heading text-2xl font-bold tabular-nums text-foreground">{avg7Kg != null ? displayWeight(avg7Kg, pref) : "—"}<span className="ml-1 text-xs font-semibold text-muted-foreground">{wUnit}</span></div>
            </div>
            <div className="py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Rate</div>
              <div className="font-heading text-2xl font-bold tabular-nums text-foreground">{rate != null ? displayRate(rate, pref) : "—"}<span className="ml-1 text-xs font-semibold text-muted-foreground">{rateUnit(pref)}</span></div>
            </div>
            <div className="py-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Target</div>
              <div className="font-heading text-2xl font-bold tabular-nums text-foreground">{kc(target?.target ?? profile.targetKcal)}<span className="ml-1 text-xs font-semibold text-muted-foreground">kcal</span></div>
            </div>
          </div>
          <div className="text-xs font-semibold mt-3 text-muted-foreground">
            {v.band
              ? <>Your band: {displayRate(v.band.lo, pref)}–{displayRate(v.band.hi, pref)} {rateUnit(pref)}, from your chosen {profile.rateLbPerWeek} lb/wk. Verdicts judge 7-day averages only; the fix for a wrong pace lives on the Profile tab.</>
              : "Verdicts judge 7-day averages only."}
          </div>
        </SectionCard>

        {/* ── weigh-in ── */}
        <SectionCard section="DAILY" title="Weigh-in" className="xl:col-span-3">
          <div className="text-xs font-semibold mb-3 text-muted-foreground">
            Fasted · post-bathroom · pre-water. Same conditions every day.
          </div>
          <div className="flex flex-col gap-2">
            {/* shadcn Input = styled NATIVE input (Form Safety rule 2):
                type/value/onChange/aria carry over byte-identical. */}
            <Input
              type="date" value={dIn} onChange={(e) => setDIn(e.target.value)}
              aria-label="Weigh-in date"
              className="w-full"
            />
            <div className="flex gap-2">
              <Input
                type="number" inputMode="decimal" step="0.1" placeholder={wUnit}
                aria-label={`Weight (${wUnit})`}
                value={wIn} onChange={(e) => { setWIn(e.target.value); if (logMsg) setLogMsg(null); }}
                onKeyDown={(e) => e.key === "Enter" && !logBusy && add()}
                className="flex-1 min-w-0"
              />
              <Button onClick={add} disabled={logBusy}>{logBusy ? "…" : "Log"}</Button>
            </div>
            {/* role="alert": invalid-range / save-failure feedback for the
                weigh-in — must reach screen readers without hunting for it. */}
            {logMsg && <div role="alert" className="text-xs font-semibold text-warn">{logMsg}</div>}
          </div>
        </SectionCard>

        {/* ── food diary (planned vs. actually-eaten) ── */}
        <DiaryCard date={today} macros={macros} hasPlan={todaySlots.length > 0} />

        {/* ── micronutrients: moved, not deleted ──
            The full breakdown now lives on the Wellbeing tab. A card that
            simply vanishes reads as a bug or a removed feature, so the seat it
            used to occupy says where it went. `openWellbeing` is optional —
            App.jsx can pass `openWellbeing={() => setTab("wellbeing")}` to turn
            this into a real link; without it the sentence still names the tab. */}
        <SectionCard section="MOVED" title="Micronutrients" className="xl:col-span-12">
          <div className="flex flex-wrap items-center gap-2.5">
            <Heart size={15} className="text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold text-muted-foreground">
              Today&apos;s vitamin and mineral breakdown moved to the <strong className="text-foreground">Wellbeing</strong> tab,
              alongside the rest of the health-check detail.
            </span>
            {openWellbeing && (
              <button onClick={openWellbeing} className="text-xs font-bold flex items-center gap-1 text-foreground transition-colors duration-150 ease-out hover:text-primary">
                Open Wellbeing <ArrowRight size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        </SectionCard>

        {/* ── trend snapshot ── */}
        <SectionCard section="CURVE" title="Trend snapshot" className="xl:col-span-7">
          {sorted.length === 0 ? (
            <EmptyNote icon={LineChart} height={200} title="No weigh-ins yet"
              hint="Log your first weight above to start the curve." />
          ) : sorted.length < 2 ? (
            <EmptyNote icon={LineChart} height={200} title="First point logged"
              hint="The curve starts with your second weigh-in — log again tomorrow." />
          ) : (
            // a11y: Recharts' SVG has no built-in screen-reader semantics.
            // role="img" + a computed summary sentence on the wrapper give
            // AT users the same facts a sighted user reads off the curve;
            // the chart itself is then hidden so nothing is announced twice.
            <div
              role="img"
              aria-label={`Weight trend, last ${snapshot.length} entries: ${r1(snapshot[0].w)} ${wUnit} on ${snapshot[0].d}, most recently ${r1(snapshot[snapshot.length - 1].w)} ${wUnit} on ${snapshot[snapshot.length - 1].d}. 7-day average ${r1(snapshot[snapshot.length - 1].a)} ${wUnit}, goal ${r1(goalDisplay)} ${wUnit}.`}
              style={{ width: "100%", height: 200 }}
            >
              <div aria-hidden="true" style={{ width: "100%", height: "100%" }}>
                <ResponsiveContainer>
                  <ComposedChart data={snapshot} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="d" tick={{ fontSize: 10, fill: C.faint, fontWeight: 600 }} tickLine={false}
                      axisLine={{ stroke: C.rule }} minTickGap={28} />
                    <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: C.faint, fontWeight: 600 }}
                      tickLine={false} axisLine={{ stroke: C.rule }} width={52} />
                    <Tooltip
                      contentStyle={{ background: C.card2, border: `1px solid ${C.rule}`, borderRadius: 12, fontSize: 12, fontWeight: 600, color: C.ink }}
                      formatter={(val, name) => [val + " " + wUnit, name === "w" ? "daily" : "7-day avg"]}
                    />
                    <ReferenceLine y={goalDisplay} stroke={C.faint} strokeDasharray="6 4" />
                    <Line type="monotone" dataKey="w" stroke={C.faintLight} strokeWidth={1.5}
                      dot={{ r: 2, fill: C.faintLight, strokeWidth: 0 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="a" stroke={C.accent} strokeWidth={2.5}
                      dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="text-xs font-semibold text-muted-foreground">
              thin = daily · heavy = 7-day average · dashed = goal
            </div>
            <button onClick={openTrend} className="text-xs font-bold flex items-center gap-1 text-foreground transition-colors duration-150 ease-out hover:text-primary">
              Full trend <ArrowRight size={12} />
            </button>
          </div>
        </SectionCard>

        {/* ── recent entries ── */}
        <SectionCard section="LOG" title="Recent entries" className="xl:col-span-5">
          {sorted.length === 0 && (
            <EmptyNote title="No weigh-ins yet" hint="Log Day 1 above to start the log." />
          )}
          {[...sorted].reverse().slice(0, 8).map((e) => (
            <div key={e.date} className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm font-semibold text-muted-foreground">{fmtD(e.date)}</span>
              <span className="tabular-nums text-sm font-bold text-foreground">{displayWeight(e.weightKg, pref)} {wUnit}</span>
              <button onClick={() => del(e.date)} aria-label={`Delete weigh-in from ${fmtD(e.date)}`} className="text-muted-foreground">
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          ))}
        </SectionCard>
      </div>

      {/* footer notes */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 px-1">
        <div className={`text-xs font-semibold flex items-center gap-2 ${photoDue ? "text-warn" : "text-muted-foreground"}`}>
          <Camera size={13} /> {photoDue ? "4-week photo + tape audit due — same light, same poses." : `Next photo + tape audit: ${fmtD(nextPhoto)}`}
        </div>
      </div>
    </div>
  );
}
