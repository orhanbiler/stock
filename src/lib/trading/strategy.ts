import { MIN_STOP_PCT } from "./config";
import { atr, rsi, sma, vwap } from "./indicators";
import type { Bar, RiskConfig, SymbolSnapshot } from "./types";

/** Stop distance: ATR-scaled with an absolute floor — never a penny stop. */
export function stopDistanceFor(
  price: number,
  atrValue: number,
  cfg: RiskConfig
): number {
  return Math.max(cfg.stopAtrMultiple * atrValue, price * MIN_STOP_PCT);
}

/**
 * VWAP mean-reversion, long only.
 *
 * Setup: a liquid large-cap gets knocked well below its session VWAP
 * (entryDeviationAtr ATRs or more) while short-term RSI(2) confirms an
 * oversold flush. In deep, liquid names these dislocations tend to snap
 * back toward VWAP. We buy the flush, target VWAP, and stop out one ATR
 * below — every entry is a bracket order, so the exit is defined before
 * the trade exists.
 *
 * Regime filter: no longs while price sits far below its 2-hour average —
 * that is a trend day down, not a dislocation, and we do not catch knives.
 */
export function evaluateSymbol(
  symbol: string,
  bars: Bar[],
  cfg: RiskConfig
): SymbolSnapshot {
  const updatedAt = Date.now();
  if (bars.length < 30) {
    return {
      symbol,
      price: bars.length ? bars[bars.length - 1].c : 0,
      vwap: 0,
      rsi2: 50,
      atr: 0,
      deviationAtr: 0,
      signal: "blocked",
      note: "Warming up (need 30 bars)",
      updatedAt,
    };
  }

  const price = bars[bars.length - 1].c;
  const sessionVwap = vwap(bars);
  const rsi2 = rsi(bars, 2);
  const atr14 = atr(bars, 14);
  const deviationAtr = atr14 > 0 ? (price - sessionVwap) / atr14 : 0;

  const base = {
    symbol,
    price,
    vwap: sessionVwap,
    rsi2,
    atr: atr14,
    deviationAtr,
    updatedAt,
  };

  if (atr14 <= 0) {
    return { ...base, signal: "blocked" as const, note: "No volatility data" };
  }

  const trendFloor = sma(bars, 120) * 0.99;
  if (price < trendFloor) {
    return {
      ...base,
      signal: "blocked" as const,
      note: "Downtrend regime — longs disabled",
    };
  }

  if (deviationAtr > -cfg.entryDeviationAtr) {
    return {
      ...base,
      signal: "none" as const,
      note: `Waiting: ${deviationAtr.toFixed(2)} ATR vs VWAP`,
    };
  }

  if (rsi2 > cfg.rsiEntryMax) {
    return {
      ...base,
      signal: "none" as const,
      note: `Stretched but RSI(2) ${rsi2.toFixed(0)} not oversold`,
    };
  }

  // Wait for the turn: never buy while the knife is still falling. The
  // latest bar must close up before we step in.
  const lastBar = bars[bars.length - 1];
  if (lastBar.c <= lastBar.o) {
    return {
      ...base,
      signal: "none" as const,
      note: `Oversold ${deviationAtr.toFixed(2)} ATR — waiting for an up bar`,
    };
  }

  const risk = stopDistanceFor(price, atr14, cfg);
  const reward = sessionVwap - price;
  if (risk <= 0 || reward / risk < cfg.minRewardRisk) {
    return {
      ...base,
      signal: "none" as const,
      note: `Reward/risk ${(reward / Math.max(risk, 0.0001)).toFixed(2)} below ${cfg.minRewardRisk}`,
    };
  }

  return {
    ...base,
    signal: "long" as const,
    note: `Oversold ${deviationAtr.toFixed(2)} ATR below VWAP, RSI(2) ${rsi2.toFixed(0)}`,
  };
}

/** Target the VWAP itself when it is above price; otherwise a 0.9 ATR pop. */
export function targetFor(
  price: number,
  sessionVwap: number,
  atrValue: number
): number {
  const target = sessionVwap > price ? sessionVwap : price + atrValue * 0.9;
  return round2(target);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
