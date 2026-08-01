# D7 — hand-derived target + macro-band chain.
# NOTHING is imported from backend/src. Every constant is transcribed by hand
# from source with a file:line comment. The only cross-check is against the
# bands the RUNNING app recorded in qa-fleet .../results.jsonl.
import json, math, os, sys

ROOT = r"C:/Users/<account>/Desktop/cut-protocol"
QA = os.path.join(ROOT, "docs/surgery/CAMPAIGN/qa/qa-fleet-20260729-2032")

def jsround(x):
    """JS Math.round: half away from +inf (i.e. floor(x+0.5))."""
    return math.floor(x + 0.5)

KG2LB = 2.20462  # bmrEngine.js:18

# activityData.js:15-68
OCC = {
 "desk-office":1.2,"software-tech":1.2,"accounting-finance":1.2,"customer-support":1.2,
 "student":1.25,"driver-truck":1.25,"driver-rideshare":1.25,"unemployed-home":1.2,
 "teacher":1.3,"retail-sales":1.3,"cashier":1.3,"hairdresser":1.3,"lab-technician":1.3,
 "pharmacist":1.3,"reception-admin":1.28,"security-guard":1.3,"driver-delivery":1.35,
 "nurse-healthcare":1.45,"server-bartender":1.42,"warehouse":1.45,"mechanic":1.42,
 "electrician":1.42,"plumber-hvac":1.45,"carpenter-finish":1.45,"painter-decorator":1.4,
 "chef-kitchen":1.42,"cleaner-janitorial":1.42,"postal-courier":1.45,"personal-trainer":1.45,
 "trades-general":1.42,"stocker-grocery":1.4,
 "construction-labourer":1.55,"formwork-concrete":1.55,"roofer-scaffolder":1.55,
 "landscaper":1.5,"farm-work":1.55,"mover":1.55,"welder-fabricator":1.5,"firefighter":1.5,
 "logging-forestry":1.7,"commercial-fishing":1.7,"mining":1.7,"manual-harvest":1.7,
}
# activityData.js:74-79
MET = {"weights":3.5,"mixed":5.0,"sport":6.0,"cardio":7.0}

# bmrEngine.js:215-217, 268-292
SAFE_FLOOR = {"M":1500,"F":1200}
KCAL_PER_LB = 3500
CARB_MIDPOINT_BUFFER_G = 25
KETO_CARB_TARGET_G = 25
KETO_CARB_LO_G = 10
KETO_CARB_CEILING_G = 30
ASSUMED_BF = {"M":21,"F":28}
ESSENTIAL_FAT_PER_LB_LBM = 0.3
NONKETO_CARB_FLOOR_G = 50

DEFAULT_ENABLED = ["mifflin","oxford","harris","schofield","katch","cunningham"]

def bmr_rows(p, kg):
    cm = p["heightCm"]; a = p["age"]; male = p["sex"] == "M"
    bf = p.get("bodyFatPct") or 0
    lbm = kg * (1 - bf/100.0)
    r = {}
    # bmrEngine.js:36-51
    r["mifflin"] = 10*kg + 6.25*cm - 5*a + (5 if male else -161)
    if male:
        r["oxford"] = (16*kg+545) if a<30 else (14.2*kg+593) if a<60 else (13.0*kg+567) if a<70 else (13.7*kg+481)
    else:
        r["oxford"] = (13.1*kg+558) if a<30 else (9.74*kg+694) if a<60 else (10.2*kg+572) if a<70 else (10.0*kg+577)
    # :52-58
    r["harris"] = (88.362+13.397*kg+4.799*cm-5.677*a) if male else (447.593+9.247*kg+3.098*cm-4.33*a)
    # :59-65  applicable 18<=a<60
    if 18 <= a < 60:
        if male:
            r["schofield"] = (15.057*kg+692.2) if a<30 else (11.472*kg+873.1)
        else:
            r["schofield"] = (14.818*kg+486.6) if a<30 else (8.126*kg+845.6)
    # :66-75  applicable bf>0
    if bf > 0:
        r["katch"] = 370 + 21.6*lbm
        r["cunningham"] = 500 + 22*lbm
    return r

def compute_energy(p, kg):
    rows = bmr_rows(p, kg)
    excluded = p.get("excludedFormulas") or []
    on = [k for k in rows if (k in DEFAULT_ENABLED) != (k in excluded)]
    if not on:
        on = list(rows)
    vals = [rows[k] for k in on]
    rmr = sum(vals)/len(vals)
    ov = p.get("activityOverride")
    if isinstance(ov,(int,float)) and 1 <= ov <= 2.2:
        mult = ov
    else:
        mult = OCC.get(p.get("occupationKey"), OCC["desk-office"])
    met = MET.get(p.get("trainingStyle"), MET["mixed"])
    sess = p.get("sessionsPerWeek") or 0
    mins = p.get("minutesPerSession") or 0
    train = jsround((sess*mins*met*3.5*kg)/200/7)   # bmrEngine.js:167-168
    tdee = rmr*mult + train
    return {"rmr": jsround(rmr), "tdee": jsround(tdee), "mult": mult, "train": train,
            "rmr_raw": rmr, "formulas": on}

def derive_target(p, tdee, rmr):
    rate = p.get("rateLbPerWeek", 1.0)
    if rate is None: rate = 1.0
    deficit = jsround(rate*KCAL_PER_LB/7)          # bmrEngine.js:232
    raw = jsround(tdee - deficit)                  # :233
    sex_floor = SAFE_FLOOR.get(p["sex"], SAFE_FLOOR["M"])
    rmr_floor = jsround(rmr*0.95) if rmr > 0 else 0
    floor = max(sex_floor, rmr_floor, p.get("floorKcal") or 0)   # :224-228
    target = max(raw, floor)
    return {"rate":rate,"deficit":deficit,"raw":raw,"floor":floor,"target":target,
            "floored": raw < floor, "sexFloor":sex_floor,"rmrFloor":rmr_floor}

def compute_macros(p, kg, target_kcal):
    """Hand transcription of bmrEngine.js:294-360."""
    wlb = kg*KG2LB
    bf = p.get("bodyFatPct")
    bf_known = bf is not None and bf > 0
    bf_use = bf if bf_known else (ASSUMED_BF["F"] if p["sex"]=="F" else ASSUMED_BF["M"])
    lbm = wlb*(1-bf_use/100.0)
    pLo = jsround(lbm*1.14); pHi = jsround(lbm*1.25); pMid = (pLo+pHi)/2
    if p.get("dietaryStyle") == "keto":
        carbMid = KETO_CARB_TARGET_G
        fatBal = jsround((target_kcal - pMid*4 - carbMid*4)/9)
        fatMid = max(jsround(lbm*ESSENTIAL_FAT_PER_LB_LBM), fatBal)
        return dict(lbmLb=lbm, kcal=target_kcal, proteinLo=pLo, proteinHi=pHi,
                    fatLo=jsround(fatMid*0.9), fatHi=jsround(fatMid*1.12),
                    carbLo=KETO_CARB_LO_G, carbMid=carbMid, carbHi=KETO_CARB_CEILING_G,
                    macroKcalGap=jsround(target_kcal-(pMid*4+fatMid*9+carbMid*4)),
                    keto=True, carbFloored=False, bfAssumed=not bf_known,
                    assumedBodyFatPct=None if bf_known else bf_use, fatMid=fatMid)
    fatLo = jsround(lbm*0.34); fatHi = jsround(lbm*0.40); fatMid = (fatLo+fatHi)/2
    carbMid = jsround((target_kcal - pMid*4 - fatMid*9)/4) - CARB_MIDPOINT_BUFFER_G
    carbFloored = False
    if carbMid < NONKETO_CARB_FLOOR_G:
        carbFloored = True
        ess = jsround(lbm*ESSENTIAL_FAT_PER_LB_LBM)
        bal = jsround((target_kcal - pMid*4 - NONKETO_CARB_FLOOR_G*4)/9)
        fatMid = max(ess, bal)
        fatLo = jsround(fatMid*0.9); fatHi = jsround(fatMid*1.12)
        room = jsround((target_kcal - pMid*4 - fatMid*9)/4)
        carbMid = max(0, min(NONKETO_CARB_FLOOR_G, room))
    return dict(lbmLb=lbm, kcal=target_kcal, proteinLo=pLo, proteinHi=pHi,
                fatLo=fatLo, fatHi=fatHi, carbLo=max(carbMid-12,0), carbMid=carbMid,
                carbHi=carbMid+12,
                macroKcalGap=jsround(target_kcal-(pMid*4+fatMid*9+carbMid*4)),
                keto=False, carbFloored=carbFloored, bfAssumed=not bf_known,
                assumedBodyFatPct=None if bf_known else bf_use, fatMid=fatMid)

def full_chain(persona):
    p = persona["profile"]
    kg = p["startWeightKg"]              # no weigh-ins in the fleet -> weightNow = startWeightKg
    e = compute_energy(p, kg)
    t = derive_target(p, e["tdee"], e["rmr"])
    m = compute_macros(p, kg, t["target"])
    return e, t, m

if __name__ == "__main__":
    personas = [json.loads(l) for l in open(os.path.join(QA,"personas.jsonl"),encoding="utf-8")]
    recorded = {}
    for l in open(os.path.join(QA,"results.jsonl"),encoding="utf-8"):
        d = json.loads(l)
        if d.get("target"): recorded[d["id"]] = d
    ok = bad = 0
    mism = []
    for per in personas:
        pid = per["id"]
        if pid not in recorded: continue
        e,t,m = full_chain(per)
        r = recorded[pid]["target"]
        got = dict(kcal=t["target"], proteinLo=m["proteinLo"], proteinHi=m["proteinHi"],
                   fatLo=m["fatLo"], fatHi=m["fatHi"], carbLo=m["carbLo"], carbHi=m["carbHi"],
                   keto=m["keto"], macroKcalGap=m["macroKcalGap"])
        diff = {k:(got[k], r[k]) for k in got if k in r and got[k] != r[k]}
        if diff:
            bad += 1; mism.append((pid, diff))
        else:
            ok += 1
    print(f"hand-derivation vs app-recorded bands: {ok} exact, {bad} mismatched, of {len(recorded)} recorded")
    for pid,d in mism[:25]:
        print("  ", pid, d)
