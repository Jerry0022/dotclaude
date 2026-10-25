/**
 * Claude Code's machine-wide MCP failure cache.
 *
 * Claude Code records a failed MCP connect in ~/.claude/mcp-needs-auth-cache.json,
 * keyed by server name ("plugin:devops:dotclaude-ship": { timestamp, id }), and
 * skips that server in EVERY session that starts within the next 15 minutes
 * ("Skipping connection (recent failure cached …)"). One session's
 * CONNECT_TIMEOUT under start-up load therefore takes ship/completion/issues
 * away from all other sessions, with no in-session reconnect (2026-10-01,
 * deep-knowledge/mcp-deferred-tools.md § When the connect is skipped).
 *
 * The plugin's servers are stdio servers that never need auth, so their entries
 * carry no information worth keeping: clearPluginEntries() removes exactly
 * those keys and leaves every other server's entry untouched.
 */

const fs = require('fs');
const path = require('path');

const PREFIX = 'plugin:devops:';
// Claude Code's own window: an entry older than this no longer skips anything.
const WINDOW_MS = 15 * 60 * 1000;

function cacheFile(home) {
  return path.join(home, '.claude', 'mcp-needs-auth-cache.json');
}

/**
 * Remove the plugin's keys from the failure cache.
 * @returns {{ cleared: string[], active: string[], activeEntries: {key: string, ts: number}[] }}
 *   every removed key, the subset that was still inside the 15-min window
 *   (those were skipping), and those active keys with their timestamps.
 */
function clearPluginEntries(file, now = Date.now()) {
  const none = { cleared: [], active: [], activeEntries: [] };
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return none;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return none;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return none;

  const cleared = [];
  const active = [];
  const activeEntries = [];
  for (const key of Object.keys(data)) {
    if (!key.startsWith(PREFIX)) continue;
    cleared.push(key);
    const ts = data[key] && Number(data[key].timestamp);
    if (Number.isFinite(ts) && now - ts < WINDOW_MS) {
      active.push(key);
      activeEntries.push({ key, ts });
    }
    delete data[key];
  }
  if (!cleared.length) return { cleared, active, activeEntries };

  // Atomic replace: a half-written file would make Claude Code drop the whole
  // cache (or worse, fail to parse it) for every other server too.
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
  return { cleared, active, activeEntries };
}

// The hook races this session's own MCP boot: an entry written around the
// session start is this session's failure, not another session's (#823).
const OWN_SLACK_MS = 60 * 1000;

/**
 * Whose failure the active entries are: 'own' when any was written at or after
 * the session start (minus the slack), 'foreign' only when every one predates
 * it, 'none' without entries.
 * @param {{ts: number}[]} activeEntries
 * @param {number} startMs this session's start (the hook's process start)
 */
function classify(activeEntries, startMs) {
  if (!activeEntries || !activeEntries.length) return 'none';
  return activeEntries.some((e) => e.ts >= startMs - OWN_SLACK_MS) ? 'own' : 'foreign';
}

module.exports = { clearPluginEntries, classify, cacheFile, PREFIX, WINDOW_MS, OWN_SLACK_MS };
