import { useState, useEffect, useCallback } from "react";
import { Dumbbell, Sparkles, Trash2, ChevronRight } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, Btn, Chip, PageHead, ErrorNote, EmptyNote } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

// Phase 8 scaffold. The generator is v1-templates and the UI says so —
// this picks a sensible starting template from the inputs, it does not
// periodize or personalize. Fully separate from the meal engine.

const styleLabel = { strength: "Strength", hypertrophy: "Hypertrophy", general: "General fitness", conditioning: "Conditioning" };

export default function TrainingTab() {
  const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };
  const [meta, setMeta] = useState(null);
  const [plan, setPlan] = useState(undefined); // undefined = loading, null = none
  const [planNotes, setPlanNotes] = useState([]);
  const [form, setForm] = useState({ daysPerWeek: 3, sessionLengthMin: 60, style: "hypertrophy", experience: "beginner", equipment: ["full-gym"] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [activeWeek, setActiveWeek] = useState(1);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([api.getTrainingMeta(), api.getTrainingPlan()]);
      setMeta(m);
      setPlan(p);
      if (p) {
        setForm({ daysPerWeek: p.daysPerWeek, sessionLengthMin: p.sessionLengthMin, style: p.style, experience: p.experience, equipment: p.equipment });
      }
    } catch (e) {
      setError(e.message);
      setPlan(null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleEquipment = (key) =>
    setForm((f) => ({ ...f, equipment: f.equipment.includes(key) ? f.equipment.filter((k) => k !== key) : [...f.equipment, key] }));

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.generateTrainingPlan(form);
      setPlan(res.plan);
      setPlanNotes(res.planNotes || []);
      setActiveWeek(1);
    } catch (e) {
      setError(e.body?.reasons ? `${e.message}: ${e.body.reasons.join("; ")}` : e.message);
    } finally {
      setBusy(false);
    }
  };

  const removePlan = async () => {
    await api.deleteTrainingPlan();
    setPlan(null);
    setPlanNotes([]);
    setConfirmingDelete(false);
  };

  const week = plan?.weeks?.find((w) => w.weekNumber === activeWeek);

  return (
    <div>
      <PageHead title="Training" sub="v1 scaffold — matches your inputs to a sensible template. Programming depth comes later; this gets you lifting.">
        <Chip color={C.warn} bg={C.warnBg}>V1 TEMPLATES</Chip>
      </PageHead>

      {error && (
        <div className="mb-3">
          <ErrorNote msg={error} hint="Check every input has a value and at least one equipment box is ticked, then generate again." />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* ── inputs ── */}
        <div className="xl:col-span-4">
          <Card section="INPUTS" title="What you're working with">
            {!meta ? (
              <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <label className="block">
                    <span className="text-xs font-bold" style={{ color: C.faint }}>Days / week</span>
                    <select value={form.daysPerWeek} onChange={(e) => setForm((f) => ({ ...f, daysPerWeek: +e.target.value }))}
                      className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle}>
                      {meta.daysPerWeek.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold" style={{ color: C.faint }}>Session length</span>
                    <select value={form.sessionLengthMin} onChange={(e) => setForm((f) => ({ ...f, sessionLengthMin: +e.target.value }))}
                      className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle}>
                      {meta.sessionLengthMin.map((m) => <option key={m} value={m}>{m} min</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold" style={{ color: C.faint }}>Style</span>
                    <select value={form.style} onChange={(e) => setForm((f) => ({ ...f, style: e.target.value }))}
                      className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle}>
                      {meta.styles.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold" style={{ color: C.faint }}>Experience</span>
                    <select value={form.experience} onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
                      className="text-sm px-3 py-2 rounded-xl w-full mt-1" style={inpStyle}>
                      {meta.experience.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="text-xs font-bold mb-1.5" style={{ color: C.faint }}>Equipment</div>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {meta.equipment.map((eq) => {
                    const on = form.equipment.includes(eq.key);
                    return (
                      <button key={eq.key} onClick={() => toggleEquipment(eq.key)}
                        className="text-xs font-bold px-3 py-1.5 rounded-full"
                        style={{ background: on ? C.accent : C.card2, color: on ? C.accentInk : C.faint, border: `1px solid ${on ? C.accent : C.rule}` }}>
                        {eq.label}
                      </button>
                    );
                  })}
                </div>
                <Btn onClick={generate} disabled={busy}>
                  <Sparkles size={13} className="inline mr-1" />{busy ? "Building…" : plan ? "Regenerate plan" : "Generate plan"}
                </Btn>
                <div className="text-[10.5px] font-semibold mt-2" style={{ color: C.faintLight }}>
                  v1 picks one of four templates (2/3-day full body, 4-day upper/lower, conditioning circuits) and adapts exercises to your equipment. Regenerating replaces the current plan.
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ── the plan ── */}
        <div className="xl:col-span-8 min-w-0">
          {plan === undefined ? (
            <div className="text-sm font-semibold" style={{ color: C.faint }}>Loading…</div>
          ) : !plan ? (
            <Card>
              <EmptyNote icon={Dumbbell} height={220} title="No training plan yet"
                hint="Set your days, style, and equipment on the left, then hit Generate — you'll get a 4-week template to start from." />
            </Card>
          ) : (
            <Card section={plan.generator.toUpperCase()} title={plan.name}>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Chip>{styleLabel[plan.style] || plan.style}</Chip>
                <Chip>{plan.daysPerWeek} days/wk available</Chip>
                <Chip>{plan.sessionLengthMin} min sessions</Chip>
                <Chip>{plan.experience}</Chip>
              </div>
              {planNotes.map((n, i) => (
                <div key={i} className="text-xs font-semibold mb-2 p-2 rounded-lg" style={{ color: C.warn, background: C.warnBg }}>{n}</div>
              ))}

              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wide mr-1" style={{ color: C.faintLight }}>Week</span>
                {plan.weeks.map((w) => (
                  <button key={w.weekNumber} onClick={() => setActiveWeek(w.weekNumber)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg"
                    style={{ background: activeWeek === w.weekNumber ? C.accent : C.card2, color: activeWeek === w.weekNumber ? C.accentInk : C.faint, border: `1px solid ${activeWeek === w.weekNumber ? C.accent : C.rule}` }}>
                    {w.weekNumber}
                  </button>
                ))}
              </div>
              {week?.note && (
                <div className="text-xs font-semibold mb-3 p-2.5 rounded-lg" style={{ color: C.ink, background: C.card2, border: `1px solid ${C.rule}` }}>
                  {week.note}
                </div>
              )}

              <div className="flex flex-col gap-3">
                {week?.sessions.map((s) => (
                  <div key={s.id} className="p-3.5 rounded-xl" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <div className="text-sm font-extrabold" style={{ color: C.ink }}>
                        <ChevronRight size={13} className="inline mr-0.5" style={{ color: C.accent }} />{s.name}
                      </div>
                      {s.focus && <div className="text-[10.5px] font-semibold" style={{ color: C.faintLight }}>{s.focus}</div>}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" style={{ color: C.ink }}>
                        <thead>
                          <tr className="text-left" style={{ color: C.faintLight }}>
                            <th className="font-bold py-1 pr-2">Exercise</th>
                            <th className="font-bold py-1 pr-2">Sets</th>
                            <th className="font-bold py-1 pr-2">Reps</th>
                            <th className="font-bold py-1 pr-2">RPE</th>
                            <th className="font-bold py-1">Rest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.exercises.map((e) => (
                            <tr key={e.id} style={{ borderTop: `1px solid ${C.rule}` }}>
                              <td className="font-semibold py-1.5 pr-2">{e.name}{e.notes ? <span style={{ color: C.faintLight }}> — {e.notes}</span> : ""}</td>
                              <td className="mono font-bold py-1.5 pr-2">{e.sets}</td>
                              <td className="mono font-bold py-1.5 pr-2">{e.reps}</td>
                              <td className="mono font-bold py-1.5 pr-2">{e.rpe ?? "—"}</td>
                              <td className="mono py-1.5" style={{ color: C.faintLight }}>{e.restSec ? `${e.restSec}s` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                {confirmingDelete ? (
                  <Btn small kind="red" onClick={removePlan}>Confirm delete</Btn>
                ) : (
                  <Btn small kind="ghost" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 size={12} className="inline mr-1" />Delete plan
                  </Btn>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
