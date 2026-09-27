'use strict';
/**
 * @module ship-checkpoint
 * @version 1.0.0
 * @plugin devops
 * @description Where an interrupted /do-ship left off, so the next run picks
 *   up at the step that did not finish instead of starting over.
 *
 *   A ship can die in the middle: the usage limit hits, the PC crashes, the
 *   session is closed. The sentinel (`.claude/.ship-in-progress`) only says
 *   *that* a ship was running, and it ages out after 60 min: a usage limit
 *   lasts hours. The checkpoint says *how far* it got. The ship MCP server
 *   writes it itself after every step, so no step depends on the model
 *   remembering to do it: preflight opens it, build/bump/release record their
 *   result, cleanup (called on every exit path) removes it. A delegated ship
 *   also stores the brief and the decisions the user already made, so a
 *   resumed run needs neither a new brief from the big context nor a second
 *   question.
 *
 *   File: `<repo root>/.claude/.ship-checkpoint.json` (project-root.js, like
 *   the sentinel). It carries the root and branch it belongs to: the Desktop
 *   app copies an untracked `.claude/` into every new worktree, and such a
 *   copy must never look like an open ship of the new worktree. Older than
 *   MAX_AGE_MS counts as abandoned.
 *
 *   Every function here is best effort and never throws — a checkpoint that
 *   cannot be written must never fail the ship step that triggered it.
 */

const fs = require('fs');
const path = require('path');
const { projectRoot } = require('./project-root');

const CHECKPOINT_REL = path.join('.claude', '.ship-checkpoint.json');
/** A week: long enough for a weekly usage limit, short enough that an
 *  abandoned ship does not haunt the branch forever. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The pipeline order the summary and `nextStep` walk. */
const STEPS = ['preflight', 'build', 'bump', 'release'];

function checkpointPath(cwd) {
  return path.join(projectRoot(cwd), CHECKPOINT_REL);
}

function samePath(a, b) {
  const na = path.resolve(a), nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** The raw checkpoint, or null. */
function readCheckpoint(cwd) {
  if (!cwd) return null;
  try {
    const data = JSON.parse(fs.readFileSync(checkpointPath(cwd), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function writeCheckpoint(cwd, data) {
  try {
    const p = checkpointPath(cwd);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ...data, updatedAt: Date.now() }, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function clearCheckpoint(cwd) {
  try { fs.unlinkSync(checkpointPath(cwd)); return true; } catch { return false; }
}

/**
 * The checkpoint of an unfinished ship that belongs to THIS work tree (and,
 * when given, this branch), or null.
 * @param {string} cwd
 * @param {{ branch?: string|null, now?: number }} [o]
 */
function openCheckpoint(cwd, { branch = null, now = Date.now() } = {}) {
  const cp = readCheckpoint(cwd);
  if (!cp || !cp.steps || !cp.root) return null;
  if (!samePath(cp.root, projectRoot(cwd))) return null;
  if (branch && cp.branch && cp.branch !== branch) return null;
  if (typeof cp.updatedAt === 'number' && now - cp.updatedAt > MAX_AGE_MS) return null;
  return cp;
}

/** First pipeline step that has not finished, or 'cleanup' when all did. */
function nextStep(cp) {
  const steps = (cp && cp.steps) || {};
  for (const s of STEPS) {
    if (s === 'release' ? !(steps.release && steps.release.merged) : !steps[s]) return s;
  }
  return 'cleanup';
}

/** "preflight ✓ · build ✓ · bump 1.0.0 → 1.1.0 ✓ · release (next)" */
function describeCheckpoint(cp) {
  const steps = (cp && cp.steps) || {};
  const next = nextStep(cp);
  const parts = STEPS.map((s) => {
    const st = steps[s];
    let label = s;
    if (s === 'bump' && st && st.vNew) label = `bump ${st.vOld} → ${st.vNew}`;
    if (s === 'release' && st) {
      const bits = [st.pr ? `PR #${st.pr}` : '', st.commit ? `commit ${st.commit}` : '', st.merged ? `merged into ${st.merged}` : 'not merged'].filter(Boolean);
      label = `release (${bits.join(', ')})`;
    }
    if (s === next) return `${label} ← next`;
    return (s === 'release' ? st && st.merged : st) ? `${label} ✓` : label;
  });
  if (next === 'cleanup') parts.push('cleanup + card ← next');
  return parts.join(' · ');
}

/** Picks the release fields a resumed run needs, success or not. */
function releaseFacts(result) {
  const out = {};
  for (const k of ['commit', 'pr', 'prNumber', 'prUrl', 'merged', 'mergeSha', 'tag', 'delivered', 'pushed']) {
    if (result[k] !== undefined && result[k] !== null) out[k === 'prNumber' ? 'pr' : k] = result[k];
  }
  if (out.pr && typeof out.pr === 'object' && out.pr.number) out.pr = out.pr.number;
  return out;
}

/**
 * Record what one ship MCP tool just did. Called by the ship server after
 * every handler; never throws.
 * @param {string} tool — "ship_preflight" | "ship_build" | …
 * @param {object} params — the tool's input (needs `cwd`)
 * @param {object} result — the tool's result
 * @param {{ now?: number }} [o]
 */
function recordShipStep(tool, params, result, { now = Date.now() } = {}) {
  try {
    const cwd = params && params.cwd;
    if (!cwd || !result || typeof result !== 'object') return;
    if (tool === 'ship_cleanup') {
      if (result.success) clearCheckpoint(cwd);
      return;
    }
    const root = projectRoot(cwd);
    if (tool === 'ship_preflight') {
      if (!result.ready) return;
      const prev = openCheckpoint(cwd, { branch: result.branch, now });
      writeCheckpoint(cwd, prev
        ? { ...prev, base: result.base || prev.base, last: tool }
        : { v: 1, root, branch: result.branch || null, base: result.base || null, startedAt: now, steps: { preflight: true }, decisions: [], last: tool });
      return;
    }
    const cp = openCheckpoint(cwd, { now });
    if (!cp) return; // no preflight in this ship → nothing to track
    const steps = { ...cp.steps };
    if (tool === 'ship_build') {
      if (params.buildIdOnly) return;
      if (result.success) steps.build = { buildId: result.buildId || null };
    } else if (tool === 'ship_version_bump') {
      // A bump whose verification failed has still rewritten the version
      // files (typically only CHANGELOG lags behind). It counts as landed —
      // a resumed run that bumped again would skip a whole version.
      const touched = Array.isArray(result.filesUpdated) && result.filesUpdated.some((f) => f && f.updated);
      if (result.vNew && (result.success || touched)) {
        steps.bump = { bump: result.bump || null, vOld: result.vOld || null, vNew: result.vNew, ...(result.success ? {} : { verified: false, mismatches: result.mismatches || [] }) };
      }
    } else if (tool === 'ship_release') {
      const facts = releaseFacts(result);
      if (Object.keys(facts).length) steps.release = { ...(steps.release || {}), ...facts };
    } else if (tool === 'ship_promote') {
      if (result.success) steps.promote = { channel: result.channel || params.channel || null };
    } else {
      return;
    }
    writeCheckpoint(cwd, {
      ...cp, steps, last: tool,
      ...(result.success === false ? { lastError: { tool, at: now, error: String(result.error || result.reason || '').slice(0, 300) } } : {}),
    });
  } catch { /* never fail the ship step */ }
}

/** Store the delegated ship's brief (first write wins unless replace). */
function setBrief(cwd, brief, { replace = false } = {}) {
  const cp = openCheckpoint(cwd);
  if (!cp) return false;
  if (cp.brief && !replace) return true;
  return writeCheckpoint(cwd, { ...cp, brief: String(brief || '').slice(0, 20000), delegated: true });
}

/** Remember a decision the user made, so a resumed run does not ask again. */
function addDecision(cwd, question, answer) {
  const cp = openCheckpoint(cwd);
  if (!cp) return false;
  const decisions = Array.isArray(cp.decisions) ? cp.decisions.slice() : [];
  decisions.push({ question: String(question || '').slice(0, 500), answer: String(answer || '').slice(0, 200) });
  return writeCheckpoint(cwd, { ...cp, decisions });
}

module.exports = {
  CHECKPOINT_REL, MAX_AGE_MS, STEPS,
  checkpointPath, readCheckpoint, writeCheckpoint, clearCheckpoint, openCheckpoint,
  nextStep, describeCheckpoint, recordShipStep, setBrief, addDecision,
};
