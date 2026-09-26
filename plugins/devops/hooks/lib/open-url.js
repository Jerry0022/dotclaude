/**
 * @module open-url
 * @version 0.1.0
 * @description The "open this local page in the default browser" prompt the
 *   completion-card widget puts into the composer, and the opener
 *   prompt.flow.open-url runs for it.
 *
 *   Why a prompt and not a link: the Desktop Code tab lets a widget link out
 *   only when it is https (confirmation dialog, then the default browser). An
 *   http link — every localhost dev server and concept page — is dropped
 *   without a trace, and the widget frame may not open popups (its sandbox
 *   has no allow-popups), so neither `window.open` nor `target=_blank` gets
 *   out either. Read from the app bundle (Claude 2.7032, 2026-09-24). A
 *   prompt is the one channel from the widget that still reaches this
 *   machine: the button prefills it, Enter submits it, and the hook opens the
 *   page and blocks the prompt, so it never reaches Claude and spends no
 *   tokens.
 *
 *   Only loopback http(s) pages are opened. The card never links anything
 *   else this way, and a hook that opened any URL a composer text names would
 *   hand every widget a way to push the user to an arbitrary site.
 *
 *   The card widget (mcp-server/lib/card-widget.js, ESM) keeps its own copy of
 *   OPEN_URL_PREFIX and of the loopback test; card-widget.test.js pins both to
 *   this module.
 */

/** Prompt prefix per language. The prompt is `<prefix> <url>`, nothing else. */
const OPEN_URL_PREFIX = {
  de: 'Im Standardbrowser öffnen:',
  en: 'Open in default browser:',
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True for an http(s) URL on this machine: localhost, *.localhost, 127.x.x.x
 * or [::1]. Credentials in the URL disqualify it.
 * @param {string} value
 */
function isLoopbackHttpUrl(value) {
  let u;
  try { u = new URL(String(value)); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host)
    || host.endsWith('.localhost')
    || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * The URL an open prompt asks for, or null when the text is not one. The
 * whole prompt must be the prefix plus exactly one loopback URL, so a prompt
 * that only mentions the phrase is never swallowed.
 * @param {string} text
 * @returns {{ url: string, lang: 'de'|'en' } | null}
 */
function parseOpenUrlPrompt(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  for (const [lang, prefix] of Object.entries(OPEN_URL_PREFIX)) {
    if (t.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) continue;
    const rest = t.slice(prefix.length).trim();
    if (!rest || /\s/.test(rest) || !isLoopbackHttpUrl(rest)) return null;
    return { url: new URL(rest).href, lang };
  }
  return null;
}

/**
 * The command that hands a URL to the OS default browser. No shell anywhere:
 * `cmd /c start` would read `&` in a query string as a command separator.
 * @param {string} url
 * @param {NodeJS.Platform} [platform]
 */
function openCommand(url, platform = process.platform) {
  if (platform === 'win32') return { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/** How long to wait for the opener process to start before giving up. */
const SPAWN_TIMEOUT_MS = 3000;

/**
 * Open a loopback page in the default browser. Resolves true once the opener
 * process has started, false when it could not start (or the URL is not
 * loopback). Detached: the browser outlives the hook.
 * @param {string} url
 * @param {{ spawn?: Function, platform?: NodeJS.Platform, timeoutMs?: number }} [deps]
 * @returns {Promise<boolean>}
 */
function openInDefaultBrowser(url, deps = {}) {
  const spawn = deps.spawn || require('child_process').spawn;
  const platform = deps.platform || process.platform;
  const timeoutMs = deps.timeoutMs ?? SPAWN_TIMEOUT_MS;
  return new Promise((resolve) => {
    if (!isLoopbackHttpUrl(url)) { resolve(false); return; }
    const { cmd, args } = openCommand(new URL(url).href, platform);
    let settled = false;
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch {
      finish(false);
      return;
    }
    child.once('spawn', () => finish(true));
    child.once('error', () => finish(false));
    child.unref();
  });
}

module.exports = {
  OPEN_URL_PREFIX,
  SPAWN_TIMEOUT_MS,
  isLoopbackHttpUrl,
  parseOpenUrlPrompt,
  openCommand,
  openInDefaultBrowser,
};
