"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Position } from "@/lib/trading/types";

import { money, pct, signedMoney } from "./format";

export function Positions({ positions }: { positions: Position[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open positions</CardTitle>
        <CardDescription>
          Every position carries a bracket: stop-loss and take-profit
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Now</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground py-8 text-center"
                >
                  Flat — no open positions
                </TableCell>
              </TableRow>
            ) : (
              positions.map((p) => (
                <TableRow key={p.symbol}>
                  <TableCell className="font-medium">{p.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.qty}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(p.avgEntry)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(p.currentPrice)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(p.marketValue)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      p.unrealizedPnl >= 0 ? "text-gain" : "text-loss"
                    )}
                  >
                    {signedMoney(p.unrealizedPnl)}{" "}
                    <span className="text-muted-foreground text-xs">
                      {pct(p.unrealizedPnlPct)}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
