import { useState } from "react";
import { C } from "../lib/theme.js";
import { kg2lb, cm2in, in2cm, lb2kg } from "../lib/units.js";
import { todayStr, addDays, fmtD } from "../lib/dates.js";
import { FLOOR, RX, JOB, JOB_LABEL } from "../data/constants.js";
import { Card, Stat, Btn } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const r1 = (n) => Math.round(n * 10) / 10;

export default function EngineTab({ profile, summary, refresh, isAdmin }) {
  const { avg7Kg, bmr, macros } = summary;
  const avg7 = avg7Kg != null ? kg2lb(avg7Kg) : kg2lb(profile.startWeightKg);
  const [custom, setCustom] = useState("");
  const [draft, setDraft] = useState({
    heightIn: r1(cm2in(profile.heightCm)),
    bf: profile.bodyFatPct,
    goalLb: r1(kg2lb(profile.goalWeightKg)),
    age: profile.age,
    sessions: profile.sessionsPerWeek,
  });
  // Comma-separated text-field drafts for the two array fields - typing a
  // comma shouldn't re-render as a parsed array mid-keystroke, so these stay
  // as plain strings until blur, same commit-on-blur pattern as every other
  // field on this tab.
  const [prefsDraft, setPrefsDraft] = useState({
    excludedFoods: (profile.excludedFoods || []).join(", "),
    cuisinePreferences: (profile.cuisinePreferences || []).join(", "),
    mealPreferencesNote: profile.mealPreferencesNote || "",
  });
  const toList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const commit = async (patch) => {
    await api.putProfile(patch);
    await refresh();
  };
  const setTarget = async (t) => {
    await api.putTarget(Math.max(FLOOR, Math.round(t)));
    await refresh();
  };

  const { rows, rmr, tdee } = bmr;

  // RX is a fixed, pre-calibrated cut target rather than a formula-derived
  // value any user's tiers table could produce - showing it to a generic
  // second account would render one account's own number as if the app
  // computed it for them. Gated to admin (the one pre-multi-tenancy
  // account) until a real per-user prescription exists.
  const tierList = [
    ...(isAdmin ? [{ name: "RX — LOCKED", kcal: RX, pin: true }] : []),
    { name: "Hard cut −25%", kcal: tdee * 0.75 },
    { name: "Standard −20%", kcal: tdee * 0.8 },
    { name: "Easy −15%", kcal: tdee * 0.85 },
    { name: "Maintenance", kcal: tdee },
    { name: "Lean bulk +10%", kcal: tdee * 1.1 },
  ];
  const tiers = tierList.map((t) => {
    const def = tdee - t.kcal;
    const rate = (def * 7) / 3500;
    const goalLb = kg2lb(profile.goalWeightKg);
    const date = rate > 0.2 && avg7 != null ? addDays(todayStr(), ((avg7 - goalLb) / rate) * 7) : null;
    return { ...t, pct: (def / tdee) * 100, rate, date };
  });

  const inp = "text-sm px-3 py-2 rounded-xl w-full";
  const inpStyle = { background: C.paper, border: `1.5px solid ${C.rule}`, color: C.ink };

  return (
    <div>
      <Card section="§2" title="Inputs">
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Sex</span>
            <select value={profile.sex} onChange={(e) => commit({ sex: e.target.value })} className={inp} style={inpStyle}>
              <option value="M">M</option><option value="F">F</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Age</span>
            <input type="number" inputMode="numeric" value={draft.age}
              onChange={(e) => setDraft((d) => ({ ...d, age: +e.target.value || 0 }))}
              onBlur={() => commit({ age: draft.age })}
              className={inp} style={inpStyle} />
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Height in</span>
            <input type="number" inputMode="numeric" value={draft.heightIn}
              onChange={(e) => setDraft((d) => ({ ...d, heightIn: +e.target.value || 0 }))}
              onBlur={() => commit({ heightCm: in2cm(draft.heightIn) })}
              className={inp} style={inpStyle} />
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Weight lb</span>
            <input type="number" inputMode="decimal" value={r1(avg7)} readOnly
              className={inp} style={{ ...inpStyle, color: C.faint }} />
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>BF %</span>
            <input type="number" inputMode="decimal" value={draft.bf}
              onChange={(e) => setDraft((d) => ({ ...d, bf: +e.target.value || 0 }))}
              onBlur={() => commit({ bodyFatPct: draft.bf })}
              className={inp} style={inpStyle} />
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Goal lb</span>
            <input type="number" inputMode="decimal" value={draft.goalLb}
              onChange={(e) => setDraft((d) => ({ ...d, goalLb: +e.target.value || 0 }))}
              onBlur={() => commit({ goalWeightKg: lb2kg(draft.goalLb) })}
              className={inp} style={inpStyle} />
          </label>
          <label className="block col-span-2">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Job</span>
            <select value={profile.job} onChange={(e) => commit({ job: e.target.value })} className={inp} style={inpStyle}>
              {Object.keys(JOB).map((k) => <option key={k} value={k}>{JOB_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold" style={{ color: C.faint }}>Train /wk</span>
            <input type="number" inputMode="numeric" value={draft.sessions}
              onChange={(e) => setDraft((d) => ({ ...d, sessions: +e.target.value || 0 }))}
              onBlur={() => commit({ sessionsPerWeek: draft.sessions })}
              className={inp} style={inpStyle} />
          </label>
        </div>
        <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
          Weight auto-feeds from 7-day average. Other fields save when you tab/click away.
        </div>
      </Card>

      <Card section="DIET" title="Diet & preferences">
        <label className="block mb-3">
          <span className="text-xs font-bold" style={{ color: C.faint }}>Dietary style</span>
          <select value={profile.dietaryStyle || ""} onChange={(e) => commit({ dietaryStyle: e.target.value || null })} className={inp} style={inpStyle}>
            <option value="">None (no restriction)</option>
            <option value="vegan">Vegan</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="paleo">Paleo</option>
            <option value="carnivore">Carnivore</option>
            <option value="keto">Keto</option>
          </select>
        </label>
        <label className="block mb-3">
          <span className="text-xs font-bold" style={{ color: C.faint }}>Allergies / exclusions (comma-separated)</span>
          <input type="text" placeholder="e.g. shellfish, gluten, kiwi" value={prefsDraft.excludedFoods}
            onChange={(e) => setPrefsDraft((d) => ({ ...d, excludedFoods: e.target.value }))}
            onBlur={() => commit({ excludedFoods: toList(prefsDraft.excludedFoods) })}
            className={inp} style={inpStyle} />
        </label>
        <label className="block mb-3">
          <span className="text-xs font-bold" style={{ color: C.faint }}>Cuisine preferences for AI-generated recipes (comma-separated)</span>
          <input type="text" placeholder="e.g. mexican, thai, mediterranean" value={prefsDraft.cuisinePreferences}
            onChange={(e) => setPrefsDraft((d) => ({ ...d, cuisinePreferences: e.target.value }))}
            onBlur={() => commit({ cuisinePreferences: toList(prefsDraft.cuisinePreferences) })}
            className={inp} style={inpStyle} />
        </label>
        <label className="block">
          <span className="text-xs font-bold" style={{ color: C.faint }}>Notes for AI-generated recipes</span>
          <textarea rows={2} placeholder="e.g. high protein, minimal dairy, I have an air fryer" value={prefsDraft.mealPreferencesNote}
            onChange={(e) => setPrefsDraft((d) => ({ ...d, mealPreferencesNote: e.target.value }))}
            onBlur={() => commit({ mealPreferencesNote: prefsDraft.mealPreferencesNote || null })}
            className={inp} style={{ ...inpStyle, resize: "vertical" }} />
        </label>
        <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
          Dietary style and exclusions filter every meal plan and AI-generated recipe. Cuisine/notes only steer AI generation, not the existing recipe pool.
        </div>
      </Card>

      <Card section="§3" title="BMR — five formulas">
        {rows.map((r) => (
          <div key={r.f} className="flex justify-between py-1.5 text-sm font-semibold" style={{ borderBottom: `1px solid ${C.rule}` }}>
            <span style={{ color: C.ink }}>{r.f}</span>
            <span style={{ color: C.ink }}>{kc(r.v)}</span>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-x-4 mt-1">
          <Stat label="RMR (median)" value={kc(rmr)} unit="kcal" />
          <Stat label="TDEE" value={kc(tdee)} unit="kcal" />
        </div>
        <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
          TDEE = median × ({JOB[profile.job].toFixed(2)} job + 0.01 × {profile.sessionsPerWeek} sessions)
        </div>
      </Card>

      <Card section="TIERS" title="Cut / bulk table">
        <div className="text-[10.5px] font-extrabold grid grid-cols-12 pb-1.5 uppercase tracking-wide" style={{ color: C.faintLight, borderBottom: `1px solid ${C.rule}` }}>
          <div className="col-span-4">Tier</div>
          <div className="col-span-2 text-right">kcal</div>
          <div className="col-span-2 text-right">lb/wk</div>
          <div className="col-span-2 text-right">Goal date</div>
          <div className="col-span-2 text-right">Apply</div>
        </div>
        {tiers.map((t) => (
          <div key={t.name} className="text-xs grid grid-cols-12 py-2 items-center font-semibold rounded-lg px-1"
            style={{ borderBottom: `1px solid ${C.rule}`, background: t.pin ? C.accentBg : "transparent", color: C.ink }}>
            <div className="col-span-4 pr-1">{t.name}</div>
            <div className="col-span-2 text-right font-extrabold">{kc(t.kcal)}</div>
            <div className="col-span-2 text-right">{t.rate > 0.05 ? r1(t.rate) : "—"}</div>
            <div className="col-span-2 text-right">{t.date ? fmtD(t.date) : "—"}</div>
            <div className="col-span-2 text-right">
              <Btn small kind="ghost" onClick={() => setTarget(t.kcal)}>Set</Btn>
            </div>
          </div>
        ))}
      </Card>

      <Card section="§4" title="Macro engine">
        <div className="flex rounded-full overflow-hidden h-2.5 mb-3">
          <div style={{ width: `${(macros.proteinHi * 4 / profile.targetKcal) * 100}%`, background: C.protein }}></div>
          <div style={{ width: `${(macros.fatHi * 9 / profile.targetKcal) * 100}%`, background: C.fat }}></div>
          <div style={{ width: `${(macros.carbHi * 4 / profile.targetKcal) * 100}%`, background: C.carb }}></div>
          <div className="flex-1" style={{ background: C.rule }}></div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <Stat label="Protein range" value={`${macros.proteinLo}–${macros.proteinHi}`} unit="g" />
          <Stat label="Fat range" value={`${macros.fatLo}–${macros.fatHi}`} unit="g" />
          <Stat label="Carb range" value={`~${macros.carbLo}–${macros.carbHi}`} unit="g" />
          <Stat label="Fiber" value="25+" unit="g" />
        </div>
        <div className="text-xs font-semibold mt-2" style={{ color: C.faint }}>
          For target {kc(profile.targetKcal)} · protein + calories are load-bearing walls · fat is a floor · carbs flex
        </div>
        {macros.macroKcalGap > 0 && (
          <div className="text-xs font-semibold mt-1" style={{ color: C.faint }}>
            Ranges sum to ~{kc(profile.targetKcal - macros.macroKcalGap)} kcal at the midpoint ({macros.macroKcalGap} kcal under target) — {macros.carbBufferG}g is deliberately trimmed off the carb midpoint as a rounding/conservatism margin, not a formula error.
          </div>
        )}
      </Card>

      <Card section="TARGET" title="Current prescription">
        <div className="flex items-end gap-3 mb-3">
          <div className="text-4xl font-extrabold" style={{ color: C.ink }}>{kc(profile.targetKcal)}</div>
          <div className="text-xs font-semibold pb-1" style={{ color: C.faint }}>kcal/day · floor {kc(FLOOR)}</div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {isAdmin && <Btn small onClick={() => setTarget(RX)}>{kc(RX)}</Btn>}
          <Btn small onClick={() => setTarget(FLOOR)}>{kc(FLOOR)}</Btn>
          <input type="number" inputMode="numeric" placeholder="custom" value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="text-sm px-3 py-2 rounded-xl w-24" style={inpStyle} />
          <Btn small kind="ghost" onClick={() => { if (+custom) { setTarget(+custom); setCustom(""); } }}>Set</Btn>
        </div>
        <div className="text-xs font-bold mt-2" style={{ color: C.red }}>
          Anything under 2,000 gets clamped to 2,000. Non-negotiable.
        </div>
      </Card>

      <details className="px-1 mb-4">
        <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer" style={{ color: C.faintLight }}>
          Data backup (copy this JSON)
        </summary>
        <pre className="text-xs mt-2 p-3 rounded-xl overflow-x-auto"
          style={{ background: C.card, border: `1px solid ${C.rule}`, color: C.ink }}>
          {JSON.stringify({ profile, summary }, null, 1)}
        </pre>
      </details>
    </div>
  );
}
