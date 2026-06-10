"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EquityPoint } from "@/lib/trading/types";

import { clock, money } from "./format";

export function EquityChart({ curve }: { curve: EquityPoint[] }) {
  const data = curve.map((p) => ({ ...p, label: clock(p.t) }));
  const rising =
    data.length > 1 ? data[data.length - 1].equity >= data[0].equity : true;
  const color = rising ? "var(--gain)" : "var(--loss)";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Equity</CardTitle>
        <CardDescription>Account value this session</CardDescription>
      </CardHeader>
      <CardContent className="h-44">
        {data.length < 2 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Collecting data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={["dataMin", "dataMax"]} hide />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="bg-popover text-popover-foreground rounded-md border px-2 py-1 text-xs shadow-md">
                      <div className="tabular-nums">
                        {money(payload[0].payload.equity)}
                      </div>
                      <div className="text-muted-foreground">
                        {payload[0].payload.label}
                      </div>
                    </div>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke={color}
                strokeWidth={1.5}
                fill="url(#equityFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
