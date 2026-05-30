/**
 * @tool ship_preflight
 * @description Pre-flight safety checks before shipping.
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { git, currentBranch, dirtyState, commitsAhead, unpushedCommits, isWorktree, detectParentBranch, detectDefaultBranch, branchExists, fileOverlap, getConfig } from "../lib/git.js";
import { readVersion, verifyVersionFiles } from "../lib/version.js";
import { writeSentinel } from "../lib/sentinel.js";
import { detectRepoMode } from "../lib/repo-mode.js";

export const schema = z.object({
  base: z.string().optional().describe("Base branch to ship into. Omit to auto-detect: parent branch (from sub-branch naming) or the repository's default branch (origin/HEAD, typically 'main' or 'master')."),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
});

function latestMtime(dir, depth) {
  let max = 0
  let entries
  try { entries = readdirSync(dir) } catch { return max }
  for (const name of entries) {
    if (name === ".git" || name === "node_modules") continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.mtimeMs > max) max = st.mtimeMs
    if (depth > 0 && st.isDirectory()) {
      const child = latestMtime(full, depth - 1)
      if (child > max) max = child
    }
  }
  return max
}

// Cosmetic-only: used in completion-card display for file-only mode.
// NOT a stable identity token — collisions within 1s, depth limited to 2.
function pseudoCommit(mtimeMs) {
  const ts = Math.floor(mtimeMs / 1000)
  return createHash("sha1").update("mtime-" + ts).digest("hex").slice(0, 7)
}

// Doc-sync check (plugin source repo only). Two guarantees:
//   1. Auto-marker counts/roster in README.md + architecture.html are current.
//   2. Every skill/agent on disk has a (manually curated) row in the README
//      tables — the one thing the generator deliberately does NOT auto-write.
// Returns check objects (with `.warning` so they flow into the warnings list).
// Never produces errors — doc drift warns, it does not block a ship.
function docSyncChecks(cwd) {
  const pluginDir = join(cwd, "plugins", "devops");
  if (!existsSync(pluginDir)) return []; // consumer repo — nothing to verify
  const out = [];

  // 1. Marker staleness via the generator's --check mode
  const genScript = join(pluginDir, "scripts", "gen-readme-sections.js");
  if (existsSync(genScript)) {
    try {
      execFileSync(process.execPath, [genScript, "--check", cwd], { stdio: "pipe" });
      out.push({ name: "doc-markers", ok: true });
    } catch {
      out.push({
        name: "doc-markers",
        ok: false,
        warning: "README/architecture.html auto-markers are stale — ship_build regenerates them automatically",
      });
    }
  }

  // 2. Skill/agent table completeness (curated rows, not auto-generated)
  try {
    const readme = readFileSync(join(cwd, "README.md"), "utf8");
    const skills = readdirSync(join(pluginDir, "skills"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(pluginDir, "skills", d.name, "SKILL.md")))
      .map((d) => d.name);
    const agents = readdirSync(join(pluginDir, "agents"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));

    const missingSkills = skills.filter((s) => !readme.includes(`/${s}`));
    const missingAgents = agents.filter((a) => !readme.includes(`**${a}**`));

    if (missingSkills.length || missingAgents.length) {
      const parts = [];
      if (missingSkills.length) parts.push(`skills: ${missingSkills.join(", ")}`);
      if (missingAgents.length) parts.push(`agents: ${missingAgents.join(", ")}`);
      out.push({
        name: "doc-tables",
        ok: false,
        warning: `README tables missing rows for ${parts.join(" · ")} — add a curated description`,
      });
    } else {
      out.push({ name: "doc-tables", ok: true });
    }
  } catch { /* README or dirs unreadable — skip silently */ }

  return out;
}

export async function handler(params) {
  let { base } = params;
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const opts = { cwd };
  const checks = [];
  const errors = [];

  const repoMode = detectRepoMode(cwd)

  // file-only: not a git repo — return synthetic preflight result immediately
  if (repoMode === "none") {
    const mtime = latestMtime(cwd, 2)
    const commit = pseudoCommit(mtime)
    return {
      ready: true,
      mode: "file-only",
      branch: "<file-only>",
      base: null,
      autoDetectedBase: null,
      intermediate: false,
      ahead: null,
      unpushed: null,
      inWorktree: false,
      needsRebase: false,
      version: null,
      projectType: null,
      checks: [{ name: "repo-mode", value: "none", ok: true }],
      warnings: [],
      errors: [],
      commit,
    }
  }

  const noRemote = repoMode === "git-no-remote"

  // 1. Current branch
  const branch = currentBranch(opts);
  if (!branch || branch === "HEAD") {
    errors.push(`Cannot ship from '${branch || "detached HEAD"}' — must be on a feature branch`);
    checks.push({ name: "branch", value: branch, ok: false });
  }

  // Resolve the repo's default branch once — used both as a fallback for `base`
  // and as the reference point for the "intermediate merge" check below.
  const defaultBranch = detectDefaultBranch(opts) || "main";
  const baseWasExplicit = typeof base === "string" && base.length > 0;

  // 2. Auto-detect parent branch for sub-branch → feature-branch merges.
  //    Only when the caller didn't pass an explicit base.
  let autoDetectedBase = null;
  if (!baseWasExplicit && branch && branch !== defaultBranch) {
    const parent = detectParentBranch(branch, opts);
    if (parent) {
      autoDetectedBase = parent.parent;
      base = parent.parent;
    }
  }
  // No explicit base and no parent detected → fall back to the repo default.
  if (!base) base = defaultBranch;

  const intermediate = base !== defaultBranch;

  if (branch === base) {
    errors.push(`Cannot ship from '${branch}' — already on base branch '${base}'`);
  }
  checks.push({ name: "branch", value: branch, ok: !errors.length });

  checks.push({ name: "default-branch", value: defaultBranch });
  if (autoDetectedBase) {
    checks.push({ name: "auto-detected-base", value: autoDetectedBase, source: "sub-branch naming" });
  } else if (!baseWasExplicit && base === defaultBranch && branch && (branch.match(/\//g) || []).length >= 2) {
    checks.push({ name: "sub-branch-warning", value: branch, message: "Branch looks like a sub-branch but no parent branch was found. Push the integration branch first." });
    errors.push(`Branch '${branch}' looks like a sub-branch (2+ path segments) but no parent branch exists. Push the integration branch first, or pass an explicit base.`);
  }
  checks.push({ name: "intermediate", value: intermediate });

  // 3. Verify base branch exists (locally or on origin)
  const baseExists = branchExists(base, opts);
  if (!baseExists) {
    errors.push(`Base branch '${base}' does not exist locally or on origin`);
  }
  checks.push({ name: "base-exists", ok: !!baseExists, value: baseExists });

  // 4. Dirty state
  const state = dirtyState(opts);
  if (state.dirty) {
    errors.push(
      `Dirty working tree: ${state.modified.length} modified, ${state.untracked.length} untracked`
    );
  }
  checks.push({ name: "clean-tree", ok: !state.dirty, modified: state.modified.length, untracked: state.untracked.length });

  // 5. Fetch base from origin to ensure accurate commit count (skip when no remote)
  if (!noRemote) git(`fetch origin ${base}`, opts);

  // 6. Commits ahead (compare against origin/ ref for accuracy)
  const originBase = `origin/${base}`;
  const aheadRef = !noRemote && (baseExists === "remote" || baseExists === "local") ? originBase : base;
  const ahead = commitsAhead(aheadRef, opts);
  if (ahead === 0) {
    errors.push(`No commits ahead of ${base} — nothing to ship`);
  }
  checks.push({ name: "commits-ahead", value: ahead, ok: ahead > 0 });

  // 7. Unpushed commits (hard gate — must be 0 before shipping; skip when no remote)
  const unpushed = noRemote ? null : unpushedCommits(opts);
  if (!noRemote && unpushed !== null && unpushed > 0) {
    errors.push(`${unpushed} unpushed commit(s) — push before shipping`);
  }
  checks.push({ name: "all-pushed", value: unpushed, ok: unpushed === 0 || unpushed === null, ...(noRemote && { skipped: true, reason: "no-remote" }) });

  // 8. Base branch ahead check (skip when no remote — nothing to compare against)
  if (!noRemote) {
    const baseBehindCount = (() => {
      const count = git(`rev-list --count HEAD..${originBase}`, opts);
      return count ? parseInt(count, 10) : 0;
    })();
    checks.push({
      name: "base-ahead",
      value: baseBehindCount,
      ok: baseBehindCount === 0,
      ...(baseBehindCount > 0 && { warning: `Base branch '${base}' is ${baseBehindCount} commit(s) ahead — rebase will be handled automatically` }),
    });
  } else {
    checks.push({ name: "base-ahead", value: 0, ok: true, skipped: true, reason: "no-remote" });
  }

  // 9. File overlap detection (skip when no remote — no origin ref to compare)
  if (!noRemote) {
    const overlap = fileOverlap(originBase, opts);
    if (overlap.overlap.length > 0) {
      checks.push({
        name: "file-overlap",
        ok: false,
        count: overlap.overlap.length,
        files: overlap.overlap.slice(0, 20),
        totalBranchFiles: overlap.branchFiles.length,
        totalBaseFiles: overlap.baseFiles.length,
        mergeBase: overlap.mergeBase?.slice(0, 8),
        warning: `${overlap.overlap.length} file(s) modified in both branches — will be resolved during rebase`,
      });
    } else {
      checks.push({ name: "file-overlap", ok: true, count: 0 });
    }
  } else {
    checks.push({ name: "file-overlap", ok: true, count: 0, skipped: true, reason: "no-remote" });
  }

  // 10. Git config check (warning — auto-fixed by ship skill)
  const conflictStyle = getConfig("merge.conflictstyle", opts);
  if (conflictStyle !== "diff3" && conflictStyle !== "zdiff3") {
    checks.push({ name: "config-conflictstyle", ok: false, current: conflictStyle, recommended: "diff3", warning: "Will be set automatically before rebase" });
  } else {
    checks.push({ name: "config-conflictstyle", ok: true, current: conflictStyle });
  }

  // Version consistency (skip for intermediate merges — versions only matter on main)
  let versionInfo = { version: null, type: null };
  if (!intermediate) {
    versionInfo = readVersion(cwd);
    let versionOk = true;
    let versionMismatches = [];
    if (versionInfo.version) {
      const result = verifyVersionFiles(versionInfo.version, cwd);
      versionOk = result.consistent;
      versionMismatches = result.mismatches;
      if (!versionOk) {
        errors.push(`Version mismatch: ${versionMismatches.map(m => m.file).join(", ")}`);
      }
    }
    checks.push({ name: "version-consistent", ok: versionOk, version: versionInfo.version, mismatches: versionMismatches });
  } else {
    checks.push({ name: "version-consistent", ok: true, skipped: true, reason: "intermediate merge" });
  }

  // Worktree detection
  const inWorktree = isWorktree(opts);
  checks.push({ name: "worktree", value: inWorktree });

  // Doc-sync (plugin source repo only — no-op elsewhere). Non-blocking.
  checks.push(...docSyncChecks(cwd));

  // Collect warnings from checks (non-blocking issues resolved autonomously)
  const warnings = checks.filter(c => c.warning).map(c => c.warning);
  if (noRemote) warnings.push("No origin remote — push, PR creation, and merge will be skipped");

  // Determine if rebase is needed (any merge-safety warnings present)
  const needsRebase = checks.some(c =>
    !c.ok && (c.name === "base-ahead" || c.name === "file-overlap" || c.name === "config-conflictstyle")
  );

  const ready = errors.length === 0;

  // Mark the ship pipeline as in-progress only after all hard gates passed,
  // so pre.main.guard / pre.edit.branch don't block ship internals when Claude
  // falls back to Bash. Cleared by ship_cleanup on every exit path.
  if (ready) writeSentinel(cwd);

  return {
    ready,
    mode: repoMode,
    branch,
    base,
    autoDetectedBase,
    intermediate,
    ahead,
    unpushed,
    inWorktree,
    needsRebase,
    version: versionInfo.version,
    projectType: versionInfo.type,
    checks,
    warnings,
    errors,
  };
}
