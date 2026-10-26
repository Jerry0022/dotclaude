/**
 * ship_run — the whole ship pipeline in code, in one call (M7).
 *
 * Drives the existing tool handlers in a fixed order, in-process:
 *   preflight (earlyPush) → conflict-free rebase loop → early CI-quota probe →
 *   build (→ early-push re-probe, full-suite switch) → [Codex gate return] →
 *   CHANGELOG entry + version bump → release (rebase/full-suite retries) →
 *   cleanup → deferred hygiene.
 *
 * Every sub-call goes through the same path ship/cli.js uses: zod parse,
 * handler, recordTiming (M0 telemetry), recordShipStep (checkpoint). ship_run's
 * own stage data lives in the checkpoint under `run`, so a re-call skips what
 * landed: a recorded bump, PR, merge or tag is never repeated.
 *
 * It returns early ONLY at real decision points:
 *   { ok:false, stage, needs, detail, resume, partial }
 * otherwise one final result the completion card is built from.
 * Env DEVOPS_SHIP_RUN=0 disables it (the model runs the step-by-step pipeline,
 * skills/do-ship/deep-knowledge/manual-pipeline.md).
 */

import { z } from "zod";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitTry, NETWORK_TIMEOUT } from "../lib/git.js";
import { rebaseVersionFiles } from "../lib/version-rebase.js";
import { readVersion, bumpVersion } from "../lib/version.js";
import { recordTiming, summarizeShip, shipDurationTest } from "../lib/ship-timings.js";
import { probeCiQuota } from "../lib/ci-quota-probe.js";

const validationItems = z.preprocess(
  (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } },
  z.array(z.object({
    requirement: z.string(),
    status: z.enum(["met", "partial", "unmet"]).optional(),
    evidence: z.string().optional(),
    waitsOn: z.enum(["user", "deploy", "external", "pending"]).optional(),
  })).optional(),
);

export const NEEDS = [
  "preflight-failed", "conflict", "rebase-required", "validation-gaps", "build-red", "codex-judgment",
  "bump-required", "major-bump", "bump-mismatch", "full-suite-required", "checks-failed", "release-failed", "tool-error",
];

export const schema = z.object({
  cwd: z.string().describe("Working directory of the target repo (required — must be passed by the caller)"),
  title: z.string().describe("PR title (conventional commit, ≤70 chars)"),
  body: z.string().describe("PR body (Closes #N first when applicable)"),
  bump: z.enum(["patch", "minor", "major", "none"]).optional().describe("Bump decided by the model (final ship to main). Omitted on a final ship → returns needs \"bump-required\". Ignored for intermediate ships."),
  majorConfirmed: z.boolean().default(false).describe("The USER confirmed a major bump. Without it bump \"major\" returns needs \"major-bump\"."),
  changelogEntry: z.string().nullable().default(null).describe("The CHANGELOG entry body the model wrote (markdown sections, no heading needed). ship_run inserts it at the top under a heading in the repo's existing format (e.g. `## [X.Y.Z] — YYYY-MM-DD`) before ship_version_bump. Skipped when that version's heading already exists."),
  commitMessage: z.string().nullable().default(null).describe("Commit message for the bump/CHANGELOG commit (default `chore(release): v<version>`)."),
  tag: z.string().nullable().optional().describe("Passed to ship_release (omit = v<version>)."),
  mergeStrategy: z.enum(["squash", "merge", "rebase"]).optional().describe("Omit: squash, or merge when the final preflight reports file-overlap."),
  validation: validationItems.describe("The card's requirement items — passed to preflight (early gap gate) and release (final gate)."),
  acceptGaps: z.boolean().default(false).describe("Only when the USER said to ship as-is."),
  interactive: z.boolean().default(false).describe("true in an interactive (non-lockout) ship."),
  quotaDecision: z.enum(["skip-checks", "wait", "revoke"]).optional().describe("The USER's answer to a CI-quota question (needs \"checks-failed\" with ciQuotaDecisionNeeded)."),
  skipChecks: z.boolean().default(false).describe("Hot-fix bypass of the CI gate (the full-suite invariant still holds)."),
  checksTimeoutSec: z.number().int().min(30).max(3600).optional(),
  outOfBandGlobs: z.array(z.string()).nullable().default(null),
  base: z.string().optional().describe("Base override; omit to auto-detect."),
  earlyPush: z.boolean().default(true).describe("Preflight pushes + opens a draft PR so CI runs during the build."),
  build: z.object({
    buildCmd: z.string().nullable().optional(),
    lintCmd: z.string().nullable().optional(),
    testCmd: z.string().nullable().optional(),
    stepTimeoutSec: z.number().int().min(30).max(1800).optional(),
    ciSuite: z.boolean().nullable().optional(),
  }).default({}).describe("ship_build params (project extension commands)."),
  codexGate: z.boolean().default(false).describe("Codex is installed: return after a green build with stage \"build-done\", needs \"codex-judgment\". Re-call with `codex` set once the review is handled."),
  codex: z.object({ rc: z.number().int().optional(), outcome: z.string().optional(), note: z.string().optional() }).nullable().default(null)
    .describe("The handled Codex review (rc + outcome, e.g. clean | fixed | rc75 | timeout). Present → the Codex gate counts as passed."),
  keep: z.boolean().optional().describe("Keep-mode cleanup (sentinel only). Default: true inside a worktree (harness worktree, #442), else false."),
  queued: z.boolean().default(false).describe("--queued ship: no hygiene."),
  lang: z.enum(["de", "en"]).default("de"),
});

const MAX_REBASE_ROUNDS = 3;

/** Conflict-free rebase onto origin/<base>; version-file-only conflicts via rebaseVersionFiles. Never leaves a rebase open. */
export function rebaseOnto(base, cwd) {
  const opts = { cwd };
  gitTry(["fetch", "origin", base], { cwd, timeout: NETWORK_TIMEOUT });
  const upstream = `origin/${base}`;
  let versionRebase = null;
  const ok = gitTry(["-c", "merge.conflictstyle=diff3", "-c", "core.editor=true", "rebase", upstream], { cwd, timeout: 120_000 }) !== null;
  if (!ok) {
    const files = (gitTry(["diff", "--name-only", "--diff-filter=U"], opts) || "").split("\n").filter(Boolean);
    gitTry(["rebase", "--abort"], opts);
    const vr = rebaseVersionFiles({ upstream, cwd });
    if (!vr.ok) return { ok: false, reason: vr.reason, files: vr.files || files };
    versionRebase = { from: vr.from, to: vr.to, resolved: vr.resolved };
  }
  const hasUpstream = gitTry(["rev-parse", "--abbrev-ref", "@{u}"], opts) !== null;
  const pushed = hasUpstream ? gitTry(["push", "--force-with-lease"], { cwd, timeout: NETWORK_TIMEOUT }) !== null : false;
  return { ok: true, pushed, ...(versionRebase ? { versionRebase } : {}) };
}

/** Today as YYYY-MM-DD (local). */
function today(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Insert a CHANGELOG entry for `version` at the top, in the format of the
 * newest existing version heading. Pure on strings.
 * @returns {string|null} the new text, or null when the version already has a heading
 */
export function insertChangelogEntry(text, version, entry, now = Date.now()) {
  const src = text || "";
  const esc = version.replace(/\./g, "\\.");
  if (new RegExp(`^##\\s.*\\bv?${esc}\\b`, "m").test(src)) return null;
  const body = String(entry || "").replace(/^\s*##\s[^\n]*\n+/, "").trim();
  const lines = src.split("\n");
  const idx = lines.findIndex((l) => /^##\s.*\d+\.\d+\.\d+/.test(l));
  let heading = `## [${version}] — ${today(now)}`;
  if (idx !== -1) {
    heading = lines[idx]
      .replace(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, version)
      .replace(/\d{4}-\d{2}-\d{2}/, today(now));
  }
  const block = `${heading}\n\n${body}\n`;
  if (idx === -1) {
    const pre = src.trim() ? src.replace(/\s*$/, "\n\n") : "# Changelog\n\n";
    return `${pre}${block}`;
  }
  return [...lines.slice(0, idx), block, ...lines.slice(idx)].join("\n");
}

function defaultTools() {
  // Imported lazily so a test can inject mocks without loading the real handlers.
  return Promise.all([
    import("./preflight.js"), import("./build.js"), import("./version-bump.js"),
    import("./release.js"), import("./cleanup.js"), import("./hygiene.js"),
  ]).then(([pf, b, vb, r, c, h]) => ({
    ship_preflight: [pf.schema, pf.handler],
    ship_build: [b.schema, b.handler],
    ship_version_bump: [vb.schema, vb.handler],
    ship_release: [r.schema, r.handler],
    ship_cleanup: [c.schema, c.handler],
    ship_hygiene: [h.schema, h.handler],
  }));
}

function defaultDeps() {
  const require = createRequire(import.meta.url);
  const cp = require("../../../hooks/lib/ship-checkpoint.js");
  return {
    tools: null,
    rebase: rebaseOnto,
    probe: probeCiQuota,
    treeHash: async (cwd) => {
      try { return (await import("../lib/test-results.js")).treeKey(cwd)?.treeHash || null; } catch { return null; }
    },
    checkpoint: { open: (cwd) => cp.openCheckpoint(cwd), write: cp.writeCheckpoint, record: cp.recordShipStep },
    recordTiming,
    summarize: summarizeShip,
    now: () => Date.now(),
  };
}

function overlapStrategy(pre) {
  const c = (pre.checks || []).find((x) => x && x.name === "file-overlap");
  return c && c.ok === false ? "merge" : "squash";
}

function buildTests(build, lang) {
  if (!build) return [];
  const de = lang !== "en";
  const out = (build.steps || []).filter((s) => s && s.step).map((s) => ({
    method: `ship_build: ${s.step}`,
    result: s.skipped ? (de ? "übersprungen" : "skipped") : s.reused ? (de ? "grün (wiederverwendet)" : "green (reused)") : s.success ? (de ? "grün" : "green") : (de ? "rot" : "red"),
  }));
  if (build.testScope) {
    out.push({
      method: de ? "Test-Scope" : "Test scope",
      result: build.testScope === "related"
        ? `related${build.relatedFiles ? ` (${build.relatedFiles.length})` : ""} · ${de ? "volle Suite via CI" : "full suite via CI"}`
        : `full · ${build.fullSuiteVia === "local" ? "lokal" : build.fullSuiteVia || ""}`.trim(),
    });
  }
  return out;
}

export async function handler(params, injected = {}) {
  if (process.env.DEVOPS_SHIP_RUN === "0") {
    return { ok: false, disabled: true, reason: "DEVOPS_SHIP_RUN=0", fallback: "skills/do-ship/deep-knowledge/manual-pipeline.md" };
  }
  const deps = { ...defaultDeps(), ...injected };
  const tools = deps.tools || await defaultTools();
  const { cwd, lang } = params;
  const out = { ok: true, stage: "start", stagesRun: [], stagesSkipped: [], warnings: [] };
  let stage = "preflight";

  const call = async (name, p) => {
    const [toolSchema, fn] = tools[name];
    const parsed = toolSchema.safeParse({ ...p, cwd });
    if (!parsed.success) throw new Error(`${name} params invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const startedAt = deps.now();
    try {
      const result = await fn(parsed.data);
      deps.recordTiming({ cwd, tool: name, startedAt, durationMs: deps.now() - startedAt, result });
      deps.checkpoint.record(name, parsed.data, result);
      out.stagesRun.push(name);
      return result;
    } catch (e) {
      deps.recordTiming({ cwd, tool: name, startedAt, durationMs: deps.now() - startedAt, outcome: "error" });
      throw e;
    }
  };
  const run = { ...((deps.checkpoint.open(cwd) || {}).run || {}) };
  const saveRun = (patch) => {
    Object.assign(run, patch);
    const cp = deps.checkpoint.open(cwd);
    if (cp) deps.checkpoint.write(cwd, { ...cp, run });
  };
  const needs = (need, detail, resume = {}) => ({
    ok: false, stage, needs: need, detail, resume, partial: out,
  });

  try {
    let cp = deps.checkpoint.open(cwd) || {};
    const steps = cp.steps || {};
    const merged = !!(steps.release && steps.release.merged);
    const bumped = !!steps.bump;
    let pre = run.preflight || null;

    // ── preflight + conflict-free rebase loop ────────────────────────────────
    if (!merged && !bumped) {
      for (let round = 0; ; round++) {
        const r = await call("ship_preflight", {
          earlyPush: params.earlyPush, validation: params.validation, outOfBandGlobs: params.outOfBandGlobs,
          ...(params.base ? { base: params.base } : {}),
        });
        out.preflight = r;
        if (!r.ready) return needs("preflight-failed", { errors: r.errors || [], warnings: r.warnings || [] });
        if (r.needsRebase) {
          if (round >= MAX_REBASE_ROUNDS) return needs("rebase-required", { reason: "base kept moving during the rebase loop" });
          const rb = deps.rebase(r.base, cwd);
          if (!rb.ok) {
            return needs("conflict", { base: r.base, files: rb.files || [], reason: rb.reason },
              { hint: "resolve per preflight-rebase.md § Rebase conflict resolution (or ask), push --force-with-lease, then call ship_run again" });
          }
          out.rebased = { rounds: round + 1, ...rb };
          continue;
        }
        if (r.validationGaps && r.validationGaps.length && !params.acceptGaps) {
          return needs("validation-gaps", { gaps: r.validationGaps }, { hint: "close the gaps, call ship_run again with the updated validation" });
        }
        pre = {
          base: r.base, branch: r.branch, mode: r.mode, intermediate: !!r.intermediate, inWorktree: !!r.inWorktree,
          mergeStrategy: overlapStrategy(r), earlyPushed: !!(r.earlyPush && r.earlyPush.pushed),
          outOfBandDeploys: r.outOfBandDeploys || null, components: r.components || null,
          workflowHygiene: r.workflowHygiene || null,
        };
        saveRun({ preflight: pre });
        break;
      }
    } else {
      out.stagesSkipped.push("ship_preflight");
    }
    if (!pre) pre = { base: cp.base || params.base || "main", branch: cp.branch, mode: "git", intermediate: false, inWorktree: false, mergeStrategy: "squash" };

    // ── early CI-quota probe (before ship_build picks the test scope) ───────
    if (!merged && !bumped && pre.mode === "git") out.ciQuota = deps.probe(cwd, {});

    // ── build ────────────────────────────────────────────────────────────────
    stage = "build";
    const buildParams = Object.fromEntries(Object.entries(params.build || {}).filter(([, v]) => v !== undefined));
    if (!merged && !bumped) {
      const tree = await deps.treeHash(cwd);
      const landed = steps.build && run.build && tree && run.buildTree === tree;
      if (landed) {
        out.stagesSkipped.push("ship_build");
      } else {
        let b = await call("ship_build", buildParams);
        if (!b.success) return needs("build-red", { steps: (b.steps || []).filter((s) => s && !s.success), timeoutHit: b.timeoutHit || null });
        // Early-push draft PR: its first check runs may already show the minutes are out.
        if (b.fullSuiteVia === "ci" && pre.earlyPushed) {
          const p2 = deps.probe(cwd, { force: true, branch: pre.branch });
          out.ciQuotaRecheck = p2;
          if (p2.status === "exhausted") {
            b = await call("ship_build", buildParams); // the recorded block makes it the full local suite
            out.switchedToFullSuite = true;
            if (!b.success) return needs("build-red", { steps: (b.steps || []).filter((s) => s && !s.success), timeoutHit: b.timeoutHit || null });
          }
        }
        saveRun({
          buildTree: await deps.treeHash(cwd),
          build: { steps: b.steps || [], testScope: b.testScope || null, fullSuiteVia: b.fullSuiteVia || null, testScopeReason: b.testScopeReason || null, relatedFiles: b.relatedFiles || null, buildId: b.buildId || null },
        });
      }
      if (params.codexGate && !params.codex) {
        stage = "build-done";
        return needs("codex-judgment", { build: run.build }, { codex: { rc: "<exit code>", outcome: "clean|fixed|rc75|timeout|skipped" } });
      }
    } else {
      out.stagesSkipped.push("ship_build");
    }

    // ── CHANGELOG + version bump ─────────────────────────────────────────────
    stage = "bump";
    cp = deps.checkpoint.open(cwd) || cp;
    let bumpResult = (cp.steps && cp.steps.bump) || null;
    const finalShip = !pre.intermediate;
    if (!merged && finalShip && !bumpResult && params.bump !== "none") {
      if (!params.bump) return needs("bump-required", { hint: "decide patch/minor/major/none (versioning.md § When to bump) and pass bump + changelogEntry" });
      if (params.bump === "major" && !params.majorConfirmed) return needs("major-bump", { hint: "ask the user (BLOCK under lockout); re-call with majorConfirmed:true" });
      const current = (() => { try { return readVersion(cwd).version; } catch { return null; } })();
      if (current && params.changelogEntry) {
        const vNext = bumpVersion(current, params.bump);
        const root = gitTry(["rev-parse", "--show-toplevel"], { cwd }) || cwd;
        const file = join(root, "CHANGELOG.md");
        const next = insertChangelogEntry(existsSync(file) ? readFileSync(file, "utf8") : "", vNext, params.changelogEntry, deps.now());
        if (next !== null) { writeFileSync(file, next); out.changelog = { version: vNext, inserted: true }; }
        else out.changelog = { version: vNext, inserted: false, reason: "heading exists" };
      }
      const v = await call("ship_version_bump", { bump: params.bump });
      out.bump = v;
      bumpResult = v;
      if (!v.success && !v.skipped) {
        // Never bump twice: the checkpoint now carries the raised version.
        return needs("bump-mismatch", { vNew: v.vNew, mismatches: v.mismatches || [] }, { hint: "bring the listed files to vNew by hand, then call ship_run again (the bump is not repeated)" });
      }
    } else {
      out.stagesSkipped.push("ship_version_bump");
    }
    const bump = params.bump || (bumpResult && bumpResult.bump) || undefined;
    const version = (bumpResult && bumpResult.vNew) || (() => { try { return readVersion(cwd).version; } catch { return null; } })();

    // ── release ──────────────────────────────────────────────────────────────
    stage = "release";
    let rel = null;
    if (merged) {
      out.stagesSkipped.push("ship_release");
      rel = { ...steps.release, success: true, resumed: true };
    } else {
      let rebuilt = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        rel = await call("ship_release", {
          base: pre.base, title: params.title, body: params.body,
          commitMessage: params.commitMessage || (version ? `chore(release): v${version}` : null),
          ...(params.tag !== undefined ? { tag: params.tag } : {}),
          ...(bump ? { bump } : {}),
          releaseNotes: params.changelogEntry || null,
          mergeStrategy: params.mergeStrategy || pre.mergeStrategy || "squash",
          skipChecks: params.skipChecks, interactive: params.interactive,
          ...(params.quotaDecision ? { quotaDecision: params.quotaDecision } : {}),
          ...(params.checksTimeoutSec ? { checksTimeoutSec: params.checksTimeoutSec } : {}),
          ...(params.validation ? { validation: params.validation } : {}),
          acceptGaps: params.acceptGaps,
          ...(run.build && run.build.fullSuiteVia ? { fullSuiteVia: run.build.fullSuiteVia } : {}),
        });
        if (rel.merged) break; // landed — never retried, whatever came after
        if (rel.reason === "git-probe-timeout" && attempt === 0) continue;
        if (rel.reason === "validation-gaps") return needs("validation-gaps", { gaps: rel.gaps || rel.validationGaps || rel.error });
        if (rel.reason === "full-suite-required") {
          if (rebuilt) return needs("full-suite-required", { error: rel.error, prLeftOpen: rel.prLeftOpen || null });
          const b = await call("ship_build", { ...buildParams, ciSuite: false, testCmd: null }); // full local suite on this tree
          if (!b.success) return needs("build-red", { steps: (b.steps || []).filter((s) => s && !s.success), fullSuite: true });
          saveRun({ build: { ...(run.build || {}), steps: b.steps || [], testScope: b.testScope || "full", fullSuiteVia: "local" } });
          rebuilt = true;
          continue;
        }
        if (rel.rebaseRequired) {
          if (!rel.autoRebased) {
            const rb = deps.rebase(pre.base, cwd);
            if (!rb.ok) return needs("conflict", { base: pre.base, files: rb.files || [], reason: rb.reason, prLeftOpen: rel.prLeftOpen || null });
            out.rebased = { ...(out.rebased || {}), afterRelease: rb };
          }
          const b = await call("ship_build", buildParams); // retest the rebased tree
          if (!b.success) return needs("build-red", { steps: (b.steps || []).filter((s) => s && !s.success), afterRebase: true });
          saveRun({ build: { ...(run.build || {}), steps: b.steps || [], testScope: b.testScope || null, fullSuiteVia: b.fullSuiteVia || null } });
          out.purposeRecheck = !!rel.baseAdvancedDuringChecks; // the model re-runs the Step 1d full check
          continue;
        }
        if (rel.checksBlocked || rel.ciQuotaDecisionNeeded) {
          return needs("checks-failed", {
            status: rel.checks && rel.checks.status, failedChecks: rel.failedChecks || [], ciQuotaDecisionNeeded: rel.ciQuotaDecisionNeeded || null,
            error: rel.error, prLeftOpen: rel.prLeftOpen || null,
          }, rel.ciQuotaDecisionNeeded ? { quotaDecision: "<the user's answer>" } : {});
        }
        if (rel.success === false) return needs("release-failed", { reason: rel.reason || null, error: rel.error || null, prLeftOpen: rel.prLeftOpen || null });
        break; // file-only / no-remote / intermediate shapes
      }
      if (rel && !rel.merged && rel.rebaseRequired) return needs("rebase-required", { error: rel.error });
    }
    out.release = rel;

    // ── cleanup ──────────────────────────────────────────────────────────────
    stage = "cleanup";
    const keep = params.keep !== undefined ? params.keep : pre.inWorktree;
    if (!keep && pre.inWorktree) {
      out.cleanup = { done: false, reason: "exit-worktree-first" };
    } else if (pre.branch) {
      const c = await call("ship_cleanup", { branch: pre.branch, base: pre.base, keep: !!keep });
      out.cleanup = c;
      out.porcelain = c.porcelain || [];
    }
    out.kept = !!keep;

    // ── hygiene (deferred worker) ───────────────────────────────────────────
    stage = "hygiene";
    const landed = !!(rel && rel.merged);
    if (landed && !params.queued) {
      try {
        const h = await call("ship_hygiene", { trigger: "ship", lang });
        out.hygiene = h && h.card ? h.card : null;
      } catch (e) { out.warnings.push(`ship_hygiene: ${e.message}`); }
    }

    // ── final result ─────────────────────────────────────────────────────────
    stage = "done";
    const summary = deps.summarize({ cwd, branch: pre.branch });
    const tests = buildTests(run.build, lang);
    if (rel && rel.checks && rel.checks.status) {
      tests.push({ method: "CI-Checks", result: `${rel.checks.status}${rel.checks.passed ? ` · ${rel.checks.passed} ✓` : ""}${rel.checks.waitedMs ? ` · ${Math.round(rel.checks.waitedMs / 1000)} s` : ""}` });
    }
    if (out.hygiene && out.hygiene.tests) tests.push(out.hygiene.tests);
    const dur = shipDurationTest(summary, lang);
    if (dur) tests.push(dur);
    return {
      ...out, stage,
      version, bump: bump || null, mode: pre.mode, intermediate: pre.intermediate, base: pre.base, branch: pre.branch,
      pr: rel ? (rel.pr || rel.prNumber || null) : null, prUrl: rel ? rel.prUrl || null : null,
      merged: rel ? rel.merged || null : null, mergeSha: rel ? rel.mergeSha || null : null, pushed: rel ? rel.pushed ?? null : null,
      tag: rel ? rel.tag || null : null, tagVerified: rel ? rel.tagVerified ?? null : null,
      channels: rel ? rel.channels || null : null, betaLag: rel ? rel.betaLag ?? null : null, stableLag: rel ? rel.stableLag ?? null : null,
      landingLock: rel ? rel.landingLock || null : null, prLeftOpen: rel ? rel.prLeftOpen || null : null,
      testScope: run.build ? run.build.testScope : null, fullSuiteVia: run.build ? run.build.fullSuiteVia : null,
      outOfBandDeploys: pre.outOfBandDeploys || null, components: pre.components || null, workflowHygiene: pre.workflowHygiene || null,
      codex: params.codex || null, tests, timings: summary,
    };
  } catch (e) {
    return needs("tool-error", { message: e && e.message });
  }
}
