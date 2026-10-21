/**
 * Stale session-server notice. A Desktop session keeps the MCP server process
 * it started with, so a plugin update mid-day leaves it rendering cards with
 * the OLD code while the user believes the fix is live. The server compares
 * the version it loaded at startup with the installed one and the card says so.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.]+)?$/;

/** @returns {number[]|null} [major, minor, patch] or null when not a version */
function parse(v) {
  const m = SEMVER.exec(String(v || "").trim().replace(/^v/, ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True only when both parse and `a` is strictly newer than `b`. */
export function semverGreater(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function readLoadedVersion() {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude-plugin", "plugin.json");
    const v = String(JSON.parse(readFileSync(file, "utf8")).version || "");
    return parse(v) ? v : "";
  } catch {
    return "";
  }
}

/** The version this process loaded at startup — read once at module load. */
export const LOADED_VERSION = readLoadedVersion();

/**
 * The newest user-scope devops entry of installed_plugins.json (by
 * lastUpdated). Dev clones (`..clone` keys) are not the installed release.
 * @returns {string} the version, '' when unknown
 */
export function installedVersion(registryFile = process.env.DEVOPS_INSTALLED_PLUGINS_FILE || join(homedir(), ".claude", "plugins", "installed_plugins.json")) {
  try {
    const plugins = JSON.parse(readFileSync(registryFile, "utf8")).plugins || {};
    let best = null;
    for (const [key, entries] of Object.entries(plugins)) {
      if (!/^devops@/.test(key) || key.includes("..clone") || !Array.isArray(entries)) continue;
      for (const e of entries) {
        if (!e || e.scope !== "user" || !parse(e.version)) continue;
        if (!best || String(e.lastUpdated || "") > String(best.lastUpdated || "")) best = e;
      }
    }
    return best ? String(best.version).replace(/^v/, "") : "";
  } catch {
    return "";
  }
}

/**
 * The one info line, or null when the installed version is not newer than
 * the loaded one (or either is unknown). Never throws.
 */
export function staleServerLine(lang, { loaded = LOADED_VERSION, installed } = {}) {
  try {
    const now = installed === undefined ? installedVersion() : installed;
    if (!semverGreater(now, loaded)) return null;
    return lang === "en"
      ? `ℹ Session server v${loaded} — restarting the session loads v${now}.`
      : `ℹ Session-Server v${loaded} — ein Neustart der Session lädt v${now}.`;
  } catch {
    return null;
  }
}
