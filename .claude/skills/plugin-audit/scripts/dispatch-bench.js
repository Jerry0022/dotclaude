#!/usr/bin/env node
'use strict';
/**
 * Hook dispatcher benchmark (repo-only). Runs a recorded Bash
 * PreToolUse + PostToolUse payload pair through
 *   (a) the separate hooks — every module the manifest matches for Bash,
 *       each its own `node <file>` process, all started at once like
 *       Claude Code does, merged with dispatch/merge.js
 *   (b) the dispatcher — one `node hooks/dispatch/dispatch.js <Event>`
 * N times each (alternating a/b so load drift hits both), and reports node
 * process starts, wall time per Bash call (Pre + Post) and whether both paths
 * gave the identical merged reply.
 *
 * Usage: node .claude/skills/plugin-audit/scripts/dispatch-bench.js [--runs 10] [--json]
 * Every Bash call of each path gets its own throw-away git repo and session
 * id (hooks keep once-per-session/once-per-repo state, which would otherwise
 * make the second path see a different world); telemetry is off; the hooks
 * run from this checkout (ad-hoc plugin load).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const PLUGIN = path.join(REPO, 'plugins', 'devops');
const dispatch = require(path.join(PLUGIN, 'hooks', 'dispatch', 'dispatch.js'));
const { mergeResults } = require(path.join(PLUGIN, 'hooks', 'dispatch', 'merge.js'));

const argv = process.argv.slice(2);
const RUNS = Number((argv[argv.indexOf('--runs') + 1]) || 10) || 10;
const AS_JSON = argv.includes('--json');

function runNode(args, input, env, cwd) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('close', (code) => resolve({
      code: code === null ? 1 : code,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
      ms: Number(process.hrtime.bigint() - t0) / 1e6,
    }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function separate(event, payload, env, cwd, manifest) {
  const mods = dispatch.selectModules(manifest, event, payload, PLUGIN);
  const t0 = process.hrtime.bigint();
  const res = await Promise.all(mods.map((m) => runNode([m.file], JSON.stringify(payload), env, cwd).then((r) => ({ name: m.name, ...r }))));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, procs: mods.length, merged: mergeResults(event, res) };
}

async function dispatched(event, payload, env, cwd) {
  const r = await runNode([path.join(PLUGIN, 'hooks', 'dispatch', 'dispatch.js'), event], JSON.stringify(payload), env, cwd);
  return { ms: r.ms, procs: 1, merged: { code: r.code, stdout: r.stdout, stderr: r.stderr } };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
// temp dirs, session ids and timestamps differ between runs; compare the rest
const norm = (m) => JSON.stringify({ code: m.code, stdout: m.stdout.trim(), stderr: m.stderr.trim() })
  .replace(/dispatch-bench-[A-Za-z0-9]+|\d{10,}|[0-9a-f]{8}-[0-9a-f-]{27}/g, '#');

function freshRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-bench-'));
  spawnSync('git', ['init', '-q', '-b', 'feature/bench'], { cwd });
  fs.writeFileSync(path.join(cwd, 'README.md'), '# bench\n');
  spawnSync('git', ['add', '.'], { cwd });
  spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-qm', 'init'], { cwd });
  return cwd;
}

function payloads(cwd, session) {
  const base = {
    session_id: session, transcript_path: '', cwd, permission_mode: 'default', tool_name: 'Bash',
    tool_input: { command: 'git status', description: 'Show status' }, tool_use_id: 'toolu_bench',
  };
  return [
    { ...base, hook_event_name: 'PreToolUse' },
    { ...base, hook_event_name: 'PostToolUse', tool_response: { stdout: 'On branch feature/bench\nnothing to commit', stderr: '', interrupted: false } },
  ];
}

async function main() {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, DEVOPS_HOOK_TELEMETRY: 'off' };
  delete env.DEVOPS_HOOK_DISPATCH;
  const manifest = dispatch.loadManifest();
  const repos = [];
  const a = []; const b = []; let same = 0; const diffs = [];
  for (let i = 0; i < RUNS; i++) {
    const order = i % 2 ? ['b', 'a'] : ['a', 'b'];
    const got = {};
    for (const k of order) {
      const cwd = freshRepo();
      repos.push(cwd);
      const [pre, post] = payloads(cwd, `bench-${Date.now()}${i}${k === 'a' ? 1 : 2}`);
      const run = k === 'a' ? separate : (ev, p) => dispatched(ev, p, env, cwd);
      const p1 = await run('PreToolUse', pre, env, cwd, manifest);
      const p2 = await run('PostToolUse', post, env, cwd, manifest);
      got[k] = { ms: p1.ms + p2.ms, procs: p1.procs + p2.procs, replies: [p1.merged, p2.merged] };
    }
    a.push(got.a); b.push(got.b);
    const eq = got.a.replies.every((r, j) => norm(r) === norm(got.b.replies[j]));
    if (eq) same++; else if (diffs.length < 2) diffs.push({ separate: got.a.replies.map(norm), dispatcher: got.b.replies.map(norm) });
  }
  for (const r of repos) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* busy */ } }
  const report = {
    runs: RUNS,
    cpus: os.cpus().length,
    separate: { nodeProcsPerBashCall: a[0].procs, medianMs: Math.round(median(a.map((x) => x.ms))), meanMs: Math.round(mean(a.map((x) => x.ms))) },
    dispatcher: { nodeProcsPerBashCall: b[0].procs, medianMs: Math.round(median(b.map((x) => x.ms))), meanMs: Math.round(mean(b.map((x) => x.ms))) },
    identicalReplies: `${same}/${RUNS}`,
    diffs,
  };
  if (AS_JSON) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`dispatch bench — ${RUNS} Bash calls (PreToolUse + PostToolUse) each way, ${report.cpus} cpus\n`);
    process.stdout.write(`  separate hooks : ${report.separate.nodeProcsPerBashCall} node processes, median ${report.separate.medianMs} ms, mean ${report.separate.meanMs} ms\n`);
    process.stdout.write(`  dispatcher     : ${report.dispatcher.nodeProcsPerBashCall} node processes, median ${report.dispatcher.medianMs} ms, mean ${report.dispatcher.meanMs} ms\n`);
    process.stdout.write(`  identical merged replies: ${report.identicalReplies}\n`);
    for (const d of diffs) process.stdout.write(`  diff: ${JSON.stringify(d)}\n`);
  }
}

main().catch((e) => { process.stderr.write(`${e && e.stack}\n`); process.exit(1); });
