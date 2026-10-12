import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { sweepTmp, isSweepable, TTL_MS, STAMP } = require('./tmp-sweep.js');

let dir;
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const OLD = (NOW - TTL_MS - 60_000) / 1000;
const FRESH = (NOW - 60_000) / 1000;

function file(name, mtimeSec) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, 'x');
  fs.utimesSync(p, mtimeSec, mtimeSec);
  return p;
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmpsweep-test-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('tmp-sweep (#699)', () => {
  test('removes old dotclaude-* markers, keeps fresh ones and foreign files', () => {
    const oldA = file('dotclaude-graphlastblocked-abc.json', OLD);
    const oldB = file('dotclaude-ss-knowledge-index-sess1', OLD);
    const oldC = file('dotclaude-budget-tier-vitest-dispatch-123-x', OLD);
    const fresh = file('dotclaude-devops-card-rendered-sess2', FRESH);
    const foreign = file('someone-else-old.tmp', OLD);
    const r = sweepTmp({ dir, now: NOW, force: true });
    expect(r.ran).toBe(true);
    expect(r.removed).toBe(3);
    for (const p of [oldA, oldB, oldC]) expect(fs.existsSync(p)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  test('never touches durable state or live-process bookkeeping, however old', () => {
    const kept = [
      'dotclaude-team-changelog-abc123',
      'dotclaude-locale',
      'dotclaude-locale-b1',
      'dotclaude-mcp-dotclaude-ship-4711.pid',
      'dotclaude-mcp-reap-status.json',
      'dotclaude-inuse-0.258.3',
      'dotclaude-graphupdate-abc.lock',
    ].map((n) => file(n, OLD));
    sweepTmp({ dir, now: NOW, force: true });
    for (const p of kept) expect(fs.existsSync(p)).toBe(true);
  });

  test('old cacherebuild scratch dirs go, other dotclaude dirs stay', () => {
    const rebuild = path.join(dir, 'dotclaude-cacherebuild-AbC123');
    const hb = path.join(dir, 'dotclaude-mcp-heartbeats');
    const other = path.join(dir, 'dotclaude-somedir');
    for (const d of [rebuild, hb, other]) {
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, 'f'), 'x');
      fs.utimesSync(d, OLD, OLD);
    }
    sweepTmp({ dir, now: NOW, force: true });
    expect(fs.existsSync(rebuild)).toBe(false);
    expect(fs.existsSync(hb)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
  });

  test('throttled: a second run inside the window does nothing', () => {
    const first = sweepTmp({ dir, now: NOW });
    expect(first.ran).toBe(true);
    const p = file('dotclaude-graphq-old', OLD);
    const second = sweepTmp({ dir, now: NOW + 60_000 });
    expect(second.ran).toBe(false);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.existsSync(path.join(dir, STAMP))).toBe(true);
  });

  test('a missing dir never throws', () => {
    expect(() => sweepTmp({ dir: path.join(dir, 'nope'), now: NOW, force: true })).not.toThrow();
  });

  test('isSweepable: only the plugin prefix, never the stamp', () => {
    expect(isSweepable('dotclaude-graphq-1')).toBe(true);
    expect(isSweepable(STAMP)).toBe(false);
    expect(isSweepable('claude_confirm_x.flag')).toBe(false);
  });
});
