import { SYMBOLS } from "./config";
import type {
  AccountInfo,
  Bar,
  BotMode,
  BracketOrderRequest,
  Broker,
  Position,
} from "./types";

/**
 * Built-in market simulator so the app is fully functional with zero setup.
 * Prices follow a mean-reverting random walk with occasional liquidity-dip
 * shocks, which gives the VWAP-reversion strategy realistic setups to trade.
 */

const BASE_PRICES: Record<string, number> = {
  SPY: 524.3,
  QQQ: 451.8,
  AAPL: 192.4,
  MSFT: 421.9,
  NVDA: 884.5,
  AMZN: 181.2,
  GOOGL: 166.7,
  META: 482.6,
};

const STARTING_CASH = 100_000;
const MAX_BARS = 390;

interface SimPosition {
  symbol: string;
  qty: number;
  avgEntry: number;
  takeProfit: number;
  stopLoss: number;
}

interface SymbolSim {
  bars: Bar[];
  anchor: number;
  shockUntil: number;
}

export class SimBroker implements Broker {
  readonly mode: BotMode = "demo";
  private sims = new Map<string, SymbolSim>();
  private positions = new Map<string, SimPosition>();
  private cash = STARTING_CASH;
  private dayStartEquity = STARTING_CASH;
  private dayKey = "";
  private lastMinute: number;

  constructor() {
    const now = this.minuteFloor(Date.now());
    this.lastMinute = now;
    for (const symbol of SYMBOLS) {
      const base = BASE_PRICES[symbol] ?? 100;
      const bars: Bar[] = [];
      let price = base;
      for (let i = MAX_BARS - 60; i > 0; i--) {
        const bar = this.nextBar(symbol, price, base, now - i * 60_000);
        bars.push(bar);
        price = bar.c;
      }
      this.sims.set(symbol, { bars, anchor: base, shockUntil: 0 });
    }
    this.rollDayIfNeeded();
  }

  private minuteFloor(t: number): number {
    return Math.floor(t / 60_000) * 60_000;
  }

  private nextBar(
    symbol: string,
    prev: number,
    anchor: number,
    t: number
  ): Bar {
    const sim = this.sims.get(symbol);
    const vol = prev * 0.0006;
    // Mean-revert toward the anchor; anchor itself drifts slowly.
    let drift = (anchor - prev) * 0.02;
    if (sim && t < sim.shockUntil) {
      drift -= vol * 1.6; // sustained dip in progress
    } else if (sim && Math.random() < 0.006) {
      sim.shockUntil = t + 4 * 60_000; // start a 4-minute dip
      drift -= vol * 2;
    }
    const noise = (Math.random() * 2 - 1) * vol;
    const o = prev;
    const c = Math.max(1, prev + drift + noise);
    const wick = vol * (0.5 + Math.random());
    return {
      t,
      o,
      h: Math.max(o, c) + wick,
      l: Math.min(o, c) - wick,
      c,
      v: Math.round(50_000 + Math.random() * 150_000),
    };
  }

  private rollDayIfNeeded() {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayStartEquity = this.equity();
    }
  }

  /** Advance every symbol's walk to the current minute, filling brackets. */
  private advance() {
    this.rollDayIfNeeded();
    const now = this.minuteFloor(Date.now());
    if (now <= this.lastMinute) return;
    const steps = Math.min(MAX_BARS, (now - this.lastMinute) / 60_000);
    for (let i = 1; i <= steps; i++) {
      const t = this.lastMinute + i * 60_000;
      for (const [symbol, sim] of this.sims) {
        sim.anchor += sim.anchor * (Math.random() * 2 - 1) * 0.0002;
        const prev = sim.bars[sim.bars.length - 1].c;
        const bar = this.nextBar(symbol, prev, sim.anchor, t);
        sim.bars.push(bar);
        if (sim.bars.length > MAX_BARS) sim.bars.shift();
        this.fillBrackets(symbol, bar);
      }
    }
    this.lastMinute = now;
  }

  private fillBrackets(symbol: string, bar: Bar) {
    const pos = this.positions.get(symbol);
    if (!pos) return;
    // Conservative fill assumption: if both levels are touched in one bar,
    // assume the stop filled (worst case for us).
    if (bar.l <= pos.stopLoss) {
      this.cash += pos.qty * pos.stopLoss;
      this.positions.delete(symbol);
    } else if (bar.h >= pos.takeProfit) {
      this.cash += pos.qty * pos.takeProfit;
      this.positions.delete(symbol);
    }
  }

  private lastPrice(symbol: string): number {
    const sim = this.sims.get(symbol);
    return sim ? sim.bars[sim.bars.length - 1].c : 0;
  }

  private equity(): number {
    let eq = this.cash;
    for (const pos of this.positions.values()) {
      eq += pos.qty * this.lastPrice(pos.symbol);
    }
    return eq;
  }

  async getAccount(): Promise<AccountInfo> {
    this.advance();
    const equity = this.equity();
    const dayPnl = equity - this.dayStartEquity;
    return {
      equity,
      cash: this.cash,
      buyingPower: this.cash,
      dayPnl,
      dayPnlPct:
        this.dayStartEquity > 0 ? (dayPnl / this.dayStartEquity) * 100 : 0,
    };
  }

  async getPositions(): Promise<Position[]> {
    this.advance();
    return Array.from(this.positions.values()).map((pos) => {
      const price = this.lastPrice(pos.symbol);
      const pnl = (price - pos.avgEntry) * pos.qty;
      return {
        symbol: pos.symbol,
        qty: pos.qty,
        avgEntry: pos.avgEntry,
        currentPrice: price,
        marketValue: price * pos.qty,
        unrealizedPnl: pnl,
        unrealizedPnlPct:
          pos.avgEntry > 0 ? (pnl / (pos.avgEntry * pos.qty)) * 100 : 0,
      };
    });
  }

  async getBars(symbol: string): Promise<Bar[]> {
    this.advance();
    return this.sims.get(symbol)?.bars.slice() ?? [];
  }

  async isMarketOpen(): Promise<boolean> {
    return true; // the simulated market never sleeps
  }

  async submitBracketBuy(req: BracketOrderRequest): Promise<void> {
    this.advance();
    const price = this.lastPrice(req.symbol);
    const cost = price * req.qty;
    if (cost > this.cash) throw new Error("Insufficient simulated cash");
    if (this.positions.has(req.symbol)) {
      throw new Error(`Already holding ${req.symbol}`);
    }
    this.cash -= cost;
    this.positions.set(req.symbol, {
      symbol: req.symbol,
      qty: req.qty,
      avgEntry: price,
      takeProfit: req.takeProfit,
      stopLoss: req.stopLoss,
    });
  }

  async closePosition(symbol: string): Promise<void> {
    this.advance();
    const pos = this.positions.get(symbol);
    if (!pos) return;
    this.cash += pos.qty * this.lastPrice(symbol);
    this.positions.delete(symbol);
  }

  async closeAllPositions(): Promise<void> {
    this.advance();
    for (const symbol of Array.from(this.positions.keys())) {
      await this.closePosition(symbol);
    }
  }
}
