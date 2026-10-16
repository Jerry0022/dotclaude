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
 * @returns {string[]} remedy lines, without a prefix
 */
function branchFix({ branch = 'main', remote = true, mainCheckout = true, relPath = '', subagent = false } = {}) {
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
  const retry = relPath
    ? `Then retry with the path inside the new worktree (.claude/worktrees/<name>/${String(relPath).replace(/\\/g, '/')}) — never the main checkout's path, and hand subagents worktree paths only.`
    : 'Then run the command again inside the new worktree.';
  return [
    `Why a worktree: this is the repo's MAIN checkout, which other sessions may share — switching its branch (git switch / git checkout -b) would move them onto your branch. Leave this checkout on ${branch}.`,
    `Fix: ${enterLine(base)}`,
    retry,
    'EnterWorktree unavailable or refused: do not fall back to switching this checkout or to editing through absolute paths — ask the user (AskUserQuestion) how to continue.',
    'This session already changed files in the main checkout? Do not move, stash or restore them on your own (other changes there may belong to another session) — ask the user.',
  ];
}

module.exports = { branchFix, enterLine, RULE_CLAUSE };
