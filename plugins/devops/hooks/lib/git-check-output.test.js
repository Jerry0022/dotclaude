import { describe, test, expect } from "vitest";
import { compose } from "./git-check-output.js";

const CWD = "/repo";

function issue(type, count, label) {
  return { type, count, label };
}

function currentRepo(...issues) {
  return { label: "current repo", dir: CWD, issues };
}

function otherRepo(label, ...issues) {
  return { label, dir: `/other/${label}`, issues };
}

const onMain = { type: "on-main-no-worktree", branch: "main", severity: "high" };
const detached = { type: "detached-no-worktree", branch: "detached HEAD", severity: "high" };
const featureNoWorktree = { type: "no-worktree", branch: "feat/x", severity: "low" };

const text = (lines) => lines.join("\n");

// ---------------------------------------------------------------------------
// Silence invariant — the hook must stay quiet on a clean workspace
// ---------------------------------------------------------------------------

describe("silence", () => {
  test("returns [] when there is nothing to report", () => {
    expect(compose({ dirty: [], workspace: null, staleNote: null, cwd: CWD })).toEqual([]);
    expect(compose({ cwd: CWD })).toEqual([]);
    expect(compose()).toEqual([]);
  });

  test("returns [] when dirty entries carry only unrenderable issue types", () => {
    const out = compose({
      dirty: [currentRepo(issue("something-else", 1, "1 whatever"))],
      cwd: CWD,
    });
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #268 regression — findings must never be coupled to the ask
// ---------------------------------------------------------------------------

describe("#268 — findings survive a session that never asks", () => {
  test("current-repo unpushed/stash findings are rendered even though a workspace issue is present", () => {
    const out = text(compose({
      dirty: [currentRepo(
        issue("unpushed", 13, "13 unpushed commit(s)"),
        issue("stash", 7, "7 stash entries"),
      )],
      workspace: onMain,
      cwd: CWD,
    }));

    // The exact findings from the issue report must be present as their own lines,
    // not merely summarised inside the ask block.
    expect(out).toContain("- 13 unpushed commit(s) → run `/ship` to commit, push & create PR");
    expect(out).toContain("- 7 stash entries → review with `git stash list`");
    expect(out).toContain("**current repo**");
  });

  test("uncommitted findings are not suppressed by a workspace issue either", () => {
    const out = text(compose({
      dirty: [currentRepo(issue("uncommitted", 4, "4 uncommitted file(s)"))],
      workspace: onMain,
      cwd: CWD,
    }));
    expect(out).toContain("- 4 uncommitted file(s) → run `/ship` to commit, push & create PR");
  });

  test("the directive demands the findings be restated in the final message", () => {
    const out = compose({
      dirty: [currentRepo(issue("unpushed", 2, "2 unpushed commit(s)"))],
      workspace: onMain,
      cwd: CWD,
    });
    expect(out[0]).toContain("restate the findings below verbatim in your final message");
    // Names the landing zone: prose before the card is allowed, after it is not.
    expect(out[0]).toContain("before any completion card");
    expect(out[0]).toContain("scheduled, cron or headless run");
  });

  test("the report directive is present without a workspace issue too", () => {
    const out = compose({
      dirty: [currentRepo(issue("unpushed", 2, "2 unpushed commit(s)"))],
      workspace: null,
      cwd: CWD,
    });
    expect(out[0]).toContain("Stale changes found at session start");
    expect(out[0]).toContain("restate these findings verbatim in your final message");
    expect(out[0]).toContain("before any completion card");
  });

  test("no input combination drops a current-repo finding — full rendered line, in the repo block", () => {
    const cases = [
      [issue("uncommitted", 1, "1 uncommitted file(s)"), "- 1 uncommitted file(s) → run `/ship` to commit, push & create PR"],
      [issue("unpushed", 1, "1 unpushed commit(s)"), "- 1 unpushed commit(s) → run `/ship` to commit, push & create PR"],
      [issue("stash", 1, "1 stash entry"), "- 1 stash entry → review with `git stash list`, then `git stash pop` or `git stash drop`"],
    ];
    for (const workspace of [null, onMain, detached, featureNoWorktree]) {
      for (const [i, rendered] of cases) {
        const out = compose({ dirty: [currentRepo(i)], workspace, cwd: CWD });
        const label = `type=${i.type} workspace=${workspace ? workspace.type : "none"}`;
        // The line must exist as its OWN line — an aggregate summary elsewhere
        // (the old `- Pending: …` line) must not be able to satisfy this.
        expect(out, label).toContain(rendered);
        // …and it must sit inside the current-repo findings block, immediately
        // after its header, not folded into the ask block.
        const blockIdx = out.indexOf("**current repo**");
        expect(blockIdx, label).toBeGreaterThan(-1);
        expect(out[blockIdx + 1], label).toBe(rendered);
      }
    }
  });

  test("findings block precedes the ask block", () => {
    const out = compose({
      dirty: [currentRepo(issue("unpushed", 3, "3 unpushed commit(s)"))],
      workspace: onMain,
      cwd: CWD,
    });
    const findingsIdx = out.indexOf("**current repo**");
    const askIdx = out.findIndex(l => l.startsWith("Call AskUserQuestion"));
    expect(findingsIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeGreaterThan(findingsIdx);
  });
});

// ---------------------------------------------------------------------------
// Interactive behaviour is preserved
// ---------------------------------------------------------------------------

describe("ask block", () => {
  test("keeps the FIRST-action AskUserQuestion mandate verbatim", () => {
    const out = text(compose({ dirty: [], workspace: onMain, cwd: CWD }));
    expect(out).toContain("Call AskUserQuestion as the FIRST action of this turn.");
  });

  test("the ask mandate is stated in the very first line, ahead of the report obligation", () => {
    // Regression guard: demoting the mandate below the findings lets an
    // assistant that reads only the opening sentence treat "report it" as a
    // sufficient substitute for asking.
    const out = compose({
      dirty: [currentRepo(issue("unpushed", 1, "1 unpushed commit(s)"))],
      workspace: onMain,
      cwd: CWD,
    });
    expect(out[0]).toContain("call AskUserQuestion as the FIRST action of this turn");
    expect(out[0].indexOf("AskUserQuestion"))
      .toBeLessThan(out[0].indexOf("final message"));
  });

  test("every truthy workspace type gets an ask block", () => {
    for (const workspace of [onMain, detached, featureNoWorktree]) {
      const out = text(compose({ dirty: [], workspace, cwd: CWD }));
      expect(out, workspace.type).toContain("Call AskUserQuestion as the FIRST action of this turn.");
      expect(out, workspace.type).toContain("Resolution per option:");
    }
  });

  test("offers all four resolutions when the repo has pending changes", () => {
    const out = text(compose({
      dirty: [currentRepo(issue("uncommitted", 2, "2 uncommitted file(s)"))],
      workspace: onMain,
      cwd: CWD,
    }));
    expect(out).toContain("Worktree + Feature-Branch anlegen");
    expect(out).toContain("Erst aktuelle Changes shippen");
    expect(out).toContain("Changes mitnehmen in neuen Worktree");
    expect(out).toContain("Hier bleiben (bypass: DEVOPS_ALLOW_MAIN=1");
    expect(out).toContain("Ship-first: invoke /ship");
    expect(out).toContain("Take-along: `git stash`");
    expect(out).toContain("Stay: set env `DEVOPS_ALLOW_MAIN=1`");
  });

  test("offers only the worktree option when there are no pending changes", () => {
    const out = text(compose({ dirty: [], workspace: onMain, cwd: CWD }));
    expect(out).toContain("Worktree + Feature-Branch anlegen (recommended)");
    expect(out).not.toContain("Ship-first: invoke /ship");
    expect(out).not.toContain("Take-along: `git stash`");
  });

  test("a stash-only repo does not count as pending changes", () => {
    const out = text(compose({
      dirty: [currentRepo(issue("stash", 3, "3 stash entries"))],
      workspace: onMain,
      cwd: CWD,
    }));
    expect(out).toContain("- 3 stash entries → review with `git stash list`");
    expect(out).toContain("Worktree + Feature-Branch anlegen (recommended)");
    expect(out).not.toContain("Ship-first: invoke /ship");
  });

  test("non-main workspace types get the informative bypass wording and no DEVOPS_ALLOW_MAIN resolution", () => {
    const out = text(compose({ dirty: [], workspace: featureNoWorktree, cwd: CWD }));
    expect(out).toContain("Hier bleiben (Warning bleibt informativ");
    expect(out).not.toContain("Stay: set env");
  });

  test("no ask block at all when there is no workspace issue", () => {
    const out = text(compose({
      dirty: [currentRepo(issue("unpushed", 1, "1 unpushed commit(s)"))],
      workspace: null,
      cwd: CWD,
    }));
    expect(out).not.toContain("AskUserQuestion");
  });
});

// ---------------------------------------------------------------------------
// Workspace rendering
// ---------------------------------------------------------------------------

describe("workspace section", () => {
  test("on-main renders the guard warning", () => {
    const out = text(compose({ dirty: [], workspace: onMain, cwd: CWD }));
    expect(out).toContain("**Workspace setup**");
    expect(out).toContain("⚠ On `main` in repo root (not in a worktree)");
    expect(out).toContain("pre.main.guard / pre.edit.branch");
  });

  test("detached HEAD renders its own warning", () => {
    const out = text(compose({ dirty: [], workspace: detached, cwd: CWD }));
    expect(out).toContain("⚠ Detached HEAD in repo root");
  });

  test("feature branch without worktree renders the mild note", () => {
    const out = text(compose({ dirty: [], workspace: featureNoWorktree, cwd: CWD }));
    expect(out).toContain("- On `feat/x` in repo root (not in a worktree)");
    expect(out).not.toContain("⚠");
  });
});

// ---------------------------------------------------------------------------
// Multi-repo + stale note
// ---------------------------------------------------------------------------

describe("other repos and stale note", () => {
  test("other repos keep their own labelled block alongside the current repo", () => {
    const out = text(compose({
      dirty: [
        currentRepo(issue("unpushed", 2, "2 unpushed commit(s)")),
        otherRepo("sidecar", issue("uncommitted", 5, "5 uncommitted file(s)")),
      ],
      workspace: onMain,
      cwd: CWD,
    }));
    expect(out).toContain("**current repo**");
    expect(out).toContain("- 2 unpushed commit(s)");
    expect(out).toContain("**sidecar**");
    expect(out).toContain("- 5 uncommitted file(s)");
  });

  test("stale note alone is emitted without any header", () => {
    const out = compose({ dirty: [], workspace: null, staleNote: "📝 README stale", cwd: CWD });
    expect(out).toEqual(["📝 README stale"]);
  });

  test("stale note is appended after findings", () => {
    const out = compose({
      dirty: [currentRepo(issue("unpushed", 1, "1 unpushed commit(s)"))],
      workspace: null,
      staleNote: "📝 README stale",
      cwd: CWD,
    });
    expect(out[out.length - 1]).toBe("📝 README stale");
    expect(text(out)).toContain("- 1 unpushed commit(s)");
  });

  test("stale note comes last, after the ask block", () => {
    const out = compose({
      dirty: [currentRepo(issue("unpushed", 1, "1 unpushed commit(s)"))],
      workspace: onMain,
      staleNote: "📝 README stale",
      cwd: CWD,
    });
    expect(out[out.length - 1]).toBe("📝 README stale");
    const askIdx = out.findIndex(l => l.startsWith("Call AskUserQuestion"));
    expect(askIdx).toBeGreaterThan(-1);
    expect(askIdx).toBeLessThan(out.length - 1);
  });
});

// ---------------------------------------------------------------------------
// Silence contract with the caller
// ---------------------------------------------------------------------------

describe("silence contract vs ss.git.check.js", () => {
  // The hook exits early on `dirty.length === 0 && !workspace && !staleNote`,
  // then again on `out.length === 0`. Both gates must agree with compose():
  // never emit where the hook used to be silent, never go silent where the
  // hook would have proceeded with real content.
  const matrix = [];
  for (const dirty of [[], [currentRepo()], [currentRepo(issue("unpushed", 1, "1 unpushed commit(s)"))]]) {
    for (const workspace of [null, onMain]) {
      for (const staleNote of [null, "📝 note"]) {
        matrix.push({ dirty, workspace, staleNote, cwd: CWD });
      }
    }
  }

  test("compose() is empty whenever the hook's own early-exit condition holds", () => {
    for (const input of matrix) {
      const callerExitsEarly = input.dirty.length === 0 && !input.workspace && !input.staleNote;
      if (callerExitsEarly) {
        expect(compose(input), JSON.stringify(input)).toEqual([]);
      }
    }
  });

  test("compose() is never non-empty without a real reason", () => {
    for (const input of matrix) {
      const out = compose(input);
      if (out.length === 0) continue;
      const hasRenderable = input.dirty.some(r => (r.issues || []).some(i =>
        ["uncommitted", "unpushed", "stash"].includes(i.type)));
      expect(hasRenderable || !!input.workspace || !!input.staleNote, JSON.stringify(input)).toBe(true);
    }
  });

  test("a repo entry with no renderable issues stays silent", () => {
    expect(compose({ dirty: [currentRepo()], cwd: CWD })).toEqual([]);
    expect(compose({ dirty: [{ label: "x", dir: "/x" }], cwd: CWD })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Malformed input — the hook must never crash a session start
// ---------------------------------------------------------------------------

describe("robustness", () => {
  test("tolerates dirty entries that are not arrays / objects", () => {
    expect(() => compose({ dirty: null, cwd: CWD })).not.toThrow();
    expect(() => compose({ dirty: "nope", cwd: CWD })).not.toThrow();
    expect(() => compose({ dirty: [null, undefined], cwd: CWD })).not.toThrow();
    expect(compose({ dirty: [null, undefined], cwd: CWD })).toEqual([]);
  });

  test("tolerates a repo whose issues field is missing or malformed", () => {
    expect(compose({ dirty: [{ label: "x", dir: "/x", issues: null }], cwd: CWD })).toEqual([]);
    expect(compose({ dirty: [{ label: "x", dir: "/x", issues: "bad" }], cwd: CWD })).toEqual([]);
    expect(compose({ dirty: [{ label: "x", dir: "/x", issues: [null] }], cwd: CWD })).toEqual([]);
  });

  test("a malformed issue does not suppress its healthy siblings", () => {
    const out = text(compose({
      dirty: [{ label: "current repo", dir: CWD, issues: [null, issue("stash", 1, "1 stash entry")] }],
      cwd: CWD,
    }));
    expect(out).toContain("- 1 stash entry → review with `git stash list`");
  });

  test("an unknown workspace type still renders a branch line and an ask block", () => {
    const out = text(compose({ dirty: [], workspace: { type: "brand-new", branch: "x" }, cwd: CWD }));
    expect(out).toContain("- On `x` in repo root (not in a worktree)");
    expect(out).toContain("Call AskUserQuestion as the FIRST action of this turn.");
  });

  test("a workspace without a branch does not render `undefined`", () => {
    const out = text(compose({ dirty: [], workspace: { type: "no-worktree" }, cwd: CWD }));
    expect(out).not.toContain("undefined");
    expect(out).toContain("unknown branch");
  });
});
