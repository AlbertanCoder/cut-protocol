import { useState } from "react";
import { api } from "../lib/api.js";
import { C } from "../lib/theme.js";

// E2 (v2) — a visual body-fat estimator. Deterministic, never LLM-gated, works
// keyless. Constitution: selection is a LIGHTNESS step (card2 + faintLight),
// never green; NO red/green judgment, NO "ideal" marker; % labels only; the
// silhouettes are ABSTRACT (currentColor, never resembling a real person).
const BUCKETS = [10, 15, 20, 25, 30, 35];

// One parametric front-view figure whose midsection widens with body-fat%.
function Silhouette({ pct }) {
  const g = Math.max(0, Math.min(1, (pct - 10) / 25)); // 0 at 10%, 1 at 35%
  const cx = 40;
  const shoulderW = 19 + g * 6;
  const waistW = 12 + g * 18;
  const hipW = 16 + g * 10;
  const d = [
    `M ${cx - shoulderW} 38`,
    `C ${cx - shoulderW} 50, ${cx - waistW} 54, ${cx - waistW} 63`,
    `C ${cx - waistW} 73, ${cx - hipW} 75, ${cx - hipW} 84`,
    `L ${cx - hipW + 1} 116`, `L ${cx - 4} 116`, `L ${cx - 4} 86`,
    `L ${cx + 4} 86`, `L ${cx + 4} 116`, `L ${cx + hipW - 1} 116`,
    `L ${cx + hipW} 84`,
    `C ${cx + hipW} 75, ${cx + waistW} 73, ${cx + waistW} 63`,
    `C ${cx + waistW} 54, ${cx + shoulderW} 50, ${cx + shoulderW} 38`,
    "Z",
  ].join(" ");
  return (
    <svg viewBox="0 0 80 122" width="100%" style={{ display: "block" }} aria-hidden="true">
      <circle cx={cx} cy={22} r={11} fill="currentColor" />
      <path d={d} fill="currentColor" />
    </svg>
  );
}

export default function BodyFatPicker({ current, source, onDone, onClose }) {
  const [saving, setSaving] = useState(false);
  const [measuredMode, setMeasuredMode] = useState(false);
  const [measured, setMeasured] = useState("");
  const [err, setErr] = useState(null);

  const save = async (patch) => {
    setSaving(true);
    setErr(null);
    try {
      await api.putProfile(patch);
      onDone?.();
      onClose?.();
    } catch {
      setErr("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };
  const pickBucket = (pct) => save({ bodyFatPct: pct, bodyFatSource: "visual-estimate" });
  const skip = () => save({ bodyFatPct: 0, bodyFatSource: null });
  const saveMeasured = () => {
    const v = Number(measured);
    if (!Number.isFinite(v) || v < 3 || v > 70) { setErr("Enter a number between 3 and 70."); return; }
    save({ bodyFatPct: Math.round(v * 10) / 10, bodyFatSource: "measured" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="w-[560px] max-w-[94vw] max-h-[88vh] overflow-y-auto rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.rule}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-lg font-extrabold" style={{ color: C.ink }}>Body fat %</div>
          <button onClick={onClose} className="text-sm font-bold px-2 py-1 rounded-lg" style={{ color: C.faint }} aria-label="Close">✕</button>
        </div>
        <div className="text-xs font-semibold mb-4" style={{ color: C.faint }}>
          A minor refinement to your calorie estimate. Pick the closest match — or skip it.
        </div>

        {!measuredMode ? (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {BUCKETS.map((pct) => {
                const selected = source === "visual-estimate" && current === pct;
                return (
                  <button
                    key={pct}
                    onClick={() => pickBucket(pct)}
                    disabled={saving}
                    className="flex flex-col items-center gap-1 rounded-xl py-2 px-1"
                    style={{ background: selected ? C.card2 : "transparent", border: `1px solid ${selected ? C.faintLight : C.rule}`, color: selected ? C.ink : C.faint }}
                    aria-pressed={selected}
                  >
                    <div style={{ width: 46 }}><Silhouette pct={pct} /></div>
                    <span className="text-xs font-bold tabular-nums">{pct}%</span>
                  </button>
                );
              })}
            </div>
            {err && <div className="text-xs font-bold mt-3" style={{ color: C.red }}>{err}</div>}
            <div className="flex items-center justify-between mt-4 gap-3">
              <button onClick={() => { setMeasuredMode(true); setErr(null); }} className="text-xs font-bold underline" style={{ color: C.faint }}>
                I had it measured (DEXA / calipers / scale)
              </button>
              <button onClick={skip} disabled={saving} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: C.card2, color: C.faint, border: `1px solid ${C.rule}` }}>
                Not sure — skip
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-xs font-bold" style={{ color: C.faint }}>Measured body fat %</label>
            <input
              type="number" value={measured} onChange={(e) => setMeasured(e.target.value)} min={3} max={70} step={0.1}
              placeholder="e.g. 18.5"
              className="text-sm font-semibold px-3 py-2 rounded-xl outline-none"
              style={{ background: C.card2, color: C.ink, border: `1px solid ${C.rule}` }}
            />
            {err && <div className="text-xs font-bold" style={{ color: C.red }}>{err}</div>}
            <div className="flex items-center gap-2">
              <button onClick={saveMeasured} disabled={saving} className="text-sm font-bold px-3 py-2 rounded-xl" style={{ background: C.accent, color: C.accentInk }}>Save</button>
              <button onClick={() => { setMeasuredMode(false); setErr(null); }} className="text-sm font-semibold px-3 py-2 rounded-xl" style={{ color: C.faint }}>Back to picker</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
