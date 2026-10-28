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
 *   Opt-in only: the copy is refreshed, and created only when the user has
 *   configured Quiet (settings `outputStyle` = "Quiet", user or project) but
 *   the file is missing. It is overwritten only
 *   when its frontmatter says `name: Quiet` AND its content equals a version
 *   this plugin shipped (sha256 list in `templates/output-style-quiet.shipped.json`,
 *   CRLF normalized). Anything else is a user customization and is left alone.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const os = require('os');
const { projectClaudeDir } = require('./project-root');

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

function writeAtomic(target, content) {
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

/** True when `outputStyle` is "Quiet" in project or user settings (active or not). */
function quietConfigured({ home, cwd }) {
  const dirs = [];
  if (cwd) dirs.push(projectClaudeDir(cwd));
  dirs.push(path.join(home || os.homedir(), '.claude'));
  for (const dir of dirs) {
    for (const name of ['settings.local.json', 'settings.json']) {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).outputStyle;
        if (typeof v === 'string' && v.trim().toLowerCase() === 'quiet') return true;
      } catch { /* missing or invalid settings file */ }
    }
  }
  return false;
}

/**
 * Sync the installed Quiet style from `pluginDir`'s template.
 * Returns `{ status, target }` with status one of:
 *   'no-template'  — plugin dir ships no Quiet template
 *   'not-installed'— no ~/.claude/output-styles/quiet.md and Quiet is not configured
 *   'created'      — file was missing but settings name Quiet: written from the template
 *   'not-quiet'    — the file exists but its frontmatter name is not Quiet
 *   'current'      — already identical to the template (line endings aside)
 *   'customized'   — differs from every shipped version; left untouched
 *   'updated'      — overwritten with the template
 *   'error'        — read/write failed (message in `error`)
 */
function syncQuietStyle({ home, pluginDir, cwd = process.cwd() }) {
  const target = path.join(home, '.claude', 'output-styles', 'quiet.md');
  const templateFile = path.join(pluginDir, TEMPLATE_REL);
  try {
    if (!fs.existsSync(templateFile)) return { status: 'no-template', target };
    if (!fs.existsSync(target)) {
      if (!quietConfigured({ home, cwd })) return { status: 'not-installed', target };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeAtomic(target, fs.readFileSync(templateFile, 'utf8'));
      return { status: 'created', target };
    }

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

    writeAtomic(target, template);
    return { status: 'updated', target };
  } catch (e) {
    return { status: 'error', target, error: (e && e.message) || String(e) };
  }
}

/**
 * The one "customized" verdict for a pass over several style sources (#937).
 * A stale source (an old marketplace clone) does not know the hash a newer
 * source shipped, so a per-source 'customized' is no evidence on its own: the
 * copy counts as customized only when some source said so and none found it
 * current, updated or created it. Returns the target to warn about, or null.
 */
function customizedTarget(results) {
  const known = results.some(r => r.status === 'current' || r.status === 'updated' || r.status === 'created');
  if (known) return null;
  const hit = results.find(r => r.status === 'customized');
  return hit ? hit.target : null;
}

// `git clone` leaves `temp_git_<ts>_<rand>..clone` dirs behind when an install
// or update is interrupted; they are no marketplace (#937).
function isTempClone(name) {
  return /^temp_git_.*\.clone$/.test(name);
}

module.exports = { syncQuietStyle, quietConfigured, customizedTarget, isTempClone, sha256, frontmatterName, TEMPLATE_REL, MANIFEST_REL };
