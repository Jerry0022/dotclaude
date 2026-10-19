#!/usr/bin/env node
/**
 * @hook substop.agent.wip
 * @version 0.1.0
 * @event SubagentStop
 * @plugin devops
 * @description A finished agent that ran in an isolated worktree
 *   (.claude/worktrees/agent-*) and left uncommitted work gets it committed
 *   there as `wip(agent): uncommitted result of <agent>` on the agent's own
 *   branch (a detached HEAD gets branch wip/agent-<id>; main/master/default
 *   are never committed to). The parent hears branch + worktree as additional
 *   context, so the result is not left as an unpicked-up dirty tree.
 *   Never fails the stop: every error path exits 0 silently, git is bounded.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { runHook } = require('../lib/hook-input');
const { wipCommit } = require('../lib/wip-commit');
const { listWorktrees } = require('../lib/integration-check');

const AGENT_WT = /^(.*[\\/]\.claude[\\/]worktrees[\\/]agent-[^\\/]+)/i;

function isLinkedWorktree(p) {
  try { return fs.statSync(path.join(p, '.git')).isFile(); } catch { return false; }
}

function fromTranscript(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = /"cwd":\s*("(?:[^"\\]|\\.)*")/.exec(buf.toString('utf8', 0, n));
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

/** The agent's worktree path, or null when it did not run in an isolated one. */
function findAgentWorktree(hook) {
  const cands = [hook.cwd, fromTranscript(hook.agent_transcript_path)];
  for (const c of cands) {
    const m = typeof c === 'string' && AGENT_WT.exec(c);
    if (m && isLinkedWorktree(m[1])) return m[1];
  }
  if (hook.agent_id && hook.cwd) {
    const id = String(hook.agent_id).replace(/[^\w-]/g, '');
    const hit = id && listWorktrees(hook.cwd).find((w) => AGENT_WT.test(w.path) && w.path.replace(/\\/g, '/').endsWith(`/agent-${id}`));
    if (hit && isLinkedWorktree(hit.path)) return hit.path;
  }
  return null;
}

function main(hook) {
  const wt = findAgentWorktree(hook);
  if (!wt) return null;
  const agent = String(hook.agent_type || hook.agent_id || 'agent').replace(/[\r\n]+/g, ' ').slice(0, 60);
  const id = String(hook.agent_id || path.basename(wt).replace(/^agent-/, '')).replace(/[^\w-]/g, '');
  const res = wipCommit(wt, `wip(agent): uncommitted result of ${agent}`, { detached: `branch:wip/agent-${id}` });
  if (!res.committed) return null;
  const short = (res.sha || '').slice(0, 8);
  return {
    context: `[devops] Agent ${agent} left uncommitted work; saved as WIP commit ${short} on branch ${res.branch} in worktree ${wt}. `
      + 'Integrate that branch (merge/cherry-pick) before reporting done — it is not in your branch yet.',
  };
}

module.exports = { main, findAgentWorktree };

if (require.main === module) {
  try {
    runHook(main, { event: 'SubagentStop' });
  } catch {
    // fail open
  }
}

