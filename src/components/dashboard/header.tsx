"use client";

import { useState } from "react";
import { CircleStop, OctagonX, Play } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { StatusPayload } from "@/lib/trading/types";

const MODE_LABEL: Record<string, { label: string; className: string }> = {
  demo: {
    label: "SIMULATION",
    className: "bg-sky-500/15 text-sky-400 border-transparent",
  },
  paper: {
    label: "PAPER",
    className: "bg-amber-500/15 text-amber-400 border-transparent",
  },
  live: {
    label: "LIVE",
    className: "bg-red-500/15 text-red-400 border-transparent",
  },
};

export function Header({
  status,
  onAction,
}: {
  status: StatusPayload;
  onAction: (action: "start" | "stop" | "flatten") => Promise<void>;
}) {
  const { bot } = status;
  const mode = MODE_LABEL[bot.mode] ?? MODE_LABEL.demo;
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(action: "start" | "stop" | "flatten") {
    setBusy(true);
    try {
      await onAction(action);
      if (action === "start") toast.success("Bot started");
      if (action === "stop") toast("Bot stopped — no new entries");
      if (action === "flatten") toast("All positions closed");
    } catch {
      toast.error("Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg text-sm font-bold">
          Q
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">QuantDesk</h1>
          <p className="text-muted-foreground text-xs">
            VWAP reversion · liquid large caps · risk-first
          </p>
        </div>
        <Badge className={cn("ml-2", mode.className)}>{mode.label}</Badge>
        <Badge variant={bot.marketOpen ? "gain" : "secondary"}>
          {bot.marketOpen ? "Market open" : "Market closed"}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            "mr-1 flex items-center gap-1.5 text-sm",
            bot.running ? "text-gain" : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              bot.running ? "bg-gain animate-pulse" : "bg-muted-foreground/40"
            )}
          />
          {bot.running ? "Running" : "Stopped"}
        </span>
        {bot.running ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => act("stop")}
          >
            <CircleStop /> Stop
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => act("start")}>
            <Play /> Start bot
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => setConfirmFlatten(true)}
        >
          <OctagonX /> Flatten
        </Button>
      </div>

      <Dialog open={confirmFlatten} onOpenChange={setConfirmFlatten}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close all positions?</DialogTitle>
            <DialogDescription>
              This stops the bot and immediately market-closes every open
              position, cancelling their brackets.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmFlatten(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmFlatten(false);
                void act("flatten");
              }}
            >
              Flatten everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
