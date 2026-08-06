import { useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ── Pricing section (saas-launch) ───────────────────────────────────────────
// THE one pricing card, used by the PremiumGate lock overlay and any future
// upgrade screen. Prices are the locked business decision — $24.99/mo,
// $125/yr framed as "Save 58% — 5 months free" (~$10.42/mo) — change them
// nowhere else. `onSelect(period)` is the checkout seam: Stage 3 wires it to
// Lemon Squeezy; until then the built-in fallback says so honestly.
// Which-period-shows is purely visual local state.

const PRICING = {
  monthly: { price: "$24.99", period: "/month" },
  annual: { price: "$125", period: "/year", badge: "Save 58%", note: "5 months free — about $10.42/mo" },
};

const FEATURES = [
  "Whole days solved to your targets — real recipes, exact portions",
  "Cook amounts and grocery quantities computed for you",
  "Adaptive targets that re-read your actual burn from weigh-ins",
  "Allergy and diet rules enforced across every plan",
];

export function PricingSection({ headline = "One plan. Everything in it.", onSelect }) {
  const [period, setPeriod] = useState("annual"); // visual state only
  const [note, setNote] = useState(null);
  const p = PRICING[period];

  const choose = () => {
    if (onSelect) return onSelect(period);
    // Stage 3 replaces this via onSelect. Saying "nothing happened" out loud
    // beats a button that silently does nothing.
    setNote("Checkout isn't wired up yet — payments arrive in the next build stage.");
  };

  return (
    <section aria-label="Pricing" className="mx-auto w-full max-w-md">
      <Card className="border-border">
        <CardHeader className="items-center text-center">
          <CardTitle className="font-heading text-xl font-bold tracking-tight">{headline}</CardTitle>
          <Tabs value={period} onValueChange={setPeriod} className="mt-3">
            <TabsList>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="annual">Annual</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-5">
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-5xl font-bold tabular-nums tracking-tight text-foreground">{p.price}</span>
              <span className="text-sm font-semibold text-muted-foreground">{p.period}</span>
              {p.badge && <Badge className="ml-1.5">{p.badge}</Badge>}
            </div>
            {p.note && <p className="text-xs font-semibold text-muted-foreground">{p.note}</p>}
          </div>
          <ul className="w-full space-y-2.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm font-medium text-foreground">
                <Check size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="flex-col gap-2">
          {/* glow-primary: the ONE sanctioned glow, on the primary CTA only. */}
          <Button size="lg" className="w-full glow-primary" onClick={choose}>
            Unlock with Premium
          </Button>
          {note && <p className="text-[11px] font-semibold text-muted-foreground">{note}</p>}
          <p className="text-[11px] font-medium text-muted-foreground">Cancel anytime.</p>
        </CardFooter>
      </Card>
    </section>
  );
}
