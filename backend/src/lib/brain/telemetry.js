// Brain v3 — telemetry / provenance-lint (LAW 3). Every displayed number must
// carry prov {formulaId, inputs, value}. provenanceLint walks a result and
// returns the paths of any value-envelope that lacks valid prov — CI FAILS on a
// non-empty result, so an untraceable number can't ship.
function validProv(p) {
  return !!p && typeof p === "object" && typeof p.formulaId === "string" && "inputs" in p && "value" in p;
}

// Any object that declares a `value` field is a displayed-number envelope and
// MUST carry a sibling valid `prov`. Recurses into containers (skipping the prov
// subtree so prov.value isn't itself required to carry prov). Returns [] = clean.
function provenanceLint(node, path = "$", offenders = []) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => provenanceLint(n, `${path}[${i}]`, offenders));
  } else if (node && typeof node === "object") {
    if ("value" in node && !validProv(node.prov)) offenders.push(path);
    for (const [k, v] of Object.entries(node)) {
      if (k === "prov") continue;
      if (v && typeof v === "object") provenanceLint(v, `${path}.${k}`, offenders);
    }
  }
  return offenders;
}

// Attach a usage/cost telemetry envelope to a brain result (non-mutating).
function withTelemetry(result, telemetry) {
  return { ...result, _telemetry: telemetry };
}

module.exports = { validProv, provenanceLint, withTelemetry };
