const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { clearPluginEntries, cacheFile, WINDOW_MS } = require('./mcp-failure-cache');

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
      'plugin:devops:dotclaude-ship': { timestamp: now - 1000, id: 'c' },
      'plugin:devops:dotclaude-completion': { timestamp: now - WINDOW_MS - 1, id: 'd' },
    }));

    const res = clearPluginEntries(file, now);

    expect(res.cleared.sort()).toEqual(['plugin:devops:dotclaude-completion', 'plugin:devops:dotclaude-ship']);
    expect(res.active).toEqual(['plugin:devops:dotclaude-ship']);
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

    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [] });
    expect(fs.readFileSync(file, 'utf8')).toBe(body);
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });

  test('missing, unparsable or non-object cache is a no-op', () => {
    const home = tmpHome();
    const file = cacheFile(home);
    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [] });
    fs.writeFileSync(file, '{broken');
    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [] });
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
    fs.writeFileSync(file, '[1,2]');
    expect(clearPluginEntries(file)).toEqual({ cleared: [], active: [] });
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

  test('an active block is cleared and the user gets one restart note', () => {
    const home = tmpHome();
    fs.writeFileSync(cacheFile(home), JSON.stringify({
      'plugin:devops:dotclaude-ship': { timestamp: Date.now(), id: 'c' },
    }));
    const out = runHook(home);
    expect(out).toContain('[mcp-failcache]');
    expect(out).toContain('dotclaude-ship');
    expect(out).toContain('Show the user verbatim');
    expect(JSON.parse(fs.readFileSync(cacheFile(home), 'utf8'))).toEqual({});
  });

  test('an expired entry is cleared silently; no cache file is silent too', () => {
    const home = tmpHome();
    fs.writeFileSync(cacheFile(home), JSON.stringify({
      'plugin:devops:dotclaude-ship': { timestamp: Date.now() - WINDOW_MS - 1, id: 'c' },
    }));
    expect(runHook(home)).toBe('');
    expect(JSON.parse(fs.readFileSync(cacheFile(home), 'utf8'))).toEqual({});
    expect(runHook(tmpHome())).toBe('');
  });
});
