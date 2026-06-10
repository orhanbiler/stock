"use client";

import { Badge } from "@/components/ui/badge";
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
import type { SymbolSnapshot } from "@/lib/trading/types";

import { money } from "./format";

function SignalBadge({ snap }: { snap: SymbolSnapshot }) {
  if (snap.signal === "long") {
    return <Badge variant="gain">Buy setup</Badge>;
  }
  if (snap.signal === "blocked") {
    return <Badge variant="secondary">Filtered</Badge>;
  }
  return <Badge variant="outline">Watching</Badge>;
}

export function Watchlist({ watchlist }: { watchlist: SymbolSnapshot[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watchlist</CardTitle>
        <CardDescription>
          Liquid large caps · VWAP reversion signals
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">VWAP</TableHead>
              <TableHead className="text-right">Dev (ATR)</TableHead>
              <TableHead className="text-right">RSI(2)</TableHead>
              <TableHead>Signal</TableHead>
              <TableHead className="hidden lg:table-cell">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {watchlist.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground py-8 text-center"
                >
                  Waiting for first scan…
                </TableCell>
              </TableRow>
            ) : (
              watchlist.map((snap) => (
                <TableRow key={snap.symbol}>
                  <TableCell className="font-medium">{snap.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {snap.price ? money(snap.price) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {snap.vwap ? money(snap.vwap) : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      snap.deviationAtr <= -1.5 && "text-gain",
                      snap.deviationAtr >= 1.5 && "text-loss"
                    )}
                  >
                    {snap.deviationAtr.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {snap.rsi2.toFixed(0)}
                  </TableCell>
                  <TableCell>
                    <SignalBadge snap={snap} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-64 truncate text-xs lg:table-cell">
                    {snap.note}
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
