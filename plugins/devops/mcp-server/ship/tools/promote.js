/**
 * @tool ship_promote
 * @description Promote a shipped version to a higher channel by re-tagging the
 *   SAME commit SHA (alpha→beta→stable). Never rebuilds, never bumps versions —
 *   promotion is bit-identical by construction (spec §4.1). All tags are
 *   annotated (promotion time/actor derivable from tag metadata) and every
 *   step is skip-if-exists idempotent so partial failures recover by re-run.
 */

import { z } from "zod";
import { execFileSync } from "node:child_process";
import { git, gitStrict } from "../lib/git.js";
import { createRelease, releaseExists } from "../lib/github.js";
import { parseChannelTag, compareVersions } from "../lib/channels.js";

export const schema = z.object({
  version: z.string().describe("Bare version to promote, e.g. 0.113.0 (no v prefix, no channel)"),
  from: z.enum(["alpha", "beta"]).describe("Source channel the version currently lives in"),
  to: z.enum(["beta", "stable"]).describe("Target channel (must be more stable than source)"),
  releaseNotes: z.string().nullable().default(null).describe("CHANGELOG entry for the stable GitHub Release fallback — ignored for beta"),
  releasePollAttempts: z.number().int().min(1).max(30).default(6).describe("How often to poll for the release.yml-created GitHub Release before falling back"),
  releasePollDelayMs: z.number().int().min(0).max(60_000).default(10_000).describe("Delay between release polls"),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
});

const ORDER = { alpha: 0, beta: 1, stable: 2 };

function lsRemoteTag(tag, opts) {
  const out = git(`ls-remote --tags origin ${tag}`, opts);
  if (!out || !out.includes(`refs/tags/${tag}`)) return null;
  return out.trim().split(/\s+/)[0] || null;
}

function listRemoteChannelTags(opts) {
  const out = git(`ls-remote --tags origin`, opts) || "";
  const tags = [];
  for (const line of out.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    const parsed = parseChannelTag(ref);
    if (!parsed) continue;
    tags.push({ sha, tag: ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, ""), ...parsed });
  }
  return tags;
}

/**
 * Create + push one annotated tag, skip-if-exists. Returns
 * { ok: true } | { ok: true, existed: true } | { ok: false, error }.
 * An existing remote tag on a DIFFERENT SHA is a hard error — published
 * tags are immutable, never moved (spec §2).
 */
function ensureTag(tag, sha, payload, opts) {
  const existing = lsRemoteTag(tag, opts);
  if (existing) {
    if (existing !== sha) {
      return { ok: false, error: `tag ${tag} already exists on remote at ${existing.slice(0, 12)} (expected ${sha.slice(0, 12)}) — published tags are immutable` };
    }
    return { ok: true, existed: true };
  }
  try {
    // Annotated (-a): promotion timestamp/actor live in the tag object —
    // lightweight tags would collapse all channels onto the commit date (R4).
    execFileSync("git", ["tag", "-a", tag, sha, "-m", JSON.stringify(payload)], {
      cwd: opts.cwd,
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    gitStrict(`push origin ${tag}`, { ...opts, timeout: 60_000 });
    const verify = lsRemoteTag(tag, opts);
    if (verify !== sha) return { ok: false, error: `tag ${tag} not verifiable on remote after push` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 300) || "tag creation failed" };
  }
}

export async function handler(params) {
  const { version, from, to, releaseNotes, releasePollAttempts, releasePollDelayMs } = params;
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const opts = { cwd };

  const result = { version, from, to };

  if (ORDER[to] <= ORDER[from]) {
    return { ...result, success: false, error: `invalid promotion direction: ${from} → ${to}` };
  }

  // 1. Resolve source tag → SHA (remote is the source of truth, never local state)
  const sourceTag = `${from}/v${version}`;
  const sha = lsRemoteTag(sourceTag, opts);
  if (!sha) {
    return { ...result, success: false, error: `source-tag-not-found: ${sourceTag} does not exist on origin` };
  }
  result.sha = sha;

  // 2. Monotonicity guard (spec §4.1.2, amended per R6):
  //    empty target → allow; version > latest → allow;
  //    version == latest on the same SHA → idempotent path (re-run recovery);
  //    version < latest → refuse (invisible under latest-resolution).
  const remoteTags = listRemoteChannelTags(opts);
  const targetTags = remoteTags.filter((t) => t.channel === to);
  let targetLatest = null;
  for (const t of targetTags) {
    if (!targetLatest || compareVersions(t.version, targetLatest.version) > 0) targetLatest = t;
  }
  const targetExisting = targetTags.find((t) => t.version === version) || null;
  if (targetLatest && compareVersions(version, targetLatest.version) < 0) {
    return {
      ...result,
      success: false,
      error: `monotonicity: ${to} is already at v${targetLatest.version} — promoting v${version} would be invisible to consumers (latest-resolution). Roll forward instead.`,
    };
  }
  if (targetExisting && targetExisting.sha !== sha) {
    return { ...result, success: false, error: `tag ${to}/v${version} already exists on a different SHA — published tags are immutable` };
  }

  // 3. Ancestry guard: only commits reachable from origin/main are promotable.
  try {
    gitStrict(`fetch origin main`, { ...opts, timeout: 30_000 });
    gitStrict(`merge-base --is-ancestor ${sha} origin/main`, opts);
  } catch {
    return { ...result, success: false, error: `ancestry: ${sha.slice(0, 12)} is not an ancestor of origin/main — refusing to promote an unmerged/foreign commit` };
  }

  // 4./5. Create tags — target first, then (stable only) the bare alias.
  //       Ordered + individually idempotent = deterministic partial-failure
  //       recovery (spec §4.1.5 / R7).
  const plan = [{ tag: `${to}/v${version}`, payload: { from, to, version } }];
  if (to === "stable") {
    plan.push({ tag: `v${version}`, payload: { from: "stable", to: "bare", version } });
  }

  const pushed = [];
  const missing = [];
  let anyCreated = false;
  for (const step of plan) {
    const r = ensureTag(step.tag, sha, step.payload, opts);
    if (r.ok) {
      pushed.push(step.tag);
      if (!r.existed) anyCreated = true;
    } else {
      missing.push(step.tag);
      result.error = r.error;
      break; // keep ordering guarantee — don't create bare before stable succeeded
    }
  }
  result.tag = plan[0].tag;
  if (to === "stable") result.bareTag = `v${version}`;
  result.pushed = pushed;
  if (missing.length) {
    // Remaining plan steps that were never attempted are also missing.
    const attempted = new Set([...pushed, ...missing]);
    for (const step of plan) if (!attempted.has(step.tag)) missing.push(step.tag);
    return { ...result, success: false, missing };
  }

  // 6. GitHub Release — stable only (beta is tags-only at launch, PO/O2).
  //    The bare tag push triggers release.yml; poll for its Release, create
  //    as fallback. Skip-if-exists keeps both producers idempotent.
  if (to === "stable") {
    const bareTag = `v${version}`;
    let exists = false;
    for (let i = 0; i < releasePollAttempts; i++) {
      if (releaseExists(bareTag, opts)) { exists = true; break; }
      if (i < releasePollAttempts - 1 && releasePollDelayMs > 0) {
        await new Promise((r) => setTimeout(r, releasePollDelayMs));
      }
    }
    if (!exists) {
      try {
        createRelease({ tag: bareTag, title: bareTag, notes: releaseNotes || `Release ${bareTag}`, prerelease: false }, opts);
        exists = true;
      } catch (e) {
        result.releaseError = e.message?.slice(0, 200);
      }
    }
    result.release = exists;
  }

  if (!anyCreated && (to !== "stable" || result.release)) {
    result.alreadyPromoted = true;
  }
  result.success = true;
  return result;
}
