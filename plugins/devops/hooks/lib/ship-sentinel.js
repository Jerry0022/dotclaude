#!/usr/bin/env node
/**
 * @module ship-sentinel
 * @version 0.1.0
 * @description Shared helper for the ship-in-progress sentinel file.
 *   The sentinel lets Bash-scoped guards (pre.main.guard, pre.edit.branch)
 *   know when the ship pipeline is running so Claude's Bash fallback retries
 *   are not blocked while ship is legitimately touching main.
 *
 *   The file lives at <cwd>/.claude/.ship-in-progress and contains a JSON
 *   payload with a timestamp + pid. It is stale after SENTINEL_MAX_AGE_MS
 *   (15 min) to avoid deadlocks if cleanup never ran.
 */

const fs = require('fs');
const path = require('path');

const SENTINEL_REL = path.join('.claude', '.ship-in-progress');
const SENTINEL_MAX_AGE_MS = 15 * 60 * 1000;

function sentinelPath(cwd) {
  return path.join(cwd || process.cwd(), SENTINEL_REL);
}

function write(cwd) {
  const p = sentinelPath(cwd);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ts: Date.now(), pid: process.pid }), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function clear(cwd) {
  const p = sentinelPath(cwd);
  try { fs.unlinkSync(p); return true; } catch { return false; }
}

function isActive(cwd) {
  const p = sentinelPath(cwd);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.ts !== 'number') return false;
    if (Date.now() - data.ts > SENTINEL_MAX_AGE_MS) {
      try { fs.unlinkSync(p); } catch {}
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { write, clear, isActive, sentinelPath, SENTINEL_REL, SENTINEL_MAX_AGE_MS };
