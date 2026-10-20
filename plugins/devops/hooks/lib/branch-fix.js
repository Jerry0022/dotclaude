#!/usr/bin/env node
/**
 * @module branch-fix
 * @version 0.1.0
 * @description The "how do I get off main" remedy shared by pre.edit.branch,
 *   pre.main.guard and ss.git.check. Pure text, no git, no fs.
 *
 *   The old remedy was `git switch -c <topic> origin/main` everywhere. In the
 *   MAIN checkout of a repo that is the wrong fix: several sessions (Desktop
 *   local + cloud, scheduled tasks, a terminal) often share that checkout, and
 *   switching its branch moves every one of them onto the new branch — their
 *   next edit lands on someone else's topic. In the main checkout the session
 *   therefore moves into its own worktree (EnterWorktree) and the shared
 *   checkout stays on main. In a linked worktree the checkout is the
 *   session's own, so `git switch -c` stays the fix there.
 *
 *   EnterWorktree's own description allows it only when the user or project
 *   instructions ask for a worktree — the text says outright that this
 *   standing plugin rule is that instruction, or the model falls back to
 *   `git switch -c` in the shared checkout.
 *
 *   No automatic carry-over of changes already made in the main checkout:
 *   nothing records which files are this session's, a `git diff` drops new
 *   files and takes other sessions' hunks along, and restoring the originals
 *   is itself blocked on main. Such changes are the user's call.
 */

const RULE_CLAUSE = 'This is a standing devops plugin rule for this repo and counts as the instruction to work in a worktree';

/** One EnterWorktree call, with the deferred-tool and name-collision notes. */
function enterLine(base) {
  return `Call the EnterWorktree tool — {"name":"<topic>-<4 random chars>"} (the suffix keeps parallel sessions from picking the same name; deferred? load it with ToolSearch "select:EnterWorktree" first). It creates .claude/worktrees/<name> on a new branch from ${base} and moves this session there. ${RULE_CLAUSE}.`;
}

/**
 * @param {object} p
 * @param {string}  [p.branch]        main | master
 * @param {boolean} [p.remote]        the repo has an `origin`
 * @param {boolean} [p.mainCheckout]  the repo root is the MAIN working tree (not a linked worktree)
 * @param {string}  [p.relPath]       the blocked file, relative to the repo root (Edit/Write only)
 * @param {boolean} [p.subagent]      the call came from a subagent (hook payload carries agent_id)
 * @param {boolean} [p.ownWorktree]   devops-config workspace.ownWorktree — the project decided: never ask
 * @param {{targetRoot:string, ownRoot:string, ownIsWorktree:boolean}|null} [p.elsewhere]
 *   the target is in another work tree of the repo than the session's own
 * @returns {string[]} remedy lines, without a prefix
 */
function branchFix({ branch = 'main', remote = true, mainCheckout = true, relPath = '', subagent = false, elsewhere = null, ownWorktree = false } = {}) {
  const slash = (p) => String(p || '').replace(/\\/g, '/');
  const rel = slash(relPath);
  if (elsewhere && elsewhere.ownIsWorktree) {
    // Already in its own worktree (typically: moved there, then edited a path
    // remembered from the main checkout). Another EnterWorktree would nest a
    // second worktree; the fix is the path.
    const own = slash(elsewhere.ownRoot);
    return [
      `Why: this path is in another work tree of this repo (${slash(elsewhere.targetRoot)}, on ${branch}) — you work in your own worktree ${own}.`,
      `Fix: retry with the path inside your worktree${rel ? ` (${own}/${rel})` : ''}. Never edit another work tree's files, and hand subagents paths inside ${own} only.`,
    ];
  }
  if (elsewhere) {
    // The session sits in the main checkout and aimed at another session's
    // linked worktree on main: neither is the place to work.
    const lines = branchFix({ branch, remote, mainCheckout: true, subagent, ownWorktree });
    lines[0] = `Why: this path is in another session's worktree (${slash(elsewhere.targetRoot)}, on ${branch}) — not yours: do not edit it or switch its branch.${subagent ? '' : ' This session sits in the shared main checkout, so it needs a worktree of its own.'}`;
    return lines;
  }
  if (!mainCheckout) {
    return [remote
      ? `Fix: git fetch origin && git switch -c <feat/topic> origin/${branch}  — this worktree is the session's own, so switching its branch is safe.`
      : `Fix: git switch -c <feat/topic>  — no origin remote, so this branches from local ${branch}.`];
  }
  if (subagent) {
    // A subagent that moves itself splits one task over several worktrees,
    // and its parent keeps sending main-checkout paths.
    return [
      `Why: this path is in the repo's MAIN checkout on ${branch}, which other sessions may share.`,
      'Fix (subagent): do NOT create a worktree or switch branches yourself. Stop and report to the parent session that the write was blocked on main — the parent moves into its own worktree (EnterWorktree) and re-dispatches with paths inside it.',
    ];
  }
  const base = remote ? `origin/${branch}` : `local ${branch}`;
  const retry = rel
    ? `Then retry with the path inside the new worktree (.claude/worktrees/<name>/${rel}) — never the main checkout's path, and hand subagents worktree paths only.`
    : 'Then run the command again inside the new worktree.';
  const lines = [
    `Why a worktree: this is the repo's MAIN checkout, which other sessions may share — switching its branch (git switch / git checkout -b) would move them onto your branch. Leave this checkout on ${branch}.`,
    `Fix: ${enterLine(base)}`,
    retry,
    'EnterWorktree unavailable or refused: do not fall back to switching this checkout or to editing through absolute paths — ask the user (AskUserQuestion) how to continue.',
  ];
  if (ownWorktree) {
    // The question "where do I continue?" was settled once for the project
    // (post.worktree.enter). Without saying so HERE — the SessionStart text
    // is long gone by the first blocked write — a session that already
    // created files (a concept page written via node, a running bridge)
    // asked the user again.
    lines.push(OWN_WORKTREE_LINE);
  } else {
    lines.push('This session already changed files in the main checkout? Do not move, stash or restore them on your own (other changes there may belong to another session) — ask the user.');
  }
  return lines;
}

const OWN_WORKTREE_LINE = "This project's handling is decided (devops-config workspace.ownWorktree): do NOT ask the user where to continue — move now. Files THIS session created in the main checkout (e.g. a concept page and its source folder written by concept-build.js) move into the worktree: copy them over, remove the originals, and restart a running concept bridge from the worktree path. Changes you did not make stay exactly as they are.";

/**
 * The bypass line. The hooks read DEVOPS_ALLOW_MAIN from THEIR OWN
 * environment — the session's, set in settings — so an inline
 * `DEVOPS_ALLOW_MAIN=1 <cmd>` never reaches them. The old "set env … for
 * this single action" read as permission to do exactly that: a behavioural
 * eval (evals/git/shared-main-enter-worktree) caught a session writing the
 * blocked file through `DEVOPS_ALLOW_MAIN=1 node -e …` instead.
 */
const BYPASS = 'Bypass: only the user enables it, as env DEVOPS_ALLOW_MAIN=1 in the project\'s .claude/settings.local.json (e.g. a repo that is deliberately worked on main). Never set it yourself and never write the file another way (Bash, node, a script) to get around this block.';

/** devops-config workspace.ownWorktree for the project at `root`; false when undecided or unreadable. */
function ownWorktreeDecided(root) {
  try { return require('./devops-config').load(root).values.workspace.ownWorktree === true; } catch { return false; }
}

module.exports = { branchFix, enterLine, ownWorktreeDecided, RULE_CLAUSE, BYPASS, OWN_WORKTREE_LINE };
