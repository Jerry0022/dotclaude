#!/usr/bin/env node
/**
 * session-open-tracker.js — track file:// URLs opened during a Claude session
 * and re-open them from the main-repo path after a worktree gets cleaned up.
 *
 * GitHub: dotclaude#160
 *
 * Background
 * ----------
 * Many devops skills (devops-concept, devops-autonomous, …) write a local HTML
 * artefact inside the current worktree and open it via `start msedge "file://…"`.
 * When `/devops-ship` later runs `ship_cleanup`, the worktree directory is
 * pruned and the user's browser tab now 404s on a path that no longer exists.
 *
 * The merged HTML still lives at the equivalent path inside the main repo,
 * so this script tracks every file Claude opens and — after ship cleanup —
 * re-opens each file from the main-repo path so the user's browser tab
 * silently picks up the live version.
 *
 * Storage
 * -------
 * The tracking file lives at `<main-repo>/.claude/session-opened-files.json`,
 * intentionally OUTSIDE the worktree so it survives `ship_cleanup`. Schema:
 *
 *   {
 *     "version": 1,
 *     "files": [
 *       { "path": "<abs>", "openedAt": "<iso-ms-utc>", "context": "<tag>" }
 *     ]
 *   }
 *
 * Subcommands
 * -----------
 *   track <abs-path> [--context=<tag>]
 *     Appends an entry to the tracking file. Idempotent (de-dupes by path,
 *     keeping the most recent `openedAt`). Maintains a 50-entry max and a
 *     24h TTL.
 *
 *   list [--json]
 *     Prints the tracked entries.
 *
 *   reopen-main --worktree=<abs-path> [--dry-run]
 *     Reads the tracking file, finds entries under the given worktree path,
 *     maps each to the main-repo equivalent, and opens the still-existing
 *     ones in Edge. After re-opening, the consumed entries are pruned.
 *
 *   prune
 *     Drop stale entries (TTL).
 */

const fs = require("node:fs");
const path = require("node:path");
const child_process = require("node:child_process");

const STORE_VERSION = 1;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Run a git command in `cwd`, return stdout trimmed. Throws on non-zero. */
function git(args, cwd) {
  return child_process
    .execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

/** Best-effort: returns trimmed stdout or null on failure. */
function gitSafe(args, cwd) {
  try { return git(args, cwd); } catch { return null; }
}

/**
 * Resolve the main-repo working tree root from `cwd`.
 *
 * Strategy:
 *   1. `git rev-parse --git-common-dir` returns the shared `.git/` directory.
 *      For a worktree this is the MAIN repo's `.git/`. Its parent directory
 *      is the main-repo working tree.
 *   2. Fall back to `git worktree list --porcelain` (first `worktree …` entry
 *      is always the main one).
 *   3. Fall back to `git rev-parse --show-toplevel` if neither of the above
 *      works (e.g. not in a git repo at all → returns null).
 */
function resolveMainRepoRoot(cwd) {
  const commonDir = gitSafe(["rev-parse", "--git-common-dir"], cwd);
  if (commonDir) {
    // commonDir is usually `.git` or an absolute path. Make it absolute.
    const absCommon = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(cwd, commonDir);
    // The working tree root is the parent of `.git/`. If commonDir already
    // ends with `.git`, the parent dir is the main repo root.
    if (path.basename(absCommon) === ".git") {
      return path.dirname(absCommon);
    }
  }

  const listing = gitSafe(["worktree", "list", "--porcelain"], cwd);
  if (listing) {
    const firstLine = listing.split(/\r?\n/).find(l => l.startsWith("worktree "));
    if (firstLine) return firstLine.slice("worktree ".length).trim();
  }

  return gitSafe(["rev-parse", "--show-toplevel"], cwd);
}

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

/** Absolute path to the JSON store, anchored at the main repo root. */
function storePath(cwd) {
  const main = resolveMainRepoRoot(cwd);
  if (!main) return null;
  return path.join(main, ".claude", "session-opened-files.json");
}

function loadStore(file) {
  if (!file || !fs.existsSync(file)) {
    return { version: STORE_VERSION, files: [] };
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: STORE_VERSION, files: [] };
    }
    if (!Array.isArray(parsed.files)) parsed.files = [];
    parsed.version = STORE_VERSION;
    return parsed;
  } catch {
    return { version: STORE_VERSION, files: [] };
  }
}

function saveStore(file, store) {
  if (!file) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", "utf8");
  return true;
}

/** Normalize a path for comparison: absolute, lowercased on Windows. */
function normalizePath(p) {
  if (!p) return "";
  let abs = path.resolve(p);
  // On Windows, fs is case-insensitive — comparing strings naively misses
  // matches between C:\foo and c:\foo. Lowercase consistently.
  if (process.platform === "win32") abs = abs.toLowerCase();
  return abs;
}

function pruneStale(store) {
  const now = Date.now();
  store.files = store.files.filter(entry => {
    const opened = Date.parse(entry.openedAt || "");
    if (!opened || Number.isNaN(opened)) return false;
    return now - opened <= TTL_MS;
  });
  // Cap total entries — drop oldest first.
  if (store.files.length > MAX_ENTRIES) {
    store.files.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
    store.files = store.files.slice(store.files.length - MAX_ENTRIES);
  }
  return store;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdTrack(argv) {
  const positional = argv.filter(a => !a.startsWith("--"));
  const flags = parseFlags(argv);
  const filePath = positional[0];
  if (!filePath) {
    console.error("track: expected an absolute file path");
    process.exit(1);
  }
  const abs = path.resolve(filePath);
  const context = flags.context || null;
  const cwd = process.cwd();
  const file = storePath(cwd);
  if (!file) {
    // Not in a git repo — silently skip. Tracking only matters for repos
    // that go through /devops-ship.
    return;
  }
  const store = pruneStale(loadStore(file));
  const normalized = normalizePath(abs);
  // De-dupe: drop any existing entry with the same path, keep most recent.
  store.files = store.files.filter(e => normalizePath(e.path) !== normalized);
  store.files.push({
    path: abs,
    openedAt: new Date().toISOString(),
    ...(context ? { context } : {})
  });
  saveStore(file, store);
}

function cmdList(argv) {
  const flags = parseFlags(argv);
  const cwd = process.cwd();
  const file = storePath(cwd);
  const store = file ? loadStore(file) : { version: STORE_VERSION, files: [] };
  if (flags.json) {
    console.log(JSON.stringify(store, null, 2));
    return;
  }
  if (!store.files.length) {
    console.log("(no tracked files)");
    return;
  }
  for (const entry of store.files) {
    const ctx = entry.context ? ` [${entry.context}]` : "";
    console.log(`${entry.openedAt}${ctx}  ${entry.path}`);
  }
}

function cmdPrune() {
  const cwd = process.cwd();
  const file = storePath(cwd);
  if (!file) return;
  const store = pruneStale(loadStore(file));
  saveStore(file, store);
}

/**
 * Re-open every tracked file that lives under `--worktree=<path>` from the
 * main-repo equivalent path. Used by `/devops-ship` Step 5 after
 * `ship_cleanup` has removed the worktree.
 */
function cmdReopenMain(argv) {
  const flags = parseFlags(argv);
  const wt = flags.worktree;
  if (!wt) {
    console.error("reopen-main: --worktree=<abs-path> is required");
    process.exit(1);
  }
  const dryRun = !!flags["dry-run"];
  const cwd = process.cwd();
  const mainRoot = resolveMainRepoRoot(cwd);
  if (!mainRoot) {
    console.error("reopen-main: could not resolve main repo root from cwd");
    process.exit(1);
  }
  const file = storePath(cwd);
  if (!file || !fs.existsSync(file)) {
    // No tracking file — nothing to do.
    return;
  }
  const store = pruneStale(loadStore(file));
  const wtNorm = normalizePath(wt);

  const consumed = [];
  const reopened = [];
  const missing = [];

  const surviving = [];
  for (const entry of store.files) {
    const entryNorm = normalizePath(entry.path);

    // Only act on entries that lived inside the worktree we just cleaned up.
    if (!entryNorm.startsWith(wtNorm + path.sep) && entryNorm !== wtNorm) {
      surviving.push(entry);
      continue;
    }

    // Compute the relative path within the worktree, then re-anchor to main.
    const relative = path.relative(wt, entry.path);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      // Defensive: relative path escapes the worktree — skip this entry.
      surviving.push(entry);
      continue;
    }
    const mainPath = path.resolve(mainRoot, relative);
    consumed.push(entry);

    if (!fs.existsSync(mainPath)) {
      missing.push(mainPath);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would open ${mainPath}`);
      reopened.push(mainPath);
      continue;
    }

    if (openInBrowser(mainPath)) reopened.push(mainPath);
    else missing.push(mainPath);
  }

  store.files = surviving;
  if (!dryRun) saveStore(file, store);

  // Single-line summary so /devops-ship can relay it.
  const summary = {
    mainRoot,
    worktree: wt,
    reopened,
    missing,
    consumed: consumed.length
  };
  console.log(JSON.stringify(summary, null, 2));
}

// ---------------------------------------------------------------------------
// Browser launcher
// ---------------------------------------------------------------------------

/**
 * Open `absPath` as a file:// URL in Microsoft Edge. Returns true on success.
 * Strategy by platform:
 *   - win32: `cmd /c start "" msedge "file:///<windows-path>"`
 *   - darwin: `open -a "Microsoft Edge" "file://<path>"`
 *   - linux: `microsoft-edge "file://<path>"` (best-effort)
 */
function openInBrowser(absPath) {
  const fileUrl = toFileUrl(absPath);
  try {
    if (process.platform === "win32") {
      // Resolve any worktree-mountpoint quirks via a plain Windows path.
      child_process.spawn("cmd.exe", ["/c", "start", "", "msedge", fileUrl], {
        detached: true,
        stdio: "ignore"
      }).unref();
    } else if (process.platform === "darwin") {
      child_process.spawn("open", ["-a", "Microsoft Edge", fileUrl], {
        detached: true,
        stdio: "ignore"
      }).unref();
    } else {
      child_process.spawn("microsoft-edge", [fileUrl], {
        detached: true,
        stdio: "ignore"
      }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

/** Convert a native absolute path to a browser-safe file:// URL. */
function toFileUrl(absPath) {
  const abs = path.resolve(absPath);
  if (process.platform === "win32") {
    // file:///C:/Users/... — three slashes, native separator -> forward slash.
    return "file:///" + abs.replace(/\\/g, "/");
  }
  return "file://" + abs;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq === -1) out[a.slice(2)] = true;
    else out[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return out;
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case "track":       return cmdTrack(rest);
    case "list":        return cmdList(rest);
    case "prune":       return cmdPrune();
    case "reopen-main": return cmdReopenMain(rest);
    default:
      console.error(
        "usage:\n" +
        "  session-open-tracker.js track <abs-path> [--context=<tag>]\n" +
        "  session-open-tracker.js list [--json]\n" +
        "  session-open-tracker.js prune\n" +
        "  session-open-tracker.js reopen-main --worktree=<abs-path> [--dry-run]"
      );
      process.exit(1);
  }
}

main();
