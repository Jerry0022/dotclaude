import { describe, test, expect } from "vitest";
import { parseLsRemoteTagOutput, remoteTagExists } from "./remote-tags.js";

const COMMIT = "a".repeat(40);
const TAGOBJ = "b".repeat(40);

const lines = (...rows) => rows.map(([sha, ref]) => `${sha}\t${ref}`).join("\n");

describe("parseLsRemoteTagOutput", () => {
  test("peeled ^{} line wins over the tag-object line", () => {
    const out = lines([TAGOBJ, "refs/tags/v1.0.0"], [COMMIT, "refs/tags/v1.0.0^{}"]);
    expect(parseLsRemoteTagOutput(out, "v1.0.0")).toBe(COMMIT);
  });

  test("lightweight tag (no peeled line) falls back to the plain sha", () => {
    expect(parseLsRemoteTagOutput(lines([COMMIT, "refs/tags/v1.0.0"]), "v1.0.0")).toBe(COMMIT);
  });

  test("absent tag → null even when suffix-matched siblings are in the output", () => {
    const out = lines([COMMIT, "refs/tags/alpha/v1.0.0"], [COMMIT, "refs/tags/beta/v1.0.0"]);
    expect(parseLsRemoteTagOutput(out, "v1.0.0")).toBeNull();
  });

  test("empty / null / whitespace input → null", () => {
    expect(parseLsRemoteTagOutput("", "v1.0.0")).toBeNull();
    expect(parseLsRemoteTagOutput(null, "v1.0.0")).toBeNull();
    expect(parseLsRemoteTagOutput("   \n  \n", "v1.0.0")).toBeNull();
  });

  test("malformed lines are skipped, not parsed as a match", () => {
    expect(parseLsRemoteTagOutput("garbage\nrefs/tags/v1.0.0\n", "v1.0.0")).toBeNull();
  });
});

describe("remoteTagExists — exact ref, never a substring", () => {
  test("true only for an exact ref match", () => {
    const out = lines([COMMIT, "refs/tags/alpha/v1.0.0"]);
    expect(remoteTagExists(out, "alpha/v1.0.0")).toBe(true);
  });

  test("a channel tag does NOT satisfy a query for the bare tag (#251)", () => {
    // ls-remote tail-matches per path component, so querying `v1.0.0` returns
    // `refs/tags/alpha/v1.0.0`. The old `out.includes(tag)` check read that as
    // "the bare tag is on the remote" — it is not.
    const out = lines([COMMIT, "refs/tags/alpha/v1.0.0"]);
    expect(out.includes("v1.0.0")).toBe(true); // the bug the substring check had
    expect(remoteTagExists(out, "v1.0.0")).toBe(false);
  });

  test("a longer tag name does not satisfy a query for its prefix", () => {
    const out = lines([COMMIT, "refs/tags/v1.0.0-rc1"]);
    expect(remoteTagExists(out, "v1.0.0")).toBe(false);
  });

  test("false for empty output", () => {
    expect(remoteTagExists("", "v1.0.0")).toBe(false);
    expect(remoteTagExists(null, "v1.0.0")).toBe(false);
  });
});
