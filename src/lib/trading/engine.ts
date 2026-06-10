import { AlpacaBroker, getAlpacaCreds } from "./alpaca";
import {
  BARS_LOOKBACK_MINUTES,
  clampRiskConfig,
  DEFAULT_RISK_CONFIG,
  ENTRY_END_MINUTES,
  ENTRY_START_MINUTES,
  FLATTEN_MINUTES,
  MAX_EQUITY_POINTS,
  MAX_LOG_ENTRIES,
  SYMBOL_COOLDOWN_MINUTES,
  SYMBOLS,
  TICK_INTERVAL_MS,
} from "./config";
import { SimBroker } from "./sim";
import { readJson, writeJson } from "./store";
import { evaluateSymbol, round2, targetFor } from "./strategy";
import type {
  AccountInfo,
  BotState,
  Broker,
  DebugInfo,
  Position,
  RiskConfig,
  StatusPayload,
  TradeLogEntry,
} from "./types";

const MAX_TRACE_LINES = 150;

const STATE_FILE = "bot-state.json";
const CONFIG_FILE = "risk-config.json";

interface PersistedState {
  dayKey: string;
  tradesToday: number;
  realizedPnlToday: number;
  startEquityToday: number;
  haltedReason: string | null;
  log: TradeLogEntry[];
  equityCurve: BotState["equityCurve"];
}

function etParts(): { minutes: number; dayKey: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return {
    minutes: (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10),
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

class TradingEngine {
  private broker: Broker;
  private config: RiskConfig;
  private state: BotState;
  private dayKey: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private lastPositions = new Map<string, Position>();
  private cooldownUntil = new Map<string, number>();
  private account: AccountInfo = {
    equity: 0,
    cash: 0,
    buyingPower: 0,
    dayPnl: 0,
    dayPnlPct: 0,
  };
  private positions: Position[] = [];
  private traceBuf: string[] = [];
  private tickCount = 0;
  private lastTickDurationMs = 0;
  private keysDetected: boolean;
  private endpoint: string;
  private dataFeed: string;

  constructor() {
    const creds = getAlpacaCreds();
    this.broker = creds ? new AlpacaBroker(creds) : new SimBroker();
    this.keysDetected = creds !== null;
    this.endpoint = creds
      ? creds.live
        ? "https://api.alpaca.markets"
        : "https://paper-api.alpaca.markets"
      : "built-in simulator";
    this.dataFeed = creds
      ? "Alpaca IEX 1-min bars"
      : "synthetic 1-min random walk";
    this.trace(
      `engine boot — mode=${this.broker.mode}, keys ${creds ? "detected" : "absent"}, endpoint=${this.endpoint}`
    );

    this.config = clampRiskConfig(
      readJson<RiskConfig>(CONFIG_FILE) ?? DEFAULT_RISK_CONFIG
    );

    const persisted = readJson<PersistedState>(STATE_FILE);
    const { dayKey } = etParts();
    const sameDay = persisted?.dayKey === dayKey;
    this.dayKey = dayKey;
    this.state = {
      running: false,
      mode: this.broker.mode,
      marketOpen: false,
      haltedReason: sameDay ? (persisted?.haltedReason ?? null) : null,
      lastError: null,
      tradesToday: sameDay ? (persisted?.tradesToday ?? 0) : 0,
      realizedPnlToday: sameDay ? (persisted?.realizedPnlToday ?? 0) : 0,
      startEquityToday: sameDay ? (persisted?.startEquityToday ?? 0) : 0,
      lastTick: null,
      watchlist: [],
      log: persisted?.log ?? [],
      equityCurve: persisted?.equityCurve ?? [],
    };
  }

  private trace(msg: string) {
    const ts = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      timeZone: "America/New_York",
    });
    this.traceBuf.unshift(`[${ts} ET] ${msg}`);
    if (this.traceBuf.length > MAX_TRACE_LINES) {
      this.traceBuf.length = MAX_TRACE_LINES;
    }
  }

  getConfig(): RiskConfig {
    return this.config;
  }

  setConfig(next: RiskConfig): RiskConfig {
    this.config = clampRiskConfig(next);
    writeJson(CONFIG_FILE, this.config);
    return this.config;
  }

  start(): void {
    if (this.state.running) return;
    this.state.running = true;
    this.state.haltedReason = null;
    this.log("system", "buy", 0, 0, "Bot started — entries enabled");
    this.trace("bot started by user");
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tick();
      }, TICK_INTERVAL_MS);
    }
    void this.tick();
  }

  stop(): void {
    if (!this.state.running) return;
    this.state.running = false;
    this.log("system", "sell", 0, 0, "Bot stopped — no new entries");
    this.trace("bot stopped by user");
    this.persist();
  }

  async flattenAll(reason: string): Promise<void> {
    if (this.positions.length === 0) return;
    this.trace(`manual flatten: closing ${this.positions.length} position(s)`);
    await this.broker.closeAllPositions();
    this.log("system", "sell", 0, 0, reason);
    await this.refreshPortfolio();
    this.persist();
  }

  /** Refresh on demand for the dashboard, even while the bot is stopped. */
  async tickIfStale(maxAgeMs = 5_000): Promise<void> {
    if (this.state.lastTick && Date.now() - this.state.lastTick < maxAgeMs) {
      return;
    }
    await this.tick();
  }

  async getStatus(): Promise<StatusPayload> {
    await this.tickIfStale();
    const debug: DebugInfo = {
      keysDetected: this.keysDetected,
      endpoint: this.endpoint,
      dataFeed: this.dataFeed,
      tickCount: this.tickCount,
      lastTickDurationMs: this.lastTickDurationMs,
      entriesBlockedReason: this.entriesAllowed(),
      trace: [...this.traceBuf],
    };
    return {
      account: this.account,
      positions: this.positions,
      bot: this.state,
      symbols: [...SYMBOLS],
      config: this.config,
      debug,
    };
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const t0 = Date.now();
    this.tickCount += 1;
    try {
      this.rollDayIfNeeded();
      this.state.marketOpen = await this.broker.isMarketOpen();
      await this.refreshPortfolio();
      this.detectExits();
      this.enforceCircuitBreakers();
      await this.endOfDayFlatten();
      await this.refreshWatchlist();
      await this.maybeEnter();
      this.recordEquity();
      this.state.lastError = null;
      const signals = this.state.watchlist
        .filter((w) => w.signal === "long")
        .map((w) => w.symbol);
      const held = this.positions.map((p) => p.symbol);
      const blocked = this.entriesAllowed();
      this.trace(
        `tick #${this.tickCount}: market=${this.state.marketOpen ? "open" : "closed"} ` +
          `equity=$${this.account.equity.toFixed(0)} ` +
          `positions=${held.length ? held.join(",") : "none"} ` +
          `signals=${signals.length ? signals.join(",") : "none"} ` +
          `entries=${blocked ?? "ALLOWED"}`
      );
    } catch (err) {
      this.state.lastError = err instanceof Error ? err.message : String(err);
      this.trace(`ERROR tick #${this.tickCount}: ${this.state.lastError}`);
    } finally {
      this.lastTickDurationMs = Date.now() - t0;
      this.state.lastTick = Date.now();
      this.persist();
      this.ticking = false;
    }
  }

  private rollDayIfNeeded() {
    const { dayKey } = etParts();
    if (dayKey === this.dayKey) return;
    this.dayKey = dayKey;
    this.state.tradesToday = 0;
    this.state.realizedPnlToday = 0;
    this.state.startEquityToday = 0;
    if (this.state.haltedReason?.startsWith("Daily loss limit")) {
      this.state.haltedReason = null; // fresh day, fresh limit
    }
    this.cooldownUntil.clear();
  }

  private async refreshPortfolio() {
    const [account, positions] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getPositions(),
    ]);
    this.account = account;
    this.positions = positions;
    if (!this.state.startEquityToday) {
      this.state.startEquityToday = account.equity - account.dayPnl;
    }
  }

  /** A position that vanished since last tick was closed by its bracket. */
  private detectExits() {
    const current = new Set(this.positions.map((p) => p.symbol));
    for (const [symbol, prev] of this.lastPositions) {
      if (current.has(symbol)) continue;
      const snap = this.state.watchlist.find((w) => w.symbol === symbol);
      const exitPrice = snap?.price ?? prev.currentPrice;
      const pnl = round2((exitPrice - prev.avgEntry) * prev.qty);
      this.state.realizedPnlToday = round2(
        this.state.realizedPnlToday + pnl
      );
      this.cooldownUntil.set(
        symbol,
        Date.now() + SYMBOL_COOLDOWN_MINUTES * 60_000
      );
      this.log(
        symbol,
        "sell",
        prev.qty,
        exitPrice,
        pnl >= 0 ? "Take-profit / exit filled" : "Stop-loss filled",
        pnl
      );
      this.trace(
        `exit detected: ${symbol} ${prev.qty} @ ~$${exitPrice.toFixed(2)} pnl≈$${pnl.toFixed(2)} — cooldown ${SYMBOL_COOLDOWN_MINUTES}m`
      );
    }
    this.lastPositions = new Map(this.positions.map((p) => [p.symbol, p]));
  }

  /** The non-negotiable daily loss circuit breaker. */
  private enforceCircuitBreakers() {
    if (this.state.haltedReason) return;
    const start = this.state.startEquityToday;
    if (start <= 0) return;
    const dayLossPct = ((this.account.equity - start) / start) * 100;
    if (dayLossPct <= -this.config.dailyLossLimitPct) {
      this.state.haltedReason = `Daily loss limit hit (${dayLossPct.toFixed(2)}%) — trading halted until tomorrow`;
      this.state.running = false;
      void this.broker.closeAllPositions();
      this.log("system", "sell", 0, 0, this.state.haltedReason);
      this.trace(`CIRCUIT BREAKER: ${this.state.haltedReason}`);
    }
  }

  private async endOfDayFlatten() {
    if (this.broker.mode === "demo") return; // simulator has no close
    const { minutes } = etParts();
    if (
      this.state.marketOpen &&
      minutes >= FLATTEN_MINUTES &&
      this.positions.length > 0
    ) {
      await this.broker.closeAllPositions();
      this.log("system", "sell", 0, 0, "End of day — flattened all positions");
      this.trace("end-of-day flatten executed (15:55 ET)");
    }
  }

  private async refreshWatchlist() {
    const snapshots = await Promise.all(
      SYMBOLS.map(async (symbol) => {
        try {
          const bars = await this.broker.getBars(
            symbol,
            BARS_LOOKBACK_MINUTES
          );
          return evaluateSymbol(symbol, bars, this.config);
        } catch (err) {
          return {
            symbol,
            price: 0,
            vwap: 0,
            rsi2: 50,
            atr: 0,
            deviationAtr: 0,
            signal: "blocked" as const,
            note: err instanceof Error ? err.message : "data error",
            updatedAt: Date.now(),
          };
        }
      })
    );
    this.state.watchlist = snapshots;
  }

  private entriesAllowed(): string | null {
    if (!this.state.running) return "Bot stopped";
    if (this.state.haltedReason) return this.state.haltedReason;
    if (!this.state.marketOpen) return "Market closed";
    if (this.broker.mode !== "demo") {
      const { minutes } = etParts();
      if (minutes < ENTRY_START_MINUTES) return "Before entry window (9:45 ET)";
      if (minutes > ENTRY_END_MINUTES) return "After entry window (15:30 ET)";
    }
    if (this.state.tradesToday >= this.config.maxTradesPerDay) {
      return "Daily trade cap reached";
    }
    return null;
  }

  private async maybeEnter() {
    if (this.entriesAllowed() !== null) return;
    const held = new Set(this.positions.map((p) => p.symbol));
    let openCount = this.positions.length;

    for (const snap of this.state.watchlist) {
      if (snap.signal !== "long") continue;
      if (openCount >= this.config.maxOpenPositions) {
        this.trace(
          `skip ${snap.symbol}: max open positions (${this.config.maxOpenPositions}) reached`
        );
        break;
      }
      if (this.state.tradesToday >= this.config.maxTradesPerDay) break;
      if (held.has(snap.symbol)) {
        this.trace(`skip ${snap.symbol}: already holding`);
        continue;
      }
      const cooldown = this.cooldownUntil.get(snap.symbol);
      if (cooldown && Date.now() < cooldown) {
        this.trace(
          `skip ${snap.symbol}: cooldown ${Math.ceil((cooldown - Date.now()) / 60_000)}m remaining`
        );
        continue;
      }

      const stopLoss = round2(
        snap.price - this.config.stopAtrMultiple * snap.atr
      );
      const takeProfit = targetFor(snap.price, snap.vwap, snap.atr);
      const riskPerShare = snap.price - stopLoss;
      if (riskPerShare <= 0 || takeProfit <= snap.price) continue;

      // Position sizing: risk a fixed sliver of equity, then apply caps.
      const riskBudget =
        this.account.equity * (this.config.riskPerTradePct / 100);
      const maxValue =
        this.account.equity * (this.config.maxPositionPct / 100);
      const qty = Math.floor(
        Math.min(
          riskBudget / riskPerShare,
          maxValue / snap.price,
          this.account.buyingPower / snap.price
        )
      );
      if (qty < 1) {
        this.trace(
          `skip ${snap.symbol}: sized to 0 shares (risk budget $${riskBudget.toFixed(0)}, $${riskPerShare.toFixed(2)}/share risk)`
        );
        continue;
      }

      try {
        this.trace(
          `ENTRY ${snap.symbol}: buy ${qty} @ ~$${snap.price.toFixed(2)} tp=$${takeProfit.toFixed(2)} sl=$${stopLoss.toFixed(2)} (${snap.note})`
        );
        await this.broker.submitBracketBuy({
          symbol: snap.symbol,
          qty,
          takeProfit,
          stopLoss,
        });
        this.state.tradesToday += 1;
        openCount += 1;
        held.add(snap.symbol);
        this.log(
          snap.symbol,
          "buy",
          qty,
          snap.price,
          `${snap.note} → target ${takeProfit.toFixed(2)}, stop ${stopLoss.toFixed(2)}`
        );
      } catch (err) {
        this.state.lastError =
          err instanceof Error ? err.message : String(err);
        this.trace(`ERROR order ${snap.symbol}: ${this.state.lastError}`);
      }
    }
  }

  private recordEquity() {
    if (this.account.equity <= 0) return;
    this.state.equityCurve.push({
      t: Date.now(),
      equity: round2(this.account.equity),
    });
    if (this.state.equityCurve.length > MAX_EQUITY_POINTS) {
      this.state.equityCurve.splice(
        0,
        this.state.equityCurve.length - MAX_EQUITY_POINTS
      );
    }
  }

  private log(
    symbol: string,
    side: "buy" | "sell",
    qty: number,
    price: number,
    reason: string,
    pnl?: number
  ) {
    this.state.log.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: Date.now(),
      symbol,
      side,
      qty,
      price,
      reason,
      pnl,
    });
    if (this.state.log.length > MAX_LOG_ENTRIES) {
      this.state.log.length = MAX_LOG_ENTRIES;
    }
  }

  private persist() {
    writeJson(STATE_FILE, {
      dayKey: this.dayKey,
      tradesToday: this.state.tradesToday,
      realizedPnlToday: this.state.realizedPnlToday,
      startEquityToday: this.state.startEquityToday,
      haltedReason: this.state.haltedReason,
      log: this.state.log,
      equityCurve: this.state.equityCurve,
    } satisfies PersistedState);
  }
}

const g = globalThis as unknown as { __tradingEngine?: TradingEngine };

export function getEngine(): TradingEngine {
  if (!g.__tradingEngine) {
    g.__tradingEngine = new TradingEngine();
  }
  return g.__tradingEngine;
}
