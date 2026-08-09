import { CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";

// The lean-mass half of TrendTab's split hero chart (2026-08-09).
//
// Why it is its own panel: lean mass sits 20–30 % below scale weight for every
// user, permanently. Sharing one y-axis with weight therefore forced an axis
// tens of units tall onto two series that each move about one unit a week, and
// both lines went flat. Splitting gives each series an axis sized to its own
// movement. The x-axis is the SAME `xAxis` prop the weight panel gets, so the
// two panels stay in register and the "weight is falling faster than lean mass"
// comparison survives as a vertical read down the page.
//
// Same-data-props rule, as with weight-trend-chart.jsx: `data` is the protected
// `chart` memo untouched, `xAxis` the protected time axis, `leanNow` the
// protected derivation, `tooltip` the untouched <ChartTip/> element built at the
// call site. `yDomain` is TrendTab's `leanDomain`. Zero upstream reshaping and
// nothing computed here.
//
// Verbatim copy of TrendTab's r1 (Rule 4) — the reference-line label must round
// exactly the way every other label on this screen rounds.
const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

// Metric→slot mapping matches the weight panel, so a colour means the same
// thing on both: lean mass (estimated) → --chart-2 (azure); flat references →
// muted. The dash stays reserved for the goal threshold on the weight panel, so
// this reference line is solid.
const chartConfig = {
  lean: { label: "Lean mass (est.)" },
};

export function LeanMassChart({ data, xAxis, yDomain, leanNow, tooltip }) {
  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <ComposedChart accessibilityLayer data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
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

        {leanNow != null && (
          <ReferenceLine y={leanNow} stroke="var(--muted-foreground)" strokeOpacity={0.55}
            label={{ value: `IF IT NEVER MOVED ${r1(leanNow)}`, fill: "var(--muted-foreground)", fontSize: 9, fontWeight: 700, position: "insideTopRight" }} />
        )}

        <Line type="monotone" dataKey="lean" stroke="var(--chart-2)" strokeWidth={2}
          dot={false} activeDot={{ r: 4, fill: "var(--chart-2)", stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false} connectNulls />
      </ComposedChart>
    </ChartContainer>
  );
}
