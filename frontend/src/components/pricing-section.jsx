import { useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ── Pricing section (Phase 5 Part B) ────────────────────────────────────────
// UNMOUNTED by design: this app ships no paywall (Screen Map note), so this is
// a finished presentational artifact awaiting an owner-chosen mount point —
// one line to place it. Which-period-shows is purely visual local state
// (Master Context carve-out). Nothing here touches the network, storage, or
// any store, and nothing may: payments wiring is a later pack.

// PRICING_PLACEHOLDER — display-only values. Real prices/IDs arrive with the
// Stripe pack. Do not wire, compute, or persist anything from these.
const PRICING = {
  monthly: { price: "$14.99", period: "/month" },
  annual: { price: "$119.99", period: "/year", badge: "Save 33%" },
};

// PLACEHOLDER_COPY — owner-editable feature bullets; no product claims made.
const FEATURES = [
  "Solves whole days to your target — real recipes, scaled portions",
  "Adaptive TDEE that re-reads your actual burn from weigh-ins",
  "Allergy and diet rules enforced across every plan",
  "Grocery lists, training scaffold, and honest verdicts",
  "Local-first: your data stays on your machine",
];

export function PricingSection() {
  const [period, setPeriod] = useState("annual"); // visual state only
  const p = PRICING[period];
  return (
    <section aria-label="Pricing" className="mx-auto w-full max-w-md">
      <Card className="border-border">
        <CardHeader className="items-center text-center">
          <CardTitle className="font-heading text-xl font-bold tracking-tight">One plan. Everything in it.</CardTitle>
          <Tabs value={period} onValueChange={setPeriod} className="mt-3">
            <TabsList>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="annual">Annual</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-5">
          <div className="flex items-baseline gap-1.5">
            <span className="font-heading text-5xl font-bold tabular-nums tracking-tight text-foreground">{p.price}</span>
            <span className="text-sm font-semibold text-muted-foreground">{p.period}</span>
            {p.badge && <Badge className="ml-1.5">{p.badge}</Badge>}
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
          {/* TODO(stripe-pack): replace this no-op with Stripe Checkout. Out of
              scope for the restyle pack — polish → Stripe → ship. */}
          {/* glow-primary: the ONE sanctioned glow, on the primary CTA only. */}
          <Button size="lg" className="w-full glow-primary"
            onClick={() => { /* intentionally no-op until the Stripe pack */ }}>
            {/* PLACEHOLDER_COPY — pack default was "Unlock Recomp"; branded to
                match the in-app product name pending the owner's title call. */}
            Unlock Cut Protocol
          </Button>
          <p className="text-[11px] font-medium text-muted-foreground">Cancel anytime. Placeholder pricing — not wired to billing.</p>
        </CardFooter>
      </Card>
    </section>
  );
}
