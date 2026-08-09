import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

// TrendTab's hero weight chart, extracted under Phase 3's same-data-props
// rule. Every prop is the exact identifier the old inline JSX consumed:
// `data` = the protected `chart` memo, `xAxis`/`yDomain`/`fit` the protected
// axis/fit math, `goalW`/`leanNow`/`bfFrac`/`showDots` the protected
// derivations, `tooltip` = the untouched <ChartTip/> element (it carries
// wUnit/avgDays itself) built at the
// call site (its payload-extraction wiring never moves). Zero upstream
// reshaping. All conditional predicates and data bindings below are moved
// verbatim from TrendTab.
//
// Verbatim copy of TrendTab's r1 (Rule 4) — the original stays in place;
// the reference-line and endpoint labels must round exactly the same way.
const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// Metric→slot mapping (inventory-approved):
//   weight trend / fit / avg + uncertainty band → --chart-1 (mint)
//   daily raw weigh-ins (context)               → muted-foreground
//   lean mass (estimated)                       → --chart-2 (azure)
//   goal / lean references                      → muted; dash = threshold ONLY
const chartConfig = {
  w: { label: "Each weigh-in" },
  avg: { label: "Average" },
  fit: { label: "Trend" },
  lean: { label: "Lean mass (est.)" },
  band: { label: "±1 SE band" },
};

// `leanNow`/`bfFrac` are received and deliberately unused (underscore-renamed
// so the linter agrees it is intentional). The call site still passes them and
// its prop wiring is protected (DO-NOT-TOUCH.md, TrendTab.jsx 457-514), so the
// parameters stay in the signature rather than being removed from both ends.
export function WeightTrendChart({ data, xAxis, yDomain, fit, goalW, leanNow: _leanNow, bfFrac: _bfFrac, showDots, tooltip }) {
  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <ComposedChart accessibilityLayer data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        {/* Solid hairlines. Dashed gridlines read as "projection" or
            "threshold" when they are just a grid — and this chart has a real
            threshold (the goal) that needs the dash to mean something. */}
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          type="number" dataKey="x" scale="linear"
          domain={[xAxis.lo, xAxis.hi]} ticks={xAxis.ticks} tickFormatter={xAxis.fmt}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontWeight: 600 }}
          tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} height={26}
        />
        <YAxis
          domain={[yDomain.lo, yDomain.hi]} allowDecimals={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontWeight: 600 }}
          tickLine={false} axisLine={{ stroke: "var(--border)" }} width={44}
        />
        <Tooltip content={tooltip} cursor={{ stroke: "var(--border)" }} />

        {/* uncertainty cone — the series hue as a ~10% wash */}
        {fit && fit.se != null && (
          <Area type="linear" dataKey="band" stroke="none" fill="var(--chart-1)" fillOpacity={0.12}
            isAnimationActive={false} connectNulls={false} activeDot={false} />
        )}

        {yDomain.goalInView && (
          <ReferenceLine y={goalW} stroke="var(--muted-foreground)" strokeDasharray="6 4"
            label={{ value: `GOAL ${r1(goalW)}`, fill: "var(--muted-foreground)", fontSize: 10, fontWeight: 700, position: "insideBottomRight" }} />
        )}
        {/* MOVED 2026-08-09 → charts/lean-mass-chart.jsx (not deleted).
            The lean-mass Line and its "if it never moved" ReferenceLine used to
            sit here, on this axis. Both now render in the second panel with an
            axis sized to them. They are gone from THIS file only because the
            weight axis no longer spans down to them — leaving them here would
            draw them off the bottom of the plot. `leanNow` and `bfFrac` stay in
            the signature: the call site's prop wiring is protected
            (DO-NOT-TOUCH.md, TrendTab.jsx 457-514) and was not touched. */}

        <Line type="monotone" dataKey="w" stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeWidth={1.5}
          dot={showDots ? { r: 2.5, fill: "var(--muted-foreground)", strokeWidth: 0 } : false}
          activeDot={{ r: 4, fill: "var(--muted-foreground)", stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false} connectNulls />
        {/* The heavy line is the server's fit when there is one, and the
            day-windowed average when there is not — the caption below the
            chart says which, every time. */}
        <Line type={fit ? "linear" : "monotone"} dataKey={fit ? "fit" : "avg"} stroke="var(--chart-1)" strokeWidth={2.5}
          dot={false} activeDot={{ r: 4.5, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false} connectNulls={false} />
        {/* endpoint marker: labelled selectively, never on every point */}
        {fit && (
          <ReferenceDot x={fit.drawEndX} y={fit.at(fit.drawEndX)} r={4.5}
            fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} isFront
            label={{ value: `${r1(fit.at(fit.drawEndX))}`, fill: "var(--foreground)", fontSize: 11, fontWeight: 800, position: "top" }} />
        )}
      </ComposedChart>
    </ChartContainer>
  );
}
