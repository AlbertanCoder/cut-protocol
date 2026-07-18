import { useState } from "react";
import { Database } from "lucide-react";
import { C } from "../lib/theme.js";
import { kg2lb } from "../lib/units.js";
import { todayStr, addDays, fmtD } from "../lib/dates.js";
import { FLOOR, RX, JOB } from "../data/constants.js";
import { Card, Stat, Btn, PageHead } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const kc = (n) => Math.round(n).toLocaleString("en-CA");
const r1 = (n) => Math.round(n * 10) / 10;

// The brain: BMR formulas, TDEE, tiers, macro ranges. Reads the Profile —
// it never asks for stats itself (those inputs live on the Profile tab).
export default function EngineTab({ profile, summary, refresh, isAdmin, openFoods }) {
  const { avg7Kg, bmr, macros } = summary;
  const avg7 = avg7Kg != null ? kg2lb(avg7Kg) : kg2lb(profile.startWeightKg);
  const [custom, setCustom] = useState("");

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

  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };

  return (
    <div>
      <PageHead title="Engine" sub="The math. Every number here derives from your Profile — edit your stats there.">
        <Btn small kind="ghost" onClick={openFoods}>
          <Database size={12} className="inline mr-1" />Food database
        </Btn>
      </PageHead>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <Card section="§3" title="BMR — five formulas" className="xl:col-span-4">
          {rows.map((r) => (
            <div key={r.f} className="flex justify-between py-1.5 text-sm font-semibold" style={{ borderBottom: `1px solid ${C.rule}` }}>
              <span style={{ color: C.ink }}>{r.f}</span>
              <span className="mono" style={{ color: C.ink }}>{kc(r.v)}</span>
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

        <Card section="§4" title="Macro engine" className="xl:col-span-4">
          <div className="flex rounded-full overflow-hidden h-2.5 mb-3 gap-[2px]">
            <div style={{ width: `${(macros.proteinHi * 4 / profile.targetKcal) * 100}%`, background: C.protein }}></div>
            <div style={{ width: `${(macros.fatHi * 9 / profile.targetKcal) * 100}%`, background: C.fat }}></div>
            <div style={{ width: `${(macros.carbHi * 4 / profile.targetKcal) * 100}%`, background: C.carb }}></div>
            <div className="flex-1" style={{ background: C.card2 }}></div>
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

        <Card section="TARGET" title="Current prescription" className="xl:col-span-4">
          <div className="flex items-end gap-3 mb-3">
            <div className="mono stat-hero text-5xl" style={{ color: C.accent }}>{kc(profile.targetKcal)}</div>
            <div className="text-xs font-semibold pb-1.5" style={{ color: C.faint }}>kcal/day · floor {kc(FLOOR)}</div>
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
            Anything under {kc(FLOOR)} gets clamped to {kc(FLOOR)}. Non-negotiable.
          </div>
        </Card>

        <Card section="TIERS" title="Cut / bulk table" className="xl:col-span-12">
          <div className="text-[10.5px] font-extrabold grid grid-cols-12 pb-1.5 uppercase tracking-wide" style={{ color: C.faintLight, borderBottom: `1px solid ${C.rule}` }}>
            <div className="col-span-4">Tier</div>
            <div className="col-span-2 text-right">kcal</div>
            <div className="col-span-2 text-right">lb/wk</div>
            <div className="col-span-2 text-right">Goal date</div>
            <div className="col-span-2 text-right">Apply</div>
          </div>
          {tiers.map((t) => (
            <div key={t.name} className="text-sm grid grid-cols-12 py-2 items-center font-semibold rounded-lg px-1"
              style={{ borderBottom: `1px solid ${C.rule}`, background: t.pin ? C.accentBg : "transparent", color: C.ink }}>
              <div className="col-span-4 pr-1">{t.name}</div>
              <div className="col-span-2 text-right font-extrabold mono">{kc(t.kcal)}</div>
              <div className="col-span-2 text-right mono">{t.rate > 0.05 ? r1(t.rate) : "—"}</div>
              <div className="col-span-2 text-right">{t.date ? fmtD(t.date) : "—"}</div>
              <div className="col-span-2 text-right">
                <Btn small kind="ghost" onClick={() => setTarget(t.kcal)}>Set</Btn>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <details className="px-1 mt-4">
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
