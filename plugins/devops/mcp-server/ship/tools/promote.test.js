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
function mockRemote(tags, { annotated = true, pushFails = null } = {}) {
  // remote: tag -> { obj|null, commit }; local: tag -> target sha given to `git tag -a`
  const remote = new Map(
    Object.entries(tags).map(([t, c]) => [t, annotated ? { obj: objSha(t), commit: c } : { obj: null, commit: c }]),
  );
  const localTags = new Map();
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
  gitLib.gitStrict.mockImplementation((cmd) => {
    const m = /^push origin (\S+)$/.exec(cmd);
    if (m) {
      if (pushFails && pushFails(m[1])) throw new Error("network");
      if (localTags.has(m[1])) {
        remote.set(m[1], { obj: objSha(m[1]), commit: peelTo(localTags.get(m[1])) });
      }
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
    if (!cmd.startsWith("ls-remote --tags origin")) return "";
    const rest = cmd.slice("ls-remote --tags origin".length).trim();
    const pats = rest ? rest.split(/\s+/).map((p) => p.replace(/^"|"$/g, "")) : [];
    const selected = pats.length
      ? refLines().filter(([, ref]) => pats.some((p) => ref === `refs/tags/${p}` || ref.endsWith(`/${p}`)))
      : refLines();
    return selected.map(([sha, ref]) => `${sha}\t${ref}`).join("\n");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ghLib.releaseExists.mockReturnValue(true);
});

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
