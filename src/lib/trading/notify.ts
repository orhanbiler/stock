/**
 * Native phone push notifications, fire-and-forget. Two free/cheap options:
 *
 * - ntfy (recommended): install the ntfy iOS/Android app, subscribe to a
 *   topic, set NTFY_TOPIC to that topic name (or a full self-hosted URL).
 * - Pushover: set PUSHOVER_TOKEN and PUSHOVER_USER.
 *
 * Notifications must never interfere with trading: failures are swallowed
 * after a console warning, and nothing here is awaited on the hot path.
 */

interface PushOptions {
  priority?: "default" | "high";
  tags?: string;
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.NTFY_TOPIC ||
      (process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER)
  );
}

export function sendPush(
  title: string,
  message: string,
  opts: PushOptions = {}
): void {
  void (async () => {
    try {
      await Promise.all([sendNtfy(title, message, opts), sendPushover(title, message, opts)]);
    } catch (err) {
      console.warn("push notification failed:", err);
    }
  })();
}

async function sendNtfy(title: string, message: string, opts: PushOptions) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const url = topic.startsWith("http") ? topic : `https://ntfy.sh/${topic}`;
  await fetch(url, {
    method: "POST",
    headers: {
      Title: title,
      Priority: opts.priority === "high" ? "high" : "default",
      ...(opts.tags ? { Tags: opts.tags } : {}),
    },
    body: message,
    cache: "no-store",
  });
}

async function sendPushover(
  title: string,
  message: string,
  opts: PushOptions
) {
  const token = process.env.PUSHOVER_TOKEN;
  const user = process.env.PUSHOVER_USER;
  if (!token || !user) return;
  await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      user,
      title,
      message,
      priority: opts.priority === "high" ? "1" : "0",
    }),
    cache: "no-store",
  });
}
