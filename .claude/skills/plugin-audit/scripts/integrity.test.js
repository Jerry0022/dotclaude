import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { checkReferences, sizeTrend, wiring, mcpDepsMissing } = require('./lib/integrity.js');
const { hookCommandPath } = require('./lib/util.js');
const { frontmatter, mcpToolsOfSource } = require('./lib/footprint.js');

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-int-'));
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return root;
}

describe('plugin-audit integrity', () => {
  it('reference check finds missing {PLUGIN_ROOT} paths, dead md links and unknown skill names', () => {
    const root = tree({
      'plugins/devops/skills/foo/SKILL.md': '---\nname: foo\ndescription: x\n---\n',
      'plugins/devops/agents/bar.md': '---\nname: bar\ndescription: y\n---\n',
      'plugins/devops/deep-knowledge/a.md': [
        'ok `{PLUGIN_ROOT}/deep-knowledge/a.md` and agent devops:bar and skill devops:foo',
        'bad {PLUGIN_ROOT}/deep-knowledge/missing.md here',
        'link [dead](nope.md) and [alive](a.md#x) and [web](https://x.y/z.md)',
        'ghost devops:ghost-skill',
        '<!--devops:count:skills-->',
        '```',
        '{PLUGIN_ROOT}/in/fence.md',
        '```',
      ].join('\n'),
    });
    const msgs = checkReferences(root).map((f) => f.msg);
    expect(msgs).toContain('{PLUGIN_ROOT}/deep-knowledge/missing.md does not exist');
    expect(msgs).toContain('relative link nope.md does not resolve');
    expect(msgs).toContain('devops:ghost-skill names no skill or agent');
    expect(msgs.some((m) => /in\/fence/.test(m))).toBe(false);
    expect(msgs.some((m) => /devops:(bar|foo|count)/.test(m))).toBe(false);
    expect(msgs).toHaveLength(3);
    const f = checkReferences(root).find((x) => /missing\.md/.test(x.msg));
    expect(f.file).toBe('plugins/devops/deep-knowledge/a.md');
    expect(f.line).toBe(2);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('size trend flags growth over 10 percent against the previous audit', () => {
    const root = tree({ 'plugins/devops/skills/foo/SKILL.md': 'x'.repeat(2000) });
    const green = sizeTrend(root, { previousSizes: { skills: { bytes: 1950 }, hooks: { bytes: 0 }, deepKnowledge: { bytes: 0 } } });
    expect(green.status).toBe('green');
    const yellow = sizeTrend(root, { previousSizes: { skills: { bytes: 1000 } } });
    expect(yellow.status).toBe('yellow');
    expect(sizeTrend(root, { previousSizes: null }).findings[0].msg).toMatch(/baseline/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('plugin-audit footprint parsing', () => {
  it('parses folded frontmatter descriptions', () => {
    const fm = frontmatter('---\nname: x\nversion: 1\ndescription: >-\n  one two\n  three\n---\nbody');
    expect(fm.name).toBe('x');
    expect(fm.description).toBe('one two three');
  });
  it('counts registerTool head text but not the handler', () => {
    const items = mcpToolsOfSource('registerTool("t1", "Title", "A description", { a: z.string().describe("desc a") }, async (p) => { return "handler body ignored ".repeat(50); });', 'x.js');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('t1');
    expect(items[0].chars).toBeLessThan(120);
  });
});

describe('plugin-audit hook command paths and MCP deps', () => {
  it('extracts the script path from quoted commands with args', () => {
    expect(hookCommandPath('node "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch/dispatch.js" PreToolUse')).toBe('hooks/dispatch/dispatch.js');
    expect(hookCommandPath('node ${CLAUDE_PLUGIN_ROOT}/hooks/a.js')).toBe('hooks/a.js');
    expect(hookCommandPath('echo hi')).toBeNull();
  });

  it('wiring does not report quoted existing hook files as missing', () => {
    const root = tree({
      'plugins/devops/hooks/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch/dispatch.js" PreToolUse' }] }] } }),
      'plugins/devops/hooks/dispatch/dispatch.js': '',
    });
    const r = wiring(root);
    expect(r.findings.filter((f) => /missing/.test(f.msg))).toEqual([]);
  });

  it('detects MCP servers without node_modules', () => {
    const root = tree({
      'plugins/devops/mcp-server/package.json': '{}',
      'plugins/other/mcp-server/package.json': '{}',
      'plugins/other/mcp-server/node_modules/.keep': '',
    });
    expect(mcpDepsMissing(root).map((d) => path.relative(root, d).replace(/\\/g, '/'))).toEqual(['plugins/devops/mcp-server']);
  });
});
