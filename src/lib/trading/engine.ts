import { AlpacaBroker, getAlpacaCreds } from "./alpaca";
import {
  BARS_LOOKBACK_MINUTES,
  clampRiskConfig,
  DEFAULT_RISK_CONFIG,
  DEFAULT_SYMBOLS,
  ENTRY_END_MINUTES,
  ENTRY_START_MINUTES,
  FLATTEN_MINUTES,
  MARKET_GATE_DEVIATION_ATR,
  MAX_EQUITY_POINTS,
  MAX_LOG_ENTRIES,
  MAX_SYMBOL_ENTRIES_PER_DAY,
  sanitizeSymbols,
  SYMBOL_COOLDOWN_MINUTES,
  TICK_INTERVAL_MS,
} from "./config";
import { TradeJournal } from "./journal";
import { SimBroker } from "./sim";
import { pushConfigured, sendPush } from "./notify";
import { readJson, writeJson } from "./store";
import {
  evaluateSymbol,
  round2,
  stopDistanceFor,
  targetFor,
} from "./strategy";
import type {
  AccountInfo,
  BotState,
  Broker,
  DebugInfo,
  ExitReason,
  JournalPayload,
  Position,
  RiskConfig,
  StatusPayload,
  TradeLogEntry,
} from "./types";

const MAX_TRACE_LINES = 150;

const STATE_FILE = "bot-state.json";
// v2: stop-placement retune (wider ATR stops, reversion-profile RR).
// New name so stale persisted configs don't carry the old tuning forward.
const CONFIG_FILE = "risk-config-v2.json";
const WATCHLIST_FILE = "watchlist.json";

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
  private symbols: string[];
  private journal = new TradeJournal();
  /** Set when the engine itself closes everything, so the next exit
   *  detection can attribute the reason correctly. */
  private pendingExitReason: ExitReason | null = null;
  /** SPY's deviation from its VWAP (ATRs) — the market-wide health gauge. */
  private marketDeviationAtr = 0;
  private backfillDone = false;

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
    this.symbols =
      sanitizeSymbols(readJson<string[]>(WATCHLIST_FILE)) ?? [
        ...DEFAULT_SYMBOLS,
      ];

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

    // Opt-in for always-on hosts: resume trading automatically after a
    // process restart or deploy instead of waiting for a human to press
    // Start. Leave unset on serverless.
    if (process.env.BOT_AUTO_START === "true") {
      this.trace("BOT_AUTO_START=true — starting bot on boot");
      this.start();
    }
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

  getMode(): string {
    return this.broker.mode;
  }

  getJournal(): JournalPayload {
    return this.journal.payload();
  }

  isRunning(): boolean {
    return this.state.running;
  }

  getSymbols(): string[] {
    return [...this.symbols];
  }

  /** Replace the watchlist. Returns the cleaned list, or null if invalid. */
  setSymbols(input: unknown): string[] | null {
    const cleaned = sanitizeSymbols(input);
    if (!cleaned) return null;
    this.symbols = cleaned;
    writeJson(WATCHLIST_FILE, cleaned);
    this.trace(`watchlist updated: ${cleaned.join(", ")}`);
    // Drop stale snapshots so the UI reflects the new list immediately.
    this.state.watchlist = this.state.watchlist.filter((w) =>
      cleaned.includes(w.symbol)
    );
    this.state.lastTick = null; // force a fresh scan on next status call
    return [...cleaned];
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
    this.pendingExitReason = "manual";
    await this.broker.closeAllPositions();
    this.log("system", "sell", 0, 0, reason);
    await this.refreshPortfolio();
    this.persist();
  }

  /**
   * Refresh on demand for the dashboard, even while the bot is stopped.
   * 8s staleness keeps ~16 symbols comfortably under Alpaca's data-API
   * rate limit (200 req/min).
   */
  async tickIfStale(maxAgeMs = 8_000): Promise<void> {
    if (this.state.lastTick && Date.now() - this.state.lastTick < maxAgeMs) {
      return;
    }
    await this.tick();
  }

  async getStatus(): Promise<StatusPayload> {
    await this.tickIfStale();
    const debug: DebugInfo = {
      keysDetected: this.keysDetected,
      pushConfigured: pushConfigured(),
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
      symbols: [...this.symbols],
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
      await this.backfillJournalIfNeeded();
      this.state.marketOpen = await this.broker.isMarketOpen();
      await this.refreshPortfolio();
      await this.detectExits();
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

  /** After a redeploy wipes .data, rebuild the journal from the broker's
   *  durable order history (last 14 days) so no trade record is lost. */
  private async backfillJournalIfNeeded() {
    if (this.backfillDone) return;
    this.backfillDone = true;
    if (this.broker.mode === "demo" || !this.journal.isEmpty()) return;
    try {
      const after = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const fills = await this.broker.getClosedFills(after);
      const added = this.journal.backfill(fills, this.broker.mode);
      if (added > 0) {
        this.trace(
          `journal backfilled: ${added} trade(s) rebuilt from broker order history`
        );
      }
      // Restore today's counters and brakes from the durable record, so a
      // redeploy can never reset the daily caps or an active loss streak.
      const journaledToday = this.journal.entriesOnDay(this.dayKey);
      if (journaledToday > this.state.tradesToday) {
        this.state.tradesToday = journaledToday;
        this.trace(
          `trade counter restored from journal: ${journaledToday} entries today`
        );
      }
      this.enforceLossStreakBrake();
    } catch (err) {
      this.backfillDone = false; // retry next tick
      this.trace(
        `journal backfill failed (will retry): ${err instanceof Error ? err.message : err}`
      );
    }
  }

  private rollDayIfNeeded() {
    const { dayKey } = etParts();
    if (dayKey === this.dayKey) return;
    this.dayKey = dayKey;
    this.state.tradesToday = 0;
    this.state.realizedPnlToday = 0;
    this.state.startEquityToday = 0;
    if (
      this.state.haltedReason?.startsWith("Daily loss limit") ||
      this.state.haltedReason?.startsWith("Discipline stop")
    ) {
      this.state.haltedReason = null; // fresh day, fresh limits
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

  /** A position that vanished since last tick was closed by its bracket
   *  (or by one of our flatten paths). Journal it with the real fill. */
  private async detectExits() {
    const current = new Set(this.positions.map((p) => p.symbol));
    const vanished = [...this.lastPositions].filter(
      ([symbol]) => !current.has(symbol)
    );
    const flattenReason = this.pendingExitReason;
    if (vanished.length > 0) this.pendingExitReason = null;

    for (const [symbol, prev] of vanished) {
      // Prefer the broker's actual fill over a bar-close estimate.
      const fill = await this.broker.getLastExitFill(symbol).catch(() => null);
      const snap = this.state.watchlist.find((w) => w.symbol === symbol);
      const exitPrice = fill?.price ?? snap?.price ?? prev.currentPrice;
      const exitTime = fill?.time ?? Date.now();
      const pnl = round2((exitPrice - prev.avgEntry) * prev.qty);
      const reason: ExitReason =
        flattenReason ?? (pnl >= 0 ? "target" : "stop");

      const journaled = this.journal.close(symbol, exitPrice, exitTime, reason);
      if (!journaled) {
        // Entry predates this journal (e.g. opened by a previous deploy and
        // backfill ran after) — never drop a real exit.
        this.journal.recordOrphanExit({
          mode: this.broker.mode,
          symbol,
          qty: prev.qty,
          entryPrice: prev.avgEntry,
          exitPrice,
          exitTime,
          exitReason: reason,
        });
      }
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
        `exit: ${symbol} ${prev.qty} @ $${exitPrice.toFixed(2)} (${reason}${fill ? ", real fill" : ", estimated"}) pnl=$${pnl.toFixed(2)}`
      );
      sendPush(
        `${symbol} closed: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
        `${prev.qty} @ $${exitPrice.toFixed(2)} (${reason}) · day realized ${this.state.realizedPnlToday >= 0 ? "+" : ""}$${this.state.realizedPnlToday.toFixed(2)}`,
        { tags: pnl >= 0 ? "white_check_mark" : "small_red_triangle_down" }
      );
    }
    this.lastPositions = new Map(this.positions.map((p) => [p.symbol, p]));
    if (vanished.length > 0) this.enforceLossStreakBrake();
  }

  /** Discipline stop: N consecutive losses → no new entries today.
   *  Unlike the circuit breaker this does not flatten — existing
   *  positions keep their brackets and finish on their own terms. */
  private enforceLossStreakBrake() {
    if (this.state.haltedReason) return;
    const streak = this.journal.consecutiveLosses(this.dayKey);
    if (streak >= this.config.maxConsecutiveLosses) {
      this.state.haltedReason = `Discipline stop: ${streak} consecutive losses — no new entries until tomorrow`;
      this.trace(`DISCIPLINE STOP: ${streak} consecutive losses`);
      this.log("system", "sell", 0, 0, this.state.haltedReason);
      sendPush("Discipline stop", this.state.haltedReason, {
        priority: "high",
        tags: "hand",
      });
    }
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
      this.pendingExitReason = "halt";
      void this.broker.closeAllPositions();
      this.log("system", "sell", 0, 0, this.state.haltedReason);
      this.trace(`CIRCUIT BREAKER: ${this.state.haltedReason}`);
      sendPush("Circuit breaker tripped", this.state.haltedReason, {
        priority: "high",
        tags: "rotating_light",
      });
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
      this.pendingExitReason = "eod";
      await this.broker.closeAllPositions();
      this.log("system", "sell", 0, 0, "End of day — flattened all positions");
      this.trace("end-of-day flatten executed (15:55 ET)");
      sendPush(
        "End of day flatten",
        `All positions closed · day realized ${this.state.realizedPnlToday >= 0 ? "+" : ""}$${this.state.realizedPnlToday.toFixed(2)}`,
        { tags: "checkered_flag" }
      );
    }
  }

  private async refreshWatchlist() {
    const snapshots = await Promise.all(
      this.symbols.map(async (symbol) => {
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

    // Market gate gauge: use SPY from the watchlist, or fetch it separately
    // if the user removed it. Fail open (0) rather than blocking on error.
    let market = snapshots.find((s) => s.symbol === "SPY" && s.atr > 0);
    if (!market) {
      try {
        const bars = await this.broker.getBars("SPY", BARS_LOOKBACK_MINUTES);
        market = evaluateSymbol("SPY", bars, this.config);
      } catch {
        market = undefined;
      }
    }
    this.marketDeviationAtr = market && market.atr > 0 ? market.deviationAtr : 0;
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
    if (this.marketDeviationAtr <= MARKET_GATE_DEVIATION_ATR) {
      return `Market-wide selloff (SPY ${this.marketDeviationAtr.toFixed(1)} ATR below VWAP) — standing aside`;
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
      if (
        this.journal.entriesToday(snap.symbol, this.dayKey) >=
        MAX_SYMBOL_ENTRIES_PER_DAY
      ) {
        this.trace(
          `skip ${snap.symbol}: already attempted ${MAX_SYMBOL_ENTRIES_PER_DAY}x today`
        );
        continue;
      }

      const stopLoss = round2(
        snap.price - stopDistanceFor(snap.price, snap.atr, this.config)
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
        this.journal.open({
          mode: this.broker.mode,
          dayKey: this.dayKey,
          symbol: snap.symbol,
          qty,
          entryTime: Date.now(),
          entryPrice: round2(snap.price),
          takeProfit,
          stopLoss,
          deviationAtr: round2(snap.deviationAtr),
          rsi2: round2(snap.rsi2),
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
        sendPush(
          `Bought ${qty} ${snap.symbol} @ ~$${snap.price.toFixed(2)}`,
          `Target $${takeProfit.toFixed(2)} · stop $${stopLoss.toFixed(2)} · ${snap.note}`,
          { tags: "chart_with_upwards_trend" }
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
