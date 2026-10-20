import { describe, test, expect, vi } from "vitest";
import { resolve } from "node:path";
import { main, parseArgs } from "./test-record-cli.js";

const K = (h) => ({ treeHash: h.repeat(40), method: "worktree" });

function deps({ keys = [K("a"), K("a")], code = 0 } = {}) {
  const queue = [...keys];
  return {
    exec: vi.fn(() => code),
    key: vi.fn(() => queue.shift() ?? null),
    record: vi.fn((cwd, r) => ({ ...r, at: "now" })),
    log: vi.fn(),
    now: (() => { let t = 1000; return () => (t += 500); })(),
  };
}

describe("test-record-cli", () => {
  test("parseArgs defaults to npm test in cwd", () => {
    expect(parseArgs(["run"])).toMatchObject({ sub: "run", cmd: "npm test", cwd: resolve(".") });
    expect(parseArgs(["record", "--cwd", "/r", "--tree", "abc", "--cmd", "npx vitest run"])).toMatchObject({ tree: "abc", cmd: "npx vitest run" });
  });

  test("run: green on an unchanged tree is recorded with its duration", () => {
    const d = deps();
    expect(main(["run", "--cwd", "/r"], d)).toBe(0);
    expect(d.exec).toHaveBeenCalledWith("npm test", resolve("/r"));
    expect(d.record).toHaveBeenCalledWith(resolve("/r"), expect.objectContaining({ treeHash: "a".repeat(40), testCmd: "npm test", passed: true, source: "agent", durationMs: 500 }));
  });

  test("run: red exit code passes through, nothing recorded", () => {
    const d = deps({ code: 1 });
    expect(main(["run"], d)).toBe(1);
    expect(d.record).not.toHaveBeenCalled();
  });

  test("run: tree changed during the run → green but not recorded", () => {
    const d = deps({ keys: [K("a"), K("b")] });
    expect(main(["run"], d)).toBe(0);
    expect(d.record).not.toHaveBeenCalled();
  });

  test("record: refused when the tree moved since --tree", () => {
    const d = deps({ keys: [K("b")] });
    expect(main(["record", "--tree", "a".repeat(40)], d)).toBe(3);
    expect(d.record).not.toHaveBeenCalled();
  });

  test("record: stored when the tree still matches", () => {
    const d = deps({ keys: [K("a")] });
    expect(main(["record", "--tree", "a".repeat(40)], d)).toBe(0);
    expect(d.record).toHaveBeenCalledTimes(1);
  });

  test("key: reports the tree hash on the log stream", () => {
    const d = deps({ keys: [K("c")] });
    expect(main(["key"], d)).toBe(0);
    expect(d.log.mock.calls[0][0]).toContain(`"treeHash":"${"c".repeat(40)}"`);
  });

  test("unknown subcommand / missing --tree → 2", () => {
    expect(main(["nope"], deps())).toBe(2);
    expect(main(["record"], deps())).toBe(2);
  });
});
