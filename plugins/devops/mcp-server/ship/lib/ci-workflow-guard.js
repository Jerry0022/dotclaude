/**
 * @module ship/lib/ci-workflow-guard
 * @description Pause the workflows that can never start while a stored
 * `skip-checks` decision covers an exhausted Actions-minutes block (#949).
 *
 * `skip-checks` only skips ship_release's WAIT: GitHub still starts every
 * `pull_request` / `push` workflow, each fails at once ("spending limit") and
 * every failed run is a notification mail. This module disables exactly those
 * workflows of a PRIVATE repo, records them (ci-quota `disabledWorkflows`,
 * write-ahead) and enables exactly the recorded ones again — on the first ship
 * after the reset, on revoke / quotaCleared, from a sweep of any repo's ship or
 * preflight, and from the SessionStart hook, so nothing stays disabled forever.
 *
 * Never touched: workflows that were not `active` (hand-disabled), tag-only /
 * `workflow_dispatch`-only / scheduled-only ones, dynamic ones (Dependabot,
 * CodeQL: path outside `.github/workflows/`) and every public repo.
 *
 * Every gh call goes through the injectable `gh(args) => string` (default: the
 * real CLI), so tests never reach GitHub.
 */

import { execFileSync } from "node:child_process";
import {
  readRecord, readDisabled, recordDisabled, setDisabledState, dropDisabled, listDisabled,
} from "./ci-quota.js";

/** The real gh CLI; throws on a non-zero exit. */
export function realGh(args, { cwd } = {}) {
  return execFileSync("gh", args, {
    windowsHide: true, cwd, encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"],
  });
}

const RUNNING_TRIGGERS = ["pull_request", "pull_request_target", "push"];

/** Event names of a workflow's `on:` (light YAML reading: scalar, flow list, flow map, block map). */
export function triggersOf(yaml) {
  const lines = String(yaml || "").replace(/\r/g, "").split("\n");
  const at = lines.findIndex(l => /^["']?(on|true)["']?\s*:/.test(l));
  if (at < 0) return [];
  const strip = (v) => v.replace(/\s+#.*$/, "").trim();
  const names = (v) => v.replace(/^[[{]|[\]}]$/g, "").split(",")
    .map(x => x.split(":")[0].trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const inline = strip(lines[at].replace(/^[^:]*:/, ""));
  if (inline) return names(inline);
  const out = [];
  let indent = null;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const cur = /^\s*/.exec(l)[0].length;
    if (cur === 0) break;
    if (indent === null) indent = cur;
    if (cur !== indent) continue;
    const m = /^\s*(?:-\s*)?["']?([\w-]+)["']?\s*(?::|$)/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

/** True when the repo is private (unknown → false: never touch what we cannot classify). */
export function isPrivate(repo, { gh = realGh, cwd } = {}) {
  try { return gh(["api", `repos/${repo}`, "--jq", ".private"], { cwd }).trim() === "true"; } catch { return false; }
}

/** `[{id,name,path,state}]` of the repo's workflows. Throws when gh fails. */
export function listWorkflows(repo, { gh = realGh, cwd } = {}) {
  const out = gh(["api", "--paginate", `repos/${repo}/actions/workflows`, "--jq", ".workflows[] | {id,name,path,state}"], { cwd });
  return String(out).split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

function workflowSource(repo, path, { gh, cwd }) {
  return gh(["api", `repos/${repo}/contents/${path}`, "-H", "Accept: application/vnd.github.raw"], { cwd });
}

/** The active workflows that run on pull_request / push, i.e. the ones a skip-checks ship cannot afford. */
export function pickDoomed(repo, { gh = realGh, cwd } = {}) {
  const picked = [];
  for (const w of listWorkflows(repo, { gh, cwd })) {
    if (w.state !== "active") continue;
    if (!String(w.path || "").startsWith(".github/workflows/")) continue; // dynamic
    let src;
    try { src = workflowSource(repo, w.path, { gh, cwd }); } catch { continue; } // unreadable → leave alone
    if (triggersOf(src).some(t => RUNNING_TRIGGERS.includes(t))) picked.push({ id: w.id, name: w.name, path: w.path });
  }
  return picked;
}

/**
 * Disable the repo's doomed workflows until `until`. Private repos only.
 * Returns { repo, disabled (newly), total (recorded), errors[], skipped? }.
 */
export function pauseWorkflows(repo, { until, gh = realGh, cwd, file, now = Date.now() } = {}) {
  const res = { repo, disabled: 0, total: 0, errors: [] };
  const existing = readDisabled(repo, { file });
  if (existing?.state === "disabled" && Date.parse(existing.until) > now) {
    return { ...res, total: existing.ids.length, skipped: "already-disabled" };
  }
  if (!isPrivate(repo, { gh, cwd })) return { ...res, skipped: "not-private" };
  let doomed;
  try { doomed = pickDoomed(repo, { gh, cwd }); } catch (e) {
    return { ...res, errors: [`listing workflows failed: ${String(e.message || e).split("\n")[0]}`] };
  }
  if (!doomed.length) return { ...res, total: existing?.ids.length || 0, skipped: "nothing-to-disable" };
  recordDisabled(repo, { ids: doomed, until, state: "pending-disable", now, file }); // write-ahead
  for (const w of doomed) {
    try { gh(["workflow", "disable", String(w.id), "-R", repo], { cwd }); res.disabled++; } catch (e) {
      res.errors.push(`disable ${w.name || w.id}: ${String(e.message || e).split("\n")[0]}`);
    }
  }
  const rec = setDisabledState(repo, "disabled", { file });
  res.total = rec?.ids.length || doomed.length;
  return res;
}

/**
 * Enable every recorded workflow of the repo. The record is dropped only when a
 * re-read shows them all `active`; otherwise it stays "pending-enable".
 * Returns { repo, enabled, errors[] }.
 */
export function restoreWorkflows(repo, { gh = realGh, cwd, file } = {}) {
  const res = { repo, enabled: 0, errors: [] };
  const rec = readDisabled(repo, { file });
  if (!rec) return res;
  setDisabledState(repo, "pending-enable", { file });
  const failed = new Set();
  for (const w of rec.ids) {
    try { gh(["workflow", "enable", String(w.id), "-R", repo], { cwd }); } catch (e) {
      failed.add(w.id);
      res.errors.push(`enable ${w.name || w.id}: ${String(e.message || e).split("\n")[0]}`);
    }
  }
  let live = null;
  try { live = new Map(listWorkflows(repo, { gh, cwd }).map(w => [w.id, w.state])); } catch (e) {
    res.errors.push(`verifying re-enable failed: ${String(e.message || e).split("\n")[0]}`);
  }
  // A workflow deleted in the meantime no longer exists: nothing left to enable.
  const bad = rec.ids.filter(w => failed.has(w.id) || !live || (live.has(w.id) && live.get(w.id) !== "active"));
  res.enabled = rec.ids.length - bad.length;
  if (!bad.length) dropDisabled(repo, { file });
  return res;
}

/** Whether the record may stay disabled: not overdue and the account still has a live skip-checks decision. */
export function stillCovered(repo, rec, { now = Date.now(), file } = {}) {
  if (rec.state === "pending-enable") return false;
  if (!(Date.parse(rec.until) > now)) return false;
  const quota = readRecord(repo.split("/")[0], { now, file });
  return quota?.decision?.value === "skip-checks";
}

/**
 * Enable every record on the machine whose period ended, whose block cleared or
 * whose decision was revoked (any repo, not only the current one).
 * Returns { restored: [{repo, enabled}], failed: [{repo, errors}] }.
 */
export function sweepOverdue({ gh = realGh, cwd, file, now = Date.now(), except } = {}) {
  const out = { restored: [], failed: [] };
  for (const [repo, rec] of Object.entries(listDisabled({ file }))) {
    if (repo === except || stillCovered(repo, rec, { now, file })) continue;
    const r = restoreWorkflows(repo, { gh, cwd, file });
    if (r.errors.length) out.failed.push({ repo, enabled: r.enabled, errors: r.errors });
    else out.restored.push({ repo, enabled: r.enabled });
  }
  return out;
}

/** Records the sweep would act on (no gh calls) — for the cheap SessionStart check. */
export function overdueRepos({ file, now = Date.now() } = {}) {
  return Object.entries(listDisabled({ file })).filter(([repo, rec]) => !stillCovered(repo, rec, { now, file })).map(([repo]) => repo);
}

/** Card texts (release-results.md § Account-limited CI). */
export function pausedLine(repo, n, until) { return `${n} Workflows in ${repo} bis ${until} deaktiviert (Minutenlimit)`; }
export function resumedLine(repo, n) { return `${n} Workflows in ${repo} wieder aktiviert`; }
