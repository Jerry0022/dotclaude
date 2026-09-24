/**
 * @module ship/lib/hygiene
 * @description Post-ship repo hygiene — the automatic half of the cleanup.
 *   The interactive half is the auto-cleanup skill (concept page); this module
 *   decides, after a successful ship or promote, two things on its own:
 *
 *   1. Auto-clean (after a ship only). Opens only when a REMOVABLE leftover is
 *      older than `autoCleanGateDays` (default 30); then it removes every
 *      removable leftover older than `autoCleanMinAgeDays` (default 7).
 *      Younger ones are left to the page. "Removable" means nothing can be
 *      lost:
 *        - branch: its tip is in the default branch — git ancestor, the head
 *          of a merged PR (squash merges), or every file it touched is
 *          identical in the default branch;
 *        - worktree: a session worktree (under `.claude/worktrees/`), not
 *          locked, clean (`status --porcelain` empty), idle for the age above
 *          (newest of HEAD commit and the worktree's index/HEAD/log mtimes),
 *          and its HEAD landed as above — its branch goes with it.
 *      Never touched: the default branch, main/master/HEAD/origin, the
 *      current worktree, the main checkout, any branch checked out anywhere,
 *      remote branches. Every destructive step re-checks its subject right
 *      before it runs (git-hygiene.md § Protection scope): a branch whose tip
 *      moved, a worktree that got dirty or locked is skipped, not removed.
 *      Branch removal is `branch -D` (a squash-merged branch is no git
 *      ancestor, so `-d` would refuse); the tip SHA is logged for recovery.
 *   2. Nudge (after ship and promote). More than `nudgeThreshold` leftovers
 *      (default 50) and the cooldown (`nudgeCooldownDays`, default 7) passed →
 *      the card gets an open item that points to the cleanup page.
 *
 *   Settings come from hooks/lib/devops-config.js (`cleanup` section);
 *   the per-repo clock and the last removal log live in
 *   ~/.claude/devops-hygiene.json (home-rooted, never dirties a repo).
 *   Git calls use argument arrays (no shell) and fail closed: anything that
 *   cannot be inspected is treated as not removable.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DAY_MS = 86_400_000;
const GIT_TIMEOUT = 15_000;
const NETWORK_TIMEOUT = 60_000;
const REMOVE_TIMEOUT = 120_000;
/** Wall-clock cap for all worktree removals of one run (a big node_modules is slow on Windows). */
export const REMOVAL_BUDGET_MS = 180_000;
const NEVER_DELETE = new Set(["main", "master", "HEAD", "origin"]);
const SESSION_WORKTREE_MARKER = "/.claude/worktrees/";
/** More touched files than this and the tree comparison is left to the page. */
const TREE_CHECK_MAX_FILES = 200;
const LOG_KEEP = 200;

function gitOut(args, cwd, timeout = GIT_TIMEOUT) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function gitOk(args, cwd, timeout = GIT_TIMEOUT) {
  try {
    execFileSync("git", args, { cwd, timeout, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/** Forward slashes, no trailing slash, lower-case drive letter — porcelain paths vs. cwd. */
export function normPath(p) {
  if (!p) return "";
  let n = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(n)) n = n[0].toLowerCase() + n.slice(1);
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/**
 * `git worktree list --porcelain` → [{ path, head, branch, detached, locked, prunable }].
 * The first entry is the main checkout.
 */
export function parseWorktrees(output) {
  const out = [];
  let cur = null;
  for (const raw of String(output || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("worktree ")) {
      if (cur) out.push(cur);
      cur = { path: line.slice("worktree ".length).trim(), head: null, branch: null, detached: false, locked: false, prunable: false };
    } else if (!cur) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch refs/heads/")) {
      cur.branch = line.slice("branch refs/heads/".length).trim();
    } else if (line === "detached") {
      cur.detached = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      cur.locked = true;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      cur.prunable = true;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function listWorktrees(cwd) {
  const out = gitOut(["worktree", "list", "--porcelain"], cwd);
  return out === null ? null : parseWorktrees(out);
}

function defaultBranchOf(cwd) {
  const ref = gitOut(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
  if (ref) return ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  if (gitOk(["rev-parse", "--verify", "-q", "refs/heads/main"], cwd)) return "main";
  if (gitOk(["rev-parse", "--verify", "-q", "refs/heads/master"], cwd)) return "master";
  return "main";
}

/**
 * Newest activity of a linked worktree: its HEAD commit time and the mtimes
 * of the worktree's index, HEAD and HEAD log (git status/checkout/commit in
 * the session touch them). null when the admin dir cannot be read.
 */
function worktreeLastActivityMs(wtPath, headTimeMs) {
  let admin;
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(wtPath, ".git"), "utf8"));
    if (!m) return null;
    admin = path.resolve(wtPath, m[1]);
  } catch {
    return null;
  }
  let last = headTimeMs || 0;
  let seen = false;
  for (const f of ["index", "HEAD", path.join("logs", "HEAD")]) {
    try {
      last = Math.max(last, fs.statSync(path.join(admin, f)).mtimeMs);
      seen = true;
    } catch { /* optional file */ }
  }
  return seen ? last : null;
}

/**
 * Every leftover of the repo that contains `cwd`: linked worktrees except the
 * current one, and local branches no worktree has checked out, except the
 * default branch and main/master/HEAD/origin. Local git only — no network.
 * @returns {{units:object[], defaultBranch:string, current:string, main:string|null}|null}
 */
export function scanRepo(cwd, now = Date.now()) {
  const worktrees = listWorktrees(cwd);
  if (!worktrees) return null;
  const top = gitOut(["rev-parse", "--show-toplevel"], cwd);
  const current = normPath(top || cwd);
  const main = worktrees[0] ? normPath(worktrees[0].path) : null;
  const defaultBranch = defaultBranchOf(cwd);
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter(Boolean));

  const units = [];
  const linked = worktrees.slice(1).filter((w) => !w.prunable && normPath(w.path) !== current);
  const shas = [...new Set(linked.map((w) => w.head).filter(Boolean))];
  const commitTime = new Map();
  if (shas.length) {
    const out = gitOut(["show", "-s", "--format=%H %ct", ...shas], cwd) || "";
    for (const line of out.split("\n")) {
      const [sha, ts] = line.trim().split(" ");
      if (sha && ts) commitTime.set(sha, Number(ts) * 1000);
    }
  }
  for (const w of linked) {
    const last = worktreeLastActivityMs(w.path, commitTime.get(w.head));
    units.push({
      kind: "worktree",
      key: `worktree:${normPath(w.path)}`,
      path: w.path,
      branch: w.branch,
      head: w.head,
      locked: w.locked,
      session: normPath(w.path).includes(SESSION_WORKTREE_MARKER),
      // unreadable activity → treated as fresh (fail closed)
      ageDays: last === null ? 0 : Math.max(0, (now - last) / DAY_MS),
    });
  }

  const refs = gitOut(["for-each-ref", "refs/heads", "--format=%(refname)%09%(objectname)%09%(committerdate:unix)"], cwd) || "";
  for (const line of refs.split("\n")) {
    const [ref, sha, ts] = line.trim().split("\t");
    if (!ref || !ref.startsWith("refs/heads/")) continue;
    const name = ref.slice("refs/heads/".length);
    if (checkedOut.has(name) || NEVER_DELETE.has(name) || name === defaultBranch) continue;
    units.push({
      kind: "branch",
      key: `branch:${name}`,
      branch: name,
      head: sha,
      ageDays: Math.max(0, (now - Number(ts) * 1000) / DAY_MS),
    });
  }
  return { units, defaultBranch, current, main };
}

/**
 * Heads of PRs merged into `defaultBranch`, via gh. null when gh is missing,
 * unauthenticated or offline — the offline criteria still apply then.
 * @returns {{bySha:Set<string>, byName:Map<string,string[]>}|null}
 */
export function fetchMergedHeads(cwd, defaultBranch) {
  let list;
  try {
    const out = execFileSync("gh", ["pr", "list", "--state", "merged", "--limit", "1000",
      "--json", "number,headRefName,headRefOid,baseRefName"], {
      cwd, encoding: "utf8", timeout: NETWORK_TIMEOUT, stdio: ["pipe", "pipe", "pipe"],
    });
    list = JSON.parse(out);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const bySha = new Set();
  const byName = new Map();
  for (const pr of list) {
    if (!pr || pr.baseRefName !== defaultBranch || !pr.headRefOid) continue;
    bySha.add(pr.headRefOid);
    if (pr.headRefName) {
      if (!byName.has(pr.headRefName)) byName.set(pr.headRefName, []);
      byName.get(pr.headRefName).push(pr.headRefOid);
    }
  }
  return { bySha, byName };
}

/** Every file `sha` changed since its merge base is identical in `baseRef`. */
function treeLanded(sha, ctx) {
  const base = gitOut(["merge-base", sha, ctx.baseRef], ctx.cwd);
  if (!base) return false;
  const out = gitOut(["diff", "--name-only", "-z", base, sha], ctx.cwd);
  if (out === null) return false;
  const files = out.split("\0").filter(Boolean);
  if (files.length === 0) return true;
  if (files.length > TREE_CHECK_MAX_FILES) return false;
  return gitOk(["diff", "--quiet", sha, ctx.baseRef, "--", ...files], ctx.cwd);
}

/**
 * How `sha` reached the default branch: "ancestor" | "pr" | "tree", or null.
 * @param {{cwd:string, baseRef:string, merged:{bySha:Set<string>, byName:Map<string,string[]>}|null}} ctx
 */
export function landedVia(sha, branch, ctx) {
  if (!sha) return null;
  if (gitOk(["merge-base", "--is-ancestor", sha, ctx.baseRef], ctx.cwd)) return "ancestor";
  if (ctx.merged) {
    if (ctx.merged.bySha.has(sha)) return "pr";
    // local tip behind the merged PR head (pushed from elsewhere, then merged)
    for (const head of (branch && ctx.merged.byName.get(branch)) || []) {
      if (gitOk(["merge-base", "--is-ancestor", sha, head], ctx.cwd)) return "pr";
    }
  }
  return treeLanded(sha, ctx) ? "tree" : null;
}

/** Why `unit` must stay, or null when it can go. */
function keepReason(unit, ctx) {
  if (unit.kind === "worktree") {
    if (!unit.session) return "not-a-session-worktree";
    if (unit.locked) return "locked";
    const st = gitOut(["status", "--porcelain"], unit.path);
    if (st === null) return "status-unreadable";
    if (st !== "") return "uncommitted-changes";
  }
  return landedVia(unit.head, unit.branch, ctx) ? null : "not-landed";
}

/**
 * Which leftovers the auto-clean removes, if its gate opens.
 * @param {{units:object[], defaultBranch:string}} scan
 * @param {{autoCleanGateDays:number, autoCleanMinAgeDays:number}} settings
 * @param {{cwd:string, fetchMerged?:Function}} io
 * @returns {{gateOpen:boolean, reason:string|null, remove:object[], keep:object[], offline:boolean}}
 */
export function planAutoClean(scan, settings, io) {
  const gate = settings.autoCleanGateDays;
  const minAge = settings.autoCleanMinAgeDays;
  if (!scan.units.some((u) => u.ageDays > gate)) {
    return { gateOpen: false, reason: `nothing older than ${gate} days`, remove: [], keep: [], offline: false };
  }
  const originRef = `refs/remotes/origin/${scan.defaultBranch}`;
  const baseRef = gitOk(["rev-parse", "--verify", "-q", originRef], io.cwd) ? originRef : `refs/heads/${scan.defaultBranch}`;
  const fetchMerged = io.fetchMerged || fetchMergedHeads;
  const merged = fetchMerged(io.cwd, scan.defaultBranch);
  const ctx = { cwd: io.cwd, baseRef, merged };
  const remove = [];
  const keep = [];
  for (const u of scan.units.filter((x) => x.ageDays > minAge)) {
    const reason = keepReason(u, ctx);
    if (reason) keep.push({ ...u, reason });
    else remove.push(u);
  }
  const gateOpen = remove.some((u) => u.ageDays > gate);
  return {
    gateOpen,
    reason: gateOpen ? null : `nothing removable older than ${gate} days`,
    remove: gateOpen ? remove : [],
    keep,
    offline: merged === null,
  };
}

/** `branch -D` after re-checking the subject; returns a skip reason or null. */
function deleteBranch(name, sha, cwd, defaultBranch) {
  if (NEVER_DELETE.has(name) || name === defaultBranch) return "protected";
  const live = listWorktrees(cwd);
  if (!live) return "worktree-list-unreadable";
  if (live.some((w) => w.branch === name)) return "checked-out";
  const tip = gitOut(["rev-parse", "--verify", "-q", `refs/heads/${name}`], cwd);
  if (tip === null) return "gone";
  if (tip !== sha) return "moved";
  return gitOk(["branch", "-D", name], cwd) ? null : "delete-failed";
}

/** `worktree remove` (never --force) after re-checking the subject. */
function removeWorktree(unit, cwd, current, timeout) {
  const live = listWorktrees(cwd);
  if (!live) return "worktree-list-unreadable";
  const entry = live.find((w) => normPath(w.path) === normPath(unit.path));
  if (!entry || live.indexOf(entry) === 0) return "gone";
  if (normPath(entry.path) === current) return "current";
  if (entry.locked) return "locked";
  if (entry.head !== unit.head || entry.branch !== unit.branch) return "moved";
  const st = gitOut(["status", "--porcelain"], unit.path);
  if (st === null) return "status-unreadable";
  if (st !== "") return "uncommitted-changes";
  return gitOk(["worktree", "remove", unit.path], cwd, timeout) ? null : "remove-failed";
}

/**
 * Remove what `plan` selected: worktrees first (their branch right after),
 * then plain branches. Worktree removals share a wall-clock budget; the rest
 * waits for the next ship.
 */
export function executeAutoClean(plan, scan, { cwd, budgetMs = REMOVAL_BUDGET_MS, now = Date.now } = {}) {
  const removed = [];
  const skipped = [];
  const deadline = now() + budgetMs;
  for (const u of plan.remove.filter((x) => x.kind === "worktree")) {
    const left = deadline - now();
    if (left <= 0) {
      skipped.push({ kind: "worktree", path: u.path, branch: u.branch, reason: "time-budget" });
      continue;
    }
    const why = removeWorktree(u, cwd, scan.current, Math.min(REMOVE_TIMEOUT, left));
    if (why) {
      skipped.push({ kind: "worktree", path: u.path, branch: u.branch, reason: why });
      continue;
    }
    removed.push({ kind: "worktree", path: u.path, branch: u.branch, sha: u.head });
    if (u.branch) {
      const bwhy = deleteBranch(u.branch, u.head, cwd, scan.defaultBranch);
      if (bwhy) skipped.push({ kind: "branch", name: u.branch, reason: bwhy });
      else removed.push({ kind: "branch", name: u.branch, sha: u.head });
    }
  }
  for (const u of plan.remove.filter((x) => x.kind === "branch")) {
    const why = deleteBranch(u.branch, u.head, cwd, scan.defaultBranch);
    if (why) skipped.push({ kind: "branch", name: u.branch, reason: why });
    else removed.push({ kind: "branch", name: u.branch, sha: u.head });
  }
  gitOk(["worktree", "prune"], cwd);
  return { removed, skipped };
}

export function defaultStatePath() {
  return path.join(os.homedir(), ".claude", "devops-hygiene.json");
}

function readState(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data && typeof data === "object" && data.repos && typeof data.repos === "object") return data;
  } catch { /* absent or broken — start fresh */ }
  return { repos: {} };
}

function writeState(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } catch { /* the clock is best effort — a lost write means one extra hint */ }
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Ready-made card lines: a `tests` entry for a cleanup that ran, an `open`
 * item for the nudge — `{ text, reply }`, so the card's „Nachbessern"
 * button pre-fills the answer that opens the cleanup page (#495).
 */
export function cardLines(result, lang = "de") {
  const de = lang !== "en";
  const out = {};
  const ac = result.autoClean;
  if (ac && ac.ran) {
    const b = ac.removed.filter((x) => x.kind === "branch").length;
    const w = ac.removed.filter((x) => x.kind === "worktree").length;
    const parts = [];
    if (b) parts.push(de ? plural(b, "Branch", "Branches") : plural(b, "branch", "branches"));
    if (w) parts.push(de ? plural(w, "Worktree", "Worktrees") : plural(w, "worktree", "worktrees"));
    let text = parts.length
      ? `${parts.join(" · ")} ${de ? "entfernt" : "removed"}`
      : (de ? "nichts entfernt" : "nothing removed");
    if (ac.skipped.length) text += de ? ` · ${ac.skipped.length} übersprungen` : ` · ${ac.skipped.length} skipped`;
    out.tests = { method: de ? "Aufräumen (auto)" : "Cleanup (auto)", result: text };
  }
  if (result.nudge) {
    out.open = de
      ? {
        text: `${result.leftover} Branches/Worktrees liegen herum (Schwelle ${result.threshold}) — »branches aufräumen« öffnet die Aufräum-Seite`,
        reply: "Ja, branches aufräumen.",
      }
      : {
        text: `${result.leftover} branches/worktrees lying around (threshold ${result.threshold}) — say "branch cleanup" to open the cleanup page`,
        reply: "Yes, branch cleanup.",
      };
  }
  return out;
}

/**
 * The whole post-ship hygiene step.
 * @param {object} p
 * @param {string} p.cwd
 * @param {"ship"|"promote"} p.trigger  promote → nudge only, never removes anything
 * @param {object} p.settings           the `cleanup` section of devops-config
 * @param {string} p.stateKey           identity of the clone (its main checkout)
 * @param {string} [p.lang]
 * @param {string} [p.statePath]
 * @param {number} [p.now]
 * @param {Function} [p.fetchMerged]    injectable for tests
 * @param {number} [p.budgetMs]
 */
export function runHygiene(p) {
  const { cwd, trigger, settings, lang = "de" } = p;
  const now = p.now ?? Date.now();
  const statePath = p.statePath || defaultStatePath();
  const key = normPath(p.stateKey || cwd);

  let scan = scanRepo(cwd, now);
  if (!scan) return { success: false, reason: "git-unreadable", card: {} };

  const result = {
    success: true,
    trigger,
    leftover: scan.units.length,
    threshold: settings.nudgeThreshold,
    autoClean: { ran: false, reason: null, removed: [], skipped: [], kept: 0, offline: false },
    nudge: false,
    nudgeSuppressed: null,
  };

  const state = readState(statePath);
  const repo = state.repos[key] || {};
  let dirty = false;

  if (trigger !== "ship") {
    result.autoClean.reason = "promote — nudge only";
  } else if (!settings.autoClean) {
    result.autoClean.reason = "disabled (cleanup.autoClean)";
  } else {
    const plan = planAutoClean(scan, settings, { cwd, fetchMerged: p.fetchMerged });
    result.autoClean.kept = plan.keep.length;
    result.autoClean.offline = plan.offline;
    if (!plan.gateOpen) {
      result.autoClean.reason = plan.reason;
    } else {
      const done = executeAutoClean(plan, scan, { cwd, budgetMs: p.budgetMs ?? REMOVAL_BUDGET_MS });
      result.autoClean.ran = true;
      result.autoClean.removed = done.removed;
      result.autoClean.skipped = done.skipped;
      repo.lastAutoClean = { at: new Date(now).toISOString(), removed: done.removed.slice(0, LOG_KEEP) };
      dirty = true;
      scan = scanRepo(cwd, now) || scan;
      result.leftover = scan.units.length;
    }
  }

  if (!settings.nudge) {
    result.nudgeSuppressed = "disabled (cleanup.nudge)";
  } else if (result.leftover > settings.nudgeThreshold) {
    const last = typeof repo.lastNudgeAt === "number" ? repo.lastNudgeAt : 0;
    if (now - last >= settings.nudgeCooldownDays * DAY_MS) {
      result.nudge = true;
      repo.lastNudgeAt = now;
      dirty = true;
    } else {
      result.nudgeSuppressed = `cooldown (${settings.nudgeCooldownDays} days)`;
    }
  }

  if (dirty) {
    state.repos[key] = repo;
    writeState(statePath, state);
  }
  result.card = cardLines(result, lang);
  return result;
}
