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

import { handler } from "./promote.js";
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

// Build a STATEFUL remote mock: ls-remote answers from a tag map, and a
// `git tag -a <tag> <sha>` via execFileSync registers the tag so the
// post-push ls-remote verification sees it (mirrors real remote behavior).
function mockRemote(tags, { existingTarget = {} } = {}) {
  const all = { ...tags, ...existingTarget };
  execFileSync.mockImplementation((cmd, args) => {
    if (cmd === "git" && Array.isArray(args) && args[0] === "tag") {
      all[args[2]] = args[3];
    }
    return "";
  });
  gitLib.git.mockImplementation((cmd) => {
    if (cmd.startsWith("ls-remote --tags origin")) {
      // Specific-tag query: `ls-remote --tags origin <tag>`
      const m = /ls-remote --tags origin (\S+)$/.exec(cmd);
      if (m && m[1] !== "origin") {
        const tag = m[1];
        return all[tag] ? `${all[tag]}\trefs/tags/${tag}` : "";
      }
      // Full listing
      return Object.entries(all)
        .map(([t, sha]) => `${sha}\trefs/tags/${t}`)
        .join("\n");
    }
    return "";
  });
  gitLib.gitStrict.mockImplementation(() => "");
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
    mockRemote({ "beta/v0.113.0": SHA });
    gitLib.gitStrict.mockImplementation((cmd) => {
      if (cmd === "push origin v0.113.0") throw new Error("network");
      return "";
    });
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
