import { useState, useEffect, useMemo } from "react";
import { Search } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const g1 = (n) => Math.round(n * 10) / 10;
const CATS = ["all", "protein", "carb", "veg", "fat", "dairy", "fruit", "other"];
const CAT_COLOR = {
  protein: C.protein, carb: C.carb, fat: C.fat,
  veg: C.good, dairy: C.carb, fruit: C.good, other: C.faintLight,
};

export default function FoodsTab() {
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");

  useEffect(() => {
    api.getFoods().then(setFoods).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return foods.filter((f) => (cat === "all" || f.category === cat) && f.name.toLowerCase().includes(q));
  }, [foods, query, cat]);

  return (
    <div>
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
        <input
          type="text" placeholder="Search your foods…" value={query} onChange={(e) => setQuery(e.target.value)}
          className="w-full text-sm pl-9 pr-3 py-2.5 rounded-xl"
          style={{ background: C.card, border: `1px solid ${C.rule}`, color: C.ink }}
        />
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2">
        {CATS.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full"
            style={{
              background: cat === c ? C.accent : C.card, color: cat === c ? "#fff" : C.faint,
              border: `1px solid ${cat === c ? C.accent : C.rule}`,
            }}>
            {c === "all" ? "All" : c[0].toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <div className="text-xs font-semibold px-1 mb-2" style={{ color: C.faintLight }}>
        {loading ? "Loading…" : `${filtered.length} food${filtered.length === 1 ? "" : "s"}`}
      </div>

      <Card>
        {filtered.map((f) => (
          <div key={f.id} className="flex items-center gap-2.5 py-2.5" style={{ borderBottom: `1px solid ${C.rule}` }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAT_COLOR[f.category] || C.faintLight }}></span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate" style={{ color: C.ink }}>{f.name}</div>
              <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: C.faintLight }}>{f.category} · per 100g</div>
            </div>
            <div className="text-right shrink-0">
              <div className="mono text-sm font-extrabold" style={{ color: C.ink }}>{Math.round(f.kcal)}</div>
              <div className="text-[10.5px] font-semibold" style={{ color: C.faintLight }}>{g1(f.protein)}P {g1(f.fat)}F {g1(f.carb)}C</div>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-sm font-semibold py-2" style={{ color: C.faint }}>No foods match.</div>
        )}
      </Card>
    </div>
  );
}
