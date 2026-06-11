export type BotMode = "demo" | "paper" | "live";

export interface Bar {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface AccountInfo {
  equity: number;
  cash: number;
  buyingPower: number;
  dayPnl: number;
  dayPnlPct: number;
}

export interface Position {
  symbol: string;
  qty: number;
  avgEntry: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export interface BracketOrderRequest {
  symbol: string;
  qty: number;
  takeProfit: number;
  stopLoss: number;
}

export interface TradeLogEntry {
  id: string;
  time: number;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  reason: string;
  pnl?: number;
}

export type Signal = "long" | "none" | "blocked";

export interface SymbolSnapshot {
  symbol: string;
  price: number;
  vwap: number;
  rsi2: number;
  atr: number;
  deviationAtr: number;
  signal: Signal;
  note: string;
  updatedAt: number;
}

export interface RiskConfig {
  riskPerTradePct: number;
  maxPositionPct: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  dailyLossLimitPct: number;
  entryDeviationAtr: number;
  rsiEntryMax: number;
  stopAtrMultiple: number;
  minRewardRisk: number;
  maxConsecutiveLosses: number;
}

export type ExitReason = "target" | "stop" | "eod" | "manual" | "halt";

export interface JournalTrade {
  id: string;
  mode: BotMode;
  dayKey: string;
  symbol: string;
  qty: number;
  entryTime: number;
  entryPrice: number;
  takeProfit: number;
  stopLoss: number;
  deviationAtr: number;
  rsi2: number;
  status: "open" | "closed";
  exitTime?: number;
  exitPrice?: number;
  exitReason?: ExitReason;
  pnl?: number;
  pnlPct?: number;
  holdMinutes?: number;
  /** Reconstructed from broker order history — no setup context. */
  backfilled?: boolean;
}

export interface BrokerFill {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  time: number;
}

export interface JournalDay {
  dayKey: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
}

export interface JournalStats {
  totalTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  avgHoldMinutes: number | null;
  days: JournalDay[];
}

export interface JournalPayload {
  trades: JournalTrade[];
  stats: JournalStats;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface BotState {
  running: boolean;
  mode: BotMode;
  marketOpen: boolean;
  haltedReason: string | null;
  lastError: string | null;
  tradesToday: number;
  realizedPnlToday: number;
  startEquityToday: number;
  lastTick: number | null;
  watchlist: SymbolSnapshot[];
  log: TradeLogEntry[];
  equityCurve: EquityPoint[];
}

export interface DebugInfo {
  keysDetected: boolean;
  pushConfigured: boolean;
  endpoint: string;
  dataFeed: string;
  tickCount: number;
  lastTickDurationMs: number;
  entriesBlockedReason: string | null;
  trace: string[];
}

export interface StatusPayload {
  account: AccountInfo;
  positions: Position[];
  bot: BotState;
  symbols: string[];
  config: RiskConfig;
  debug: DebugInfo;
}

export interface Broker {
  readonly mode: BotMode;
  getAccount(): Promise<AccountInfo>;
  getPositions(): Promise<Position[]>;
  getBars(symbol: string, lookbackMinutes: number): Promise<Bar[]>;
  isMarketOpen(): Promise<boolean>;
  submitBracketBuy(req: BracketOrderRequest): Promise<void>;
  closePosition(symbol: string): Promise<void>;
  closeAllPositions(): Promise<void>;
  /** Actual fill of the most recent closing (sell) order, if known. */
  getLastExitFill(
    symbol: string
  ): Promise<{ price: number; time: number } | null>;
  /** All filled orders since the given time, oldest first. */
  getClosedFills(afterIso: string): Promise<BrokerFill[]>;
}
