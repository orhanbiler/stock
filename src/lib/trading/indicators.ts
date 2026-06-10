import type { Bar } from "./types";

/** Session VWAP over the provided bars (assumed to start at session open). */
export function vwap(bars: Bar[]): number {
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
  }
  return vol > 0 ? pv / vol : bars.length ? bars[bars.length - 1].c : 0;
}

/** Wilder RSI over closes. Short period (2) makes it a sharp oversold trigger. */
export function rsi(bars: Bar[], period: number): number {
  if (bars.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Wilder ATR. */
export function atr(bars: Bar[], period: number): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const prevClose = bars[i - 1].c;
    trs.push(
      Math.max(b.h - b.l, Math.abs(b.h - prevClose), Math.abs(b.l - prevClose))
    );
  }
  const p = Math.min(period, trs.length);
  let a = trs.slice(0, p).reduce((s, v) => s + v, 0) / p;
  for (let i = p; i < trs.length; i++) {
    a = (a * (p - 1) + trs[i]) / p;
  }
  return a;
}

/** Simple moving average of closes over the last `period` bars. */
export function sma(bars: Bar[], period: number): number {
  if (bars.length === 0) return 0;
  const slice = bars.slice(-period);
  return slice.reduce((s, b) => s + b.c, 0) / slice.length;
}
