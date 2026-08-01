# D7 — coherence audit, from the TARGET side.
#
# Independent of A11: A11 asked "does the tolerance box intersect the pool hull"
# with a Frank-Wolfe distance. This asks the LP feasibility question exactly
# (HiGHS), and additionally asks the question A11 did not: is the NOMINAL ask
# (the four midpoints the app prescribes and shows the customer) reachable at all.
import json, os, math, csv, sys
import numpy as np
from scipy.optimize import linprog
from d7_derive import full_chain, QA, jsround

D7 = os.path.dirname(os.path.abspath(__file__))
A11 = r"C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A11"

STYLE_FILES = {s: os.path.join(A11, f"A11-survivors-{s}.csv") for s in
               ["none","mediterranean","halal","kosher","vegetarian","vegan","paleo","keto","carnivore"]}

def load_pool(style):
    f = STYLE_FILES.get(style) or STYLE_FILES["none"]
    rows = []
    with open(f, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            k = float(r["kcal"]);
            if k <= 0: continue
            rows.append((k, float(r["protein_g"]), float(r["fat_g"]), float(r["carb_g"]),
                         r["slot_type"], r["name"]))
    return rows

_pool_cache = {}
def pool_matrix(style, slot_types=None):
    key = (style, slot_types)
    if key in _pool_cache: return _pool_cache[key]
    rows = load_pool(style)
    if slot_types:
        rows = [r for r in rows if r[4] in slot_types]
    V = np.array([[r[0], r[1], r[2], r[3]] for r in rows], dtype=float).T  # 4 x n
    _pool_cache[key] = (V, rows)
    return V, rows

def cone_hits_point(V, b, tol=1e-7):
    """exists a>=0 with V a = b ?"""
    n = V.shape[1]
    res = linprog(c=np.zeros(n), A_eq=V, b_eq=np.array(b, dtype=float),
                  bounds=[(0, None)]*n, method="highs")
    return bool(res.status == 0)

def cone_hits_box(V, lo, hi):
    """exists a>=0 with lo <= V a <= hi ?  (hi entries may be np.inf)"""
    n = V.shape[1]
    rows_ub = []; b_ub = []
    for j in range(4):
        if np.isfinite(hi[j]):
            rows_ub.append(V[j]); b_ub.append(hi[j])
        rows_ub.append(-V[j]); b_ub.append(-max(lo[j], 0.0))
    A_ub = np.array(rows_ub); b_ub = np.array(b_ub)
    res = linprog(c=np.zeros(n), A_ub=A_ub, b_ub=b_ub, bounds=[(0, None)]*n, method="highs")
    return bool(res.status == 0)

def graded_box(m):
    """The four rules dayTolerance() actually grades on (mealSolver.js:210-252)."""
    pMid = (m["proteinLo"] + m["proteinHi"]) / 2
    fMid = (m["fatLo"] + m["fatHi"]) / 2
    cMid = (m["carbLo"] + m["carbHi"]) / 2
    lo = [0.85*m["kcal"], 0.85*pMid, m["fatLo"] - 0.25*fMid, m["carbLo"] - 0.25*cMid]
    hi = [1.15*m["kcal"], np.inf,    m["fatHi"] + 0.25*fMid,
          m["carbHi"] + (0.0 if m["keto"] else 0.25*cMid)]
    return lo, hi, pMid, fMid, cMid

def main():
    personas = [json.loads(l) for l in open(os.path.join(QA,"personas.jsonl"), encoding="utf-8")]
    recorded = set()
    tiers = {}
    for l in open(os.path.join(QA,"results.jsonl"), encoding="utf-8"):
        d = json.loads(l)
        if d.get("target"):
            recorded.add(d["id"]); tiers[d["id"]] = d.get("tier")
    out = []
    for per in personas:
        pid = per["id"]
        p = per["profile"]
        e, t, m = full_chain(per)
        lo, hi, pMid, fMid, cMid = graded_box(m)
        style = p.get("dietaryStyle") or "none"
        V, rows = pool_matrix(style)
        # --- the four asks -------------------------------------------------
        macro_kcal = pMid*4 + fMid*9 + cMid*4
        gap = m["kcal"] - macro_kcal
        # densities per 100 kcal of the MACRO MIX itself (the honest "what mix")
        dP = pMid/macro_kcal*100; dF = fMid/macro_kcal*100; dC = cMid/macro_kcal*100
        # densities against the calorie TARGET (what a day hitting kcal must average)
        tP = pMid/m["kcal"]*100; tF = fMid/m["kcal"]*100; tC = cMid/m["kcal"]*100
        rec = dict(
            id=pid, tier=per.get("tier"), style=style, sex=p["sex"], age=p["age"],
            kg=p["startWeightKg"], heightCm=p["heightCm"], bf=p.get("bodyFatPct"),
            bfAssumed=m["bfAssumed"], rate=p.get("rateLbPerWeek"),
            occ=p.get("occupationKey"), meals=p.get("mealsPerDay"), snacks=p.get("snacksPerDay"),
            rmr=e["rmr"], tdee=e["tdee"], raw=t["raw"], floor=t["floor"], floored=t["floored"],
            kcal=m["kcal"], lbmLb=m["lbmLb"],
            proteinLo=m["proteinLo"], proteinHi=m["proteinHi"], pMid=pMid,
            fatLo=m["fatLo"], fatHi=m["fatHi"], fMid=fMid,
            carbLo=m["carbLo"], carbHi=m["carbHi"], cMid=cMid,
            keto=m["keto"], carbFloored=m["carbFloored"], macroKcalGap=m["macroKcalGap"],
            macroImpliedKcal=macro_kcal, kcalGap=gap,
            densP=dP, densF=dF, densC=dC, tgtP100=tP, tgtF100=tF, tgtC100=tC,
            pctKcalProtein=pMid*4/m["kcal"], pctKcalFat=fMid*9/m["kcal"], pctKcalCarb=cMid*4/m["kcal"],
            gPerKgBw=pMid/p["startWeightKg"], gPerLbBw=pMid/(p["startWeightKg"]*2.20462),
            gPerKgLbm=pMid/(m["lbmLb"]/2.20462),
            floorGPerKgBw=m["proteinLo"]/p["startWeightKg"],
            poolN=V.shape[1],
        )
        # --- T2a nominal 4-vector reachable? -------------------------------
        rec["nominalFeasible"] = cone_hits_point(V, [m["kcal"], pMid, fMid, cMid])
        # T2a' drop kcal: is the macro MIX (3-vector, kcal free) reachable?
        rec["mixFeasible"] = cone_hits_point(V[1:], [pMid, fMid, cMid])
        # --- T2b graded box reachable (scale bounds + slot types relaxed) ---
        rec["boxFeasible"] = cone_hits_box(V, lo, hi)
        # --- per-axis: which single rule is unreachable on its own ----------
        for j, nm in enumerate(["kcal","prot","fat","carb"]):
            l2 = [-1e18]*4; h2 = [np.inf]*4
            l2[j] = lo[j]; h2[j] = hi[j]
            l2[0] = max(l2[0], 1.0)  # a day must have some calories
            rec[f"axisOk_{nm}"] = cone_hits_box(V, l2, h2)
        # --- pairwise kcal+X (the binding pair test) ------------------------
        for j, nm in enumerate(["prot","fat","carb"], start=1):
            l2 = [lo[0], 0.0, 0.0, 0.0]; h2 = [hi[0], np.inf, np.inf, np.inf]
            l2[j] = lo[j]; h2[j] = hi[j]
            rec[f"pairOk_kcal_{nm}"] = cone_hits_box(V, l2, h2)
        out.append(rec)
        if len(out) % 25 == 0: print(f"  ...{len(out)}", file=sys.stderr)
    with open(os.path.join(D7, "d7-personas.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, default=str)
    print(f"wrote {len(out)} personas -> d7-personas.json")

if __name__ == "__main__":
    main()
