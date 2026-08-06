import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PricingSection } from "../pricing-section.jsx";

// ── PremiumGate (saas-launch Stage 2) ───────────────────────────────────────
// The locked-decision preview style: render the REAL premium component,
// blurred and inert, with the lock card overlaid. PRESENTATION ONLY — the
// actual gate is requirePremium on the server; anything reachable by hiding
// this overlay in DevTools still gets a 403.
//
// premium=true renders children untouched (no wrapper — grid col-spans on the
// child keep working). Locked: the wrapper carries `className` so a grid
// placement can move onto it (pass the child's col-span classes here too).
//
// Full mode (default) overlays the canonical PricingSection — headline,
// benefits, monthly/annual toggle. `compact` is for smaller regions (a single
// card): a quiet lock note whose CTA hands off to `onUpgrade` (usually "go to
// the Plan tab", where the full card lives).
//
// The blurred children still mount and their API calls still fire — by
// design (the preview is the real thing). Their premium calls 403 into their
// own error states, which sit unreadable behind the blur.

export default function PremiumGate({
  premium,
  children,
  className = "",
  compact = false,
  onUpgrade,
  headline = "Unlock with Premium",
  sub,
  onSelectPlan,
}) {
  if (premium) return children;

  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none select-none blur-md opacity-50" aria-hidden="true" inert={true}>
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto p-4 pt-6">
        {compact ? (
          <Card className="w-full max-w-xs border-border">
            <CardContent className="flex flex-col items-center gap-2.5 py-5 text-center">
              <Lock size={18} className="text-muted-foreground" aria-hidden="true" />
              <div className="text-sm font-bold text-foreground">{headline}</div>
              {sub && <p className="text-xs font-medium text-muted-foreground">{sub}</p>}
              {onUpgrade && (
                <Button size="sm" className="mt-1" onClick={onUpgrade}>
                  See Premium
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="flex w-full max-w-md flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Lock size={15} className="text-muted-foreground" aria-hidden="true" />
              {headline}
            </div>
            <PricingSection headline="One plan. Everything in it." onSelect={onSelectPlan} />
          </div>
        )}
      </div>
    </div>
  );
}
