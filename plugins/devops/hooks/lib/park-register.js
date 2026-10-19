/**
 * @module hooks/lib/park-register
 * @description The park register. "Parked" = deliberately set-aside, UNLANDED
 *   work somebody wants to keep. The register is derived from refs — no state
 *   file. One prefix is canonical: `parked/<topic>`. Read-only aliases (never
 *   created any more, still recognized): `wip/`, `backup/`, `salvage/`, and
 *   any branch whose tip commit subject contains "ARCHIVED".
 *
 *   Shipped/landed branches are NEVER parked: they are landed leftovers and
 *   ship hygiene removes them. The caller (orphan-scan) filters landed
 *   branches out; this module only classifies names and reads refs.
 *
 *   Reason and date come from the tip commit (subject, committer date). An
 *   entry older than STALE_DAYS carries `stale: true` — orphan-scan's report
 *   turns that into the nudge "behalten, integrieren oder verwerfen".
 *   Git calls use argument arrays and fail soft (empty result).
 */

'use strict';

const { execFileSync } = require('child_process');

const PARKED_PREFIX = 'parked/';
const LEGACY_PREFIXES = ['wip/', 'backup/', 'salvage/'];
const STALE_DAYS = 30;
const DAY_MS = 86_400_000;
const NUDGE = 'behalten, integrieren oder verwerfen';

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

/**
 * Classify a branch. `subject` is the tip commit subject (optional).
 * @returns {{parked:boolean, legacy:boolean, topic:string|null}}
 */
function classify(name, subject = '') {
  const n = String(name || '');
  if (n.startsWith(PARKED_PREFIX)) return { parked: true, legacy: false, topic: n.slice(PARKED_PREFIX.length) };
  const legacy = LEGACY_PREFIXES.find((p) => n.startsWith(p));
  if (legacy) return { parked: true, legacy: true, topic: n.slice(legacy.length) };
  if (/ARCHIVED/.test(String(subject))) return { parked: true, legacy: true, topic: n };
  return { parked: false, legacy: false, topic: null };
}

function isParked(name, subject = '') {
  return classify(name, subject).parked;
}

/**
 * Every parked branch of the repo at `cwd`, newest first.
 * @returns {{branch:string, legacy:boolean, topic:string, sha:string, date:string, ageDays:number, reason:string, stale:boolean}[]}
 */
function listParked(cwd, now = Date.now()) {
  const out = git(['for-each-ref', 'refs/heads', 'refs/remotes/origin', '--format=%(refname)%09%(objectname)%09%(committerdate:unix)%09%(subject)'], cwd);
  if (!out) return [];
  const list = [];
  const locals = new Set();
  const lines = out.split('\n').map((l) => l.replace(/\r$/, '').split('\t')).filter(([r]) => r);
  for (const [ref] of lines) if (ref.startsWith('refs/heads/')) locals.add(ref.slice('refs/heads/'.length));
  for (const [ref, sha, ts, ...rest] of lines) {
    const remote = ref.startsWith('refs/remotes/origin/');
    if (!remote && !ref.startsWith('refs/heads/')) continue;
    const short = ref.replace(/^refs\/(?:heads|remotes\/origin)\//, '');
    if (remote && (short === 'HEAD' || locals.has(short))) continue; // a local twin is listed once
    const branch = remote ? `origin/${short}` : short;
    const subject = rest.join('\t');
    // remote-only refs count by prefix only (salvage copies); the subject rule is local
    const c = classify(short, remote ? '' : subject);
    if (!c.parked) continue;
    const ms = Number(ts) * 1000;
    const ageDays = Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / DAY_MS)) : 0;
    list.push({
      branch, remote, legacy: c.legacy, topic: c.topic, sha,
      date: Number.isFinite(ms) ? new Date(ms).toISOString() : '',
      ageDays, reason: subject, stale: ageDays > STALE_DAYS,
    });
  }
  return list.sort((a, b) => a.ageDays - b.ageDays);
}

/** Every prefix whose refs count as parked, local and remote-tracking (salvage copies live remote-only). */
const PARK_REF_PREFIXES = [PARKED_PREFIX, ...LEGACY_PREFIXES].flatMap((p) => [`refs/heads/${p}`, `refs/remotes/origin/${p}`]);

/**
 * A parked ref (local or origin/…) that covers `sha`: contains it (ancestor or
 * equal), or with `exact` points at exactly that commit. null when none.
 * Unit tips covered this way are the same work, kept elsewhere.
 */
function coveringRef(cwd, sha, { exact = false } = {}) {
  if (!sha) return null;
  const out = git(['for-each-ref', exact ? '--points-at' : '--contains', sha, '--format=%(refname)', ...PARK_REF_PREFIXES], cwd);
  const first = (out || '').split('\n').map((l) => l.trim()).filter(Boolean)[0];
  return first ? first.replace(/^refs\/(?:heads|remotes\/origin)\//, (m) => (m === 'refs/heads/' ? '' : 'origin/')) : null;
}

/** Stash entries of the repo (shared across its worktrees): [{ref, ageDays, message}]. */
function listStashes(cwd, now = Date.now()) {
  const out = git(['stash', 'list', '--format=%gd%x09%ct%x09%gs'], cwd);
  if (!out) return [];
  return out.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean).map((l) => {
    const [ref, ts, ...rest] = l.split('\t');
    return { ref, ageDays: Math.max(0, Math.floor((now - Number(ts) * 1000) / DAY_MS)), message: rest.join('\t') };
  });
}

module.exports = { coveringRef, PARKED_PREFIX, LEGACY_PREFIXES, STALE_DAYS, NUDGE, classify, isParked, listParked, listStashes };
