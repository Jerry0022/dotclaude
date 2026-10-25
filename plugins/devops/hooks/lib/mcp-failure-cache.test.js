const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { clearPluginEntries, classify, cacheFile, WINDOW_MS, OWN_SLACK_MS } = require('./mcp-failure-cache');

const HOOK = path.join(__dirname, '..', 'session-start', 'ss.mcp.failcache.js');

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'failcache-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}

describe('clearPluginEntries (#mcp failure cache, 2026-10-01)', () => {
  test('removes only plugin:devops:* keys and keeps every other server', () => {
    const home = tmpHome();
    const file = cacheFile(home);
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({
      'claude.ai Readme.io': { timestamp: now, id: 'a' },
      'plugin:playwright:playwright': { timestamp: now, id: 'b' },
      'plugin:devops:dotclaude': { timestamp: now - 1000, id: 'c' },
      'plugin:devops:context7': { timestamp: now - WINDOW_MS - 1, id: 'd' },
    }));

    const res = clearPluginEntries(file, now);

    expect(res.cleared.sort()).toEqual(['plugin:devops:context7', 'plugin:devops:dotclaude']);
    expect(res.active).toEqual(['plugin:devops:dotclaude']);
    expect(res.activeEntries).toEqual([{ key: 'plugin:devops:dotclaude', ts: now - 1000 }]);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort())
      .toEqual(['claude.ai Readme.io', 'plugin:playwright:playwright']);
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('no plugin entries → the file is not rewritten', () => {
    const home = tmpHome();
    const file = cacheFile(home);
    const body = '{"x":{"timestamp":1}}';
    fs.writeFileSync(file, body);
    const before = fs.statSync(file).mtimeMs;

    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [], activeEntries: [] });
    expect(fs.readFileSync(file, 'utf8')).toBe(body);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  test('missing, unparsable or non-object cache is a no-op', () => {
    const home = tmpHome();
    const file = cacheFile(home);
    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [], activeEntries: [] });
    fs.writeFileSync(file, '{broken');
    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [], activeEntries: [] });
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
    fs.writeFileSync(file, '[1,2]');
    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [], activeEntries: [] });
  });
});

describe('classify — own vs. foreign failure (#823)', () => {
  const start = 1_000_000_000;
  test('no entries → none', () => {
    expect(classify([], start)).toBe('none');
    expect(classify(undefined, start)).toBe('none');
  });
  test('an entry at or after the start (minus slack) is this session\'s own', () => {
    expect(classify([{ ts: start + 5000 }], start)).toBe('own');
    expect(classify([{ ts: start - OWN_SLACK_MS }], start)).toBe('own');
    expect(classify([{ ts: start - 10 * 60_000 }, { ts: start + 1 }], start)).toBe('own');
  });
  test('only when every entry predates the start is it foreign', () => {
    expect(classify([{ ts: start - OWN_SLACK_MS - 1 }, { ts: start - 5 * 60_000 }], start)).toBe('foreign');
  });
});

describe('ss.mcp.failcache hook', () => {
  function runHook(home) {
    return execFileSync(process.execPath, [HOOK], {
      // A plugin root outside the temp HOME's install cache passes plugin-guard
      // as an ad-hoc load (the temp HOME has no settings enabling devops).
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: path.join(__dirname, '..', '..') },
      encoding: 'utf8',
    });
  }

  test('an active block is cleared and the user gets a first-reply note with the offline paths', () => {
    const home = tmpHome();
    fs.writeFileSync(cacheFile(home), JSON.stringify({
      'plugin:devops:dotclaude': { timestamp: Date.now(), id: 'c' },
    }));
    const out = runHook(home);
    expect(out).toContain('[mcp-failcache]');
    expect(out).toContain('dotclaude');
    expect(out).toContain('In your FIRST reply, before any other work');
    expect(out).toContain('mcp-server/ship/cli.js" <tool> <params.json>');
    expect(out).toContain('never a manual ship');
    // written now = this session's own boot failure: neutral, no other session named
    expect(out).toContain('failed to connect in this session');
    expect(out).toContain('mcp-logs-plugin-devops-');
    expect(out).not.toMatch(/Another session/);
    expect(JSON.parse(fs.readFileSync(cacheFile(home), 'utf8'))).toEqual({});
  });

  test('an entry that predates this start names the other session, with the same offline hints', () => {
    const home = tmpHome();
    fs.writeFileSync(cacheFile(home), JSON.stringify({
      'plugin:devops:dotclaude': { timestamp: Date.now() - 5 * 60_000, id: 'c' },
    }));
    const out = runHook(home);
    expect(out).toContain("Another session's connect timeout");
    expect(out).toContain('mcp-server/ship/cli.js" <tool> <params.json>');
    expect(out).toContain('--render-card');
  });

  test('an expired entry is cleared silently; no cache file is silent too', () => {
    const home = tmpHome();
    fs.writeFileSync(cacheFile(home), JSON.stringify({
      'plugin:devops:dotclaude': { timestamp: Date.now() - WINDOW_MS - 1, id: 'c' },
    }));
    expect(runHook(home)).toBe('');
    expect(JSON.parse(fs.readFileSync(cacheFile(home), 'utf8'))).toEqual({});
    expect(runHook(tmpHome())).toBe('');
  });
});
