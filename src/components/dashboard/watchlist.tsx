"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export function Watchlist({
  watchlist,
  symbols,
  heldSymbols,
  onChanged,
}: {
  watchlist: SymbolSnapshot[];
  symbols: string[];
  heldSymbols: string[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(next: string[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: next }),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(error ?? "Update failed");
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const s = draft.trim().toUpperCase();
    if (!s) return;
    if (symbols.includes(s)) {
      toast(`${s} is already on the watchlist`);
      return;
    }
    if (!/^[A-Z][A-Z.]{0,5}$/.test(s)) {
      toast.error(`"${s}" doesn't look like a ticker`);
      return;
    }
    setDraft("");
    void save([...symbols, s]);
  }

  function remove(symbol: string) {
    if (heldSymbols.includes(symbol)) {
      toast.error(`${symbol} has an open position — flatten it first`);
      return;
    }
    if (symbols.length <= 1) {
      toast.error("Keep at least one symbol on the watchlist");
      return;
    }
    void save(symbols.filter((s) => s !== symbol));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Watchlist</CardTitle>
        <CardDescription>
          Liquid large caps · VWAP reversion signals · {symbols.length}/20
        </CardDescription>
        <CardAction>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              placeholder="Add ticker"
              className="h-8 w-28 uppercase"
              maxLength={6}
              disabled={busy}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={busy || !draft.trim()}
            >
              <Plus /> Add
            </Button>
          </form>
        </CardAction>
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
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {watchlist.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-8 text-center"
                >
                  Waiting for first scan…
                </TableCell>
              </TableRow>
            ) : (
              watchlist.map((snap) => (
                <TableRow key={snap.symbol} className="group">
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
                  <TableCell className="p-0 pr-1 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-loss size-7"
                      aria-label={`Remove ${snap.symbol}`}
                      disabled={busy}
                      onClick={() => remove(snap.symbol)}
                    >
                      <X className="size-3.5" />
                    </Button>
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
