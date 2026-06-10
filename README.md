# QuantDesk — a risk-first intraday trading bot

A day-trading dashboard for **highly liquid US large caps** (SPY, QQQ, AAPL,
MSFT, NVDA, AMZN, GOOGL, META), built with Next.js and shadcn/ui. The design
goal is consistency through discipline: a simple quantitative edge wrapped in
hard, non-negotiable risk controls.

> **Honesty first:** no strategy guarantees profits. What this bot guarantees
> is process — small defined risk per trade, a daily loss circuit breaker,
> and zero overnight exposure. Prove it in simulation, then in paper trading,
> for weeks before even thinking about real money.

## Quick start (zero setup)

```bash
npm install
npm run dev
```

Open http://localhost:3000 and press **Start bot**. With no API keys the app
runs against a built-in market simulator, so you can watch the full
entry → bracket → exit lifecycle safely.

## Paper trading with Alpaca (recommended next step)

1. Create a free account at https://app.alpaca.markets
2. In the **Paper Trading** section, generate API keys (fake money).
3. Copy `.env.example` to `.env.local` and fill in:

```
ALPACA_KEY_ID=PK...
ALPACA_SECRET_KEY=...
```

4. Restart `npm run dev`. The badge switches to **PAPER** and the bot trades
   a real paper account with real market data (IEX feed, free tier).

Live trading is deliberately hard to enable (see `.env.example`) and should
stay off until you have a long, audited paper track record.

## The strategy — VWAP mean reversion, long only

1. **Universe**: only penny-spread mega caps and index ETFs. Liquidity is the
   first risk control — exits fill instantly near fair value.
2. **Setup**: price stretched ≥ 1.5 ATRs *below* session VWAP **and**
   RSI(2) oversold (≤ 10). In deep names these flushes tend to revert.
3. **Entry**: market buy via a **bracket order** — take-profit at VWAP,
   stop-loss 1 ATR below. The exit is defined before the trade exists.
4. **Regime filter**: longs disabled when price trends hard below its
   2-hour average — trend-down days are not dislocations.
5. **Timing**: entries only 9:45–15:30 ET (skip the open chaos and the
   closing ramp). Everything is flattened at 15:55 ET — never hold overnight.

## Risk engine (the important part)

| Control | Default | Hard bounds |
|---|---|---|
| Risk per trade | 0.5% of equity | 0.1–2% |
| Daily loss circuit breaker | −2% → halt + flatten | 0.5–5% |
| Max position size | 10% of equity | 1–25% |
| Max open positions | 3 | 1–5 |
| Max trades/day | 8 | 1–20 |
| Min reward/risk | 1.2 | 0.5–5 |

All settings are editable in the UI but **clamped server-side** to those
bounds — the UI cannot talk the engine into reckless values.

## Architecture

```
src/lib/trading/
  types.ts       shared contracts
  config.ts      universe, defaults, safety bounds
  indicators.ts  VWAP, RSI, ATR, SMA
  strategy.ts    signal evaluation (pure)
  risk + engine  engine.ts — sizing, circuit breakers, tick loop
  alpaca.ts      Alpaca paper/live broker (REST)
  sim.ts         built-in market simulator (default)
src/app/api/     status / bot / settings routes
src/components/  shadcn/ui + dashboard
```

State (trade log, equity curve, daily counters) persists to `.data/`
(gitignored).

## Disclaimer

Educational software, not financial advice. Day trading involves substantial
risk of loss. Past performance — simulated or real — does not guarantee
future results.
