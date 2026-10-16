#!/usr/bin/env node
/**
 * @hook post.worktree.enter
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher EnterWorktree
 * @description Carries this session's live do-run contract along when the
 *   session moves from the repo's main checkout into its own worktree.
 *
 *   pre.edit.branch / pre.main.guard / ss.git.check send a session that sits
 *   in a (possibly shared) main checkout into its own worktree via
 *   EnterWorktree. Every run-contract reader looks the contract up in the
 *   session's CURRENT work-tree root, so a contract armed in the main
 *   checkout before the move would be left behind and the run would go on
 *   ungated. This hook moves it (lib/run-contract-store.js carryOver): only a
 *   contract and arm marker stored with THIS session's id, never one of
 *   another session sharing the checkout. Silent unless something moved;
 *   fail open.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

/** The main working tree a linked worktree belongs to, from its `.git` file — no git spawn. */
function mainCheckoutOf(wtRoot) {
  try {
    const dotGit = path.join(wtRoot, '.git');
    if (!fs.statSync(dotGit).isFile()) return null;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    const gitDir = path.resolve(wtRoot, m[1]);
    let common;
    try {
      common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
    } catch {
      common = path.resolve(gitDir, '..', '..'); // <common>/worktrees/<name>
    }
    return path.basename(common) === '.git' ? path.dirname(common) : null;
  } catch {
    return null;
  }
}

/** Paths the payload may name the new worktree by — the response shape is not pinned, so look broadly. */
function candidates(hook) {
  const out = [];
  const add = (v) => { if (typeof v === 'string' && v.trim()) out.push(v.trim()); };
  const r = hook.tool_response;
  if (r && typeof r === 'object') {
    add(r.worktreePath); add(r.worktree_path); add(r.path);
  }
  const text = typeof r === 'string' ? r : (r ? JSON.stringify(r) : '');
  const re = /[A-Za-z]:(?:\\\\|\\|\/)[^"'\s]*?\.claude(?:\\\\|\\|\/)worktrees(?:\\\\|\\|\/)[^"'\s\\/]+|\/[^"'\s]*?\/\.claude\/worktrees\/[^"'\s/]+/g;
  for (const hit of text.match(re) || []) add(hit.replace(/\\\\/g, '\\'));
  add(hook.tool_input && hook.tool_input.path);
  add(hook.cwd);
  return out;
}

function main(hook) {
  if ((hook.tool_name || '') !== 'EnterWorktree') return null;
  const sessionId = hook.session_id;
  if (!sessionId) return null;
  const { projectRoot, isLinkedWorktree } = require('../lib/project-root');
  const store = require('../lib/run-contract-store');
  for (const c of candidates(hook)) {
    const wt = projectRoot(c);
    if (!isLinkedWorktree(wt)) continue;
    const main = mainCheckoutOf(wt);
    if (!main) continue;
    const moved = store.carryOver(main, wt, sessionId);
    if (!moved) return null;
    return { context: `[run-contract] This session's do-run contract moved with it into ${wt} — its gates keep applying there.` };
  }
  return null;
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'PostToolUse' }); } catch { /* fail open */ }
}

module.exports = { main, mainCheckoutOf, candidates };
