/**
 * Launch-path detection for the completion card's "App starten" button (#680).
 *
 * The card server checks the project itself at render time — no payload
 * field the model could forget. A project counts as startable when it has
 * one of:
 *   1. `.claude/launch.json` with at least one entry in `configurations`
 *   2. a `scripts/run-local.*` script (any extension)
 *   3. a `package.json` with a non-empty `dev` or `start` script
 *
 * Never fatal: an unreadable or malformed file just means "no launch path",
 * so a broken project file never breaks the card.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function hasLaunchConfig(cwd) {
  const json = readJson(join(cwd, ".claude", "launch.json"));
  return !!(json && Array.isArray(json.configurations) && json.configurations.length > 0);
}

function hasRunLocalScript(cwd) {
  try {
    return readdirSync(join(cwd, "scripts")).some((name) => /^run-local\.[^.]+/i.test(name));
  } catch {
    return false;
  }
}

function hasPackageScript(cwd) {
  const pkg = readJson(join(cwd, "package.json"));
  const scripts = pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : null;
  if (!scripts) return null;
  for (const name of ["dev", "start"]) {
    if (typeof scripts[name] === "string" && scripts[name].trim()) return name;
  }
  return null;
}

/**
 * How the project at `cwd` can be started, or null when it cannot be told.
 *
 * @param {string|undefined|null} cwd the card's project directory (input.cwd)
 * @returns {'launch.json'|'run-local'|'npm-dev'|'npm-start'|null}
 */
export function detectLaunchPath(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return null;
  try {
    if (hasLaunchConfig(cwd)) return "launch.json";
    if (hasRunLocalScript(cwd)) return "run-local";
    const script = hasPackageScript(cwd);
    if (script) return `npm-${script}`;
  } catch {
    /* never fatal */
  }
  return null;
}
