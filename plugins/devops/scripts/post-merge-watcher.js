#!/usr/bin/env node
/**
 * @script post-merge-watcher
 * @version 0.1.0
 * @plugin devops
 * @description Background watcher that runs after ship_release succeeds.
 *   Waits for the GitHub Actions run on the merge commit, optionally probes
 *   a production URL (verify extension), and writes a status file the next
 *   session can surface. Best-effort PowerShell toast on failure.
 *
 * Usage:
 *   node post-merge-watcher.js \
 *     --cwd <repo-path> \
 *     --base <branch> \
 *     --merge-sha <sha> \
 *     --pr <number> \
 *     [--max-wait <seconds>]        # default 1800 (30 min)
 *     [--verify-config <path>]      # optional reference.md with verify: block
 *     [--state-dir <path>]          # default <cwd>/.claude/.ship-watcher
 *     [--version <vX.Y.Z>]          # expands $VERSION placeholder in selectors
 *
 * State file: <state-dir>/<merge-sha>.json
 *   { status: "watching" | "complete",
 *     pr, base, mergeSha, startedAt, finishedAt,
 *     ci: { status, runId, runUrl, workflowName, conclusion },
 *     verify: { status, mode, target, attempts, lastError } | null,
 *     overall: "pending" | "success" | "failed" | "timeout",
 *     acknowledged: false }
 */

const { spawnSync, execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
const { join, dirname } = require("node:path");

const POLL_INITIAL_RUN_DETECT_MS = 5_000;
const POLL_INITIAL_RUN_DETECT_MAX_MS = 5 * 60_000;
const DEFAULT_MAX_WAIT_SEC = 1800;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}

function gh(args, cwd, { timeout = 30_000, allowFail = false } = {}) {
  try {
    return execFileSync("gh", args, {
      cwd,
      encoding: "utf8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

function writeState(stateFile, data) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(data, null, 2));
}

function findRunForSha({ cwd, base, mergeSha }) {
  const raw = gh(
    ["run", "list", "--branch", base, "--limit", "20", "--json", "databaseId,headSha,status,conclusion,workflowName,url,createdAt"],
    cwd,
    { allowFail: true },
  );
  if (!raw) return null;
  let runs;
  try { runs = JSON.parse(raw); } catch { return null; }
  return runs.find((r) => r.headSha && (r.headSha === mergeSha || r.headSha.startsWith(mergeSha))) || null;
}

function watchRun({ cwd, runId, maxWaitSec }) {
  try {
    execFileSync("gh", ["run", "watch", String(runId), "--exit-status", "--interval", "15"], {
      cwd,
      encoding: "utf8",
      timeout: maxWaitSec * 1000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (e) {
    const isTimeout = e.code === "ETIMEDOUT" || e.signal === "SIGTERM";
    return { ok: false, isTimeout, status: e.status };
  }
}

function getFinalRunStatus({ cwd, runId }) {
  const raw = gh(
    ["run", "view", String(runId), "--json", "status,conclusion,workflowName,url"],
    cwd,
    { allowFail: true },
  );
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Parse a verify: yaml block from a reference.md.
 * Looks for a fenced ```yaml block whose root key is `verify:`, falls back
 * to scanning the raw file body. Accepts only the documented keys; no nesting.
 */
function parseVerifyConfig(refPath) {
  if (!refPath || !existsSync(refPath)) return null;
  const text = readFileSync(refPath, "utf8");
  const fenceMatch = text.match(/```ya?ml\s*\n([\s\S]*?)\n```/i);
  const body = fenceMatch ? fenceMatch[1] : text;
  if (!/^\s*verify\s*:/m.test(body)) return null;

  const cfg = {};
  let inVerify = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^verify\s*:/.test(line)) { inVerify = true; continue; }
    if (!inVerify) continue;
    if (/^\S/.test(line) && line.trim() !== "") break;
    const m = line.match(/^\s+([a-zA-Z_]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    let [, key, val] = m;
    val = val.replace(/^["']|["']$/g, "");
    if (/^\d+$/.test(val)) val = Number(val);
    cfg[key] = val;
  }
  if (Object.keys(cfg).length === 0) return null;
  cfg.mode = cfg.mode || "http";
  cfg.poll_interval_seconds = cfg.poll_interval_seconds || 15;
  cfg.timeout_seconds = cfg.timeout_seconds || 600;
  return cfg;
}

async function probeHttp({ url, expectedStatus, selector, expected, version }) {
  const expandedSelector = selector ? String(selector) : null;
  const expandedExpected = expected ? String(expected).replace(/\$VERSION/g, version || "") : null;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (expectedStatus && res.status !== expectedStatus) {
      return { ok: false, error: `HTTP ${res.status}, expected ${expectedStatus}` };
    }
    if (expandedSelector && expandedExpected) {
      const responseBody = await res.text();
      const re = new RegExp(expandedSelector);
      const m = responseBody.match(re);
      if (!m) return { ok: false, error: `Selector /${expandedSelector}/ not matched in response body` };
      const captured = m[1] || m[0];
      if (!captured.includes(expandedExpected)) {
        return { ok: false, error: `Selector match "${captured.slice(0, 80)}" does not contain expected "${expandedExpected}"` };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 200) || "fetch failed" };
  }
}

async function runVerify({ config, version }) {
  if (!config) return null;
  const result = {
    status: "running",
    mode: config.mode,
    target: config.url || config.command,
    attempts: 0,
    lastError: null,
  };
  const startedAt = Date.now();
  const deadline = startedAt + config.timeout_seconds * 1000;
  const intervalMs = config.poll_interval_seconds * 1000;

  while (Date.now() < deadline) {
    result.attempts++;
    if (config.mode === "http") {
      const probe = await probeHttp({
        url: config.url,
        expectedStatus: config.expected_status,
        selector: config.selector,
        expected: config.expected,
        version,
      });
      if (probe.ok) {
        result.status = "success";
        return result;
      }
      result.lastError = probe.error;
    } else {
      const cmd = String(config.command || "");
      const res = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: 30_000 });
      if (res.status === 0) {
        result.status = "success";
        return result;
      }
      result.lastError = (res.stderr || res.stdout || `exit ${res.status}`).toString().slice(0, 200);
    }
    if (Date.now() + intervalMs >= deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  result.status = "failed";
  return result;
}

function notifyToast(title, message) {
  if (process.platform !== "win32") return;
  const safe = (s) => String(s).replace(/'/g, "''");
  const ps =
    `Add-Type -AssemblyName System.Windows.Forms; ` +
    `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
    `$n.Icon = [System.Drawing.SystemIcons]::Information; ` +
    `$n.Visible = $true; ` +
    `$n.ShowBalloonTip(8000, '${safe(title)}', '${safe(message)}', 'Info'); ` +
    `Start-Sleep -Seconds 9; ` +
    `$n.Dispose()`;
  try {
    spawnSync("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], {
      timeout: 15_000,
      stdio: "ignore",
      detached: true,
    });
  } catch { /* best-effort */ }
}

async function main() {
  const args = parseArgs(process.argv);
  const cwd = args.cwd;
  const base = args.base;
  const mergeSha = args["merge-sha"];

  if (!cwd || !base || !mergeSha) {
    console.error("Usage: post-merge-watcher.js --cwd <path> --base <branch> --merge-sha <sha> [--pr N] [--max-wait sec] [--verify-config path] [--version vX.Y.Z]");
    process.exit(2);
  }

  const pr = args.pr ? Number(args.pr) : null;
  const maxWaitSec = args["max-wait"] ? Number(args["max-wait"]) : DEFAULT_MAX_WAIT_SEC;
  const stateDir = args["state-dir"] || join(cwd, ".claude", ".ship-watcher");
  const verifyConfigPath = args["verify-config"] || null;
  const version = args.version || null;

  const stateFile = join(stateDir, `${mergeSha}.json`);
  const verifyConfig = parseVerifyConfig(verifyConfigPath);

  const state = {
    status: "watching",
    pr,
    base,
    mergeSha,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ci: null,
    verify: null,
    overall: "pending",
    acknowledged: false,
    hasVerifyConfig: !!verifyConfig,
  };
  writeState(stateFile, state);

  // Phase 1: locate the workflow run for our merge SHA
  let run = null;
  let waited = 0;
  let pollMs = POLL_INITIAL_RUN_DETECT_MS;
  while (waited < POLL_INITIAL_RUN_DETECT_MAX_MS) {
    run = findRunForSha({ cwd, base, mergeSha });
    if (run) break;
    await new Promise((r) => setTimeout(r, pollMs));
    waited += pollMs;
    pollMs = Math.min(pollMs * 1.5, 30_000);
  }

  if (!run) {
    state.ci = { status: "no-run", note: "No GitHub Actions workflow triggered by this merge — repo may not have CI configured for push events." };
    if (!verifyConfig) {
      state.overall = "success";
      state.status = "complete";
      state.finishedAt = new Date().toISOString();
      writeState(stateFile, state);
      return;
    }
  } else {
    state.ci = { status: "watching", runId: run.databaseId, runUrl: run.url, workflowName: run.workflowName };
    writeState(stateFile, state);

    const watch = watchRun({ cwd, runId: run.databaseId, maxWaitSec });
    const final = getFinalRunStatus({ cwd, runId: run.databaseId });
    state.ci = {
      status: watch.ok ? "success" : (watch.isTimeout ? "timeout" : "failed"),
      runId: run.databaseId,
      runUrl: run.url,
      workflowName: run.workflowName,
      conclusion: final?.conclusion || null,
    };
    if (!watch.ok) {
      state.overall = watch.isTimeout ? "timeout" : "failed";
      state.status = "complete";
      state.finishedAt = new Date().toISOString();
      writeState(stateFile, state);
      const title = watch.isTimeout ? "Ship Verify: CI Timeout" : "Ship Verify: CI Failed";
      const msg = `PR #${pr || "?"} on ${base}: ${state.ci.workflowName} (${state.ci.conclusion || state.ci.status}). ${run.url}`;
      notifyToast(title, msg);
      return;
    }
  }

  // Phase 2: verify (optional, per-project extension)
  if (verifyConfig) {
    state.verify = { status: "running", mode: verifyConfig.mode, target: verifyConfig.url || verifyConfig.command };
    writeState(stateFile, state);
    const verifyResult = await runVerify({ config: verifyConfig, version });
    state.verify = verifyResult;
    if (verifyResult.status !== "success") {
      state.overall = "failed";
      state.status = "complete";
      state.finishedAt = new Date().toISOString();
      writeState(stateFile, state);
      notifyToast(
        "Ship Verify: Deploy Probe Failed",
        `PR #${pr || "?"}: ${verifyResult.lastError || "verify failed"}. Target: ${verifyResult.target}`,
      );
      return;
    }
  }

  state.overall = "success";
  state.status = "complete";
  state.finishedAt = new Date().toISOString();
  writeState(stateFile, state);
}

main().catch((e) => {
  console.error("post-merge-watcher fatal:", e.message);
  process.exit(1);
});
