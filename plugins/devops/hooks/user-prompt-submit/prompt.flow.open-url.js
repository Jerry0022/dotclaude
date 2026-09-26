#!/usr/bin/env node
/**
 * @hook prompt.flow.open-url
 * @version 0.1.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Opens a local page in the default browser when the prompt is
 *   the card widget's open prompt ("Im Standardbrowser öffnen: <url>" /
 *   "Open in default browser: <url>"), then blocks the prompt (exit 2 — the
 *   harness erases it), so reopening a concept page or dev server never
 *   reaches Claude and spends no tokens.
 *
 *   Why: the Desktop Code tab drops every http link a widget tries to open,
 *   localhost included, so the card turns such a link into a button that
 *   prefills this prompt (see lib/open-url.js for the app behaviour behind
 *   it). Enter submits it and this hook does what the link could not.
 *
 *   Only a prompt that is exactly the prefix plus one loopback http(s) URL is
 *   handled; everything else passes through untouched. When the browser
 *   cannot be started the prompt passes through too, and Claude opens the
 *   page itself. Sibling hooks skip the prompt via batch-state's
 *   willBeCollected, so none of them burns one-shot state on it.
 */

require('../lib/plugin-guard');

const { parseHookInput } = require('../lib/hook-input');
const { parseOpenUrlPrompt, openInDefaultBrowser } = require('../lib/open-url');

/**
 * Text for the harness's "a hook blocked your input" panel. The first line
 * carries the all-clear — the block IS the mechanism, nothing failed. The
 * second says so in plain words (#542): the red "blocked" headline is
 * intended, and the input never reached Claude, so it cost no tokens.
 * @param {string} url
 * @param {'de'|'en'} lang
 */
function renderAck(url, lang) {
  return lang === 'en'
    ? `[open-url] ✓ Opened in your default browser: ${url}\nThe red "blocked" notice is intended: the plugin opened the page itself without sending your input to Claude, so it costs no tokens.`
    : `[open-url] ✓ Seite im Standardbrowser geöffnet: ${url}\nDie rote Meldung „blockiert“ ist gewollt: Das Plugin hat die Seite direkt geöffnet, ohne deine Eingabe an Claude zu schicken — das spart Tokens.`;
}

/**
 * @param {object} hook parsed UserPromptSubmit payload
 * @param {{ open?: (url: string) => Promise<boolean> }} [deps]
 * @returns {Promise<{ exitCode: 0|2, stderr: string }>}
 */
async function handle(hook, deps = {}) {
  const open = deps.open || openInDefaultBrowser;
  const text = hook.prompt || hook.user_message || hook.message || '';
  const parsed = parseOpenUrlPrompt(text);
  if (!parsed) return { exitCode: 0, stderr: '' };
  let opened = false;
  try { opened = await open(parsed.url); } catch { opened = false; }
  if (!opened) return { exitCode: 0, stderr: '' };
  return { exitCode: 2, stderr: renderAck(parsed.url, parsed.lang) };
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    const hook = parseHookInput(inputData);
    if (!hook) process.exit(0);
    handle(hook)
      .then(({ exitCode, stderr }) => {
        if (stderr) process.stderr.write(`${stderr}\n`);
        process.exit(exitCode);
      })
      .catch(() => process.exit(0));
  });
}

module.exports = { handle, renderAck };
