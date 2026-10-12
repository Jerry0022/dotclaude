/**
 * @module ship/lib/components
 * @description Detect sub-app releases in a branch diff (#695).
 *
 * A multi-app repo ships a sub-app (a desktop app in its own folder, a data
 * uploader) with its own version in its own manifest. The completion card can
 * name such a component separately (`delivery.ship.components`) instead of
 * gluing the sub-app's name into the root version. This module finds the
 * candidates, conservatively: a component is a manifest OUTSIDE the repo root
 * (package.json, Cargo.toml, pyproject.toml) that the diff touches AND whose
 * own `version` changed against the base. A sub-folder that merely has a
 * manifest (shared deps, tooling) is no release and is never reported.
 *
 * The result is a hint for the caller (the do-ship skill), never a decision:
 * the display name, tag and channel come from the project's own release flow.
 */

import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

export const COMPONENT_MANIFESTS = ["package.json", "Cargo.toml", "pyproject.toml"];

// Sections whose `name` / `version` describe the package itself.
const TOML_SECTIONS = new Set(["package", "project", "tool.poetry"]);

/**
 * `{ name, version }` from a manifest's text; empty strings when absent.
 * TOML is read line by line — only plain `key = "value"` pairs inside the
 * package section count (`version.workspace = true` has no own version).
 */
export function parseManifest(manifest, text) {
  const out = { name: "", version: "" };
  if (typeof text !== "string" || !text) return out;
  if (manifest === "package.json") {
    try {
      const pkg = JSON.parse(text);
      out.name = typeof pkg.name === "string" ? pkg.name : "";
      out.version = typeof pkg.version === "string" ? pkg.version : "";
    } catch { /* unreadable manifest — no version */ }
    return out;
  }
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) { section = head[1].trim(); continue; }
    if (!TOML_SECTIONS.has(section)) continue;
    // TOML strings may be basic ("…") or literal ('…').
    const kv = /^(name|version)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    if (kv && !out[kv[1]]) out[kv[1]] = kv[2] ?? kv[3];
  }
  return out;
}

/**
 * Sub-app manifests whose version this diff changed.
 *
 * @param {string[]} files repo-relative paths the branch touches
 * @param {{ cwd: string, readBase: (path: string) => string|null }} io
 *   `readBase` returns the manifest's text on the base ref (null = new file)
 * @returns {Array<{ dir: string, manifest: string, name: string, version: string, previousVersion: string|null }>}
 */
export function detectComponents(files, { cwd, readBase }) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(files) ? files : []) {
    const path = String(f).replace(/\\/g, "/");
    const manifest = posix.basename(path);
    const dir = posix.dirname(path);
    if (!COMPONENT_MANIFESTS.includes(manifest) || dir === "." || seen.has(path)) continue;
    if (/(^|\/)node_modules\//.test(path)) continue;
    seen.add(path);
    let now;
    try { now = parseManifest(manifest, readFileSync(join(cwd, path), "utf8")); } catch { continue; }
    if (!now.version) continue;
    const before = parseManifest(manifest, readBase(path) || "");
    if (before.version === now.version) continue;
    out.push({
      dir, manifest, name: now.name || posix.basename(dir), version: now.version,
      previousVersion: before.version || null,
    });
  }
  return out;
}
