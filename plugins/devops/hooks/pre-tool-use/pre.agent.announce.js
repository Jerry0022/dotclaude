#!/usr/bin/env node
/**
 * @hook pre.agent.announce
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Agent
 * @description Makes every Agent spawn visible to the user: resolves the
 *   agent's effective model and effort (frontmatter, invocation override,
 *   `inherit` → the session's own model) and hands Claude a one-line
 *   announcement to show verbatim. The delegation policy asked for this line
 *   in prose only, and the Quiet output style ("never narrate") swallowed it;
 *   the "show the user … verbatim" marker is the one relay Quiet honours.
 *
 *   Models stay aliases (`opus`, `sonnet`, `fable`): the harness resolves an
 *   alias to the newest model of that family, so no version is pinned here.
 *   Only an inherited model is shown with its version, read from the session
 *   transcript, because that is the one the user did not choose per agent.
 *
 *   Silent inside a subagent (its context is not the user's chat) and for a
 *   spawn pre.strict.agent-gate is about to refuse — the retry announces.
 *   Never blocks: every failure path exits 0 silently.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'agents');
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

/** Frontmatter `model` / `effort` of an agent markdown file, or null. */
function readFrontmatter(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const field = (name) => {
    const f = m[1].match(new RegExp(`^${name}:\\s*(\\S+)\\s*$`, 'm'));
    return f ? f[1].replace(/^["']|["']$/g, '') : null;
  };
  return { model: field('model'), effort: field('effort') };
}

/**
 * Where an agent type is defined: devops plugin agents by `devops:<name>`,
 * plain names in the project's and the user's `.claude/agents/`, then the
 * devops plugin itself. Other plugins' agents and built-ins return null.
 */
function findAgentFile(subagentType, cwd) {
  const type = String(subagentType || '');
  const colon = type.indexOf(':');
  if (colon !== -1) {
    if (type.slice(0, colon) !== 'devops') return null;
    return path.join(AGENTS_DIR, `${type.slice(colon + 1)}.md`);
  }
  const candidates = [
    path.join(cwd, '.claude', 'agents', `${type}.md`),
    path.join(os.homedir(), '.claude', 'agents', `${type}.md`),
    path.join(AGENTS_DIR, `${type}.md`),
  ];
  return candidates.find(f => fs.existsSync(f)) || null;
}

/** `claude-opus-5-5` → `opus 5.5`; anything unrecognised passes through. */
function friendlyModel(id) {
  const m = String(id || '').match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/);
  if (!m) return id;
  return m[3] ? `${m[1]} ${m[2]}.${m[3]}` : `${m[1]} ${m[2]}`;
}

/** The session's current model id from the transcript tail, or null. */
function sessionModel(transcriptPath) {
  if (!transcriptPath) return null;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const hits = buf.toString('utf8').match(/"model":"(claude-[^"]+)"/g);
    if (!hits) return null;
    return hits[hits.length - 1].slice('"model":"'.length, -1);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/**
 * The effective `model · effort` of a spawn. An invocation override shows as
 * `default → override`; the effort never changes at spawn (the Agent tool has
 * no effort parameter), so it is shown once.
 */
function resolve(input, cwd, transcriptPath) {
  const file = findAgentFile(input.subagent_type || 'general-purpose', cwd);
  const fm = (file && readFrontmatter(file)) || {};
  const base = fm.model || 'inherit';
  const override = typeof input.model === 'string' && input.model ? input.model : null;

  const inheritedLabel = () => {
    const id = sessionModel(transcriptPath);
    return id ? `${friendlyModel(id)} (session)` : 'session model';
  };
  const label = (m) => (m === 'inherit' ? inheritedLabel() : m);

  let model = label(base);
  if (override && override !== base) model = `${model} → ${override}`;

  let effort = fm.effort || null;
  if (!effort) effort = base === 'inherit' || !file ? 'session effort' : 'default effort';
  return { model, effort };
}

function buildLine(input, cwd, transcriptPath) {
  const type = input.subagent_type || 'general-purpose';
  const { model, effort } = resolve(input, cwd, transcriptPath);
  const mode = input.run_in_background === false ? 'foreground' : 'background';
  const desc = String(input.description || '').replace(/\s+/g, ' ').trim();
  return `→ Agent ${type} · ${model} · ${effort} · ${mode}${desc ? ` — ${desc}` : ''}`;
}

/** True when pre.strict.agent-gate will refuse this spawn. */
function strictWillBlock(cwd, prompt) {
  try {
    const S = require('../lib/strict-state');
    const ev = S.evaluate(cwd, { inherit: true });
    return !!ev.active && !S.hasContract(prompt);
  } catch {
    return false;
  }
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      let hook;
      try { hook = JSON.parse(inputData); } catch { process.exit(0); }
      if (hook.tool_name && hook.tool_name !== 'Agent') process.exit(0);
      if (hook.agent_id) process.exit(0);

      const input = hook.tool_input || {};
      const cwd = hook.cwd || process.cwd();
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      if (strictWillBlock(cwd, prompt)) process.exit(0);

      const line = buildLine(input, cwd, hook.transcript_path);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'Agent spawn — show the user this line verbatim in the next text you write (before your next ' +
            'tool call if you would otherwise stay silent), also under the Quiet output style. Several ' +
            'agents started together → every line, one per agent; a prose summary never replaces them:\n' +
            line,
        },
      }));
      process.exit(0);
    } catch {
      process.exit(0);
    }
  });
}

if (require.main === module) main();

module.exports = { readFrontmatter, findAgentFile, friendlyModel, sessionModel, resolve, buildLine };
