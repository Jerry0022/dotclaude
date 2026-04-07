/**
 * @module ship/lib/version
 * @description Version file detection, reading, bumping, and verification.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveGitRoot } from "./resolve-root.js";

/**
 * Detect project type: 'plugin', 'npm', or 'marketplace'.
 * Marketplace is a fallback for repos that only have marketplace.json
 * (e.g. the plugin's own repository with no root-level plugin.json).
 */
export function detectProjectType(cwd = process.cwd()) {
  try {
    readFileSync(join(cwd, ".claude-plugin", "plugin.json"), "utf8");
    return "plugin";
  } catch {
    try {
      readFileSync(join(cwd, "package.json"), "utf8");
      return "npm";
    } catch {
      try {
        readFileSync(join(cwd, ".claude-plugin", "marketplace.json"), "utf8");
        return "marketplace";
      } catch {
        return null;
      }
    }
  }
}

/**
 * Read the current version from the source of truth.
 */
export function readVersion(cwd = process.cwd()) {
  const type = detectProjectType(cwd);
  if (type === "plugin") {
    const raw = JSON.parse(readFileSync(join(cwd, ".claude-plugin", "plugin.json"), "utf8"));
    return { version: raw.version, type, file: ".claude-plugin/plugin.json" };
  }
  if (type === "npm") {
    const raw = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return { version: raw.version, type, file: "package.json" };
  }
  if (type === "marketplace") {
    const raw = JSON.parse(readFileSync(join(cwd, ".claude-plugin", "marketplace.json"), "utf8"));
    return { version: raw.metadata.version, type, file: ".claude-plugin/marketplace.json" };
  }
  return { version: null, type: null, file: null };
}

/**
 * Compute the next version given a bump type.
 */
export function bumpVersion(current, bump) {
  if (bump === "none") return current;
  const [major, minor, patch] = current.split(".").map(Number);
  switch (bump) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
    default: return current;
  }
}

/**
 * Update all version files. Returns list of { file, updated } objects.
 */
export function updateVersionFiles(oldVersion, newVersion, cwd = process.cwd()) {
  const type = detectProjectType(cwd);
  const results = [];

  const updateJson = (relPath, field = "version") => {
    const absPath = join(cwd, relPath);
    try {
      const raw = readFileSync(absPath, "utf8");
      const obj = JSON.parse(raw);
      const nested = field.split(".");
      let target = obj;
      for (let i = 0; i < nested.length - 1; i++) target = target[nested[i]];
      const key = nested[nested.length - 1];
      if (target[key] === newVersion) {
        results.push({ file: relPath, updated: false, reason: "already up to date" });
      } else if (typeof target[key] === "string") {
        // Force-set to newVersion regardless of current value.
        // Prevents silent drift when a satellite file is already out of sync.
        target[key] = newVersion;
        writeFileSync(absPath, JSON.stringify(obj, null, 2) + "\n");
        results.push({ file: relPath, updated: true });
      } else {
        results.push({ file: relPath, updated: false, reason: "field missing or not a string" });
      }
    } catch {
      results.push({ file: relPath, updated: false, reason: "not found" });
    }
  };

  const updateReadme = () => {
    const absPath = join(cwd, "README.md");
    try {
      const content = readFileSync(absPath, "utf8");
      // Generic pattern — matches any version, not just oldVersion.
      // Prevents silent drift when README is already out of sync.
      const re = /\*\*Version:\s*[^\s*]+\*\*/;
      const updated = content.replace(re, `**Version: ${newVersion}**`);
      if (updated !== content) {
        writeFileSync(absPath, updated);
        results.push({ file: "README.md", updated: true });
      } else {
        results.push({ file: "README.md", updated: false, reason: "pattern not found or already up to date" });
      }
    } catch {
      results.push({ file: "README.md", updated: false, reason: "not found" });
    }
  };

  const updateMarketplacePlugins = () => {
    const absPath = join(cwd, ".claude-plugin", "marketplace.json");
    try {
      const raw = readFileSync(absPath, "utf8");
      const obj = JSON.parse(raw);
      if (Array.isArray(obj.plugins)) {
        let changed = false;
        for (const p of obj.plugins) {
          if (typeof p.version === "string" && p.version !== newVersion) {
            p.version = newVersion;
            changed = true;
          }
        }
        if (changed) {
          writeFileSync(absPath, JSON.stringify(obj, null, 2) + "\n");
          results.push({ file: ".claude-plugin/marketplace.json (plugins[])", updated: true });
        }
      }
    } catch { /* marketplace.json missing or no plugins array — skip */ }
  };

  // Update nested plugin.json files referenced by marketplace.json plugins[*].source
  const updateNestedPluginJsonFiles = () => {
    try {
      const mktRaw = readFileSync(join(cwd, ".claude-plugin", "marketplace.json"), "utf8");
      const mkt = JSON.parse(mktRaw);
      if (Array.isArray(mkt.plugins)) {
        for (const p of mkt.plugins) {
          if (p.source) {
            updateJson(join(p.source, ".claude-plugin", "plugin.json"));
          }
        }
      }
    } catch { /* skip */ }
  };

  // Source of truth
  if (type === "plugin") {
    updateJson(".claude-plugin/plugin.json");
    updateJson(".claude-plugin/marketplace.json", "metadata.version");
    updateMarketplacePlugins();
    updateJson("package.json");
  } else if (type === "npm") {
    updateJson("package.json");
  } else if (type === "marketplace") {
    updateJson(".claude-plugin/marketplace.json", "metadata.version");
    updateMarketplacePlugins();
    updateNestedPluginJsonFiles();
  }

  updateReadme();

  // ── Repo-root sweep (plugin-dev scenario) ──────────────────────────
  // When the MCP server CWD is a subdirectory of the git repo (e.g.
  // plugins/dotclaude-dev-ops/), version files at the repo root
  // (README.md, marketplace.json) are outside CWD scope.
  // This sweep updates them without affecting consumer projects where
  // gitRoot === cwd.
  const gitRoot = resolveGitRoot(cwd);
  if (gitRoot && resolve(gitRoot) !== resolve(cwd)) {
    // README.md at repo root
    try {
      const content = readFileSync(join(gitRoot, "README.md"), "utf8");
      const re = /\*\*Version:\s*[^\s*]+\*\*/;
      const replaced = content.replace(re, `**Version: ${newVersion}**`);
      if (replaced !== content) {
        writeFileSync(join(gitRoot, "README.md"), replaced);
        results.push({ file: "(repo-root) README.md", updated: true });
      }
    } catch { /* no README at repo root — skip */ }

    // marketplace.json at repo root (metadata.version + plugins[*].version)
    const mktPath = join(gitRoot, ".claude-plugin", "marketplace.json");
    try {
      const raw = readFileSync(mktPath, "utf8");
      const obj = JSON.parse(raw);
      let changed = false;
      if (typeof obj.metadata?.version === "string" && obj.metadata.version !== newVersion) {
        obj.metadata.version = newVersion;
        changed = true;
      }
      if (Array.isArray(obj.plugins)) {
        for (const p of obj.plugins) {
          if (typeof p.version === "string" && p.version !== newVersion) {
            p.version = newVersion;
            changed = true;
          }
        }
      }
      if (changed) {
        writeFileSync(mktPath, JSON.stringify(obj, null, 2) + "\n");
        results.push({ file: "(repo-root) .claude-plugin/marketplace.json", updated: true });
      }
    } catch { /* no marketplace.json at repo root — skip */ }
  }

  return results;
}

/**
 * Verify all version files match the expected version.
 * Returns { consistent, mismatches }.
 */
export function verifyVersionFiles(expectedVersion, cwd = process.cwd()) {
  const type = detectProjectType(cwd);
  const mismatches = [];

  const checkJson = (relPath, field = "version") => {
    try {
      const obj = JSON.parse(readFileSync(join(cwd, relPath), "utf8"));
      const nested = field.split(".");
      let val = obj;
      for (const k of nested) val = val[k];
      if (val !== expectedVersion) {
        mismatches.push({ file: relPath, expected: expectedVersion, found: val });
      }
    } catch { /* skip missing files */ }
  };

  const checkReadme = () => {
    try {
      const content = readFileSync(join(cwd, "README.md"), "utf8");
      const match = content.match(/\*\*Version:\s*([^\s*]+)\*\*/);
      if (match && match[1] !== expectedVersion) {
        mismatches.push({ file: "README.md", expected: expectedVersion, found: match[1] });
      } else if (!match) {
        mismatches.push({ file: "README.md", expected: expectedVersion, found: "(no badge)" });
      }
    } catch { /* skip */ }
  };

  const checkChangelog = () => {
    try {
      const content = readFileSync(join(cwd, "CHANGELOG.md"), "utf8");
      const match = content.match(/##\s*\[([^\]]+)\]/);
      if (match && match[1] !== expectedVersion) {
        mismatches.push({ file: "CHANGELOG.md", expected: expectedVersion, found: match[1] });
      }
    } catch {
      // Only report missing if the sweep won't check it at repo root
      const gitRoot = resolveGitRoot(cwd);
      if (!gitRoot || resolve(gitRoot) === resolve(cwd)) {
        mismatches.push({ file: "CHANGELOG.md", expected: "file to exist", found: "(missing)" });
      }
    }
  };

  const checkMarketplacePlugins = () => {
    try {
      const obj = JSON.parse(readFileSync(join(cwd, ".claude-plugin", "marketplace.json"), "utf8"));
      if (Array.isArray(obj.plugins)) {
        for (let i = 0; i < obj.plugins.length; i++) {
          const v = obj.plugins[i].version;
          if (typeof v === "string" && v !== expectedVersion) {
            mismatches.push({
              file: `.claude-plugin/marketplace.json (plugins[${i}])`,
              expected: expectedVersion,
              found: v,
            });
          }
        }
      }
    } catch { /* skip */ }
  };

  const checkNestedPluginJsonFiles = () => {
    try {
      const mkt = JSON.parse(readFileSync(join(cwd, ".claude-plugin", "marketplace.json"), "utf8"));
      if (Array.isArray(mkt.plugins)) {
        for (const p of mkt.plugins) {
          if (p.source) {
            checkJson(join(p.source, ".claude-plugin", "plugin.json"));
          }
        }
      }
    } catch { /* skip */ }
  };

  if (type === "plugin") {
    checkJson(".claude-plugin/plugin.json");
    checkJson(".claude-plugin/marketplace.json", "metadata.version");
    checkMarketplacePlugins();
    checkJson("package.json");
  } else if (type === "npm") {
    checkJson("package.json");
  } else if (type === "marketplace") {
    checkJson(".claude-plugin/marketplace.json", "metadata.version");
    checkMarketplacePlugins();
    checkNestedPluginJsonFiles();
  }

  checkReadme();
  checkChangelog();

  // ── Repo-root sweep (plugin-dev scenario) ──────────────────────────
  const gitRoot = resolveGitRoot(cwd);
  if (gitRoot && resolve(gitRoot) !== resolve(cwd)) {
    // README.md at repo root
    try {
      const content = readFileSync(join(gitRoot, "README.md"), "utf8");
      const match = content.match(/\*\*Version:\s*([^\s*]+)\*\*/);
      if (match && match[1] !== expectedVersion) {
        mismatches.push({ file: "(repo-root) README.md", expected: expectedVersion, found: match[1] });
      } else if (!match) {
        mismatches.push({ file: "(repo-root) README.md", expected: expectedVersion, found: "(no badge)" });
      }
    } catch { /* skip */ }

    // marketplace.json at repo root
    try {
      const obj = JSON.parse(readFileSync(join(gitRoot, ".claude-plugin", "marketplace.json"), "utf8"));
      if (typeof obj.metadata?.version === "string" && obj.metadata.version !== expectedVersion) {
        mismatches.push({ file: "(repo-root) .claude-plugin/marketplace.json (metadata)", expected: expectedVersion, found: obj.metadata.version });
      }
      if (Array.isArray(obj.plugins)) {
        for (let i = 0; i < obj.plugins.length; i++) {
          const v = obj.plugins[i].version;
          if (typeof v === "string" && v !== expectedVersion) {
            mismatches.push({ file: `(repo-root) .claude-plugin/marketplace.json (plugins[${i}])`, expected: expectedVersion, found: v });
          }
        }
      }
    } catch { /* skip */ }

    // CHANGELOG.md at repo root
    try {
      const content = readFileSync(join(gitRoot, "CHANGELOG.md"), "utf8");
      const match = content.match(/##\s*\[([^\]]+)\]/);
      if (match && match[1] !== expectedVersion) {
        mismatches.push({ file: "(repo-root) CHANGELOG.md", expected: expectedVersion, found: match[1] });
      }
    } catch { /* skip */ }
  }

  return { consistent: mismatches.length === 0, mismatches };
}
