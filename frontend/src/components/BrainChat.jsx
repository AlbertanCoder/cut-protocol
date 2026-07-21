import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api.js";
import { C } from "../lib/theme.js";

// Stage D2 chat bar. Gated by GET /api/brain/status: with the brain off it
// renders NOTHING (the app is byte-identical to today). Text only — no file,
// URL, or image input. Depth defaults to balanced.
const CHIPS = [
  "Plan me a high-protein day",
  "Low-carb lunch under my target",
  "Swap a meal that's too high in fat",
  "Vegan dinner ideas",
];
const DEPTHS = ["fast", "balanced", "thorough"];

// Stage 1 (v2): a deterministic day the coach built via the engine. EVERY number
// here came from the solver (LAW 1) — the card only displays them. Constitution:
// macro triad only (P blue / C amber / F pink), NO green, NO red, elevation via
// lightness (card2 → card), P/C/F letter labels always present.
function PlanCard({ plan }) {
  return (
    <div className="mt-1.5 rounded-xl overflow-hidden" style={{ background: C.card2, border: `1px solid ${C.rule}` }}>
      {plan.slots.map((s, i) => (
        <div key={i} className="px-3 py-2 flex flex-col gap-0.5" style={{ borderBottom: i < plan.slots.length - 1 ? `1px solid ${C.rule}` : "none" }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faintLight }}>{s.slotType}</span>
            <span className="text-[12px] font-bold tabular-nums" style={{ color: C.ink }}>{s.kcal} <span className="text-[9px] font-semibold" style={{ color: C.faintLight }}>kcal</span></span>
          </div>
          <div className="text-[12px] font-semibold" style={{ color: s.label ? C.ink : C.faintLight }}>{s.label || "— no fit from your recipes"}</div>
          <div className="flex gap-2.5 text-[10px] font-bold tabular-nums">
            <span style={{ color: C.proteinText }}>P {s.protein}</span>
            <span style={{ color: C.carbText }}>C {s.carb}</span>
            <span style={{ color: C.fatText }}>F {s.fat}</span>
          </div>
        </div>
      ))}
      <div className="px-3 py-2 flex items-baseline justify-between gap-2" style={{ background: C.card }}>
        <span className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: C.faint }}>Day total</span>
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-extrabold tabular-nums" style={{ color: C.ink }}>{plan.total.kcal}</span>
          <span className="text-[9px] font-semibold" style={{ color: C.faintLight }}>kcal</span>
          <span className="text-[10px] font-bold tabular-nums" style={{ color: C.proteinText }}>P {plan.total.protein}</span>
          <span className="text-[10px] font-bold tabular-nums" style={{ color: C.carbText }}>C {plan.total.carb}</span>
          <span className="text-[10px] font-bold tabular-nums" style={{ color: C.fatText }}>F {plan.total.fat}</span>
        </div>
      </div>
      {plan.target && (
        <div className="px-3 py-1.5 text-[10px] font-semibold" style={{ color: C.faintLight, borderTop: `1px solid ${C.rule}` }}>
          Target {plan.target.kcal} kcal · numbers computed by the engine
        </div>
      )}
    </div>
  );
}

export default function BrainChat() {
  const [enabled, setEnabled] = useState(null); // null = checking, false = off (hidden), true = on
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [depth, setDepth] = useState("balanced");
  const [messages, setMessages] = useState([]); // { role:'you'|'coach', text, tone? }
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api.getBrainStatus().then(
      (s) => { if (alive) setEnabled(!!(s && s.enabled)); },
      () => { if (alive) setEnabled(false); } // any error → stay hidden (fail safe)
    );
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const send = useCallback(async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    // prior turns → history so follow-ups ("why not?") have context (backend caps + re-guards)
    const history = messages.map((m) => ({ role: m.role === "you" ? "user" : "assistant", content: m.text }));
    setInput("");
    setMessages((m) => [...m, { role: "you", text: msg }]);
    setSending(true);
    try {
      const res = await api.brainChat(msg, depth, history);
      const text2 = res && res.available === false ? "The assistant is currently off." : (res && res.reply) || "No response.";
      const tone = res && (res.refused || res.degraded) ? "muted" : "normal";
      setMessages((m) => [...m, { role: "coach", text: text2, tone, plan: (res && res.plan) || null }]);
    } catch {
      setMessages((m) => [...m, { role: "coach", text: "Something went wrong — your deterministic plan on the Plan tab is unaffected.", tone: "muted" }]);
    } finally {
      setSending(false);
    }
  }, [input, depth, sending, messages]);

  if (enabled !== true) return null; // brain off → no chat bar at all

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold"
        style={{ background: C.accentBg, color: C.accent, border: `1px solid ${C.rule}` }}
        aria-label="Open the meal-planning assistant"
      >
        <span aria-hidden="true">✦</span> Coach
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-[360px] max-w-[92vw] h-[500px] max-h-[76vh] flex flex-col rounded-2xl overflow-hidden"
      style={{ background: C.cardGlass, border: `1px solid ${C.rule}`, backdropFilter: "blur(8px)" }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.rule}` }}>
        <div className="text-sm font-extrabold" style={{ color: C.ink }}>
          <span style={{ color: C.accent }}>✦</span> Coach <span className="text-[10px] font-bold uppercase tracking-wide ml-1" style={{ color: C.faintLight }}>beta</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-xs font-bold px-2 py-1 rounded-lg" style={{ color: C.faint }} aria-label="Close">✕</button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold" style={{ color: C.faint }}>Ask about meals, macros, or swaps. I only help with food and planning.</div>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {CHIPS.map((c) => (
                <button key={c} onClick={() => send(c)} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-full text-left" style={{ background: C.card2, color: C.faint, border: `1px solid ${C.rule}` }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "you" ? "self-end" : "self-start"} style={{ maxWidth: m.plan ? "97%" : "85%" }}>
              <div
                className="text-[13px] font-semibold px-3 py-2 rounded-2xl whitespace-pre-wrap"
                style={
                  m.role === "you"
                    ? { background: C.card2, color: C.ink, borderBottomRightRadius: 6 }
                    : { background: "transparent", color: m.tone === "muted" ? C.faint : C.ink, border: `1px solid ${C.rule}`, borderBottomLeftRadius: 6 }
                }
              >
                {m.text}
              </div>
              {m.plan && <PlanCard plan={m.plan} />}
            </div>
          ))
        )}
        {sending && <div className="self-start text-[12px] font-semibold px-1" style={{ color: C.faintLight }}>…</div>}
      </div>

      <div className="px-3 pt-2 pb-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${C.rule}` }}>
        <div className="flex items-center gap-1">
          {DEPTHS.map((d) => (
            <button
              key={d}
              onClick={() => setDepth(d)}
              className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
              style={depth === d ? { background: C.card2, color: C.ink, border: `1px solid ${C.faintLight}` } : { background: "transparent", color: C.faintLight, border: `1px solid ${C.rule}` }}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 500))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Ask about your meals…"
            className="flex-1 resize-none text-[13px] font-semibold px-3 py-2 rounded-xl outline-none"
            style={{ background: C.card, color: C.ink, border: `1px solid ${C.rule}`, maxHeight: 80 }}
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="text-sm font-bold px-3 py-2 rounded-xl"
            style={{ background: C.accent, color: C.accentInk, opacity: sending || !input.trim() ? 0.5 : 1 }}
            aria-label="Send"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
