import type { RiskConfig } from "./types";

/**
 * Default universe: deeply liquid, penny-spread large caps, index ETFs, and
 * a few liquid high-beta movers. Liquidity is the first risk control —
 * exits fill instantly at fair prices. Editable in the UI (see watchlist).
 */
export const DEFAULT_SYMBOLS = [
  "SPY",
  "QQQ",
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AMD",
  "INTC",
  "RKLB",
  "NFLX",
  "AVGO",
  "PLTR",
  "MU",
] as const;

export const MAX_WATCHLIST_SYMBOLS = 20;

/** Uppercase, dedupe, validate tickers; clamp list size. */
export function sanitizeSymbols(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().toUpperCase();
    if (/^[A-Z][A-Z.]{0,5}$/.test(s)) seen.add(s);
    if (seen.size >= MAX_WATCHLIST_SYMBOLS) break;
  }
  return seen.size > 0 ? Array.from(seen) : null;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  riskPerTradePct: 0.5,
  maxPositionPct: 10,
  maxOpenPositions: 3,
  maxTradesPerDay: 8,
  dailyLossLimitPct: 2,
  entryDeviationAtr: 1.5,
  rsiEntryMax: 10,
  stopAtrMultiple: 1.0,
  minRewardRisk: 1.2,
};

/** Entry window (ET): skip the chaotic open and the closing auction ramp. */
export const ENTRY_START_MINUTES = 9 * 60 + 45; // 9:45 AM ET
export const ENTRY_END_MINUTES = 15 * 60 + 30; // 3:30 PM ET
/** Hard flatten time — never hold overnight. */
export const FLATTEN_MINUTES = 15 * 60 + 55; // 3:55 PM ET

/** Minutes a symbol sits out after an exit before it may re-enter. */
export const SYMBOL_COOLDOWN_MINUTES = 20;

export const TICK_INTERVAL_MS = 20_000;
export const BARS_LOOKBACK_MINUTES = 390;
export const MAX_LOG_ENTRIES = 200;
export const MAX_EQUITY_POINTS = 500;

export function clampRiskConfig(c: RiskConfig): RiskConfig {
  const clamp = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const d = DEFAULT_RISK_CONFIG;
  return {
    riskPerTradePct: clamp(c.riskPerTradePct, 0.1, 2, d.riskPerTradePct),
    maxPositionPct: clamp(c.maxPositionPct, 1, 25, d.maxPositionPct),
    maxOpenPositions: Math.round(clamp(c.maxOpenPositions, 1, 5, d.maxOpenPositions)),
    maxTradesPerDay: Math.round(clamp(c.maxTradesPerDay, 1, 20, d.maxTradesPerDay)),
    dailyLossLimitPct: clamp(c.dailyLossLimitPct, 0.5, 5, d.dailyLossLimitPct),
    entryDeviationAtr: clamp(c.entryDeviationAtr, 0.5, 4, d.entryDeviationAtr),
    rsiEntryMax: clamp(c.rsiEntryMax, 1, 40, d.rsiEntryMax),
    stopAtrMultiple: clamp(c.stopAtrMultiple, 0.5, 3, d.stopAtrMultiple),
    minRewardRisk: clamp(c.minRewardRisk, 0.5, 5, d.minRewardRisk),
  };
}
