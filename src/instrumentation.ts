/**
 * Runs once when the server process boots (Next.js instrumentation hook).
 * On a persistent host this brings the trading engine up immediately —
 * including BOT_AUTO_START — instead of waiting for the first HTTP request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEngine } = await import("@/lib/trading/engine");
    getEngine();
  }
}
