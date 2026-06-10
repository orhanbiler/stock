import { readJson, writeJson } from "./store";
import { round2 } from "./strategy";
import type {
  ExitReason,
  JournalDay,
  JournalPayload,
  JournalStats,
  JournalTrade,
} from "./types";

const JOURNAL_FILE = "journal.json";
const MAX_TRADES = 1000;

export class TradeJournal {
  private trades: JournalTrade[];

  constructor() {
    this.trades = readJson<JournalTrade[]>(JOURNAL_FILE) ?? [];
  }

  private persist() {
    if (this.trades.length > MAX_TRADES) {
      this.trades.splice(0, this.trades.length - MAX_TRADES);
    }
    writeJson(JOURNAL_FILE, this.trades);
  }

  open(trade: Omit<JournalTrade, "id" | "status">): JournalTrade {
    const entry: JournalTrade = {
      ...trade,
      id: `${trade.entryTime}-${trade.symbol}-${Math.random().toString(36).slice(2, 6)}`,
      status: "open",
    };
    this.trades.push(entry);
    this.persist();
    return entry;
  }

  close(
    symbol: string,
    exitPrice: number,
    exitTime: number,
    exitReason: ExitReason
  ): JournalTrade | null {
    const trade = [...this.trades]
      .reverse()
      .find((t) => t.symbol === symbol && t.status === "open");
    if (!trade) return null;
    trade.status = "closed";
    trade.exitPrice = round2(exitPrice);
    trade.exitTime = exitTime;
    trade.exitReason = exitReason;
    trade.pnl = round2((exitPrice - trade.entryPrice) * trade.qty);
    trade.pnlPct =
      trade.entryPrice > 0
        ? round2(((exitPrice - trade.entryPrice) / trade.entryPrice) * 100)
        : 0;
    trade.holdMinutes = Math.max(
      0,
      Math.round((exitTime - trade.entryTime) / 60_000)
    );
    this.persist();
    return trade;
  }

  /** Entries opened for a symbol on a given day (open or closed). */
  entriesToday(symbol: string, dayKey: string): number {
    return this.trades.filter(
      (t) => t.symbol === symbol && t.dayKey === dayKey
    ).length;
  }

  /** Current losing streak among today's closed trades, newest backwards. */
  consecutiveLosses(dayKey: string): number {
    const closed = this.trades
      .filter(
        (t) => t.status === "closed" && t.dayKey === dayKey && t.pnl !== undefined
      )
      .sort((a, b) => (b.exitTime ?? 0) - (a.exitTime ?? 0));
    let streak = 0;
    for (const t of closed) {
      if ((t.pnl ?? 0) < 0) streak += 1;
      else break;
    }
    return streak;
  }

  payload(limit = 200): JournalPayload {
    const closed = this.trades.filter((t) => t.status === "closed");
    const wins = closed.filter((t) => (t.pnl ?? 0) >= 0);
    const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
    const sum = (xs: JournalTrade[]) =>
      round2(xs.reduce((s, t) => s + (t.pnl ?? 0), 0));
    const grossWin = sum(wins);
    const grossLoss = Math.abs(sum(losses));

    const dayMap = new Map<string, JournalDay>();
    for (const t of closed) {
      const day = dayMap.get(t.dayKey) ?? {
        dayKey: t.dayKey,
        trades: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
      };
      day.trades += 1;
      if ((t.pnl ?? 0) >= 0) day.wins += 1;
      else day.losses += 1;
      day.pnl = round2(day.pnl + (t.pnl ?? 0));
      dayMap.set(t.dayKey, day);
    }

    const stats: JournalStats = {
      totalTrades: closed.length,
      openTrades: this.trades.filter((t) => t.status === "open").length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length
        ? round2((wins.length / closed.length) * 100)
        : null,
      totalPnl: sum(closed),
      avgWin: wins.length ? round2(grossWin / wins.length) : null,
      avgLoss: losses.length ? round2(-grossLoss / losses.length) : null,
      profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : null,
      bestTrade: closed.length
        ? Math.max(...closed.map((t) => t.pnl ?? 0))
        : null,
      worstTrade: closed.length
        ? Math.min(...closed.map((t) => t.pnl ?? 0))
        : null,
      avgHoldMinutes: closed.length
        ? Math.round(
            closed.reduce((s, t) => s + (t.holdMinutes ?? 0), 0) /
              closed.length
          )
        : null,
      days: [...dayMap.values()].sort((a, b) =>
        b.dayKey.localeCompare(a.dayKey)
      ),
    };

    const trades = [...this.trades]
      .sort(
        (a, b) => (b.exitTime ?? b.entryTime) - (a.exitTime ?? a.entryTime)
      )
      .slice(0, limit);

    return { trades, stats };
  }
}
