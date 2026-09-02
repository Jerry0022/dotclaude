import { describe, test, expect } from "vitest";
import {
  resolveDeadlineMs,
  isAbandoned,
  findRun,
  reconcile,
  renderReport,
  renderInflight,
} from "./ss.ship.verify.js";

/**
 * The bug: a watcher process that dies before writing a terminal state leaves
 * `status: "watching"` / `finishedAt: null` on disk forever. The hook's only
 * defence was a flat 24h `STALE_MS` that (a) kept announcing "still running"
 * for a process dead for hours — observed as "PR #318 … (1205m elapsed)" at
 * every SessionStart — and (b) on expiry set `acknowledged: true` while
 * LEAVING `status: "watching"`, so the entry was never reported at all and the
 * branch was re-entered every session, re-stamping `staleAt` with a fresh
 * timestamp (all stuck entries carried the same current-day value).
 *
 * The invariant these tests pin: an abandoned entry is resolved into a
 * TERMINAL state exactly once, so it can be reported once and never re-enter
 * the watching branch.
 */

const MIN = 60_000;
const T0 = Date.parse("2026-09-01T20:22:54.314Z");
const iso = (ms) => new Date(ms).toISOString();

/** Entry as post-merge-watcher writes it on its very first state write. */
const watching = (over = {}) => ({
  status: "watching",
  pr: 318,
  base: "main",
  mergeSha: "84a34a2",
  startedAt: iso(T0),
  finishedAt: null,
  ci: null,
  verify: null,
  overall: "pending",
  acknowledged: false,
  hasVerifyConfig: false,
  ...over,
});

const run = (over = {}) => ({
  databaseId: 33555118598,
  headSha: "84a34a2dd8e4ce97da832edbf8a92d6a5e377897",
  status: "completed",
  conclusion: "success",
  workflowName: "Release",
  url: "https://github.com/o/r/actions/runs/33555118598",
  createdAt: iso(T0 + 2 * MIN),
  ...over,
});

describe("resolveDeadlineMs — the watcher's own lifetime, not a flat 24h", () => {
  test("no verify config: 5m detect + 30m max-wait + 5m grace", () => {
    expect(resolveDeadlineMs(watching())).toBe(T0 + 40 * MIN);
  });

  test("verify config adds its 10m default probe window", () => {
    expect(resolveDeadlineMs(watching({ hasVerifyConfig: true }))).toBe(T0 + 50 * MIN);
  });

  test("an explicit maxWaitSec from the watcher replaces the default", () => {
    expect(resolveDeadlineMs(watching({ maxWaitSec: 600 }))).toBe(T0 + 20 * MIN);
  });

  test("an explicit deadlineAt written by the watcher wins outright", () => {
    const d = iso(T0 + 3 * MIN);
    expect(resolveDeadlineMs(watching({ deadlineAt: d, maxWaitSec: 600 }))).toBe(T0 + 3 * MIN);
  });

  test("unusable startedAt → null (caller must treat as abandoned, not eternal)", () => {
    expect(resolveDeadlineMs(watching({ startedAt: null }))).toBeNull();
    expect(resolveDeadlineMs(watching({ startedAt: "not a date" }))).toBeNull();
  });
});

describe("isAbandoned", () => {
  test("a genuinely in-flight watcher is left alone", () => {
    expect(isAbandoned(watching(), T0 + 5 * MIN)).toBe(false);
  });

  test("still not abandoned one minute before its own deadline", () => {
    expect(isAbandoned(watching(), T0 + 39 * MIN)).toBe(false);
  });

  test("abandoned once past its own deadline", () => {
    expect(isAbandoned(watching(), T0 + 41 * MIN)).toBe(true);
  });

  test("REGRESSION: 20.5h old is abandoned — the old 24h rule called it 'still running'", () => {
    expect(isAbandoned(watching(), T0 + 1230 * MIN)).toBe(true);
  });

  test("a malformed entry resolves instead of nagging forever", () => {
    expect(isAbandoned(watching({ startedAt: null }), T0)).toBe(true);
  });

  test("terminal entries are never re-judged", () => {
    expect(isAbandoned({ status: "complete", startedAt: iso(T0) }, T0 + 99 * MIN)).toBe(false);
  });
});

describe("findRun — SHA prefix match inside the watcher's window", () => {
  const deadline = T0 + 40 * MIN;

  test("matches the recorded short SHA against the run's full headSha", () => {
    expect(findRun([run()], { mergeSha: "84a34a2", deadlineMs: deadline })).toBeTruthy();
  });

  test("ignores a run for a different commit", () => {
    expect(findRun([run({ headSha: "deadbee" + "0".repeat(33) })], { mergeSha: "84a34a2", deadlineMs: deadline })).toBeNull();
  });

  test("a promotion-tag run created days later is NOT the ship's CI", () => {
    // The Release workflow triggers on the bare vX.Y.Z tag that /promote adds
    // to the SAME commit later. Attributing it to the ship would invent a CI
    // result the watcher never saw.
    const later = run({ createdAt: iso(T0 + 3 * 24 * 60 * MIN) });
    expect(findRun([later], { mergeSha: "84a34a2", deadlineMs: deadline })).toBeNull();
  });

  test("a run without createdAt is kept — absence of proof is not proof", () => {
    expect(findRun([run({ createdAt: undefined })], { mergeSha: "84a34a2", deadlineMs: deadline })).toBeTruthy();
  });

  test("null/empty run lists yield no match", () => {
    expect(findRun(null, { mergeSha: "84a34a2", deadlineMs: deadline })).toBeNull();
    expect(findRun([], { mergeSha: "84a34a2", deadlineMs: deadline })).toBeNull();
  });
});

describe("reconcile — every path ends terminal", () => {
  const NOW = T0 + 1230 * MIN;
  const terminal = (r) => {
    expect(r.status).toBe("complete");
    expect(r.finishedAt).not.toBeNull();
    expect(r.abandonedAt).not.toBeNull();
    expect(isAbandoned(r, NOW + 10 * 24 * 60 * MIN)).toBe(false);
  };

  test("authoritative empty list → no-run, success (the healthy outcome here)", () => {
    const r = reconcile(watching(), { runs: [], authoritative: true }, NOW);
    terminal(r);
    expect(r.ci.status).toBe("no-run");
    expect(r.overall).toBe("success");
    expect(r.resolution).toBe("no-run");
  });

  test("in-window run that passed → CI success", () => {
    const r = reconcile(watching(), { runs: [run()], authoritative: true }, NOW);
    terminal(r);
    expect(r.ci.status).toBe("success");
    expect(r.ci.runUrl).toContain("/actions/runs/");
    expect(r.overall).toBe("success");
  });

  test("in-window run that failed → CI failed, conclusion kept for triage", () => {
    const r = reconcile(watching(), { runs: [run({ conclusion: "failure" })], authoritative: true }, NOW);
    terminal(r);
    expect(r.ci.status).toBe("failed");
    expect(r.ci.conclusion).toBe("failure");
    expect(r.overall).toBe("failed");
  });

  test("in-window run still unfinished → inconclusive, not a fabricated verdict", () => {
    const r = reconcile(watching(), { runs: [run({ status: "in_progress", conclusion: null })], authoritative: true }, NOW);
    terminal(r);
    expect(r.overall).toBe("inconclusive");
    expect(r.resolution).toBe("ci-unfinished");
  });

  test("gh could not answer → inconclusive, never a silent 'success'", () => {
    const r = reconcile(watching(), { runs: null, authoritative: false }, NOW);
    terminal(r);
    expect(r.overall).toBe("inconclusive");
    expect(r.resolution).toBe("unreconciled");
  });

  test("non-authoritative empty list → inconclusive, NOT no-run", () => {
    // The branch-scoped fallback query misses tag-triggered runs entirely, so
    // an empty result there does not prove no run existed.
    const r = reconcile(watching(), { runs: [], authoritative: false }, NOW);
    terminal(r);
    expect(r.overall).toBe("inconclusive");
    expect(r.resolution).toBe("unreconciled");
  });

  test("verify was configured but never ran → success is downgraded", () => {
    const r = reconcile(watching({ hasVerifyConfig: true }), { runs: [], authoritative: true }, NOW);
    terminal(r);
    expect(r.ci.status).toBe("no-run");
    expect(r.overall).toBe("inconclusive");
    expect(r.resolution).toBe("verify-never-ran");
  });

  test("a verify result the watcher already recorded is preserved", () => {
    const r = reconcile(
      watching({ hasVerifyConfig: true, verify: { status: "success", mode: "http", target: "https://x" } }),
      { runs: [], authoritative: true },
      NOW,
    );
    expect(r.overall).toBe("success");
    expect(r.verify.status).toBe("success");
  });

  test("reconcile does not mutate the entry it was handed", () => {
    const input = watching();
    reconcile(input, { runs: [], authoritative: true }, NOW);
    expect(input.status).toBe("watching");
  });
});

describe("renderReport — an abandoned entry reads as abandoned", () => {
  const NOW = T0 + 1230 * MIN;

  test("reconciled no-run says the watcher died and what was found", () => {
    const lines = renderReport(reconcile(watching(), { runs: [], authoritative: true }, NOW)).join("\n");
    expect(lines).toContain("PR #318");
    expect(lines).toMatch(/watcher/i);
    expect(lines).toContain("no workflow triggered");
    expect(lines).not.toMatch(/still running/i);
  });

  test("unreconciled entries carry a manual-check hint, not a verdict", () => {
    const lines = renderReport(reconcile(watching(), { runs: null, authoritative: false }, NOW)).join("\n");
    expect(lines).toContain("⚠");
    expect(lines).toContain("gh pr checks 318");
  });

  test("an ordinary completed entry is unchanged by the abandonment work", () => {
    const lines = renderReport({
      status: "complete", pr: 269, base: "main", overall: "success",
      ci: { status: "no-run" }, verify: null, hasVerifyConfig: false,
    }).join("\n");
    expect(lines).toContain("✓ **Ship verify — PR #269 on `main`**");
    expect(lines).not.toMatch(/watcher/i);
  });
});

describe("renderInflight", () => {
  test("reports elapsed minutes for a watcher still inside its window", () => {
    const lines = renderInflight(watching(), T0 + 5 * MIN).join("\n");
    expect(lines).toContain("still running");
    expect(lines).toContain("(5m elapsed)");
  });
});
