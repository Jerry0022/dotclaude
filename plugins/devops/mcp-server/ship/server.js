/**
 * @module dotclaude-ship-tools
 * @version 0.4.0
 * @plugin devops
 * @description The ship pipeline tool group of the single devops MCP server
 *   (`dotclaude`, mcp-server/index.js). Registers:
 *   - ship_preflight    — pre-flight safety checks
 *   - ship_build        — build, lint, test, build-ID
 *   - ship_version_bump — bump + verify all version files
 *   - ship_release      — commit, push, PR, merge, tag, release
 *   - ship_promote      — re-tag a shipped version onto beta/stable
 *   - ship_cleanup      — delete branch, prune worktrees
 *   - ship_hygiene      — post-ship auto-clean of old leftovers + cleanup nudge
 *   - ship_run          — the whole pipeline in code, one call (M7)
 *
 *   Until 0.3.0 this was its own server (`dotclaude-ship`). Now every call runs
 *   OUT of process: the server spawns the offline CLI (ship/cli.js — same
 *   handlers, same zod validation, same checkpoint record) through
 *   lib/run-child.js. The ship libs use ~54 synchronous git/gh/npm calls; in
 *   process they would freeze the shared server's event loop for a whole
 *   ship_build (up to 15 min) or CI watch (up to 10 min), and a crash in them
 *   would take the card tool down with it. Out of process the event loop stays
 *   free, a ship crash is one failed tool result, and a hung step is
 *   tree-killed at its timeout.
 *
 *   Only the schemas are imported here (each tool module on its own — a broken
 *   module drops that one tool, not the server).
 */

import { fileURLToPath } from "node:url";
import { runChild } from "../lib/run-child.js";

export const SHIP_CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

const MIN = 60_000;
/** Hard ceilings per step — above the longest legitimate run (build 15 min, CI watch 10 min + push/merge). */
export const SHIP_TIMEOUTS_MS = {
  ship_preflight: 10 * MIN,
  ship_build: 25 * MIN,
  ship_version_bump: 5 * MIN,
  ship_release: 40 * MIN,
  ship_promote: 20 * MIN,
  ship_cleanup: 10 * MIN,
  ship_hygiene: 10 * MIN,
  // preflight + build + release + cleanup in one call (build 25 + CI watch 40 + rest)
  ship_run: 90 * MIN,
};

const TOOLS = [
  ["ship_preflight", "./tools/preflight.js", "Ship Pre-Flight",
    "Run pre-flight safety checks: clean tree, commits ahead, pushed, version consistency, worktree detection. " +
    "Returns structured check results. Call this FIRST in the ship pipeline."],
  ["ship_build", "./tools/build.js", "Ship Build",
    "Build the project, run lint and tests, compute build-ID. " +
    "Auto-detects available scripts from package.json — only runs what exists. " +
    "Returns success/failure with step details. Use buildIdOnly=true to skip build and only hash."],
  ["ship_version_bump", "./tools/version-bump.js", "Ship Version Bump",
    "Bump version in all project files (plugin.json/package.json, README, marketplace.json). " +
    "Verifies all files match after bump. CHANGELOG must be updated separately by Claude before calling this."],
  ["ship_release", "./tools/release.js", "Ship Release",
    "Commit, push, create PR, squash-merge, and create the alpha ring tag. " +
    "Handles the full git + GitHub flow deterministically. The GitHub Release is created later by ship_promote. Returns PR number, merge sha, tag status."],
  ["ship_promote", "./tools/promote.js", "Ship Promote",
    "Promote a shipped version to a higher channel (alpha→beta→stable) by re-tagging the SAME commit SHA. " +
    "Never rebuilds, never bumps versions — bit-identical ring promotion via annotated tags. " +
    "Idempotent: re-run after partial failure completes the missing steps. Used by do-ship's promotion steps (promotion-only, or Step 5d right after a ship when the user named beta/stable) — never by the ship pipeline's own build/release steps."],
  ["ship_cleanup", "./tools/cleanup.js", "Ship Cleanup",
    "Delete shipped feature branch (local + remote if lingering), prune worktrees and remotes. " +
    "IMPORTANT: If in a worktree, Claude must call ExitWorktree BEFORE this tool. " +
    "EXCEPTION: when keep:true is passed, the tool only clears the ship-in-progress sentinel " +
    "and leaves the worktree + branch intact — safe to call from inside the worktree."],
  ["ship_hygiene", "./tools/hygiene.js", "Ship Hygiene",
    "After a SUCCESSFUL ship (trigger 'ship') or promotion-only run (trigger 'promote'): " +
    "removes leftover branches/worktrees whose content provably landed — only after a ship: once one is older than the " +
    "age gate (default 3 days) everything removable older than 3 days, beyond the 5 newest removable ones always, and " +
    "the oldest kept worktree checkouts when they exceed 10 GB (branch kept) — and decides whether the card " +
    "suggests the cleanup page (more than 50 leftovers, at most weekly). Thresholds are user settings (devops-config). " +
    "Returns ready-made card lines: card.tests → the card's tests array, card.open ({ text, reply }) → its open array. " +
    "Never call it for a blocked ship or a queued ship (--queued)."],
  ["ship_run", "./tools/run.js", "Ship Run",
    "The whole ship pipeline in ONE deterministic call: preflight (early push) → conflict-free rebase → early CI-quota probe → build → CHANGELOG entry + version bump → release → cleanup → deferred hygiene. " +
    "Resumable via the ship checkpoint (never repeats a bump, PR or tag). Returns early only at decision points ({ ok:false, stage, needs, detail, resume }) — handle the need, then call it again with the same params. " +
    "Otherwise one final result with everything the completion card needs. Env DEVOPS_SHIP_RUN=0 disables it (manual pipeline)."],
];

function text(obj, isError) {
  const r = { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
  if (isError) r.isError = true;
  return r;
}

/** The last top-level JSON value on stdout (the CLI prints exactly one). */
function parseResult(stdout) {
  const s = stdout.trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const i = s.lastIndexOf("\n{");
  if (i !== -1) { try { return JSON.parse(s.slice(i + 1)); } catch { /* fall through */ } }
  return undefined;
}

/**
 * Run one ship tool out of process. Never throws.
 * @param {string} name tool name
 * @param {object} params zod-parsed params
 * @param {{ cliPath?: string, timeoutMs?: number }} [opts]
 */
export async function runShipTool(name, params, opts = {}) {
  const cli = opts.cliPath || SHIP_CLI;
  const timeoutMs = opts.timeoutMs || Number(process.env.DOTCLAUDE_SHIP_TIMEOUT_MS) || SHIP_TIMEOUTS_MS[name] || 10 * MIN;
  const r = await runChild(process.execPath, [cli, name, "-"], {
    input: JSON.stringify(params || {}),
    cwd: process.cwd(),
    // The CLI skips its .ship-cli-last.json write on this path: that file is the
    // run-contract fallback for a Bash-invoked CLI, the MCP result counts itself.
    env: { ...process.env, DOTCLAUDE_SHIP_VIA_SERVER: "1" },
    timeoutMs,
  });
  if (r.timedOut) {
    return text({
      error: true,
      message: `${name} timed out after ${Math.round(timeoutMs / MIN)} min — its process tree was killed. ` +
        "The ship checkpoint (.claude/.ship-checkpoint.json) still names the step; re-run it.",
    }, true);
  }
  if (r.error) return text({ error: true, message: `${name} could not start: ${r.error}` }, true);
  const result = parseResult(r.stdout);
  if (r.code === 0 && result !== undefined) return text(result, false);
  if (result && result.error) return text(result, true);
  const why = (r.stderr || r.stdout || "").trim().slice(-2000) || `exit ${r.code}${r.signal ? ` (${r.signal})` : ""}`;
  return text({ error: true, message: `${name} failed: ${why}` }, true);
}

/**
 * Register the ship tools on a server. Each tool module is imported on its own
 * (schema only); a failing import is reported, the rest still register.
 * @returns {Promise<{ registered: string[], failed: Array<{ name: string, error: string }> }>}
 */
export async function registerShipTools(server, opts = {}) {
  const registered = [];
  const failed = [];
  const mods = await Promise.allSettled(TOOLS.map(([, file]) => import(file)));
  TOOLS.forEach(([name, , title, description], i) => {
    const m = mods[i];
    if (m.status !== "fulfilled" || !m.value.schema) {
      failed.push({ name, error: m.status === "rejected" ? String(m.reason && m.reason.message || m.reason) : "no schema export" });
      return;
    }
    server.registerTool(
      name,
      { title, description, inputSchema: m.value.schema },
      async (params) => runShipTool(name, params, opts),
    );
    registered.push(name);
  });
  return { registered, failed };
}
