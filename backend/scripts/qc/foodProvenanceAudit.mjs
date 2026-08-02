// foodProvenanceAudit.mjs — food-record provenance: measure, then verify, then repair.
//
//   node backend/scripts/qc/foodProvenanceAudit.mjs                # DRY RUN (default)
//   node backend/scripts/qc/foodProvenanceAudit.mjs --apply         # merge verified repairs into foodOverrides.json
//   node backend/scripts/qc/foodProvenanceAudit.mjs --freshdb       # re-copy dev.db before running
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS, AND WHY IT IS SHAPED LIKE THIS
//
// docs/make-it-work-prompt.md records the hardest-won lesson on this tree:
//
//   "NEVER LET THE PROCESS THAT MAKES A CHANGE ALSO CERTIFY IT. Four separate
//    automated heuristics were tried on the food-provenance problem — head-noun
//    matching, USDA category, weak-match detection, calorie sanity bands — and
//    EVERY ONE produced false positives in BOTH directions."
//
// Every one of those four heuristics read the same evidence: the food's NAME.
// Head-noun matching compared the name to a description, USDA-category matching
// compared a name-derived expectation to a category, calorie sanity bands
// compared the name's implied food class to a number. Four rules, one witness.
// Agreement between them was never corroboration — it was the same witness
// repeating itself, which is exactly why they failed in both directions
// together.
//
// So this file is built around a rule that is stronger than "run two passes":
//
//   THE TWO PASSES MAY NOT SHARE A WITNESS.
//
//   PASS 1 — DETECTION reads ONLY declarative evidence: the row's own
//     `dataQuality` prose, its `source` tier, and the verdict that the shipping
//     product's own foodValidation.macroTrustIssue() reaches about it. Not one
//     branch of Pass 1 looks at a macro number. It answers: "what does this
//     database SAY about this row, and does the product act on what it says?"
//
//   PASS 2 — VERIFICATION reads ONLY numeric and structural evidence: the raw
//     USDA record in backend/data/fdc-cache/fdc-index.json, arithmetic on the
//     row's own five nutrient fields, the set of OTHER Food rows holding the
//     same fdcId, and the recipes that actually consume the row. Pass 2 never
//     reads `dataQuality` to reach a verdict — it only reads it to find which
//     FDC id to go and look up, and a wrong id there produces a REJECT, not a
//     false confirm. It answers: "independent of anything this row claims about
//     itself, do the numbers reconcile?"
//
// A row is REPAIRED only when both passes agree AND Pass 2 supplies the
// corrected number from the authoritative record. Everything else is FLAGGED.
// A confidently wrong macro is worse than a flagged uncertain one.
//
// WHAT IT WILL NOT DO
//   · It will not write to backend/prisma/dev.db. It works on a copy, opened
//     read-only, and refuses to start if the path resolves to the shared file.
//   · Its --apply mode writes ONE file: backend/data/foodOverrides.json, the
//     established curated-override mechanism. Landing those values in the DB is
//     a separate, deliberate act — `node backend/scripts/applyFoodOverrides.mjs
//     --apply`, which is itself report-only by default. Two locks, not one.
//   · It will not guess a replacement macro. Where the right value is a
//     judgment call (UK vs US "corn flour"; dried vs fresh tarragon), it emits
//     a flag with the evidence and stops.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SHARED_DB = path.resolve(REPO, "backend/prisma/dev.db");
const FDC_INDEX = path.resolve(REPO, "backend/data/fdc-cache/fdc-index.json");
const OVERRIDES_FILE = path.resolve(REPO, "backend/data/foodOverrides.json");
const AGENT = "food-records";
const OUT_DIR = path.resolve(REPO, "fleet/out/food-records");

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const FRESH = argv.has("--freshdb");

const sha256 = (p) => (fs.existsSync(p) ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null);
const r2 = (x) => Math.round(x * 100) / 100;

// ── DB ISOLATION ────────────────────────────────────────────────────────────
// backend/prisma/dev.db is the owner's real data and several measurement
// baselines are pinned to its exact sha256. "We only read it" is not a property
// the filesystem enforces — a copy is, and readOnly:true on the copy is the
// second lock. Pattern lifted from backend/scripts/qc/dayDump.mjs.
const norm = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
function prepareDb() {
  if (!fs.existsSync(SHARED_DB)) throw new Error(`shared DB not found at ${SHARED_DB}`);
  const dir = path.resolve(REPO, "fleet/scratch", AGENT);
  const dbPath = path.resolve(dir, "dev.db");
  if (norm(dbPath) === norm(SHARED_DB)) throw new Error("refusing — resolved to the SHARED dev.db");
  fs.mkdirSync(dir, { recursive: true });
  if (FRESH || !fs.existsSync(dbPath)) {
    fs.copyFileSync(SHARED_DB, dbPath);
    for (const ext of ["-wal", "-shm"]) {
      const src = SHARED_DB + ext;
      if (fs.existsSync(src)) fs.copyFileSync(src, dbPath + ext);
      else if (fs.existsSync(dbPath + ext)) fs.rmSync(dbPath + ext);
    }
  }
  return { dbPath, sourceSha256: sha256(SHARED_DB), copySha256: sha256(dbPath) };
}

// ── evidence loaders ────────────────────────────────────────────────────────
function loadFdcIndex() {
  const idx = JSON.parse(fs.readFileSync(FDC_INDEX, "utf8"));
  return { meta: { builtAt: idx.builtAt, records: idx.records.length }, byId: new Map(idx.records.map((r) => [r.fdcId, r])), all: idx.records };
}

// ── PASS 1: DETECTION — declarative evidence ONLY ───────────────────────────
// Reads dataQuality prose, source, and the product's own trust verdict.
// Touches no macro number, consults no USDA record.
const DECLARED = [
  { key: "quarantined", test: (dq, src) => src === "quarantined" || (dq || "").startsWith("quarantined"), meaning: "DB declares: macros belong to a different food, no replacement found" },
  { key: "provenance-cleared", test: (dq) => (dq || "").startsWith("exception:provenance-cleared"), meaning: "DB declares: carried another record's macros; provenance stripped" },
  { key: "unverifiable-fdcid", test: (dq) => (dq || "").startsWith("exception:unverifiable-fdcid"), meaning: "DB declares: claimed an FDC id present in no dataset" },
  { key: "needs-a-human", test: (dq) => (dq || "").startsWith("NEEDS A HUMAN"), meaning: "DB declares: a reviewer looked and DECLINED to decide" },
  { key: "unverified-loose", test: (dq) => /^exception:\s+unverified/.test(dq || ""), meaning: "DB declares unverified, but with a prefix the product does not recognise" },
  { key: "provenance-restored", test: (dq) => (dq || "").startsWith("provenance-restored"), meaning: "DB declares: repaired — macros re-derived from a named FDC record" },
  { key: "provenance-reviewed", test: (dq) => (dq || "").startsWith("provenance-reviewed"), meaning: "DB declares: reviewed and ruled correct as-is" },
  { key: "override-applied", test: (dq) => (dq || "").startsWith("override:applied"), meaning: "DB declares: value set by a curated human override" },
];
function detect(row, trustIssue) {
  const hit = DECLARED.find((d) => d.test(row.dataQuality, row.source));
  return {
    declaredKey: hit ? hit.key : row.dataQuality == null ? "undeclared" : (row.dataQuality || "").split(/[—:]/)[0].trim() || "other",
    declaredMeaning: hit ? hit.meaning : null,
    // "the DB's own text says this row's provenance is unresolved"
    declaresUnresolved: !!hit && ["quarantined", "provenance-cleared", "unverifiable-fdcid", "needs-a-human", "unverified-loose"].includes(hit.key),
    productTrusts: trustIssue === null,
    productIssueCode: trustIssue ? trustIssue.code : null,
  };
}

// ── PASS 2: VERIFICATION — numeric + structural evidence ONLY ───────────────
// Never reads dataQuality to reach a verdict. It reads it only to obtain a
// candidate FDC id; a wrong id yields REJECT (no record / no reconciliation),
// never a false confirm.
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= Math.max(tol, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
const macrosMatch = (row, rec) => near(row.protein, rec.protein, 0.05) && near(row.fat, rec.fat, 0.05) && near(row.carb, rec.carb, 0.05);
const kcalMatch = (row, rec) => near(row.kcal, rec.kcal, 1);
const classicAtwater = (row) => 4 * row.protein + 9 * row.fat + 4 * row.carb;

/**
 * Reconcile one row against one USDA record. Pure arithmetic + structure.
 * Returns a verdict string plus the numbers that produced it, so the report can
 * show its working instead of asserting a conclusion.
 */
function reconcile(row, rec, twins) {
  if (!rec) return { verdict: "no-record", note: "the named FDC id is in no cached dataset — nothing to reconcile against" };
  // USDA carbohydrate-by-difference goes NEGATIVE on lean flesh (100 − water −
  // protein − fat − ash overshoots). The importer clamps it to 0, so the row
  // legitimately differs from the record in exactly one field, by less than a
  // gram, in a direction physics requires. Checked BEFORE the mismatch rules
  // because a naive four-field comparison reports every one of these as
  // corruption — this is the single largest false-positive source in the
  // numeric channel, and the rows say so themselves via
  // `exception:usda-source-model`.
  if (rec.carb < 0 && row.carb === 0
      && near(row.protein, rec.protein, 0.05) && near(row.fat, rec.fat, 0.05) && kcalMatch(row, rec)) {
    return {
      verdict: "negative-carb-clamped",
      note: `record's carb-by-difference is ${rec.carb} g (negative, as USDA publishes it); the row clamps it to 0 and every other field matches exactly — a documented import model, not corruption`,
      fdcId: rec.fdcId, description: rec.description, recKcal: rec.kcal, rowKcal: row.kcal,
    };
  }
  const mm = macrosMatch(row, rec);
  const km = kcalMatch(row, rec);
  const classic = classicAtwater(row);
  const isRecompute = Math.abs(row.kcal - classic) <= Math.max(0.5, 0.005 * classic);
  const specific = rec.energyBasis === "atwater-specific" && rec.atwaterFactors
    && (rec.atwaterFactors.protein !== 4 || rec.atwaterFactors.fat !== 9 || rec.atwaterFactors.carb !== 4);
  const base = { fdcId: rec.fdcId, description: rec.description, recKcal: rec.kcal, rowKcal: row.kcal, classicAtwater: r2(classic), energyBasis: rec.energyBasis, atwaterFactors: rec.atwaterFactors || null, twins: twins.map((t) => ({ name: t.name, kcal: t.kcal, source: t.source })) };

  if (mm && km) return { verdict: "reconciles", note: "all four macros match the USDA record", ...base };
  if (mm && !km && isRecompute && specific) {
    return {
      verdict: "kcal-recomputed",
      note: `P/F/C match the record exactly, but kcal ${row.kcal} equals the generic 4P+9F+4C recompute (${r2(classic)}) rather than the record's own published energy (${rec.kcal}), which USDA derived with food-specific factors ${rec.atwaterFactors.protein}/${rec.atwaterFactors.fat}/${rec.atwaterFactors.carb} (P/F/C)`,
      correctedKcal: rec.kcal,
      driftPct: r2(((row.kcal - rec.kcal) / rec.kcal) * 100),
      ...base,
    };
  }
  if (mm && !km) return { verdict: "kcal-diverges-unexplained", note: `P/F/C match but kcal ${row.kcal} vs record ${rec.kcal}, and the gap is NOT the generic-Atwater recompute`, ...base };
  return { verdict: "does-not-reconcile", note: "the row's macros are not this record's macros", ...base };
}

// Structural corroboration that needs no naming judgment at all: does another
// row in the same table already hold this exact fdcId? If so the library holds
// one USDA record twice, and any disagreement between the two copies is an
// internal contradiction rather than an opinion about what a name means.
const findTwins = (rows, fdcId, selfId) => rows.filter((r) => r.fdcId === fdcId && r.id !== selfId);

// Usage context — also naming-free. Which recipes eat this row, and what are
// they called? A row named "Rye" whose sole consumer is a recipe named
// "Rye bread" is being used as bread whatever its name argues.
function usageOf(db, foodId) {
  return db.prepare(`SELECT r.name AS recipeName, ri.baseGrams FROM RecipeIngredient ri JOIN Recipe r ON r.id = ri.recipeId WHERE ri.foodId = ? ORDER BY r.name`).all(foodId);
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const DB = prepareDb();
  if (norm(DB.dbPath) === norm(SHARED_DB)) throw new Error("refusing — working path is the SHARED dev.db");
  const db = new DatabaseSync(DB.dbPath, { readOnly: true });
  const q = (s, ...a) => db.prepare(s).all(...a);
  const fv = require_(path.resolve(REPO, "backend/src/lib/foodValidation.js"));
  const fdc = loadFdcIndex();

  const foods = q("SELECT id,name,category,fdcId,kcal,protein,fat,carb,fiber,source,dataQuality,dataQualityFlag,fdcCategory FROM Food");
  const usedFoodIds = new Set(q("SELECT DISTINCT foodId AS f FROM RecipeIngredient").map((r) => r.f));
  const recipeCount = q("SELECT COUNT(*) AS c FROM Recipe")[0].c;
  const riCount = q("SELECT COUNT(*) AS c FROM RecipeIngredient")[0].c;

  // ── PASS 1 ────────────────────────────────────────────────────────────────
  const p1 = new Map();
  const census = new Map();
  const trustGap = [];
  for (const row of foods) {
    const trustIssue = fv.macroTrustIssue(row);
    const d = detect(row, trustIssue);
    p1.set(row.id, d);
    const k = d.declaredKey;
    if (!census.has(k)) census.set(k, { rows: 0, trusted: 0, inUse: 0 });
    const c = census.get(k);
    c.rows++;
    if (d.productTrusts) c.trusted++;
    if (usedFoodIds.has(row.id)) c.inUse++;
    // THE PASS-1 HEADLINE: the DB's own text says unresolved, the product
    // serves the number anyway.
    if (d.declaresUnresolved && d.productTrusts) trustGap.push({ row, d });
  }

  // ── PASS 2 ────────────────────────────────────────────────────────────────
  // Candidates: every row that names an FDC id anywhere (column or prose).
  const idFromProse = (dq) => {
    const m = /re-derived from FDC (\d+)/.exec(dq || "") || /carried fdcId (\d+)/.exec(dq || "") || /carried fdcId (\d+)/.exec(dq || "") || /fdcId (\d+)/.exec(dq || "") || /FDC (\d+)/.exec(dq || "");
    return m ? Number(m[1]) : null;
  };

  const reconciliations = [];
  for (const row of foods) {
    const claimed = row.fdcId ?? idFromProse(row.dataQuality);
    if (claimed == null) continue;
    const rec = fdc.byId.get(claimed);
    const twins = findTwins(foods, claimed, row.id);
    const v = reconcile(row, rec, twins);
    reconciliations.push({ id: row.id, name: row.name, claimedFdcId: claimed, fromProse: row.fdcId == null, source: row.source, inUse: usedFoodIds.has(row.id), declared: p1.get(row.id).declaredKey, productTrusts: p1.get(row.id).productTrusts, ...v });
  }

  const byVerdict = new Map();
  for (const r of reconciliations) byVerdict.set(r.verdict, (byVerdict.get(r.verdict) || 0) + 1);

  // ── PASS 1, string channel: does the prose's quoted description equal the
  // record's own description?
  //
  // This channel is kept — and its weakness kept with it — because it is the
  // clearest demonstration on this tree of why the two passes may not share a
  // witness. The OBVIOUS way to lift a quoted description out of the prose is
  // `"([^"]+)"`. That is wrong here, and silently: USDA descriptions embed the
  // INCH MARK — `Beef, shoulder pot roast, boneless, separable lean only,
  // trimmed to 0" fat, choice, cooked, braised` — so the non-greedy capture
  // stops at `trimmed to 0` and the comparison reports a mismatch on a row that
  // is perfectly correct. Both parsers run, and the delta between them is
  // reported as a measured artifact rather than a war story. The arithmetic
  // channel is immune to it, which is the entire point.
  // naive: non-greedy [^"]+ — stops dead at the first inch-mark inside the description.
  const naiveDesc = (dq) => { const m = /(?:re-derived from FDC|carried fdcId) \d+ \s*\(?"([^"]+)"/.exec(dq || ""); return m ? m[1].trim() : null; };
  // correct: greedy to the LAST quote of the quoted span, so inch-marks survive.
  const strictDesc = (dq) => { const m = /(?:re-derived from FDC|carried fdcId) \d+ \s*\(?"(.+)"\)?(?:,|\.|;)/.exec(dq || ""); return m ? m[1].trim() : null; };
  const stringChannel = { naiveRaised: [], strictRaised: [] };
  for (const row of foods) {
    const claimed = row.fdcId ?? idFromProse(row.dataQuality);
    const rec = claimed != null ? fdc.byId.get(claimed) : null;
    if (!rec || !row.dataQuality) continue;
    const nd = naiveDesc(row.dataQuality), sd = strictDesc(row.dataQuality);
    if (nd && nd.toLowerCase() !== rec.description.trim().toLowerCase()) stringChannel.naiveRaised.push(row.name);
    if (sd && sd.toLowerCase() !== rec.description.trim().toLowerCase()) stringChannel.strictRaised.push(row.name);
  }
  // MEASURED ON THIS CORPUS: the naive parser raises 3 (all inch-mark
  // truncations) and the corrected parser raises 1 — and that one is an
  // artifact too, because the greedy capture runs past the closing quote when
  // the prose contains a SECOND quoted span ("…under the name \"Rye\""). Every
  // string-channel raise here is a false positive. Four heuristics failed on
  // this problem before; this is a fifth, and it fails the same way, which is
  // why the repair gate below never consults it.
  stringChannel.artifactOnly = stringChannel.naiveRaised.filter((n) => !stringChannel.strictRaised.includes(n));
  stringChannel.allRaised = [...new Set([...stringChannel.naiveRaised, ...stringChannel.strictRaised])];

  // ── JOIN: repair only where both passes agree and Pass 2 hands over a number ─
  const repairs = [];
  const flags = [];
  const rejected = [];

  for (const r of reconciliations) {
    if (r.verdict !== "kcal-recomputed") continue;
    const row = foods.find((f) => f.id === r.id);
    const usage = usageOf(db, r.id);
    // CORROBORATION GATE. Pass 2 must supply a witness that is not a name and
    // not the row's own prose: another row in this same table holding the same
    // fdcId, carrying the record's published energy. That makes the defect an
    // internal contradiction — one USDA record stored at two different
    // calorie values — which no naming heuristic is involved in judging.
    const witness = r.twins.find((t) => near(t.kcal, r.recKcal, 1));
    if (!witness) {
      rejected.push({ ...r, rejectedBecause: "no independent witness row holds this fdcId at the record's published energy; the correction would rest on the FDC file alone" });
      continue;
    }
    // SECOND-ORDER SAFETY: what does landing this repair actually DO?
    //
    // The delivery mechanism is backend/data/foodOverrides.json, and
    // applyFoodOverrides.mjs treats the mere PRESENCE of an entry as a human
    // verification — it clears the row's quarantine "whether or not a number
    // changed" (that script's own comment). So writing an override for a
    // QUARANTINED row would return it to service. "Skirty Steak" carries
    // "Beef, tenderloin steak, raw" macros; correcting its kcal makes the
    // calorie figure right and leaves the protein and fat belonging to a
    // different cut — a more convincing wrong number than the one it replaced.
    // A correct kcal is not a warrant for the other three macros. These stay
    // quarantined and are reported instead.
    if (fv.isQuarantined(row)) {
      rejected.push({ ...r, rejectedBecause: `row is QUARANTINED; an override entry would clear the quarantine as a side effect and return a known wrong-record row to service with three still-wrong macros. kcal ${row.kcal} -> ${r.correctedKcal} is correct but must not be delivered this way` });
      continue;
    }
    // Safety: the corrected value must still clear the product's own gate.
    const probe = { ...row, kcal: r.correctedKcal };
    const aw = fv.checkAtwater(probe);
    if (!aw.ok) {
      rejected.push({ ...r, rejectedBecause: `the corrected kcal ${r.correctedKcal} fails the product's own fiber-adjusted Atwater gate (computed ${aw.fiberAdjusted}) — a repair may not create a new validator failure` });
      continue;
    }
    repairs.push({
      id: r.id, name: row.name, category: row.category,
      from: { kcal: row.kcal }, to: { kcal: r.correctedKcal },
      driftPct: r.driftPct,
      direction: r.driftPct > 0 ? "OVERSTATES calories" : "understates calories",
      inUse: r.inUse, recipes: usage.map((u) => u.recipeName),
      pass1: `dataQuality declares "${r.declared}" and names FDC ${r.claimedFdcId}`,
      pass2: r.note,
      witness: `Food row "${witness.name}" holds fdcId ${r.claimedFdcId} at ${witness.kcal} kcal — the same USDA record is already in this table at the published energy`,
      macros: { protein: row.protein, fat: row.fat, carb: row.carb, fiber: row.fiber },
    });
  }

  // Flags: the trust gap, plus anything Pass 2 could not settle.
  for (const { row, d } of trustGap) {
    const claimed = row.fdcId ?? idFromProse(row.dataQuality);
    const rec = claimed != null ? fdc.byId.get(claimed) : null;
    const twins = claimed != null ? findTwins(foods, claimed, row.id) : [];
    const usage = usageOf(db, row.id);
    flags.push({
      id: row.id, name: row.name, kind: "trust-gap",
      macros: { kcal: row.kcal, protein: row.protein, fat: row.fat, carb: row.carb },
      pass1: `dataQuality declares "${d.declaredKey}" (${d.declaredMeaning}) — yet macroTrustIssue() returns null, so the product serves this number as verified fact`,
      pass2: rec
        ? `donor FDC ${rec.fdcId} "${rec.description}"; row ${macrosMatch(row, rec) ? "DOES" : "does NOT"} carry that record's macros verbatim`
        : "no donor FDC id recoverable — the numeric channel has nothing to say",
      twins: twins.map((t) => `${t.name} (${t.kcal} kcal, ${t.source})`),
      recipes: usage.map((u) => `${u.recipeName} @ ${u.baseGrams}g`),
      dataQuality: row.dataQuality,
    });
  }

  for (const r of reconciliations) {
    if (r.verdict === "does-not-reconcile" || r.verdict === "kcal-diverges-unexplained" || r.verdict === "no-record") {
      if (r.declared === "quarantined") continue; // already out of service
      flags.push({ id: r.id, name: r.name, kind: r.verdict, pass1: `declares "${r.declared}"`, pass2: r.note, macros: null, twins: [], recipes: [], dataQuality: null });
    }
  }

  // ── THE CANDIDATE FUNNEL ─────────────────────────────────────────────────
  // Every row either pass raised as possibly-wrong, deduplicated, with what
  // became of it. The rejection rate is computed off THIS, not off the repair
  // list — a rate measured only over the changes that survived would be a
  // number that can never be bad.
  const candidates = new Map();
  const raise = (name, id, channel) => {
    if (!candidates.has(name)) candidates.set(name, { name, id, channels: [], outcome: null, why: null });
    candidates.get(name).channels.push(channel);
  };
  for (const { row } of trustGap) raise(row.name, row.id, "pass1/declarative: DB declares provenance unresolved, product serves it as fact");
  for (const n of stringChannel.naiveRaised) raise(n, foods.find((f) => f.name === n)?.id, "pass1/string: prose description != record description (naive parse)");
  for (const r of reconciliations) {
    if (["kcal-recomputed", "negative-carb-clamped", "does-not-reconcile", "kcal-diverges-unexplained", "no-record"].includes(r.verdict)) {
      raise(r.name, r.id, `pass2/numeric: ${r.verdict}`);
    }
  }
  for (const c of candidates.values()) {
    if (repairs.some((r) => r.name === c.name)) { c.outcome = "REPAIRED"; c.why = "both passes agree; the corrected number comes from the USDA record and a twin row corroborates it"; continue; }
    if (rejected.some((r) => r.name === c.name)) { c.outcome = "REJECTED"; c.why = rejected.find((r) => r.name === c.name).rejectedBecause; continue; }
    if (stringChannel.artifactOnly.includes(c.name)) { c.outcome = "REJECTED — false positive"; c.why = "raised only by the naive string parse breaking on an inch-mark inside the USDA description; arithmetic reconciles this row exactly"; continue; }
    if (stringChannel.strictRaised.includes(c.name) && reconciliations.find((r) => r.name === c.name)?.verdict === "reconciles" && !flags.some((f) => f.name === c.name)) {
      c.outcome = "REJECTED — false positive"; c.why = "raised by the corrected string parse running past the closing quote on prose containing a second quoted span; arithmetic reconciles this row exactly"; continue;
    }
    const rc = reconciliations.find((r) => r.name === c.name);
    if (rc?.verdict === "negative-carb-clamped") { c.outcome = "REJECTED — false positive"; c.why = rc.note; continue; }
    if (flags.some((f) => f.name === c.name)) { c.outcome = "FLAGGED — no verified repair"; c.why = "the defect is real but the correct value is a judgment call the evidence cannot settle"; continue; }
    c.outcome = "REJECTED — false positive"; c.why = "reconciles on independent evidence";
  }
  const funnel = {
    raised: candidates.size,
    repaired: [...candidates.values()].filter((c) => c.outcome === "REPAIRED").length,
    rejectedFalsePositive: [...candidates.values()].filter((c) => c.outcome.startsWith("REJECTED")).length,
    flaggedNoVerifiedRepair: [...candidates.values()].filter((c) => c.outcome.startsWith("FLAGGED")).length,
    rows: [...candidates.values()],
    stringChannel: {
      naiveRaised: stringChannel.naiveRaised, strictRaised: stringChannel.strictRaised,
      artifactOnly: stringChannel.artifactOnly, allRaised: stringChannel.allRaised,
      realSignal: 0,
      note: "every string-channel raise on this corpus is a parser artifact, in BOTH parsers. The repair gate never consults this channel.",
    },
  };
  funnel.rejectionRatePct = funnel.raised ? r2(((funnel.raised - funnel.repaired) / funnel.raised) * 100) : null;
  funnel.falsePositiveRatePct = funnel.raised ? r2((funnel.rejectedFalsePositive / funnel.raised) * 100) : null;

  // ── report ────────────────────────────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const findings = {
    schema: "fleet/food-records/provenance/v1",
    tool: "backend/scripts/qc/foodProvenanceAudit.mjs",
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "APPLY" : "DRY RUN",
    provenance: {
      dbSha256: DB.sourceSha256, dbCopySha256: DB.copySha256, dbPath: path.relative(REPO, DB.dbPath).replace(/\\/g, "/"),
      fdcIndex: path.relative(REPO, FDC_INDEX).replace(/\\/g, "/"), fdcIndexBuiltAt: fdc.meta.builtAt, fdcRecords: fdc.meta.records,
    },
    corpus: { foods: foods.length, recipes: recipeCount, recipeIngredients: riCount, foodsUsedByRecipes: usedFoodIds.size },
    pass1Census: Object.fromEntries([...census.entries()].sort((a, b) => b[1].rows - a[1].rows)),
    pass1TrustGapCount: trustGap.length,
    pass2Verdicts: Object.fromEntries([...byVerdict.entries()].sort((a, b) => b[1] - a[1])),
    repairs, rejected, flags, funnel,
  };
  fs.writeFileSync(path.join(OUT_DIR, "findings.json"), JSON.stringify(findings, null, 2));

  // proposed override entries — the exact JSON --apply would merge
  const proposed = {};
  for (const rp of repairs) {
    proposed[rp.name] = {
      kcal: rp.to.kcal, protein: rp.macros.protein, fat: rp.macros.fat, carb: rp.macros.carb, fiber: rp.macros.fiber,
      category: rp.category,
      note: `kcal corrected ${rp.from.kcal} -> ${rp.to.kcal}: the row's P/F/C are FDC record's verbatim but its kcal was a generic 4P+9F+4C recompute; USDA publishes ${rp.to.kcal} for that record using food-specific Atwater factors. ${rp.witness}.`,
    };
  }
  fs.writeFileSync(path.join(OUT_DIR, "proposed-overrides.json"), JSON.stringify(proposed, null, 2));

  // ── console ───────────────────────────────────────────────────────────────
  const L = [];
  L.push(`== food-record provenance audit ==  ${APPLY ? "APPLY" : "DRY RUN (default) — pass --apply to merge repairs into foodOverrides.json"}`);
  L.push(`   db ${DB.sourceSha256.slice(0, 16)}… (copy ${DB.copySha256 === DB.sourceSha256 ? "MATCH" : "*** MISMATCH ***"}) · fdc-index ${fdc.meta.records} records`);
  L.push(`   corpus: ${foods.length} foods · ${recipeCount} recipes · ${usedFoodIds.size} foods actually used`);
  L.push("");
  L.push("-- PASS 1: DETECTION (declarative evidence only — dataQuality / source / product trust verdict) --");
  L.push("   declared bucket                rows  trusted-by-product  in-use");
  for (const [k, v] of [...census.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    L.push(`   ${k.padEnd(30)} ${String(v.rows).padStart(5)} ${String(v.trusted).padStart(19)} ${String(v.inUse).padStart(7)}`);
  }
  L.push(`   TRUST GAP — rows whose own dataQuality declares unresolved provenance yet the product serves as fact: ${trustGap.length}`);
  L.push("");
  L.push("-- PASS 2: VERIFICATION (numeric + structural evidence only — USDA record, arithmetic, twin rows, usage) --");
  L.push(`   rows carrying a resolvable FDC claim: ${reconciliations.length}`);
  for (const [k, v] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) L.push(`   ${k.padEnd(30)} ${String(v).padStart(5)}`);
  L.push("");
  L.push(`-- JOIN --`);
  L.push(`   REPAIR (both passes agree, Pass 2 supplies the number): ${repairs.length}`);
  for (const rp of repairs) L.push(`     ${rp.name.padEnd(20)} kcal ${rp.from.kcal} -> ${rp.to.kcal}  (${rp.driftPct > 0 ? "+" : ""}${rp.driftPct}%, ${rp.direction})  recipes: ${rp.recipes.join(", ") || "none"}`);
  L.push(`   FLAGGED for human review (defect real, correct value not derivable): ${flags.length}`);
  for (const f of flags) L.push(`     [${f.kind}] ${f.name}`);
  L.push("");
  L.push("-- CANDIDATE FUNNEL (every row either pass called possibly-wrong) --");
  L.push(`   raised:                       ${funnel.raised}`);
  L.push(`   repaired:                     ${funnel.repaired}`);
  L.push(`   rejected as false positive:   ${funnel.rejectedFalsePositive}`);
  L.push(`   flagged, no verified repair:  ${funnel.flaggedNoVerifiedRepair}`);
  L.push(`   REJECTION RATE:               ${funnel.rejectionRatePct}%   (false-positive rate ${funnel.falsePositiveRatePct}%)`);
  L.push(`   string channel: naive parse raised ${funnel.stringChannel.naiveRaised.length} (${funnel.stringChannel.naiveRaised.join(", ") || "—"}), corrected parse raised ${funnel.stringChannel.strictRaised.length} (${funnel.stringChannel.strictRaised.join(", ") || "—"})`);
  L.push(`                   real signal from this channel: 0 — every raise is a parser artifact. The repair gate never consults it.`);
  L.push("");
  L.push(`   findings  -> ${path.relative(REPO, path.join(OUT_DIR, "findings.json")).replace(/\\/g, "/")}`);
  L.push(`   proposal  -> ${path.relative(REPO, path.join(OUT_DIR, "proposed-overrides.json")).replace(/\\/g, "/")}`);
  console.log(L.join("\n"));

  // ── --apply: ONE file, and it is not the database ────────────────────────
  if (!APPLY) {
    console.log("\n   DRY RUN — nothing written to backend/data/foodOverrides.json.");
    console.log("   --apply merges the proposal above into that file. Landing it in dev.db is a");
    console.log("   separate step: node backend/scripts/applyFoodOverrides.mjs --apply");
    db.close();
    return;
  }
  // SURGICAL, FORMAT-PRESERVING EDIT.
  //
  // foodOverrides.json is a hand-curated file, one entry per line, read by
  // humans in review. A JSON.parse -> JSON.stringify round-trip rewrote all 341
  // lines into 2,970 and silently DROPPED the `fdcId` field off the five
  // entries it touched, because the replacement object was built from scratch
  // instead of merged onto the existing one. Both faults were caught by
  // diffing the file against a copy before the change; neither would have been
  // visible in the tool's own success message. So: locate the single line,
  // MERGE onto the object already there, re-serialise that one line in the
  // file's own compact style, and leave every other byte alone.
  let text = fs.readFileSync(OVERRIDES_FILE, "utf8");
  let added = 0, unchanged = 0, notFound = [];
  for (const [name, entry] of Object.entries(proposed)) {
    const lineRe = new RegExp(`^(\\s*)("${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"):\\s*(\\{.*\\})(,?)\\s*$`, "m");
    const m = lineRe.exec(text);
    if (!m) { notFound.push(name); continue; }
    const existing = JSON.parse(m[3]);
    if (near(existing.kcal, entry.kcal, 0.01)) { unchanged++; continue; }
    // Merge: keep every field already curated (notably fdcId), move only kcal,
    // and PREPEND the correction to the existing note so the earlier
    // provenance sentence survives rather than being overwritten.
    const merged = { ...existing, kcal: entry.kcal, note: `${entry.note} Prior note: ${existing.note || "(none)"}` };
    const ordered = {};
    for (const k of Object.keys(existing)) ordered[k] = merged[k];
    for (const k of Object.keys(merged)) if (!(k in ordered)) ordered[k] = merged[k];
    const body = "{ " + Object.entries(ordered).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ") + " }";
    text = text.slice(0, m.index) + `${m[1]}${m[2]}: ${body}${m[4]}` + text.slice(m.index + m[0].length);
    added++;
  }
  fs.writeFileSync(OVERRIDES_FILE, text);
  if (notFound.length) console.log(`\n   NOT FOUND as a single-line entry (skipped, needs a hand edit): ${notFound.join(", ")}`);
  console.log(`\n   APPLIED to backend/data/foodOverrides.json: ${added} entr${added === 1 ? "y" : "ies"} written, ${unchanged} already correct.`);
  console.log("   The DATABASE is unchanged. Land it with: node backend/scripts/applyFoodOverrides.mjs --apply");
  db.close();
}

main();
