import { useState, useRef, useEffect, useCallback } from "react";
import { Barcode, Camera, CameraOff, X, Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { C } from "../lib/theme.js";
import { Card, Btn, Chip, Stat, ErrorNote } from "./ui/Parts.jsx";
import { api } from "../lib/api.js";

const g1 = (n) => (n == null ? "—" : Math.round(n * 10) / 10);

// Barcode formats a grocery product actually ships in — narrowing the
// detector's format list cuts false positives from unrelated codes (QR
// codes on packaging, etc.) picked up in the same camera frame.
const BARCODE_FORMATS = ["upc_a", "upc_e", "ean_13", "ean_8"];

const inpStyle = { background: C.card2, border: `1.5px solid ${C.rule}`, color: C.ink };

// Verdict → tone. Green is scarce (law a) and reserved for on-target/
// primary-action/success — a per-lookup "this one's fine" badge is exactly
// the kind of recurring badge use the law rules out, so "pass" gets no
// color at all, just a quiet plain line (silence IS the signal, same as
// every USDA/manual row that's never had a reason to flag itself). "warn"
// is the calm amber every other caution state in this app uses. "reject"
// borrows the system-error red — this is "we refuse to save broken data",
// system/data-integrity UI, not a judgment on food/body data (law b's own
// carve-out, same one ErrorNote uses).
function VerdictBanner({ verdict, issues }) {
  if (verdict === "pass") {
    return (
      <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: C.faint }}>
        <CheckCircle2 size={13} style={{ color: C.faintLight }} />
        Reconciles with the shared fiber-adjusted-Atwater check.
      </div>
    );
  }
  const color = verdict === "reject" ? C.red : C.warn;
  const label = verdict === "reject" ? "Rejected — not imported" : "Flagged — imported anyway, marked unverified";
  return (
    <div className="rounded-xl p-3 flex items-start gap-2.5" style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}>
      <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color }} />
      <div className="min-w-0">
        <div className="text-xs font-extrabold uppercase tracking-wide" style={{ color }}>{label}</div>
        {issues?.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {issues.map((iss, i) => (
              <li key={i} className="text-xs font-medium" style={{ color: C.faint }}>
                {iss.code}: {iss.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Live webcam scanning — BONUS, native-browser only. Uses the built-in
// Shape Detection API (window.BarcodeDetector) already shipped in the
// Electron/Chromium runtime this app runs on: zero new npm dependencies,
// zero cloud service. Feature-detected — if the runtime doesn't have it,
// this whole control just doesn't render and manual entry (the required
// path) is unaffected.
function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
    } catch {
      setError("This browser reports barcode support but couldn't start it.");
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) { onDetected(codes[0].rawValue); return; }
          } catch {
            // a frame the detector couldn't process — just try the next one
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((e) => setError(e.name === "NotAllowedError" ? "Camera permission denied." : `Couldn't open the camera: ${e.message}`));

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-3 rounded-xl overflow-hidden relative" style={{ border: `1px solid ${C.rule}`, background: C.paper }}>
      {error ? (
        <div className="p-4">
          <ErrorNote msg={error} hint="Use manual entry below instead." />
        </div>
      ) : (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="w-full max-h-64 object-cover" muted playsInline />
          <div className="absolute inset-x-0 bottom-0 p-2 text-center text-[10.5px] font-semibold" style={{ color: C.ink, background: "linear-gradient(transparent, rgba(0,0,0,.6))" }}>
            Hold a barcode steady in view
          </div>
        </>
      )}
      <button onClick={onClose} className="absolute top-2 right-2 p-1.5 rounded-lg" style={{ background: "rgba(0,0,0,.5)" }} aria-label="Close camera">
        <X size={14} color="#fff" />
      </button>
    </div>
  );
}

/**
 * Manual UPC entry (the required path) + optional webcam scan (bonus).
 * Two-step flow: look up (preview only, nothing saved) → add (re-validates
 * server-side, saves tagged source:"community"). onImported(food) fires
 * after a successful add OR when the scanned UPC turns out to already be
 * in the library, so the caller can refresh/select it either way.
 */
export default function BarcodeLookup({ onImported, onClose }) {
  const [upc, setUpc] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // lookup-upc response
  const [imported, setImported] = useState(null); // import-upc response, once saved
  const [cameraOpen, setCameraOpen] = useState(false);

  const cameraSupported = typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

  const runLookup = useCallback(async (value) => {
    const code = (value ?? upc).trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setImported(null);
    try {
      const r = await api.lookupUpc(code);
      setResult(r);
    } catch (e) {
      if (e.status === 404) setResult({ found: false, reason: e.body?.reason || "product not found in Open Food Facts" });
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [upc]);

  const handleDetected = (code) => {
    setCameraOpen(false);
    setUpc(code);
    runLookup(code);
  };

  const doImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const r = await api.importUpc(upc.trim());
      setImported(r);
      onImported?.(r.food);
    } catch (e) {
      if (e.status === 422) {
        // server re-validated and rejected — surface the same verdict shape
        setResult((prev) => ({ ...prev, verdict: "reject", issues: e.body?.issues || [], importable: false }));
      } else {
        setError(e.message);
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card section="OPEN FOOD FACTS" title="Add a food by barcode">
      <div className="text-xs font-semibold mb-3" style={{ color: C.faint }}>
        Manual UPC entry looks up real Open Food Facts data. It's crowd-sourced, not audited like the USDA core —
        every result is run through the same fiber-adjusted-Atwater check and stays visibly tagged{" "}
        <b style={{ color: C.ink }}>COMMUNITY</b>, never mixed in as verified.
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Barcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.faintLight }} />
          <input
            type="text" inputMode="numeric" placeholder="UPC / barcode, e.g. 3017620422003"
            value={upc} onChange={(e) => setUpc(e.target.value.replace(/[^\d\s-]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && runLookup()}
            className="w-full text-sm pl-9 pr-3 py-2.5 rounded-xl" style={inpStyle}
          />
        </div>
        <Btn onClick={() => runLookup()} disabled={loading || !upc.trim()} small={false}>
          {loading ? "Looking up…" : "Look up"}
        </Btn>
        {cameraSupported && (
          <Btn kind="ghost" onClick={() => setCameraOpen((v) => !v)}>
            {cameraOpen ? <CameraOff size={14} className="inline mr-1.5" /> : <Camera size={14} className="inline mr-1.5" />}
            {cameraOpen ? "Stop camera" : "Scan with webcam"}
          </Btn>
        )}
        {onClose && <Btn kind="ghost" onClick={onClose}><X size={14} className="inline" /></Btn>}
      </div>

      {cameraOpen && <CameraScanner onDetected={handleDetected} onClose={() => setCameraOpen(false)} />}

      {error && <div className="mt-3"><ErrorNote msg={error} hint="Check the connection and try again — Open Food Facts is a free public API and occasionally rate-limits rapid lookups." /></div>}

      {result && !result.found && (
        <div className="mt-3">
          <ErrorNote msg={`No product found for UPC ${upc.trim()}.`} hint={result.reason || "Open Food Facts doesn't have this barcode yet — you can still add the food manually via Edit on an existing entry, or try a different code."} />
        </div>
      )}

      {result?.alreadyImported && (
        <div className="mt-3 p-3 rounded-xl" style={{ background: C.card2 }}>
          <div className="text-xs font-bold mb-1" style={{ color: C.ink }}>Already in your library</div>
          <div className="text-sm font-bold" style={{ color: C.ink }}>{result.food.name}</div>
          <Chip color={C.faint}>{result.food.source === "community" ? "COMMUNITY (OPEN FOOD FACTS)" : result.food.source}</Chip>
        </div>
      )}

      {result?.found && !result.alreadyImported && !imported && (
        <div className="mt-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-base font-extrabold" style={{ color: C.ink }}>{result.product.name}</div>
              {result.product.brand && <div className="text-xs font-semibold" style={{ color: C.faint }}>{result.product.brand}</div>}
            </div>
            <Chip color={C.faint}>COMMUNITY (OPEN FOOD FACTS)</Chip>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4">
            <Stat label="Calories / 100 g" value={g1(result.candidate.kcal)} unit="kcal" big />
            <Stat label="Protein" value={g1(result.candidate.protein)} unit="g" />
            <Stat label="Fat" value={g1(result.candidate.fat)} unit="g" />
            <Stat label="Carbs" value={g1(result.candidate.carb)} unit="g" />
          </div>

          {result.product.notes?.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {result.product.notes.map((n, i) => (
                <div key={i} className="text-[10.5px] font-medium" style={{ color: C.faintLight }}>· {n}</div>
              ))}
            </div>
          )}

          <div className="mt-3">
            <VerdictBanner verdict={result.verdict} issues={result.issues} />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Btn onClick={doImport} disabled={!result.importable || importing}>
              <Plus size={14} className="inline mr-1" />{importing ? "Adding…" : "Add to food library"}
            </Btn>
            {!result.importable && (
              <span className="text-xs font-semibold" style={{ color: C.faintLight }}>
                Can't be saved until Open Food Facts' own listing has usable numbers.
              </span>
            )}
          </div>
        </div>
      )}

      {imported && (
        // Plain success text, same convention as FoodDetail's save notice —
        // not a persistent badge, a one-time action confirmation (law a's
        // "success" carve-out, not a recurring provenance label).
        <div className="mt-4 text-xs font-semibold flex items-center gap-1.5" style={{ color: C.good }}>
          <CheckCircle2 size={14} />
          Added — tagged COMMUNITY (OPEN FOOD FACTS){imported.verdict === "warn" ? ", flagged unverified" : ""}.
        </div>
      )}
    </Card>
  );
}
