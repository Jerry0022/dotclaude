/**
 * @tool ship_version_bump
 * @description Bump version in all project files, verify consistency.
 */

import { z } from "zod";
import { readVersion, bumpVersion, updateVersionFiles, verifyVersionFiles } from "../lib/version.js";

export const schema = z.object({
  bump: z.enum(["patch", "minor", "major", "none"]).describe("Semantic version bump type"),
  cwd: z.string().optional().describe("Working directory override (e.g. worktree path). Falls back to process.cwd()."),
});

export async function handler(params) {
  const { bump } = params;
  const cwd = params.cwd || process.cwd();

  // Read current version
  const { version: vOld, type: projectType, file: sourceFile } = readVersion(cwd);
  if (!vOld) {
    return {
      success: false,
      error: "No version file found (no plugin.json or package.json)",
    };
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
  const filesUpdated = updateVersionFiles(vOld, vNew, cwd);

  // Verify all files match
  const verification = verifyVersionFiles(vNew, cwd);

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
