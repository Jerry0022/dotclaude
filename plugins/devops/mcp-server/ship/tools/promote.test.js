import { describe, test, expect, vi, beforeEach } from "vitest";

// Same zod-stub pattern as release.test.js — the handler never invokes the
// schema, only the MCP registration does.
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  return { z: { object: () => node, string: () => node, boolean: () => node, enum: () => node, number: () => node } };
});

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => ""),
}));

vi.mock("../lib/git.js", () => ({
  git: vi.fn(() => ""),
  gitStrict: vi.fn(() => ""),
  NETWORK_TIMEOUT: 60_000,
}));

vi.mock("../lib/github.js", () => ({
  createRelease: vi.fn(() => undefined),
  releaseExists: vi.fn(() => true),
}));

import { handler, parseLsRemoteTagOutput, parseLsRemoteChannelTags } from "./promote.js";
import { execFileSync } from "node:child_process";
import * as gitLib from "../lib/git.js";
import * as ghLib from "../lib/github.js";

const SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

function params(overrides = {}) {
  return {
    version: "0.113.0",
    from: "alpha",
    to: "beta",
    releaseNotes: null,
    cwd: "/repo",
    // Keep tests fast — production defaults are 6 × 10s.
    releasePollAttempts: 1,
    releasePollDelayMs: 0,
    // Same for the tag push/verify backoff (production: 3 pushes × 4 verifies,
    // 1s×3^n). Individual retry tests override these to exercise the loop.
    tagPushAttempts: 1,
    tagVerifyAttempts: 1,
    tagRetryDelayMs: 0,
    ...overrides,
  };
}

// Deterministic fake tag-OBJECT sha per tag name — annotated tag objects have
// a sha of their own that NEVER equals the commit they point at. Every
// promotion comparison must therefore use the peeled (^{}) commit sha; a mock
// that only ever emits one line per tag (as this file's mock did before
// 0.116.2) structurally cannot catch that class of bug.
function objSha(tag) {
  let h = 7;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(5);
}

// Build a STATEFUL remote mock mirroring REAL git behavior (each divergence
// here was a hole that let the 0.116.2 bug ship):
// - annotated tags own TWO refs: `refs/tags/<t>` (tag object sha) and
//   `refs/tags/<t>^{}` (peeled commit sha); lightweight tags only the plain
//   ref, whose sha IS the commit;
// - ls-remote <pattern> tail-matches per path component — `v0.113.0` also
//   matches `alpha/v0.113.0`, and the `^{}` ref is matched ONLY by a pattern
//   that itself ends in `^{}` (a plain-pattern query has NO peeled line);
// - a locally created tag (`git tag -a`) becomes remotely visible only after
//   `push origin <tag>` succeeds — so post-push verification verifies the
//   PUSH, not the creation;
// - the ^{} sha peels RECURSIVELY: a nested tag (created on another tag's
//   OBJECT sha — the 0.116.2 bug class) peels through to the ultimate commit.
//
// Three further options model the #251 failure modes, all of which are about
// the remote LYING once rather than about the push failing:
// - pushFails(t)        → `git push` throws for tag t (client-side error);
// - pushLandsAnyway(t)  → …but the ref updated on the remote regardless
//                          (the ETIMEDOUT-after-success case);
// - lsRemoteLag(t)      → the first N ls-remote calls omit t even though it IS
//                          on the remote (replica lag / eventual consistency);
// - preLocal            → local tags left behind by an earlier failed run.
function mockRemote(tags, { annotated = true, pushFails = null, pushLandsAnyway = null, lsRemoteLag = null, preLocal = {} } = {}) {
  // remote: tag -> { obj|null, commit }; local: tag -> target sha given to `git tag -a`
  const remote = new Map(
    Object.entries(tags).map(([t, c]) => [t, annotated ? { obj: objSha(t), commit: c } : { obj: null, commit: c }]),
  );
  const localTags = new Map(Object.entries(preLocal));
  const lagLeft = new Map();
  const peelTo = (sha) => {
    for (const [, e] of remote) if (e.obj === sha) return e.commit; // recursive by construction (commit is already fully peeled)
    return sha;
  };
  execFileSync.mockImplementation((cmd, args) => {
    if (cmd === "git" && Array.isArray(args) && args[0] === "tag") {
      localTags.set(args[2], args[3]);
    }
    return "";
  });
  const land = (t) => {
    if (localTags.has(t)) remote.set(t, { obj: objSha(t), commit: peelTo(localTags.get(t)) });
  };
  gitLib.gitStrict.mockImplementation((cmd) => {
    // Explicit refspec (`refs/tags/<t>:refs/tags/<t>`) so a same-named branch
    // can never be pushed instead of the tag.
    const m = /^push origin refs\/tags\/(\S+):refs\/tags\/\1$/.exec(cmd);
    if (m) {
      if (pushFails && pushFails(m[1])) {
        // The ref may still have updated before the client gave up — that is
        // precisely why the push's exit code is not authoritative (#251).
        if (pushLandsAnyway && pushLandsAnyway(m[1])) land(m[1]);
        throw new Error("network");
      }
      land(m[1]);
    }
    return "";
  });
  const refLines = () => {
    const lines = [];
    for (const [t, e] of [...remote.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (e.obj) {
        lines.push([e.obj, `refs/tags/${t}`], [e.commit, `refs/tags/${t}^{}`]);
      } else {
        lines.push([e.commit, `refs/tags/${t}`]);
      }
    }
    return lines;
  };
  gitLib.git.mockImplementation((cmd) => {
    // Local-tag lookup used by the idempotent ensureLocalTag path. Fully
    // qualified (`refs/tags/…`) so a same-named branch cannot answer for a tag;
    // an absent ref makes real `git()` return NULL, not an empty string.
    const rp = /^rev-parse -q --verify "refs\/tags\/(.+)\^\{commit\}"$/.exec(cmd);
    if (rp) return localTags.has(rp[1]) ? peelTo(localTags.get(rp[1])) : null;
    if (!cmd.startsWith("ls-remote --tags origin")) return "";
    // Replica lag: hide a tag that IS on the remote for its first N reads.
    const hidden = new Set();
    if (lsRemoteLag) {
      for (const t of remote.keys()) {
        if (!lagLeft.has(t)) lagLeft.set(t, lsRemoteLag(t) || 0);
        if (lagLeft.get(t) > 0) {
          hidden.add(t);
          lagLeft.set(t, lagLeft.get(t) - 1);
        }
      }
    }
    const visible = refLines().filter(([, ref]) => {
      const t = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
      return !hidden.has(t);
    });
    const rest = cmd.slice("ls-remote --tags origin".length).trim();
    const pats = rest ? rest.split(/\s+/).map((p) => p.replace(/^"|"$/g, "")) : [];
    const selected = pats.length
      ? visible.filter(([, ref]) => pats.some((p) => ref === `refs/tags/${p}` || ref.endsWith(`/${p}`)))
      : visible;
    return selected.map(([sha, ref]) => `${sha}\t${ref}`).join("\n");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ghLib.releaseExists.mockReturnValue(true);
});

// The push command for a tag, in the explicit-refspec form the tool emits.
const pushCmd = (t) => `push origin refs/tags/${t}:refs/tags/${t}`;

function tagCreateCalls() {
  return execFileSync.mock.calls.filter((c) => c[0] === "git" && c[1][0] === "tag");
}

describe("ship_promote — guards", () => {
  test("missing source tag → source-tag-not-found", async () => {
    mockRemote({});
    const r = await handler(params());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/source-tag-not-found/);
  });

  test("downgrade (version < target latest) refused", async () => {
    mockRemote({ "alpha/v0.113.0": SHA, "beta/v0.114.0": "f".repeat(40) });
    const r = await handler(params());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/monotonicity/);
    expect(tagCreateCalls()).toHaveLength(0);
  });

  test("equal version + same SHA → idempotent success (alreadyPromoted)", async () => {
    mockRemote({ "alpha/v0.113.0": SHA, "beta/v0.113.0": SHA });
    const r = await handler(params());
    expect(r.success).toBe(true);
    expect(r.alreadyPromoted).toBe(true);
    expect(tagCreateCalls()).toHaveLength(0);
  });

  test("empty target channel allowed (first promotion)", async () => {
    mockRemote({ "alpha/v0.113.0": SHA });
    const r = await handler(params());
    expect(r.success).toBe(true);
    expect(r.tag).toBe("beta/v0.113.0");
  });

  test("ancestry guard failure refuses", async () => {
    mockRemote({ "alpha/v0.113.0": SHA });
    gitLib.gitStrict.mockImplementation((cmd) => {
      if (cmd.startsWith("merge-base --is-ancestor")) throw new Error("not an ancestor");
      return "";
    });
    const r = await handler(params());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/ancestor/);
  });
});

// F2 — the remote-truth tag reads must FAIL-CLOSED. git() returns null on a
// transient network/auth failure; parsing null as an EMPTY tag list previously
// skipped the monotonicity + immutability guards (fail-open), letting a
// downgrade re-tag slip through. A null read must now refuse the promotion.
describe("ship_promote — fail-closed on unreachable remote (F2)", () => {
  test("remote fully unreachable (source-tag read null) → refuse, no tags created", async () => {
    // Every ls-remote returns null (git() swallows the failure). The source-tag
    // resolution must not misread that as "tag absent" and certainly must not
    // proceed to tag.
    gitLib.git.mockReturnValue(null);
    const r = await handler(params());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cannot reach remote|refusing to promote/i);
    expect(tagCreateCalls()).toHaveLength(0);
  });

  test("monotonicity read fails mid-promotion (source resolves, channel-list null) → refuse", async () => {
    // The exact fail-open vector: the single-tag source lookup succeeds, but the
    // full `ls-remote --tags origin` (monotonicity guard input) fails. A null
    // there used to parse as [] → targetLatest null → guards skipped. Must abort.
    gitLib.git.mockImplementation((cmd) => {
      if (/^ls-remote --tags origin$/.test(cmd)) return null; // transient network failure
      if (cmd.startsWith("ls-remote --tags origin ")) return `${SHA}\trefs/tags/alpha/v0.113.0`;
      return "";
    });
    const r = await handler(params());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cannot reach remote|refusing to promote/i);
    // Critically: NO tag was created despite the source tag resolving.
    expect(tagCreateCalls()).toHaveLength(0);
  });

  test("empty-string ls-remote (tag genuinely absent) is NOT treated as unreachable", async () => {
    // Distinguishes "" (tag absent → source-tag-not-found) from null (unreachable
    // → cannot reach remote). Guards the fail-closed logic against over-firing.
    gitLib.git.mockReturnValue("");
    const r = await handler(params());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/source-tag-not-found/);
    expect(r.error).not.toMatch(/cannot reach remote/i);
  });
});

// Every remote read goes through git-credential-manager on Windows, and under
// CPU load (parallel sessions, test runs) that roundtrip reproducibly takes
// ~30s — the 15s DEFAULT_TIMEOUT then turns a perfectly healthy remote into a
// deterministic ETIMEDOUT → "cannot reach remote — refusing to promote"
// (10 consecutive promote failures on 2026-08-12). Pin the 60s network timeout
// on every remote-touching call so the short default can never creep back in.
describe("ship_promote — network timeouts", () => {
  test("every ls-remote read and the ancestry fetch carry NETWORK_TIMEOUT", async () => {
    mockRemote({ "alpha/v0.113.0": SHA });
    const r = await handler(params());
    expect(r.success).toBe(true);

    const lsCalls = gitLib.git.mock.calls.filter(([cmd]) => cmd.startsWith("ls-remote"));
    expect(lsCalls.length).toBeGreaterThan(0);
    for (const [cmd, opts] of lsCalls) {
      expect(opts?.timeout, `timeout missing on: git ${cmd}`).toBe(gitLib.NETWORK_TIMEOUT);
    }

    const fetchCalls = gitLib.gitStrict.mock.calls.filter(([cmd]) => cmd.startsWith("fetch "));
    expect(fetchCalls.length).toBeGreaterThan(0);
    for (const [cmd, opts] of fetchCalls) {
      expect(opts?.timeout, `timeout missing on: git ${cmd}`).toBe(gitLib.NETWORK_TIMEOUT);
    }
  });
});

describe("ship_promote — tagging", () => {
  test("alpha→beta creates ONE annotated tag on the source SHA, pushes, no release", async () => {
    mockRemote({ "alpha/v0.113.0": SHA });
    const r = await handler(params());
    expect(r.success).toBe(true);
    expect(r.sha).toBe(SHA);
    const creates = tagCreateCalls();
    expect(creates).toHaveLength(1);
    expect(creates[0][1]).toEqual(["tag", "-a", "beta/v0.113.0", SHA, "-m", expect.stringContaining('"to":"beta"')]);
    expect(ghLib.createRelease).not.toHaveBeenCalled();
    expect(ghLib.releaseExists).not.toHaveBeenCalled();
  });

  test("beta→stable creates stable/vN THEN bare vN + verifies release", async () => {
    mockRemote({ "beta/v0.113.0": SHA });
    const r = await handler(params({ from: "beta", to: "stable" }));
    expect(r.success).toBe(true);
    expect(r.tag).toBe("stable/v0.113.0");
    expect(r.bareTag).toBe("v0.113.0");
    const creates = tagCreateCalls().map((c) => c[1][2]);
    expect(creates).toEqual(["stable/v0.113.0", "v0.113.0"]);
    expect(r.release).toBe(true);
  });

  test("stable: bare push failure → success:false with missing list", async () => {
    mockRemote({ "beta/v0.113.0": SHA }, { pushFails: (t) => t === "v0.113.0" });
    const r = await handler(params({ from: "beta", to: "stable" }));
    expect(r.success).toBe(false);
    expect(r.pushed).toContain("stable/v0.113.0");
    expect(r.missing).toContain("v0.113.0");
  });

  test("re-run after partial failure completes only the missing bare tag", async () => {
    mockRemote({ "beta/v0.113.0": SHA, "stable/v0.113.0": SHA });
    const r = await handler(params({ from: "beta", to: "stable" }));
    expect(r.success).toBe(true);
    const creates = tagCreateCalls().map((c) => c[1][2]);
    expect(creates).toEqual(["v0.113.0"]); // stable/ exists remotely → only bare created
  });

  test("stable: release absent after poll → createRelease fallback", async () => {
    mockRemote({ "beta/v0.113.0": SHA });
    ghLib.releaseExists.mockReturnValue(false);
    const r = await handler(params({ from: "beta", to: "stable", releaseNotes: "## notes" }));
    expect(ghLib.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "v0.113.0", notes: "## notes" }),
      expect.anything(),
    );
    expect(r.release).toBe(true);
  });
});

// Regression for the 0.116.2 promotion failure: every comparison must use the
// peeled COMMIT sha, never the annotated tag-OBJECT sha (those differ by
// construction even on the same commit), and specific-tag ls-remote queries
// suffix-match sibling channel tags.
describe("ship_promote — annotated-tag sha resolution (0.116.2 regression)", () => {
  const COMMIT = "702377c0f12467d86a097e3b9581f7a95a8f3252";
  const TAGOBJ = "dcde9b6e215660de40b7f60d74a8c6ac5f0ef328";

  test("parseLsRemoteTagOutput: peeled ^{} line wins over the tag-object line", () => {
    const out = `${TAGOBJ}\trefs/tags/alpha/v0.116.2\n${COMMIT}\trefs/tags/alpha/v0.116.2^{}`;
    expect(parseLsRemoteTagOutput(out, "alpha/v0.116.2")).toBe(COMMIT);
  });

  test("parseLsRemoteTagOutput: lightweight tag (single line) falls back to the plain sha", () => {
    const out = `${COMMIT}\trefs/tags/v0.99.0`;
    expect(parseLsRemoteTagOutput(out, "v0.99.0")).toBe(COMMIT);
  });

  test("parseLsRemoteTagOutput: absent tag → null, even with suffix-matched siblings in the output", () => {
    // Querying bare `v0.116.2` suffix-matches alpha/v0.116.2 — exact ref only.
    const out = `${TAGOBJ}\trefs/tags/alpha/v0.116.2\n${COMMIT}\trefs/tags/alpha/v0.116.2^{}`;
    expect(parseLsRemoteTagOutput(out, "v0.116.2")).toBeNull();
  });

  test("parseLsRemoteTagOutput: bare tag resolved exactly, not from the first suffix-matching line", () => {
    const bareCommit = "b".repeat(40);
    const out = [
      `${TAGOBJ}\trefs/tags/alpha/v0.116.2`,
      `${COMMIT}\trefs/tags/alpha/v0.116.2^{}`,
      `${"c".repeat(40)}\trefs/tags/v0.116.2`,
      `${bareCommit}\trefs/tags/v0.116.2^{}`,
    ].join("\n");
    expect(parseLsRemoteTagOutput(out, "v0.116.2")).toBe(bareCommit);
  });

  test("parseLsRemoteChannelTags: one entry per tag, carrying the peeled commit sha", () => {
    const out = [
      `${TAGOBJ}\trefs/tags/alpha/v0.116.2`,
      `${COMMIT}\trefs/tags/alpha/v0.116.2^{}`,
      `${"9".repeat(40)}\trefs/tags/stable/v0.116.0`,
      `${"8".repeat(40)}\trefs/tags/stable/v0.116.0^{}`,
      `${"7".repeat(40)}\trefs/tags/not-a-channel-tag`,
    ].join("\n");
    const tags = parseLsRemoteChannelTags(out);
    expect(tags).toHaveLength(2);
    expect(tags.find((t) => t.tag === "alpha/v0.116.2")).toMatchObject({ sha: COMMIT, channel: "alpha", version: "0.116.2" });
    expect(tags.find((t) => t.tag === "stable/v0.116.0")).toMatchObject({ sha: "8".repeat(40), channel: "stable", version: "0.116.0" });
  });

  test("lightweight-tag remote (no ^{} refs anywhere) still promotes via the plain-sha fallback", async () => {
    mockRemote({ "alpha/v0.113.0": SHA }, { annotated: false });
    const r = await handler(params());
    expect(r.success).toBe(true);
    expect(r.sha).toBe(SHA);
    expect(tagCreateCalls()[0][1][3]).toBe(SHA);
  });

  test("re-run after a verification race: annotated target on the SAME commit is idempotent, not 'immutable'", async () => {
    // Exactly the 0.116.2 incident: beta→stable re-run where stable/v0.116.2
    // already landed (different tag OBJECT, same commit) and bare is missing.
    mockRemote({ "beta/v0.116.2": COMMIT, "stable/v0.116.2": COMMIT });
    const r = await handler(params({ version: "0.116.2", from: "beta", to: "stable" }));
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    const creates = tagCreateCalls().map((c) => c[1][2]);
    expect(creates).toEqual(["v0.116.2"]); // only the missing bare tag is completed
  });
});

// ---------------------------------------------------------------------------
// #251 — push/verify flakiness: the remote lies once, the tool must not
// ---------------------------------------------------------------------------

describe("ship_promote — #251 push/verify flakiness", () => {
  const retryParams = (o = {}) =>
    params({ tagPushAttempts: 3, tagVerifyAttempts: 4, tagRetryDelayMs: 0, ...o });

  test("a verification that lags once still reports the tag as pushed", async () => {
    // The reported failure: `stable/v0.39.2` had landed, but the single
    // post-push ls-remote came back stale → hard failure + wrong missing list.
    //
    // tagPushAttempts is pinned to 1 ON PURPOSE: with a push retry available,
    // the second push would re-land the tag and mask a missing VERIFY retry.
    // Only the verify loop can rescue this case, so only it is under test.
    mockRemote({ "beta/v0.113.0": SHA }, { lsRemoteLag: (t) => (t === "stable/v0.113.0" ? 1 : 0) });
    const r = await handler(retryParams({ from: "beta", to: "stable", tagPushAttempts: 1, tagVerifyAttempts: 3 }));
    expect(r.success).toBe(true);
    expect(r.pushed).toEqual(["stable/v0.113.0", "v0.113.0"]);
    expect(r.missing).toBeUndefined();
    expect(r.error).toBeUndefined();
    // Exactly one push — the retry that mattered was the verification.
    const stablePushes = gitLib.gitStrict.mock.calls
      .map((c) => c[0])
      .filter((cmd) => cmd === pushCmd("stable/v0.113.0"));
    expect(stablePushes).toHaveLength(1);
  });

  test("the verification is actually re-queried before giving up", async () => {
    // Counts the ls-remote reads for the tag: one pre-check + N verify attempts.
    mockRemote({ "beta/v0.113.0": SHA }, { pushFails: (t) => t === "stable/v0.113.0" });
    await handler(retryParams({ from: "beta", to: "stable", tagPushAttempts: 1, tagVerifyAttempts: 3 }));
    const reads = gitLib.git.mock.calls
      .map((c) => c[0])
      .filter((cmd) => cmd === 'ls-remote --tags origin "stable/v0.113.0" "stable/v0.113.0^{}"');
    // Exact: 1 pre-check + 3 verify attempts + 3 reconciliation attempts.
    // The reconciliation deliberately gets the FULL verify budget — it is the
    // last chance to notice a tag that landed, and tagBudgetMs caps the total.
    // A >= assertion would still pass if an attempt were silently dropped.
    expect(reads).toHaveLength(7);
  });

  test("a push that throws after the ref landed is idempotent, not a failure", async () => {
    // Client-side ETIMEDOUT while the ref already updated remotely. The push's
    // exit code must not decide — only the confirmation does.
    mockRemote(
      { "beta/v0.113.0": SHA },
      { pushFails: (t) => t === "v0.113.0", pushLandsAnyway: (t) => t === "v0.113.0" },
    );
    const r = await handler(retryParams({ from: "beta", to: "stable" }));
    expect(r.success).toBe(true);
    expect(r.pushed).toContain("v0.113.0");
    expect(r.missing).toBeUndefined();
  });

  test("a tag genuinely absent after every retry is still reported missing", async () => {
    // No false positives: retrying must not turn a real failure into success.
    mockRemote({ "beta/v0.113.0": SHA }, { pushFails: (t) => t === "v0.113.0" });
    const r = await handler(retryParams({ from: "beta", to: "stable" }));
    expect(r.success).toBe(false);
    expect(r.pushed).toEqual(["stable/v0.113.0"]);
    expect(r.missing).toEqual(["v0.113.0"]);
    expect(r.error).toMatch(/not verifiable on remote after 3 push attempt/);
  });

  test("the push is actually retried before giving up", async () => {
    mockRemote({ "beta/v0.113.0": SHA }, { pushFails: (t) => t === "v0.113.0" });
    await handler(retryParams({ from: "beta", to: "stable", tagPushAttempts: 3 }));
    const barePushes = gitLib.gitStrict.mock.calls
      .map((c) => c[0])
      .filter((cmd) => cmd === pushCmd("v0.113.0"));
    expect(barePushes).toHaveLength(3);
  });

  test("a conflicting tag is never retried — immutability wins immediately", async () => {
    // A published tag on a DIFFERENT commit is a hard stop, not a lag: retrying
    // it would burn the whole backoff budget on a decision that cannot change.
    const OTHER = "f".repeat(40);
    mockRemote({ "beta/v0.113.0": SHA, "stable/v0.113.0": OTHER });
    const r = await handler(retryParams({ from: "beta", to: "stable" }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/immutable/);
    // The monotonicity/immutability guard fires before any tag is created.
    expect(tagCreateCalls()).toHaveLength(0);
  });

  test("a tag confirmed on the remote is never listed in `missing`", async () => {
    // Reconciliation net: even if every push attempt reported failure, a tag
    // the remote confirms belongs in `pushed`. Lag outlasts the verify budget
    // here (2 verifies), so only the final re-probe can rescue it.
    mockRemote(
      { "beta/v0.113.0": SHA },
      {
        pushFails: (t) => t === "stable/v0.113.0",
        pushLandsAnyway: (t) => t === "stable/v0.113.0",
        lsRemoteLag: (t) => (t === "stable/v0.113.0" ? 2 : 0),
      },
    );
    const r = await handler(retryParams({ from: "beta", to: "stable", tagPushAttempts: 1, tagVerifyAttempts: 2 }));
    expect(r.pushed).toContain("stable/v0.113.0");
    expect(r.missing || []).not.toContain("stable/v0.113.0");
    // The bare tag was never attempted (ordering break) → genuinely missing,
    // and the error must name IT, not the tag we just confirmed as pushed.
    expect(r.success).toBe(false);
    expect(r.missing).toEqual(["v0.113.0"]);
    expect(r.error).toMatch(/v0\.113\.0/);
    expect(r.error).not.toMatch(/not verifiable/);
  });

  test("ordering: the bare tag is never created before stable/vN succeeded", async () => {
    mockRemote({ "beta/v0.113.0": SHA }, { pushFails: (t) => t === "stable/v0.113.0" });
    const r = await handler(retryParams({ from: "beta", to: "stable" }));
    expect(r.success).toBe(false);
    const creates = tagCreateCalls().map((c) => c[1][2]);
    expect(creates).not.toContain("v0.113.0");
    expect(r.missing).toEqual(["stable/v0.113.0", "v0.113.0"]);
  });

  test("a local tag left over from a failed run is reused, not re-created", async () => {
    // `git tag -a` on an existing name fails — which used to make every re-run
    // after a partial failure fail permanently instead of completing.
    mockRemote({ "beta/v0.113.0": SHA }, { preLocal: { "stable/v0.113.0": SHA } });
    const r = await handler(retryParams({ from: "beta", to: "stable" }));
    expect(r.success).toBe(true);
    const creates = tagCreateCalls().map((c) => c[1][2]);
    expect(creates).not.toContain("stable/v0.113.0"); // reused the leftover
    expect(creates).toContain("v0.113.0");
    expect(r.pushed).toEqual(["stable/v0.113.0", "v0.113.0"]);
  });

  test("a leftover local tag pointing at the WRONG commit is refused, not pushed", async () => {
    const OTHER = "f".repeat(40);
    mockRemote({ "beta/v0.113.0": SHA }, { preLocal: { "stable/v0.113.0": OTHER } });
    const r = await handler(retryParams({ from: "beta", to: "stable" }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/local tag stable\/v0\.113\.0 points at/);
    expect(gitLib.gitStrict.mock.calls.map((c) => c[0])).not.toContain(pushCmd("stable/v0.113.0"));
  });
});

describe("ship_promote — #251 reconciliation and fail-closed edges", () => {
  test("reconciliation rescues the LAST failed tag → success:true, stale error dropped", async () => {
    // The one branch that can flip a reported failure into success: every push
    // attempt reported failure and the verify budget ran out, but the final
    // re-probe finds the tag on the remote at the right sha.
    mockRemote(
      { "alpha/v0.113.0": SHA },
      {
        pushFails: (t) => t === "beta/v0.113.0",
        pushLandsAnyway: (t) => t === "beta/v0.113.0",
        lsRemoteLag: (t) => (t === "beta/v0.113.0" ? 1 : 0),
      },
    );
    const r = await handler(params({ tagPushAttempts: 1, tagVerifyAttempts: 1, tagRetryDelayMs: 0 }));
    expect(r.success).toBe(true);
    expect(r.pushed).toEqual(["beta/v0.113.0"]);
    expect(r.missing).toBeUndefined();
    expect(r.error).toBeUndefined();
    // It really was created this run — not an "already promoted" no-op.
    expect(r.alreadyPromoted).toBeUndefined();
  });

  test("an unreadable remote inside ensureTag refuses to push — never 'absent, push away'", async () => {
    // Fail-closed (F2): only the TARGET tag's read fails, so the source lookup
    // and the channel listing still succeed and we reach ensureTag.
    mockRemote({ "alpha/v0.113.0": SHA });
    const inner = gitLib.git.getMockImplementation();
    gitLib.git.mockImplementation((cmd, o) => (cmd.includes('"beta/v0.113.0"') ? null : inner(cmd, o)));

    const r = await handler(params({ tagPushAttempts: 2, tagVerifyAttempts: 2, tagRetryDelayMs: 0 }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cannot reach remote/);
    // Nothing was created or pushed on a remote we could not read.
    expect(tagCreateCalls()).toHaveLength(0);
    expect(gitLib.gitStrict.mock.calls.map((c) => c[0])).not.toContain(pushCmd("beta/v0.113.0"));
    expect(r.missing).toEqual(["beta/v0.113.0"]);
  });

  test("a remote that goes unreadable only AFTER the push says so, instead of claiming the tag is absent", async () => {
    mockRemote({ "alpha/v0.113.0": SHA });
    const inner = gitLib.git.getMockImplementation();
    let seen = 0;
    gitLib.git.mockImplementation((cmd, o) => {
      if (cmd.includes('"beta/v0.113.0"') && ++seen > 1) return null; // pre-check ok, verifies fail
      return inner(cmd, o);
    });

    const r = await handler(params({ tagPushAttempts: 1, tagVerifyAttempts: 2, tagRetryDelayMs: 0 }));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/remote could not be read to confirm tag beta\/v0\.113\.0/);
    expect(r.error).not.toMatch(/not verifiable/);
  });

  test("the wall-clock budget caps the nested retry loops", async () => {
    // tagBudgetMs: 0 would disable the cap; a tiny budget must stop the loops
    // early instead of burning pushAttempts × verifyAttempts reads.
    mockRemote({ "alpha/v0.113.0": SHA }, { pushFails: () => true });
    const r = await handler(params({ tagPushAttempts: 5, tagVerifyAttempts: 5, tagRetryDelayMs: 1, tagBudgetMs: 1 }));
    expect(r.success).toBe(false);
    const pushes = gitLib.gitStrict.mock.calls.map((c) => c[0]).filter((c) => c === pushCmd("beta/v0.113.0"));
    expect(pushes.length).toBeLessThan(5);
    expect(r.error).toMatch(/retry budget/);
  });

  test("a local BRANCH named like the tag is not mistaken for the tag", async () => {
    // The rev-parse is fully qualified (refs/tags/…), so an unqualified name
    // that git would also resolve against refs/heads cannot answer for it.
    mockRemote({ "alpha/v0.113.0": SHA });
    await handler(params());
    const revParses = gitLib.git.mock.calls.map((c) => c[0]).filter((c) => c.startsWith("rev-parse"));
    expect(revParses).toContain('rev-parse -q --verify "refs/tags/beta/v0.113.0^{commit}"');
  });
});
