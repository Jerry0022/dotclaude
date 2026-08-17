import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./git.js", () => ({
  git: vi.fn(() => null),
  dirtyState: vi.fn(() => ({ dirty: false, modified: [], untracked: [], lines: [] })),
}));

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, dirtyState } from "./git.js";
import {
  findMarkersInText,
  candidateFiles,
  scanConflictMarkers,
  describeMarkers,
} from "./conflict-markers.js";

let dir;

beforeEach(() => {
  vi.clearAllMocks();
  git.mockReturnValue(null);
  dirtyState.mockReturnValue({ dirty: false, modified: [], untracked: [], lines: [] });
  dir = mkdtempSync(join(tmpdir(), "conflict-markers-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Drive candidateFiles: `root` is the temp dir, the branch diff lists `files`. */
function stubRepo(files, { worktree = [] } = {}) {
  git.mockImplementation((cmd) => {
    if (cmd.startsWith("rev-parse --show-toplevel")) return dir;
    if (cmd.startsWith("merge-base")) return "abc123";
    if (cmd.startsWith("diff --name-only")) return files.join("\n");
    return null;
  });
  dirtyState.mockReturnValue({ dirty: worktree.length > 0, modified: worktree, untracked: [], lines: [] });
}

function write(name, content) {
  writeFileSync(join(dir, name), content);
}

describe("findMarkersInText", () => {
  test("finds the lone diff3 base marker that v0.130.0 shipped", () => {
    const text = [
      "- **A merge artifact in the concept bridge documentation.**",
      "",
      "||||||| parent of 366426a (chore(release): v0.130.0)",
      "## [0.129.0] — 2026-08-16",
    ].join("\n");
    expect(findMarkersInText(text)).toEqual([{ line: 3, marker: "|||||||" }]);
  });

  test("finds a full conflict block, separator included", () => {
    const text = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| merged common ancestors",
      "base",
      "=======",
      "theirs",
      ">>>>>>> feature",
    ].join("\n");
    expect(findMarkersInText(text).map((h) => h.marker)).toEqual([
      "<<<<<<<", "|||||||", "=======", ">>>>>>>",
    ]);
  });

  test("a markdown setext H1 underline is not a conflict", () => {
    // Exactly seven '=' under a heading — byte-identical to git's separator.
    expect(findMarkersInText("Heading\n=======\n\nbody")).toEqual([]);
  });

  test("a markdown table row of empty cells is not a conflict", () => {
    expect(findMarkersInText("| a | b |\n|---|---|\n|||||||")).toEqual([]);
  });

  test("markers must be exactly seven characters at line start", () => {
    const text = [
      "<<<<<< six",
      "<<<<<<<<eight-no-space",
      "  <<<<<<< indented",
      "code = '<<<<<<< HEAD'",
      ">>>>>>>> also-eight",
    ].join("\n");
    expect(findMarkersInText(text)).toEqual([]);
  });

  test("the separator counts once an unambiguous marker is present", () => {
    expect(findMarkersInText("<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b").map((h) => h.marker))
      .toEqual(["<<<<<<<", "=======", ">>>>>>>"]);
  });

  test("handles CRLF line endings", () => {
    expect(findMarkersInText("a\r\n<<<<<<< HEAD\r\nb")).toEqual([{ line: 2, marker: "<<<<<<<" }]);
  });

  test("bare <<<<<<< and >>>>>>> count without a label", () => {
    expect(findMarkersInText("<<<<<<<\nx\n>>>>>>>").map((h) => h.marker)).toEqual([
      "<<<<<<<", ">>>>>>>",
    ]);
  });
});

describe("candidateFiles", () => {
  test("unions the branch diff with the uncommitted worktree", () => {
    stubRepo(["a.md", "b.js"], { worktree: ["b.js", "package.json"] });
    const out = candidateFiles("/repo", "main");
    expect(out.files.sort()).toEqual(["a.md", "b.js", "package.json"]);
    expect(out.scope).toBe("diff+worktree");
  });

  test("prefers origin/<base> over the local ref", () => {
    stubRepo([]);
    candidateFiles("/repo", "main");
    expect(git).toHaveBeenCalledWith("merge-base HEAD origin/main", { cwd: "/repo" });
    expect(git).not.toHaveBeenCalledWith("merge-base HEAD main", { cwd: "/repo" });
  });

  test("degrades to the worktree alone when no merge-base resolves", () => {
    git.mockImplementation((cmd) => (cmd.startsWith("rev-parse") ? dir : null));
    dirtyState.mockReturnValue({ dirty: true, modified: ["x.md"], untracked: [], lines: [] });
    const out = candidateFiles("/repo", "main");
    expect(out.files).toEqual(["x.md"]);
    expect(out.scope).toBe("worktree");
  });
});

describe("scanConflictMarkers", () => {
  test("clean when no file carries a marker", () => {
    write("a.md", "# fine\n");
    stubRepo(["a.md"]);
    expect(scanConflictMarkers("/repo", { base: "main" })).toMatchObject({
      clean: true,
      scanned: 1,
      offenders: [],
    });
  });

  test("reports the offending file, line and marker", () => {
    write("CHANGELOG.md", "x\n||||||| parent of 366426a (chore(release): v0.130.0)\ny\n");
    stubRepo(["CHANGELOG.md"]);
    const out = scanConflictMarkers("/repo", { base: "main" });
    expect(out.clean).toBe(false);
    expect(out.offenders).toEqual([
      { file: "CHANGELOG.md", count: 1, hits: [{ line: 2, marker: "|||||||" }] },
    ]);
  });

  test("a file listed in the diff but deleted on disk is skipped, not thrown on", () => {
    stubRepo(["gone.md"]);
    expect(scanConflictMarkers("/repo", { base: "main" })).toMatchObject({ clean: true, scanned: 0 });
  });

  test("binary files are never scanned", () => {
    // A NUL byte inside the first 8 KiB, plus a byte sequence that would match.
    writeFileSync(join(dir, "blob.bin"), Buffer.concat([
      Buffer.from([0x00, 0x01]),
      Buffer.from("\n<<<<<<< HEAD\n"),
    ]));
    stubRepo(["blob.bin"]);
    expect(scanConflictMarkers("/repo", { base: "main" })).toMatchObject({ clean: true, scanned: 0 });
  });

  test("scans every candidate, not just the first", () => {
    write("a.md", "ok\n");
    write("b.md", "<<<<<<< HEAD\n");
    stubRepo(["a.md", "b.md"]);
    const out = scanConflictMarkers("/repo", { base: "main" });
    expect(out.scanned).toBe(2);
    expect(out.offenders.map((o) => o.file)).toEqual(["b.md"]);
  });
});

describe("describeMarkers", () => {
  test("names the file, first line and marker", () => {
    const msg = describeMarkers([
      { file: "CHANGELOG.md", count: 1, hits: [{ line: 109, marker: "|||||||" }] },
    ]);
    expect(msg).toBe("Unresolved conflict marker(s) in 1 file(s): CHANGELOG.md:109 (|||||||)");
  });
});
