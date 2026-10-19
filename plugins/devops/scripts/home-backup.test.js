import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const hb = require('./home-backup.js');
const config = require('../hooks/lib/devops-config');
const { sha256 } = require('./lib/backup-scan.js');

const FAKE_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const NOW = () => new Date('2026-10-19T12:30:00.000Z');

let tmp;
let home;
let claude;
let bare;
let notify;

const sh = (cmd, args, cwd) => hb.defaultRun(cmd, args, { cwd });
const write = (rel, content = 'hello\n') => {
  const abs = path.join(claude, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};
const remoteFiles = () => {
  const r = sh('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main'], tmp);
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
};
const remoteCommits = () => {
  const r = sh('git', ['--git-dir', bare, 'log', '--format=%an|%ae|%cn|%ce|%s', 'main'], tmp);
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
};
const opts = (extra = {}) => ({ home, now: NOW, notify, ...extra });

function prepareHome() {
  fs.mkdirSync(claude, { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], claude);
  sh('git', ['remote', 'add', 'origin', bare], claude);
  fs.writeFileSync(path.join(claude, '.gitignore'), hb.renderGitignore());
  config.setValue('homeBackup.enabled', true, 'global', home, { home });
  config.setValue('homeBackup.repo', 'octo/claude-home', 'global', home, { home });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  home = path.join(tmp, 'home');
  claude = path.join(home, '.claude');
  bare = path.join(tmp, 'remote.git');
  sh('git', ['init', '-q', '--bare', '-b', 'main', bare], tmp);
  notify = vi.fn();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const INCLUDED = [
  'CLAUDE.md', 'settings.json', 'settings.local.json', 'keybindings.json', 'output-styles/s.md',
  'agents/a.md', 'skills/mine/SKILL.md', 'commands/x.md', 'projects/p1/memory/MEMORY.md',
  'scripts/foo.js', 'statusline-x.js', 'statusline.sh', 'delegation.json', 'devops-config.json',
  '.backupallow', '.gitignore',
];
const EXCLUDED = [
  '.credentials.json', 'devops-api.env', 'projects/p1/chat.jsonl', 'projects/p1/notes.txt', 'cache/x',
  'plugins/m/y.js', 'history.jsonl', 'skills/synced/a.md', 'file-history/a', 'foo.log', 'my-token.json',
  'skills/mine/secret.md', 'projects/p1/memory/credentials.md', 'random.txt', 'home-backup-report.json',
  'home-backup-report.txt', 'home-backup.log', 'debug/x', 'edge-1-profile/x', 'sub/.env', 'agents/prod.env',
  'telemetry/t', 'todos/t', 'logs/l', 'backups/b', 'statsig/s', 'ide/i', 'session-env/e', 'shell-snapshots/s',
];

describe('allowlist .gitignore', () => {
  it('starts deny-by-default and ends with the never patterns', () => {
    const lines = hb.renderGitignore().split('\n').filter((l) => l && !l.startsWith('#'));
    expect(lines[0]).toBe('/*');
    expect(lines.indexOf('**/*token*')).toBeGreaterThan(lines.indexOf('!/scripts/'));
  });

  it('includes and excludes the right paths according to git check-ignore', () => {
    fs.mkdirSync(claude, { recursive: true });
    sh('git', ['init', '-q'], claude);
    fs.writeFileSync(path.join(claude, '.gitignore'), hb.renderGitignore());
    const ignored = (p) => sh('git', ['check-ignore', '-q', p], claude).status === 0;
    for (const p of INCLUDED) expect(ignored(p), `${p} should be backed up`).toBe(false);
    for (const p of EXCLUDED) expect(ignored(p), `${p} should be ignored`).toBe(true);
  });

  it('has a code-level denylist that agrees on every never path', () => {
    for (const p of EXCLUDED.filter((x) => !['random.txt', 'projects/p1/notes.txt', 'skills/synced/a.md'].includes(x))) {
      expect(hb.isDenied(p), p).toBe(true);
    }
    for (const p of INCLUDED) expect(hb.isDenied(p), p).toBe(false);
  });
});

describe('run', () => {
  it('does nothing when disabled', () => {
    const run = vi.fn();
    const res = hb.runBackup(opts({ run }));
    expect(res).toMatchObject({ code: 0, status: 'disabled' });
    expect(run).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('commits and pushes the allowlisted files only, with a fixed identity', () => {
    prepareHome();
    write('CLAUDE.md', '# my rules\n');
    write('agents/a.md', 'agent\n');
    write('projects/p1/memory/MEMORY.md', 'memory\n');
    write('.credentials.json', '{"oauth":"x"}');
    write('cache/big', 'x');
    write('projects/p1/chat.jsonl', '{}');
    write('skills/synced/plug.md', 'plugin');
    const res = hb.runBackup(opts());
    expect(res).toMatchObject({ code: 0, status: 'pushed' });
    const files = remoteFiles();
    expect(files).toEqual(expect.arrayContaining(['CLAUDE.md', 'agents/a.md', 'projects/p1/memory/MEMORY.md', '.gitignore', 'devops-config.json']));
    expect(files).not.toEqual(expect.arrayContaining(['.credentials.json']));
    expect(files.some((f) => /^cache\/|\.jsonl$|^skills\/synced\//.test(f))).toBe(false);
    expect(remoteCommits()).toEqual(['claude-home-backup|noreply@localhost|claude-home-backup|noreply@localhost|backup: 2026-10-19T12:30:00.000Z']);
    expect(notify).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(claude, hb.REPORT_JSON))).toBe(false);
  });

  it('is silent and commits nothing when nothing changed, then commits a later change', () => {
    prepareHome();
    write('CLAUDE.md', 'one\n');
    hb.runBackup(opts());
    const again = hb.runBackup(opts());
    expect(again).toMatchObject({ code: 0, status: 'unchanged', lines: [] });
    expect(remoteCommits()).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    write('CLAUDE.md', 'two\n');
    expect(hb.runBackup(opts()).status).toBe('pushed');
    expect(remoteCommits()).toHaveLength(2);
  });

  it('blocks on a secret: nothing committed, remote untouched, report without value, notified', () => {
    prepareHome();
    write('CLAUDE.md', 'clean\n');
    write('agents/leak.md', `line one\nmy token ${FAKE_TOKEN}\n`);
    const res = hb.runBackup(opts());
    expect(res).toMatchObject({ code: 1, status: 'blocked' });
    expect(sh('git', ['rev-parse', '--verify', '-q', 'HEAD'], claude).status).not.toBe(0);
    expect(sh('git', ['diff', '--cached', '--name-only'], claude).stdout.trim()).toBe('');
    expect(remoteFiles()).toEqual([]);

    const report = JSON.parse(fs.readFileSync(path.join(claude, hb.REPORT_JSON), 'utf8'));
    expect(report.hits).toEqual([{ file: 'agents/leak.md', line: 2, rule: 'github-token' }]);
    const everything = [
      JSON.stringify(res), JSON.stringify(report),
      fs.readFileSync(path.join(claude, hb.REPORT_TXT), 'utf8'),
      fs.readFileSync(path.join(claude, hb.LOG_FILE), 'utf8'),
      JSON.stringify(notify.mock.calls),
    ].join('\n');
    expect(everything).not.toContain('ghp_');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].body).toBe('Home-Backup blockiert: 1 Funde — siehe ~/.claude/home-backup-report.txt');

    // the same finding the next day: still blocked, no second toast; a new finding notifies again
    expect(hb.runBackup(opts()).status).toBe('blocked');
    expect(notify).toHaveBeenCalledTimes(1);
    write('agents/leak2.md', `token ${FAKE_TOKEN}\n`);
    expect(hb.runBackup(opts()).status).toBe('blocked');
    expect(notify).toHaveBeenCalledTimes(2);
    fs.rmSync(path.join(claude, 'agents/leak2.md'));

    fs.rmSync(path.join(claude, 'agents/leak.md'));
    expect(hb.runBackup(opts()).status).toBe('pushed');
    expect(fs.existsSync(path.join(claude, hb.REPORT_JSON))).toBe(false);
    expect(remoteFiles()).toContain('CLAUDE.md');
  });

  it('blocks on private data and on unscannable binaries', () => {
    prepareHome();
    write('agents/mail.md', 'contact jane.doe@example.org\n');
    write('commands/blob.bin', Buffer.from([0, 1, 2, 3]));
    const res = hb.runBackup(opts());
    expect(res.status).toBe('blocked');
    expect(res.hits.map((h) => h.rule).sort()).toEqual(['email', 'unscannable']);
    expect(remoteFiles()).toEqual([]);
  });

  it('lets allowlisted hits through, by path rule and by value hash', () => {
    prepareHome();
    write('agents/mail.md', 'contact jane.doe@example.org\n');
    write('agents/leak.md', `token ${FAKE_TOKEN}\n`);
    write('commands/blob.bin', Buffer.from([0, 1, 2, 3]));
    write('.backupallow', [
      '# reviewed',
      'agents/mail.md:email',
      `value-sha256:${sha256(FAKE_TOKEN)}`,
      'commands/blob.bin',
      '',
    ].join('\n'));
    const res = hb.runBackup(opts());
    expect(res.status).toBe('pushed');
    expect(remoteFiles()).toEqual(expect.arrayContaining(['agents/mail.md', 'agents/leak.md', 'commands/blob.bin']));
  });

  it('never stages denylisted paths even when the .gitignore was edited away', () => {
    prepareHome();
    fs.writeFileSync(path.join(claude, '.gitignore'), '# emptied\n');
    write('CLAUDE.md', 'ok\n');
    write('.credentials.json', '{"a":"b"}');
    write('cache/x.txt', 'x');
    write('projects/p1/chat.jsonl', '{}');
    write('my-secret.txt', 'plain');
    write('home-backup.log', 'old');
    const res = hb.runBackup(opts());
    expect(res.status).toBe('pushed');
    expect(remoteFiles().sort()).toEqual(['.gitignore', 'CLAUDE.md', 'devops-config.json']);
  });

  it('never stages symlinks or junctions', () => {
    prepareHome();
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'private.md'), 'outside data\n');
    fs.mkdirSync(path.join(claude, 'agents'), { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(claude, 'agents', 'linked'), 'junction');
    } catch {
      return;
    }
    write('agents/real.md', 'real\n');
    expect(hb.runBackup(opts()).status).toBe('pushed');
    expect(remoteFiles().filter((f) => f.startsWith('agents/'))).toEqual(['agents/real.md']);
  });

  it('reports a failing push with a notification and keeps the commit for the next run', () => {
    prepareHome();
    sh('git', ['remote', 'set-url', 'origin', path.join(tmp, 'missing.git')], claude);
    write('CLAUDE.md', 'one\n');
    const res = hb.runBackup(opts());
    expect(res).toMatchObject({ code: 1, status: 'error' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(path.join(claude, hb.REPORT_JSON), 'utf8')).kind).toBe('error');

    sh('git', ['remote', 'set-url', 'origin', bare], claude);
    expect(hb.runBackup(opts()).code).toBe(0);
    expect(remoteFiles()).toContain('CLAUDE.md');
    expect(remoteCommits()).toHaveLength(1);
    expect(fs.existsSync(path.join(claude, hb.REPORT_JSON))).toBe(false);
  });

  it('passes hardened options to every git call', () => {
    prepareHome();
    write('CLAUDE.md', 'x\n');
    const calls = [];
    const run = (cmd, args, o = {}) => { calls.push({ cmd, args, o }); return hb.defaultRun(cmd, args, o); };
    hb.runBackup(opts({ run }));
    expect(calls.length).toBeGreaterThan(3);
    for (const c of calls) {
      expect(c.cmd).toBe('git');
      expect(Array.isArray(c.args)).toBe(true);
      expect(c.o.cwd).toBe(claude);
      expect(c.o.timeout).toBeGreaterThan(0);
    }
  });
});

describe('scan', () => {
  it('lists hits as file, line, rule without values', () => {
    prepareHome();
    write('agents/leak.md', `a\n${FAKE_TOKEN}\n`);
    write('CLAUDE.md', 'fine\n');
    const res = hb.scanDryRun(opts());
    expect(res.code).toBe(1);
    expect(res.lines).toEqual(['agents/leak.md:2  github-token']);
    expect(res.lines.join('')).not.toContain('ghp_');
    expect(sh('git', ['diff', '--cached', '--name-only'], claude).stdout.trim()).toBe('');
  });

  it('reports clean', () => {
    prepareHome();
    write('CLAUDE.md', 'fine\n');
    expect(hb.scanDryRun(opts()).code).toBe(0);
  });
});

describe('setup, disable, status', () => {
  let calls;
  let cron;
  let ghRepoExists;

  const fakeRun = (cmd, args, o = {}) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh') {
      if (args[0] === 'auth') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'repo' && args[1] === 'view') {
        return ghRepoExists ? { status: 0, stdout: 'true\n', stderr: '' } : { status: 1, stdout: '', stderr: 'not found' };
      }
      if (args[0] === 'repo' && args[1] === 'create') { ghRepoExists = true; return { status: 0, stdout: '', stderr: '' }; }
    }
    if (cmd === 'crontab') {
      if (args[0] === '-l') return cron === null ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: cron, stderr: '' };
      cron = o.input;
      return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'git' && args[0] === 'push') return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'git') return hb.defaultRun(cmd, args, o);
    throw new Error(`unexpected spawn: ${cmd}`);
  };
  const setupOpts = (extra = {}) => opts({ run: fakeRun, platform: 'linux', repo: 'octo/claude-home', ...extra });

  beforeEach(() => {
    calls = [];
    cron = null;
    ghRepoExists = false;
    fs.mkdirSync(claude, { recursive: true });
  });

  it('creates the private repo, git repo, gitignore, config, job and does the first run', () => {
    fs.writeFileSync(path.join(claude, 'CLAUDE.md'), 'rules\n');
    const res = hb.setup(setupOpts());
    expect(res.code).toBe(0);
    expect(calls).toContain('gh auth status');
    expect(calls.some((c) => c.startsWith('gh repo create octo/claude-home --private --description'))).toBe(true);
    expect(fs.readFileSync(path.join(claude, '.gitignore'), 'utf8')).toBe(hb.renderGitignore());
    expect(sh('git', ['remote', 'get-url', 'origin'], claude).stdout.trim()).toBe('https://github.com/octo/claude-home.git');
    const cfg = config.load(home, { home }).values.homeBackup;
    expect(cfg).toEqual({ enabled: true, repo: 'octo/claude-home' });
    expect(cron).toContain('# devops:home-backup');
    expect(cron).toContain('30 12 * * *');
    expect(cron).toContain('home-backup.js');
    expect(sh('git', ['log', '--format=%s'], claude).stdout).toContain('backup: 2026-10-19');
  });

  it('is idempotent: no second repo, no second job, no duplicate commit', () => {
    fs.writeFileSync(path.join(claude, 'CLAUDE.md'), 'rules\n');
    hb.setup(setupOpts());
    const commitsBefore = sh('git', ['rev-list', '--count', 'HEAD'], claude).stdout.trim();
    calls = [];
    const res = hb.setup(setupOpts());
    expect(res.code).toBe(0);
    expect(calls.some((c) => c.startsWith('gh repo create'))).toBe(false);
    expect(cron.split('\n').filter((l) => l.includes('# devops:home-backup'))).toHaveLength(1);
    expect(sh('git', ['rev-list', '--count', 'HEAD'], claude).stdout.trim()).toBe(commitsBefore);
    expect(sh('git', ['remote'], claude).stdout.trim()).toBe('origin');
  });

  it('refuses a ~/.claude repo with a different origin and registers nothing', () => {
    sh('git', ['init', '-q'], claude);
    sh('git', ['remote', 'add', 'origin', 'https://github.com/someone/else.git'], claude);
    const res = hb.setup(setupOpts());
    expect(res.code).toBe(1);
    expect(res.lines.join('\n')).toMatch(/different|already a git repo/);
    expect(cron).toBeNull();
    expect(config.load(home, { home }).values.homeBackup.enabled).toBe(false);
  });

  it('refuses an existing public repo, an unauthenticated gh and a bad repo name', () => {
    ghRepoExists = true;
    const pub = (cmd, args, o) => (cmd === 'gh' && args[1] === 'view' ? { status: 0, stdout: 'false\n', stderr: '' } : fakeRun(cmd, args, o));
    expect(hb.setup(setupOpts({ run: pub })).lines.join('')).toMatch(/not private/);
    const noAuth = (cmd, args, o) => (cmd === 'gh' && args[0] === 'auth' ? { status: 1, stdout: '', stderr: '' } : fakeRun(cmd, args, o));
    expect(hb.setup(setupOpts({ run: noAuth })).lines.join('')).toMatch(/gh auth login/);
    expect(hb.setup(setupOpts({ repo: 'nonsense' })).code).toBe(1);
    expect(cron).toBeNull();
  });

  it('disable unregisters the job and switches off, leaving .git in place; status reflects it', () => {
    hb.setup(setupOpts());
    expect(hb.status(setupOpts()).lines).toEqual(expect.arrayContaining(['enabled: true', 'repo: octo/claude-home', 'job registered: true']));
    const res = hb.disable(setupOpts());
    expect(res.code).toBe(0);
    expect(res.lines.join('\n')).toMatch(/left in place/);
    expect(cron).toBe('');
    expect(fs.existsSync(path.join(claude, '.git'))).toBe(true);
    expect(hb.status(setupOpts()).lines).toEqual(expect.arrayContaining(['enabled: false', 'job registered: false']));
    expect(hb.runBackup(setupOpts()).status).toBe('disabled');
  });
});
