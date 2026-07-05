import type {
  AccountInfo,
  Bar,
  BotMode,
  BracketOrderRequest,
  Broker,
  BrokerFill,
  Position,
} from "./types";

interface AlpacaCreds {
  keyId: string;
  secretKey: string;
  live: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  /**
   * Serverless → Alpaca connections occasionally die mid-flight ("fetch
   * failed") or hit transient 5xx/429s. Retry briefly before surfacing.
   */
  private async fetchWithRetry(
    base: string,
    path: string,
    init?: RequestInit
  ): Promise<Response> {
    const shortPath = path.split("?")[0];
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${base}${path}`, {
          ...init,
          headers: { ...this.headers, ...(init?.headers ?? {}) },
          cache: "no-store",
        });
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < 3) {
          await sleep(attempt * 400);
          continue;
        }
        throw new Error(
          `Alpaca ${shortPath}: network error after ${attempt} attempts (${lastErr})`
        );
      }
      if (res.status >= 500 || res.status === 429) {
        if (attempt < 3) {
          await sleep(attempt * 600);
          continue;
        }
        const body = await res.text().catch(() => "");
        throw new Error(
          `Alpaca ${shortPath} failed (${res.status}: ${body.slice(0, 200)})`
        );
      }
      return res;
    }
    throw new Error(`Alpaca ${shortPath} failed (${lastErr})`);
  }

  private async request<T>(
    base: string,
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const res = await this.fetchWithRetry(base, path, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Alpaca ${path.split("?")[0]} failed (${res.status}): ${body.slice(0, 200)}`
      );
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
    // Deterministic per symbol+minute: if a retry re-sends an order that
    // actually reached Alpaca, the duplicate client_order_id is rejected
    // instead of double-buying.
    const clientOrderId = `quantdesk-${req.symbol}-${Math.floor(Date.now() / 60_000)}`;
    await this.request(this.tradingBase, "/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        client_order_id: clientOrderId,
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

  async getLastExitFill(
    symbol: string,
    sinceMs: number
  ): Promise<{ price: number; time: number } | null> {
    const params = new URLSearchParams({
      status: "closed",
      symbols: symbol,
      limit: "10",
      direction: "desc",
      after: new Date(sinceMs).toISOString(),
    });
    const orders = await this.request<
      Array<{
        side: string;
        filled_avg_price: string | null;
        filled_at: string | null;
      }>
    >(this.tradingBase, `/v2/orders?${params}`);
    const fill = orders.find(
      (o) =>
        o.side === "sell" &&
        o.filled_avg_price &&
        o.filled_at &&
        Date.parse(o.filled_at) >= sinceMs
    );
    if (!fill) return null;
    return {
      price: parseFloat(fill.filled_avg_price as string),
      time: Date.parse(fill.filled_at as string),
    };
  }

  async getClosedFills(afterIso: string): Promise<BrokerFill[]> {
    const params = new URLSearchParams({
      status: "closed",
      limit: "500",
      after: afterIso,
      direction: "asc",
    });
    const orders = await this.request<
      Array<{
        symbol: string;
        side: string;
        filled_qty: string | null;
        filled_avg_price: string | null;
        filled_at: string | null;
      }>
    >(this.tradingBase, `/v2/orders?${params}`);
    return orders
      .filter(
        (o) =>
          o.filled_at &&
          o.filled_avg_price &&
          parseFloat(o.filled_qty ?? "0") > 0 &&
          (o.side === "buy" || o.side === "sell")
      )
      .map((o) => ({
        symbol: o.symbol,
        side: o.side as "buy" | "sell",
        qty: parseFloat(o.filled_qty as string),
        price: parseFloat(o.filled_avg_price as string),
        time: Date.parse(o.filled_at as string),
      }));
  }

  async closePosition(symbol: string): Promise<void> {
    const res = await this.fetchWithRetry(
      this.tradingBase,
      `/v2/positions/${symbol}?cancel_orders=true`,
      { method: "DELETE" }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Alpaca close ${symbol} failed (${res.status})`);
    }
  }

  async closeAllPositions(): Promise<void> {
    const res = await this.fetchWithRetry(
      this.tradingBase,
      `/v2/positions?cancel_orders=true`,
      { method: "DELETE" }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Alpaca close-all failed (${res.status})`);
    }
  }
}
