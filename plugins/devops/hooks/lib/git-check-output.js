#!/usr/bin/env node
/**
 * @module git-check-output
 * @version 0.3.0
 * @description Pure output composition for the ss.git.check SessionStart hook.
 *   Takes the already-collected findings and renders the hook's stdout lines.
 *   No git, no fs — so the decision logic is unit-testable.
 *
 *   Central invariant (issue #268): **a finding is never coupled to the ask.**
 *   The hook used to render current-repo `uncommitted`/`unpushed` findings only
 *   inside the AskUserQuestion block, and actively suppressed them from the
 *   plain report section whenever a workspace issue was present. In a session
 *   that cannot prompt — a scheduled task, a cron routine, a headless run —
 *   skipping AskUserQuestion is the correct behaviour, so the entire finding
 *   evaporated: neither acted on nor mentioned in the run's final report.
 *
 *   Detection of "is this session interactive?" was deliberately NOT used as the
 *   fix. No such signal exists anywhere in the plugin's hooks, and the one
 *   cron/background detector that does exist (prompt.flow.silent-turn) fires at
 *   UserPromptSubmit — i.e. after SessionStart, so its flag does not yet exist
 *   when this hook runs. Any new detection could fail open and reproduce the
 *   exact bug. Instead the findings are emitted unconditionally and the ask is
 *   layered on top: a session that can prompt, prompts; one that cannot, still
 *   reports.
 *
 *   Shared main checkout (0.3.0): several sessions often work in one main
 *   checkout. A clean one no longer forces a question — the session gets the
 *   standing rule to move into its own worktree (EnterWorktree) before its
 *   first edit, so the shared checkout stays on main. The question stays only
 *   when the checkout holds uncommitted or unpushed work: that work may be the
 *   user's own WIP or another session's, and only the user can tell. Its
 *   recommended answer leaves those changes untouched; the old git-stash
 *   take-along is gone (the stash stack is shared by every worktree).
 */

const { enterLine } = require('./branch-fix');

/** Render one findings line per issue type. */
function issueLine(issue) {
  if (!issue || typeof issue !== 'object') return null;
  switch (issue.type) {
    case 'uncommitted':
      // Without an origin /do-ship commits and merges LOCALLY — no push, no
      // PR (#500). The CTA must not promise either.
      if (issue.noRemote) return `- ${issue.label} → run \`/do-ship\` to commit and merge locally (no remote, nothing to push)`;
      return `- ${issue.label} → run \`/do-ship\` to commit, push & create PR`;
    case 'unpushed':
      return `- ${issue.label} → run \`/do-ship\` to commit, push & create PR`;
    case 'stash':
      return `- ${issue.label} → review with \`git stash list\`, then \`git stash pop\` or \`git stash drop\``;
    default:
      return null;
  }
}

/**
 * The must-surface directive. States BOTH obligations, in this order:
 *
 *   1. the AskUserQuestion mandate, VERBATIM and first — interactive behaviour
 *      must not be weakened, and an assistant reading only the first sentence
 *      has to come away with "ask", not with "reporting is enough";
 *   2. the report obligation, with an explicit landing zone. "Your final
 *      report" alone is undefined in a turn that ends in a completion card
 *      (stop.flow.guard requires the card to be the LAST thing in the
 *      response), so the directive names *where*: in the final message,
 *      before any card. Prose before the card is permitted; content after it
 *      is not.
 */
/**
 * A finding the turn itself resolved (a /do-ship that committed and pushed the
 * changes) is no longer true at the end of the turn. Restating it anyway put
 * a stale "4 uncommitted file(s)" block plus an "this is outdated" note above
 * every post-ship completion card. Only findings that still hold are owed.
 */
const RESOLVED_CLAUSE = 'Restate only findings that still hold at that point: one this turn resolved (e.g. a /do-ship landed the changes) is dropped silently — no restatement, no "outdated" note.';

function header(workspace, ask = true) {
  if (workspace && !ask) {
    return `Workspace rule at session start (devops plugin). The Rule block below is an instruction for you, not a message for the user: act on it, do not show it. Findings listed below, if any, are for the user: show them, and you MUST restate them verbatim in your final message, before any completion card — also in a scheduled, cron or headless run. ${RESOLVED_CLAUSE}`;
  }
  if (workspace) {
    return `Workspace check at session start. Show the user this summary verbatim and call AskUserQuestion as the FIRST action of this turn. If this turn cannot ask (scheduled, cron or headless run), you MUST still restate the findings below verbatim in your final message, before any completion card — never drop them. ${RESOLVED_CLAUSE}`;
  }
  return `Stale changes found at session start. Show the user this summary verbatim. You MUST restate these findings verbatim in your final message, before any completion card — also in a scheduled, cron or headless run. ${RESOLVED_CLAUSE}`;
}

function workspaceLines(workspace) {
  const branch = workspace.branch || 'unknown branch';
  switch (workspace.type) {
    case 'on-main-no-worktree':
      return [`- ⚠ On \`${branch}\` in repo root (not in a worktree) — write ops will be blocked by pre.main.guard / pre.edit.branch`];
    case 'detached-no-worktree':
      return ['- ⚠ Detached HEAD in repo root (not in a worktree) — commits will not belong to any branch'];
    default:
      return [`- On \`${branch}\` in repo root (not in a worktree)`];
  }
}

const ENTER = enterLine('origin/<default branch>');

/** Is `workspace` the shared main checkout on main/master or a detached HEAD? */
function offMainline(workspace) {
  return workspace.type === 'on-main-no-worktree' || workspace.type === 'detached-no-worktree';
}

/**
 * The clean-checkout half: no question, the standing rule. A feature branch
 * in the root may be someone's work in progress, so continuing it there
 * stays allowed — only NEW work moves (redteam R6).
 */
function directiveLines(workspace) {
  const out = [];
  if (offMainline(workspace)) {
    out.push("Rule (devops plugin): this is the repo's MAIN checkout, which other sessions may share. Before the FIRST edit or commit of this session, move into your own worktree:");
    out.push(`  - ${ENTER}`);
    out.push("  - Read-only work (questions, reviews, analysis) needs no worktree. Never switch this checkout's branch (git switch / git checkout -b) — that moves every session in it.");
  } else {
    const branch = workspace.branch || 'unknown branch';
    out.push(`Rule (devops plugin): this checkout may be shared and sits on \`${branch}\`. Continuing that branch's work here is fine; NEW work moves into its own worktree first:`);
    out.push(`  - ${ENTER}`);
    out.push("  - Never switch this checkout's branch (git switch / git checkout -b) — that moves every session in it.");
  }
  out.push('');
  return out;
}

/**
 * The interactive half — only when the checkout holds pending work. The
 * "FIRST action of this turn" mandate is kept verbatim.
 */
function askLines(workspace, noRemote = false) {
  const out = [];
  const shipFirst = noRemote
    ? 'Erst aktuelle Changes lokal shippen (commit + lokaler Merge), dann Worktree anlegen'
    : 'Erst aktuelle Changes shippen (commit + push), dann Worktree anlegen';
  out.push('Call AskUserQuestion as the FIRST action of this turn. Ask the user (in their language). Suggested options:');
  if (offMainline(workspace)) {
    out.push('  - Neue Arbeit im eigenen Worktree, Changes hier unangetastet lassen (recommended)');
    out.push(`  - ${shipFirst}`);
  } else {
    out.push(`  - Am Branch \`${workspace.branch || 'unknown branch'}\` hier weiterarbeiten (recommended)`);
    out.push('  - Neue Arbeit im eigenen Worktree, Changes hier unangetastet lassen');
    out.push(`  - ${shipFirst}`);
  }
  if (workspace.type === 'on-main-no-worktree') {
    out.push('  - Hier bleiben (bypass: DEVOPS_ALLOW_MAIN=1 für diese Session)');
  } else if (workspace.type === 'detached-no-worktree') {
    out.push('  - Hier bleiben (Warning bleibt informativ — kein Bypass-Flag nötig)');
  }
  out.push('');
  out.push('Resolution per option:');
  out.push(`  - Own worktree: ${ENTER} The changes in this checkout stay exactly as they are — they may be another session's.`);
  out.push(noRemote
    ? '  - Ship-first: invoke /do-ship (no remote: commits and merges locally), then move into a worktree as above'
    : '  - Ship-first: invoke /do-ship, then move into a worktree as above');
  if (!offMainline(workspace)) {
    out.push('  - Continue here: keep working on this branch in this checkout; new work later still moves into a worktree');
  }
  if (workspace.type === 'on-main-no-worktree') {
    out.push('  - Stay: the user adds env `DEVOPS_ALLOW_MAIN=1` to the project\'s `.claude/settings.local.json` to silence main-branch checks (an inline `DEVOPS_ALLOW_MAIN=1 <cmd>` never reaches the hooks — never set it yourself)');
  }
  out.push('');
  return out;
}

/**
 * Compose the hook's stdout lines.
 *
 * @param {object} input
 * @param {Array<{label:string, dir:string, issues:Array<{type:string,count:number,label:string}>}>} [input.dirty]
 * @param {{type:string, branch:string, severity:string}|null} [input.workspace]
 * @param {string|null} [input.staleNote]
 * @param {string} [input.cwd] — used only to label the current repo's block
 * @returns {string[]} lines; empty array means "stay silent"
 */
function compose({ dirty = [], workspace = null, staleNote = null, cwd } = {}) {
  const repos = (Array.isArray(dirty) ? dirty : []).filter(r => r && typeof r === 'object');
  const issuesOf = (r) => (Array.isArray(r.issues) ? r.issues : []);
  const hasFindings = repos.some(r => issuesOf(r).some(i => issueLine(i)));

  if (!hasFindings && !workspace && !staleNote) return [];

  const out = [];

  const currentDirty = repos.find(r => r.dir === cwd);
  const stagedTypes = new Set(['uncommitted', 'unpushed']);
  const hasChanges = currentDirty
    ? issuesOf(currentDirty).some(i => i && stagedTypes.has(i.type))
    : false;
  const noRemote = currentDirty
    ? issuesOf(currentDirty).some(i => i && i.type === 'uncommitted' && i.noRemote)
    : false;

  if (hasFindings || workspace) {
    out.push(header(workspace, hasChanges));
    out.push('');
  }

  if (workspace) {
    out.push('**Workspace setup**');
    out.push(...workspaceLines(workspace));
    out.push('');
  }

  // Findings — ALWAYS rendered, for every repo including the current one.
  // The former `workspace && r.dir === cwd` suppression lived here and is the
  // reason findings could vanish; it is gone on purpose. Do not reintroduce a
  // conditional around this block.
  for (const r of repos) {
    const lines = issuesOf(r).map(issueLine).filter(Boolean);
    if (lines.length === 0) continue;
    out.push(r.dir === cwd ? '**current repo**' : `**${r.label}**`);
    out.push(...lines);
    out.push('');
  }

  if (workspace) {
    out.push(...(hasChanges ? askLines(workspace, noRemote) : directiveLines(workspace)));
  }

  if (staleNote) {
    if (out.length > 0) out.push('');
    out.push(staleNote);
  }

  return out;
}

module.exports = { compose, issueLine, header, workspaceLines, askLines, directiveLines };
