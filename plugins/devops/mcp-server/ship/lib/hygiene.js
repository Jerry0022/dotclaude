/**
 * @module ship/lib/hygiene
 * @description Post-ship repo hygiene — the automatic half of the cleanup.
 *   The interactive half is the auto-cleanup skill (concept page); this module
 *   decides, after a successful ship or promote, two things on its own:
 *
 *   1. Auto-clean (after a ship only). Three triggers, each over REMOVABLE
 *      leftovers only:
 *        - age: once one is older than `autoCleanGateDays` (default 30),
 *          every one older than `autoCleanMinAgeDays` (default 30) goes;
 *        - count: more than `autoCleanKeepNewest` (default 20) → all but the
 *          newest 20 go, whatever their age — a busy repo (~10 sessions a
 *          day) never reaches the age gate;
 *        - disk: the session worktrees still kept weigh more than
 *          `autoCleanMaxGB` (default 10) → the oldest of them lose their
 *          checkout (summed newest first; the one crossing the line and
 *          everything older goes), but keep their branch.
 *      The rest is left to the page. "Removable" means nothing can be
 *      lost:
 *        - branch: its tip is in the default branch — git ancestor, the head
 *          of a merged PR (squash merges), reachable from a merged PR head
 *          (a sub-agent branch merged into the PR's branch, #572), or every
 *          file it touched is identical in the default branch;
 *        - worktree: a session worktree (under `.claude/worktrees/`), not
 *          locked, clean (`status --porcelain --untracked-files=all
 *          --ignored=matching` lists nothing but regenerable build output,
 *          run bookkeeping, `.claude/` runtime state and `.claude/` files the
 *          main checkout holds byte-identical — `worktree remove` deletes
 *          ignored files too and can follow a junction, so a `.env`, a patch,
 *          unsent batch notes, a concept store or an ignored link keeps it),
 *          no other checkout inside it, no Claude transcript for it
 *          written in the last `LIVE_SESSION_MS` (nor a main-checkout
 *          transcript naming it — a session moved there by EnterWorktree),
 *          idle for the age above
 *          (newest of HEAD commit and the worktree's index/HEAD/log mtimes),
 *          and its HEAD landed as above — its branch goes with it.
 *      Never touched: the default branch, main/master/HEAD/origin, the
 *      current worktree, the main checkout, any branch checked out anywhere,
 *      remote branches. Every destructive step re-checks its subject right
 *      before it runs (git-hygiene.md § Protection scope): a branch whose tip
 *      moved, a worktree that got dirty or locked is skipped, not removed.
 *      A removal gets `REMOVE_TIMEOUT` (git-hygiene.md, "A half-done worktree
 *      removal": never a 120 s ceiling); one that fails or times out is
 *      reported as damaged with its path — on every card, and with the
 *      closing `worktree prune` skipped, until that folder is gone (recorded
 *      in the state file); one git refused before deleting anything is a
 *      plain skip.
 *      Branch removal is `branch -D` (a squash-merged branch is no git
 *      ancestor, so `-d` would refuse); the tip SHA is logged for recovery.
 *      A removed branch's twin on origin goes too, but only when it points at
 *      the very same commit (a pushed sub-agent branch, #572).
 *      At risk (#573, widened): every unit that did NOT land (state unlanded
 *      or partial — see landingState), has no open PR, no live session and is
 *      not parked (hooks/lib/park-register.js), plus any worktree with real
 *      uncommitted changes, is never removed — it is reported on the card
 *      with its landing state, whether it was pushed and the dirty flag,
 *      because it looks like every other leftover and is easily forgotten.
 *      "partial" = some touched files are in the default branch, others not
 *      (squash merge plus later edits); never removable.
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
import { createRequire } from "node:module";

const { isParked } = createRequire(import.meta.url)("../../../hooks/lib/park-register.js");

const DAY_MS = 86_400_000;
const GB = 1024 ** 3;
/** Wall-clock budget for measuring worktree sizes in one run; the cache carries the rest to the next ship. */
export const SIZE_BUDGET_MS = 30_000;
const GIT_TIMEOUT = 15_000;
const NETWORK_TIMEOUT = 60_000;
/** Per-removal ceiling — a big node_modules takes minutes on Windows; a kill mid-delete leaves an orphan. */
export const REMOVE_TIMEOUT = 15 * 60_000;
/** No NEW removal starts after this much wall-clock time in one run; a running one is never cut short. */
export const REMOVAL_BUDGET_MS = 180_000;
/** A Claude transcript for the worktree written this recently → a session may still be in it. */
export const LIVE_SESSION_MS = 2 * 3_600_000;
/**
 * Ignored entries `worktree remove` may delete: regenerable build output only
 * (git-hygiene.md orphan rule). Any other ignored file keeps the worktree.
 */
const REGENERABLE_DIRS = new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt", ".cache",
  "coverage", ".turbo", "__pycache__", ".pytest_cache", "target"]);
const REGENERABLE_FILE = /\.pyc$/i;
/**
 * Root-level files of do-run's autonomous, backlog and burn modes: journals,
 * flags, resume state and reports — the run's own bookkeeping, not work. A
 * burn's `BURN-SALVAGE-*.patch` is work and is deliberately not listed.
 */
const TOOLING_ROOT_ENTRY = new RegExp("^(?:AUTONOMOUS-(?:LOG\\.md|REPORT\\.html|DONE\\.flag|RECOVERY\\.flag|LOCKOUT\\.flag"
  + "|RESUME\\.json|STALLED\\.txt|INTERRUPTED\\.txt)|BACKLOG-(?:LOG\\.md|REPORT\\.html|DONE\\.flag|RESUME\\.json)"
  + "|BURN-STATE(?:\\.prev)?\\.json(?:\\.lock)?|graphify-out/)$");
/**
 * `.claude/` paths that are pure plugin/Claude runtime state: locks, flags,
 * watcher and port state, caches, generated maps. Anything else under
 * `.claude/` — batch notes and their images, concept stores, audit dossiers,
 * plans — may be the only copy of someone's work and goes only when the main
 * checkout holds the same bytes (Desktop seeds each new worktree with a copy
 * of the main checkout's `.claude/`).
 */
const CLAUDE_RUNTIME = [
  /^\.claude\/\.ship-(?:watcher\/|in-progress$|lockout$|queue$)/,
  /^\.claude\/batch-(?:activity|mode\.json|watchdog\.lock|handoff\.json)$/,
  /^\.claude\/(?:strict-mode|concept-active|session-opened-files|token-config|auto-guide-active|devops-config)\.json$/,
  /^\.claude\/run-contract\./,
  /^\.claude\/(?:project-map\.md|scheduled_tasks\.lock|settings\.local\.json)$/,
  /^\.claude\/(?:\.cache|devops-livebrief|devops-concept|handoffs|skill-usage)\//,
  /^\.claude\/[^/]+\.(?:log|tmp)$/,
];
/** Verifying `.claude/` content against the main checkout stops here; beyond it the worktree stays. */
const VERIFY_MAX_FILES = 5000;
const VERIFY_MAX_BYTES = 64 * 1024 * 1024;
const NEVER_DELETE = new Set(["main", "master", "HEAD", "origin"]);
const SESSION_WORKTREE_MARKER = "/.claude/worktrees/";
/** A sub-agent's worktree (Agent tool, `isolation: "worktree"`) — never a Desktop session. */
const AGENT_WORKTREE = /\/\.claude\/worktrees\/agent-[0-9a-f]+$/i;
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
 * @returns {{units:object[], defaultBranch:string, current:string, main:string|null, paths:string[]}|null}
 */
export function scanRepo(cwd, now = Date.now()) {
  const worktrees = listWorktrees(cwd);
  if (!worktrees) return null;
  const top = gitOut(["rev-parse", "--show-toplevel"], cwd);
  const current = normPath(top || cwd);
  const main = worktrees[0] ? normPath(worktrees[0].path) : null;
  const defaultBranch = defaultBranchOf(cwd);
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter(Boolean));

  const refs = gitOut(["for-each-ref", "refs/heads", "--format=%(refname)%09%(objectname)%09%(committerdate:unix)%09%(upstream:track)"], cwd) || "";
  const gone = new Set();
  for (const line of refs.split("\n")) {
    const [ref, , , track] = line.trim().split("\t");
    if (ref && track === "[gone]") gone.add(ref.slice("refs/heads/".length));
  }

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
      detached: w.detached,
      gone: Boolean(w.branch && gone.has(w.branch)),
      session: normPath(w.path).includes(SESSION_WORKTREE_MARKER),
      agent: AGENT_WORKTREE.test(normPath(w.path)),
      // unreadable activity → treated as fresh (fail closed)
      activityMs: last === null ? now : last,
      ageDays: last === null ? 0 : Math.max(0, (now - last) / DAY_MS),
    });
  }

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
      gone: gone.has(name),
      ageDays: Math.max(0, (now - Number(ts) * 1000) / DAY_MS),
    });
  }
  return { units, defaultBranch, current, main, paths: worktrees.map((w) => normPath(w.path)) };
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

/**
 * Every commit reachable from a merged PR head but not from `baseRef` — the
 * commits a squash merge carried into the default branch under another name.
 * A sub-agent branch merged into the PR's branch before the squash sits in
 * this set, although it is neither an ancestor of main nor a PR head (#572).
 * Heads missing locally are skipped; stdin keeps a 1000-PR list off the
 * command line (Windows caps it at 32 k chars). Empty set on any failure.
 */
export function reachableFromMerged(cwd, merged, baseRef) {
  if (!merged || !merged.bySha || merged.bySha.size === 0) return new Set();
  const run = (args, input) => {
    try {
      return execFileSync("git", args, {
        cwd, input, encoding: "utf8", timeout: GIT_TIMEOUT, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return null;
    }
  };
  const check = run(["cat-file", "--batch-check=%(objectname) %(objecttype)"], [...merged.bySha].join("\n") + "\n");
  if (check === null) return new Set();
  const heads = check.split("\n").map((l) => l.trim().split(" ")).filter(([, t]) => t === "commit").map(([sha]) => sha);
  if (heads.length === 0) return new Set();
  const out = run(["rev-list", "--stdin"], [...heads, "--not", baseRef].join("\n") + "\n");
  return new Set((out || "").split("\n").map((s) => s.trim()).filter(Boolean));
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
    if (ctx.viaMerged && ctx.viaMerged.has(sha)) return "pr";
    // local tip behind the merged PR head (pushed from elsewhere, then merged)
    for (const head of (branch && ctx.merged.byName.get(branch)) || []) {
      if (gitOk(["merge-base", "--is-ancestor", sha, head], ctx.cwd)) return "pr";
    }
  }
  return treeLanded(sha, ctx) ? "tree" : null;
}

/** A throw-away index holding `baseRef`'s tree, for `git apply --cached` dry runs. */
function withTempIndex(ctx, fn) {
  const idx = path.join(os.tmpdir(), `hygiene-idx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    execFileSync("git", ["read-tree", ctx.baseRef], { cwd: ctx.cwd, env, timeout: GIT_TIMEOUT, stdio: ["pipe", "pipe", "pipe"] });
    return fn(env);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(idx, { force: true }); } catch { /* temp file */ }
  }
}

/**
 * How much of `sha`'s own change set `baseRef` already holds, file by file:
 * the patch `mergebase..sha` of each file must reverse-apply cleanly to the
 * base tree (so the base contains exactly that change). null when it cannot
 * be told (too many files, git too old, unreadable).
 */
function filesInBase(sha, ctx) {
  const mb = gitOut(["merge-base", sha, ctx.baseRef], ctx.cwd);
  if (!mb) return null;
  const names = gitOut(["diff", "--name-only", "-z", mb, sha], ctx.cwd);
  if (names === null) return null;
  const files = names.split("\0").filter(Boolean);
  if (files.length > TREE_CHECK_MAX_FILES) return null;
  if (files.length === 0) return { filesIn: 0, filesTotal: 0 };
  return withTempIndex(ctx, (env) => {
    let filesIn = 0;
    for (const f of files) {
      try {
        const patch = execFileSync("git", ["diff", "--binary", mb, sha, "--", f], {
          cwd: ctx.cwd, encoding: "utf8", timeout: GIT_TIMEOUT, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
        });
        execFileSync("git", ["apply", "--cached", "-R", "--check", "-"], {
          cwd: ctx.cwd, env, input: patch, timeout: GIT_TIMEOUT, stdio: ["pipe", "pipe", "pipe"],
        });
        filesIn += 1;
      } catch { /* this file's change is not (fully) in the base */ }
    }
    return { filesIn, filesTotal: files.length };
  });
}

/**
 * Where `sha` stands against the default branch: landed (ancestor / merged PR /
 * tree: a trial merge changes nothing, or every file's change is in the base),
 * partial (some files' changes are in, others are not — a squash merge plus
 * later edits) or unlanded. Partial is never removable. Memoized per `ctx`.
 * @param {{cwd:string, baseRef:string, merged:object|null}} ctx
 * @returns {{state:"landed"|"partial"|"unlanded", via:string|null, filesIn:number, filesTotal:number}}
 */
export function landingState(sha, branch, ctx) {
  const cache = ctx.landing || (ctx.landing = new Map());
  const key = `${sha}|${branch || ""}`;
  if (cache.has(key)) return cache.get(key);
  const done = (r) => { cache.set(key, r); return r; };
  if (!sha) return done({ state: "unlanded", via: null, filesIn: 0, filesTotal: 0 });
  const via = landedVia(sha, branch, ctx);
  if (via) return done({ state: "landed", via, filesIn: 0, filesTotal: 0 });
  // a trial merge into the base changes nothing → everything is in
  const trial = gitOut(["merge-tree", "--write-tree", ctx.baseRef, sha], ctx.cwd);
  if (trial) {
    const baseTree = gitOut(["rev-parse", `${ctx.baseRef}^{tree}`], ctx.cwd);
    if (baseTree && trial.split("\n")[0].trim() === baseTree) return done({ state: "landed", via: "tree", filesIn: 0, filesTotal: 0 });
  }
  const f = filesInBase(sha, ctx);
  if (!f) return done({ state: "unlanded", via: null, filesIn: 0, filesTotal: 0 });
  if (f.filesTotal > 0 && f.filesIn === f.filesTotal) return done({ state: "landed", via: "tree", ...f });
  if (f.filesIn > 0) return done({ state: "partial", via: null, ...f });
  return done({ state: "unlanded", via: null, ...f });
}

/** An ignored porcelain path that is regenerable build output. */
export function isRegenerable(entry) {
  const p = String(entry).replace(/\\/g, "/");
  const isDir = p.endsWith("/");
  const segs = p.replace(/\/+$/, "").split("/").filter(Boolean);
  // `--ignored=matching` names an ignored folder as a whole ("dist/"). A FILE
  // listed on its own under a build-named folder ("build/.env") means that
  // folder is not ignored — the file is not build output and may be the only
  // copy (a secret, a keystore).
  if (isDir) return segs.some((s) => REGENERABLE_DIRS.has(s));
  return REGENERABLE_FILE.test(segs[segs.length - 1] || "");
}

/**
 * An ignored porcelain path that is tooling state and can go unseen: the
 * do-run modes' root-level bookkeeping, or pure runtime state under `.claude/`.
 */
export function isToolingState(entry) {
  const p = String(entry).replace(/\\/g, "/");
  return TOOLING_ROOT_ENTRY.test(p) || CLAUDE_RUNTIME.some((re) => re.test(p));
}

/** `<wtPath>/<rel>` is a symlink or junction (Node reports junctions as links). */
function isLink(wtPath, rel) {
  try {
    return fs.lstatSync(path.join(wtPath, rel.replace(/\/+$/, ""))).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The main checkout holds `rel` with the same bytes. */
function sameInMain(wtPath, mainPath, rel) {
  if (!mainPath) return false;
  try {
    const a = path.join(wtPath, rel);
    const b = path.join(mainPath, rel);
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/**
 * Files under an ignored `.claude/` entry that `worktree remove` would
 * destroy for good: neither runtime state nor held byte-identical by the main
 * checkout. A link counts as own content (never followed). Null when the
 * entry is too big to verify.
 */
function ownClaudeFiles(wtPath, mainPath, entry) {
  const own = [];
  const budget = { files: VERIFY_MAX_FILES, bytes: VERIFY_MAX_BYTES };
  const walk = (rel) => {
    if (CLAUDE_RUNTIME.some((re) => re.test(rel)) || CLAUDE_RUNTIME.some((re) => re.test(`${rel}/`))) return true;
    let st;
    try { st = fs.lstatSync(path.join(wtPath, rel)); } catch { return true; }
    if (st.isSymbolicLink()) { own.push(rel); return true; }
    if (st.isDirectory()) {
      let names;
      try { names = fs.readdirSync(path.join(wtPath, rel)); } catch { own.push(`${rel}/`); return true; }
      for (const n of names) if (!walk(`${rel}/${n}`)) return false;
      return true;
    }
    budget.files -= 1;
    budget.bytes -= st.size;
    if (budget.files < 0 || budget.bytes < 0) return false;
    if (!sameInMain(wtPath, mainPath, rel)) own.push(rel);
    return true;
  };
  return walk(String(entry).replace(/\\/g, "/").replace(/\/+$/, "")) ? own : null;
}

/**
 * Why a worktree's content forbids `worktree remove`, or null. Counts
 * untracked files regardless of `status.showUntrackedFiles`; an ignored entry
 * that is a link (removal can delete through a junction); and every ignored
 * file that is neither regenerable build output, tooling state, nor — under
 * `.claude/` — a byte-identical copy of the main checkout's (`mainPath`).
 */
function worktreeContentReason(wtPath, mainPath = null) {
  let out;
  try {
    out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"], {
      cwd: wtPath, encoding: "utf8", timeout: GIT_TIMEOUT, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return "status-unreadable";
  }
  const entries = out.split("\0").filter(Boolean);
  if (entries.some((e) => !e.startsWith("!! "))) return "uncommitted-changes";
  const kept = [];
  for (const e of entries.map((x) => x.slice(3).replace(/\\/g, "/"))) {
    if (isLink(wtPath, e)) return `holds a link: ${e}`;
    if (isRegenerable(e) || isToolingState(e)) continue;
    if (e === ".claude/" || e.startsWith(".claude/")) {
      const own = ownClaudeFiles(wtPath, mainPath, e);
      if (own === null) return `holds ignored files: ${e} (too much to verify)`;
      kept.push(...own);
      continue;
    }
    kept.push(e);
  }
  if (kept.length === 0) return null;
  const shown = kept.slice(0, 3).join(", ") + (kept.length > 3 ? `, +${kept.length - 3}` : "");
  return `holds ignored files: ${shown}`;
}

/** A registered worktree (or the current checkout) inside `wtPath` — removing it would take that one along. */
function nestedCheckout(wtPath, paths, current) {
  const root = `${normPath(wtPath)}/`;
  return [...(paths || []), current].find((p) => p && normPath(p).startsWith(root)) || null;
}

/** Candidate ~/.claude/projects folder names for a checkout path. */
export function transcriptDirNames(wtPath) {
  const p = path.resolve(String(wtPath));
  return [...new Set([p.replace(/[\\/:.]/g, "-"), p.replace(/[^A-Za-z0-9]/g, "-")])];
}

/** A Claude transcript for `wtPath` was written within LIVE_SESSION_MS. */
export function hasLiveSession(wtPath, projectsDir, now = Date.now()) {
  if (!projectsDir) return false;
  for (const name of transcriptDirNames(wtPath)) {
    let files;
    try {
      files = fs.readdirSync(path.join(projectsDir, name));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        if (now - fs.statSync(path.join(projectsDir, name, f)).mtimeMs < LIVE_SESSION_MS) return true;
      } catch { /* vanished */ }
    }
  }
  return false;
}

/** How much of a transcript's tail is searched for a moved session's worktree path. */
const MOVED_TAIL_BYTES = 512 * 1024;

/**
 * A session that STARTED in the main checkout and moved into `wtPath` with
 * EnterWorktree keeps writing its transcript under the main checkout's
 * projects folder, so hasLiveSession() on the worktree path finds nothing.
 * Such a worktree is live when a transcript of the main checkout, written
 * within LIVE_SESSION_MS, carries `wtPath` as a session `cwd` in its tail.
 * Only the structured `"cwd":"<path>"` field counts, closed by its quote —
 * a mere mention (a `git worktree list`, a hygiene report) keeps nothing,
 * and `…/worktrees/fix` does not match a live `…/worktrees/fix-ab12`.
 * Case-folded on win32, where git and the transcript may spell a drive or
 * folder differently.
 */
export function hasMovedSession(wtPath, mainPath, projectsDir, now = Date.now()) {
  if (!projectsDir || !mainPath || !wtPath) return false;
  const fold = (t) => (process.platform === "win32" ? t.toLowerCase() : t);
  const abs = path.resolve(String(wtPath));
  const needles = [...new Set([abs, abs.replace(/\\/g, "/")])]
    .flatMap((p) => [`"cwd":${JSON.stringify(p)}`, `"cwd": ${JSON.stringify(p)}`])
    .map(fold);
  for (const name of transcriptDirNames(mainPath)) {
    let files;
    try {
      files = fs.readdirSync(path.join(projectsDir, name));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(projectsDir, name, f);
      let fd;
      try {
        const st = fs.statSync(file);
        if (now - st.mtimeMs >= LIVE_SESSION_MS) continue;
        const len = Math.min(st.size, MOVED_TAIL_BYTES);
        const buf = Buffer.alloc(len);
        fd = fs.openSync(file, "r");
        fs.readSync(fd, buf, 0, len, st.size - len);
        const tail = fold(buf.toString("utf8"));
        if (needles.some((n) => tail.includes(n))) return true;
      } catch { /* vanished or unreadable */ } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
      }
    }
  }
  return false;
}

export function defaultProjectsDir() {
  return path.join(os.homedir(), ".claude", "projects");
}

/** Why `unit` must stay, or null when it can go. */
function keepReason(unit, ctx) {
  if (unit.kind === "worktree") {
    if (!unit.session) return "not-a-session-worktree";
    if (unit.locked) return "locked";
    const inner = nestedCheckout(unit.path, ctx.paths, ctx.current);
    if (inner) return `holds another checkout: ${inner}`;
    if (hasLiveSession(unit.path, ctx.projectsDir) || hasMovedSession(unit.path, ctx.mainPath, ctx.projectsDir)) return "live-session";
    const why = worktreeContentReason(unit.path, ctx.mainPath);
    if (why) return why;
  }
  return landingState(unit.head, unit.branch, ctx).state === "landed" ? null : "not-landed";
}

/** Commits on `sha` that neither `baseRef` nor a merged PR carried (0 when unreadable). */
function ownCommits(sha, ctx) {
  const out = gitOut(["rev-list", "--no-merges", sha, "--not", ctx.baseRef], ctx.cwd) || "";
  return out.split("\n").filter((c) => c && !ctx.viaMerged.has(c)).length;
}

/**
 * Bytes under `dir` (links not followed), or null once `deadline` passes.
 * @param {string} dir
 * @param {number} deadline  epoch ms
 * @param {() => number} [clock]
 */
export function dirBytes(dir, deadline, clock = Date.now) {
  let bytes = 0;
  const walk = (d) => {
    if (clock() > deadline) return false;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return true; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!walk(p)) return false;
      } else {
        try { bytes += fs.lstatSync(p).size; } catch { /* vanished */ }
      }
    }
    return true;
  };
  return walk(dir) ? bytes : null;
}

/**
 * A worktree's size: from `cache` when measured after its last activity,
 * else measured now (null once the run's size budget is spent).
 */
function worktreeBytes(u, cache, deadline, clock) {
  const key = normPath(u.path);
  const hit = cache[key];
  if (hit && typeof hit.bytes === "number" && hit.at >= u.activityMs) return hit.bytes;
  const bytes = dirBytes(u.path, deadline, clock);
  if (bytes !== null) cache[key] = { bytes, at: clock() };
  return bytes;
}

/** Heads of open PRs (branch names and commit ids), via gh; null when gh is unavailable. */
export function fetchOpenHeads(cwd) {
  try {
    const out = execFileSync("gh", ["pr", "list", "--state", "open", "--limit", "500", "--json", "headRefName,headRefOid"], {
      cwd, encoding: "utf8", timeout: NETWORK_TIMEOUT, stdio: ["pipe", "pipe", "pipe"],
    });
    const list = JSON.parse(out);
    if (!Array.isArray(list)) return null;
    return {
      names: new Set(list.map((p) => p && p.headRefName).filter(Boolean)),
      shas: new Set(list.map((p) => p && p.headRefOid).filter(Boolean)),
    };
  } catch {
    return null;
  }
}

/**
 * Real uncommitted work in a checkout: modified/staged/untracked entries,
 * minus regenerable build output, tooling bookkeeping and `.claude/` runtime
 * state (the classifiers of the removal check). Ignored files do not count
 * here. Returns the number of such entries; 0 when clean or unreadable.
 */
export function uncommittedCount(wtPath) {
  let out;
  try {
    out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
      cwd: wtPath, encoding: "utf8", timeout: GIT_TIMEOUT, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of out.split("\0")) {
    if (!/^[ MADRCU?]{2} /.test(e)) continue; // rename sources carry no status prefix
    const rel = e.slice(3).replace(/\\/g, "/");
    if (isRegenerable(rel) || isToolingState(rel)) continue;
    // an untracked file inside build output the repo forgot to ignore is still build output
    if (e.startsWith("?? ") && rel.split("/").slice(0, -1).some((s) => REGENERABLE_DIRS.has(s))) continue;
    n += 1;
  }
  return n;
}

/** `sha` (or branch `name`) exists on a remote-tracking ref. */
function isPushed(u, cwd) {
  if (u.gone) return true;
  const out = gitOut(["for-each-ref", "--contains", u.head, "--count=1", "--format=%(refname)", "refs/remotes"], cwd);
  return Boolean(out);
}

/**
 * Classify every leftover once, read-only: removable (landed and safe to go),
 * keep (with the reason) and atRisk. At risk = (a) not landed (state
 * unlanded/partial), no open PR, no live session — and not deliberately
 * parked (park-register); or (b) a worktree with real uncommitted changes and
 * no live session. Offline (no merged-PR list) nothing is flagged for (a): a
 * squash-merged branch whose files moved on looks the same.
 * @param {{units:object[], defaultBranch:string, main:string|null, paths:string[], current:string}} scan
 * @param {{cwd:string, fetchMerged?:Function, fetchOpen?:Function, projectsDir?:string|null}} io
 */
export function classifyUnits(scan, io) {
  const originRef = `refs/remotes/origin/${scan.defaultBranch}`;
  const baseRef = gitOk(["rev-parse", "--verify", "-q", originRef], io.cwd) ? originRef : `refs/heads/${scan.defaultBranch}`;
  const fetchMerged = io.fetchMerged || fetchMergedHeads;
  const merged = fetchMerged(io.cwd, scan.defaultBranch);
  // injected merged heads (tests) mean no network: open PRs stay unknown too
  const fetchOpen = io.fetchOpen || (io.fetchMerged ? () => null : fetchOpenHeads);
  const open = scan.units.length ? fetchOpen(io.cwd) : null;
  const ctx = {
    cwd: io.cwd, baseRef, merged, viaMerged: reachableFromMerged(io.cwd, merged, baseRef),
    projectsDir: io.projectsDir, mainPath: scan.main || null, paths: scan.paths, current: scan.current,
  };
  const removable = [];
  const keep = [];
  let atRisk = [];
  for (const u of scan.units) {
    const reason = keepReason(u, ctx);
    if (!reason) removable.push(u);
    else keep.push({ ...u, reason });

    const live = u.kind === "worktree"
      && (hasLiveSession(u.path, io.projectsDir) || hasMovedSession(u.path, ctx.mainPath, io.projectsDir));
    if (live) continue;
    const dirty = u.kind === "worktree" ? uncommittedCount(u.path) : 0;
    const openPr = Boolean(open && ((u.branch && open.names.has(u.branch)) || open.shas.has(u.head)));
    const landing = landingState(u.head, u.branch, ctx);
    const unlanded = landing.state !== "landed" && merged !== null && !openPr;
    const subject = unlanded ? gitOut(["log", "-1", "--format=%s", u.head], io.cwd) || "" : "";
    const parked = unlanded && isParked(u.branch || "", subject);
    if ((unlanded && !parked) || dirty > 0) {
      atRisk.push({
        kind: u.kind, branch: u.branch, path: u.path, head: u.head,
        commits: ownCommits(u.head, ctx),
        state: landing.state, filesIn: landing.filesIn, filesTotal: landing.filesTotal,
        pushed: isPushed(u, io.cwd), dirty,
      });
    }
  }
  // a detached worktree and the branch it came from are one finding; a dirty worktree wins
  const dirtyHeads = new Set(atRisk.filter((r) => r.dirty > 0).map((r) => r.head));
  const idOf = (r) => (r.dirty > 0 ? `d:${normPath(r.path)}` : `h:${r.head}`);
  atRisk = atRisk.filter((r, i) => (r.dirty > 0 || !dirtyHeads.has(r.head)) && atRisk.findIndex((x) => idOf(x) === idOf(r)) === i);
  return { ctx, removable, keep, atRisk, merged, open };
}

/**
 * Which leftovers the auto-clean removes, and which unlanded ones are at risk.
 * Only removable leftovers count, under three triggers (module header): age
 * (`autoCleanGateDays` / `autoCleanMinAgeDays`), count (all but the
 * `autoCleanKeepNewest` newest) and disk (kept session worktrees above
 * `autoCleanMaxGB` lose their checkout, oldest first, the branch stays).
 * 0 switches the count or the disk trigger off. The at-risk check ignores
 * age: unpushed work is worth a warning on the day it is abandoned.
 * @param {{units:object[], defaultBranch:string}} scan
 * @param {{autoCleanGateDays:number, autoCleanMinAgeDays:number, autoCleanKeepNewest?:number, autoCleanMaxGB?:number}} settings
 * @param {{cwd:string, fetchMerged?:Function, projectsDir?:string|null, sizeCache?:object, sizeBudgetMs?:number, clock?:Function}} io
 * @returns {{gateOpen:boolean, reason:string|null, remove:object[], keep:object[], atRisk:object[], offline:boolean, keptBytes:number|null}}
 */
export function planAutoClean(scan, settings, io) {
  const gate = settings.autoCleanGateDays;
  const minAge = settings.autoCleanMinAgeDays;
  const keepNewest = settings.autoCleanKeepNewest ?? 0;
  const maxBytes = (settings.autoCleanMaxGB ?? 0) * GB;
  if (scan.units.length === 0) {
    return { gateOpen: false, reason: "no leftovers", remove: [], keep: [], atRisk: [], offline: false, keptBytes: null };
  }
  const { removable, keep: kept, atRisk, merged } = classifyUnits(scan, io);
  const keep = kept.filter((k) => k.ageDays > minAge);

  const picked = new Map();
  const pick = (u, trigger, extra = {}) => {
    if (!picked.has(u.key)) picked.set(u.key, { ...u, trigger, ...extra });
  };
  const newestFirst = [...removable].sort((a, b) => a.ageDays - b.ageDays);
  if (removable.some((u) => u.ageDays > gate)) {
    for (const u of removable) if (u.ageDays > minAge) pick(u, "age");
  }
  if (keepNewest > 0) for (const u of newestFirst.slice(keepNewest)) pick(u, "count");
  let keptBytes = null;
  if (maxBytes > 0) {
    const cache = io.sizeCache || {};
    const clock = io.clock || Date.now;
    const deadline = clock() + (io.sizeBudgetMs ?? SIZE_BUDGET_MS);
    let total = 0;
    let over = false;
    for (const u of newestFirst.filter((x) => x.kind === "worktree" && !picked.has(x.key))) {
      if (over) {
        pick(u, "disk", { keepBranch: true });
        continue;
      }
      const bytes = worktreeBytes(u, cache, deadline, clock);
      // budget spent: decide nothing on a partial sum, the cache resumes next ship
      if (bytes === null) {
        total = null;
        break;
      }
      total += bytes;
      if (total > maxBytes) {
        over = true;
        pick(u, "disk", { keepBranch: true });
      }
    }
    keptBytes = total;
  }

  const remove = scan.units.filter((u) => picked.has(u.key)).map((u) => picked.get(u.key));
  const rules = [`nothing older than ${gate} days`];
  if (keepNewest > 0) rules.push(`${removable.length} of at most ${keepNewest}`);
  if (maxBytes > 0) {
    rules.push(keptBytes === null
      ? "worktree sizes still being measured"
      : `${(keptBytes / GB).toFixed(1)} of at most ${settings.autoCleanMaxGB} GB`);
  }
  return {
    gateOpen: remove.length > 0,
    reason: remove.length > 0 ? null : `nothing to remove: ${rules.join(", ")}`,
    remove,
    keep,
    atRisk,
    offline: merged === null,
    keptBytes,
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

/**
 * The removed branch's twin on origin, when it points at the same commit —
 * a pushed sub-agent branch that nobody deletes after the parent PR's squash
 * merge (#572). Anything else on origin (moved, never pushed, someone else's)
 * stays. Returns a skip reason, "none" when there is no twin, or null.
 */
function deleteRemoteTwin(name, sha, cwd) {
  if (NEVER_DELETE.has(name)) return "protected";
  const remote = gitOut(["rev-parse", "--verify", "-q", `refs/remotes/origin/${name}`], cwd);
  if (remote === null) return "none";
  if (remote !== sha) return "remote-moved";
  return gitOk(["push", "origin", "--delete", name], cwd, NETWORK_TIMEOUT) ? null : "remote-delete-failed";
}

/**
 * `worktree remove` (never --force) after re-checking the subject.
 * @returns {string|null|{damaged:true, reason:string}}
 */
function removeWorktree(unit, cwd, current, timeout, projectsDir, mainPath) {
  const live = listWorktrees(cwd);
  if (!live) return "worktree-list-unreadable";
  const entry = live.find((w) => normPath(w.path) === normPath(unit.path));
  if (!entry || live.indexOf(entry) === 0) return "gone";
  if (normPath(entry.path) === current) return "current";
  if (entry.locked) return "locked";
  if (entry.head !== unit.head || entry.branch !== unit.branch) return "moved";
  const inner = nestedCheckout(unit.path, live.map((w) => normPath(w.path)), current);
  if (inner) return `holds another checkout: ${inner}`;
  if (hasLiveSession(unit.path, projectsDir) || hasMovedSession(unit.path, mainPath, projectsDir)) return "live-session";
  const why = worktreeContentReason(unit.path, mainPath);
  if (why) return why;
  try {
    execFileSync("git", ["worktree", "remove", unit.path], { cwd, timeout, stdio: ["pipe", "pipe", "pipe"] });
    return null;
  } catch (e) {
    const timedOut = e && (e.code === "ETIMEDOUT" || e.signal);
    // Refused before deleting anything (submodules, a file held open): the
    // checkout still has its .git file and git still reads it — a plain skip.
    if (!timedOut && fs.existsSync(path.join(unit.path, ".git")) && gitOk(["rev-parse", "--is-inside-work-tree"], unit.path)) {
      const line = String((e && (e.stderr || e.message)) || "").trim().split("\n")[0];
      return `remove-refused${line ? `: ${line}` : ""}`;
    }
    return { damaged: true, reason: `${timedOut ? "remove-timeout" : "remove-failed"}: damaged — manual check` };
  }
}

/**
 * Remove what `plan` selected: worktrees first (their branch right after),
 * then plain branches. Worktree removals share a wall-clock budget; the rest
 * waits for the next ship.
 */
export function executeAutoClean(plan, scan, {
  cwd, budgetMs = REMOVAL_BUDGET_MS, now = Date.now, removeTimeout = REMOVE_TIMEOUT, projectsDir = defaultProjectsDir(),
  holdPrune = false, remotes = false,
} = {}) {
  const removed = [];
  const skipped = [];
  let damaged = holdPrune;
  const deadline = now() + budgetMs;
  const branchGone = (name, sha) => {
    removed.push({ kind: "branch", name, sha });
    if (!remotes) return;
    const why = deleteRemoteTwin(name, sha, cwd);
    if (why === null) removed.push({ kind: "remote", name, sha });
    else if (why !== "none") skipped.push({ kind: "remote", name, reason: why });
  };
  for (const u of plan.remove.filter((x) => x.kind === "worktree")) {
    const left = deadline - now();
    if (left <= 0) {
      skipped.push({ kind: "worktree", path: u.path, branch: u.branch, reason: "time-budget" });
      continue;
    }
    const why = removeWorktree(u, cwd, scan.current, removeTimeout, projectsDir, scan.main || null);
    if (why && typeof why === "object") {
      damaged = true;
      skipped.push({ kind: "worktree", path: u.path, branch: u.branch, reason: why.reason, orphan: u.path });
      continue;
    }
    if (why) {
      skipped.push({ kind: "worktree", path: u.path, branch: u.branch, reason: why });
      continue;
    }
    removed.push({ kind: "worktree", path: u.path, branch: u.branch, sha: u.head, trigger: u.trigger });
    if (u.branch && !u.keepBranch) {
      const bwhy = deleteBranch(u.branch, u.head, cwd, scan.defaultBranch);
      if (bwhy) skipped.push({ kind: "branch", name: u.branch, reason: bwhy });
      else branchGone(u.branch, u.head);
    }
  }
  for (const u of plan.remove.filter((x) => x.kind === "branch")) {
    const why = deleteBranch(u.branch, u.head, cwd, scan.defaultBranch);
    if (why) skipped.push({ kind: "branch", name: u.branch, reason: why });
    else branchGone(u.branch, u.head);
  }
  // a failed/timed-out removal may have left a half-deleted checkout; prune
  // would drop its registration and turn it into an unlisted orphan
  if (!damaged) gitOk(["worktree", "prune"], cwd);
  return { removed, skipped, pruned: !damaged };
}

/**
 * Damaged removals stay on record until their folder is gone: a half-deleted
 * checkout loses its `.git` file, turns prunable and drops out of the next
 * scan, so only this list keeps it on the card (and `worktree prune` off).
 */
function openDamage(repo, fresh, now) {
  const known = (Array.isArray(repo.damaged) ? repo.damaged : []).filter((d) => d && d.path && fs.existsSync(d.path));
  for (const p of fresh) {
    if (!known.some((d) => normPath(d.path) === normPath(p))) known.push({ path: p, at: new Date(now).toISOString() });
  }
  return known;
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
    const r = ac.removed.filter((x) => x.kind === "remote").length;
    const parts = [];
    if (b) parts.push(de ? plural(b, "Branch", "Branches") : plural(b, "branch", "branches"));
    if (w) parts.push(de ? plural(w, "Worktree", "Worktrees") : plural(w, "worktree", "worktrees"));
    if (r) parts.push(de ? plural(r, "Remote-Branch", "Remote-Branches") : plural(r, "remote branch", "remote branches"));
    let text = parts.length
      ? `${parts.join(" · ")} ${de ? "entfernt" : "removed"}`
      : (de ? "nichts entfernt" : "nothing removed");
    if (ac.freedBytes >= 0.1 * GB) text += ` · ${(ac.freedBytes / GB).toFixed(1)} GB ${de ? "frei" : "freed"}`;
    if (ac.skipped.length) text += de ? ` · ${ac.skipped.length} übersprungen` : ` · ${ac.skipped.length} skipped`;
    const damaged = [...new Set([...ac.skipped.filter((x) => x.orphan).map((x) => x.orphan), ...(result.damaged || [])])];
    if (damaged.length) text += de ? ` · beschädigt, manuell prüfen: ${damaged.join(", ")}` : ` · damaged — manual check: ${damaged.join(", ")}`;
    out.tests = { method: de ? "Aufräumen (auto)" : "Cleanup (auto)", result: text };
  } else if (result.damaged && result.damaged.length) {
    out.tests = {
      method: de ? "Aufräumen (auto)" : "Cleanup (auto)",
      result: de ? `beschädigt, manuell prüfen: ${result.damaged.join(", ")}` : `damaged — manual check: ${result.damaged.join(", ")}`,
    };
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
  const risk = result.atRisk || [];
  if (risk.length) {
    const shown = risk.slice(0, 3).map((x) => {
      const name = x.branch || path.basename(String(x.path || "")) || x.head.slice(0, 7);
      const bits = [de ? plural(x.commits, "Commit", "Commits") : plural(x.commits, "commit", "commits")];
      if (x.state === "partial") bits.push(de ? `${x.filesIn}/${x.filesTotal} Dateien gelandet` : `${x.filesIn}/${x.filesTotal} files landed`);
      if (x.pushed === false) bits.push(de ? "ungepusht" : "unpushed");
      if (x.dirty > 0) bits.push(de ? "uncommittet" : "uncommitted");
      return `${name} (${bits.join(", ")})`;
    }).join(", ") + (risk.length > 3 ? ` +${risk.length - 3}` : "");
    out.risk = de
      ? {
        text: `⚠ Nicht gelandete Arbeit ohne PR: ${shown} — pushen und mergen oder bewusst verwerfen`,
        reply: "Sichere die nicht gelandete Arbeit: pushen, PR öffnen und mergen.",
      }
      : {
        text: `⚠ Unlanded work without a PR: ${shown} — push and merge it, or drop it on purpose`,
        reply: "Rescue the unlanded work: push, open a PR and merge it.",
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
 * @param {number} [p.removeTimeout]
 * @param {string|null} [p.projectsDir]  ~/.claude/projects (live-session check)
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
    atRisk: [],
    nudge: false,
    nudgeSuppressed: null,
  };

  const state = readState(statePath);
  const repo = state.repos[key] || {};
  let dirty = false;
  const priorDamage = openDamage(repo, [], now);

  if (trigger === "promote") {
    result.autoClean.reason = "promote — nudge only";
  } else if (!settings.autoClean) {
    result.autoClean.reason = "disabled (cleanup.autoClean)";
  } else {
    const projectsDir = p.projectsDir === undefined ? defaultProjectsDir() : p.projectsDir;
    const sizeCache = repo.sizes && typeof repo.sizes === "object" ? { ...repo.sizes } : {};
    const plan = planAutoClean(scan, settings, {
      cwd, fetchMerged: p.fetchMerged, fetchOpen: p.fetchOpen, projectsDir, sizeCache, sizeBudgetMs: p.sizeBudgetMs,
    });
    // sizes of worktrees that still exist only — a removed one would never expire
    const live = new Set(scan.units.filter((u) => u.kind === "worktree").map((u) => normPath(u.path)));
    const sizes = Object.fromEntries(Object.entries(sizeCache).filter(([k]) => live.has(k)));
    if (JSON.stringify(sizes) !== JSON.stringify(repo.sizes || {})) {
      repo.sizes = sizes;
      dirty = true;
    }
    result.autoClean.kept = plan.keep.length;
    result.autoClean.offline = plan.offline;
    result.atRisk = plan.atRisk;
    if (!plan.gateOpen) {
      result.autoClean.reason = plan.reason;
    } else {
      const done = executeAutoClean(plan, scan, {
        cwd, budgetMs: p.budgetMs ?? REMOVAL_BUDGET_MS, removeTimeout: p.removeTimeout ?? REMOVE_TIMEOUT, projectsDir,
        holdPrune: priorDamage.length > 0, remotes: p.remotes ?? true,
      });
      result.autoClean.ran = true;
      result.autoClean.removed = done.removed;
      result.autoClean.freedBytes = done.removed
        .filter((x) => x.kind === "worktree")
        .reduce((sum, x) => sum + ((sizeCache[normPath(x.path)] || {}).bytes || 0), 0);
      for (const x of done.removed) if (x.kind === "worktree") delete repo.sizes?.[normPath(x.path)];
      result.autoClean.skipped = done.skipped;
      repo.damaged = openDamage(repo, done.skipped.filter((x) => x.orphan).map((x) => x.orphan), now);
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

  if (!result.autoClean.ran && (repo.damaged || []).length !== priorDamage.length) {
    repo.damaged = priorDamage;
    dirty = true;
  }
  result.damaged = (repo.damaged || priorDamage).map((d) => d.path);
  if (dirty) {
    state.repos[key] = repo;
    writeState(statePath, state);
  }
  result.card = cardLines(result, lang);
  return result;
}
