const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const C = require('./anythingllm-config');
const H = require('./anythingllm-http');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmcfg-')); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

function layers(project, user) {
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(path.join(proj, '.claude', 'local-llm'), { recursive: true });
  if (project) fs.writeFileSync(path.join(proj, '.claude', 'local-llm', 'config.json'), JSON.stringify(project));
  const userPath = path.join(dir, 'user.json');
  if (user) fs.writeFileSync(userPath, JSON.stringify(user));
  const warnings = [];
  const cfg = C.resolveConfig({ cwd: proj, userConfigPath: userPath, onWarn: (m) => warnings.push(m) });
  return { cfg, warnings };
}

describe('isLoopbackUrl', () => {
  it.each([
    'http://localhost:3001', 'http://LOCALHOST:3001/', 'https://127.0.0.1', 'http://127.5.6.7:9', 'http://[::1]:3001',
  ])('accepts %s', (u) => expect(C.isLoopbackUrl(u)).toBe(true));
  it.each([
    'http://evil.example:3001', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://128.0.0.1',
    'http://127.0.0.256', 'http://10.0.0.5', 'http://0.0.0.0', 'ftp://localhost', 'file:///etc/passwd', '', 42, null,
  ])('rejects %s', (u) => expect(C.isLoopbackUrl(u)).toBe(false));
});

describe('resolveConfig: project baseUrl only on loopback (G1)', () => {
  it('ignores a foreign project baseUrl with a warning and keeps the user-level value', () => {
    const { cfg, warnings } = layers({ anythingllm: { baseUrl: 'http://attacker.example:80', workspaceSlug: 'proj' } }, { anythingllm: { baseUrl: 'http://127.0.0.1:4000', apiKey: 'k' } });
    expect(cfg.anythingllm.baseUrl).toBe('http://127.0.0.1:4000');
    expect(cfg.anythingllm.apiKey).toBe('k');
    expect(cfg.anythingllm.workspaceSlug).toBe('proj');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ignoring anythingllm\.baseUrl.*attacker\.example.*loopback/);
  });

  it('falls back to the plugin default when only the project names a foreign host', () => {
    const { cfg, warnings } = layers({ anythingllm: { baseUrl: 'https://evil.example' } }, null);
    expect(cfg.anythingllm.baseUrl).not.toBe('https://evil.example');
    expect(warnings).toHaveLength(1);
  });

  it('honours a loopback project baseUrl without a warning', () => {
    const { cfg, warnings } = layers({ anythingllm: { baseUrl: 'http://localhost:3999' } }, { anythingllm: { apiKey: 'k' } });
    expect(cfg.anythingllm.baseUrl).toBe('http://localhost:3999');
    expect(warnings).toEqual([]);
  });

  it('still never takes the API key from the project layer', () => {
    const { cfg } = layers({ anythingllm: { apiKey: 'leaked' } }, { anythingllm: { apiKey: 'mine' } });
    expect(cfg.anythingllm.apiKey).toBe('mine');
  });
});

describe('workspace slug is URL-encoded (G1)', () => {
  let server; let seen; let base;
  beforeEach(async () => {
    seen = [];
    server = http.createServer((req, res) => { seen.push(req.url); res.setHeader('Content-Type', 'application/json'); res.end('{"workspace":{}}'); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(() => new Promise((r) => server.close(r)));

  it('getWorkspace / updateWorkspace keep a hostile slug inside its path segment', async () => {
    await H.getWorkspace(base, 'k', '../admin?x=1#y');
    await H.updateWorkspace(base, 'k', 'a/b', {});
    expect(seen).toEqual(['/api/v1/workspace/..%2Fadmin%3Fx%3D1%23y', '/api/v1/workspace/a%2Fb/update']);
  });
});
