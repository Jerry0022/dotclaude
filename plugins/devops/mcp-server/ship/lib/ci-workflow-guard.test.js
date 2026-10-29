import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordBlock, setDecision, readDisabled, recordDisabled, revokeDecision } from "./ci-quota.js";
import {
  triggersOf, pickDoomed, pauseWorkflows, restoreWorkflows, sweepOverdue, overdueRepos, pausedLine, resumedLine,
} from "./ci-workflow-guard.js";

const NOW = Date.parse("2026-10-29T10:00:00Z");
const UNTIL = "2026-11-01T00:00:00.000Z";
let dir, file;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-guard-")); file = join(dir, "q.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const W = (id, name, state, on) => ({ id, name, path: `.github/workflows/${name}.yml`, state, on });

/** Fake gh: repos = { "o/r": { private, workflows: [W…] } }; never reaches GitHub. */
function fakeGh(repos, { failEnable = new Set(), noVerify = false } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "api") {
      const target = args[1] === "--paginate" ? args[2] : args[1];
      const repo = repos[/repos\/([^/]+\/[^/]+)/.exec(target)?.[1]];
      if (!repo) throw new Error("404");
      if (args[2] === "--jq") return String(repo.private);
      if (args[1] === "--paginate") return repo.workflows.map(({ id, name, path, state }) => JSON.stringify({ id, name, path, state })).join("\n");
      return repo.workflows.find(w => w.path === target.split("/contents/")[1]).on;
    }
    const w = repos[args[args.indexOf("-R") + 1]].workflows.find(x => x.id === Number(args[2]));
    if (args[1] === "disable") w.state = "disabled_manually";
    if (args[1] === "enable") { if (failEnable.has(w.id)) throw new Error("HTTP 502"); if (!noVerify) w.state = "active"; }
    return "";
  };
  return { gh, calls };
}

const repoOf = (wfs, priv = true) => ({ private: priv, workflows: wfs });
const mutations = (calls) => calls.filter(c => /^workflow /.test(c));

describe("triggersOf", () => {
  test("scalar, list, flow map and block map", () => {
    expect(triggersOf("name: x\non: push\njobs: {}")).toEqual(["push"]);
    expect(triggersOf("on: [push, pull_request]\n")).toEqual(["push", "pull_request"]);
    expect(triggersOf("on: { workflow_dispatch: {}, push: {} }")).toEqual(["workflow_dispatch", "push"]);
    expect(triggersOf("on:\r\n  push:\r\n    tags: ['v*']\r\n  pull_request:\r\n    branches: [main]\r\njobs:\r\n  a:\r\n    on: nope")).toEqual(["push", "pull_request"]);
    expect(triggersOf("on:\n  - push\n  - workflow_dispatch\n")).toEqual(["push", "workflow_dispatch"]);
    expect(triggersOf("name: none")).toEqual([]);
  });
});

describe("pickDoomed", () => {
  test("only active pull_request/push workflows under .github/workflows", () => {
    const { gh } = fakeGh({ "o/r": repoOf([
      W(1, "test", "active", "on:\n  pull_request:\n  push:\n    branches: [main]"),
      W(2, "hand", "disabled_manually", "on: push"),
      W(3, "dispatch", "active", "on: workflow_dispatch"),
      W(4, "cron", "active", "on:\n  schedule:\n    - cron: '0 0 * * *'"),
      { id: 6, name: "Dependabot", path: "dynamic/dependabot/dependabot-updates", state: "active", on: "" },
    ]) });
    expect(pickDoomed("o/r", { gh }).map(w => w.id)).toEqual([1]);
  });
});

describe("pauseWorkflows", () => {
  const wfs = () => [W(1, "test", "active", "on: pull_request"), W(2, "hand", "disabled_manually", "on: push"), W(3, "manual", "active", "on: workflow_dispatch")];
  test("disables only the doomed ones, records them", () => {
    const { gh, calls } = fakeGh({ "o/r": repoOf(wfs()) });
    const r = pauseWorkflows("o/r", { until: UNTIL, gh, file, now: NOW });
    expect(r).toMatchObject({ disabled: 1, total: 1, errors: [] });
    expect(mutations(calls)).toEqual(["workflow disable 1 -R o/r"]);
    expect(readDisabled("o/r", { file })).toMatchObject({ state: "disabled", until: UNTIL, ids: [{ id: 1 }] });
    expect(pausedLine("o/r", 1, UNTIL)).toBe(`1 Workflows in o/r bis ${UNTIL} deaktiviert (Minutenlimit)`);
  });
  test("public repos are never touched", () => {
    const { gh, calls } = fakeGh({ "o/r": repoOf(wfs(), false) });
    expect(pauseWorkflows("o/r", { until: UNTIL, gh, file, now: NOW }).skipped).toBe("not-private");
    expect(mutations(calls)).toEqual([]);
    expect(readDisabled("o/r", { file })).toBeNull();
  });
  test("a second ship in the period does nothing", () => {
    const { gh, calls } = fakeGh({ "o/r": repoOf(wfs()) });
    pauseWorkflows("o/r", { until: UNTIL, gh, file, now: NOW });
    calls.length = 0;
    expect(pauseWorkflows("o/r", { until: UNTIL, gh, file, now: NOW }).skipped).toBe("already-disabled");
    expect(calls).toEqual([]);
  });
  test("write-ahead: the record exists before disable runs, and survives its failure", () => {
    const { gh } = fakeGh({ "o/r": repoOf(wfs()) });
    const crashing = (args) => {
      if (args[1] === "disable") { expect(readDisabled("o/r", { file }).state).toBe("pending-disable"); throw new Error("killed"); }
      return gh(args);
    };
    const r = pauseWorkflows("o/r", { until: UNTIL, gh: crashing, file, now: NOW });
    expect(r.disabled).toBe(0);
    expect(r.errors[0]).toMatch(/disable test/);
    expect(readDisabled("o/r", { file }).ids.map(i => i.id)).toEqual([1]);
  });
  test("listing failure leaves no record", () => {
    const gh = (args) => { if (args[1] === "--paginate") throw new Error("HTTP 500"); return "true"; };
    expect(pauseWorkflows("o/r", { until: UNTIL, gh, file, now: NOW }).errors[0]).toMatch(/listing/);
    expect(readDisabled("o/r", { file })).toBeNull();
  });
});

describe("restoreWorkflows / sweepOverdue", () => {
  const base = () => ({ "o/r": repoOf([W(1, "test", "active", "on: push"), W(2, "hand", "disabled_manually", "on: push")]) });
  function paused(repos) {
    const g = fakeGh(repos);
    pauseWorkflows("o/r", { until: UNTIL, gh: g.gh, file, now: NOW });
    g.calls.length = 0;
    return g;
  }

  test("enables exactly the recorded ids (hand-disabled stays) and drops the record", () => {
    const repos = base();
    const { gh, calls } = paused(repos);
    expect(restoreWorkflows("o/r", { gh, file })).toMatchObject({ enabled: 1, errors: [] });
    expect(mutations(calls)).toEqual(["workflow enable 1 -R o/r"]);
    expect(repos["o/r"].workflows.map(w => w.state)).toEqual(["active", "disabled_manually"]);
    expect(readDisabled("o/r", { file })).toBeNull();
    expect(resumedLine("o/r", 1)).toBe("1 Workflows in o/r wieder aktiviert");
  });
  test("failed enable keeps pending-enable and is retried", () => {
    const repos = base();
    paused(repos);
    const bad = fakeGh(repos, { failEnable: new Set([1]) });
    expect(restoreWorkflows("o/r", { gh: bad.gh, file }).errors[0]).toMatch(/502/);
    expect(readDisabled("o/r", { file }).state).toBe("pending-enable");
    expect(overdueRepos({ file, now: NOW })).toEqual(["o/r"]);
    expect(restoreWorkflows("o/r", { gh: fakeGh(repos).gh, file }).errors).toEqual([]);
    expect(readDisabled("o/r", { file })).toBeNull();
  });
  test("a re-read that does not show active keeps the record", () => {
    const repos = base();
    paused(repos);
    const { gh } = fakeGh(repos, { noVerify: true });
    expect(restoreWorkflows("o/r", { gh, file }).enabled).toBe(0);
    expect(readDisabled("o/r", { file }).state).toBe("pending-enable");
  });
  test("sweep: covered records stay, revoked records of other repos are enabled", () => {
    const repos = { ...base(), "o/other": repoOf([W(7, "t", "active", "on: push")]) };
    const g = fakeGh(repos);
    recordBlock("o", { now: NOW, file, resetAt: UNTIL });
    setDecision("o", "skip-checks", { now: NOW, file });
    pauseWorkflows("o/r", { until: UNTIL, gh: g.gh, file, now: NOW });
    pauseWorkflows("o/other", { until: UNTIL, gh: g.gh, file, now: NOW });
    g.calls.length = 0;
    expect(sweepOverdue({ gh: g.gh, file, now: NOW + 1000 })).toEqual({ restored: [], failed: [] });
    expect(mutations(g.calls)).toEqual([]);
    revokeDecision("o", { file });
    const swept = sweepOverdue({ gh: g.gh, file, now: NOW + 2000 });
    expect(swept.restored.map(x => x.repo).sort()).toEqual(["o/other", "o/r"]);
    expect(readDisabled("o/other", { file })).toBeNull();
  });
  test("sweep after the reset enables a repo nobody ships again", () => {
    const g = fakeGh(base());
    recordBlock("o", { now: NOW, file, resetAt: UNTIL });
    setDecision("o", "skip-checks", { now: NOW, file });
    pauseWorkflows("o/r", { until: UNTIL, gh: g.gh, file, now: NOW });
    const later = Date.parse(UNTIL) + 1000;
    expect(overdueRepos({ file, now: later })).toEqual(["o/r"]);
    expect(sweepOverdue({ gh: g.gh, file, now: later }).restored).toEqual([{ repo: "o/r", enabled: 1 }]);
  });
  test("a crash-time pending-disable record is restored too (idempotent enable)", () => {
    recordDisabled("o/r", { ids: [{ id: 1, name: "test", path: "p" }], until: UNTIL, now: NOW, file });
    const { gh } = fakeGh(base());
    expect(sweepOverdue({ gh, file, now: NOW }).restored).toHaveLength(1);
  });
});
