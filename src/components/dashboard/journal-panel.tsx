"use client";

import { useEffect, useState } from "react";
import { ClipboardCopy, Download } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ExitReason, JournalPayload } from "@/lib/trading/types";

import { money, pct, signedMoney } from "./format";

const POLL_MS = 30_000;

const EXIT_BADGE: Record<ExitReason, { label: string; variant: "gain" | "loss" | "secondary" | "outline" }> = {
  target: { label: "target", variant: "gain" },
  stop: { label: "stop", variant: "loss" },
  eod: { label: "EOD", variant: "secondary" },
  manual: { label: "manual", variant: "outline" },
  halt: { label: "halt", variant: "loss" },
};

function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gain" | "loss";
}) {
  return (
    <div className="bg-card rounded-lg border px-4 py-3">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function when(t: number): string {
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Compact plain-text report, made to be pasted into a chat for analysis. */
function buildReport(journal: JournalPayload): string {
  const { stats, trades } = journal;
  const f = (n: number | null | undefined, digits = 2) =>
    n === null || n === undefined ? "—" : n.toFixed(digits);
  const lines: string[] = [];
  lines.push(`QUANTDESK JOURNAL EXPORT — ${new Date().toISOString().slice(0, 16)}Z`);
  lines.push(
    `stats: trades=${stats.totalTrades} (${stats.openTrades} open) | win=${stats.wins} loss=${stats.losses} (${f(stats.winRate, 0)}%) | ` +
      `pnl=$${f(stats.totalPnl)} | pf=${f(stats.profitFactor)} | avgWin=$${f(stats.avgWin)} avgLoss=$${f(stats.avgLoss)} | ` +
      `best=$${f(stats.bestTrade)} worst=$${f(stats.worstTrade)} | avgHold=${stats.avgHoldMinutes ?? "—"}m`
  );
  lines.push("");
  lines.push("by day:");
  for (const d of stats.days) {
    lines.push(`  ${d.dayKey}  pnl=$${d.pnl.toFixed(2)}  ${d.wins}W/${d.losses}L`);
  }
  lines.push("");
  lines.push(
    "trades (newest first): closed | symbol | qty | entry->exit | pnl | hold | setup(devATR/RSI2) | exit-via | mode"
  );
  for (const t of trades) {
    const closed = t.exitTime
      ? new Date(t.exitTime).toISOString().slice(0, 16)
      : "open";
    lines.push(
      `  ${closed} | ${t.symbol} | ${t.qty} | ${t.entryPrice}->${t.exitPrice ?? "?"} | ` +
        `${t.pnl !== undefined ? `$${t.pnl.toFixed(2)} (${t.pnlPct?.toFixed(2)}%)` : "open"} | ` +
        `${t.holdMinutes ?? "?"}m | ${t.deviationAtr.toFixed(2)}/${t.rsi2.toFixed(0)} | ${t.exitReason ?? "open"} | ${t.mode}`
    );
  }
  return lines.join("\n");
}

export function JournalPanel() {
  const [journal, setJournal] = useState<JournalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/journal", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as JournalPayload;
        if (alive) {
          setJournal(data);
          setError(null);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    }
    const initial = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);

  if (!journal) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {error ?? "Loading journal…"}
      </p>
    );
  }

  const { stats, trades } = journal;
  const pnlTone = (n: number | null) =>
    n === null ? undefined : n >= 0 ? "gain" : "loss";

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(buildReport(journal!));
      toast.success("Journal report copied", {
        description: "Paste it into the chat for analysis.",
      });
    } catch {
      toast.error("Clipboard unavailable — use Download instead");
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(journal, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quantdesk-journal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={copyReport}>
          <ClipboardCopy /> Copy report
        </Button>
        <Button variant="outline" size="sm" onClick={downloadJson}>
          <Download /> JSON
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatBox
          label="Total P&L"
          value={signedMoney(stats.totalPnl)}
          tone={pnlTone(stats.totalPnl)}
        />
        <StatBox
          label="Win rate"
          value={stats.winRate === null ? "—" : `${stats.winRate.toFixed(0)}%`}
        />
        <StatBox
          label="Trades"
          value={`${stats.totalTrades}${stats.openTrades ? ` (+${stats.openTrades} open)` : ""}`}
        />
        <StatBox
          label="Profit factor"
          value={
            stats.profitFactor === null
              ? stats.wins > 0 && stats.losses === 0
                ? "∞"
                : "—"
              : stats.profitFactor.toFixed(2)
          }
        />
        <StatBox
          label="Avg win"
          value={stats.avgWin === null ? "—" : signedMoney(stats.avgWin)}
          tone={stats.avgWin === null ? undefined : "gain"}
        />
        <StatBox
          label="Avg loss"
          value={stats.avgLoss === null ? "—" : signedMoney(stats.avgLoss)}
          tone={stats.avgLoss === null ? undefined : "loss"}
        />
        <StatBox
          label="Best / worst"
          value={
            stats.bestTrade === null
              ? "—"
              : `${signedMoney(stats.bestTrade)} / ${signedMoney(stats.worstTrade ?? 0)}`
          }
        />
        <StatBox
          label="Avg hold"
          value={
            stats.avgHoldMinutes === null ? "—" : `${stats.avgHoldMinutes}m`
          }
        />
      </div>

      {stats.days.length > 0 && (
        <div className="bg-card rounded-xl border p-4">
          <h3 className="mb-2 text-sm font-semibold">By day</h3>
          <div className="flex flex-wrap gap-2">
            {stats.days.slice(0, 14).map((d) => (
              <div
                key={d.dayKey}
                className="bg-muted/40 rounded-md border px-3 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">{d.dayKey}</span>{" "}
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    d.pnl >= 0 ? "text-gain" : "text-loss"
                  )}
                >
                  {signedMoney(d.pnl)}
                </span>{" "}
                <span className="text-muted-foreground">
                  ({d.wins}W/{d.losses}L)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Closed</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Exit</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              <TableHead className="hidden text-right md:table-cell">
                Hold
              </TableHead>
              <TableHead className="hidden text-right lg:table-cell">
                Setup
              </TableHead>
              <TableHead>Exit via</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-muted-foreground py-10 text-center"
                >
                  No journaled trades yet — entries will appear here with
                  their full context
                </TableCell>
              </TableRow>
            ) : (
              trades.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground text-xs tabular-nums">
                    {when(t.exitTime ?? t.entryTime)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {t.symbol}
                    {t.mode !== "paper" && t.mode !== "live" ? (
                      <span className="text-muted-foreground ml-1 text-xs">
                        (sim)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.qty}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(t.entryPrice)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.exitPrice !== undefined ? money(t.exitPrice) : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      t.pnl === undefined
                        ? "text-muted-foreground"
                        : t.pnl >= 0
                          ? "text-gain"
                          : "text-loss"
                    )}
                  >
                    {t.pnl !== undefined ? (
                      <>
                        {signedMoney(t.pnl)}{" "}
                        <span className="text-muted-foreground text-xs">
                          {pct(t.pnlPct ?? 0)}
                        </span>
                      </>
                    ) : (
                      "open"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-right text-xs tabular-nums md:table-cell">
                    {t.holdMinutes !== undefined ? `${t.holdMinutes}m` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-right text-xs tabular-nums lg:table-cell">
                    {t.deviationAtr.toFixed(2)} ATR · RSI {t.rsi2.toFixed(0)}
                  </TableCell>
                  <TableCell>
                    {t.exitReason ? (
                      <Badge variant={EXIT_BADGE[t.exitReason].variant}>
                        {EXIT_BADGE[t.exitReason].label}
                      </Badge>
                    ) : (
                      <Badge variant="outline">open</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
