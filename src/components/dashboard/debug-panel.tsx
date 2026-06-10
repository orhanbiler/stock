"use client";

import { useState } from "react";
import { Bug, ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DebugInfo, StatusPayload } from "@/lib/trading/types";

import { clock } from "./format";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      <p className="truncate font-mono text-sm">{value}</p>
    </div>
  );
}

function traceTone(line: string): string {
  if (line.includes("ERROR") || line.includes("CIRCUIT BREAKER")) {
    return "text-loss";
  }
  if (line.includes("ENTRY ")) return "text-gain";
  if (line.includes("exit detected")) return "text-amber-400";
  if (line.includes("skip ")) return "text-sky-400/80";
  return "text-muted-foreground";
}

export function DebugPanel({ status }: { status: StatusPayload }) {
  const [open, setOpen] = useState(true);
  const { bot } = status;
  const debug: DebugInfo = status.debug;
  const lastTickAt = bot.lastTick ? clock(bot.lastTick) : "never";

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="size-4" /> Debug
          <Badge variant="secondary" className="font-mono">
            tick #{debug.tickCount}
          </Badge>
        </CardTitle>
        <CardDescription>
          Live engine trace — every decision the bot makes, and why
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            aria-label={open ? "Collapse debug" : "Expand debug"}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>
        </CardAction>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
            <Field
              label="Broker"
              value={
                <span className="uppercase">{bot.mode}</span>
              }
            />
            <Field
              label="API keys"
              value={
                debug.keysDetected ? (
                  <span className="text-gain">detected</span>
                ) : (
                  <span className="text-amber-400">not set</span>
                )
              }
            />
            <Field
              label="Push alerts"
              value={
                debug.pushConfigured ? (
                  <span className="text-gain">configured</span>
                ) : (
                  <span className="text-muted-foreground">off</span>
                )
              }
            />
            <Field label="Endpoint" value={debug.endpoint} />
            <Field label="Data feed" value={debug.dataFeed} />
            <Field
              label="Last tick"
              value={`${lastTickAt} (${debug.lastTickDurationMs}ms)`}
            />
            <Field
              label="Entries"
              value={
                debug.entriesBlockedReason ? (
                  <span className="text-amber-400">
                    {debug.entriesBlockedReason}
                  </span>
                ) : (
                  <span className="text-gain">allowed</span>
                )
              }
            />
          </div>

          <div className="bg-black/40 max-h-72 overflow-y-auto rounded-lg border p-3">
            {debug.trace.length === 0 ? (
              <p className="text-muted-foreground font-mono text-xs">
                No trace yet — waiting for the first tick…
              </p>
            ) : (
              debug.trace.map((line, i) => (
                <p
                  key={`${i}-${line.slice(0, 24)}`}
                  className={cn(
                    "font-mono text-xs leading-5 whitespace-pre-wrap break-all",
                    traceTone(line)
                  )}
                >
                  {line}
                </p>
              ))
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
