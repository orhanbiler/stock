"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TradeLogEntry } from "@/lib/trading/types";

import { clock, money, signedMoney } from "./format";

function Row({ entry }: { entry: TradeLogEntry }) {
  const isSystem = entry.symbol === "system";
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="text-muted-foreground w-16 shrink-0 pt-0.5 text-xs tabular-nums">
        {clock(entry.time)}
      </span>
      {isSystem ? (
        <Badge variant="secondary" className="shrink-0">
          system
        </Badge>
      ) : (
        <Badge
          variant={entry.side === "buy" ? "gain" : "loss"}
          className="w-12 shrink-0 justify-center uppercase"
        >
          {entry.side}
        </Badge>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {isSystem ? (
            entry.reason
          ) : (
            <>
              <span className="font-medium">{entry.symbol}</span>{" "}
              <span className="text-muted-foreground">
                {entry.qty} @ {money(entry.price)}
              </span>
            </>
          )}
        </p>
        {!isSystem && (
          <p className="text-muted-foreground truncate text-xs">
            {entry.reason}
          </p>
        )}
      </div>
      {entry.pnl !== undefined && (
        <span
          className={cn(
            "shrink-0 pt-0.5 text-sm tabular-nums",
            entry.pnl >= 0 ? "text-gain" : "text-loss"
          )}
        >
          {signedMoney(entry.pnl)}
        </span>
      )}
    </div>
  );
}

export function TradeLog({ log }: { log: TradeLogEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Orders, fills and system events</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-border max-h-96 divide-y overflow-y-auto pr-1">
          {log.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No activity yet — start the bot to begin scanning
            </p>
          ) : (
            log.map((entry) => <Row key={entry.id} entry={entry} />)
          )}
        </div>
      </CardContent>
    </Card>
  );
}
