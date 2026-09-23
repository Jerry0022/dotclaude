/**
 * @module output-style-sync
 * @version 0.1.0
 * @description Keep the consumer copy of the Quiet output style in step with
 *   the shipped template.
 *
 *   The canonical style is `templates/output-style-quiet.md`; consumers copy it
 *   to `~/.claude/output-styles/quiet.md` by hand, and nothing updated that copy
 *   afterwards — an install from 2026-09-14 still lacked two paragraphs a week
 *   later, incl. the reply-language rule of v0.186.4. ss.plugin.update calls
 *   syncQuietStyle() after every update run.
 *
 *   Opt-in only: the copy is refreshed, never created. It is overwritten only
 *   when its frontmatter says `name: Quiet` AND its content equals a version
 *   this plugin shipped (sha256 list in `templates/output-style-quiet.shipped.json`,
 *   CRLF normalized). Anything else is a user customization and is left alone.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEMPLATE_REL = path.join('templates', 'output-style-quiet.md');
const MANIFEST_REL = path.join('templates', 'output-style-quiet.shipped.json');

function normalize(text) {
  return String(text).replace(/\r\n/g, '\n');
}

function sha256(text) {
  return crypto.createHash('sha256').update(normalize(text), 'utf8').digest('hex');
}

function frontmatterName(text) {
  const m = normalize(text).match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const line = m[1].split('\n').find((l) => /^name\s*:/.test(l));
  return line ? line.replace(/^name\s*:\s*/, '').trim().replace(/^["']|["']$/g, '') : null;
}

/**
 * Sync the installed Quiet style from `pluginDir`'s template.
 * Returns `{ status, target }` with status one of:
 *   'no-template'  — plugin dir ships no Quiet template
 *   'not-installed'— no ~/.claude/output-styles/quiet.md (user never opted in)
 *   'not-quiet'    — the file exists but its frontmatter name is not Quiet
 *   'current'      — already identical to the template (line endings aside)
 *   'customized'   — differs from every shipped version; left untouched
 *   'updated'      — overwritten with the template
 *   'error'        — read/write failed (message in `error`)
 */
function syncQuietStyle({ home, pluginDir }) {
  const target = path.join(home, '.claude', 'output-styles', 'quiet.md');
  const templateFile = path.join(pluginDir, TEMPLATE_REL);
  try {
    if (!fs.existsSync(templateFile)) return { status: 'no-template', target };
    if (!fs.existsSync(target)) return { status: 'not-installed', target };

    const installed = fs.readFileSync(target, 'utf8');
    if (frontmatterName(installed) !== 'Quiet') return { status: 'not-quiet', target };

    const template = fs.readFileSync(templateFile, 'utf8');
    const installedHash = sha256(installed);
    if (installedHash === sha256(template)) return { status: 'current', target };

    let shipped = [];
    try {
      shipped = JSON.parse(fs.readFileSync(path.join(pluginDir, MANIFEST_REL), 'utf8')).sha256 || [];
    } catch { /* no manifest → every divergent copy counts as customized */ }
    if (!shipped.includes(installedHash)) return { status: 'customized', target };

    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, template);
    fs.renameSync(tmp, target);
    return { status: 'updated', target };
  } catch (e) {
    return { status: 'error', target, error: (e && e.message) || String(e) };
  }
}

module.exports = { syncQuietStyle, sha256, frontmatterName, TEMPLATE_REL, MANIFEST_REL };
