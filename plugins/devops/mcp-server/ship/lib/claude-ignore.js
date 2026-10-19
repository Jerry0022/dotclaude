/**
 * @module ship/lib/claude-ignore
 * @description ship_preflight's check of the canonical `.claude` ignore block
 *   (hooks/lib/runtime-ignores.js). It runs ONLY when the ship touches the
 *   ignore policy — `.gitignore`, `.git/info/exclude` or anything under a
 *   `.claude/` — committed or still in the working tree; any other ship gets
 *   no check and no output. Deterministic, never blocks: a deviation becomes
 *   a warning that carries the ready fix (the migrate command).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(here, "..", "..", "..");
const ri = require(path.join(PLUGIN_ROOT, "hooks", "lib", "runtime-ignores.js"));

function readOrNull(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

/** Does a ship that changes `files` touch the ignore policy? */
export function touchesIgnorePolicy(files) {
  return ri.touchesIgnorePolicy(files);
}

/** The command that fixes every structural deviation. */
export function migrateCommand(cwd, pluginRoot = PLUGIN_ROOT) {
  const script = path.join(pluginRoot, "scripts", "claude-ignore.js").replace(/\\/g, "/");
  return `node "${script}" migrate "${String(cwd).replace(/\\/g, "/")}"`;
}

/**
 * @param {{cwd:string, files:string[], commonDir?:string|null, read?:Function, pluginRoot?:string}} p
 *   files: repo-relative paths the ship changes (branch diff + working tree)
 * @returns {object|null} a preflight check, or null when the ship does not touch the policy
 */
export function claudeIgnoreCheck({ cwd, files, commonDir = null, read = readOrNull, pluginRoot = PLUGIN_ROOT, tracked = null }) {
  if (!ri.touchesIgnorePolicy(files)) return null;
  const gitignore = read(path.join(cwd, ".gitignore"));
  const exclude = read(path.join(commonDir || path.join(cwd, ".git"), "info", "exclude"));
  const committed = tracked || ri.trackedUnderBlock(cwd);
  const res = ri.check({ gitignore, exclude, tracked: committed });
  const check = { name: "claude-ignore", ok: true, issues: res.issues.map((i) => i.code) };
  if (res.policy.length) check.policy = res.policy.map((d) => `${d.line} ignores ${d.path} (versioned by policy)`);
  if (committed.length) check.untrack = ri.untrackCommand(committed);
  if (!res.ok) {
    const fixes = [];
    if (res.issues.some((i) => i.code !== "tracked-local")) fixes.push(check.fix = migrateCommand(cwd, pluginRoot));
    if (check.untrack) fixes.push(check.untrack);
    check.warning = `.claude ignore block deviates (${res.issues.map((i) => i.detail).join("; ")}) — fix: ${fixes.join(" && ")}`;
  }
  return check;
}
