#!/usr/bin/env node
/**
 * @hook pre.crawl.guard
 * @version 0.2.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Bash|PowerShell
 * @description Block recursive scans of a filesystem root, a drive root or the whole home directory.
 *   `find /`, `find /c`, `grep -r x /`, `du ~`, `ls -R /`,
 *   `Get-ChildItem C:\ -Recurse`, `gci / -r` and the like. In Git Bash `/`
 *   spans the Git install plus every mounted drive, network drives included.
 *   Such a scan cannot finish inside the Bash tool's 120 s timeout; the
 *   harness then moves it to the background, and the process outlives the
 *   session. That is what happened on 2026-09-24: devops subagents that could
 *   not resolve `{PLUGIN_ROOT}` searched `/` for ui-defaults.md and
 *   pre-mortem.md, and the orphaned find.exe processes ran for hours.
 *
 *   Matching lives in lib/crawl-guard-match (quote-, heredoc- and
 *   substitution-aware; see its header for the root/home/depth rules). The
 *   payload's `cwd` is passed on, so `find .` in a home or root working
 *   directory (or after `cd /` in the same command) counts as a crawl.
 *   This is a hard deny, not the tokens guard's "blocked once, retry passes":
 *   a crawl costs CPU and leaves orphaned processes, and repeating it does
 *   not make it cheaper. The deny text hands the model the resolved plugin
 *   root. For a subagent this is the one channel that always reaches it,
 *   even where sub.plugin.root did not run.
 *
 *   Bypass (only when the user explicitly asked for a whole-disk search): an
 *   inline `DEVOPS_ALLOW_ROOT_CRAWL=1` in the command, or the variable set in
 *   the hook environment.
 */

require('../lib/plugin-guard');

const { parseHookInput } = require('../lib/hook-input');
const { findRootCrawls, hasBypass, classifyPath } = require('../lib/crawl-guard-match');
const { pluginRoot, toSlash } = require('../lib/plugin-root');

const SHELL_TOOLS = { Bash: 'bash', PowerShell: 'powershell' };

/**
 * @param {string} inputData raw stdin
 * @returns {{block:boolean, crawls:Array, hook:object|null}}
 */
function decide(inputData) {
  const hook = parseHookInput(inputData);
  const none = { block: false, crawls: [], hook };
  if (!hook) return none;
  const shell = SHELL_TOOLS[hook.tool_name];
  if (!shell) return none;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const cmd = typeof input.command === 'string' ? input.command : '';
  if (!cmd) return none;
  if (process.env.DEVOPS_ALLOW_ROOT_CRAWL === '1' || hasBypass(cmd)) return none;
  const cwd = typeof hook.cwd === 'string' ? hook.cwd : undefined;
  const crawls = findRootCrawls(cmd, { shell, cwd });
  return { block: crawls.length > 0, crawls, hook };
}

/**
 * The block message. Names what was caught, why, and the literal path to use.
 * @param {Array} crawls
 * @param {object|null} hook
 * @param {string} [root]
 */
function denyText(crawls, hook, root = pluginRoot()) {
  const first = crawls[0] || { head: 'find', path: '/', kind: 'root' };
  const where = first.kind === 'home' ? 'the whole home directory' : 'a filesystem or drive root';
  const rawCwd = hook && typeof hook.cwd === 'string' && hook.cwd ? toSlash(hook.cwd) : '';
  // A cwd that is itself a root or home is no scope to recommend.
  const cwd = rawCwd && !classifyPath(rawCwd) ? rawCwd : 'the project directory';
  const isSubagent = !!(hook && hook.agent_id);
  const via = first.resolved ? `, i.e. "${toSlash(first.resolved)}" from the working directory` : '';
  const lines = [
    `[pre.crawl.guard] BLOCKED: \`${first.head}\` would walk ${where} (start path "${first.path}"${via}).`,
    'Rule: never scan /, a drive root (/c, C:\\, /mnt/c), a network share or the whole home directory, also not as',
    '      `.` after `cd /` / `cd ~` or in such a working directory. In Git Bash',
    '      "/" is the Git install plus every mounted drive. The scan outlasts the 120 s Bash timeout, gets moved to',
    '      the background and keeps running for hours after this session ends.',
    'Fix:',
    `  - A devops plugin file ({PLUGIN_ROOT}/…, deep-knowledge/*.md, agents, skills, templates)?`,
    `    {PLUGIN_ROOT} = ${root}`,
    `    Read it directly, e.g. ${root}/deep-knowledge/<file>.md. Do not search for it.`,
    '    $CLAUDE_PLUGIN_ROOT is empty in the Bash and PowerShell tools: "$CLAUDE_PLUGIN_ROOT/" is "/".',
    `  - Anything else: use Glob/Grep scoped to ${cwd}, or start from the specific subdirectory you mean.`,
    '    In the home directory, name the subfolder (e.g. ~/.claude/plugins/cache) or add -maxdepth 3.',
  ];
  if (isSubagent) {
    lines.push(
      '  - You are a subagent: if a path from your task prompt (e.g. materials/notes.md) does not exist in your',
      '    working directory, it is relative to the orchestrator\'s directory. Stop and ask for, or report, the',
      '    missing absolute path instead of searching the disk.',
    );
  }
  lines.push('Bypass (only if the user explicitly asked for a whole-disk search): prefix the command with DEVOPS_ALLOW_ROOT_CRAWL=1.');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let result;
    try { result = decide(inputData); } catch { process.exit(0); }
    if (!result.block) process.exit(0);
    let text;
    try { text = denyText(result.crawls, result.hook); } catch { text = denyText([], null); }
    process.stderr.write(text);
    process.exit(2);
  });
}

module.exports = { decide, denyText };
