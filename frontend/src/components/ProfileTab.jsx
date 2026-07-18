import { useState } from "react";
import { C } from "../lib/theme.js";
import { kg2lb, cm2in, in2cm, lb2kg } from "../lib/units.js";
import { JOB, JOB_LABEL } from "../data/constants.js";
import { Card, PageHead } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const r1 = (n) => Math.round(n * 10) / 10;

// The user-facing home of every personal input. Engine reads these and only
// shows the math — it never asks for stats itself. Same commit-on-blur
// pattern the old Engine inputs used.
export default function ProfileTab({ profile, summary, refresh }) {
  const avg7 = summary.avg7Kg != null ? kg2lb(summary.avg7Kg) : kg2lb(profile.startWeightKg);
  const [draft, setDraft] = useState({
    heightIn: r1(cm2in(profile.heightCm)),
    bf: profile.bodyFatPct,
    goalLb: r1(kg2lb(profile.goalWeightKg)),
    age: profile.age,
    sessions: profile.sessionsPerWeek,
  });
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

  const inp = "text-sm px-3 py-2 rounded-xl w-full mt-1";
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const label = (t) => <span className="text-xs font-bold" style={{ color: C.faint }}>{t}</span>;

  return (
    <div>
      <PageHead title="Profile" sub="Your stats, activity, and diet rules. Everything else in the app flows from this tab." />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <Card section="STATS" title="Body" className="lg:col-span-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">{label("Sex")}
              <select value={profile.sex} onChange={(e) => commit({ sex: e.target.value })} className={inp} style={inpStyle}>
                <option value="M">Male</option><option value="F">Female</option>
              </select>
            </label>
            <label className="block">{label("Age")}
              <input type="number" inputMode="numeric" value={draft.age}
                onChange={(e) => setDraft((d) => ({ ...d, age: +e.target.value || 0 }))}
                onBlur={() => commit({ age: draft.age })}
                className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Height (in)")}
              <input type="number" inputMode="numeric" value={draft.heightIn}
                onChange={(e) => setDraft((d) => ({ ...d, heightIn: +e.target.value || 0 }))}
                onBlur={() => commit({ heightCm: in2cm(draft.heightIn) })}
                className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Body fat %")}
              <input type="number" inputMode="decimal" value={draft.bf}
                onChange={(e) => setDraft((d) => ({ ...d, bf: +e.target.value || 0 }))}
                onBlur={() => commit({ bodyFatPct: draft.bf })}
                className={inp} style={inpStyle} />
            </label>
            <label className="block">{label("Current weight (lb)")}
              <input type="number" value={r1(avg7)} readOnly className={inp} style={{ ...inpStyle, color: C.faint }} />
            </label>
            <label className="block">{label("Goal weight (lb)")}
              <input type="number" inputMode="decimal" value={draft.goalLb}
                onChange={(e) => setDraft((d) => ({ ...d, goalLb: +e.target.value || 0 }))}
                onBlur={() => commit({ goalWeightKg: lb2kg(draft.goalLb) })}
                className={inp} style={inpStyle} />
            </label>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            Weight auto-feeds from your 7-day average. Fields save when you tab or click away.
          </div>
        </Card>

        <Card section="ACTIVITY" title="Job & training" className="lg:col-span-4">
          <div className="grid grid-cols-1 gap-3">
            <label className="block">{label("Job / daily activity")}
              <select value={profile.job} onChange={(e) => commit({ job: e.target.value })} className={inp} style={inpStyle}>
                {Object.keys(JOB).map((k) => <option key={k} value={k}>{JOB_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="block">{label("Training sessions / week")}
              <input type="number" inputMode="numeric" value={draft.sessions}
                onChange={(e) => setDraft((d) => ({ ...d, sessions: +e.target.value || 0 }))}
                onBlur={() => commit({ sessionsPerWeek: draft.sessions })}
                className={inp} style={inpStyle} />
            </label>
          </div>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            These set the TDEE activity multiplier — the Engine tab shows exactly how.
          </div>
        </Card>

        <Card section="DIET" title="Diet & preferences" className="lg:col-span-4">
          <label className="block mb-3">{label("Dietary style")}
            <select value={profile.dietaryStyle || ""} onChange={(e) => commit({ dietaryStyle: e.target.value || null })} className={inp} style={inpStyle}>
              <option value="">None (no restriction)</option>
              <option value="vegan">Vegan</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="paleo">Paleo</option>
              <option value="carnivore">Carnivore</option>
              <option value="keto">Keto</option>
            </select>
          </label>
          <label className="block mb-3">{label("Allergies / exclusions (comma-separated)")}
            <input type="text" placeholder="e.g. shellfish, gluten, kiwi" value={prefsDraft.excludedFoods}
              onChange={(e) => setPrefsDraft((d) => ({ ...d, excludedFoods: e.target.value }))}
              onBlur={() => commit({ excludedFoods: toList(prefsDraft.excludedFoods) })}
              className={inp} style={inpStyle} />
          </label>
          <label className="block mb-3">{label("Cuisine preferences for AI recipes (comma-separated)")}
            <input type="text" placeholder="e.g. mexican, thai, mediterranean" value={prefsDraft.cuisinePreferences}
              onChange={(e) => setPrefsDraft((d) => ({ ...d, cuisinePreferences: e.target.value }))}
              onBlur={() => commit({ cuisinePreferences: toList(prefsDraft.cuisinePreferences) })}
              className={inp} style={inpStyle} />
          </label>
          <label className="block">{label("Notes for AI recipes")}
            <textarea rows={2} placeholder="e.g. high protein, minimal dairy, I have an air fryer" value={prefsDraft.mealPreferencesNote}
              onChange={(e) => setPrefsDraft((d) => ({ ...d, mealPreferencesNote: e.target.value }))}
              onBlur={() => commit({ mealPreferencesNote: prefsDraft.mealPreferencesNote || null })}
              className={inp} style={{ ...inpStyle, resize: "vertical" }} />
          </label>
          <div className="text-xs font-semibold mt-3" style={{ color: C.faint }}>
            Style + exclusions hard-filter every meal plan and AI recipe. Cuisine/notes only steer AI generation.
          </div>
        </Card>
      </div>
    </div>
  );
}
