"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RiskConfig } from "@/lib/trading/types";

const FIELDS: Array<{
  key: keyof RiskConfig;
  label: string;
  hint: string;
  step?: number;
}> = [
  {
    key: "riskPerTradePct",
    label: "Risk per trade (%)",
    hint: "Max % of equity lost if a stop hits",
    step: 0.1,
  },
  {
    key: "dailyLossLimitPct",
    label: "Daily loss limit (%)",
    hint: "Circuit breaker — halts the bot for the day",
    step: 0.5,
  },
  {
    key: "maxPositionPct",
    label: "Max position size (%)",
    hint: "Cap on any single position vs equity",
    step: 1,
  },
  {
    key: "maxOpenPositions",
    label: "Max open positions",
    hint: "Concurrent positions allowed",
    step: 1,
  },
  {
    key: "maxTradesPerDay",
    label: "Max trades per day",
    hint: "Hard cap on entries per session",
    step: 1,
  },
  {
    key: "entryDeviationAtr",
    label: "Entry stretch (ATR)",
    hint: "How far below VWAP before buying",
    step: 0.1,
  },
  {
    key: "rsiEntryMax",
    label: "RSI(2) entry max",
    hint: "Require oversold confirmation below this",
    step: 1,
  },
  {
    key: "stopAtrMultiple",
    label: "Stop distance (ATR)",
    hint: "Stop-loss placed this many ATRs below entry",
    step: 0.1,
  },
  {
    key: "minRewardRisk",
    label: "Min reward / risk",
    hint: "Skip setups paying less than this ratio",
    step: 0.1,
  },
];

export function RiskPanel({
  config,
  onSaved,
}: {
  config: RiskConfig;
  onSaved: (c: RiskConfig) => void;
}) {
  const [draft, setDraft] = useState<RiskConfig>(config);
  const [saving, setSaving] = useState(false);

  // Sync the form when the server config actually changes (e.g. clamped on
  // save), without clobbering in-progress edits on every poll.
  const configKey = JSON.stringify(config);
  const [lastConfigKey, setLastConfigKey] = useState(configKey);
  if (configKey !== lastConfigKey) {
    setLastConfigKey(configKey);
    setDraft(config);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved = (await res.json()) as RiskConfig;
      onSaved(saved);
      toast.success("Risk settings saved", {
        description: "Out-of-range values were clamped to safe bounds.",
      });
    } catch {
      toast.error("Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" /> Risk controls
        </CardTitle>
        <CardDescription>
          Every value is clamped to conservative bounds on the server
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              type="number"
              step={f.step ?? 0.1}
              value={draft[f.key]}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  [f.key]: parseFloat(e.target.value),
                }))
              }
            />
            <p className="text-muted-foreground text-xs">{f.hint}</p>
          </div>
        ))}
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </CardFooter>
    </Card>
  );
}
