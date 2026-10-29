#!/usr/bin/env node
/**
 * @hook prompt.flow.open-url
 * @version 0.3.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Opens a local page in the default browser when the prompt is
 *   the card widget's open prompt ("Im Standardbrowser öffnen: <url>" /
 *   "Open in default browser: <url>"), then blocks the prompt (JSON block
 *   verdict via lib/block-prompt — the harness erases it), so reopening a
 *   concept page or dev server never reaches Claude and spends no tokens.
 *   The panel shows one short line (#958), not the hook path and a paragraph.
 *
 *   Why: the Desktop Code tab drops every http link a widget tries to open,
 *   localhost included, so the card turns such a link into a button that
 *   prefills this prompt (see lib/open-url.js for the app behaviour behind
 *   it). Enter submits it and this hook does what the link could not.
 *
 *   Only a prompt that is exactly the prefix plus one loopback http(s) URL is
 *   handled; everything else passes through untouched. When the browser
 *   cannot be started the prompt passes through too, and Claude opens the
 *   page itself. A page that does not answer is never opened (#703): the
 *   prompt passes through with context telling Claude to bring the server
 *   (or the concept bridge) back first. Sibling hooks skip the prompt via batch-state's
 *   willBeCollected, so none of them burns one-shot state on it.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { parseHookInput } = require('../lib/hook-input');
const { parseOpenUrlPrompt, openInDefaultBrowser, probeUrl } = require('../lib/open-url');
const { blockPrompt } = require('../lib/block-prompt');

/**
 * The one line in the harness's "a hook blocked your input" panel (#958):
 * what happened and that it cost nothing — no tag, no URL, no justification.
 * @param {'de'|'en'} lang
 */
function renderAck(lang) {
  return lang === 'en'
    ? '✓ Opened in your browser — no tokens spent.'
    : '✓ Seite im Browser geöffnet — kostet keine Tokens.';
}

/**
 * The concept page `url` belongs to, when the session's
 * `.claude/concept-active.json` names its port and path.
 * @param {string} url
 * @param {string} cwd
 * @returns {{ port: number, html_path: string } | null}
 */
function matchConcept(url, cwd) {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'concept-active.json'), 'utf8'));
  } catch { return null; }
  const u = new URL(url);
  const html = String(state.html_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!html || Number(u.port) !== Number(state.port)) return null;
  return decodeURIComponent(u.pathname).replace(/^\/+/, '') === html ? state : null;
}

/**
 * Context for Claude when the page is down (#703): the prompt passes through
 * so Claude can bring the server back instead of the user staring at a
 * browser error page.
 * @param {string} url
 * @param {{ port: number, html_path: string } | null} concept
 */
function renderDeadContext(url, concept) {
  if (concept) {
    return `[open-url] The user asked to reopen the concept page ${url}, but its bridge on port ${concept.port} does not answer. Relaunch the bridge on the SAME port per the ss.concept.resume relaunch mandate (concept-server.py ${concept.port} with --html "${concept.html_path}", then re-arm pulser and waker), and open the page once it serves 200.`;
  }
  return `[open-url] The user asked to open ${url}, but nothing answers there. Start the server that serves it (the project's dev server), then open the page once it answers.`;
}

/**
 * @param {object} hook parsed UserPromptSubmit payload
 * @param {{ open?: (url: string) => Promise<boolean>, probe?: (url: string) => Promise<boolean>, cwd?: string }} [deps]
 * @returns {Promise<{ exitCode: 0, stderr: string, context?: string, block?: string }>}
 */
async function handle(hook, deps = {}) {
  const open = deps.open || openInDefaultBrowser;
  const probe = deps.probe || probeUrl;
  const text = hook.prompt || hook.user_message || hook.message || '';
  const parsed = parseOpenUrlPrompt(text);
  if (!parsed) return { exitCode: 0, stderr: '' };
  let alive = false;
  try { alive = await probe(parsed.url); } catch { alive = false; }
  if (!alive) {
    const cwd = deps.cwd || hook.cwd || process.cwd();
    return { exitCode: 0, stderr: '', context: renderDeadContext(parsed.url, matchConcept(parsed.url, cwd)) };
  }
  let opened = false;
  try { opened = await open(parsed.url); } catch { opened = false; }
  if (!opened) return { exitCode: 0, stderr: '' };
  return { exitCode: 0, stderr: '', block: renderAck(parsed.lang) };
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    const hook = parseHookInput(inputData);
    if (!hook) process.exit(0);
    handle(hook)
      .then(({ exitCode, stderr, context, block }) => {
        if (block) blockPrompt(block);
        if (context) {
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
          }));
        }
        if (stderr) process.stderr.write(`${stderr}\n`);
        process.exit(exitCode);
      })
      .catch(() => process.exit(0));
  });
}

module.exports = { handle, renderAck, renderDeadContext, matchConcept };
