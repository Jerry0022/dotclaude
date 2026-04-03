/**
 * @module ship/lib/version
 * @description Version file detection, reading, bumping, and verification.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Detect project type: 'plugin' or 'npm'.
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
      return null;
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
      if (target[nested[nested.length - 1]] === oldVersion) {
        target[nested[nested.length - 1]] = newVersion;
        writeFileSync(absPath, JSON.stringify(obj, null, 2) + "\n");
        results.push({ file: relPath, updated: true });
      } else {
        results.push({ file: relPath, updated: false, reason: "version mismatch" });
      }
    } catch {
      results.push({ file: relPath, updated: false, reason: "not found" });
    }
  };

  const updateReadme = () => {
    const absPath = join(cwd, "README.md");
    try {
      let content = readFileSync(absPath, "utf8");
      const re = new RegExp(`\\*\\*Version:\\s*${escapeRegex(oldVersion)}\\*\\*`, "g");
      if (re.test(content)) {
        content = content.replace(re, `**Version: ${newVersion}**`);
        writeFileSync(absPath, content);
        results.push({ file: "README.md", updated: true });
      } else {
        results.push({ file: "README.md", updated: false, reason: "pattern not found" });
      }
    } catch {
      results.push({ file: "README.md", updated: false, reason: "not found" });
    }
  };

  // Source of truth
  if (type === "plugin") {
    updateJson(".claude-plugin/plugin.json");
    updateJson(".claude-plugin/marketplace.json", "metadata.version");
    updateJson("package.json");
  } else if (type === "npm") {
    updateJson("package.json");
  }

  updateReadme();

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
      mismatches.push({ file: "CHANGELOG.md", expected: "file to exist", found: "(missing)" });
    }
  };

  if (type === "plugin") {
    checkJson(".claude-plugin/plugin.json");
    checkJson(".claude-plugin/marketplace.json", "metadata.version");
    checkJson("package.json");
  } else if (type === "npm") {
    checkJson("package.json");
  }

  checkReadme();
  checkChangelog();

  return { consistent: mismatches.length === 0, mismatches };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
