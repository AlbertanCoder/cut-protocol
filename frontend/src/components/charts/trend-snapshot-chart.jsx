import { CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

// Today's trend-snapshot chart, extracted from TodayTab under Phase 3's
// same-data-props rule: `data` IS TodayTab's protected `snapshot` memo,
// yMin/yMax its protected domain math, `goal` = goalDisplay, `unit` = wUnit —
// identical expressions at the call site, zero upstream reshaping (none is
// needed; the memo's shape feeds Recharts directly, exactly as before).
//
// Metric→slot mapping (inventory-approved, keep consistent app-wide):
//   7-day average (the real signal)  → --chart-1 (mint)
//   daily raw weigh-ins (context)    → muted-foreground
//   goal reference                   → muted, dashed (dash = threshold)
const chartConfig = {
  w: { label: "daily", color: "var(--muted-foreground)" },
  a: { label: "7-day avg", color: "var(--chart-1)" },
};

export function TrendSnapshotChart({ data, yMin, yMax, goal, unit }) {
  return (
    <ChartContainer config={chartConfig} className="h-full w-full">
      <ComposedChart accessibilityLayer data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="d" tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontWeight: 600 }} tickLine={false}
          axisLine={{ stroke: "var(--border)" }} minTickGap={28} />
        <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10, fill: "var(--muted-foreground)", fontWeight: 600 }}
          tickLine={false} axisLine={{ stroke: "var(--border)" }} width={52} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex flex-1 items-center justify-between gap-3">
                  <span className="text-muted-foreground">{chartConfig[name]?.label ?? name}</span>
                  <span className="font-medium tabular-nums text-foreground">{value} {unit}</span>
                </div>
              )}
            />
          }
        />
        <ReferenceLine y={goal} stroke="var(--muted-foreground)" strokeDasharray="6 4" />
        <Line type="monotone" dataKey="w" stroke="var(--color-w)" strokeWidth={1.5}
          dot={{ r: 2, fill: "var(--color-w)", strokeWidth: 0 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="a" stroke="var(--color-a)" strokeWidth={2.5}
          dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartContainer>
  );
}
