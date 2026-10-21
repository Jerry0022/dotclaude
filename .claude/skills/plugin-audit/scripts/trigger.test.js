import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { shouldRun } = require('./lib/trigger.js');

describe('plugin-audit trigger', () => {
  it('runs when the minor crosses a decade boundary (0.279 -> 0.280)', () => {
    expect(shouldRun({ prevVersion: '0.279.4', newVersion: '0.280.0', last: null }).run).toBe(true);
  });
  it('does not run inside a decade (0.280 -> 0.281)', () => {
    expect(shouldRun({ prevVersion: '0.280.0', newVersion: '0.281.0', last: null }).run).toBe(false);
  });
  it('runs for 0.289.3 -> 0.290.0', () => {
    expect(shouldRun({ prevVersion: '0.289.3', newVersion: '0.290.0', last: { version: '0.280.2', decade: 28 } }).run).toBe(true);
  });
  it('skips when a run is already recorded in the same decade (manual run)', () => {
    const r = shouldRun({ prevVersion: '0.289.3', newVersion: '0.290.0', last: { version: '0.290.0', decade: 29, ranAt: 'x' } });
    expect(r.run).toBe(false);
    expect(r.reason).toMatch(/already recorded/);
  });
  it('first run ever: boundary + no last -> run, reason says so', () => {
    const r = shouldRun({ prevVersion: '0.279.0', newVersion: '0.280.0', last: null });
    expect(r.run).toBe(true);
    expect(r.reason).toMatch(/first audit/);
  });
  it('a promotion (same version) never runs', () => {
    expect(shouldRun({ prevVersion: '0.290.0', newVersion: '0.290.0', last: null }).run).toBe(false);
  });
  it('unparseable versions do not run', () => {
    expect(shouldRun({ prevVersion: 'x', newVersion: '0.290.0' }).run).toBe(false);
  });
  it('CLI prints JSON and exits 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-trig-'));
    const r = spawnSync('node', [path.join(here, 'lib/trigger.js'), '--prev', '0.289.3', '--new', '0.290.0', '--state-dir', dir], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).run).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
