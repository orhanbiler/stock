# QuantDesk — a risk-first intraday trading bot

A day-trading dashboard for **highly liquid US large caps** (SPY, QQQ, AAPL,
MSFT, NVDA, AMZN, GOOGL, META, TSLA, AMD, INTC, NFLX, AVGO, PLTR, MU —
editable in the UI, up to 20 symbols), built with Next.js and shadcn/ui. The design
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
3. **Entry**: only after the latest bar closes up (never buy a falling
   knife mid-flush), via a **bracket order** — take-profit at VWAP,
   stop-loss 2.5 ATRs below (with an absolute floor). The exit is defined
   before the trade exists.
4. **Regime filters**: longs disabled when a name trends hard below its
   2-hour average, and no entries at all while SPY itself is 1.5+ ATRs
   below its VWAP — market-wide flushes are correlated knives.
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

## Always-on deployment (Railway / Fly.io / Docker)

Vercel is serverless — the bot only ticks while the dashboard is open or an
external pinger hits `/api/status`. For true set-and-forget autonomy, run it
as a persistent process; the engine's built-in 20-second loop then trades on
its own all session.

### Railway (recommended, ~$5/mo)

1. https://railway.app → **New Project → Deploy from GitHub repo** → pick
   this repo (it auto-detects the `Dockerfile`).
2. In **Variables**, add:
   - `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY`
   - `BOT_AUTO_START=true` — resume trading automatically after restarts
     and deploys (otherwise press **Start bot** once per deploy)
3. In **Settings → Networking**, generate a domain. Optional: set the
   health check path to `/api/health`.
4. Optional but recommended: attach a **Volume** mounted at `/app/.data`
   so the trade log and equity history survive deploys.

### Fly.io

```bash
fly launch --no-deploy        # accepts the Dockerfile
fly secrets set ALPACA_KEY_ID=PK... ALPACA_SECRET_KEY=... BOT_AUTO_START=true
fly deploy
```

### Plain Docker

```bash
docker build -t quantdesk .
docker run -d -p 3000:3000 \
  -e ALPACA_KEY_ID=PK... -e ALPACA_SECRET_KEY=... -e BOT_AUTO_START=true \
  -v quantdesk-data:/app/.data quantdesk
```

`/api/health` is a lightweight liveness probe (no market calls). The
dashboard works the same wherever it runs — open it to watch, close it
without stopping the bot.

## Phone notifications (native push)

The bot can push every trade event to your phone — entries (with bracket
levels), exits (with P&L), the daily circuit breaker, and the end-of-day
flatten.

**ntfy (free, recommended):**

1. Install **ntfy** from the App Store / Play Store.
2. In the app, subscribe to a topic with an unguessable name, e.g.
   `quantdesk-x7k2-9fq1` (topics are public — obscurity is the password).
3. Set `NTFY_TOPIC=quantdesk-x7k2-9fq1` on your host and redeploy.

**Pushover** ($5 one-time): set `PUSHOVER_TOKEN` and `PUSHOVER_USER`.

The debug panel shows "Push alerts: configured" when either is active.
Notification failures never block trading.
