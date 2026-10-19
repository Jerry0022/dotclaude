#!/usr/bin/env node
/**
 * @hook substop.agent.wip
 * @version 0.2.0
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
const { parseHookInput, contextOutput } = require('../lib/hook-input');
const { wipCommit } = require('../lib/wip-commit');
const { listWorktrees, loadHygiene } = require('../lib/integration-check');

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

/**
 * The agent's worktree path, or null when it did not run in an isolated one.
 * With an agent_id only the worktree derived from it counts (hook.cwd or the
 * transcript cwd must then name the same worktree); without one, hook.cwd.
 */
function findAgentWorktree(hook) {
  const id = hook.agent_id ? String(hook.agent_id).replace(/[^\w-]/g, '') : '';
  const wanted = (p) => !id || path.basename(p).toLowerCase() === `agent-${id}`.toLowerCase();
  if (id && hook.cwd) {
    const hit = listWorktrees(hook.cwd).find((w) => AGENT_WT.test(w.path) && w.path.split('\\').join('/').endsWith(`/agent-${id}`));
    if (hit && isLinkedWorktree(hit.path)) return hit.path;
  }
  for (const c of [hook.cwd, fromTranscript(hook.agent_transcript_path)]) {
    const m = typeof c === 'string' && AGENT_WT.exec(c);
    if (m && isLinkedWorktree(m[1]) && wanted(m[1])) return m[1];
  }
  return null;
}

/** Another live session (not this agent's transcript) wrote for this worktree within `ms`. */
async function touchedByOtherSession(wt, hook, ms = 60000, now = Date.now(), projectsDir = null) {
  try {
    const hyg = await loadHygiene();
    if (!hyg) return false;
    const dir = projectsDir || hyg.defaultProjectsDir();
    const own = hook.agent_transcript_path ? path.resolve(hook.agent_transcript_path).toLowerCase() : null;
    for (const name of hyg.transcriptDirNames(wt)) {
      let files;
      try { files = fs.readdirSync(path.join(dir, name)); } catch { continue; }
      for (const f of files) {
        const full = path.join(dir, name, f);
        if (!f.endsWith('.jsonl') || path.resolve(full).toLowerCase() === own) continue;
        if (now - fs.statSync(full).mtimeMs < ms) return true;
      }
    }
  } catch { /* unknown -> not touched */ }
  return false;
}

async function main(hook) {
  const wt = findAgentWorktree(hook);
  if (!wt) return null;
  if (await touchedByOtherSession(wt, hook)) return null;
  const agent = String(hook.agent_type || hook.agent_id || 'agent').replace(/[\r\n]+/g, ' ').slice(0, 60);
  const id = String(hook.agent_id || path.basename(wt).replace(/^agent-/, '')).replace(/[^\w-]/g, '');
  const res = await wipCommit(wt, `wip(agent): uncommitted result of ${agent}`, { detached: `branch:wip/agent-${id}` });
  if (!res.committed) return null;
  const short = (res.sha || '').slice(0, 8);
  const left = res.skipped && res.skipped.length ? ` ${res.skipped.length} file(s) left out (secrets/build output/large) — still in the worktree.` : '';
  return {
    context: `[devops] Agent ${agent} left uncommitted work; saved as WIP commit ${short} on branch ${res.branch} in worktree ${wt}. `
      + `Integrate that branch (merge/cherry-pick) before reporting done — it is not in your branch yet.${left}${res.indexSynced === false ? ' The worktree index could not be realigned with the new commit — run `git reset` there before using it.' : ''}`,
  };
}

module.exports = { main, findAgentWorktree, touchedByOtherSession };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', async () => {
    try {
      const hook = parseHookInput(raw);
      const reply = hook ? await main(hook) : null;
      if (reply && reply.context) process.stdout.write(`${contextOutput('SubagentStop', reply.context)}
`);
    } catch {
      // fail open
    }
    process.exitCode = 0;
  });
}
