/**
 * Keep other sessions' branches out of a card's open points.
 *
 * Several sessions work (and ship) the same repo in parallel, each in its own
 * worktree. When one of them finished its ship, its card used to list the
 * sibling's branch as an open point ("claude/foo noch nicht geshippt —
 * shippen?") while the user was shipping exactly that branch in the other
 * session — a false alarm every time. A branch checked out in another
 * worktree belongs to the session living there; that session ships it, and
 * leftovers are ship_hygiene's nudge and the auto-cleanup page's job.
 *
 * So the card drops every open point that names such a branch or its worktree
 * folder. Local git only, fail-open: when git cannot be read, nothing is
 * dropped.
 *
 * Extracted from index.js so it is unit-testable without booting the MCP
 * server (index.js connects a stdio transport at import time).
 */

import { execFileSync } from "node:child_process";

const PROTECTED = new Set(["main", "master", "HEAD", "origin", "develop"]);
/** A bare segment shorter than this is too generic to match on its own ("fix", "ui"). */
const MIN_TOKEN = 8;

function normPath(p) {
  let n = String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(n)) n = n[0].toLowerCase() + n.slice(1);
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/** `git worktree list --porcelain` → [{ path, branch }]; the first entry is the main checkout. */
export function parseWorktreeList(output) {
  const out = [];
  let cur = null;
  for (const raw of String(output || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("worktree ")) {
      if (cur) out.push(cur);
      cur = { path: line.slice("worktree ".length).trim(), branch: null };
    } else if (cur && line.startsWith("branch refs/heads/")) {
      cur.branch = line.slice("branch refs/heads/".length).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The words that identify the other worktrees' work: full branch name, its
 * last segment and the worktree folder name — the forms a card writes.
 * @param {{path:string, branch:string|null}[]} worktrees
 * @param {string} ownPath  top level of the card's own work tree
 * @returns {string[]} lower-cased tokens
 */
export function foreignTokens(worktrees, ownPath) {
  const own = normPath(ownPath);
  const ownBranch = (worktrees.find((w) => normPath(w.path) === own) || {}).branch;
  const tokens = new Set();
  for (const w of worktrees) {
    if (normPath(w.path) === own) continue;
    const branch = w.branch;
    if (branch && branch !== ownBranch && !PROTECTED.has(branch)) {
      tokens.add(branch.toLowerCase());
      const tail = branch.split("/").pop();
      if (tail && tail.length >= MIN_TOKEN) tokens.add(tail.toLowerCase());
    }
    // A session worktree's folder is as telling as its branch; the main
    // checkout's folder is the project name and names nothing foreign.
    if (normPath(w.path).includes("/.claude/worktrees/")) {
      const dir = normPath(w.path).split("/").pop();
      if (dir && dir.length >= MIN_TOKEN) tokens.add(dir.toLowerCase());
    }
  }
  return [...tokens];
}

/**
 * Open points without the ones that name another worktree's branch or folder.
 * @param {Array<string|{text?:string, reply?:string}>} open
 * @param {string[]} tokens  from foreignTokens
 * @returns {{ open: Array, dropped: number }}
 */
export function dropForeignOpenItems(open, tokens) {
  if (!Array.isArray(open) || !tokens.length) return { open, dropped: 0 };
  const names = (it) => {
    const text = typeof it === "string" ? it : `${(it && it.text) || ""}\n${(it && it.reply) || ""}`;
    const lower = text.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  };
  const kept = open.filter((it) => !names(it));
  return { open: kept, dropped: open.length - kept.length };
}

/**
 * The other worktrees' tokens for the repo at `cwd`, or [] when git cannot say.
 * @param {string} cwd
 */
export function foreignTokensFor(cwd) {
  if (!cwd) return [];
  const opts = { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] };
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], opts).trim();
    const list = parseWorktreeList(execFileSync("git", ["worktree", "list", "--porcelain"], opts));
    return foreignTokens(list, top);
  } catch {
    return [];
  }
}
