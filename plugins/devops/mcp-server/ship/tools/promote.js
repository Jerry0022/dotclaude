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
import { git, gitStrict, NETWORK_TIMEOUT } from "../lib/git.js";
import { createRelease, releaseExists } from "../lib/github.js";
import { parseChannelTag, compareVersions } from "../lib/channels.js";
import { parseLsRemoteTagOutput } from "../lib/remote-tags.js";
import { retryUntil } from "../lib/retry.js";

// Re-exported: the ls-remote dialect now lives in lib/remote-tags.js (shared
// with ship_release), but this module is its established import site.
export { parseLsRemoteTagOutput };

export const schema = z.object({
  // Constrained on purpose: `version` is interpolated into shell-executed git
  // command strings (git()/gitStrict() run through cmd.exe on Windows), so an
  // unvalidated string is a command-injection surface. Semver-shaped only.
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, "version must be semver-shaped, e.g. 0.113.0").describe("Bare version to promote, e.g. 0.113.0 (no v prefix, no channel)"),
  from: z.enum(["alpha", "beta"]).describe("Source channel the version currently lives in"),
  to: z.enum(["beta", "stable"]).describe("Target channel (must be more stable than source)"),
  releaseNotes: z.string().nullable().default(null).describe("CHANGELOG entry for the stable GitHub Release fallback — ignored for beta"),
  releasePollAttempts: z.number().int().min(1).max(30).default(6).describe("How often to poll for the release.yml-created GitHub Release before falling back"),
  releasePollDelayMs: z.number().int().min(0).max(60_000).default(10_000).describe("Delay between release polls"),
  tagPushAttempts: z.number().int().min(1).max(10).default(3).describe("How often to (re-)push a tag whose remote presence could not be confirmed. NOTE: the verify loop nests inside this one, so the read budget per tag is tagPushAttempts × tagVerifyAttempts — bounded in wall-clock by tagBudgetMs"),
  tagVerifyAttempts: z.number().int().min(1).max(20).default(4).describe("How often to re-query the remote per push attempt before declaring a pushed tag missing"),
  tagRetryDelayMs: z.number().int().min(0).max(60_000).default(1_000).describe("Base delay for the tag push/verify backoff (exponential, ×3 per attempt)"),
  tagBudgetMs: z.number().int().min(0).max(600_000).default(120_000).describe("Wall-clock cap for ALL tag push/verify retries in this call. 0 disables the cap. Bounds the nested loops so a promotion cannot hang for minutes on an unreachable remote"),
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
});

const ORDER = { alpha: 0, beta: 1, stable: 2 };

function lsRemoteTag(tag, opts) {
  // Both patterns, both double-quoted: the second is required to surface the
  // peeled ^{} line at all (see parseLsRemoteTagOutput), and unquoted `^` is
  // cmd.exe's escape character (execSync runs through a shell on win32).
  const out = git(`ls-remote --tags origin "${tag}" "${tag}^{}"`, { ...opts, timeout: NETWORK_TIMEOUT });
  // FAIL-CLOSED (F2): git() returns null on a transient network/auth failure.
  // Distinguishing that from "tag absent" (an empty string that parses to null)
  // is load-bearing: a null swallowed as "absent" would let the source-tag
  // lookup, the monotonicity guard, and the same-version-different-SHA
  // immutability guard all silently pass on a remote we could not actually
  // read — re-tagging blindly. Refuse instead of guessing.
  if (out === null) {
    throw new Error(`cannot reach remote — refusing to promote (ls-remote failed for ${tag})`);
  }
  return parseLsRemoteTagOutput(out, tag);
}

/**
 * Parse full `git ls-remote --tags origin` output into one entry per channel
 * tag, carrying the COMMIT sha (peeled `^{}` line wins over the tag-object
 * line — see parseLsRemoteTagOutput). Pure — exported for unit tests.
 * Without the dedupe an annotated tag produced TWO entries under the same tag
 * name, and the monotonicity/immutability guards compared whichever sha they
 * happened to find first.
 */
export function parseLsRemoteChannelTags(out) {
  const byTag = new Map();
  for (const line of (out || "").split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    const parsed = parseChannelTag(ref);
    if (!parsed) continue;
    const peeled = ref.endsWith("^{}");
    const tag = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    if (peeled || !byTag.has(tag)) byTag.set(tag, { sha, tag, ...parsed });
  }
  return [...byTag.values()];
}

function listRemoteChannelTags(opts) {
  const out = git(`ls-remote --tags origin`, { ...opts, timeout: NETWORK_TIMEOUT });
  // FAIL-CLOSED (F2): a null (network/auth failure) previously parsed to an
  // EMPTY tag list — targetLatest became null and BOTH the monotonicity guard
  // and the same-version/different-SHA immutability guard were skipped, letting
  // a downgrade re-tag slip through unseen. Refuse rather than promote against
  // an unread remote.
  if (out === null) {
    throw new Error("cannot reach remote — refusing to promote (ls-remote --tags failed)");
  }
  return parseLsRemoteChannelTags(out);
}

/**
 * One remote read for `tag`, classified into the four outcomes that decide
 * what happens next. Never throws — the fail-closed throw from lsRemoteTag
 * becomes `unreachable`, which is retryable, whereas `conflict` never is.
 *
 *   present     — tag is on the remote at the expected sha (idempotent success)
 *   conflict    — tag is on the remote at a DIFFERENT sha (immutable, hard stop)
 *   absent      — tag is not on the remote (retryable: may be replica lag)
 *   unreachable — the ls-remote itself failed (retryable: transient network)
 */
function probeTag(tag, sha, opts) {
  try {
    const found = lsRemoteTag(tag, opts);
    if (!found) return { state: "absent" };
    return found === sha ? { state: "present" } : { state: "conflict", sha: found };
  } catch (e) {
    return { state: "unreachable", error: e.message?.slice(0, 200) };
  }
}

function immutabilityError(tag, found, sha) {
  return `tag ${tag} already exists on remote at ${found.slice(0, 12)} (expected ${sha.slice(0, 12)}) — published tags are immutable`;
}

/**
 * Ask the remote about `tag` until it settles on present/conflict, or the
 * attempts run out. `absent` and `unreachable` are both retried — the whole
 * point of #251 is that ONE negative read proves nothing.
 */
async function confirmTag(tag, sha, opts, retry) {
  let lastState = "absent";
  const r = await retryUntil(
    () => {
      const p = probeTag(tag, sha, opts);
      lastState = p.state;
      return p.state === "present" || p.state === "conflict" ? p : null;
    },
    {
      attempts: retry.verifyAttempts,
      delayMs: retry.delayMs,
      sleepFn: retry.sleepFn,
      deadline: retry.deadline,
    },
  );
  if (r.ok) return r.value;
  // Budget exhausted. Keep WHY: an unreadable remote is not the same claim as
  // "the tag is not there", and the caller's error text must not assert the
  // stronger one. Both still resolve to "not confirmed" — fail-closed.
  return { state: "absent", unreachable: lastState === "unreachable" };
}

/**
 * Create the annotated tag locally, idempotently.
 * A tag left behind by an earlier failed run must be reused, not re-created —
 * `git tag -a` on an existing name fails, which used to turn a recoverable
 * partial failure into a permanent one on every re-run.
 */
function ensureLocalTag(tag, sha, payload, opts) {
  // FULLY QUALIFIED (`refs/tags/…`): a bare name goes through git's ref
  // disambiguation, which also resolves `refs/heads/<name>` — a local BRANCH
  // called `v0.113.0` would then read as "the tag already exists".
  // Quoted: cmd.exe treats a bare `^` as its escape character (execSync shells out).
  const local = git(`rev-parse -q --verify "refs/tags/${tag}^{commit}"`, opts);
  if (local) {
    if (local !== sha) {
      throw new Error(
        `local tag ${tag} points at ${local.slice(0, 12)}, expected ${sha.slice(0, 12)} — ` +
        `a re-run cannot clear this; delete the stale local tag first (git tag -d ${tag})`,
      );
    }
    return;
  }
  // Annotated (-a): promotion timestamp/actor live in the tag object —
  // lightweight tags would collapse all channels onto the commit date (R4).
  execFileSync("git", ["tag", "-a", tag, sha, "-m", JSON.stringify(payload)], {
    cwd: opts.cwd,
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Create + push one annotated tag, skip-if-exists. Returns
 * { ok: true } | { ok: true, existed: true } | { ok: false, error }.
 * An existing remote tag on a DIFFERENT SHA is a hard error — published
 * tags are immutable, never moved (spec §2).
 *
 * #251: neither the push's exit code nor a single post-push read is
 * authoritative. A push can throw ETIMEDOUT after the ref already updated,
 * and a push can succeed while the very next ls-remote hits a replica that
 * has not caught up. So every push attempt is followed by a *retrying*
 * confirmation, and the confirmation — not the push — decides the outcome.
 */
async function ensureTag(tag, sha, payload, opts, retry) {
  // 1. Pre-check: idempotency + the immutability gate, before touching anything.
  const pre = probeTag(tag, sha, opts);
  if (pre.state === "conflict") return { ok: false, conflict: true, error: immutabilityError(tag, pre.sha, sha) };
  if (pre.state === "present") return { ok: true, existed: true };
  if (pre.state === "unreachable") return { ok: false, error: `cannot reach remote — refusing to promote (${pre.error})` };

  try {
    ensureLocalTag(tag, sha, payload, opts);
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 300) || "tag creation failed" };
  }

  let pushError = null;
  let timedOut = false;
  let unreadable = false;
  for (let attempt = 1; attempt <= retry.pushAttempts; attempt++) {
    if (attempt > 1 && retry.deadline !== null && Date.now() >= retry.deadline) {
      timedOut = true;
      break;
    }
    try {
      // Explicit refspec for the same reason as the rev-parse above: `push
      // origin <name>` would happily push a same-named BRANCH instead.
      gitStrict(`push origin refs/tags/${tag}:refs/tags/${tag}`, { ...opts, timeout: NETWORK_TIMEOUT });
      pushError = null;
    } catch (e) {
      // Recorded, not trusted: the confirmation below has the final word.
      pushError = e.message?.slice(0, 300) || "push failed";
    }

    const confirmed = await confirmTag(tag, sha, opts, retry);
    if (confirmed.state === "present") return { ok: true, pushAttempts: attempt };
    if (confirmed.state === "conflict") {
      return { ok: false, conflict: true, error: immutabilityError(tag, confirmed.sha, sha) };
    }
    if (confirmed.unreachable) unreadable = true;
  }

  const why = unreadable
    ? `remote could not be read to confirm tag ${tag}`
    : `tag ${tag} not verifiable on remote`;
  const bound = timedOut ? `the ${retry.budgetMs}ms retry budget` : `${retry.pushAttempts} push attempt(s)`;
  const suffix = pushError ? ` (last push error: ${pushError})` : "";
  return { ok: false, error: `${why} after ${bound}${suffix}` };
}

export async function handler(params) {
  const { version, from, to, releaseNotes, releasePollAttempts, releasePollDelayMs } = params;
  const cwd = params.cwd;
  if (!cwd) throw new Error("cwd is required — MCP server runs in the plugin directory, not the target repo");
  const opts = { cwd };
  // Schema defaults apply in production; the `??` fallbacks keep direct callers
  // (and tests) working when the params are passed raw.
  const budgetMs = params.tagBudgetMs ?? 120_000;
  const retry = {
    pushAttempts: params.tagPushAttempts ?? 3,
    verifyAttempts: params.tagVerifyAttempts ?? 4,
    delayMs: params.tagRetryDelayMs ?? 1_000,
    sleepFn: params.sleepFn,
    budgetMs,
    // One wall-clock deadline for every tag retry in this call. The push loop
    // nests the verify loop, so attempt counts alone multiply into a worst case
    // nobody sized (3 × 4 reads/tag × 2 tags); this is what actually caps it.
    deadline: budgetMs > 0 ? Date.now() + budgetMs : null,
  };

  const result = { version, from, to };

  try {
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
      gitStrict(`fetch origin main`, { ...opts, timeout: NETWORK_TIMEOUT });
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
    const failed = [];
    let anyCreated = false;
    for (const step of plan) {
      const r = await ensureTag(step.tag, sha, step.payload, opts, retry);
      if (r.ok) {
        pushed.push(step.tag);
        if (!r.existed) anyCreated = true;
      } else {
        failed.push(step.tag);
        result.error = r.error;
        break; // keep ordering guarantee — don't create bare before stable succeeded
      }
    }
    result.tag = plan[0].tag;
    if (to === "stable") result.bareTag = `v${version}`;
    if (failed.length) {
      // #251: never declare a tag missing without one last look at the remote.
      // The reported failure was exactly this — `stable/v0.39.2` listed as
      // missing while `git ls-remote` showed it present. A tag confirmed on the
      // remote at the right sha belongs in `pushed`, whatever the push said.
      const missing = [];
      for (const tag of failed) {
        const probe = await confirmTag(tag, sha, opts, retry);
        if (probe.state === "present") {
          pushed.push(tag);
          anyCreated = true; // it did land — the push report was the thing that lied
        } else {
          missing.push(tag);
        }
      }
      // Steps we broke out before ever attempting are missing by construction.
      const accounted = new Set([...pushed, ...missing]);
      for (const step of plan) if (!accounted.has(step.tag)) missing.push(step.tag);
      result.pushed = pushed;
      if (missing.length) {
        // Keep the original per-tag error only when that tag is still missing;
        // otherwise it would name a tag we just confirmed as pushed.
        if (!failed.some((t) => missing.includes(t))) {
          result.error = `tag(s) not created: ${missing.join(", ")} — re-run ship_promote to complete them`;
        }
        return { ...result, success: false, missing };
      }
      // Everything reconciled as present after all — the failure was the false
      // negative itself. Drop the stale error and continue as a success.
      delete result.error;
    }
    result.pushed = pushed;

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
  } catch (e) {
    // Fail-closed: any unreachable-remote / unexpected throw refuses the
    // promotion with a structured result rather than a silent skip. (F2)
    return { ...result, success: false, error: e.message?.slice(0, 300) || "promotion failed" };
  }
}
