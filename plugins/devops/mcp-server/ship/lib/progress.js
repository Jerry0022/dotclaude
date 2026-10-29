/**
 * @module ship/lib/progress
 * @description MCP progress for the long ship tools. Claude Code aborts a tool
 * call that sends neither a response nor a progress notification for 30 min
 * ("sent no response or progress for 1800s"), and a ship_build test step can
 * run longer. The ship CLI (the server's child) reports what it is doing as
 * `[ship-progress] <message>` stderr lines; the server forwards them as
 * `notifications/progress` and keeps a heartbeat going when the child is silent.
 */

export const PROGRESS_PREFIX = "[ship-progress] ";
export const HEARTBEAT_MS = 30_000;

/**
 * Feed stderr chunks, get the progress messages in them (a line split across
 * chunks is held back until it is complete).
 * @param {(msg: string) => void} onMessage
 */
export function progressLineParser(onMessage) {
  let rest = "";
  return (chunk) => {
    rest += String(chunk);
    const lines = rest.split(/\r?\n/);
    rest = lines.pop();
    for (const line of lines) {
      if (line.startsWith(PROGRESS_PREFIX)) onMessage(line.slice(PROGRESS_PREFIX.length));
    }
  };
}

/**
 * Progress reporter for one tool call, or null when the client sent no
 * progressToken (then nothing is sent, as before).
 * @param {{ _meta?: { progressToken?: string|number }, sendNotification?: Function }} [extra] the MCP handler's second argument
 * @param {string} name tool name, for the fallback heartbeat text
 * @returns {{ note: (message: string) => void, stop: () => void }|null}
 */
export function createProgressReporter(extra, name, { intervalMs = HEARTBEAT_MS, now = Date.now } = {}) {
  const token = extra?._meta?.progressToken;
  if (token === undefined || token === null || typeof extra.sendNotification !== "function") return null;
  const started = now();
  let count = 0;
  let latest = null;
  let lastSent = started;
  const send = (message) => {
    lastSent = now();
    count += 1;
    try {
      Promise.resolve(extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: count, message },
      })).catch(() => { /* a closed transport never breaks the tool call */ });
    } catch { /* same */ }
  };
  const timer = setInterval(() => {
    if (now() - lastSent < intervalMs) return;
    send(latest ?? `${name}: running ${Math.round((now() - started) / 60_000)}m`);
  }, Math.min(intervalMs, 1000));
  timer.unref();
  return {
    note(message) { latest = message; send(message); },
    stop() { clearInterval(timer); },
  };
}
