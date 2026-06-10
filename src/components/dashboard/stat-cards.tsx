"use client";

import { Activity, DollarSign, Target, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StatusPayload } from "@/lib/trading/types";

import { money, pct, signedMoney } from "./format";

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "gain" | "loss";
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-start justify-between px-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {label}
          </p>
          <p
            className={cn(
              "text-2xl font-semibold tabular-nums",
              tone === "gain" && "text-gain",
              tone === "loss" && "text-loss"
            )}
          >
            {value}
          </p>
          {sub ? (
            <p className="text-muted-foreground text-xs tabular-nums">{sub}</p>
          ) : null}
        </div>
        <div className="bg-muted rounded-md p-2">
          <Icon className="text-muted-foreground size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

export function StatCards({ status }: { status: StatusPayload }) {
  const { account, bot } = status;
  const exits = bot.log.filter(
    (e) => e.symbol !== "system" && e.side === "sell" && e.pnl !== undefined
  );
  const wins = exits.filter((e) => (e.pnl ?? 0) >= 0).length;
  const winRate = exits.length ? (wins / exits.length) * 100 : null;
  const dayTone =
    account.dayPnl > 0 ? "gain" : account.dayPnl < 0 ? "loss" : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        label="Equity"
        value={money(account.equity)}
        sub={`Cash ${money(account.cash)}`}
        icon={DollarSign}
      />
      <Stat
        label="Day P&L"
        value={signedMoney(account.dayPnl)}
        sub={pct(account.dayPnlPct)}
        icon={TrendingUp}
        tone={dayTone}
      />
      <Stat
        label="Win rate"
        value={winRate === null ? "—" : `${winRate.toFixed(0)}%`}
        sub={`${wins}/${exits.length} closed trades`}
        icon={Target}
      />
      <Stat
        label="Trades today"
        value={`${bot.tradesToday} / ${status.config.maxTradesPerDay}`}
        sub={`Realized ${signedMoney(bot.realizedPnlToday)}`}
        icon={Activity}
      />
    </div>
  );
}
