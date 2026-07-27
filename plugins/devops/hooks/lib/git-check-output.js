#!/usr/bin/env node
/**
 * @module git-check-output
 * @version 0.1.0
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
 */

/** Render one findings line per issue type. */
function issueLine(issue) {
  if (!issue || typeof issue !== 'object') return null;
  switch (issue.type) {
    case 'uncommitted':
    case 'unpushed':
      return `- ${issue.label} → run \`/ship\` to commit, push & create PR`;
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
function header(workspace) {
  if (workspace) {
    return 'Workspace check at session start. Show this summary AS-IS and call AskUserQuestion as the FIRST action of this turn. If this turn cannot ask (scheduled, cron or headless run), you MUST still restate the findings below verbatim in your final message, before any completion card — never drop them.';
  }
  return 'Stale changes found at session start. Show this summary AS-IS. You MUST restate these findings verbatim in your final message, before any completion card — also in a scheduled, cron or headless run.';
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

/**
 * The interactive half. Unchanged in substance from before — the
 * "FIRST action of this turn" mandate is intentionally kept verbatim so
 * interactive sessions behave exactly as they did.
 */
function askLines(workspace, hasChanges) {
  const out = [];
  out.push('Call AskUserQuestion as the FIRST action of this turn. Ask the user (in their language). Suggested options:');
  if (hasChanges) {
    out.push('  - Worktree + Feature-Branch anlegen');
    out.push('  - Erst aktuelle Changes shippen (commit + push), dann Worktree anlegen (recommended)');
    out.push('  - Changes mitnehmen in neuen Worktree (git stash → create → pop)');
  } else {
    out.push('  - Worktree + Feature-Branch anlegen (recommended)');
  }
  if (workspace.severity === 'high' && workspace.type === 'on-main-no-worktree') {
    out.push('  - Hier bleiben (bypass: DEVOPS_ALLOW_MAIN=1 für diese Session)');
  } else {
    out.push('  - Hier bleiben (Warning bleibt informativ — kein Bypass-Flag nötig)');
  }
  out.push('');
  out.push('Resolution per option:');
  out.push('  - Worktree+branch: `git worktree add ../<feature> -b claude/<feature>` then cd there');
  if (hasChanges) {
    out.push('  - Ship-first: invoke /ship, then create worktree');
    out.push('  - Take-along: `git stash`, create worktree, `cd <worktree>`, `git stash pop`');
  }
  if (workspace.type === 'on-main-no-worktree') {
    out.push('  - Stay: set env `DEVOPS_ALLOW_MAIN=1` for this session to silence main-branch checks');
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

  if (hasFindings || workspace) {
    out.push(header(workspace));
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
    const stagedTypes = new Set(['uncommitted', 'unpushed']);
    const currentDirty = repos.find(r => r.dir === cwd);
    const hasChanges = currentDirty
      ? issuesOf(currentDirty).some(i => i && stagedTypes.has(i.type))
      : false;
    out.push(...askLines(workspace, hasChanges));
  }

  if (staleNote) {
    if (out.length > 0) out.push('');
    out.push(staleNote);
  }

  return out;
}

module.exports = { compose, issueLine, header, workspaceLines, askLines };
