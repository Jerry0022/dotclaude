/**
 * @tool ship_version_bump
 * @description Bump version in all project files, verify consistency.
 */

import { z } from "zod";
import { readVersion, bumpVersion, updateVersionFiles, verifyVersionFiles } from "../lib/version.js";
import { detectRepoMode } from "../lib/repo-mode.js";

// Project-declared version files (#941), captured by do-ship Step 0 from the
// ship extension's `versionFiles:` field. Shared by ship_preflight and ship_run.
export const versionFilesSchema = z.array(z.object({
  path: z.string(),
  key: z.string().optional(),
  pattern: z.string().optional(),
})).optional().describe("Extra version files the project declares: { path, key } (JSON, dotted key) or { path, pattern } (regex source, first capture group = the version). Bumped with the built-in files and checked by version-consistent.");

export const schema = z.object({
  bump: z.enum(["patch", "minor", "major", "none"]).describe("Semantic version bump type"),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
  versionFiles: versionFilesSchema,
});

export async function handler(params) {
  const { bump } = params;
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");

  // Read current version
  const { version: vOld, type: projectType, file: sourceFile } = readVersion(cwd);
  if (!vOld) {
    if (detectRepoMode(cwd) === "none") {
      return { success: true, skipped: true, reason: "no-manifest-in-file-only-mode", version: null };
    }
    return { success: true, skipped: true, reason: "no-manifest" };
  }

  // Skip if no bump
  if (bump === "none") {
    return {
      success: true,
      bump: "none",
      vOld,
      vNew: vOld,
      filesUpdated: [],
      verified: true,
      mismatches: [],
    };
  }

  // Compute new version
  const vNew = bumpVersion(vOld, bump);

  // Update all version files (except CHANGELOG — Claude handles that editorially)
  const versionFiles = params.versionFiles || [];
  const filesUpdated = updateVersionFiles(vOld, vNew, cwd, versionFiles);

  // Verify all files match
  const verification = verifyVersionFiles(vNew, cwd, versionFiles);

  return {
    success: verification.consistent,
    bump,
    vOld,
    vNew,
    projectType,
    sourceFile,
    filesUpdated,
    verified: verification.consistent,
    mismatches: verification.mismatches,
  };
}
