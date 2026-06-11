"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RiskConfig, StatusPayload } from "@/lib/trading/types";

import { DebugPanel } from "./debug-panel";
import { EquityChart } from "./equity-chart";
import { JournalPanel } from "./journal-panel";
import { Header } from "./header";
import { Positions } from "./positions";
import { RiskPanel } from "./risk-panel";
import { StatCards } from "./stat-cards";
import { TradeLog } from "./trade-log";
import { Watchlist } from "./watchlist";

const POLL_MS = 5_000;

export function Dashboard() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as StatusPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [refresh]);

  const onAction = useCallback(
    async (action: "start" | "stop" | "flatten") => {
      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Action failed");
      setStatus((await res.json()) as StatusPayload);
    },
    []
  );

  const onConfigSaved = useCallback((config: RiskConfig) => {
    setStatus((s) => (s ? { ...s, config } : s));
  }, []);

  if (!status) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
        {error ? (
          <p className="text-loss text-center text-sm">{error}</p>
        ) : null}
      </div>
    );
  }

  const { bot } = status;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
      <Header status={status} onAction={onAction} />

      {bot.haltedReason ? (
        <div className="border-loss/40 bg-loss/10 text-loss flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0" />
          {bot.haltedReason}
        </div>
      ) : null}

      {bot.lastError ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          {bot.lastError}
        </div>
      ) : null}

      {bot.mode === "demo" ? (
        <div className="text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
          <Info className="size-4 shrink-0" />
          Running against the built-in market simulator. Add Alpaca paper keys
          in <code className="text-foreground">.env.local</code> to trade a
          real paper account — see the README.
        </div>
      ) : null}

      <StatCards status={status} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Watchlist
            watchlist={bot.watchlist}
            symbols={status.symbols}
            heldSymbols={status.positions.map((p) => p.symbol)}
            onChanged={() => void refresh()}
          />
          <Positions positions={status.positions} />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <EquityChart curve={bot.equityCurve} />
          <TradeLog log={bot.log} />
        </div>
      </div>

      <Tabs defaultValue="journal">
        <TabsList>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="risk">Risk settings</TabsTrigger>
          <TabsTrigger value="strategy">Strategy</TabsTrigger>
        </TabsList>
        <TabsContent value="journal">
          <JournalPanel />
        </TabsContent>
        <TabsContent value="risk">
          <RiskPanel config={status.config} onSaved={onConfigSaved} />
        </TabsContent>
        <TabsContent value="strategy">
          <StrategyExplainer />
        </TabsContent>
      </Tabs>

      <DebugPanel status={status} />

      <p className="text-muted-foreground pb-2 text-center text-xs">
        Educational software. Markets carry risk — no strategy guarantees
        profits. Validate in simulation and paper trading before considering
        real capital.
      </p>
    </div>
  );
}

function StrategyExplainer() {
  const items = [
    {
      title: "The edge",
      body: "Deeply liquid large caps that get knocked 1.5+ ATRs below session VWAP on a short-term flush (RSI(2) oversold) tend to snap back toward VWAP. The bot waits for the first up bar — never buying a knife mid-fall — then buys the dislocation and sells the reversion.",
    },
    {
      title: "Defined exits, always",
      body: "Every entry is a bracket order: take-profit at VWAP, stop-loss 2.5 ATRs below entry with an absolute floor. Wider stops don't add risk — sizing divides the dollar risk budget by stop distance, so the bot simply buys fewer shares with room to breathe.",
    },
    {
      title: "Regime filters",
      body: "Two layers: no longs in a name trending hard below its 2-hour average, and no new entries at all while SPY itself sits 1.5+ ATRs below its VWAP — a market-wide flush is correlated knives, not a dislocation.",
    },
    {
      title: "Capital protection",
      body: "Fixed fractional sizing (default 0.5% equity risk per trade), max 3 concurrent positions, a daily trade cap, a hard daily loss circuit breaker, and a forced flatten before the close — never hold overnight.",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.title} className="bg-card rounded-xl border p-5">
          <h3 className="mb-1.5 font-semibold">{item.title}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {item.body}
          </p>
        </div>
      ))}
    </div>
  );
}
