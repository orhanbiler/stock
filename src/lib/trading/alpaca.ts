import type {
  AccountInfo,
  Bar,
  BotMode,
  BracketOrderRequest,
  Broker,
  Position,
} from "./types";

interface AlpacaCreds {
  keyId: string;
  secretKey: string;
  live: boolean;
}

export function getAlpacaCreds(): AlpacaCreds | null {
  const keyId = process.env.ALPACA_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) return null;
  // Live trading requires an explicit, deliberate opt-in.
  const live = process.env.ALPACA_LIVE_TRADING === "I_UNDERSTAND_THE_RISKS";
  return { keyId, secretKey, live };
}

export class AlpacaBroker implements Broker {
  readonly mode: BotMode;
  private tradingBase: string;
  private dataBase = "https://data.alpaca.markets";
  private headers: Record<string, string>;

  constructor(creds: AlpacaCreds) {
    this.mode = creds.live ? "live" : "paper";
    this.tradingBase = creds.live
      ? "https://api.alpaca.markets"
      : "https://paper-api.alpaca.markets";
    this.headers = {
      "APCA-API-KEY-ID": creds.keyId,
      "APCA-API-SECRET-KEY": creds.secretKey,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    base: string,
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Alpaca ${path} failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getAccount(): Promise<AccountInfo> {
    const a = await this.request<{
      equity: string;
      cash: string;
      buying_power: string;
      last_equity: string;
    }>(this.tradingBase, "/v2/account");
    const equity = parseFloat(a.equity);
    const lastEquity = parseFloat(a.last_equity);
    const dayPnl = equity - lastEquity;
    return {
      equity,
      cash: parseFloat(a.cash),
      buyingPower: parseFloat(a.buying_power),
      dayPnl,
      dayPnlPct: lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0,
    };
  }

  async getPositions(): Promise<Position[]> {
    const raw = await this.request<
      Array<{
        symbol: string;
        qty: string;
        avg_entry_price: string;
        current_price: string;
        market_value: string;
        unrealized_pl: string;
        unrealized_plpc: string;
      }>
    >(this.tradingBase, "/v2/positions");
    return raw.map((p) => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      avgEntry: parseFloat(p.avg_entry_price),
      currentPrice: parseFloat(p.current_price),
      marketValue: parseFloat(p.market_value),
      unrealizedPnl: parseFloat(p.unrealized_pl),
      unrealizedPnlPct: parseFloat(p.unrealized_plpc) * 100,
    }));
  }

  async getBars(symbol: string, lookbackMinutes: number): Promise<Bar[]> {
    const start = new Date(
      Date.now() - lookbackMinutes * 60_000
    ).toISOString();
    const params = new URLSearchParams({
      timeframe: "1Min",
      start,
      limit: "1000",
      adjustment: "raw",
      feed: "iex",
      sort: "asc",
    });
    const data = await this.request<{
      bars: Array<{
        t: string;
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
      }> | null;
    }>(this.dataBase, `/v2/stocks/${symbol}/bars?${params}`);
    return (data.bars ?? []).map((b) => ({
      t: Date.parse(b.t),
      o: b.o,
      h: b.h,
      l: b.l,
      c: b.c,
      v: b.v,
    }));
  }

  async isMarketOpen(): Promise<boolean> {
    const clock = await this.request<{ is_open: boolean }>(
      this.tradingBase,
      "/v2/clock"
    );
    return clock.is_open;
  }

  async submitBracketBuy(req: BracketOrderRequest): Promise<void> {
    await this.request(this.tradingBase, "/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: req.symbol,
        qty: String(req.qty),
        side: "buy",
        type: "market",
        time_in_force: "day",
        order_class: "bracket",
        take_profit: { limit_price: req.takeProfit.toFixed(2) },
        stop_loss: { stop_price: req.stopLoss.toFixed(2) },
      }),
    });
  }

  async closePosition(symbol: string): Promise<void> {
    const res = await fetch(
      `${this.tradingBase}/v2/positions/${symbol}?cancel_orders=true`,
      { method: "DELETE", headers: this.headers, cache: "no-store" }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Alpaca close ${symbol} failed (${res.status})`);
    }
  }

  async closeAllPositions(): Promise<void> {
    const res = await fetch(
      `${this.tradingBase}/v2/positions?cancel_orders=true`,
      { method: "DELETE", headers: this.headers, cache: "no-store" }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Alpaca close-all failed (${res.status})`);
    }
  }
}
